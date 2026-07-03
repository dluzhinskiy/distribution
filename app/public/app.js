const state = {
  data: null,
  storagePath: "",
  lastRecommendation: null,
  employeeSection: "availability",
  vacationEdit: false,
  vacationMode: "single",
  vacationRangeStart: null,
  responsibleEditEnabled: false,
  deleteEditEnabled: false,
  showDeletedCases: false,
  casesQuickFilter: "",
  casesResponsibleFilter: "",
  completionControlExpanded: false,
  deleteModalCaseId: "",
  postponeCompletionCaseId: "",
  selectedYuc: "",
  resetRegionOnRender: false,
  recommendationTimer: null,
  responsibleDrafts: {},
  statusDrafts: {},
  assignmentDraftOpen: false,
  substitutionDraftOpen: false,
  writeLockCount: 0,
  vacationImportPlan: null,
  caseImportPlan: null,
  caseImportSelectedRows: new Set(),
  vacationDrafts: {},
  queueManualCandidate: null,
  journalLoaded: false,
  journalLoading: false,
};

const titles = {
  dashboard: "Панель управления",
  distribution: "Распределение нового дела",
  cases: "Реестр дел",
  employees: "Сотрудники",
  settings: "Настройки региональных правил",
  journal: "Журнал распределения",
  help: "Инструкция",
};

const caseTypes = ["претензия", "административное", "судебное"];
const workloadTypes = ["все", ...caseTypes];
const statuses = ["В работе", "Ожидает распределения", "Завершено", "Отменено", "Приостановлено"];
const deletedStatus = "Удалено";
const completedStatuses = new Set(["Завершено", "Отменено", deletedStatus]);
const themeStorageKey = "mts-load-distribution-theme";
const blueTheme = "blue";
const redTheme = "red";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function toast(message, type = "ok") {
  const node = $("#toast");
  node.textContent = message;
  node.style.background = type === "error" ? "var(--mts-red)" : "var(--mts-gray-900)";
  node.classList.add("show");
  setTimeout(() => node.classList.remove("show"), 3600);
}

function statusKind(message = "") {
  const text = String(message).toLowerCase();
  if (text.includes("ошибка")) return "error";
  if (text.includes("чита") || text.includes("загружа") || text.includes("обнов")) return "reading";
  if (text.includes("сохраня") || text.includes("удаля") || text.includes("восстанавли") || text.includes("распределя") || text.includes("назнача") || text.includes("заверша") || text.includes("останавли")) return "writing";
  if (text.includes("несохран")) return "draft";
  return "ready";
}

function statusLabel(message = "") {
  const text = String(message || "Готово").trim();
  if (text === "Сохранено") return "Готово";
  if (text === "Читаю MTS Tabs…") return "Читаю таблицы";
  if (text === "Загружаю отпуска в MTS Tabs…") return "Сохраняю отпуска";
  if (text === "Сохраняю в MTS Tabs…") return "Сохраняю";
  return text.replace(/…$/, "");
}

function setStatus(message) {
  const node = $("#saveStatus");
  if (!node) return;
  const kind = statusKind(message);
  node.className = `status-pill status-${kind}`;
  const textNode = node.querySelector(".status-text");
  if (textNode) {
    textNode.textContent = statusLabel(message);
  } else {
    node.textContent = statusLabel(message);
  }
}

function requestMethod(options = {}) {
  return String(options.method || "GET").toUpperCase();
}

function isWriteRequest(options = {}) {
  return !["GET", "HEAD"].includes(requestMethod(options));
}

function applyWriteLockState() {
  const locked = state.writeLockCount > 0;
  document.body.classList.toggle("write-pending", locked);
  $$("button").forEach((button) => {
    if (locked) {
      if (!button.disabled) {
        button.disabled = true;
        button.dataset.writeLocked = "1";
      }
      return;
    }
    if (button.dataset.writeLocked === "1") {
      button.disabled = false;
      delete button.dataset.writeLocked;
    }
  });
}

function beginWriteLock() {
  state.writeLockCount += 1;
  applyWriteLockState();
}

function endWriteLock() {
  state.writeLockCount = Math.max(0, state.writeLockCount - 1);
  applyWriteLockState();
}

