const state = {
  data: null,
  storagePath: "",
  lastRecommendation: null,
  employeeSection: "availability",
  vacationEdit: false,
  vacationMode: "single",
  vacationRangeStart: null,
  responsibleEditEnabled: false,
  responsibleDrafts: {},
  statusDrafts: {},
};

const titles = {
  dashboard: "Панель управления",
  distribution: "Распределение нового дела",
  cases: "Реестр дел",
  employees: "Сотрудники",
  queues: "Очереди и долги",
  journal: "Журнал распределения",
  help: "Инструкция",
};

const caseTypes = ["претензия", "административное", "судебное"];
const statuses = ["В работе", "Ожидает распределения", "Завершено", "Отменено", "Приостановлено"];
const completedStatuses = new Set(["Завершено", "Отменено"]);

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

function setStatus(message) {
  $("#saveStatus").textContent = message;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || "Ошибка запроса");
  return payload;
}

async function loadData() {
  setStatus("Читаю Excel…");
  const payload = await api("/api/data");
  state.data = payload.data;
  state.storagePath = payload.storagePath;
  $("#storagePath").textContent = payload.storagePath;
  renderAll();
  setStatus("Готово");
}

function setDataFromPayload(payload) {
  if (payload.data) {
    state.data = {
      ...payload.data,
      directories: payload.data.directories ?? state.data?.directories,
    };
    renderAll();
  }
}

function showView(name) {
  $$(".view").forEach((view) => view.classList.remove("active"));
  $(`#view-${name}`).classList.add("active");
  $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.view === name));
  $("#pageTitle").textContent = titles[name];
}

function badge(text, kind = "gray") {
  return `<span class="badge badge-${kind}">${escapeHtml(text)}</span>`;
}