function blockWritePendingButtonEvents(event) {
  if (state.writeLockCount <= 0) return;
  if (!event.target.closest?.("button")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function savedTheme() {
  try {
    const saved = localStorage.getItem(themeStorageKey);
    if (saved === redTheme) return redTheme;
    return blueTheme;
  } catch {
    return blueTheme;
  }
}

function saveTheme(theme) {
  try {
    localStorage.setItem(themeStorageKey, theme);
  } catch {
    // Local storage may be unavailable in strict browser modes; the current page still changes theme.
  }
}

function applyTheme(theme, persist = true) {
  const variant = theme === redTheme ? redTheme : blueTheme;
  const isRed = variant === redTheme;
  document.body.classList.add("theme-apple");
  document.body.classList.toggle("theme-blue", !isRed);
  document.body.classList.toggle("theme-red", isRed);
  const toggle = $("#themeToggle");
  const label = $("#themeToggleLabel");
  const logo = $("#brandLogo");
  if (toggle) toggle.checked = isRed;
  if (label) label.textContent = isRed ? "Красный" : "Голубой";
  if (logo) logo.src = isRed ? "/apple_logo_red_512.png" : "/apple_logo_blue_512.png";
  if (persist) saveTheme(variant);
}

async function api(path, options = {}) {
  const shouldLock = isWriteRequest(options);
  if (shouldLock) beginWriteLock();
  try {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || "Ошибка запроса");
    return payload;
  } finally {
    if (shouldLock) endWriteLock();
  }
}

async function uploadVacationWorkbook(file) {
  beginWriteLock();
  try {
    const response = await fetch("/api/vacations/import-preview", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || "Не удалось прочитать Excel.");
    return payload;
  } finally {
    endWriteLock();
  }
}

async function uploadCaseWorkbook(file) {
  beginWriteLock();
  try {
    const response = await fetch(`/api/cases/import-preview?yuc=${encodeURIComponent(selectedYuc())}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || "Не удалось прочитать Excel.");
    return payload;
  } finally {
    endWriteLock();
  }
}

async function loadData() {
  setStatus("Читаю MTS Tabs…");
  const payload = await api("/api/data");
  applyDataPayload(payload);
  setStatus("Готово");
}

function applyDataPayload(payload = {}) {
  if (!payload.data) return;
  const nextData = { ...payload.data };
  if (payload.journalLoaded) {
    state.journalLoaded = true;
  } else if (state.journalLoaded && state.data?.journal) {
    nextData.journal = mergeJournalRows(state.data.journal, nextData.journal);
  }
  state.data = {
    ...nextData,
    journal: nextData.journal ?? [],
    directories: nextData.directories ?? state.data?.directories,
  };
  state.storagePath = payload.storagePath || state.storagePath;
  if ($("#storagePath")) $("#storagePath").textContent = state.storagePath || "MTS Tabs API";
  renderAll();
}

function journalRowKey(row = {}) {
  return [
    row["Дата события"],
    row.case_id,
    row["Способ"],
    row["Ответственный"],
    row["Комментарий"],
  ].map((value) => String(value ?? "")).join("::");
}

function mergeJournalRows(currentRows = [], incomingRows = []) {
  const rows = [...currentRows];
  const seen = new Set(rows.map(journalRowKey));
  for (const row of incomingRows ?? []) {
    const key = journalRowKey(row);
    if (!seen.has(key)) {
      rows.push(row);
      seen.add(key);
    }
  }
  return rows;
}

async function loadJournal(force = false) {
  if (state.journalLoaded && !force || state.journalLoading) return;
  state.journalLoading = true;
  renderJournal();
  setStatus("Читаю журнал…");
  try {
    const payload = await api(`/api/journal${force ? "?force=1" : ""}`);
    state.data = {
      ...state.data,
      journal: payload.journal ?? [],
    };
    state.journalLoaded = true;
    setStatus("Готово");
  } catch (error) {
    setStatus("Ошибка");
    toast(error.message, "error");
  } finally {
    state.journalLoading = false;
    renderJournal();
  }
}

function setDataFromPayload(payload) {
  if (payload.data) {
    applyDataPayload(payload);
  }
}

function showView(name) {
  $$(".view").forEach((view) => view.classList.remove("active"));
  $(`#view-${name}`).classList.add("active");
  $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.view === name));
  $("#pageTitle").textContent = titles[name];
  if (name === "employees" && state.data) {
    resetEmployeeAvailabilityDrafts();
  }
  if (name === "settings" && state.data) {
    renderSettings();
  }
  if (name === "journal") {
    loadJournal().catch((error) => {
      setStatus("Ошибка");
      toast(error.message, "error");
    });
  }
}

function badge(text, kind = "gray") {
  return `<span class="badge badge-${kind}">${escapeHtml(text)}</span>`;
}

function yes(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "да" || text === "1" || text === "true";
}

function yesNo(value) {
  return yes(value) ? "Да" : "Нет";
}

function yesNoToggle({ className = "", attrs = "", checked = false, disabled = false } = {}) {
  return `
    <label class="toggle-inline ${disabled ? "disabled" : ""}">
      <input type="checkbox" class="${className}" ${attrs} ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
      <span class="switch-ui"></span>
      <span class="toggle-caption">${checked ? "Да" : "Нет"}</span>
    </label>
  `;
}

function isDeletedCase(row) {
  return row?.["Статус"] === deletedStatus;
}

function normalizeYucName(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "Дальний Восток";
  const aliases = new Map([
    ["дв", "Дальний Восток"],
    ["юц дв", "Дальний Восток"],
    ["дальний восток", "Дальний Восток"],
  ]);
  return aliases.get(text.toLowerCase()) ?? text;
}

function uniquePreserveOrder(values) {
  const seen = new Set();
  return values
    .map(normalizeYucName)
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function availableYucs() {
  if (!state.data) return ["Дальний Восток"];
  const yucs = uniquePreserveOrder([
    ...(state.data.directories?.yucs ?? []),
    ...(state.data.employees ?? []).map((row) => row["ЮЦ"]),
    ...(state.data.cases ?? []).map((row) => row["ЮЦ"]),
    ...(state.data.queues ?? []).map((row) => row["ЮЦ"]),
    ...(state.data.state ?? []).map((row) => row["ЮЦ"]),
  ]);
  return yucs.length ? yucs : ["Дальний Восток"];
}

function ensureSelectedYuc() {
  const yucs = availableYucs();
  const current = normalizeYucName(state.selectedYuc);
  state.selectedYuc = yucs.includes(current) ? current : yucs[0];
  return state.selectedYuc;
}

function selectedYuc() {
  return ensureSelectedYuc();
}

function yucMatches(value) {
  return normalizeYucName(value) === selectedYuc();
}

function rowsForSelectedYuc(rows) {
  return (rows ?? []).filter((row) => yucMatches(row["ЮЦ"]));
}

function employeesForSelectedYuc() {
  return rowsForSelectedYuc(state.data?.employees);
}

function casesForSelectedYuc() {
  return rowsForSelectedYuc(state.data?.cases);
}

function queuesForSelectedYuc() {
  return rowsForSelectedYuc(state.data?.queues);
}

function queueForEmployeeType(employee, type) {
  const normalizedType = normalizeCaseType(type);
  const employeeId = String(employee?.employee_id ?? "").trim();
  const employeeName = String(employee?.["ФИО"] ?? "").trim();
  return queuesForSelectedYuc().find((row) =>
    normalizeCaseType(row["Тип дела"]) === normalizedType &&
    (
      String(row.employee_id ?? "").trim() === employeeId ||
      nameMatches(row["ФИО"], employeeName)
    )
  ) ?? null;
}

function stateRowsForSelectedYuc() {
  return rowsForSelectedYuc(state.data?.state);
}

function yucSettingsForSelectedYuc() {
  return rowsForSelectedYuc(state.data?.yucSettings)[0] ?? {
    "ЮЦ": selectedYuc(),
    "Региональные очереди вкл\\выкл": "Нет",
    "Порог перегруза": 5,
    "Считать перегруз по": "общая нагрузка",
    "Автоназначение вне региона вкл/выкл": "Да",
    "Учитывать неактивные незавершенные в нагрузке": "Нет",
    "Регион не настроен": "общая очередь",
    "Региональные юристы недоступны": "заместитель затем общая очередь",
  };
}

function includeInactiveInLoadForSelectedYuc() {
  return yes(yucSettingsForSelectedYuc()["Учитывать неактивные незавершенные в нагрузке"]);
}

function regionalQueuesEnabled() {
  return yes(yucSettingsForSelectedYuc()["Региональные очереди вкл\\выкл"]);
}

function regionalQueuesCurrentlyEnabled() {
  const input = $("#yucSettingsForm")?.elements["Региональные очереди вкл\\выкл"];
  return input ? input.checked : regionalQueuesEnabled();
}

function regionalAssignmentsForSelectedYuc() {
  return rowsForSelectedYuc(state.data?.regionalAssignments);
}

function regionalSubstitutionsForSelectedYuc() {
  return rowsForSelectedYuc(state.data?.regionalSubstitutions);
}

function journalRowsForSelectedYuc() {
  return rowsForSelectedYuc(state.data?.journal);
}

function deadlineSettingForType(type) {
  const normalized = String(type ?? "").trim().toLowerCase();
  const row = rowsForSelectedYuc(state.data?.settings).find((item) => normalizeCaseType(item["Тип дела"]) === normalized);
  const defaults = {
    "претензия": { activity: 5, autocompletion: 30, maxDebt: 0 },
    "административное": { activity: 10, autocompletion: 90, maxDebt: 0 },
    "судебное": { activity: 30, autocompletion: 360, maxDebt: 0 },
  };
  return {
    "ЮЦ": selectedYuc(),
    "Тип дела": normalized,
    "Активность, дни": Number(row?.["Активность, дни"]) || defaults[normalized]?.activity || 1,
    "Автозавершение, дни": Number(row?.["Автозавершение, дни"]) || defaults[normalized]?.autocompletion || 1,
    "Учитывать долг": yes(row?.["Учитывать долг"]) ? "Да" : "Нет",
    "Максимальный долг": Number(row?.["Максимальный долг"]) || defaults[normalized]?.maxDebt || 0,
  };
}

function debtAmount(value) {
  if (yes(value)) return 1;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function debtEnabledForType(type) {
  return yes(deadlineSettingForType(type)["Учитывать долг"]);
}

function maxDebtForType(type) {
  return Number(deadlineSettingForType(type)["Максимальный долг"]) || 0;
}

function normalizeCaseType(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "админ") return "административное";
  if (text === "суд") return "судебное";
  return text;
}

function deadlineSettingsForSelectedYuc() {
  return caseTypes.map(deadlineSettingForType);
}

function completionDueCases() {
  return casesForSelectedYuc()
    .filter((row) => row["Требует решения о завершении"] === "Да")
    .sort((a, b) => String(a["Контрольная дата завершения"]).localeCompare(String(b["Контрольная дата завершения"])));
}

function summaryForSelectedYuc() {
  const cases = casesForSelectedYuc().filter((caseRow) => !isDeletedCase(caseRow));
  const productionCases = cases.filter((caseRow) => !completedStatuses.has(caseRow["Статус"]));
  const activeProductionCases = productionCases.filter((caseRow) => Number(caseRow["Активное число"]) === 1);
  const inactiveProductionCases = productionCases.filter((caseRow) => Number(caseRow["Активное число"]) !== 1);
  const includeInactive = includeInactiveInLoadForSelectedYuc();
  return {
    totalCases: cases.length,
    productionCases: productionCases.length,
    activeCases: activeProductionCases.length,
    inactiveCases: inactiveProductionCases.length,
    waitingCases: productionCases.filter((caseRow) => caseRow["Статус"] === "Ожидает распределения").length,
    unassignedCases: productionCases.filter((caseRow) => !String(caseRow["Ответственный"] ?? "").trim()).length,
    activeEmployees: employeesForSelectedYuc().filter((employee) => employee["Активен"] === "Да").length,
    completionDue: completionDueCases().length,
    byType: caseTypes.map((type) => {
      const typeRows = productionCases.filter((caseRow) => caseRow["Тип дела"] === type);
      const active = typeRows.filter((caseRow) => Number(caseRow["Активное число"]) === 1).length;
      const inactive = typeRows.length - active;
      return {
        type,
        total: typeRows.length,
        load: includeInactive ? typeRows.length : active,
        active,
        inactive,
        waiting: typeRows.filter((caseRow) => caseRow["Статус"] === "Ожидает распределения").length,
      };
    }),
  };
}

function setSelectedYuc(yuc, options = {}) {
  const next = normalizeYucName(yuc);
  const changed = next !== state.selectedYuc;
  state.selectedYuc = next;
  if (changed) {
    state.lastRecommendation = null;
    state.vacationRangeStart = null;
    state.responsibleDrafts = {};
    state.statusDrafts = {};
    state.resetRegionOnRender = options.resetRegion !== false;
  }
  renderAll();
  scheduleRecommendation();
}

function renderYucTabs() {
  const container = $("#yucTabs");
  if (!container) return;
  const current = selectedYuc();
  container.innerHTML = availableYucs()
    .map((yuc) => `
      <button class="yuc-tab ${yuc === current ? "active" : ""}" data-yuc="${escapeHtml(yuc)}" type="button">
        ${escapeHtml(yuc)}
      </button>
    `)
    .join("");
}

function renderSummary() {
  const summary = summaryForSelectedYuc();
  const includeInactive = includeInactiveInLoadForSelectedYuc();
  $("#summaryCards").innerHTML = [
    ["В производстве", summary.productionCases, "production"],
    ["Активных", summary.activeCases, "active"],
    ["Неактивных незавершённых", summary.inactiveCases, "inactive"],
    ["Ожидают распределения", summary.waitingCases, "waiting"],
    ["К завершению", summary.completionDue, "completion"],
  ].map(([label, value, action]) => `
    <button class="metric-card metric-button ${action === "completion" && state.completionControlExpanded ? "active" : ""}" type="button" data-summary-action="${action}">
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value}</div>
    </button>
  `).join("");

  $("#typeSummary").innerHTML = summary.byType.map((item) => `
    <div class="type-load-card">
      <div class="type-load-head">
        <strong>${escapeHtml(item.type)}</strong>
        <span>${item.load}</span>
      </div>
      <div class="type-load-bars" title="Активные: ${item.active}; неактивные незавершённые: ${item.inactive}">
        ${includeInactive
          ? item.load
            ? `<div class="type-load-bar active" style="width:100%"></div>`
            : `<div class="type-load-bar empty" style="width:100%"></div>`
          : item.active
            ? `<div class="type-load-bar active" style="width:100%"></div>`
            : `<div class="type-load-bar empty" style="width:100%"></div>`
        }
      </div>
      <div class="type-load-meta">
        ${includeInactive
          ? `<span><i class="legend-dot active"></i>${item.load} в расчёте</span>`
          : `
            <span><i class="legend-dot active"></i>${item.active} активных</span>
            <span><i class="legend-dot inactive"></i>${item.inactive} неактивных</span>
          `}
        <span>${item.waiting ? `${item.waiting} ждут распределения` : "нет ожидающих"}</span>
      </div>
    </div>
  `).join("");
}

function renderCompletionControl() {
  const rows = completionDueCases();
  const cardNode = $("#completionControlCard");
  const badgeNode = $("#completionControlBadge");
  const listNode = $("#completionControlList");
  cardNode?.classList.toggle("is-collapsed", !state.completionControlExpanded);
  if (!badgeNode || !listNode) return;
  badgeNode.textContent = `${rows.length} к решению`;
  badgeNode.className = `badge ${rows.length ? "badge-orange" : "badge-green"}`;
  if (!rows.length) {
    listNode.innerHTML = `<div class="empty-cell">Нет дел, по которым истёк срок автозавершения.</div>`;
    return;
  }
  listNode.innerHTML = rows.slice(0, 12).map((row) => `
    <div class="completion-item">
      <div>
        <strong>
          <button class="link-btn case-id-link" data-id="${escapeHtml(row.case_id)}">${escapeHtml(row.case_id)}</button>
          ${badge(row["Тип дела"], row["Тип дела"] === "судебное" ? "blue" : row["Тип дела"] === "претензия" ? "green" : "orange")}
        </strong>
        <div class="completion-meta">
          Ответственный: ${escapeHtml(displayName(row["Ответственный"]))} ·
          поступило: ${escapeHtml(formatRuDateDash(row["Дата поступления"]))} ·
          контрольная дата: ${escapeHtml(formatRuDateDash(row["Контрольная дата завершения"]))} ·
          просрочка: ${escapeHtml(row["Дней просрочки завершения"] || 0)} дн.
        </div>
        ${row["Причина отложения завершения дела"] ? `<div class="completion-meta">Последняя причина отложения: ${escapeHtml(row["Причина отложения завершения дела"])}</div>` : ""}
      </div>
      <div class="completion-actions">
        <button class="tiny-btn complete-deadline-case" data-id="${escapeHtml(row.case_id)}">Завершить</button>
        <button class="tiny-btn light postpone-completion-case" data-id="${escapeHtml(row.case_id)}">Отложить</button>
      </div>
    </div>
  `).join("");
}

function casesQuickFilterLabel() {
  return {
    active: "Актуально: да",
    inactive: "Актуально: нет · незавершённые",
    waiting: "Статус: ожидает распределения",
  }[state.casesQuickFilter] || "";
}

function caseMatchesQuickFilter(row) {
  if (state.casesQuickFilter === "active") return row["Актуально"] === "Да";
  if (state.casesQuickFilter === "inactive") {
    return row["Актуально"] === "Нет" && !completedStatuses.has(row["Статус"]);
  }
  if (state.casesQuickFilter === "waiting") return row["Статус"] === "Ожидает распределения";
  return true;
}

function caseMatchesResponsibleFilter(row) {
  if (!state.casesResponsibleFilter) return true;
  return nameMatches(row["Ответственный"], state.casesResponsibleFilter);
}

function renderCasesQuickFilter() {
  const node = $("#casesQuickFilterStrip");
  if (!node) return;
  const chips = [];
  const label = casesQuickFilterLabel();
  if (label) {
    chips.push(`
      <span class="quick-filter-chip">
        ${escapeHtml(label)}
        <button type="button" id="clearCasesQuickFilter" aria-label="Сбросить фильтр">×</button>
      </span>
    `);
  }
  if (state.casesResponsibleFilter) {
    chips.push(`
      <span class="quick-filter-chip">
        Ответственный: ${escapeHtml(displayName(state.casesResponsibleFilter))}
        <button type="button" id="clearCasesResponsibleFilter" aria-label="Сбросить фильтр по ответственному">×</button>
      </span>
    `);
  }
  node.innerHTML = chips.join("");
}

function employeeInitials(name) {
  return String(name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function shortName(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  const [surname, first = "", middle = ""] = parts;
  const initials = [first, middle]
    .filter(Boolean)
    .map((part) => `${part[0]}.`)
    .join("");
  return initials ? `${surname} ${initials}` : surname;
}

function displayName(name) {
  return shortName(name) || "—";
}

function employeeParticipatesInCaseType(employee, type) {
  if (type === "судебное") return yes(employee["Судебные"]);
  if (type === "административное") return yes(employee["Административные"]);
  if (type === "претензия") return yes(employee["Претензии"]);
  return false;
}

function nameMatches(a, b) {
  const left = String(a ?? "").trim();
  const right = String(b ?? "").trim();
  if (!left || !right) return false;
  return left === right || shortName(left) === right || left === shortName(right);
}

function workloadByEmployee() {
  const yucCases = casesForSelectedYuc();
  const includeInactive = includeInactiveInLoadForSelectedYuc();
  return employeesForSelectedYuc().map((employee) => {
    const name = employee["ФИО"];
    const productionCases = yucCases.filter((caseRow) =>
      nameMatches(caseRow["Ответственный"], name) &&
      !completedStatuses.has(caseRow["Статус"])
    );
    const byType = Object.fromEntries(caseTypes.map((type) => {
      const rows = productionCases.filter((caseRow) => caseRow["Тип дела"] === type);
      const active = rows.filter((caseRow) => Number(caseRow["Активное число"]) === 1).length;
      const inactive = rows.length - active;
      return [type, { active, inactive, total: rows.length, load: includeInactive ? rows.length : active }];
    }));
    const activeTotal = productionCases.filter((caseRow) => Number(caseRow["Активное число"]) === 1).length;
    const inactiveTotal = productionCases.filter((caseRow) => Number(caseRow["Активное число"]) !== 1).length;
    return {
      employee,
      byType,
      total: includeInactive ? productionCases.length : activeTotal,
      activeTotal,
      inactiveTotal,
    };
  }).sort((a, b) => b.total - a.total || a.employee["ФИО"].localeCompare(b.employee["ФИО"], "ru"));
}

function renderWorkloadDashboard() {
  const rows = workloadByEmployee();
  const includeInactive = includeInactiveInLoadForSelectedYuc();
  const loadModeText = includeInactive ? "активные + неактивные незавершённые" : "только активные";
  const maxTotal = Math.max(...rows.flatMap((row) => caseTypes.map((type) => row.byType[type].load)), 1);
  $("#workloadDashboard").innerHTML = `
    <div class="workload-legend">
      <span>Режим расчёта: ${escapeHtml(loadModeText)}</span>
      ${includeInactive
        ? `<span><i class="legend-dot active"></i>Единая нагрузка</span>`
        : `
          <span><i class="legend-dot active"></i>Активные</span>
          <span><i class="legend-dot inactive"></i>Неактивные, но незавершённые</span>
        `}
    </div>
    <div class="workload-table">
      <div class="workload-header employee-col">Сотрудник</div>
      ${caseTypes.map((type) => `<div class="workload-header">${escapeHtml(type)}</div>`).join("")}
      <div class="workload-header total-col">Всего</div>
      ${rows.map((row) => `
        <div class="workload-employee">
          <div class="avatar avatar-sm">${escapeHtml(employeeInitials(row.employee["ФИО"]))}</div>
          <div>
            <button
              type="button"
              class="workload-employee-link"
              data-dashboard-responsible="${escapeHtml(row.employee["ФИО"])}"
              title="Показать дела сотрудника"
            >${escapeHtml(displayName(row.employee["ФИО"]))}</button>
            <span>${includeInactive ? `${row.total} в расчёте` : `${row.activeTotal} активных · ${row.inactiveTotal} неактивных`}</span>
          </div>
        </div>
        ${caseTypes.map((type) => {
          const item = row.byType[type];
          const activeWidth = item.active ? Math.max(8, Math.round((item.active / maxTotal) * 100)) : 0;
          const loadWidth = item.load ? Math.max(8, Math.round((item.load / maxTotal) * 100)) : 0;
          return `
            <div class="workload-cell">
              <div class="workload-count">
                <strong>${item.load}</strong>
                <span>${includeInactive ? "в расчёте" : `${item.active} / ${item.inactive}`}</span>
              </div>
              <div class="workload-bars" title="${includeInactive ? `В расчёте: ${item.load}` : `Активные: ${item.active}; неактивные незавершённые: ${item.inactive}`}">
                ${includeInactive
                  ? item.load ? `<div class="workload-bar active" style="width:${loadWidth}%"></div>` : ""
                  : item.active ? `<div class="workload-bar active" style="width:${activeWidth}%"></div>` : ""}
              </div>
            </div>
          `;
        }).join("")}
        <div class="workload-total">
          <strong>${row.total}</strong>
          <span>${includeInactive ? "в расчёте" : `${row.activeTotal} + ${row.inactiveTotal}`}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderYucRegionSelects() {
  const directories = state.data?.directories;
  const regionSelect = $("#regionSelect");
  if (!regionSelect) return;
  const currentYuc = selectedYuc();
  const currentRegion = state.resetRegionOnRender ? "" : regionSelect.value;
  state.resetRegionOnRender = false;
  if (!directories?.yucs?.length) {
    regionSelect.innerHTML = `<option value="">Регион не выбран</option>`;
    return;
  }
  renderRegionSelect(currentRegion);
}

function renderRegionSelect(previousRegion = null) {
  const directories = state.data?.directories;
  const yuc = selectedYuc();
  const regionSelect = $("#regionSelect");
  if (!regionSelect) return;
  const current = previousRegion ?? regionSelect.value;
  const regions = directories?.regionsByYuc?.[yuc] ?? [];
  regionSelect.innerHTML = `<option value="">Не выбран</option>` + regions
    .map((region) => `<option value="${escapeHtml(region)}">${escapeHtml(region)}</option>`)
    .join("");
  if (regions.includes(current)) {
    regionSelect.value = current;
  }
}

function caseStatusSelect(row) {
  const current = state.statusDrafts[row.case_id] ?? row["Статус"];
  const options = statuses.includes(current) ? statuses : [...statuses, current];
  const disabled = !state.responsibleEditEnabled || isDeletedCase(row);
  return `<select class="inline-select case-status" data-id="${escapeHtml(row.case_id)}" ${disabled ? "disabled" : ""} title="${disabled ? "Для удалённого дела статус меняется через восстановление" : "Выберите новый статус"}">
    ${options.map((status) => `<option value="${status}" ${current === status ? "selected" : ""} ${status === deletedStatus ? "disabled" : ""}>${status}</option>`).join("")}
  </select>`;
}

function canAssignExistingCase(row) {
  return row["Статус"] === "Ожидает распределения" && !String(row["Ответственный"] ?? "").trim();
}

function caseResponsibleValue(row) {
  return state.responsibleDrafts[row.case_id] ?? row["Ответственный"] ?? "";
}

function isResponsibleChanged(row) {
  return state.responsibleEditEnabled && !isDeletedCase(row) && caseResponsibleValue(row) !== (row["Ответственный"] ?? "");
}

function caseStatusValue(row) {
  return state.statusDrafts[row.case_id] ?? row["Статус"] ?? "";
}

function isStatusChanged(row) {
  return state.responsibleEditEnabled && !isDeletedCase(row) && caseStatusValue(row) !== (row["Статус"] ?? "");
}

function isCaseChanged(row) {
  return isResponsibleChanged(row) || isStatusChanged(row);
}

function caseResponsibleCell(row) {
  const current = caseResponsibleValue(row);
  const disabled = !state.responsibleEditEnabled || isDeletedCase(row);
  const employees = employeesForSelectedYuc();
  return `
    <select class="inline-select responsible-select" data-id="${escapeHtml(row.case_id)}" ${disabled ? "disabled" : ""} title="${disabled ? "Для удалённого дела редактирование недоступно" : "Выберите нового ответственного"}">
      <option value="" disabled ${current ? "" : "selected"}>—</option>
      ${employees.map((employee) => {
        const name = employee["ФИО"];
        return `<option value="${escapeHtml(name)}" ${nameMatches(name, current) ? "selected" : ""}>${escapeHtml(displayName(name))}</option>`;
      }).join("")}
    </select>
  `;
}

function existingCaseActions(row) {
  if (isCaseChanged(row)) {
    return `
      <div class="case-actions">
        <button class="icon-btn confirm save-case-changes" data-id="${escapeHtml(row.case_id)}" title="Сохранить изменения">✓</button>
        <button class="icon-btn cancel cancel-case-changes" data-id="${escapeHtml(row.case_id)}" title="Отменить изменения">×</button>
      </div>
    `;
  }
  if (isDeletedCase(row)) {
    return `
      <div class="case-actions">
        <button class="tiny-btn restore-case" data-id="${escapeHtml(row.case_id)}">Восстановить</button>
      </div>
    `;
  }
  if (state.deleteEditEnabled) {
    return `
      <div class="case-actions">
        <button class="icon-btn danger open-delete-case" data-id="${escapeHtml(row.case_id)}" title="Удалить дело">🗑</button>
      </div>
    `;
  }
  if (!canAssignExistingCase(row)) return `<span class="muted">—</span>`;
  return `
    <div class="case-actions">
      <button class="tiny-btn assign-existing-auto" data-id="${escapeHtml(row.case_id)}">Авто</button>
      <button class="tiny-btn light assign-existing-manual" data-id="${escapeHtml(row.case_id)}">Вручную</button>
    </div>
  `;
}

function draftFromCase(row) {
  return {
    "Номер дела": row["Номер дела"],
    "Предмет": row["Предмет"],
    "ЮЦ": row["ЮЦ"],
    "Регион": row["Регион"],
    "Истец": row["Истец"],
    "Ответчик": row["Ответчик"],
    "Третье лицо": row["Третье лицо"],
    "Тип дела": row["Тип дела"],
    "Дата поступления": row["Дата поступления"],
    "Ссылка": row["Ссылка"],
  };
}

function renderCases() {
  renderCasesQuickFilter();
  const term = ($("#casesSearch")?.value ?? "").toLowerCase();
  const rows = casesForSelectedYuc()
    .filter((row) => state.showDeletedCases || !isDeletedCase(row))
    .filter(caseMatchesQuickFilter)
    .filter(caseMatchesResponsibleFilter)
    .filter((row) => !term || Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(term)))
    .slice()
    .reverse();
  if (!rows.length) {
    $("#casesTable").innerHTML = `<tr><td colspan="9" class="empty-cell">Дела не найдены.</td></tr>`;
    return;
  }
  $("#casesTable").innerHTML = rows.map((row) => `
    <tr class="${isDeletedCase(row) ? "case-deleted-row" : ""}">
      <td class="id-cell"><button class="link-btn case-id-link" data-id="${escapeHtml(row.case_id)}" title="Открыть карточку дела">${escapeHtml(row.case_id)}</button></td>
      <td>${badge(row["Тип дела"], row["Тип дела"] === "судебное" ? "blue" : row["Тип дела"] === "претензия" ? "green" : "orange")}</td>
      <td><div class="cell-main">${escapeHtml(row["Предмет"])}</div></td>
      <td>${escapeHtml(row["Регион"])}</td>
      <td class="date-cell">${escapeHtml(row["Дата поступления"])}</td>
      <td>${badge(row["Актуально"], row["Актуально"] === "Да" ? "green" : "gray")}</td>
      <td>${caseResponsibleCell(row)}</td>
      <td>${caseStatusSelect(row)}</td>
      <td>${existingCaseActions(row)}</td>
    </tr>
  `).join("");
}

function applyCasesQuickFilter(filter) {
  state.casesQuickFilter = filter || "";
  state.casesResponsibleFilter = "";
  if ($("#casesSearch")) $("#casesSearch").value = "";
  showView("cases");
  renderCases();
}

function applyCasesResponsibleFilter(responsible) {
  state.casesResponsibleFilter = responsible || "";
  state.casesQuickFilter = "";
  if ($("#casesSearch")) $("#casesSearch").value = "";
  showView("cases");
  renderCases();
}

function closeCaseImportModal() {
  $("#caseImportModal")?.classList.remove("show");
  $("#caseImportModal")?.setAttribute("aria-hidden", "true");
  if ($("#caseImportInput")) $("#caseImportInput").value = "";
}

function selectedCaseImportRows() {
  const plan = state.caseImportPlan;
  if (!plan) return [];
  const selected = state.caseImportSelectedRows ?? new Set();
  return (plan.toAdd ?? []).filter((item) => selected.has(String(item.rowNumber)));
}

function updateCaseImportSelectionState() {
  const plan = state.caseImportPlan;
  const total = plan?.toAdd?.length ?? 0;
  const selectedCount = selectedCaseImportRows().length;
  const applyButton = $("#caseImportApplyBtn");
  const selectedNode = $("#caseImportSelectedCount");
  const selectAll = $("#caseImportSelectAll");
  if (applyButton) {
    applyButton.disabled = selectedCount === 0;
    applyButton.textContent = selectedCount ? `Добавить выбранные (${selectedCount})` : "Добавить выбранные";
  }
  if (selectedNode) {
    selectedNode.textContent = `${selectedCount} из ${total} отмечены для добавления`;
  }
  if (selectAll) {
    selectAll.checked = total > 0 && selectedCount === total;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < total;
  }
}

function caseImportRow(item, options = {}) {
  const checked = options.checked ? "checked" : "";
  const disabled = options.disabled ? "disabled" : "";
  const mutedReason = options.reason || item.reason || "";
  return `
    <li class="import-row ${options.disabled ? "is-disabled" : ""}">
      <label class="import-row-check">
        <input
          type="checkbox"
          class="case-import-check"
          data-row-number="${escapeHtml(item.rowNumber)}"
          ${checked}
          ${disabled}
        />
        <span class="checkbox-ui"></span>
      </label>
      <div class="import-row-body">
        <div>
          <strong>Строка ${item.rowNumber}: ${escapeHtml(item.source["Предмет"])}</strong>
          ${mutedReason ? `<span class="muted"> · ${escapeHtml(mutedReason)}</span>` : ""}
        </div>
        <div class="muted">
          ${escapeHtml(item.source["Тип дела"] || "тип не указан")} ·
          ${escapeHtml(item.source["Регион"] || "регион не указан")} ·
          ${escapeHtml(item.source["Ответственный"] ? displayName(item.source["Ответственный"]) : "без ответственного")}
        </div>
      </div>
    </li>
  `;
}

function renderCaseImportModal() {
  const plan = state.caseImportPlan;
  const content = $("#caseImportContent");
  const applyButton = $("#caseImportApplyBtn");
  if (!content || !applyButton || !plan) return;
  const hasWarnings = Boolean(plan.invalid?.length || plan.duplicateInFile?.length);
  content.innerHTML = `
    <p class="muted">
      Импорт добавит только отсутствующие дела. Проверка дублей выполняется по типу, дате поступления, региону,
      предмету и сторонам. Очереди назначения при импорте не изменяются.
    </p>
    <div class="import-summary-grid">
      <div class="import-summary-card"><span>Лист</span><strong>${escapeHtml(plan.sheetName || "—")}</strong></div>
      <div class="import-summary-card"><span>Строк в файле</span><strong>${plan.stats?.sourceRows ?? 0}</strong></div>
      <div class="import-summary-card"><span>Новых дел</span><strong>${plan.stats?.newCases ?? 0}</strong></div>
      <div class="import-summary-card"><span>Уже есть</span><strong>${plan.stats?.existingCases ?? 0}</strong></div>
    </div>
    ${hasWarnings ? `
      <div class="import-warning">
        Часть строк не будет добавлена: есть некорректные строки или повторы внутри файла.
      </div>
    ` : ""}
    <div class="import-selection-head">
      <h3>Новые дела</h3>
      <div class="import-selection-controls">
        <label class="import-select-all">
          <input type="checkbox" id="caseImportSelectAll">
          <span class="checkbox-ui"></span>
          <span id="caseImportSelectedCount"></span>
        </label>
        <button class="tiny-btn light" id="caseImportSelectAllBtn" type="button">Отметить все</button>
        <button class="tiny-btn light" id="caseImportClearAllBtn" type="button">Снять все</button>
      </div>
    </div>
    <ul class="import-list case-import-list">
      ${(plan.toAdd ?? []).map((item) => caseImportRow(item, {
        checked: state.caseImportSelectedRows.has(String(item.rowNumber)),
      })).join("") || `<li>Новых дел для добавления нет.</li>`}
    </ul>
    ${(plan.existing ?? []).length ? `
      <h3>Уже есть в реестре</h3>
      <ul class="import-list case-import-list secondary">
        ${(plan.existing ?? []).map((item) => caseImportRow(item, {
          disabled: true,
          checked: false,
          reason: item.reason || "уже есть",
        })).join("")}
      </ul>
    ` : ""}
    ${(plan.invalid ?? []).length ? `
      <h3>Не будут добавлены</h3>
      <ul class="import-list">
        ${(plan.invalid ?? []).slice(0, 8).map((item) => `<li>Строка ${item.rowNumber}: ${escapeHtml(item.reason)}</li>`).join("")}
        ${(plan.invalid ?? []).length > 8 ? `<li>…и ещё ${(plan.invalid ?? []).length - 8}</li>` : ""}
      </ul>
    ` : ""}
  `;
  updateCaseImportSelectionState();
  $("#caseImportModal")?.classList.add("show");
  $("#caseImportModal")?.setAttribute("aria-hidden", "false");
}

async function previewCaseImport(file) {
  if (!file) return;
  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".xlsx") && !lowerName.endsWith(".xlsm")) {
    toast("Выберите файл Excel в формате .xlsx или .xlsm.", "error");
    return;
  }
  setStatus("Читаю дела из Excel…");
  const payload = await uploadCaseWorkbook(file);
  state.caseImportPlan = payload.plan;
  state.caseImportSelectedRows = new Set((payload.plan?.toAdd ?? []).map((item) => String(item.rowNumber)));
  renderCaseImportModal();
  setStatus("Готово");
}

async function applyCaseImport() {
  if (!state.caseImportPlan) return;
  const selectedRows = selectedCaseImportRows();
  if (!selectedRows.length) {
    toast("Выберите хотя бы одно новое дело для добавления.", "error");
    return;
  }
  setStatus("Добавляю новые дела в MTS Tabs…");
  const payload = await api("/api/cases/import-apply", {
    method: "POST",
    body: JSON.stringify({ rows: selectedRows }),
  });
  setDataFromPayload(payload);
  state.caseImportPlan = null;
  state.caseImportSelectedRows = new Set();
  closeCaseImportModal();
  toast(`Импорт завершён: добавлено ${payload.result?.added ?? 0} дел.`);
  setStatus("Готово");
}

function handleSummaryAction(action) {
  if (action === "completion") {
    state.completionControlExpanded = !state.completionControlExpanded;
    renderSummary();
    renderCompletionControl();
    if (state.completionControlExpanded) {
      $("#completionControlCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    return;
  }
  if (action === "production") applyCasesQuickFilter("");
  if (action === "active") applyCasesQuickFilter("active");
  if (action === "inactive") applyCasesQuickFilter("inactive");
  if (action === "waiting") applyCasesQuickFilter("waiting");
}

function employeeToggle(value, employeeId, field, options = {}) {
  const classes = [
    "employee-field",
    field === "Активен" ? "employee-active-field" : "employee-type-field",
  ].join(" ");
  return yesNoToggle({
    className: classes,
    attrs: `data-id="${escapeHtml(employeeId)}" data-field="${escapeHtml(field)}"`,
    checked: yes(value),
    disabled: options.disabled,
  });
}

function employeeDebtInput(employee, type) {
  const queue = queueForEmployeeType(employee, type);
  if (!queue) return `<span class="muted" title="Для сотрудника не найдена строка очереди этого типа">—</span>`;
  const enabled = debtEnabledForType(type);
  const max = maxDebtForType(type);
  const value = Math.min(debtAmount(queue["Долг"]), max || Number.POSITIVE_INFINITY);
  return `
    <input
      class="inline-input employee-debt-field"
      type="number"
      min="0"
      step="1"
      ${max ? `max="${escapeHtml(max)}"` : ""}
      value="${escapeHtml(value)}"
      data-queue="${escapeHtml(queue.queue_id)}"
      data-employee="${escapeHtml(queue.employee_id)}"
      data-field="Долг"
      ${enabled ? "" : "disabled"}
      title="${enabled ? `Долг по типу нагрузки, максимум ${max}` : "Учёт долга для этого типа нагрузки выключен в настройках"}"
    />
  `;
}

function renderEmployees() {
  const employees = employeesForSelectedYuc();
  $("#employeesTable").innerHTML = employees.length ? employees.map((employee) => `
    <tr class="${employee["Активен"] === "Да" ? "" : "employee-inactive"}" data-employee-row="${escapeHtml(employee.employee_id)}">
      <td><strong title="${escapeHtml(employee["ФИО"])}">${escapeHtml(displayName(employee["ФИО"]))}</strong><div class="muted">${escapeHtml(employee.employee_id)}</div></td>
      <td>${employeeToggle(employee["Активен"], employee.employee_id, "Активен")}</td>
      <td>${employeeToggle(employee["Судебные"], employee.employee_id, "Судебные", { disabled: !yes(employee["Активен"]) })}</td>
      <td>${employeeDebtInput(employee, "судебное")}</td>
      <td>${employeeToggle(employee["Административные"], employee.employee_id, "Административные", { disabled: !yes(employee["Активен"]) })}</td>
      <td>${employeeDebtInput(employee, "административное")}</td>
      <td>${employeeToggle(employee["Претензии"], employee.employee_id, "Претензии", { disabled: !yes(employee["Активен"]) })}</td>
      <td>${employeeDebtInput(employee, "претензия")}</td>
      <td>${employee["Сейчас в отпуске"] === "Да" ? badge("отпуск", "orange") : badge("доступен", "green")}</td>
      <td>${employee["Активные всего"]}</td>
      <td><button class="tiny-btn save-employee" data-id="${employee.employee_id}">Сохранить</button></td>
    </tr>
  `).join("") : `<tr><td colspan="11" class="empty-cell">Сотрудники выбранного ЮЦ не найдены.</td></tr>`;
}

function resetEmployeeAvailabilityDrafts() {
  renderEmployees();
}

function refreshEmployeeAvailabilityRow(employeeId, activeValue) {
  const row = $(`tr[data-employee-row="${CSS.escape(employeeId)}"]`);
  if (!row) return;
  const inactive = !yes(activeValue);
  row.classList.toggle("employee-inactive", inactive);
  row.querySelectorAll(".employee-type-field").forEach((input) => {
    input.disabled = inactive;
    const label = input.closest(".toggle-inline");
    label?.classList.toggle("disabled", inactive);
  });
}

function selectedVacationEmployee() {
  const id = $("#vacationEmployeeSelect")?.value;
  const employees = employeesForSelectedYuc();
  return employees.find((employee) => employee.employee_id === id) ?? employees[0];
}

function selectedVacationYear() {
  return Number($("#vacationYearSelect")?.value) || new Date().getFullYear();
}

function dateISO(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateFromISO(iso) {
  const [year, month, day] = String(iso).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatRuDate(iso) {
  const [year, month, day] = String(iso).split("-");
  return `${day}.${month}.${year}`;
}

function formatRuDateDash(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return text;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function caseLinkInfo(value) {
  if (!value) return null;
  let link = value;
  if (typeof link === "string") {
    const text = link.trim();
    if (!text) return null;
    if (text.startsWith("{")) {
      try {
        link = JSON.parse(text);
      } catch {
        link = text;
      }
    } else {
      link = text;
    }
  }
  if (typeof link === "object") {
    const url = String(link.text || link.url || link.href || "").trim();
    if (!url) return null;
    return {
      url,
      title: String(link.title || "Открыть в CasePro").trim() || "Открыть в CasePro",
    };
  }
  const url = String(link).trim();
  return url ? { url, title: "Открыть в CasePro" } : null;
}

function addDaysISO(iso, days) {
  const date = dateFromISO(iso);
  date.setDate(date.getDate() + days);
  return dateISO(date.getFullYear(), date.getMonth(), date.getDate());
}

function eachDateInRange(start, end) {
  if (!start || !end) return [];
  let from = start <= end ? start : end;
  const to = start <= end ? end : start;
  const result = [];
  while (from <= to) {
    result.push(from);
    from = addDaysISO(from, 1);
  }
  return result;
}

function vacationDatesSet(employeeId, year) {
  const draft = state.vacationDrafts[vacationDraftKey(employeeId, year)];
  if (draft) return new Set(draft.dates);
  const dates = [];
  for (const row of state.data.vacations ?? []) {
    if (row.employee_id !== employeeId) continue;
    const start = row["Дата начала"] || row["Дата"];
    const end = row["Дата окончания"] || row["Дата"] || start;
    dates.push(...eachDateInRange(start, end).filter((date) => String(date).startsWith(`${year}-`)));
  }
  return new Set(dates);
}

function isEmployeeOnVacationDate(employee, isoDate) {
  if (!employee || !isoDate) return false;
  return (state.data?.vacations ?? []).some((row) => {
    const sameEmployee = row.employee_id
      ? row.employee_id === employee.employee_id
      : nameMatches(row["ФИО"] || row["Сотрудник"], employee["ФИО"]);
    if (!sameEmployee) return false;
    const start = row["Дата начала"] || row["Дата"];
    const end = row["Дата окончания"] || row["Дата"] || start;
    return Boolean(start && end && start <= isoDate && isoDate <= end);
  });
}

function vacationDraftKey(employeeId, year) {
  return `${employeeId}::${year}`;
}

function originalVacationDatesSet(employeeId, year) {
  const dates = [];
  for (const row of state.data.vacations ?? []) {
    if (row.employee_id !== employeeId) continue;
    const start = row["Дата начала"] || row["Дата"];
    const end = row["Дата окончания"] || row["Дата"] || start;
    dates.push(...eachDateInRange(start, end).filter((date) => String(date).startsWith(`${year}-`)));
  }
  return new Set(dates);
}

function ensureVacationDraft(employeeId, year) {
  const key = vacationDraftKey(employeeId, year);
  if (!state.vacationDrafts[key]) {
    state.vacationDrafts[key] = { employeeId, year, dates: [...originalVacationDatesSet(employeeId, year)] };
  }
  return state.vacationDrafts[key];
}

function vacationDraftChanged(employeeId, year) {
  return Boolean(state.vacationDrafts[vacationDraftKey(employeeId, year)]);
}

function discardVacationDraft(employeeId, year) {
  delete state.vacationDrafts[vacationDraftKey(employeeId, year)];
}

function vacationPeriods(dates) {
  const sorted = [...dates].sort();
  const periods = [];
  let start = null;
  let prev = null;
  for (const day of sorted) {
    if (!start) {
      start = day;
      prev = day;
      continue;
    }
    if (addDaysISO(prev, 1) === day) {
      prev = day;
      continue;
    }
    periods.push([start, prev]);
    start = day;
    prev = day;
  }
  if (start) periods.push([start, prev]);
  return periods;
}

function renderVacationSelectors() {
  const employeeSelect = $("#vacationEmployeeSelect");
  const yearSelect = $("#vacationYearSelect");
  if (!employeeSelect || !yearSelect) return;
  const employees = employeesForSelectedYuc();
  const currentEmployee = employeeSelect.value || employees[0]?.employee_id || "";
  employeeSelect.innerHTML = employees
    .map((employee) => `<option value="${escapeHtml(employee.employee_id)}">${escapeHtml(displayName(employee["ФИО"]))}</option>`)
    .join("");
  employeeSelect.value = employees.some((employee) => employee.employee_id === currentEmployee)
    ? currentEmployee
    : employees[0]?.employee_id ?? "";

  const currentYear = selectedVacationYear();
  const base = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, index) => base - 1 + index);
  yearSelect.innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join("");
  yearSelect.value = years.includes(currentYear) ? currentYear : base;
}

function renderVacationCalendar() {
  const employee = selectedVacationEmployee();
  if (!employee) {
    $("#yearCalendar").innerHTML = `<div class="empty-cell">Сотрудники выбранного ЮЦ не найдены.</div>`;
    $("#vacationSummaryName").textContent = `${selectedYuc()} · нет сотрудников`;
    $("#vacationDaysCount").textContent = "0";
    $("#vacationPeriods").innerHTML = `<div class="muted">Выберите другой ЮЦ.</div>`;
    return;
  }
  const year = selectedVacationYear();
  const vacationDays = vacationDatesSet(employee.employee_id, year);
  const hasDraft = vacationDraftChanged(employee.employee_id, year);
  const todayIso = today();
  const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  const weekDays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  $("#yearCalendar").innerHTML = monthNames.map((monthName, monthIndex) => {
    const first = new Date(year, monthIndex, 1);
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    const blanks = Array.from({ length: offset }, () => `<div class="day-cell empty"></div>`).join("");
    const days = Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const iso = dateISO(year, monthIndex, day);
      const jsDate = new Date(year, monthIndex, day);
      const weekend = [0, 6].includes(jsDate.getDay());
      const classes = [
        "day-cell",
        weekend ? "weekend" : "",
        vacationDays.has(iso) ? "vacation" : "",
        iso === todayIso ? "today" : "",
        state.vacationRangeStart === iso ? "range-start" : "",
      ].filter(Boolean).join(" ");
      return `<button class="${classes}" data-date="${iso}" title="${formatRuDate(iso)}">${day}</button>`;
    }).join("");
    return `
      <section class="month-card">
        <h4>${monthName}</h4>
        <div class="month-grid weekdays">${weekDays.map((day) => `<span>${day}</span>`).join("")}</div>
        <div class="month-grid">${blanks}${days}</div>
      </section>
    `;
  }).join("");

  $("#vacationSummaryName").textContent = `${displayName(employee["ФИО"])} · ${year}`;
  $("#vacationDaysCount").textContent = vacationDays.size;
  const periods = vacationPeriods(vacationDays);
  $("#vacationPeriods").innerHTML = periods.length
    ? `<h4>Периоды</h4>${periods.map(([start, end]) => `<div class="period-row">${formatRuDate(start)}${start === end ? "" : ` — ${formatRuDate(end)}`}</div>`).join("")}`
    : `<div class="muted">Отпусков в выбранном году пока нет.</div>`;
  $("#vacationWarning").classList.toggle("editing", state.vacationEdit);
  $("#vacationWarning").classList.toggle("has-draft", hasDraft);
  $("#vacationWarning").textContent = state.vacationEdit
    ? hasDraft
      ? "Есть несохраненные изменения. Нажмите «Сохранить», чтобы записать график отпусков в MTS Tabs."
      : "Редактирование включено. Клики по календарю меняют черновик; запись в MTS Tabs произойдет только после кнопки «Сохранить»."
    : "Редактирование выключено. Чтобы менять отпуск, включите тумблер; изменения будут сохраняться только после кнопки «Сохранить».";
  $("#saveVacationYearBtn").disabled = !hasDraft;
  $("#cancelVacationDraftBtn").disabled = !hasDraft;
}

function closeVacationImportModal() {
  $("#vacationImportModal")?.classList.remove("show");
  $("#vacationImportModal")?.setAttribute("aria-hidden", "true");
}

function importDateRangeText(plan) {
  if (!plan?.firstDate || !plan?.lastDate) return "—";
  return plan.firstDate === plan.lastDate
    ? formatRuDate(plan.firstDate)
    : `${formatRuDate(plan.firstDate)} — ${formatRuDate(plan.lastDate)}`;
}

function renderVacationImportModal() {
  const plan = state.vacationImportPlan;
  const content = $("#vacationImportContent");
  const applyButton = $("#vacationImportApplyBtn");
  if (!content || !applyButton || !plan) return;
  const hasWarnings = Boolean(plan.unmatched?.length || plan.ambiguous?.length || plan.invalidCells?.length);
  applyButton.disabled = !(plan.matched?.length);
  content.innerHTML = `
    <p class="muted">
      Будет заменён график отпусков в пределах дат из файла только для сотрудников, которые успешно сопоставлены.
      Совпадение по фамилии и имени считается достаточным, если отчество отсутствует в одном из представлений.
    </p>
    <div class="import-summary-grid">
      <div class="import-summary-card"><span>Лист</span><strong>${escapeHtml(plan.sheetName || "—")}</strong></div>
      <div class="import-summary-card"><span>Период</span><strong>${escapeHtml(importDateRangeText(plan))}</strong></div>
      <div class="import-summary-card"><span>Сотрудников найдено</span><strong>${plan.stats?.matchedEmployees ?? 0}</strong></div>
      <div class="import-summary-card"><span>Дней отпуска</span><strong>${plan.stats?.vacationDays ?? 0}</strong></div>
    </div>
    ${hasWarnings ? `
      <div class="import-warning">
        Есть строки, которые не будут импортированы автоматически. Проверьте список ниже.
      </div>
    ` : ""}
    <h3>Будут импортированы</h3>
    <ul class="import-list">
      ${(plan.matched ?? []).slice(0, 12).map((item) => `
        <li>
          ${escapeHtml(item.sourceName)} → ${escapeHtml(displayName(item.employeeName))}
          <span class="muted">· ${item.vacationDays} дн. · ${item.matchBy === "surname-name" ? "совпали фамилия и имя" : "полное совпадение"}</span>
        </li>
      `).join("") || `<li>Нет сопоставленных сотрудников.</li>`}
      ${(plan.matched ?? []).length > 12 ? `<li>…и ещё ${(plan.matched ?? []).length - 12}</li>` : ""}
    </ul>
    ${(plan.unmatched ?? []).length ? `
      <h3>Не найдены</h3>
      <ul class="import-list">
        ${plan.unmatched.map((item) => `<li>Строка ${item.rowNumber}: ${escapeHtml(item.sourceName)} <span class="muted">· ${item.vacationDays} дн.</span></li>`).join("")}
      </ul>
    ` : ""}
    ${(plan.ambiguous ?? []).length ? `
      <h3>Нужно уточнение</h3>
      <ul class="import-list">
        ${plan.ambiguous.map((item) => `
          <li>
            Строка ${item.rowNumber}: ${escapeHtml(item.sourceName)}
            <span class="muted">· найдено несколько сотрудников: ${item.candidates.map((candidate) => escapeHtml(displayName(candidate.employeeName))).join(", ")}</span>
          </li>
        `).join("")}
      </ul>
    ` : ""}
    ${plan.stats?.invalidCells ? `
      <div class="import-warning">
        В файле есть ячейки не со значением 0 или 1: ${plan.stats.invalidCells}. Они будут считаться рабочими днями.
      </div>
    ` : ""}
  `;
  $("#vacationImportModal")?.classList.add("show");
  $("#vacationImportModal")?.setAttribute("aria-hidden", "false");
}

async function previewVacationImport(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    toast("Выберите файл Excel в формате .xlsx.", "error");
    return;
  }
  setStatus("Читаю график отпусков…");
  const payload = await uploadVacationWorkbook(file);
  state.vacationImportPlan = payload.plan;
  renderVacationImportModal();
  setStatus("Готово");
}

async function applyVacationImport() {
  if (!state.vacationImportPlan) return;
  setStatus("Загружаю отпуска в MTS Tabs…");
  const payload = await api("/api/vacations/import-apply", {
    method: "POST",
    body: JSON.stringify({ plan: state.vacationImportPlan }),
  });
  const importedYear = state.vacationImportPlan.year;
  setDataFromPayload(payload);
  state.vacationImportPlan = null;
  state.vacationDrafts = {};
  closeVacationImportModal();
  if (importedYear && $("#vacationYearSelect")) {
    $("#vacationYearSelect").value = String(importedYear);
  }
  renderVacationCalendar();
  toast(`График отпусков загружен: ${payload.result?.vacationDays ?? 0} дн.`);
  setStatus("Готово");
}

function renderVacations() {
  renderVacationSelectors();
  renderVacationCalendar();
}

function selectedYucRegions() {
  return state.data?.directories?.regionsByYuc?.[selectedYuc()] ?? [];
}

function optionList(options, current) {
  const values = [...new Set([current, ...options].filter(Boolean))];
  return values.map((value) => `<option value="${escapeHtml(value)}" ${value === current ? "selected" : ""}>${escapeHtml(value)}</option>`).join("");
}

function settingsEmployeeOptions(current) {
  return optionList(employeesForSelectedYuc().map((employee) => employee["ФИО"]), current);
}

function settingsRegionOptions(current) {
  return optionList(selectedYucRegions(), current);
}

function workloadTypeOptions(current) {
  return optionList(workloadTypes, current || "все");
}

function renderDeadlineSettings() {
  const table = $("#deadlineSettingsTable");
  if (!table) return;
  table.innerHTML = deadlineSettingsForSelectedYuc().map((row) => `
    <tr data-deadline-type="${escapeHtml(row["Тип дела"])}">
      <td>${escapeHtml(row["Тип дела"])}</td>
      <td><input class="deadline-input deadline-setting-field" type="number" min="1" step="1" data-field="Активность, дни" value="${escapeHtml(row["Активность, дни"])}" /></td>
      <td><input class="deadline-input deadline-setting-field" type="number" min="1" step="1" data-field="Автозавершение, дни" value="${escapeHtml(row["Автозавершение, дни"])}" /></td>
      <td>${yesNoToggle({
        className: "deadline-setting-field",
        attrs: `data-field="Учитывать долг"`,
        checked: yes(row["Учитывать долг"]),
      })}</td>
      <td><input class="deadline-input deadline-setting-field" type="number" min="0" step="1" data-field="Максимальный долг" value="${escapeHtml(row["Максимальный долг"])}" /></td>
    </tr>
  `).join("");
}

function renderYucSettingsForm() {
  const form = $("#yucSettingsForm");
  if (!form) return;
  const settings = yucSettingsForSelectedYuc();
  form.elements["Учитывать неактивные незавершенные в нагрузке"].checked = yes(settings["Учитывать неактивные незавершенные в нагрузке"]);
  form.elements["Региональные очереди вкл\\выкл"].checked = yes(settings["Региональные очереди вкл\\выкл"]);
  form.elements["Порог перегруза"].value = settings["Порог перегруза"] || 5;
  form.elements["Считать перегруз по"].value = settings["Считать перегруз по"] || "общая нагрузка";
  form.elements["Автоназначение вне региона вкл/выкл"].checked = yes(settings["Автоназначение вне региона вкл/выкл"]);
  form.elements["Регион не настроен"].value = settings["Регион не настроен"] || "общая очередь";
  form.elements["Региональные юристы недоступны"].value = settings["Региональные юристы недоступны"] || "заместитель затем общая очередь";
  updateRegionalSettingsAvailability();
}

function updateRegionalSettingsAvailability() {
  const form = $("#yucSettingsForm");
  const enabled = Boolean(form?.elements["Региональные очереди вкл\\выкл"]?.checked);
  const panel = $("#regionalSettingsPanel");
  const note = $("#regionalSettingsNote");
  panel?.classList.toggle("is-disabled", !enabled);
  note?.classList.toggle("hidden", enabled);
  panel?.querySelectorAll("input, select, textarea, button").forEach((control) => {
    control.disabled = !enabled;
  });
  const addAssignment = $("#addRegionalAssignmentBtn");
  const addSubstitution = $("#addRegionalSubstitutionBtn");
  if (addAssignment) addAssignment.disabled = !enabled;
  if (addSubstitution) addSubstitution.disabled = !enabled;
  $$(".regional-assignment-field, .regional-substitution-field, .save-regional-assignment, .delete-regional-assignment, .save-regional-substitution, .delete-regional-substitution").forEach((control) => {
    control.disabled = !enabled;
    control.closest(".toggle-inline")?.classList.toggle("disabled", !enabled);
  });
}

function regionalAssignmentRow(row = {}, index = -1, isNew = false) {
  return `
    <tr data-regional-assignment-index="${index}" data-new="${isNew ? "1" : "0"}">
      <td><select class="inline-select regional-assignment-field" data-field="Регион">${settingsRegionOptions(row["Регион"])}</select></td>
      <td><select class="inline-select regional-assignment-field" data-field="Сотрудник">${settingsEmployeeOptions(row["Сотрудник"])}</select></td>
      <td><select class="inline-select regional-assignment-field" data-field="Тип нагрузки">${workloadTypeOptions(row["Тип нагрузки"])}</select></td>
      <td>${yesNoToggle({
        className: "regional-assignment-field",
        attrs: `data-field="Активно"`,
        checked: row["Активно"] ? yes(row["Активно"]) : true,
      })}</td>
      <td>
        <div class="case-actions">
          <button class="icon-btn confirm save-regional-assignment" title="Сохранить закрепление">✓</button>
          <button class="icon-btn cancel ${isNew ? "cancel-new-regional-assignment" : "delete-regional-assignment"}" title="${isNew ? "Отменить" : "Удалить"}">${isNew ? "×" : "🗑"}</button>
        </div>
      </td>
    </tr>
  `;
}

function regionalSubstitutionRow(row = {}, index = -1, isNew = false) {
  return `
    <tr data-regional-substitution-index="${index}" data-new="${isNew ? "1" : "0"}">
      <td><select class="inline-select regional-substitution-field" data-field="Регион">${settingsRegionOptions(row["Регион"])}</select></td>
      <td><select class="inline-select regional-substitution-field" data-field="Основной сотрудник">${settingsEmployeeOptions(row["Основной сотрудник"])}</select></td>
      <td><select class="inline-select regional-substitution-field" data-field="Замещающий сотрудник">${settingsEmployeeOptions(row["Замещающий сотрудник"])}</select></td>
      <td><select class="inline-select regional-substitution-field" data-field="Тип нагрузки">${workloadTypeOptions(row["Тип нагрузки"])}</select></td>
      <td>${yesNoToggle({
        className: "regional-substitution-field",
        attrs: `data-field="Активно"`,
        checked: row["Активно"] ? yes(row["Активно"]) : true,
      })}</td>
      <td><input class="inline-input regional-substitution-field" data-field="Комментарий" value="${escapeHtml(row["Комментарий"] ?? "")}" placeholder="Комментарий" /></td>
      <td>
        <div class="case-actions">
          <button class="icon-btn confirm save-regional-substitution" title="Сохранить замещение">✓</button>
          <button class="icon-btn cancel ${isNew ? "cancel-new-regional-substitution" : "delete-regional-substitution"}" title="${isNew ? "Отменить" : "Удалить"}">${isNew ? "×" : "🗑"}</button>
        </div>
      </td>
    </tr>
  `;
}

function renderRegionalAssignments() {
  const rows = regionalAssignmentsForSelectedYuc();
  const html = rows.map((row, index) => regionalAssignmentRow(row, index, false)).join("");
  const draft = state.assignmentDraftOpen ? regionalAssignmentRow({
    "ЮЦ": selectedYuc(),
    "Регион": selectedYucRegions()[0] ?? "",
    "Сотрудник": employeesForSelectedYuc()[0]?.["ФИО"] ?? "",
    "Тип нагрузки": "все",
    "Активно": "Да",
  }, -1, true) : "";
  $("#regionalAssignmentsTable").innerHTML = html || draft
    ? `${draft}${html}`
    : `<tr><td colspan="5" class="empty-cell">Закрепления выбранного ЮЦ пока не настроены.</td></tr>`;
}

function renderRegionalSubstitutions() {
  const rows = regionalSubstitutionsForSelectedYuc();
  const html = rows.map((row, index) => regionalSubstitutionRow(row, index, false)).join("");
  const firstEmployee = employeesForSelectedYuc()[0]?.["ФИО"] ?? "";
  const secondEmployee = employeesForSelectedYuc()[1]?.["ФИО"] ?? firstEmployee;
  const draft = state.substitutionDraftOpen ? regionalSubstitutionRow({
    "ЮЦ": selectedYuc(),
    "Регион": selectedYucRegions()[0] ?? "",
    "Основной сотрудник": firstEmployee,
    "Замещающий сотрудник": secondEmployee,
    "Тип нагрузки": "все",
    "Активно": "Да",
    "Комментарий": "",
  }, -1, true) : "";
  $("#regionalSubstitutionsTable").innerHTML = html || draft
    ? `${draft}${html}`
    : `<tr><td colspan="7" class="empty-cell">Замещения выбранного ЮЦ пока не настроены.</td></tr>`;
}

function renderSettings() {
  renderDeadlineSettings();
  renderYucSettingsForm();
  renderRegionalAssignments();
  renderRegionalSubstitutions();
  updateRegionalSettingsAvailability();
}

function renderJournal() {
  if (state.journalLoading) {
    $("#journalTable").innerHTML = `<tr><td colspan="7" class="empty-cell">Журнал загружается из MTS Tabs…</td></tr>`;
    return;
  }
  if (!state.journalLoaded) {
    $("#journalTable").innerHTML = `<tr><td colspan="7" class="empty-cell">Откройте вкладку «Журнал», чтобы загрузить события из MTS Tabs.</td></tr>`;
    return;
  }
  const rows = journalRowsForSelectedYuc().slice().reverse().slice(0, 250);
  $("#journalTable").innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td>${escapeHtml(row["Дата события"])}</td>
      <td>${escapeHtml(row.case_id)}</td>
      <td>${escapeHtml(row["Тип дела"])}</td>
      <td title="${escapeHtml(row["Ответственный"] || "")}">${escapeHtml(displayName(row["Ответственный"]))}</td>
      <td>${badge(row["Способ"], row["Способ"] === "ручное" ? "orange" : row["Способ"] === "авто" ? "green" : "gray")}</td>
      <td>${escapeHtml(row["Основание"])}</td>
      <td><div class="cell-main">${escapeHtml(row["Комментарий"])}</div></td>
    </tr>
  `).join("") : `<tr><td colspan="7" class="empty-cell">События выбранного ЮЦ не найдены.</td></tr>`;
}

function renderAll() {
  if (!state.data) return;
  renderYucTabs();
  renderSummary();
  renderCompletionControl();
  renderWorkloadDashboard();
  renderYucRegionSelects();
  renderCases();
  renderEmployees();
  renderVacations();
  renderSettings();
  renderJournal();
}

function formDraft() {
  const form = $("#caseForm");
  const draft = {};
  new FormData(form).forEach((value, key) => {
    draft[key] = value;
  });
  draft["ЮЦ"] = selectedYuc();
  return draft;
}

function currentQueueEmployeeNames() {
  return (state.lastRecommendation?.queuePreview?.rows ?? [])
    .map((row) => row.name)
    .filter(Boolean);
}

function manualAssignableEmployees(draft = formDraft(), options = {}) {
  const type = draft["Тип дела"];
  const date = draft["Дата поступления"] || today();
  const excludedNames = options.excludeCurrentQueue ? currentQueueEmployeeNames() : [];
  return employeesForSelectedYuc()
    .filter((employee) =>
      yes(employee["Активен"]) &&
      employeeParticipatesInCaseType(employee, type) &&
      !isEmployeeOnVacationDate(employee, date) &&
      !excludedNames.some((name) => nameMatches(name, employee["ФИО"]))
    )
    .sort((a, b) => displayName(a["ФИО"]).localeCompare(displayName(b["ФИО"]), "ru"));
}

function updateThirdPartyVisibility() {
  const form = $("#caseForm");
  const type = form.elements["Тип дела"]?.value;
  const field = $("#thirdPartyField");
  const grid = $("#partyGrid");
  const input = form.elements["Третье лицо"];
  const visible = type === "судебное";
  field?.classList.toggle("hidden", !visible);
  grid?.classList.toggle("has-third-party", visible);
  if (!visible && input) input.value = "";
}

function queueMarkerKind(marker) {
  if (marker === "кандидат") return "green";
  if (marker === "неактивен" || marker === "нет в сотрудниках" || marker === "не участвует") return "gray";
  if (marker === "отпуск") return "orange";
  if (String(marker).startsWith("долг")) return "blue";
  if (marker === "предыдущий") return "red";
  return "gray";
}

function queueRowHtml(row) {
  const markers = (row.markers ?? []).map((marker) => badge(marker, queueMarkerKind(marker))).join("");
  const action = row.recommended
    ? `<button class="btn btn-primary queue-row-action queue-assign-auto" type="button">Назначить</button>`
    : row.available
      ? `<button class="btn btn-secondary queue-row-action queue-assign-manual" type="button" data-name="${escapeHtml(row.name)}">Вне очереди</button>`
      : "";
  return `
    <div class="queue-preview-row ${row.phase === "passed" ? "is-passed" : ""} ${row.recommended ? "is-recommended" : ""} ${!row.available ? "is-unavailable" : ""}">
      <div class="queue-preview-position">${row.position || "—"}</div>
      <div class="queue-preview-person">
        <div class="queue-preview-name">${escapeHtml(displayName(row.name))}</div>
        <div class="queue-preview-details">
          <span>нагрузка типа: ${Number(row.load) || 0}</span>
          ${row.phase === "passed" && !row.recommended ? "<span>прошел в цикле</span>" : ""}
        </div>
      </div>
      <div class="queue-preview-markers">${markers || badge(row.available ? "доступен" : "недоступен", row.available ? "green" : "gray")}</div>
      <div class="queue-preview-action">${action}</div>
    </div>
  `;
}

function queueSectionHtml(title, rows) {
  if (!rows.length) return "";
  return `
    <section class="queue-preview-section">
      <h3>${escapeHtml(title)}</h3>
      <div class="queue-preview-list">${rows.map(queueRowHtml).join("")}</div>
    </section>
  `;
}

function manualAssignAnyButtonHtml() {
  return `
    <div class="queue-preview-manual">
      <button class="btn btn-secondary queue-assign-manual-all" type="button">Назначить вне очереди</button>
      <span>Ручной выбор доступного сотрудника вне показанной очереди.</span>
    </div>
  `;
}

function renderQueuePreview(preview) {
  const node = $("#queuePreview");
  if (!node) return;
  if (!preview) {
    node.innerHTML = `<div class="queue-preview-empty">Выберите тип нагрузки, чтобы увидеть очередь назначения.</div>`;
    return;
  }
  if (!preview.rows?.length) {
    node.innerHTML = `
      <div class="queue-preview-head">
        <div>
          <h3>${escapeHtml(preview.title || "Очередь назначения")}</h3>
          <p>${escapeHtml(preview.note || "Очередь пока не настроена.")}</p>
        </div>
      </div>
      <div class="queue-preview-empty">Для этого ЮЦ и типа нагрузки нет строк очереди.</div>
      ${manualAssignAnyButtonHtml()}
    `;
    return;
  }
  const displayRows = preview.rows.map((row) => row.recommended ? { ...row, phase: "next" } : row);
  const passed = displayRows.filter((row) => row.phase === "passed");
  const next = displayRows.filter((row) => row.phase !== "passed");
  node.innerHTML = `
    <div class="queue-preview-head">
      <div>
        <h3>${escapeHtml(preview.title || "Очередь назначения")}</h3>
        <p>${escapeHtml(preview.note || "")}</p>
      </div>
      <div class="queue-preview-state">
        <span>цикл ${Number(preview.cycle) || 1}</span>
        <span>посл. позиция ${Number(preview.lastPosition) || 0}</span>
      </div>
    </div>
    ${queueSectionHtml("Уже прошли", passed)}
    ${queueSectionHtml("Следующие", next)}
    ${manualAssignAnyButtonHtml()}
  `;
}

function activeRuleItems(result) {
  const items = [{ text: "не два подряд", kind: "red" }];
  if (!result || result.pending) return items;
  const preview = result.queuePreview;
  const mode = preview?.mode;
  if (mode === "regional") items.push({ text: "региональная очередь", kind: "blue" });
  if (mode === "substitution") items.push({ text: "замещение", kind: "orange" });
  if (mode === "outside-region") items.push({ text: "вне региона по перегрузу", kind: "orange" });
  if (mode === "general") items.push({ text: "общая очередь", kind: "gray" });
  const basis = String(result.basis ?? "").toLowerCase();
  if (basis.includes("долг")) items.push({ text: "погашение долга", kind: "blue" });
  if (basis.includes("не два подряд") && basis.includes("не применяется")) items.push({ text: "не два подряд не применяется", kind: "orange" });
  if (basis.includes("повтор допускается")) items.push({ text: "повтор разрешён регионом", kind: "orange" });
  if ((result.skippedVacation ?? []).length) items.push({ text: "учтены отпуска", kind: "orange" });
  return items;
}

function renderDistributionRuleBadges(result = state.lastRecommendation) {
  const node = $("#distributionRuleBadges");
  if (!node) return;
  const seen = new Set();
  node.innerHTML = activeRuleItems(result)
    .filter((item) => {
      if (seen.has(item.text)) return false;
      seen.add(item.text);
      return true;
    })
    .map((item) => badge(item.text, item.kind))
    .join("");
}

function invalidateRecommendation(message) {
  showRecommendation({
    ok: false,
    reason: message,
  });
  state.lastRecommendation = null;
}

function showRecommendation(result) {
  state.lastRecommendation = result;
  renderDistributionRuleBadges(result);
  const badgeNode = $("#recommendationBadge");
  const personNode = $("#recommendationPerson");
  const metaNode = $("#recommendationMeta");
  if (result.pending) {
    badgeNode.className = "badge badge-gray";
    badgeNode.textContent = "ожидает типа";
    personNode.textContent = "—";
    personNode.title = "";
    metaNode.textContent = result.reason;
    renderQueuePreview(null);
    return;
  }
  if (result.ok) {
    badgeNode.className = "badge badge-green";
    badgeNode.textContent = "можно автоназначить";
    personNode.textContent = "Выбран системой";
    personNode.title = result.candidate;
    metaNode.textContent = `Основание: ${result.basis}. Позиция в очереди: ${result.position}.`;
  } else {
    badgeNode.className = "badge badge-orange";
    badgeNode.textContent = "нужно решение";
    personNode.textContent = "—";
    metaNode.textContent = result.reason;
  }
  renderQueuePreview(result.queuePreview);
}

function validateDraftForAssignment(draft) {
  const form = $("#caseForm");
  if (!form.reportValidity()) return false;
  if (!draft["Тип дела"] || !draft["Предмет"]) {
    toast("Заполните тип дела и предмет.", "error");
    return false;
  }
  return true;
}

async function recommendCurrent(options = {}) {
  const draft = formDraft();
  if (!draft["Тип дела"]) {
    showRecommendation({
      ok: false,
      pending: true,
      reason: "Выберите тип дела — система сразу рассчитает следующего ответственного.",
    });
    if (!options.silent) toast("Выберите тип дела.", "error");
    return null;
  }
  const requestId = (state.recommendationRequestId ?? 0) + 1;
  state.recommendationRequestId = requestId;
  const payload = await api("/api/recommend", {
    method: "POST",
    body: JSON.stringify({ draft }),
  });
  if (requestId !== state.recommendationRequestId) return null;
  showRecommendation(payload.result);
  return payload.result;
}

function scheduleRecommendation() {
  state.recommendationRequestId = (state.recommendationRequestId ?? 0) + 1;
  clearTimeout(state.recommendationTimer);
  state.recommendationTimer = setTimeout(() => {
    recommendCurrent({ silent: true }).catch((error) => {
      setStatus("Ошибка");
      toast(error.message, "error");
    });
  }, 220);
}

function handleCaseFormRecommendationChange(event) {
  const fieldName = event.target?.name;
  if (fieldName === "Тип дела") updateThirdPartyVisibility();
  if (!["Тип дела", "Регион", "Дата поступления"].includes(fieldName)) return;
  state.lastRecommendation = null;
  scheduleRecommendation();
}

function resetDistributionForm(message) {
  $("#caseForm").reset();
  updateThirdPartyVisibility();
  renderYucRegionSelects();
  $("#caseForm").elements["Дата поступления"].value = today();
  showRecommendation({
    ok: false,
    pending: true,
    reason: message ?? "Выберите тип дела — система сразу рассчитает следующего ответственного.",
  });
}

async function autoAssign() {
  const draft = formDraft();
  if (!validateDraftForAssignment(draft)) return;
  const result = await recommendCurrent();
  if (!result) return;
  if (!result.ok) {
    toast("Автоназначение остановлено: нужен ручной выбор руководителя.", "error");
    return;
  }
  setStatus("Сохраняю в MTS Tabs…");
  const payload = await api("/api/assign-auto", {
    method: "POST",
    body: JSON.stringify({ draft }),
  });
  setDataFromPayload(payload);
  resetDistributionForm("Выберите тип следующего дела — система сразу рассчитает ответственного.");
  setStatus("Сохранено");
  toast(`Дело ${payload.case.case_id} назначено: ${displayName(payload.case["Ответственный"])}`);
}

async function manualAssignTo(responsible, comment) {
  const draft = formDraft();
  if (!validateDraftForAssignment(draft)) return false;
  if (!responsible || !comment.trim()) {
    toast("Для ручного назначения нужен ответственный и комментарий.", "error");
    return false;
  }
  setStatus("Сохраняю в MTS Tabs…");
  const payload = await api("/api/assign-manual", {
    method: "POST",
    body: JSON.stringify({ draft, responsible, comment }),
  });
  setDataFromPayload(payload);
  resetDistributionForm("Ручное назначение сохранено. Выберите тип следующего дела.");
  setStatus("Сохранено");
  toast(`Дело ${payload.case.case_id} назначено вручную: ${displayName(payload.case["Ответственный"])}`);
  return true;
}

async function saveEmployee(employeeId) {
  const patch = {};
  $$(`.employee-field[data-id="${CSS.escape(employeeId)}"]`).forEach((input) => {
    patch[input.dataset.field] = input.type === "checkbox" ? yesNo(input.checked ? "Да" : "Нет") : input.value;
  });
  setStatus("Сохраняю сотрудника…");
  let payload = await api(`/api/employees/${encodeURIComponent(employeeId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  const debtToggles = $$(`tr[data-employee-row="${CSS.escape(employeeId)}"] .employee-debt-field`);
  for (const input of debtToggles) {
    if (input.disabled) continue;
    const max = Number(input.max) || Number.POSITIVE_INFINITY;
    const value = Math.max(0, Math.min(max, Math.floor(Number(input.value) || 0)));
    payload = await api(`/api/queues/${encodeURIComponent(input.dataset.queue)}/${encodeURIComponent(input.dataset.employee)}`, {
      method: "PATCH",
      body: JSON.stringify({ [input.dataset.field]: value }),
    });
  }
  setDataFromPayload(payload);
  state.lastRecommendation = null;
  scheduleRecommendation();
  setStatus("Сохранено");
  toast("Данные сотрудника и долги сохранены.");
}

function formYesNo(form, name) {
  return form.elements[name]?.checked ? "Да" : "Нет";
}

async function saveYucSettings() {
  const form = $("#yucSettingsForm");
  const payloadBody = {
    "Учитывать неактивные незавершенные в нагрузке": formYesNo(form, "Учитывать неактивные незавершенные в нагрузке"),
    "Региональные очереди вкл\\выкл": formYesNo(form, "Региональные очереди вкл\\выкл"),
    "Порог перегруза": form.elements["Порог перегруза"].value,
    "Считать перегруз по": form.elements["Считать перегруз по"].value,
    "Автоназначение вне региона вкл/выкл": formYesNo(form, "Автоназначение вне региона вкл/выкл"),
    "Регион не настроен": form.elements["Регион не настроен"].value,
    "Региональные юристы недоступны": form.elements["Региональные юристы недоступны"].value,
  };
  setStatus("Сохраняю настройки ЮЦ…");
  const payload = await api(`/api/yuc-settings/${encodeURIComponent(selectedYuc())}`, {
    method: "PATCH",
    body: JSON.stringify(payloadBody),
  });
  setDataFromPayload(payload);
  state.lastRecommendation = null;
  scheduleRecommendation();
  setStatus("Сохранено");
  toast("Настройки ЮЦ сохранены.");
}

async function saveDeadlineSettings() {
  const rows = $$("tr[data-deadline-type]").map((tr) => {
    const row = {
      "ЮЦ": selectedYuc(),
      "Тип дела": tr.dataset.deadlineType,
    };
    tr.querySelectorAll(".deadline-setting-field").forEach((input) => {
      row[input.dataset.field] = input.type === "checkbox" ? (input.checked ? "Да" : "Нет") : Number(input.value);
    });
    return row;
  });
  setStatus("Сохраняю сроки…");
  const payload = await api("/api/deadline-settings", {
    method: "POST",
    body: JSON.stringify({ yuc: selectedYuc(), rows }),
  });
  setDataFromPayload(payload);
  setStatus("Сохранено");
  toast("Сроки по типам нагрузки сохранены.");
}

function rowFieldValue(input) {
  if (input.type === "checkbox") return input.checked ? "Да" : "Нет";
  return input.value;
}

function collectRegionalRow(tr, fieldSelector) {
  const row = { "ЮЦ": selectedYuc() };
  tr.querySelectorAll(fieldSelector).forEach((input) => {
    row[input.dataset.field] = rowFieldValue(input);
  });
  return row;
}

async function saveRegionalAssignment(button) {
  if (!regionalQueuesCurrentlyEnabled()) {
    toast("Сначала включите региональные очереди для выбранного ЮЦ.", "error");
    return;
  }
  const tr = button.closest("tr");
  const index = Number(tr.dataset.regionalAssignmentIndex);
  const original = index >= 0 ? regionalAssignmentsForSelectedYuc()[index] : null;
  const row = collectRegionalRow(tr, ".regional-assignment-field");
  setStatus("Сохраняю закрепление…");
  const payload = await api("/api/regional-assignments/upsert", {
    method: "POST",
    body: JSON.stringify({ yuc: selectedYuc(), original, row }),
  });
  state.assignmentDraftOpen = false;
  setDataFromPayload(payload);
  setStatus("Сохранено");
  toast("Региональное закрепление сохранено.");
}

async function deleteRegionalAssignment(button) {
  if (!regionalQueuesCurrentlyEnabled()) {
    toast("Сначала включите региональные очереди для выбранного ЮЦ.", "error");
    return;
  }
  const tr = button.closest("tr");
  const index = Number(tr.dataset.regionalAssignmentIndex);
  const row = regionalAssignmentsForSelectedYuc()[index];
  if (!row) return;
  const confirmed = window.confirm("Удалить региональное закрепление?");
  if (!confirmed) return;
  setStatus("Удаляю закрепление…");
  const payload = await api("/api/regional-assignments/delete", {
    method: "POST",
    body: JSON.stringify({ yuc: selectedYuc(), row }),
  });
  setDataFromPayload(payload);
  setStatus("Сохранено");
  toast("Региональное закрепление удалено.");
}

async function saveRegionalSubstitution(button) {
  if (!regionalQueuesCurrentlyEnabled()) {
    toast("Сначала включите региональные очереди для выбранного ЮЦ.", "error");
    return;
  }
  const tr = button.closest("tr");
  const index = Number(tr.dataset.regionalSubstitutionIndex);
  const original = index >= 0 ? regionalSubstitutionsForSelectedYuc()[index] : null;
  const row = collectRegionalRow(tr, ".regional-substitution-field");
  setStatus("Сохраняю замещение…");
  const payload = await api("/api/regional-substitutions/upsert", {
    method: "POST",
    body: JSON.stringify({ yuc: selectedYuc(), original, row }),
  });
  state.substitutionDraftOpen = false;
  setDataFromPayload(payload);
  setStatus("Сохранено");
  toast("Региональное замещение сохранено.");
}

async function deleteRegionalSubstitution(button) {
  if (!regionalQueuesCurrentlyEnabled()) {
    toast("Сначала включите региональные очереди для выбранного ЮЦ.", "error");
    return;
  }
  const tr = button.closest("tr");
  const index = Number(tr.dataset.regionalSubstitutionIndex);
  const row = regionalSubstitutionsForSelectedYuc()[index];
  if (!row) return;
  const confirmed = window.confirm("Удалить региональное замещение?");
  if (!confirmed) return;
  setStatus("Удаляю замещение…");
  const payload = await api("/api/regional-substitutions/delete", {
    method: "POST",
    body: JSON.stringify({ yuc: selectedYuc(), row }),
  });
  setDataFromPayload(payload);
  setStatus("Сохранено");
  toast("Региональное замещение удалено.");
}

async function saveCaseStatus(caseId, status) {
  setStatus("Сохраняю статус…");
  const patch = { "Статус": status };
  if (["Завершено", "Отменено"].includes(status)) {
    patch["Дата завершения"] = today();
  }
  const payload = await api(`/api/cases/${encodeURIComponent(caseId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  setDataFromPayload(payload);
  setStatus("Сохранено");
  toast("Статус дела обновлён.");
}

function setResponsibleEditEnabled(enabled) {
  state.responsibleEditEnabled = enabled;
  if (!enabled) {
    state.responsibleDrafts = {};
    state.statusDrafts = {};
  }
  renderCases();
}

function setDeleteEditEnabled(enabled) {
  state.deleteEditEnabled = enabled;
  renderCases();
}

function setShowDeletedCases(enabled) {
  state.showDeletedCases = enabled;
  renderCases();
}

function updateResponsibleDraft(caseId, responsible) {
  if (!state.responsibleEditEnabled) return;
  state.responsibleDrafts[caseId] = responsible;
  renderCases();
}

function updateStatusDraft(caseId, status) {
  if (!state.responsibleEditEnabled) return;
  state.statusDrafts[caseId] = status;
  renderCases();
}

function cancelCaseChanges(caseId) {
  delete state.responsibleDrafts[caseId];
  delete state.statusDrafts[caseId];
  renderCases();
}

async function saveResponsible(caseId) {
  const row = state.data.cases.find((item) => item.case_id === caseId);
  if (!row) return;
  const responsible = state.responsibleDrafts[caseId];
  if (!responsible || responsible === row["Ответственный"]) return;
  setStatus("Сохраняю ответственного…");
  const payload = await api(`/api/cases/${encodeURIComponent(caseId)}/responsible`, {
    method: "POST",
    body: JSON.stringify({ responsible }),
  });
  delete state.responsibleDrafts[caseId];
  setDataFromPayload(payload);
  setStatus("Сохранено");
  toast(`Ответственный по ${caseId} изменён: ${displayName(payload.case["Ответственный"])}`);
}

async function saveCaseChanges(caseId) {
  const row = state.data.cases.find((item) => item.case_id === caseId);
  if (!row) return;
  const nextResponsible = state.responsibleDrafts[caseId];
  const nextStatus = state.statusDrafts[caseId];
  const changedResponsible = nextResponsible && nextResponsible !== row["Ответственный"];
  const changedStatus = nextStatus && nextStatus !== row["Статус"];
  if (!changedResponsible && !changedStatus) {
    cancelCaseChanges(caseId);
    return;
  }
  if (changedResponsible) {
    await saveResponsible(caseId);
  }
  if (changedStatus) {
    await saveCaseStatus(caseId, nextStatus);
  }
  delete state.responsibleDrafts[caseId];
  delete state.statusDrafts[caseId];
  renderCases();
}

function openDeleteCaseModal(caseId) {
  const row = state.data.cases.find((item) => item.case_id === caseId);
  if (!row || isDeletedCase(row)) return;
  state.deleteModalCaseId = caseId;
  $("#deleteCaseTitle").textContent = `Удалить ${caseId}?`;
  $("#deleteCaseInfo").innerHTML = `
    <div><strong>ID:</strong> ${escapeHtml(row.case_id)}</div>
    <div><strong>Предмет:</strong> ${escapeHtml(row["Предмет"] || "—")}</div>
    <div><strong>Ответственный:</strong> ${escapeHtml(displayName(row["Ответственный"]))}</div>
    <div><strong>Статус:</strong> ${escapeHtml(row["Статус"] || "—")}</div>
  `;
  $("#deleteCaseConfirmInput").value = "";
  $("#deleteCaseConfirmBtn").disabled = true;
  $("#deleteCaseModal").classList.add("show");
  $("#deleteCaseConfirmInput").focus();
}

function closeDeleteCaseModal() {
  $("#deleteCaseModal").classList.remove("show");
  state.deleteModalCaseId = "";
  $("#deleteCaseConfirmInput").value = "";
  $("#deleteCaseConfirmBtn").disabled = true;
}

function updateDeleteConfirmState() {
  $("#deleteCaseConfirmBtn").disabled = $("#deleteCaseConfirmInput").value.trim() !== state.deleteModalCaseId;
}

async function deleteCaseById() {
  const caseId = state.deleteModalCaseId;
  if (!caseId) return;
  const confirmCaseId = $("#deleteCaseConfirmInput").value.trim();
  setStatus("Удаляю дело…");
  const payload = await api(`/api/cases/${encodeURIComponent(caseId)}/delete`, {
    method: "POST",
    body: JSON.stringify({ confirmCaseId }),
  });
  closeDeleteCaseModal();
  setDataFromPayload(payload);
  setStatus("Сохранено");
  toast(`Дело ${caseId} помечено как удалённое.`);
}

async function restoreCaseById(caseId) {
  const confirmed = window.confirm(`Восстановить дело ${caseId}?`);
  if (!confirmed) return;
  setStatus("Восстанавливаю дело…");
  const payload = await api(`/api/cases/${encodeURIComponent(caseId)}/restore`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  setDataFromPayload(payload);
  setStatus("Сохранено");
  toast(`Дело ${caseId} восстановлено.`);
}

async function completeDeadlineCase(caseId) {
  const confirmed = window.confirm(`Перевести дело ${caseId} в статус «Завершено»?`);
  if (!confirmed) return;
  setStatus("Завершаю дело…");
  const payload = await api(`/api/cases/${encodeURIComponent(caseId)}/complete-deadline`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  setDataFromPayload(payload);
  setStatus("Сохранено");
  toast(`Дело ${caseId} завершено.`);
}

function openPostponeCompletionModal(caseId) {
  const row = state.data.cases.find((item) => item.case_id === caseId);
  if (!row) return;
  state.postponeCompletionCaseId = caseId;
  $("#postponeCompletionTitle").textContent = `Отложить завершение ${caseId}`;
  $("#postponeCompletionInfo").innerHTML = `
    <strong>${escapeHtml(row.case_id)}</strong>
    <div>${escapeHtml(row["Тип дела"])} · ${escapeHtml(row["Предмет"] || "без предмета")}</div>
    <div>Контрольная дата: ${escapeHtml(formatRuDateDash(row["Контрольная дата завершения"]) || "—")}</div>
  `;
  $("#postponeCompletionDate").value = row["Отложить завершение до"] || "";
  $("#postponeCompletionReason").value = row["Причина отложения завершения дела"] || "";
  $("#postponeCompletionModal").classList.add("show");
  $("#postponeCompletionDate").focus();
}

function closePostponeCompletionModal() {
  state.postponeCompletionCaseId = "";
  $("#postponeCompletionModal").classList.remove("show");
  $("#postponeCompletionDate").value = "";
  $("#postponeCompletionReason").value = "";
}

async function savePostponeCompletion() {
  const caseId = state.postponeCompletionCaseId;
  if (!caseId) return;
  const postponeTo = $("#postponeCompletionDate").value;
  const reason = $("#postponeCompletionReason").value;
  setStatus("Сохраняю отложение…");
  const payload = await api(`/api/cases/${encodeURIComponent(caseId)}/postpone-completion`, {
    method: "POST",
    body: JSON.stringify({ postponeTo, reason }),
  });
  closePostponeCompletionModal();
  setDataFromPayload(payload);
  setStatus("Сохранено");
  toast(`Завершение ${caseId} отложено.`);
}

function caseDetailRows(row) {
  const rows = [
    ["ID", row.case_id],
    ["Тип дела", row["Тип дела"]],
    ["Статус", row["Статус"]],
    ["Ответственный", displayName(row["Ответственный"])],
    ["Регион", row["Регион"]],
    ["Истец / заявитель", row["Истец"]],
    ["Ответчик", row["Ответчик"]],
  ];
  if (String(row["Третье лицо"] ?? "").trim()) rows.push(["Третье лицо", row["Третье лицо"]]);
  rows.push(
    ["Предмет", row["Предмет"]],
    ["Ссылка на CasePro", row["Ссылка"]],
  );
  return rows.filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");
}

function caseDetailValueHtml(label, value) {
  if (label !== "Ссылка на CasePro") return escapeHtml(value);
  const link = caseLinkInfo(value);
  if (!link) return "—";
  const safeUrl = escapeHtml(link.url);
  return `<a class="case-link-chip" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.title)}</a>`;
}

function openCaseModal(caseId) {
  const row = state.data.cases.find((item) => item.case_id === caseId);
  if (!row) return;
  $("#caseModalTitle").textContent = `Карточка ${row.case_id}`;
  $("#caseModalBody").innerHTML = `
    <div class="case-detail-grid">
      ${caseDetailRows(row).map(([label, value]) => `
        <div class="case-detail-item ${label === "Предмет" ? "wide" : ""}">
          <span>${escapeHtml(label)}</span>
          <strong>${caseDetailValueHtml(label, value)}</strong>
        </div>
      `).join("")}
    </div>
  `;
  $("#caseModal").classList.add("show");
  $("#caseModalOk").focus();
}

function closeCaseModal() {
  $("#caseModal").classList.remove("show");
}

function openQueueManualAssignModal(name = "") {
  const draft = formDraft();
  if (!validateDraftForAssignment(draft)) return;
  const selectField = $("#queueManualAssignEmployeeField");
  const select = $("#queueManualAssignEmployeeSelect");
  const candidates = manualAssignableEmployees(draft, { excludeCurrentQueue: !name });
  if (name) {
    const employee = employeesForSelectedYuc().find((item) => nameMatches(item["ФИО"], name));
    const fullName = employee?.["ФИО"] || name;
    state.queueManualCandidate = fullName;
    selectField?.classList.add("hidden");
    select.innerHTML = "";
    $("#queueManualAssignInfo").innerHTML = `
      <div><strong>Сотрудник:</strong> ${escapeHtml(displayName(fullName))}</div>
      <div class="muted">Назначение будет выполнено вручную, вне очереди. Комментарий руководителя обязателен.</div>
    `;
  } else {
    if (!candidates.length) {
      toast("Нет доступных сотрудников вне текущей очереди по выбранному типу и дате.", "error");
      return;
    }
    state.queueManualCandidate = "";
    select.innerHTML = candidates
      .map((employee) => `<option value="${escapeHtml(employee["ФИО"])}">${escapeHtml(displayName(employee["ФИО"]))}</option>`)
      .join("");
    selectField?.classList.remove("hidden");
    $("#queueManualAssignInfo").innerHTML = `
      <div><strong>Режим:</strong> назначение вне текущей системной очереди</div>
      <div class="muted">Можно выбрать доступного сотрудника выбранного ЮЦ, который не входит в показанную очередь. Комментарий руководителя обязателен.</div>
    `;
  }
  $("#queueManualAssignComment").value = "";
  $("#queueManualAssignModal").classList.add("show");
  $("#queueManualAssignModal").setAttribute("aria-hidden", "false");
  (name ? $("#queueManualAssignComment") : select)?.focus();
}

function closeQueueManualAssignModal() {
  state.queueManualCandidate = null;
  $("#queueManualAssignEmployeeField")?.classList.add("hidden");
  $("#queueManualAssignEmployeeSelect").innerHTML = "";
  $("#queueManualAssignModal")?.classList.remove("show");
  $("#queueManualAssignModal")?.setAttribute("aria-hidden", "true");
}

async function saveQueueManualAssign() {
  const responsible = state.queueManualCandidate || $("#queueManualAssignEmployeeSelect")?.value || "";
  const comment = $("#queueManualAssignComment")?.value ?? "";
  if (!responsible) {
    toast("Выберите сотрудника для назначения вне очереди.", "error");
    $("#queueManualAssignEmployeeSelect")?.focus();
    return;
  }
  if (!comment.trim()) {
    toast("Для назначения вне очереди нужен комментарий руководителя.", "error");
    $("#queueManualAssignComment")?.focus();
    return;
  }
  const saved = await manualAssignTo(responsible, comment);
  if (saved) closeQueueManualAssignModal();
}

async function assignExistingAuto(caseId) {
  const caseRow = state.data.cases.find((row) => row.case_id === caseId);
  if (!caseRow) return;
  const recommendation = await api("/api/recommend", {
    method: "POST",
    body: JSON.stringify({ draft: draftFromCase(caseRow) }),
  });
  if (!recommendation.result.ok) {
    toast(recommendation.result.reason || "Автоназначение сейчас невозможно.", "error");
    return;
  }
  const confirmed = window.confirm(`Автоматически назначить дело ${caseId} сотруднику ${displayName(recommendation.result.candidate)}?`);
  if (!confirmed) return;
  setStatus("Распределяю существующее дело…");
  const payload = await api(`/api/cases/${encodeURIComponent(caseId)}/assign-auto`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  setDataFromPayload(payload);
  setStatus("Сохранено");
  if (payload.result.ok) {
    toast(`Дело ${caseId} назначено: ${displayName(payload.case["Ответственный"])}`);
  } else {
    toast(payload.result.reason || "Автоназначение остановлено.", "error");
  }
}

async function assignExistingManual(caseId) {
  const caseRow = state.data.cases.find((row) => row.case_id === caseId);
  if (!caseRow) return;
  const names = employeesForSelectedYuc().map((employee) => employee["ФИО"]).filter(Boolean);
  if (!names.length) {
    toast("В выбранном ЮЦ нет сотрудников для ручного назначения.", "error");
    return;
  }
  const responsible = window.prompt(
    `Введите полное ФИО ответственного для дела ${caseId}.\n\nДоступные сотрудники:\n${names.map((name) => `${displayName(name)} — ${name}`).join("\n")}`,
    names[0] ?? "",
  );
  if (responsible === null) return;
  const exactName = names.find((name) => name === responsible.trim());
  if (!exactName) {
    toast("Выберите сотрудника точным ФИО из списка.", "error");
    return;
  }
  const comment = window.prompt("Комментарий руководителя для ручного назначения:", "");
  if (comment === null) return;
  if (!comment.trim()) {
    toast("Для ручного назначения нужен комментарий.", "error");
    return;
  }
  setStatus("Назначаю существующее дело вручную…");
  const payload = await api(`/api/cases/${encodeURIComponent(caseId)}/assign-manual`, {
    method: "POST",
    body: JSON.stringify({ responsible: exactName, comment }),
  });
  setDataFromPayload(payload);
  setStatus("Сохранено");
  toast(`Дело ${caseId} назначено вручную: ${displayName(payload.case["Ответственный"])}`);
}

function updateVacationDay(isoDate) {
  const employee = selectedVacationEmployee();
  if (!employee) return;
  const year = selectedVacationYear();
  const draft = ensureVacationDraft(employee.employee_id, year);
  const dates = new Set(draft.dates);
  if (dates.has(isoDate)) dates.delete(isoDate);
  else dates.add(isoDate);
  draft.dates = [...dates].sort();
  renderVacationCalendar();
  setStatus("Есть несохраненные изменения");
}

function updateVacationRange(start, end, action) {
  const employee = selectedVacationEmployee();
  if (!employee) return;
  const year = selectedVacationYear();
  const dates = eachDateInRange(start, end);
  if (!dates.length) return;
  const draft = ensureVacationDraft(employee.employee_id, year);
  const draftDates = new Set(draft.dates);
  for (const day of dates) {
    if (action === "clear") draftDates.delete(day);
    else draftDates.add(day);
  }
  draft.dates = [...draftDates].sort();
  state.vacationRangeStart = null;
  renderVacationCalendar();
  setStatus("Есть несохраненные изменения");
  toast(action === "clear" ? `В черновике снят отпуск: ${dates.length} дн.` : `В черновик добавлен отпуск: ${dates.length} дн.`);
}

function handleVacationDateClick(isoDate) {
  if (!state.vacationEdit) {
    toast("Сначала включите редактирование отпусков.", "error");
    return;
  }
  if (state.vacationMode === "single") {
    updateVacationDay(isoDate);
    return;
  }
  if (!state.vacationRangeStart) {
    state.vacationRangeStart = isoDate;
    renderVacationCalendar();
    toast("Выберите последнюю дату диапазона.");
    return;
  }
  const action = state.vacationMode === "clear-range" ? "clear" : "set";
  updateVacationRange(state.vacationRangeStart, isoDate, action);
}

function clearVacationYear() {
  if (!state.vacationEdit) {
    toast("Сначала включите редактирование отпусков.", "error");
    return;
  }
  const employee = selectedVacationEmployee();
  const year = selectedVacationYear();
  if (!employee) return;
  const confirmed = window.confirm(`Снять все отпуска ${displayName(employee["ФИО"])} за ${year} год в черновике?`);
  if (!confirmed) return;
  const draft = ensureVacationDraft(employee.employee_id, year);
  draft.dates = [];
  state.vacationRangeStart = null;
  renderVacationCalendar();
  setStatus("Есть несохраненные изменения");
  toast("Год очищен в черновике. Для записи нажмите «Сохранить».");
}

async function saveVacationYear() {
  if (!state.vacationEdit) {
    toast("Сначала включите редактирование отпусков.", "error");
    return;
  }
  const employee = selectedVacationEmployee();
  const year = selectedVacationYear();
  if (!employee) return;
  const draft = state.vacationDrafts[vacationDraftKey(employee.employee_id, year)];
  if (!draft) return;
  setStatus("Сохраняю отпуск…");
  const payload = await api("/api/vacations/save-year", {
    method: "POST",
    body: JSON.stringify({ employee_id: employee.employee_id, year, dates: draft.dates }),
  });
  discardVacationDraft(employee.employee_id, year);
  state.vacationRangeStart = null;
  setDataFromPayload(payload);
  setStatus("Сохранено");
  toast("График отпусков сохранен.");
}

function cancelVacationDraft() {
  const employee = selectedVacationEmployee();
  const year = selectedVacationYear();
  if (!employee) return;
  discardVacationDraft(employee.employee_id, year);
  state.vacationRangeStart = null;
  renderVacationCalendar();
  setStatus("Готово");
  toast("Несохраненные изменения отменены.");
}

async function exitApplication() {
  const confirmed = window.confirm("Остановить сервер приложения и закрыть страницу?");
  if (!confirmed) return;
  setStatus("Останавливаю сервер…");
  try {
    await api("/api/shutdown", { method: "POST", body: JSON.stringify({}) });
  } catch {
    // The server may close the connection quickly; the next step is still safe.
  }
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:var(--font);background:#f7f7f8;color:#1a1a1a;padding:24px;">
      <div style="max-width:560px;background:white;border-radius:16px;padding:28px;box-shadow:0 8px 24px rgba(0,0,0,.12);">
        <h1 style="margin:0 0 12px;font-size:28px;">Приложение остановлено</h1>
        <p style="margin:0;color:#666;line-height:1.55;">Сервер получил команду завершения. Если вкладка не закрылась автоматически, её можно закрыть вручную.</p>
      </div>
    </div>
  `;
  setTimeout(() => {
    window.open("", "_self");
    window.close();
  }, 250);
}

function bindEvents() {
  document.addEventListener("click", blockWritePendingButtonEvents, true);
  $$(".nav-link").forEach((link) => {
    link.addEventListener("click", () => showView(link.dataset.view));
  });
  $("#refreshBtn").addEventListener("click", loadData);
  $("#exitBtn").addEventListener("click", () => exitApplication());
  $("#themeToggle")?.addEventListener("change", (event) => {
    applyTheme(event.target.checked ? redTheme : blueTheme);
  });
  $("#saveYucSettingsBtn")?.addEventListener("click", () => saveYucSettings().catch((error) => {
    setStatus("Ошибка");
    toast(error.message, "error");
  }));
  $("#saveDeadlineSettingsBtn")?.addEventListener("click", () => saveDeadlineSettings().catch((error) => {
    setStatus("Ошибка");
    toast(error.message, "error");
  }));
  $("#regionalQueuesEnabled")?.addEventListener("change", updateRegionalSettingsAvailability);
  $("#addRegionalAssignmentBtn")?.addEventListener("click", () => {
    if (!regionalQueuesCurrentlyEnabled()) return;
    state.assignmentDraftOpen = true;
    renderRegionalAssignments();
  });
  $("#addRegionalSubstitutionBtn")?.addEventListener("click", () => {
    if (!regionalQueuesCurrentlyEnabled()) return;
    state.substitutionDraftOpen = true;
    renderRegionalSubstitutions();
  });
  $("#caseModalOk").addEventListener("click", closeCaseModal);
  $("#caseModal").addEventListener("click", (event) => {
    if (event.target.id === "caseModal") closeCaseModal();
  });
  $("#queueManualAssignCancelBtn")?.addEventListener("click", closeQueueManualAssignModal);
  $("#queueManualAssignModal")?.addEventListener("click", (event) => {
    if (event.target.id === "queueManualAssignModal") closeQueueManualAssignModal();
  });
  $("#queueManualAssignSaveBtn")?.addEventListener("click", () => saveQueueManualAssign().catch((error) => {
    setStatus("Ошибка");
    toast(error.message, "error");
  }));
  $("#deleteCaseCancelBtn").addEventListener("click", closeDeleteCaseModal);
  $("#deleteCaseModal").addEventListener("click", (event) => {
    if (event.target.id === "deleteCaseModal") closeDeleteCaseModal();
  });
  $("#postponeCompletionCancelBtn")?.addEventListener("click", closePostponeCompletionModal);
  $("#postponeCompletionModal")?.addEventListener("click", (event) => {
    if (event.target.id === "postponeCompletionModal") closePostponeCompletionModal();
  });
  $("#vacationImportBtn")?.addEventListener("click", () => $("#vacationImportInput")?.click());
  $("#vacationImportInput")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    previewVacationImport(file).catch((error) => {
      setStatus("Ошибка");
      toast(error.message, "error");
    });
  });
  $("#vacationImportCancelBtn")?.addEventListener("click", closeVacationImportModal);
  $("#vacationImportModal")?.addEventListener("click", (event) => {
    if (event.target.id === "vacationImportModal") closeVacationImportModal();
  });
  $("#vacationImportApplyBtn")?.addEventListener("click", () => applyVacationImport().catch((error) => {
    setStatus("Ошибка");
    toast(error.message, "error");
  }));
  $("#postponeCompletionSaveBtn")?.addEventListener("click", () => savePostponeCompletion().catch((error) => {
    setStatus("Ошибка");
    toast(error.message, "error");
  }));
  $("#deleteCaseConfirmInput").addEventListener("input", updateDeleteConfirmState);
  $("#deleteCaseConfirmBtn").addEventListener("click", () => deleteCaseById().catch((error) => {
    setStatus("Ошибка");
    toast(error.message, "error");
  }));
  $("#caseImportBtn")?.addEventListener("click", () => $("#caseImportInput")?.click());
  $("#caseImportInput")?.addEventListener("change", (event) => {
    previewCaseImport(event.target.files?.[0]).catch((error) => {
      setStatus("Ошибка");
      toast(error.message, "error");
    });
  });
  $("#caseImportCancelBtn")?.addEventListener("click", closeCaseImportModal);
  $("#caseImportModal")?.addEventListener("click", (event) => {
    if (event.target.id === "caseImportModal") closeCaseImportModal();
    if (event.target.closest("#caseImportSelectAllBtn")) {
      state.caseImportSelectedRows = new Set((state.caseImportPlan?.toAdd ?? []).map((item) => String(item.rowNumber)));
      renderCaseImportModal();
    }
    if (event.target.closest("#caseImportClearAllBtn")) {
      state.caseImportSelectedRows = new Set();
      renderCaseImportModal();
    }
  });
  $("#caseImportApplyBtn")?.addEventListener("click", () => applyCaseImport().catch((error) => {
    setStatus("Ошибка");
    toast(error.message, "error");
  }));
  $("#caseForm").addEventListener("change", handleCaseFormRecommendationChange);
  $("#casesSearch").addEventListener("input", renderCases);
  $("#casesQuickFilterStrip")?.addEventListener("click", (event) => {
    if (event.target.closest("#clearCasesQuickFilter")) {
      state.casesQuickFilter = "";
      renderCases();
    }
    if (event.target.closest("#clearCasesResponsibleFilter")) {
      state.casesResponsibleFilter = "";
      renderCases();
    }
  });
  $("#caseResponsibleEditToggle").addEventListener("change", (event) => {
    setResponsibleEditEnabled(event.target.checked);
  });
  $("#caseDeleteEditToggle").addEventListener("change", (event) => {
    setDeleteEditEnabled(event.target.checked);
  });
  $("#showDeletedCasesToggle").addEventListener("change", (event) => {
    setShowDeletedCases(event.target.checked);
  });
  $("#yucSelect")?.addEventListener("change", (event) => setSelectedYuc(event.target.value));
  $$(".subtab").forEach((button) => {
    button.addEventListener("click", () => {
      state.employeeSection = button.dataset.employeeSection;
      if (state.data) resetEmployeeAvailabilityDrafts();
      $$(".subtab").forEach((item) => item.classList.toggle("active", item === button));
      $$(".employee-section").forEach((section) => section.classList.toggle("active", section.id === `employee-section-${state.employeeSection}`));
    });
  });
  $("#vacationEmployeeSelect").addEventListener("change", () => {
    state.vacationRangeStart = null;
    renderVacationCalendar();
  });
  $("#vacationYearSelect").addEventListener("change", () => {
    state.vacationRangeStart = null;
    renderVacationCalendar();
  });
  $("#vacationEditToggle").addEventListener("change", (event) => {
    if (!event.target.checked) {
      const employee = selectedVacationEmployee();
      if (employee && vacationDraftChanged(employee.employee_id, selectedVacationYear())) {
        discardVacationDraft(employee.employee_id, selectedVacationYear());
        toast("Несохраненные изменения отпусков отменены.");
      }
    }
    state.vacationEdit = event.target.checked;
    state.vacationRangeStart = null;
    renderVacationCalendar();
  });
  $$(".mode-btn").forEach((button) => {
    button.addEventListener("click", () => {
      state.vacationMode = button.dataset.vacationMode;
      state.vacationRangeStart = null;
      $$(".mode-btn").forEach((item) => item.classList.toggle("active", item === button));
      renderVacationCalendar();
    });
  });
  $("#clearVacationYearBtn").addEventListener("click", clearVacationYear);
  $("#saveVacationYearBtn").addEventListener("click", () => saveVacationYear().catch((error) => {
    setStatus("Ошибка");
    toast(error.message, "error");
  }));
  $("#cancelVacationDraftBtn").addEventListener("click", cancelVacationDraft);
  document.addEventListener("click", (event) => {
    const summaryButton = event.target.closest("[data-summary-action]");
    if (summaryButton) {
      handleSummaryAction(summaryButton.dataset.summaryAction);
      return;
    }
    const dashboardResponsibleButton = event.target.closest("[data-dashboard-responsible]");
    if (dashboardResponsibleButton) {
      applyCasesResponsibleFilter(dashboardResponsibleButton.dataset.dashboardResponsible);
      return;
    }
    const queueAutoButton = event.target.closest(".queue-assign-auto");
    if (queueAutoButton) {
      autoAssign().catch((error) => {
        setStatus("Ошибка");
        toast(error.message, "error");
      });
      return;
    }
    const queueManualButton = event.target.closest(".queue-assign-manual");
    if (queueManualButton) {
      openQueueManualAssignModal(queueManualButton.dataset.name);
      return;
    }
    const queueManualAllButton = event.target.closest(".queue-assign-manual-all");
    if (queueManualAllButton) {
      openQueueManualAssignModal();
      return;
    }
    const yucTab = event.target.closest(".yuc-tab");
    if (yucTab) setSelectedYuc(yucTab.dataset.yuc);
    const caseIdButton = event.target.closest(".case-id-link");
    if (caseIdButton) openCaseModal(caseIdButton.dataset.id);
    const saveCaseChangesButton = event.target.closest(".save-case-changes");
    if (saveCaseChangesButton) saveCaseChanges(saveCaseChangesButton.dataset.id).catch((error) => {
      setStatus("Ошибка");
      toast(error.message, "error");
    });
    const cancelCaseChangesButton = event.target.closest(".cancel-case-changes");
    if (cancelCaseChangesButton) cancelCaseChanges(cancelCaseChangesButton.dataset.id);
    const employeeButton = event.target.closest(".save-employee");
    if (employeeButton) saveEmployee(employeeButton.dataset.id).catch((error) => toast(error.message, "error"));
    const saveRegionalAssignmentButton = event.target.closest(".save-regional-assignment");
    if (saveRegionalAssignmentButton) saveRegionalAssignment(saveRegionalAssignmentButton).catch((error) => {
      setStatus("Ошибка");
      toast(error.message, "error");
    });
    const deleteRegionalAssignmentButton = event.target.closest(".delete-regional-assignment");
    if (deleteRegionalAssignmentButton) deleteRegionalAssignment(deleteRegionalAssignmentButton).catch((error) => {
      setStatus("Ошибка");
      toast(error.message, "error");
    });
    const cancelNewRegionalAssignmentButton = event.target.closest(".cancel-new-regional-assignment");
    if (cancelNewRegionalAssignmentButton) {
      state.assignmentDraftOpen = false;
      renderRegionalAssignments();
    }
    const saveRegionalSubstitutionButton = event.target.closest(".save-regional-substitution");
    if (saveRegionalSubstitutionButton) saveRegionalSubstitution(saveRegionalSubstitutionButton).catch((error) => {
      setStatus("Ошибка");
      toast(error.message, "error");
    });
    const deleteRegionalSubstitutionButton = event.target.closest(".delete-regional-substitution");
    if (deleteRegionalSubstitutionButton) deleteRegionalSubstitution(deleteRegionalSubstitutionButton).catch((error) => {
      setStatus("Ошибка");
      toast(error.message, "error");
    });
    const cancelNewRegionalSubstitutionButton = event.target.closest(".cancel-new-regional-substitution");
    if (cancelNewRegionalSubstitutionButton) {
      state.substitutionDraftOpen = false;
      renderRegionalSubstitutions();
    }
    const existingAutoButton = event.target.closest(".assign-existing-auto");
    if (existingAutoButton) assignExistingAuto(existingAutoButton.dataset.id).catch((error) => {
      setStatus("Ошибка");
      toast(error.message, "error");
    });
    const existingManualButton = event.target.closest(".assign-existing-manual");
    if (existingManualButton) assignExistingManual(existingManualButton.dataset.id).catch((error) => {
      setStatus("Ошибка");
      toast(error.message, "error");
    });
    const deleteCaseButton = event.target.closest(".open-delete-case");
    if (deleteCaseButton) openDeleteCaseModal(deleteCaseButton.dataset.id);
    const restoreCaseButton = event.target.closest(".restore-case");
    if (restoreCaseButton) restoreCaseById(restoreCaseButton.dataset.id).catch((error) => {
      setStatus("Ошибка");
      toast(error.message, "error");
    });
    const completeDeadlineButton = event.target.closest(".complete-deadline-case");
    if (completeDeadlineButton) completeDeadlineCase(completeDeadlineButton.dataset.id).catch((error) => {
      setStatus("Ошибка");
      toast(error.message, "error");
    });
    const postponeCompletionButton = event.target.closest(".postpone-completion-case");
    if (postponeCompletionButton) openPostponeCompletionModal(postponeCompletionButton.dataset.id);
    const vacationDay = event.target.closest(".day-cell[data-date]");
    if (vacationDay) handleVacationDateClick(vacationDay.dataset.date);
  });
  document.addEventListener("change", (event) => {
    if (event.target.matches("#caseImportSelectAll")) {
      state.caseImportSelectedRows = event.target.checked
        ? new Set((state.caseImportPlan?.toAdd ?? []).map((item) => String(item.rowNumber)))
        : new Set();
      renderCaseImportModal();
      return;
    }
    if (event.target.matches(".case-import-check")) {
      const rowNumber = String(event.target.dataset.rowNumber ?? "");
      if (rowNumber) {
        if (event.target.checked) state.caseImportSelectedRows.add(rowNumber);
        else state.caseImportSelectedRows.delete(rowNumber);
      }
      updateCaseImportSelectionState();
      return;
    }
    if (event.target.matches(".case-status")) {
      if (!state.responsibleEditEnabled) return;
      updateStatusDraft(event.target.dataset.id, event.target.value);
    }
    if (event.target.matches(".responsible-select")) {
      updateResponsibleDraft(event.target.dataset.id, event.target.value);
    }
    if (event.target.matches(".employee-active-field")) {
      refreshEmployeeAvailabilityRow(event.target.dataset.id, event.target.checked ? "Да" : "Нет");
    }
    if (event.target.matches(".employee-field, .employee-debt-field")) {
      invalidateRecommendation("Изменены доступность или долги сотрудника. Сохраните изменения — рекомендация будет пересчитана.");
    }
    if (event.target.matches(".toggle-inline input[type='checkbox']")) {
      const caption = event.target.closest(".toggle-inline")?.querySelector(".toggle-caption");
      if (caption) caption.textContent = event.target.checked ? "Да" : "Нет";
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeCaseModal();
      closeDeleteCaseModal();
      closePostponeCompletionModal();
      closeVacationImportModal();
      closeCaseImportModal();
      closeQueueManualAssignModal();
    }
  });
}

function init() {
  applyTheme(savedTheme(), false);
  $("#caseForm").elements["Дата поступления"].value = today();
  updateThirdPartyVisibility();
  bindEvents();
  loadData().catch((error) => {
    setStatus("Ошибка");
    toast(error.message, "error");
  });
}

init();