function renderSummary() {
  const summary = state.data.summary;
  $("#summaryCards").innerHTML = [
    ["Всего дел", summary.totalCases],
    ["Актуальных дел", summary.activeCases],
    ["Нераспределённых", summary.unassignedCases],
    ["Активных сотрудников", summary.activeEmployees],
  ].map(([label, value]) => `
    <div class="metric-card">
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value}</div>
    </div>
  `).join("");

  const maxTotal = Math.max(...summary.byType.map((item) => item.total), 1);
  $("#typeSummary").innerHTML = summary.byType.map((item) => `
    <div class="type-row">
      <strong>${escapeHtml(item.type)}</strong>
      <div class="progress-track">
        <div class="progress-fill" style="width:${Math.round((item.total / maxTotal) * 100)}%"></div>
      </div>
      <span>${item.active} / ${item.total} · ${item.relevanceDays} дн.</span>
    </div>
  `).join("");

  $("#stateSummary").innerHTML = state.data.state.map((row) => `
    <tr>
      <td>${escapeHtml(row["Тип дела"])}</td>
      <td>${escapeHtml(row["Последняя позиция"])}</td>
      <td>${escapeHtml(row["Последний автоназначенный"] || "—")}</td>
      <td>${escapeHtml(row["Цикл"])}</td>
    </tr>
  `).join("");
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

function workloadByEmployee() {
  return state.data.employees.map((employee) => {
    const name = employee["ФИО"];
    const productionCases = state.data.cases.filter((caseRow) =>
      caseRow["Ответственный"] === name &&
      !completedStatuses.has(caseRow["Статус"])
    );
    const byType = Object.fromEntries(caseTypes.map((type) => {
      const rows = productionCases.filter((caseRow) => caseRow["Тип дела"] === type);
      const active = rows.filter((caseRow) => Number(caseRow["Активное число"]) === 1).length;
      const inactive = rows.length - active;
      return [type, { active, inactive, total: rows.length }];
    }));
    return {
      employee,
      byType,
      total: productionCases.length,
      activeTotal: productionCases.filter((caseRow) => Number(caseRow["Активное число"]) === 1).length,
      inactiveTotal: productionCases.filter((caseRow) => Number(caseRow["Активное число"]) !== 1).length,
    };
  }).sort((a, b) => b.total - a.total || a.employee["ФИО"].localeCompare(b.employee["ФИО"], "ru"));
}

function renderWorkloadDashboard() {
  const rows = workloadByEmployee();
  const maxTotal = Math.max(...rows.flatMap((row) => caseTypes.map((type) => row.byType[type].total)), 1);
  $("#workloadDashboard").innerHTML = `
    <div class="workload-legend">
      <span><i class="legend-dot active"></i>Активные</span>
      <span><i class="legend-dot inactive"></i>Неактивные, но незавершённые</span>
    </div>
    <div class="workload-table">
      <div class="workload-header employee-col">Сотрудник</div>
      ${caseTypes.map((type) => `<div class="workload-header">${escapeHtml(type)}</div>`).join("")}
      <div class="workload-header total-col">Всего</div>
      ${rows.map((row) => `
        <div class="workload-employee">
          <div class="avatar avatar-sm">${escapeHtml(employeeInitials(row.employee["ФИО"]))}</div>
          <div>
            <strong>${escapeHtml(row.employee["ФИО"])}</strong>
            <span>${row.activeTotal} активных · ${row.inactiveTotal} неактивных</span>
          </div>
        </div>
        ${caseTypes.map((type) => {
          const item = row.byType[type];
          const activeWidth = item.total ? Math.max(8, Math.round((item.active / maxTotal) * 100)) : 0;
          const inactiveWidth = item.total ? Math.max(8, Math.round((item.inactive / maxTotal) * 100)) : 0;
          return `
            <div class="workload-cell">
              <div class="workload-count">
                <strong>${item.total}</strong>
                <span>${item.active} / ${item.inactive}</span>
              </div>
              <div class="workload-bars" title="Активные: ${item.active}; неактивные незавершённые: ${item.inactive}">
                ${item.active ? `<div class="workload-bar active" style="width:${activeWidth}%"></div>` : ""}
                ${item.inactive ? `<div class="workload-bar inactive" style="width:${inactiveWidth}%"></div>` : ""}
              </div>
            </div>
          `;
        }).join("")}
        <div class="workload-total">
          <strong>${row.total}</strong>
          <span>${row.activeTotal} + ${row.inactiveTotal}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderManualSelect() {
  const select = $("#manualResponsible");
  const current = select.value;
  select.innerHTML = `<option value="">Не использовать</option>` + state.data.employees
    .filter((item) => item["Активен"] === "Да")
    .map((employee) => `<option value="${escapeHtml(employee["ФИО"])}">${escapeHtml(employee["ФИО"])}</option>`)
    .join("");
  select.value = current;
}

function renderYucRegionSelects() {
  const directories = state.data?.directories;
  const yucSelect = $("#yucSelect");
  const regionSelect = $("#regionSelect");
  if (!directories?.yucs?.length) {
    yucSelect.innerHTML = `<option value="Дальний Восток">Дальний Восток</option>`;
    regionSelect.innerHTML = `<option value="">Регион не выбран</option>`;
    return;
  }
  const currentYuc = yucSelect.value || "Дальний Восток";
  yucSelect.innerHTML = directories.yucs
    .map((yuc) => `<option value="${escapeHtml(yuc)}">${escapeHtml(yuc)}</option>`)
    .join("");
  yucSelect.value = directories.yucs.includes(currentYuc) ? currentYuc : directories.yucs[0];
  renderRegionSelect();
}

function renderRegionSelect(previousRegion = null) {
  const directories = state.data?.directories;
  const yuc = $("#yucSelect").value;
  const regionSelect = $("#regionSelect");
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
  return `<select class="inline-select case-status" data-id="${escapeHtml(row.case_id)}" ${state.responsibleEditEnabled ? "" : "disabled"} title="${state.responsibleEditEnabled ? "Выберите новый статус" : "Включите редактирование дел"}">
    ${statuses.map((status) => `<option value="${status}" ${current === status ? "selected" : ""}>${status}</option>`).join("")}
  </select>`;
}

function canAssignExistingCase(row) {
  return row["Статус"] === "Ожидает распределения" && !String(row["Ответственный"] ?? "").trim();
}

function caseResponsibleValue(row) {
  return state.responsibleDrafts[row.case_id] ?? row["Ответственный"] ?? "";
}

function isResponsibleChanged(row) {
  return state.responsibleEditEnabled && caseResponsibleValue(row) !== (row["Ответственный"] ?? "");
}

function caseStatusValue(row) {
  return state.statusDrafts[row.case_id] ?? row["Статус"] ?? "";
}

function isStatusChanged(row) {
  return state.responsibleEditEnabled && caseStatusValue(row) !== (row["Статус"] ?? "");
}

function isCaseChanged(row) {
  return isResponsibleChanged(row) || isStatusChanged(row);
}

function caseResponsibleCell(row) {
  const current = caseResponsibleValue(row);
  return `
    <select class="inline-select responsible-select" data-id="${escapeHtml(row.case_id)}" ${state.responsibleEditEnabled ? "" : "disabled"} title="${state.responsibleEditEnabled ? "Выберите нового ответственного" : "Включите редактирование ответственных"}">
      <option value="" disabled ${current ? "" : "selected"}>—</option>
      ${state.data.employees.map((employee) => {
        const name = employee["ФИО"];
        return `<option value="${escapeHtml(name)}" ${name === current ? "selected" : ""}>${escapeHtml(name)}</option>`;
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
  const term = ($("#casesSearch")?.value ?? "").toLowerCase();
  const rows = state.data.cases
    .filter((row) => !term || Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(term)))
    .slice()
    .reverse();
  $("#casesTable").innerHTML = rows.map((row) => `
    <tr>
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

function employeeSelect(value, employeeId, field, options = {}) {
  const classes = [
    "inline-select",
    "employee-field",
    field === "Активен" ? "employee-active-field" : "employee-type-field",
  ].join(" ");
  return `<select class="${classes}" data-id="${employeeId}" data-field="${field}" ${options.disabled ? "disabled" : ""}>
    <option value="Да" ${value === "Да" ? "selected" : ""}>Да</option>
    <option value="Нет" ${value === "Нет" ? "selected" : ""}>Нет</option>
  </select>`;
}

function renderEmployees() {
  $("#employeesTable").innerHTML = state.data.employees.map((employee) => `
    <tr class="${employee["Активен"] === "Да" ? "" : "employee-inactive"}" data-employee-row="${escapeHtml(employee.employee_id)}">
      <td><strong>${escapeHtml(employee["ФИО"])}</strong><div class="muted">${escapeHtml(employee.employee_id)}</div></td>
      <td>${employeeSelect(employee["Активен"], employee.employee_id, "Активен")}</td>
      <td>${employeeSelect(employee["Судебные"], employee.employee_id, "Судебные", { disabled: employee["Активен"] !== "Да" })}</td>
      <td>${employeeSelect(employee["Административные"], employee.employee_id, "Административные", { disabled: employee["Активен"] !== "Да" })}</td>
      <td>${employeeSelect(employee["Претензии"], employee.employee_id, "Претензии", { disabled: employee["Активен"] !== "Да" })}</td>
      <td>${employee["Сейчас в отпуске"] === "Да" ? badge("отпуск", "orange") : badge("доступен", "green")}</td>
      <td>${employee["Активные всего"]}</td>
      <td><button class="tiny-btn save-employee" data-id="${employee.employee_id}">Сохранить</button></td>
    </tr>
  `).join("");
}

function refreshEmployeeAvailabilityRow(employeeId, activeValue) {
  const row = $(`tr[data-employee-row="${CSS.escape(employeeId)}"]`);
  if (!row) return;
  const inactive = activeValue !== "Да";
  row.classList.toggle("employee-inactive", inactive);
  row.querySelectorAll(".employee-type-field").forEach((select) => {
    select.disabled = inactive;
  });
}

function selectedVacationEmployee() {
  const id = $("#vacationEmployeeSelect")?.value;
  return state.data.employees.find((employee) => employee.employee_id === id) ?? state.data.employees[0];
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
  return new Set((state.data.vacations ?? [])
    .filter((row) => row.employee_id === employeeId && String(row["Дата"]).startsWith(`${year}-`))
    .map((row) => row["Дата"]));
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
  const currentEmployee = employeeSelect.value || state.data.employees[0]?.employee_id || "";
  employeeSelect.innerHTML = state.data.employees
    .map((employee) => `<option value="${escapeHtml(employee.employee_id)}">${escapeHtml(employee["ФИО"])}</option>`)
    .join("");
  employeeSelect.value = state.data.employees.some((employee) => employee.employee_id === currentEmployee)
    ? currentEmployee
    : state.data.employees[0]?.employee_id ?? "";

  const currentYear = selectedVacationYear();
  const base = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, index) => base - 1 + index);
  yearSelect.innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join("");
  yearSelect.value = years.includes(currentYear) ? currentYear : base;
}

function renderVacationCalendar() {
  const employee = selectedVacationEmployee();
  if (!employee) return;
  const year = selectedVacationYear();
  const vacationDays = vacationDatesSet(employee.employee_id, year);
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

  $("#vacationSummaryName").textContent = `${employee["ФИО"]} · ${year}`;
  $("#vacationDaysCount").textContent = vacationDays.size;
  const periods = vacationPeriods(vacationDays);
  $("#vacationPeriods").innerHTML = periods.length
    ? `<h4>Периоды</h4>${periods.map(([start, end]) => `<div class="period-row">${formatRuDate(start)}${start === end ? "" : ` — ${formatRuDate(end)}`}</div>`).join("")}`
    : `<div class="muted">Отпусков в выбранном году пока нет.</div>`;
  $("#vacationWarning").classList.toggle("editing", state.vacationEdit);
  $("#vacationWarning").textContent = state.vacationEdit
    ? "Редактирование включено. Клики по календарю сразу сохраняются в Excel."
    : "Редактирование выключено. Чтобы менять отпуск, включите тумблер — тогда клики по календарю будут сразу сохраняться в Excel.";
}

function renderVacations() {
  renderVacationSelectors();
  renderVacationCalendar();
}

function renderQueues() {
  $("#queuesTable").innerHTML = state.data.queues.map((row) => `
    <tr>
      <td>${escapeHtml(row["Тип дела"])}</td>
      <td>${escapeHtml(row["Позиция"])}</td>
      <td>${escapeHtml(row["ФИО"])}</td>
      <td>
        <select class="inline-select queue-field" data-queue="${escapeHtml(row.queue_id)}" data-employee="${escapeHtml(row.employee_id)}" data-field="Долг">
          <option value="0" ${Number(row["Долг"]) !== 1 ? "selected" : ""}>0</option>
          <option value="1" ${Number(row["Долг"]) === 1 ? "selected" : ""}>1</option>
        </select>
      </td>
      <td><input class="inline-input queue-field" type="date" data-queue="${escapeHtml(row.queue_id)}" data-employee="${escapeHtml(row.employee_id)}" data-field="Дата долга" value="${escapeHtml(row["Дата долга"])}"></td>
      <td><button class="tiny-btn save-queue" data-queue="${escapeHtml(row.queue_id)}" data-employee="${escapeHtml(row.employee_id)}">Сохранить</button></td>
    </tr>
  `).join("");

  $("#stateTable").innerHTML = state.data.state.map((row) => `
    <tr>
      <td>${escapeHtml(row["Тип дела"])}</td>
      <td>${escapeHtml(row["Последняя позиция"])}</td>
      <td>${escapeHtml(row["Последний автоназначенный"] || "—")}</td>
      <td>${escapeHtml(row["Цикл"])}</td>
    </tr>
  `).join("");
}

function renderJournal() {
  $("#journalTable").innerHTML = state.data.journal.slice().reverse().slice(0, 250).map((row) => `
    <tr>
      <td>${escapeHtml(row["Дата события"])}</td>
      <td>${escapeHtml(row.case_id)}</td>
      <td>${escapeHtml(row["Тип дела"])}</td>
      <td>${escapeHtml(row["Ответственный"] || "—")}</td>
      <td>${badge(row["Способ"], row["Способ"] === "ручное" ? "orange" : row["Способ"] === "авто" ? "green" : "gray")}</td>
      <td>${escapeHtml(row["Основание"])}</td>
      <td><div class="cell-main">${escapeHtml(row["Комментарий"])}</div></td>
    </tr>
  `).join("");
}

function renderAll() {
  if (!state.data) return;
  renderSummary();
  renderWorkloadDashboard();
  renderManualSelect();
  renderYucRegionSelects();
  renderCases();
  renderEmployees();
  renderVacations();
  renderQueues();
  renderJournal();
}

function formDraft() {
  const form = $("#caseForm");
  const draft = {};
  new FormData(form).forEach((value, key) => {
    if (!["manualResponsible", "manualComment"].includes(key)) draft[key] = value;
  });
  return draft;
}

function manualFormValues() {
  const form = $("#caseForm");
  return {
    responsible: form.elements.manualResponsible.value,
    comment: form.elements.manualComment.value,
  };
}

function showRecommendation(result) {
  state.lastRecommendation = result;
  const badgeNode = $("#recommendationBadge");
  const personNode = $("#recommendationPerson");
  const metaNode = $("#recommendationMeta");
  if (result.ok) {
    badgeNode.className = "badge badge-green";
    badgeNode.textContent = "можно автоназначить";
    personNode.textContent = result.candidate;
    metaNode.textContent = `Основание: ${result.basis}. Позиция в очереди: ${result.position}.`;
  } else {
    badgeNode.className = "badge badge-orange";
    badgeNode.textContent = "нужно решение";
    personNode.textContent = "—";
    metaNode.textContent = result.reason;
  }
}

async function recommendCurrent() {
  const draft = formDraft();
  if (!draft["Тип дела"] || !draft["Предмет"]) {
    toast("Заполните тип дела и предмет.", "error");
    return null;
  }
  const payload = await api("/api/recommend", {
    method: "POST",
    body: JSON.stringify({ draft }),
  });
  showRecommendation(payload.result);
  return payload.result;
}

async function autoAssign() {
  const result = state.lastRecommendation ?? await recommendCurrent();
  if (!result) return;
  if (!result.ok) {
    toast("Автоназначение остановлено: нужен ручной выбор руководителя.", "error");
    return;
  }
  setStatus("Сохраняю в Excel…");
  const payload = await api("/api/assign-auto", {
    method: "POST",
    body: JSON.stringify({ draft: formDraft() }),
  });
  setDataFromPayload(payload);
  $("#caseForm").reset();
  renderYucRegionSelects();
  $("#caseForm").elements["Дата поступления"].value = today();
  showRecommendation({ ok: false, reason: "Заполните следующее дело и получите рекомендацию." });
  setStatus("Сохранено");
  toast(`Дело ${payload.case.case_id} назначено: ${payload.case["Ответственный"]}`);
}

async function manualAssign() {
  const draft = formDraft();
  const manual = manualFormValues();
  if (!draft["Тип дела"] || !draft["Предмет"]) {
    toast("Заполните тип дела и предмет.", "error");
    return;
  }
  if (!manual.responsible || !manual.comment.trim()) {
    toast("Для ручного назначения нужен ответственный и комментарий.", "error");
    return;
  }
  setStatus("Сохраняю в Excel…");
  const payload = await api("/api/assign-manual", {
    method: "POST",
    body: JSON.stringify({ draft, responsible: manual.responsible, comment: manual.comment }),
  });
  setDataFromPayload(payload);
  $("#caseForm").reset();
  renderYucRegionSelects();
  $("#caseForm").elements["Дата поступления"].value = today();
  showRecommendation({ ok: false, reason: "Ручное назначение сохранено. Очередь не сдвинута." });
  setStatus("Сохранено");
  toast(`Дело ${payload.case.case_id} назначено вручную: ${payload.case["Ответственный"]}`);
}

async function saveEmployee(employeeId) {
  const patch = {};
  $$(`.employee-field[data-id="${CSS.escape(employeeId)}"]`).forEach((input) => {
    patch[input.dataset.field] = input.value;
  });
  setStatus("Сохраняю сотрудника…");
  const payload = await api(`/api/employees/${encodeURIComponent(employeeId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  setDataFromPayload(payload);
  setStatus("Сохранено");
  toast("Данные сотрудника сохранены.");
}

async function saveQueue(queueId, employeeId) {
  const patch = {};
  $$(`.queue-field[data-queue="${CSS.escape(queueId)}"][data-employee="${CSS.escape(employeeId)}"]`).forEach((input) => {
    patch[input.dataset.field] = input.dataset.field === "Долг" ? Number(input.value) : input.value;
  });
  setStatus("Сохраняю очередь…");
  const payload = await api(`/api/queues/${encodeURIComponent(queueId)}/${encodeURIComponent(employeeId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  setDataFromPayload(payload);
  setStatus("Сохранено");
  toast("Очередь сохранена.");
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
  toast(`Ответственный по ${caseId} изменён: ${payload.case["Ответственный"]}`);
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

function caseDetailRows(row) {
  return [
    ["ID", row.case_id],
    ["Номер дела", row["Номер дела"]],
    ["Тип дела", row["Тип дела"]],
    ["Статус", row["Статус"]],
    ["Ответственный", row["Ответственный"] || "—"],
    ["ЮЦ", row["ЮЦ"]],
    ["Регион", row["Регион"]],
    ["Дата поступления", row["Дата поступления"]],
    ["Актуально", row["Актуально"]],
    ["Дата скрытия", row["Дата скрытия"]],
    ["Дней до скрытия", row["Дней до скрытия"]],
    ["Дата распределения", row["Дата распределения"]],
    ["Дата завершения", row["Дата завершения"]],
    ["Истец / заявитель", row["Истец"]],
    ["Ответчик", row["Ответчик"]],
    ["Третье лицо", row["Третье лицо"]],
    ["Предмет", row["Предмет"]],
    ["Основание", row["Основание"]],
    ["Комментарий", row["Комментарий"]],
    ["Ссылка", row["Ссылка"]],
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");
}

function openCaseModal(caseId) {
  const row = state.data.cases.find((item) => item.case_id === caseId);
  if (!row) return;
  $("#caseModalTitle").textContent = `Карточка ${row.case_id}`;
  $("#caseModalBody").innerHTML = `
    <table class="details-table">
      <tbody>
        ${caseDetailRows(row).map(([label, value]) => `
          <tr>
            <th>${escapeHtml(label)}</th>
            <td>${escapeHtml(value)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  $("#caseModal").classList.add("show");
  $("#caseModalOk").focus();
}

function closeCaseModal() {
  $("#caseModal").classList.remove("show");
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
  const confirmed = window.confirm(`Автоматически назначить дело ${caseId} сотруднику ${recommendation.result.candidate}?`);
  if (!confirmed) return;
  setStatus("Распределяю существующее дело…");
  const payload = await api(`/api/cases/${encodeURIComponent(caseId)}/assign-auto`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  setDataFromPayload(payload);
  setStatus("Сохранено");
  if (payload.result.ok) {
    toast(`Дело ${caseId} назначено: ${payload.case["Ответственный"]}`);
  } else {
    toast(payload.result.reason || "Автоназначение остановлено.", "error");
  }
}

async function assignExistingManual(caseId) {
  const caseRow = state.data.cases.find((row) => row.case_id === caseId);
  if (!caseRow) return;
  const names = state.data.employees.map((employee) => employee["ФИО"]).filter(Boolean);
  const responsible = window.prompt(
    `Введите ФИО ответственного для дела ${caseId}.\n\nДоступные сотрудники:\n${names.join("\n")}`,
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
  toast(`Дело ${caseId} назначено вручную: ${payload.case["Ответственный"]}`);
}

async function updateVacationDay(isoDate) {
  const employee = selectedVacationEmployee();
  if (!employee) return;
  setStatus("Сохраняю отпуск…");
  const payload = await api("/api/vacations/toggle", {
    method: "POST",
    body: JSON.stringify({ employee_id: employee.employee_id, date: isoDate }),
  });
  setDataFromPayload(payload);
  setStatus("Сохранено");
  toast(payload.enabled ? "День отпуска добавлен." : "День отпуска снят.");
}

async function updateVacationRange(start, end, action) {
  const employee = selectedVacationEmployee();
  if (!employee) return;
  const dates = eachDateInRange(start, end);
  if (!dates.length) return;
  setStatus("Сохраняю отпуск…");
  const payload = await api("/api/vacations/range", {
    method: "POST",
    body: JSON.stringify({ employee_id: employee.employee_id, start, end, action }),
  });
  state.vacationRangeStart = null;
  setDataFromPayload(payload);
  setStatus("Сохранено");
  toast(action === "clear" ? `Снят отпуск: ${dates.length} дн.` : `Добавлен отпуск: ${dates.length} дн.`);
}

async function handleVacationDateClick(isoDate) {
  if (!state.vacationEdit) {
    toast("Сначала включите редактирование отпусков.", "error");
    return;
  }
  if (state.vacationMode === "single") {
    await updateVacationDay(isoDate);
    return;
  }
  if (!state.vacationRangeStart) {
    state.vacationRangeStart = isoDate;
    renderVacationCalendar();
    toast("Выберите последнюю дату диапазона.");
    return;
  }
  const action = state.vacationMode === "clear-range" ? "clear" : "set";
  await updateVacationRange(state.vacationRangeStart, isoDate, action);
}

async function clearVacationYear() {
  if (!state.vacationEdit) {
    toast("Сначала включите редактирование отпусков.", "error");
    return;
  }
  const employee = selectedVacationEmployee();
  const year = selectedVacationYear();
  if (!employee) return;
  const confirmed = window.confirm(`Снять все отпуска ${employee["ФИО"]} за ${year} год?`);
  if (!confirmed) return;
  setStatus("Очищаю год…");
  const payload = await api("/api/vacations/clear-year", {
    method: "POST",
    body: JSON.stringify({ employee_id: employee.employee_id, year }),
  });
  state.vacationRangeStart = null;
  setDataFromPayload(payload);
  setStatus("Сохранено");
  toast("Отпуска за год очищены.");
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
  $$(".nav-link").forEach((link) => {
    link.addEventListener("click", () => showView(link.dataset.view));
  });
  $("#refreshBtn").addEventListener("click", loadData);
  $("#exitBtn").addEventListener("click", () => exitApplication());
  $("#caseModalOk").addEventListener("click", closeCaseModal);
  $("#caseModal").addEventListener("click", (event) => {
    if (event.target.id === "caseModal") closeCaseModal();
  });
  $("#recommendBtn").addEventListener("click", () => recommendCurrent().catch((error) => toast(error.message, "error")));
  $("#autoAssignBtn").addEventListener("click", () => autoAssign().catch((error) => {
    setStatus("Ошибка");
    toast(error.message, "error");
  }));
  $("#manualAssignBtn").addEventListener("click", () => manualAssign().catch((error) => {
    setStatus("Ошибка");
    toast(error.message, "error");
  }));
  $("#casesSearch").addEventListener("input", renderCases);
  $("#caseResponsibleEditToggle").addEventListener("change", (event) => {
    setResponsibleEditEnabled(event.target.checked);
  });
  $("#yucSelect").addEventListener("change", () => renderRegionSelect(""));
  $$(".subtab").forEach((button) => {
    button.addEventListener("click", () => {
      state.employeeSection = button.dataset.employeeSection;
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
  $("#clearVacationYearBtn").addEventListener("click", () => clearVacationYear().catch((error) => toast(error.message, "error")));
  document.addEventListener("click", (event) => {
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
    const queueButton = event.target.closest(".save-queue");
    if (queueButton) saveQueue(queueButton.dataset.queue, queueButton.dataset.employee).catch((error) => toast(error.message, "error"));
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
    const vacationDay = event.target.closest(".day-cell[data-date]");
    if (vacationDay) handleVacationDateClick(vacationDay.dataset.date).catch((error) => toast(error.message, "error"));
  });
  document.addEventListener("change", (event) => {
    if (event.target.matches(".case-status")) {
      if (!state.responsibleEditEnabled) return;
      updateStatusDraft(event.target.dataset.id, event.target.value);
    }
    if (event.target.matches(".responsible-select")) {
      updateResponsibleDraft(event.target.dataset.id, event.target.value);
    }
    if (event.target.matches(".employee-active-field")) {
      refreshEmployeeAvailabilityRow(event.target.dataset.id, event.target.value);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeCaseModal();
    }
  });
}

function init() {
  $("#caseForm").elements["Дата поступления"].value = today();
  bindEvents();
  loadData().catch((error) => {
    setStatus("Ошибка");
    toast(error.message, "error");
  });
}

init();
