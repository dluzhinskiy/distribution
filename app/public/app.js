import {
  displayName,
  employeeInitials,
  escapeHtml,
  nameMatches,
  normalizeCaseType,
  normalizeYucName,
  shortName,
  today,
  uniqueYucs as uniquePreserveOrder,
  workloadCaseType,
  yes,
  yesNo,
} from "./lib/ui-utils.js";
import { ApiError, isWriteRequest, requestJson, requestMethod, uploadBinary } from "./lib/api-client.js";
import { createAppState, viewTitles as titles } from "./lib/app-state.js";
import { groupAccessUsers } from "./lib/access-utils.js";
import {
  exactCaseCoefficient,
  formatWeightedLoad,
  loadCoefficientConfig,
  loadCoefficientTypes,
  weightedCases,
} from "./lib/load-coefficients.js";

const state = createAppState();
const rowsByYucIndex = new WeakMap();
const dataViewNames = ["dashboard", "distribution", "cases", "employees", "settings"];

const caseTypes = ["претензия", "административное", "судебное", "уголовное", "банкротное"];
const workloadCaseTypes = ["претензия", "административное", "судебное"];
const workloadTypes = ["все", ...workloadCaseTypes];
const statuses = ["В работе", "Ожидает распределения", "Завершено", "Отменено", "Приостановлено"];
const deletedStatus = "Удалено";
const completedStatuses = new Set(["Завершено", "Отменено", deletedStatus]);
const themeStorageKey = "mts-load-distribution-theme";
const blueTheme = "blue";
const redTheme = "red";
const caseColumnsStoragePrefix = "mts-load-distribution-case-columns-v1";
const weightedDashboardStorageKey = "mts-load-distribution-weighted-dashboard";
try { state.weightedDashboard = localStorage.getItem(weightedDashboardStorageKey) === "1"; } catch { /* localStorage may be unavailable */ }
const CASE_COLUMN_OPTIONS = [
  { key: "id", label: "ID", locked: true },
  { key: "type", label: "Тип дела" },
  { key: "subject", label: "Предмет" },
  { key: "claimant", label: "Истец / заявитель", detail: true },
  { key: "respondent", label: "Ответчик", detail: true },
  { key: "thirdParty", label: "Третье лицо", detail: true },
  { key: "region", label: "Регион" },
  { key: "receivedDate", label: "Дата поступления" },
  { key: "actual", label: "Актуально" },
  { key: "responsible", label: "Ответственный" },
  { key: "status", label: "Статус" },
  { key: "caseNumber", label: "Номер дела" },
  { key: "caseProLink", label: "Ссылка на CasePRO" },
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function currentRole() {
  return state.authUser?.role || "";
}

function isEmployeeUser() {
  return currentRole() === "Сотрудник";
}

function isAdminUser() {
  return currentRole() === "Администратор";
}

function isManagerUser() {
  return ["Руководитель", "Заместитель"].includes(currentRole());
}

function userYuc() {
  return normalizeYucName(state.authUser?.yuc || "");
}

function isExternalReadOnlyYuc() {
  return !isAdminUser() && Boolean(state.authUser?.yuc) && selectedYuc() !== userYuc();
}

function setAuthMessage(message = "", type = "") {
  const node = $("#authMessage");
  if (!node) return;
  node.textContent = message;
  node.className = `auth-message ${type ? `is-${type}` : ""}`;
}

function setAuthMode(mode = "login") {
  state.authMode = mode === "first" ? "first" : "login";
  $$(".auth-mode").forEach((button) => button.classList.toggle("active", button.dataset.authMode === state.authMode));
  $("#authLoginForm")?.classList.toggle("hidden", state.authMode !== "login");
  $("#authFirstAccessForm")?.classList.toggle("hidden", state.authMode !== "first");
  $("#authDescription").textContent = state.authMode === "first"
    ? "Введите одноразовый код, затем задайте личный пароль."
    : "Введите логин и пароль.";
  setAuthMessage("");
}

function applyRoleUi() {
  const employee = isEmployeeUser();
  const readOnly = isExternalReadOnlyYuc();
  document.body.classList.toggle("role-employee", employee);
  document.body.classList.toggle("role-admin", isAdminUser());
  document.body.classList.toggle("role-external-readonly", readOnly);
  $$(".nav-link").forEach((link) => {
    const view = link.dataset.view;
    const hidden = (employee || readOnly) ? view !== "cases" : view === "access" && !isAdminUser() && !isManagerUser();
    link.classList.toggle("hidden", hidden);
  });
  $(".yuc-switcher")?.classList.remove("hidden");
  $("#caseImportBtn")?.classList.toggle("hidden", employee || readOnly);
  $("#caseResponsibleEditToggle")?.closest("label")?.classList.toggle("hidden", employee || readOnly);
  $("#caseDeleteEditToggle")?.closest("label")?.classList.toggle("hidden", employee || readOnly);
  $("#showDeletedCasesToggle")?.closest("label")?.classList.toggle("hidden", employee || readOnly);
  $("#loadCoefficientsCard")?.classList.toggle("hidden", !isAdminUser());
  const accessDescription = $("#accessDescription");
  if (accessDescription) accessDescription.textContent = isAdminUser()
    ? "Выдавайте одноразовые коды первичного входа и назначайте роли. Код показывается один раз."
    : currentRole() === "Руководитель"
      ? "Выдавайте коды сотрудникам своего ЮЦ и назначайте им роли «Сотрудник» или «Заместитель». Код показывается один раз."
      : "Выдавайте одноразовые коды первичного входа сотрудникам своего ЮЦ. Код показывается один раз.";
  if (employee || readOnly) {
    state.responsibleEditEnabled = false;
    state.deleteEditEnabled = false;
    state.showDeletedCases = false;
    $$(".view").forEach((view) => view.classList.remove("active"));
    $("#view-cases")?.classList.add("active");
    $("#pageTitle").textContent = employee && state.caseListScope === "mine" ? "Мои дела" : "Реестр дел";
  }
}

function applyAuthUser(user) {
  state.authUser = user || null;
  if (user && !isAdminUser() && user.yuc) state.selectedYuc = normalizeYucName(user.yuc);
  state.caseListScope = user && isEmployeeUser() ? "mine" : "yuc";
  const node = $("#currentUser");
  if (node) node.textContent = user ? `${displayName(user.name)} · ${user.role}` : "";
  const exitButton = $("#exitBtn");
  if (exitButton) exitButton.textContent = isEmployeeUser() ? "Выйти" : "Выход";
  applyRoleUi();
}

function showAuthGate(message = "") {
  state.authUser = null;
  document.body.classList.add("auth-pending");
  $("#authGate")?.classList.add("show");
  setAuthMode("login");
  if (message) setAuthMessage(message, "error");
  setTimeout(() => $("#authLogin")?.focus(), 0);
}

function hideAuthGate() {
  document.body.classList.remove("auth-pending");
  $("#authGate")?.classList.remove("show");
  setAuthMessage("");
}

async function logIn(event) {
  event.preventDefault();
  const payload = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ login: $("#authLogin").value, password: $("#authPassword").value }),
  });
  applyAuthUser(payload.user);
  hideAuthGate();
  await loadData();
}

async function completeFirstAccess(event) {
  event.preventDefault();
  const password = $("#authFirstPassword").value;
  if (password !== $("#authFirstPasswordConfirm").value) {
    setAuthMessage("Пароли не совпадают.", "error");
    return;
  }
  const payload = await api("/api/auth/first-access", {
    method: "POST",
    body: JSON.stringify({ login: $("#authFirstLogin").value, code: $("#authFirstCode").value, password }),
  });
  applyAuthUser(payload.user);
  hideAuthGate();
  await loadData();
}

async function logOut() {
  await api("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
  state.data = null;
  state.accessUsers = [];
  state.loadedViews.clear();
  state.loadingViews.clear();
  state.caseRegistryRows = [];
  state.caseRegistryTotal = 0;
  state.caseRegistryTotalPages = 1;
  state.caseRegistryLoaded = false;
  state.caseRegistryRequestId += 1;
  state.accessExpandedYucs.clear();
  state.accessYucExpansionInitialized = false;
  showAuthGate("Вы вышли из приложения.");
}

async function loadAccessUsers({ force = false } = {}) {
  if (!isAdminUser() && !isManagerUser()) return;
  const payload = await api(`/api/access/users${force ? "?refresh=1" : ""}`);
  state.accessUsers = payload.users ?? [];
  renderAccessUsers();
}

function formatAccessExpiry(value) {
  if (!value) return "нет активного кода";
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? "нет активного кода" : `до ${date.toLocaleString("ru-RU")}`;
}

function renderAccessUsers() {
  const target = $("#accessUsersTable");
  if (!target || (!isAdminUser() && !isManagerUser())) return;
  const groups = groupAccessUsers(state.accessUsers);
  if (!state.accessYucExpansionInitialized && groups.length) {
    const ownYuc = userYuc();
    const ownGroup = ownYuc ? groups.find((group) => normalizeYucName(group.yuc) === ownYuc) : null;
    state.accessExpandedYucs.add(ownGroup?.yuc ?? groups[0].yuc);
    state.accessYucExpansionInitialized = true;
  }
  target.innerHTML = groups.map((group) => {
    const expanded = state.accessExpandedYucs.has(group.yuc);
    const groupKey = encodeURIComponent(group.yuc);
    const rows = group.users.map((user) => `
    <tr class="access-user-row ${expanded ? "" : "is-collapsed"}" data-access-yuc="${escapeHtml(groupKey)}">
      <td><strong>${escapeHtml(user.name || user.employeeId)}</strong><div class="muted">${escapeHtml(user.employeeId)}</div></td>
      <td>${escapeHtml(user.login || "—")}</td>
      <td>${user.canManageRole
        ? `<select class="inline-select access-role-select" data-employee-id="${escapeHtml(user.employeeId)}">${(user.roleOptions ?? []).map((role) => `<option value="${role}" ${user.role === role ? "selected" : ""}>${role}</option>`).join("")}</select>`
        : escapeHtml(user.role)}</td>
      <td>${user.hasPassword ? badge("установлен", "green") : badge("не задан", "gray")}</td>
      <td>${escapeHtml(formatAccessExpiry(user.firstAccessExpiresAt))}</td>
      <td><div class="access-actions">${user.canManageRole ? `<button class="tiny-btn light save-access-role" data-employee-id="${escapeHtml(user.employeeId)}">Сохранить роль</button>` : ""}${user.hasPassword
        ? `<button class="tiny-btn red reset-access-password" data-employee-id="${escapeHtml(user.employeeId)}">Сбросить пароль</button>`
        : `<button class="tiny-btn issue-access-code" data-employee-id="${escapeHtml(user.employeeId)}">Выдать код</button>`}</div></td>
    </tr>`).join("");
    return `
      <tr class="access-yuc-row">
        <td colspan="6">
          <button class="access-yuc-toggle" type="button" data-access-yuc="${escapeHtml(groupKey)}" aria-expanded="${expanded}">
            <span class="access-yuc-chevron" aria-hidden="true">›</span>
            <strong>${escapeHtml(group.label)}</strong>
            <span class="access-yuc-count">${group.users.length}</span>
          </button>
        </td>
      </tr>
      ${rows}`;
  }).join("") || `<tr><td colspan="6" class="empty-cell">Сотрудники не найдены.</td></tr>`;
}

function toggleAccessYuc(encodedYuc) {
  const yuc = decodeURIComponent(encodedYuc || "");
  if (state.accessExpandedYucs.has(yuc)) state.accessExpandedYucs.delete(yuc);
  else state.accessExpandedYucs.add(yuc);
  renderAccessUsers();
}

function closeAccessCodeModal() {
  $("#accessCodeModal")?.classList.remove("show");
  $("#accessCodeModal")?.setAttribute("aria-hidden", "true");
}

function showAccessCodeModal(user, code, expiresAt) {
  $("#accessCodeRecipient").textContent = `${user.name} · ${user.login}`;
  $("#accessCodeValue").textContent = code;
  $("#accessCodeExpiry").textContent = `Код действует ${formatAccessExpiry(expiresAt)}. Скопируйте и передайте его сотруднику — после закрытия окна увидеть код повторно нельзя.`;
  $("#accessCodeModal")?.classList.add("show");
  $("#accessCodeModal")?.setAttribute("aria-hidden", "false");
}

async function issueAccessCode(employeeId) {
  const user = state.accessUsers.find((item) => item.employeeId === employeeId);
  if (!user) return;
  const payload = await api(`/api/access/users/${encodeURIComponent(employeeId)}/first-access-code`, {
    method: "POST",
    body: JSON.stringify({ days: 7 }),
  });
  state.accessUsers = state.accessUsers.map((item) => item.employeeId === employeeId
    ? { ...item, firstAccessExpiresAt: payload.expiresAt }
    : item);
  renderAccessUsers();
  showAccessCodeModal(user, payload.code, payload.expiresAt);
}

async function resetAccessPassword(employeeId) {
  const user = state.accessUsers.find((item) => item.employeeId === employeeId);
  if (!user) return;
  const confirmed = window.confirm(`Сбросить пароль сотрудника «${displayName(user.name)}»?

Текущий пароль и все его активные сессии будут отключены. Система сформирует новый одноразовый код входа.`);
  if (!confirmed) return;
  const payload = await api(`/api/access/users/${encodeURIComponent(employeeId)}/password-reset`, {
    method: "POST",
    body: JSON.stringify({ days: 7 }),
  });
  state.accessUsers = state.accessUsers.map((item) => item.employeeId === employeeId
    ? { ...item, hasPassword: false, firstAccessExpiresAt: payload.expiresAt }
    : item);
  renderAccessUsers();
  showAccessCodeModal(user, payload.code, payload.expiresAt);
}

async function saveAccessRole(employeeId) {
  if (!isAdminUser() && currentRole() !== "Руководитель") return;
  const select = $(`.access-role-select[data-employee-id="${CSS.escape(employeeId)}"]`);
  if (!select) return;
  const payload = await api(`/api/access/users/${encodeURIComponent(employeeId)}`, {
    method: "PATCH",
    body: JSON.stringify({ role: select.value }),
  });
  state.accessUsers = state.accessUsers.map((item) => item.employeeId === employeeId
    ? {
      ...item,
      role: payload.user?.role ?? select.value,
      canManageRole: payload.user?.canManageRole ?? item.canManageRole,
      roleOptions: payload.user?.roleOptions ?? item.roleOptions,
    }
    : item);
  renderAccessUsers();
  toast("Роль доступа сохранена.");
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
  const canCopyError = kind === "error" && Boolean(state.lastApiError);
  node.classList.toggle("status-copyable", canCopyError);
  node.title = canCopyError ? "Нажмите, чтобы скопировать запись об ошибке" : "";
  node.setAttribute("role", canCopyError ? "button" : "status");
  node.tabIndex = canCopyError ? 0 : -1;
}

async function copyLastApiError() {
  if (!state.lastApiError) return;
  const text = JSON.stringify(state.lastApiError, null, 2);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  toast("Запись об ошибке скопирована в буфер обмена.");
}

function recordClientError(error, context = "Клиентское действие") {
  const message = error instanceof Error ? error.message : String(error ?? "Неизвестная ошибка");
  // Ошибка API уже содержит HTTP-статус и идентификатор ошибки — не заменяем
  // её менее подробной клиентской записью при обработке того же исключения.
  if (state.lastApiError?.path && state.lastApiError?.message === message) return;
  state.lastApiError = {
    timestamp: new Date().toISOString(),
    type: "client",
    context,
    message,
    stack: error instanceof Error ? (error.stack || "") : "",
  };
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
    try {
      return await requestJson(path, options);
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError(error.message || "Ошибка запроса", { path, method: requestMethod(options) });
      if (apiError.status === 401 && !path.startsWith("/api/auth/")) showAuthGate(apiError.message || "Требуется вход в приложение.");
      state.lastApiError = {
        timestamp: new Date().toISOString(),
        method: apiError.method,
        path: apiError.path,
        status: apiError.status,
        errorId: apiError.errorId,
        code: apiError.code,
        message: apiError.message,
      };
      throw apiError;
    }
  } finally {
    if (shouldLock) endWriteLock();
  }
}

async function uploadVacationWorkbook(file) {
  beginWriteLock();
  try {
    return await uploadBinary("/api/vacations/import-preview", file);
  } finally {
    endWriteLock();
  }
}

async function uploadCaseWorkbook(file) {
  beginWriteLock();
  try {
    return await uploadBinary(`/api/cases/import-preview?yuc=${encodeURIComponent(state.caseImportYuc)}`, file);
  } finally {
    endWriteLock();
  }
}

async function loadData({ view = activeDataViewName(), force = false } = {}) {
  if (state.loadingViews.has(view)) return;
  state.loadingViews.add(view);
  setStatus("Читаю MTS Tabs…");
  try {
    const query = new URLSearchParams({ view });
    if (force) query.set("refresh", "1");
    const payload = await api(`/api/data?${query}`);
    applyDataPayload(payload);
    state.loadedViews.add(view);
    if (view === "cases") await loadCaseRegistry({ page: state.casesPage, force });
    setStatus("Готово");
  } finally {
    state.loadingViews.delete(view);
  }
}

async function loadCaseRegistry({ page = 1, force = false } = {}) {
  if (!state.data) return;
  const requestId = ++state.caseRegistryRequestId;
  state.caseRegistryLoading = true;
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(state.casesPageSize),
    scope: state.caseListScope,
    yuc: selectedYuc(),
  });
  const search = String($("#casesSearch")?.value ?? "").trim();
  if (search) query.set("search", search);
  if (state.casesQuickFilter) query.set("quickFilter", state.casesQuickFilter);
  if (state.casesResponsibleFilter) query.set("responsible", state.casesResponsibleFilter);
  if (state.casesCellFilter?.field && state.casesCellFilter?.value) {
    query.set("cellField", state.casesCellFilter.field);
    query.set("cellValue", state.casesCellFilter.value);
  }
  if (state.showDeletedCases) query.set("showDeleted", "1");
  if (force) query.set("refresh", "1");
  try {
    const payload = await api(`/api/case-register?${query}`);
    if (requestId !== state.caseRegistryRequestId) return;
    state.caseRegistryRows = payload.rows ?? [];
    state.caseRegistryTotal = Number(payload.total) || 0;
    state.caseRegistryTotalPages = Math.max(1, Number(payload.totalPages) || 1);
    state.casesPage = Math.max(1, Number(payload.page) || 1);
    state.caseRegistryLoaded = true;
    const rowsById = new Map((state.data.cases ?? []).map((row) => [row.case_id, row]));
    for (const row of state.caseRegistryRows) rowsById.set(row.case_id, row);
    state.data.cases = [...rowsById.values()];
    markDataViewsDirty(["cases"]);
    renderCases();
  } finally {
    if (requestId === state.caseRegistryRequestId) state.caseRegistryLoading = false;
  }
}

function applyDataPayload(payload = {}) {
  if (!payload.data) return;
  const nextData = { ...payload.data };
  state.data = {
    ...(state.data ?? {}),
    ...nextData,
    directories: nextData.directories ?? state.data?.directories,
  };
  if (payload.user) applyAuthUser(payload.user);
  state.storagePath = payload.storagePath || state.storagePath;
  if ($("#storagePath")) $("#storagePath").textContent = state.storagePath || "MTS Tabs API";
  markDataViewsDirty();
  renderAll();
}

function setDataFromPayload(payload) {
  if (payload.data) {
    applyDataPayload(payload);
  }
  if (payload.case && state.data) {
    const index = (state.data.cases ?? []).findIndex((row) => row.case_id === payload.case.case_id);
    if (index >= 0) state.data.cases[index] = payload.case;
    else state.data.cases = [...(state.data.cases ?? []), payload.case];
    const registryIndex = state.caseRegistryRows.findIndex((row) => row.case_id === payload.case.case_id);
    if (registryIndex >= 0) state.caseRegistryRows[registryIndex] = payload.case;
    markDataViewsDirty(["dashboard", "distribution", "cases", "employees"]);
    renderAll();
  }
  if (payload.queue && state.data) {
    const key = `${payload.queue.queue_id}::${payload.queue.employee_id}`;
    state.data.queues = (state.data.queues ?? []).map((row) => (
      `${row.queue_id}::${row.employee_id}` === key ? payload.queue : row
    ));
    markDataViewsDirty(["distribution", "employees"]);
    renderAll();
  }
}

function mergeChangedCases(changedCases = [], employees = null) {
  if (!state.data || !Array.isArray(changedCases) || !changedCases.length) return;
  const changedById = new Map(changedCases.map((row) => [row.case_id, row]));
  const existingIds = new Set((state.data.cases ?? []).map((row) => row.case_id));
  state.data.cases = (state.data.cases ?? []).map((row) => changedById.get(row.case_id) ?? row);
  for (const row of changedCases) {
    if (!existingIds.has(row.case_id)) state.data.cases.push(row);
  }
  const registryChanges = new Map(changedCases.map((row) => [row.case_id, row]));
  state.caseRegistryRows = state.caseRegistryRows.map((row) => registryChanges.get(row.case_id) ?? row);
  if (Array.isArray(employees)) state.data.employees = employees;
  markDataViewsDirty(["dashboard", "distribution", "cases", "employees"]);
  renderAll();
}

function showView(name) {
  if (isEmployeeUser() && name !== "cases") name = "cases";
  $$(".view").forEach((view) => view.classList.remove("active"));
  $(`#view-${name}`).classList.add("active");
  $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.view === name));
  $("#pageTitle").textContent = name === "cases" && state.caseListScope === "mine" ? "Мои дела" : titles[name];
  if (state.data && dataViewNames.includes(name) && !state.loadedViews.has(name)) {
    loadData({ view: name }).catch((error) => { setStatus("Ошибка"); toast(error.message, "error"); });
  } else if (state.data) renderDataView(name);
  if (name === "access") {
    if (state.accessUsers.length) renderAccessUsers();
    else loadAccessUsers().catch((error) => { setStatus("Ошибка"); toast(error.message, "error"); });
  }
}

function badge(text, kind = "gray") {
  return `<span class="badge badge-${kind}">${escapeHtml(text)}</span>`;
}

const caseCellFilterFields = new Set([
  "Тип дела",
  "Статус",
  "Ответственный",
  "Регион",
  "Истец",
  "Ответчик",
  "Третье лицо",
  "Дата поступления",
]);

function canUseCaseCellFilters() {
  return !state.responsibleEditEnabled && !state.deleteEditEnabled;
}

function caseFilterValue(field, value, html = null, className = "") {
  const text = String(value ?? "").trim();
  if (!text || !caseCellFilterFields.has(field)) return html ?? escapeHtml(text);
  const active = canUseCaseCellFilters();
  return `
    <button
      class="case-cell-filter ${className} ${active ? "" : "is-disabled"}"
      type="button"
      data-case-filter-field="${escapeHtml(field)}"
      data-case-filter-value="${escapeHtml(text)}"
      ${active ? "" : "tabindex=\"-1\""}
      title="${active ? `Фильтр: ${field} = ${text}` : ""}"
    >${html ?? escapeHtml(text)}</button>
  `;
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

function availableYucs() {
  if (!state.data) return ["Дальний Восток"];
  const yucs = uniquePreserveOrder([
    ...(state.data.directories?.yucs ?? []),
    ...(state.data.employees ?? []).map((row) => row["ЮЦ"]),
    ...(state.data.cases ?? []).map((row) => row["ЮЦ"]),
    ...(state.data.queues ?? []).map((row) => row["ЮЦ"]),
    ...(state.data.state ?? []).map((row) => row["ЮЦ"]),
  ]);
  // КЦ показываем после всех региональных ЮЦ, в том числе после «Юг».
  return yucs.length
    ? yucs.slice().sort((left, right) => (left === "КЦ") - (right === "КЦ"))
    : ["Дальний Восток"];
}

function ensureSelectedYuc() {
  const yucs = availableYucs();
  const current = normalizeYucName(state.selectedYuc);
  const preferred = !isAdminUser() && state.authUser?.yuc ? userYuc() : "";
  state.selectedYuc = yucs.includes(current) ? current : (yucs.find((yuc) => yuc === preferred) ?? yucs[0]);
  return state.selectedYuc;
}

function selectedYuc() {
  return ensureSelectedYuc();
}

function yucMatches(value) {
  return normalizeYucName(value) === selectedYuc();
}

function rowsForSelectedYuc(rows) {
  if (!Array.isArray(rows)) return [];
  let index = rowsByYucIndex.get(rows);
  if (!index) {
    index = new Map();
    for (const row of rows) {
      const yuc = normalizeYucName(row["ЮЦ"]);
      if (!index.has(yuc)) index.set(yuc, []);
      index.get(yuc).push(row);
    }
    rowsByYucIndex.set(rows, index);
  }
  return index.get(selectedYuc()) ?? [];
}

function employeesForSelectedYuc() {
  return rowsForSelectedYuc(state.data?.employees);
}

function casesForSelectedYuc() {
  const cases = rowsForSelectedYuc(state.data?.cases);
  if (isEmployeeUser() && !isExternalReadOnlyYuc()) {
    return cases.filter((row) => nameMatches(row["Ответственный"], state.authUser?.name));
  }
  return cases;
}

function canUseMyCasesScope() {
  return !isAdminUser() && Boolean(String(state.authUser?.name ?? "").trim());
}

function casesForRegistry() {
  if (state.caseRegistryLoaded) return state.caseRegistryRows;
  if (state.caseListScope === "mine" && canUseMyCasesScope()) {
    return (state.data?.cases ?? []).filter((row) => nameMatches(row["Ответственный"], state.authUser?.name));
  }
  // Вкладки ЮЦ всегда показывают весь реестр выбранного ЮЦ, независимо от роли.
  return rowsForSelectedYuc(state.data?.cases);
}

function selectCaseListScope(scope) {
  state.caseListScope = scope === "mine" && canUseMyCasesScope() ? "mine" : "yuc";
  state.casesQuickFilter = "";
  state.casesResponsibleFilter = "";
  state.casesCellFilter = null;
  if ($("#casesSearch")) $("#casesSearch").value = "";
  showView("cases");
  renderYucTabs();
  if (state.loadedViews.has("cases")) {
    loadCaseRegistry({ page: 1 }).catch((error) => toast(error.message, "error"));
  }
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

function deadlineSettingForType(type) {
  const normalized = String(type ?? "").trim().toLowerCase();
  const row = rowsForSelectedYuc(state.data?.settings).find((item) => normalizeCaseType(item["Тип дела"]) === normalized);
  const rawOverloadThreshold = String(row?.["Порог перегруза"] ?? "").trim();
  const overloadThreshold = Number(rawOverloadThreshold);
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
    "Порог перегруза": rawOverloadThreshold && Number.isFinite(overloadThreshold) && overloadThreshold >= 0
      ? overloadThreshold
      : 5,
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

function deadlineSettingsForSelectedYuc() {
  return workloadCaseTypes.map(deadlineSettingForType);
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
    byType: workloadCaseTypes.map((type) => {
      const typeRows = productionCases.filter((caseRow) => workloadCaseType(caseRow["Тип дела"]) === type);
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
  state.caseListScope = "yuc";
  const next = normalizeYucName(yuc);
  const changed = next !== state.selectedYuc;
  state.selectedYuc = next;
  if (changed) {
    state.casesPage = 1;
    state.lastRecommendation = null;
    state.vacationRangeStart = null;
    state.responsibleDrafts = {};
    state.statusDrafts = {};
    state.resetRegionOnRender = options.resetRegion !== false;
    markDataViewsDirty();
  }
  if (isExternalReadOnlyYuc()) showView("cases");
  applyRoleUi();
  renderAll();
  if (changed && activeDataViewName() === "cases" && state.caseRegistryLoaded) {
    loadCaseRegistry({ page: 1 }).catch((error) => toast(error.message, "error"));
  }
  scheduleRecommendation();
}

function renderYucTabs() {
  const container = $("#yucTabs");
  if (!container) return;
  const current = selectedYuc();
  const mine = canUseMyCasesScope()
    ? `<button class="yuc-tab yuc-tab-mine ${state.caseListScope === "mine" ? "active" : ""}" data-case-scope="mine" type="button">Мои дела</button>`
    : "";
  container.innerHTML = mine + availableYucs()
    .map((yuc) => `
      <button class="yuc-tab ${state.caseListScope === "yuc" && yuc === current ? "active" : ""}" data-yuc="${escapeHtml(yuc)}" type="button">
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
          : item.total
            ? `
              ${item.active ? `<div class="type-load-bar active" style="width:${Math.round((item.active / Math.max(item.total, 1)) * 100)}%"></div>` : ""}
              ${item.inactive ? `<div class="type-load-bar inactive" style="width:${Math.round((item.inactive / Math.max(item.total, 1)) * 100)}%"></div>` : ""}
            `
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
          ${badge(row["Тип дела"], workloadCaseType(row["Тип дела"]) === "судебное" ? "blue" : row["Тип дела"] === "претензия" ? "green" : "orange")}
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

function caseCellFilterLabel() {
  const filter = state.casesCellFilter;
  if (!filter?.field || !filter.value) return "";
  const value = filter.field === "Ответственный" ? displayName(filter.value) : filter.value;
  return `${filter.field}: ${value}`;
}

function caseMatchesCellFilter(row) {
  const filter = state.casesCellFilter;
  if (!filter?.field || !filter.value) return true;
  const current = String(row[filter.field] ?? "").trim();
  if (filter.field === "Ответственный") return nameMatches(current, filter.value);
  if (filter.field === "Тип дела" && workloadCaseTypes.includes(filter.value)) return workloadCaseType(current) === filter.value;
  return current === filter.value;
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
  const cellFilterLabel = caseCellFilterLabel();
  if (cellFilterLabel) {
    chips.push(`
      <span class="quick-filter-chip">
        ${escapeHtml(cellFilterLabel)}
        <button type="button" id="clearCasesCellFilter" aria-label="Сбросить фильтр по полю">×</button>
      </span>
    `);
  }
  node.innerHTML = chips.join("");
}

function employeeParticipatesInCaseType(employee, type) {
  if (workloadCaseType(type) === "судебное") return yes(employee["Судебные"]);
  if (type === "административное") return yes(employee["Административные"]);
  if (type === "претензия") return yes(employee["Претензии"]);
  return false;
}

function ensureHistoricalDefaults() {
  if (state.historicalAllTime) return;
  if (state.historicalInitialized) return;
  const now = new Date();
  state.historicalFrom = dateISO(now.getFullYear(), 0, 1);
  state.historicalTo = today();
  state.historicalInitialized = true;
  state.historicalPeriodPreset = "current-year";
}

function historicalDateLabel() {
  return state.historicalDateMode === "completed" ? "по дате завершения; в работе — по назначению" : "по дате назначения";
}

function historicalDateValue(row) {
  if (state.historicalDateMode === "completed") {
    return String(row["Дата завершения"] || row["Дата распределения"] || row["Дата поступления"] || "").trim();
  }
  return String(row["Дата распределения"] || row["Дата поступления"] || "").trim();
}

function caseWithinHistoricalPeriod(row) {
  const value = historicalDateValue(row);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (state.historicalFrom && value < state.historicalFrom) return false;
  if (state.historicalTo && value > state.historicalTo) return false;
  return true;
}

function isHistoricalCase(row) {
  const responsible = String(row["Ответственный"] ?? "").trim();
  const status = String(row["Статус"] ?? "").trim();
  if (!responsible || isDeletedCase(row) || status === "Ожидает распределения" || status === "Отменено") return false;
  return status === "Завершено" || !completedStatuses.has(status);
}

function historicalCasesForSelectedYuc() {
  ensureHistoricalDefaults();
  return casesForSelectedYuc()
    .filter(isHistoricalCase)
    .filter(caseWithinHistoricalPeriod);
}

function casesGroupedByEmployee(rows, employees) {
  const result = new Map(employees.map((employee) => [employee.employee_id, []]));
  const aliases = new Map();
  for (const employee of employees) {
    const name = String(employee["ФИО"] ?? "").trim();
    for (const alias of new Set([name, shortName(name)].filter(Boolean))) {
      if (!aliases.has(alias)) aliases.set(alias, []);
      aliases.get(alias).push(employee);
    }
  }
  for (const row of rows) {
    const responsible = String(row["Ответственный"] ?? "").trim();
    if (!responsible) continue;
    const candidates = new Map([
      ...(aliases.get(responsible) ?? []),
      ...(aliases.get(shortName(responsible)) ?? []),
    ].map((employee) => [employee.employee_id, employee]));
    for (const employee of candidates.values()) {
      if (nameMatches(responsible, employee["ФИО"])) result.get(employee.employee_id)?.push(row);
    }
  }
  return result;
}

function historicalWorkloadByEmployee() {
  const rows = historicalCasesForSelectedYuc();
  const employees = employeesForSelectedYuc();
  const groupedCases = casesGroupedByEmployee(rows, employees);
  const coefficientConfig = currentLoadCoefficientConfig();
  const weighted = state.weightedDashboard && coefficientConfig.valid;
  return employees.map((employee) => {
    const employeeCases = groupedCases.get(employee.employee_id) ?? [];
    const byType = Object.fromEntries(workloadCaseTypes.map((type) => [
      type,
      employeeCases.filter((caseRow) => workloadCaseType(caseRow["Тип дела"]) === type).length,
    ]));
    const weightedByType = Object.fromEntries(workloadCaseTypes.map((type) => [
      type,
      weightedCases(employeeCases.filter((caseRow) => workloadCaseType(caseRow["Тип дела"]) === type), coefficientConfig),
    ]));
    const completed = employeeCases.filter((caseRow) => caseRow["Статус"] === "Завершено").length;
    const inWork = employeeCases.length - completed;
    return {
      employee,
      cases: employeeCases,
      byType,
      weightedByType,
      total: employeeCases.length,
      weightedTotal: weightedCases(employeeCases, coefficientConfig),
      completed,
      inWork,
    };
  }).sort((a, b) => (weighted ? b.weightedTotal - a.weightedTotal : b.total - a.total) || a.employee["ФИО"].localeCompare(b.employee["ФИО"], "ru"));
}

function setHistoricalPreset(preset) {
  if (preset === "custom") {
    state.historicalAllTime = false;
    state.historicalInitialized = true;
    state.historicalPeriodPreset = "custom";
    renderWorkloadDashboard();
    return;
  }
  const now = new Date();
  const end = dateISO(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(now);
  if (preset === "month") {
    start.setMonth(start.getMonth() - 1);
  } else if (preset === "quarter") {
    start.setMonth(start.getMonth() - 3);
  } else if (preset === "year") {
    start.setFullYear(start.getFullYear() - 1);
  } else if (preset === "current-year") {
    start.setMonth(0, 1);
  } else {
    state.historicalAllTime = true;
    state.historicalInitialized = true;
    state.historicalPeriodPreset = "all";
    state.historicalFrom = "";
    state.historicalTo = "";
    renderWorkloadDashboard();
    return;
  }
  state.historicalAllTime = false;
  state.historicalInitialized = true;
  state.historicalPeriodPreset = preset;
  state.historicalFrom = dateISO(start.getFullYear(), start.getMonth(), start.getDate());
  state.historicalTo = end;
  renderWorkloadDashboard();
}

function historicalPresetButton(preset, label) {
  const active = state.historicalPeriodPreset === preset;
  return `
    <button
      class="tiny-btn light historical-preset ${active ? "active" : ""}"
      type="button"
      data-preset="${escapeHtml(preset)}"
      aria-pressed="${active ? "true" : "false"}"
    ><span class="historical-preset-check" aria-hidden="true">✓</span>${escapeHtml(label)}</button>
  `;
}

function applyHistoricalCaseFilter(responsible, type = "") {
  state.casesResponsibleFilter = responsible || "";
  state.casesQuickFilter = "";
  state.casesCellFilter = type ? { field: "Тип дела", value: type } : null;
  if ($("#casesSearch")) $("#casesSearch").value = "";
  showView("cases");
  renderCases();
}

function workloadByEmployee() {
  const yucCases = casesForSelectedYuc();
  const employees = employeesForSelectedYuc();
  const groupedCases = casesGroupedByEmployee(yucCases, employees);
  const includeInactive = includeInactiveInLoadForSelectedYuc();
  return employees.map((employee) => {
    const productionCases = (groupedCases.get(employee.employee_id) ?? [])
      .filter((caseRow) => !completedStatuses.has(caseRow["Статус"]));
    const byType = Object.fromEntries(workloadCaseTypes.map((type) => {
      const rows = productionCases.filter((caseRow) => workloadCaseType(caseRow["Тип дела"]) === type);
      const active = rows.filter((caseRow) => Number(caseRow["Активное число"]) === 1).length;
      const inactive = rows.length - active;
      return [type, {
        active,
        inactive,
        total: rows.length,
        load: includeInactive ? rows.length : active,
      }];
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

function coefficientLegendHtml(config = currentLoadCoefficientConfig()) {
  return `
    <div class="coefficient-legend" aria-label="Коэффициенты приведённой нагрузки">
      <span class="coefficient-legend-title">Коэффициенты</span>
      ${loadCoefficientTypes.map((type) => `
        <span class="coefficient-chip">
          <span>${escapeHtml(type.charAt(0).toUpperCase() + type.slice(1))}</span>
          <strong>× ${formatWeightedLoad(config.values[type])}</strong>
        </span>
      `).join("")}
    </div>
  `;
}

function weightedBreakdownText(rows, config = currentLoadCoefficientConfig()) {
  const counts = new Map();
  for (const row of rows ?? []) {
    const type = normalizeCaseType(row["Тип дела"]);
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  return loadCoefficientTypes
    .filter((type) => counts.has(type))
    .map((type) => `${type}: ${counts.get(type)} × ${formatWeightedLoad(config.values[type])} = ${formatWeightedLoad(counts.get(type) * config.values[type])}`)
    .join("; ");
}

function historicalSegmentClass(type) {
  if (type === "претензия") return "claim";
  if (type === "административное") return "admin";
  if (type === "судебное") return "court";
  return "other";
}

function renderHistoricalWorkloadDashboard() {
  ensureHistoricalDefaults();
  const coefficientConfig = currentLoadCoefficientConfig();
  const weighted = state.weightedDashboard && coefficientConfig.valid;
  const rows = historicalWorkloadByEmployee();
  const maxTotal = Math.max(...rows.map((row) => weighted ? row.weightedTotal : row.total), 1);
  const totalCases = rows.reduce((sum, row) => sum + row.total, 0);
  const totalWeighted = rows.reduce((sum, row) => sum + row.weightedTotal, 0);
  const periodLabel = state.historicalFrom || state.historicalTo
    ? `${state.historicalFrom ? formatRuDateDash(state.historicalFrom) : "начало"} — ${state.historicalTo ? formatRuDateDash(state.historicalTo) : "сегодня"}`
    : "всё время";
  $("#workloadDashboard").innerHTML = `
    <div class="historical-controls">
      <label class="field compact">
        <span>Режим даты</span>
        <select id="historicalDateMode">
          <option value="assigned" ${state.historicalDateMode === "assigned" ? "selected" : ""}>По дате назначения</option>
          <option value="completed" ${state.historicalDateMode === "completed" ? "selected" : ""}>По дате завершения</option>
        </select>
      </label>
      <div class="historical-presets" aria-label="Быстрый выбор периода">
        ${historicalPresetButton("month", "Месяц")}
        ${historicalPresetButton("quarter", "Квартал")}
        ${historicalPresetButton("current-year", "Текущий год")}
        ${historicalPresetButton("year", "Год")}
        ${historicalPresetButton("all", "Всё время")}
        ${historicalPresetButton("custom", "Произвольный")}
      </div>
    </div>
    <div class="historical-custom-period ${state.historicalPeriodPreset === "custom" ? "" : "is-locked"}" aria-label="Границы выбранного периода">
        <label class="field compact">
          <span>С даты</span>
          <input type="date" id="historicalFrom" value="${escapeHtml(state.historicalFrom)}" ${state.historicalPeriodPreset === "custom" ? "" : "disabled"} />
        </label>
        <label class="field compact">
          <span>По дату</span>
          <input type="date" id="historicalTo" value="${escapeHtml(state.historicalTo)}" ${state.historicalPeriodPreset === "custom" ? "" : "disabled"} />
        </label>
    </div>
    <div class="historical-mode-row">
      <label
        class="toggle-inline weighted-dashboard-toggle ${coefficientConfig.valid ? "" : "disabled"}"
        title="${escapeHtml(coefficientConfig.valid ? "Пересчитать историческую нагрузку по глобальным коэффициентам" : `Приведённая нагрузка недоступна: ${coefficientConfig.errors.join("; ")}`)}"
      >
        <input id="weightedDashboardToggle" type="checkbox" ${weighted ? "checked" : ""} ${coefficientConfig.valid ? "" : "disabled"} />
        <span class="switch-ui"></span>
        <span>Приведённая нагрузка</span>
      </label>
      <span class="historical-mode-hint">${weighted ? "Полоса показывает итог с учётом коэффициентов." : "Полоса разделена по типам нагрузки."}</span>
    </div>
    <div class="historical-summary-line">
      <span>${escapeHtml(periodLabel)}</span>
      <span>${escapeHtml(historicalDateLabel())}</span>
      <span>${totalCases} дел</span>
      ${weighted ? `<span><strong>${formatWeightedLoad(totalWeighted)}</strong> приведённой нагрузки</span>` : ""}
    </div>
    ${weighted
      ? coefficientLegendHtml(coefficientConfig)
      : `<div class="historical-legend">
          <span><i class="historical-dot claim"></i>Претензии</span>
          <span><i class="historical-dot admin"></i>Административные</span>
          <span><i class="historical-dot court"></i>Судебные</span>
        </div>`}
    <div class="historical-chart">
      ${rows.map((row) => {
        const displayedTotal = weighted ? row.weightedTotal : row.total;
        const totalWidth = displayedTotal ? Math.max(6, Math.round((displayedTotal / maxTotal) * 100)) : 0;
        return `
          <div class="historical-row ${row.total ? "" : "empty"}">
            <div class="historical-employee">
              <div class="avatar avatar-sm">${escapeHtml(employeeInitials(row.employee["ФИО"]))}</div>
              <div>
                <button
                  type="button"
                  class="workload-employee-link historical-filter"
                  data-responsible="${escapeHtml(row.employee["ФИО"])}"
                  title="Показать дела сотрудника"
                >${escapeHtml(displayName(row.employee["ФИО"]))}</button>
                <span>${row.completed} завершено · ${row.inWork} в работе</span>
              </div>
            </div>
            <div class="historical-bar-shell" title="${escapeHtml(displayName(row.employee["ФИО"]))}: ${weighted ? `${formatWeightedLoad(row.weightedTotal)} приведённой нагрузки` : `${row.total} дел`}">
              <div class="historical-bar-stack" style="width:${totalWidth}%">
                ${weighted ? row.weightedTotal ? `
                  <button
                    type="button"
                    class="historical-segment weighted historical-filter"
                    style="width:100%"
                    data-responsible="${escapeHtml(row.employee["ФИО"])}"
                    title="${escapeHtml(`${displayName(row.employee["ФИО"])}: ${formatWeightedLoad(row.weightedTotal)}; ${weightedBreakdownText(row.cases, coefficientConfig)}`)}"
                  ><span>${formatWeightedLoad(row.weightedTotal)}</span></button>
                ` : "" : workloadCaseTypes.map((type) => {
                  const count = row.byType[type] || 0;
                  const width = displayedTotal ? Math.round((count / displayedTotal) * 100) : 0;
                  if (!count) return "";
                  return `
                    <button
                      type="button"
                      class="historical-segment ${historicalSegmentClass(type)}"
                      style="width:${width}%"
                      data-responsible="${escapeHtml(row.employee["ФИО"])}"
                      data-type="${escapeHtml(type)}"
                      title="${escapeHtml(displayName(row.employee["ФИО"]))}: ${escapeHtml(type)} — ${count}"
                    ><span>${count}</span></button>
                  `;
                }).join("")}
              </div>
            </div>
            <div class="historical-total">
              <strong>${weighted ? formatWeightedLoad(row.weightedTotal) : row.total}</strong>
              <span>${weighted ? `${row.total} дел` : workloadCaseTypes.map((type) => `${row.byType[type] || 0}`).join(" / ")}</span>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderWorkloadDashboard() {
  const title = $("#workloadCardTitle");
  const subtitle = $("#workloadCardSubtitle");
  const badgeNode = $("#workloadCardBadge");
  const toggle = $("#toggleHistoricalDashboard");
  const coefficientConfig = currentLoadCoefficientConfig();
  if (state.weightedDashboard && !coefficientConfig.valid) state.weightedDashboard = false;
  const historicalWeighted = state.historicalDashboard && state.weightedDashboard && coefficientConfig.valid;
  if (title) title.textContent = state.historicalDashboard ? "Историческая нагрузка сотрудников" : "Нагрузка сотрудников в производстве";
  if (subtitle) {
    subtitle.textContent = historicalWeighted
      ? "Историческая нагрузка пересчитана по действующим глобальным коэффициентам."
      : state.historicalDashboard
        ? "Назначенные дела за выбранный период: завершённые и те, которые ещё находятся в работе."
        : "Ярким показаны активные дела, полупрозрачным — незавершённые дела, которые уже не активны по сроку актуальности.";
  }
  if (badgeNode) {
    badgeNode.textContent = historicalWeighted ? "приведённая" : state.historicalDashboard ? "история" : "по типам нагрузки";
    badgeNode.className = `badge ${state.historicalDashboard ? "badge-blue" : "badge-red"}`;
  }
  if (toggle) {
    toggle.classList.toggle("active", state.historicalDashboard);
    toggle.title = state.historicalDashboard ? "Вернуться к текущей нагрузке" : "Показать историческую нагрузку";
    toggle.setAttribute("aria-label", toggle.title);
  }
  const card = $(".workload-card");
  card?.classList.toggle("show-history", state.historicalDashboard);
  if (state.historicalDashboard) {
    renderHistoricalWorkloadDashboard();
    return;
  }
  const rows = workloadByEmployee();
  const includeInactive = includeInactiveInLoadForSelectedYuc();
  const loadModeText = includeInactive ? "активные + неактивные незавершённые" : "только активные";
  const maxTotal = Math.max(...rows.flatMap((row) => workloadCaseTypes.map((type) => {
    const item = row.byType[type];
    return includeInactive ? item.load : item.total;
  })), 1);
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
      ${workloadCaseTypes.map((type) => `<div class="workload-header">${escapeHtml(type)}</div>`).join("")}
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
        ${workloadCaseTypes.map((type) => {
          const item = row.byType[type];
          const activeValue = item.active;
          const inactiveValue = item.inactive;
          const loadValue = item.load;
          const activeWidth = activeValue ? Math.max(8, Math.round((activeValue / maxTotal) * 100)) : 0;
          const inactiveWidth = inactiveValue ? Math.max(8, Math.round((inactiveValue / maxTotal) * 100)) : 0;
          const loadWidth = loadValue ? Math.max(8, Math.round((loadValue / maxTotal) * 100)) : 0;
          return `
            <div class="workload-cell">
              <div class="workload-count">
                <strong>${item.load}</strong>
                <span>${includeInactive ? "в расчёте" : `${item.active} / ${item.inactive}`}</span>
              </div>
              <div class="workload-bars" title="${escapeHtml(includeInactive ? `В расчёте: ${item.load}` : `Активные: ${item.active}; неактивные незавершённые: ${item.inactive}`)}">
                ${includeInactive
                  ? loadValue ? `<div class="workload-bar active" style="width:${loadWidth}%"></div>` : ""
                  : `
                    ${activeValue ? `<div class="workload-bar active" style="width:${activeWidth}%"></div>` : ""}
                    ${inactiveValue ? `<div class="workload-bar inactive" style="width:${inactiveWidth}%"></div>` : ""}
                  `}
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

function setWeightedDashboard(enabled) {
  const config = currentLoadCoefficientConfig();
  if (enabled && !config.valid) {
    state.weightedDashboard = false;
    toast(`Приведённая нагрузка недоступна: ${config.errors.join("; ")}.`, "error");
  } else {
    state.weightedDashboard = Boolean(enabled);
  }
  try { localStorage.setItem(weightedDashboardStorageKey, state.weightedDashboard ? "1" : "0"); } catch { /* optional preference */ }
  renderWorkloadDashboard();
}

function toggleHistoricalDashboardWithFlip() {
  const card = $(".workload-card");
  const dashboard = $("#workloadDashboard");
  const toggle = $("#toggleHistoricalDashboard");
  const toHistory = !state.historicalDashboard;
  if (!card || card.classList.contains("is-flipping")) return;
  card.classList.remove("flip-to-history", "flip-to-current");
  card.classList.add("is-flipping", toHistory ? "flip-to-history" : "flip-to-current");
  dashboard?.classList.remove("flip-in", "flip-out");
  dashboard?.classList.add("flip-out");
  if (toggle) toggle.disabled = true;
  window.setTimeout(() => {
    state.historicalDashboard = toHistory;
    renderWorkloadDashboard();
    $("#workloadDashboard")?.classList.add("flip-in");
  }, 190);
  window.setTimeout(() => {
    card.classList.remove("is-flipping", "flip-to-history", "flip-to-current");
    $("#workloadDashboard")?.classList.remove("flip-in", "flip-out");
    if (toggle) toggle.disabled = false;
  }, 470);
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
  if (!state.responsibleEditEnabled) {
    return caseFilterValue("Статус", current, `<span class="case-filter-pill">${escapeHtml(current || "—")}</span>`);
  }
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
  if (!state.responsibleEditEnabled) {
    return caseFilterValue("Ответственный", current, `<span class="case-filter-pill">${escapeHtml(displayName(current) || "—")}</span>`);
  }
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

function caseColumnProfile() {
  if (state.caseListScope === "mine") return "mine";
  if (isExternalReadOnlyYuc()) return "external";
  if (isEmployeeUser()) return "employee";
  return "manager";
}

function defaultCaseColumnVisibility(profile = caseColumnProfile()) {
  const visibility = Object.fromEntries(CASE_COLUMN_OPTIONS.map((option) => [option.key, false]));
  visibility.id = true;
  visibility.type = true;
  visibility.subject = true;
  visibility.claimant = true;
  visibility.respondent = true;
  visibility.thirdParty = true;
  visibility.region = true;
  if (profile === "manager") {
    visibility.receivedDate = true;
    visibility.actual = true;
    visibility.responsible = true;
    visibility.status = true;
  } else if (profile === "employee" || profile === "mine") {
    visibility.receivedDate = true;
    visibility.status = true;
  } else {
    visibility.responsible = true;
  }
  return visibility;
}

function caseColumnsStorageKey(profile = caseColumnProfile()) {
  const employeeId = String(state.authUser?.employeeId || state.authUser?.login || "anonymous").trim() || "anonymous";
  return `${caseColumnsStoragePrefix}:${employeeId}:${profile}`;
}

function caseColumnVisibility(profile = caseColumnProfile()) {
  const visibility = defaultCaseColumnVisibility(profile);
  try {
    const saved = JSON.parse(localStorage.getItem(caseColumnsStorageKey(profile)) || "{}");
    for (const option of CASE_COLUMN_OPTIONS) {
      if (typeof saved?.[option.key] === "boolean") visibility[option.key] = saved[option.key];
    }
  } catch {
    // При недоступном или повреждённом localStorage используем безопасный набор по умолчанию.
  }
  visibility.id = true;
  if (!visibility.subject) {
    visibility.claimant = false;
    visibility.respondent = false;
    visibility.thirdParty = false;
  }
  return visibility;
}

function saveCaseColumnVisibility(visibility, profile = caseColumnProfile()) {
  try {
    localStorage.setItem(caseColumnsStorageKey(profile), JSON.stringify({ ...visibility, id: true }));
  } catch {
    // Настройка останется активной до перезагрузки страницы, если браузер запретил localStorage.
  }
}

function setCaseColumnVisibility(key, enabled) {
  const option = CASE_COLUMN_OPTIONS.find((item) => item.key === key);
  if (!option || option.locked) return;
  const profile = caseColumnProfile();
  const visibility = caseColumnVisibility(profile);
  visibility[key] = Boolean(enabled);
  if (option.detail && enabled) visibility.subject = true;
  if (key === "subject" && !enabled) {
    visibility.claimant = false;
    visibility.respondent = false;
    visibility.thirdParty = false;
  }
  saveCaseColumnVisibility(visibility, profile);
  renderCases();
}

function resetCaseColumnVisibility() {
  const profile = caseColumnProfile();
  try { localStorage.removeItem(caseColumnsStorageKey(profile)); } catch { /* noop */ }
  renderCases();
}

function caseColumnsForTable(profile = caseColumnProfile(), visibility = caseColumnVisibility(profile)) {
  const columns = CASE_COLUMN_OPTIONS.filter((option) => !option.detail && visibility[option.key]);
  if (profile === "manager") columns.push({ key: "action", label: "Действие" });
  return columns;
}

function caseTableMinimumWidth(columns) {
  const widths = { id: 112, yuc: 160, type: 148, subject: 320, region: 180, receivedDate: 138, actual: 118, responsible: 205, status: 160, caseNumber: 170, caseProLink: 150, action: 128 };
  return Math.max(560, columns.reduce((total, column) => total + (widths[column.key] || 160), 0));
}

function renderCaseColumnsToggles(profile = caseColumnProfile(), visibility = caseColumnVisibility(profile)) {
  const target = $("#caseColumnsInline");
  if (!target) return;
  target.innerHTML = `
    <div class="case-columns-header">
      <span class="case-columns-label">Поля в таблице</span>
      <button class="case-columns-toggle" type="button" aria-expanded="${state.caseColumnsExpanded}" title="${state.caseColumnsExpanded ? "Свернуть поля" : "Настроить поля"}">${state.caseColumnsExpanded ? "−" : "+"}</button>
    </div>
    ${state.caseColumnsExpanded ? `
      <div class="case-columns-options">
        ${CASE_COLUMN_OPTIONS.filter((option) => !option.locked).map((option) => {
          const disabled = option.detail && !visibility.subject;
          return `<label class="case-column-toggle ${option.detail ? "is-detail" : ""} ${disabled ? "is-disabled" : ""}">
            <input class="case-column-visibility" type="checkbox" data-column-key="${option.key}" ${visibility[option.key] ? "checked" : ""} ${disabled ? "disabled" : ""}>
            <span class="switch-ui"></span><span>${escapeHtml(option.label)}</span>
          </label>`;
        }).join("")}
      </div>
    ` : ""}
  `;
}

function toggleCaseColumnsPanel() {
  state.caseColumnsExpanded = !state.caseColumnsExpanded;
  renderCaseColumnsToggles();
}

function casePartyFilterItems(row, visibility = caseColumnVisibility()) {
  return [
    { key: "claimant", field: "Истец" },
    { key: "respondent", field: "Ответчик" },
    { key: "thirdParty", field: "Третье лицо" },
  ]
    .filter((item) => visibility[item.key])
    .map(({ field }) => ({ field, value: String(row[field] ?? "").trim() }))
    .filter((item) => item.value)
    .map((item) => `
      <span class="case-party-item">
        <span>${escapeHtml(item.field)}:</span>
        ${caseFilterValue(item.field, item.value)}
      </span>
    `)
    .join("");
}

function caseDateColumn(row, field) {
  return escapeHtml(formatRuDateDash(row[field]) || "—");
}

function isForeignCaseRegion(row) {
  const yuc = normalizeYucName(row?.["ЮЦ"] || "");
  const region = String(row?.["Регион"] || "").trim();
  if (!region || !yuc) return false;
  const ownRegions = state.data?.directories?.regionsByYuc?.[yuc] ?? [];
  return !ownRegions.includes(region);
}

function caseColumnCell(row, key, profile, visibility) {
  switch (key) {
    case "id": return `<button class="link-btn case-id-link" data-id="${escapeHtml(row.case_id)}" title="Открыть карточку дела">${escapeHtml(row.case_id)}</button>`;
    case "yuc": return escapeHtml(row["ЮЦ"] || "—");
    case "type": {
      const typeBadge = badge(row["Тип дела"], workloadCaseType(row["Тип дела"]) === "судебное" ? "blue" : row["Тип дела"] === "претензия" ? "green" : "orange");
      return caseFilterValue("Тип дела", row["Тип дела"], typeBadge);
    }
    case "subject": return `<div class="cell-main">${escapeHtml(row["Предмет"] || "—")}</div><div class="case-party-filters">${casePartyFilterItems(row, visibility)}</div>`;
    case "region": {
      const foreign = isForeignCaseRegion(row);
      const label = foreign
        ? `<span class="foreign-region-chip" title="Регион относится к другому ЮЦ; он сохранён при импорте и не влияет на очередь"><span>${escapeHtml(row["Регион"] || "—")}</span><small>другой ЮЦ</small></span>`
        : null;
      return caseFilterValue("Регион", row["Регион"], label);
    }
    case "receivedDate": return caseFilterValue("Дата поступления", row["Дата поступления"], caseDateColumn(row, "Дата поступления"));
    case "actual": return badge(row["Актуально"] || "—", row["Актуально"] === "Да" ? "green" : "gray");
    case "responsible": return profile === "manager"
      ? caseResponsibleCell(row)
      : caseFilterValue("Ответственный", row["Ответственный"], `<span class="case-filter-pill">${escapeHtml(displayName(row["Ответственный"]) || "—")}</span>`);
    case "status": {
      if (profile === "manager") return caseStatusSelect(row);
      const kind = row["Статус"] === "Завершено" ? "green" : row["Статус"] === "Приостановлено" ? "orange" : "blue";
      return caseFilterValue("Статус", row["Статус"], badge(row["Статус"] || "—", kind));
    }
    case "caseNumber": return escapeHtml(row["Номер дела"] || "—");
    case "caseProLink": {
      const link = caseLinkInfo(row["Ссылка"]);
      return link ? `<a class="case-pro-link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(link.title)}">Открыть</a>` : "—";
    }
    case "action": return existingCaseActions(row);
    default: return "—";
  }
}

function renderCasesSearchClear() {
  const input = $("#casesSearch");
  const button = $("#casesSearchClear");
  if (button) button.hidden = !String(input?.value ?? "").trim();
}

function renderCases() {
  renderCasesSearchClear();
  const profile = caseColumnProfile();
  const visibility = caseColumnVisibility(profile);
  const columns = caseColumnsForTable(profile, visibility);
  const casesTable = $(".cases-table");
  if (casesTable) {
    casesTable.dataset.caseLayout = profile;
    casesTable.style.setProperty("--cases-table-min-width", `${caseTableMinimumWidth(columns)}px`);
  }
  const header = $("#casesTableHeader");
  if (header) header.innerHTML = `<tr>${columns.map((column) => `<th class="case-column case-column-${column.key}">${escapeHtml(column.label)}</th>`).join("")}</tr>`;
  renderCaseColumnsToggles(profile, visibility);
  renderCasesQuickFilter();
  const term = ($("#casesSearch")?.value ?? "").toLowerCase();
  const filteredRows = state.caseRegistryLoaded
    ? casesForRegistry()
    : casesForRegistry()
      .filter((row) => state.showDeletedCases || !isDeletedCase(row))
      .filter(caseMatchesQuickFilter)
      .filter(caseMatchesResponsibleFilter)
      .filter(caseMatchesCellFilter)
      .filter((row) => !term || Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(term)))
      .slice()
      .reverse();
  const totalCount = state.caseRegistryLoaded ? state.caseRegistryTotal : filteredRows.length;
  const totalPages = state.caseRegistryLoaded
    ? state.caseRegistryTotalPages
    : Math.max(1, Math.ceil(filteredRows.length / state.casesPageSize));
  state.casesPage = Math.min(Math.max(1, state.casesPage), totalPages);
  const pageStart = (state.casesPage - 1) * state.casesPageSize;
  const rows = state.caseRegistryLoaded ? filteredRows : filteredRows.slice(pageStart, pageStart + state.casesPageSize);
  const pagination = $("#casesPagination");
  if (pagination) {
    pagination.innerHTML = totalCount ? `
      <span>Показано ${pageStart + 1}–${Math.min(pageStart + rows.length, totalCount)} из ${totalCount}</span>
      <div>
        <button class="tiny-btn light cases-page-button" type="button" data-cases-page="${state.casesPage - 1}" ${state.casesPage <= 1 ? "disabled" : ""}>Назад</button>
        <span>Страница ${state.casesPage} из ${totalPages}</span>
        <button class="tiny-btn light cases-page-button" type="button" data-cases-page="${state.casesPage + 1}" ${state.casesPage >= totalPages ? "disabled" : ""}>Вперёд</button>
      </div>
    ` : "";
  }
  if (!filteredRows.length) {
    $("#casesTable").innerHTML = `<tr><td colspan="${columns.length}" class="empty-cell">Дела не найдены.</td></tr>`;
    return;
  }
  $("#casesTable").innerHTML = rows.map((row) => `
    <tr class="${isDeletedCase(row) ? "case-deleted-row" : ""}">
      ${columns.map((column) => `<td class="case-column case-column-${column.key} ${column.key === "id" || column.key.endsWith("Date") ? "date-cell" : ""}">${caseColumnCell(row, column.key, profile, visibility)}</td>`).join("")}
    </tr>
  `).join("");
}

function scheduleCasesRender() {
  if (state.casesSearchTimer) window.clearTimeout(state.casesSearchTimer);
  state.casesSearchTimer = window.setTimeout(() => {
    state.casesSearchTimer = null;
    state.casesPage = 1;
    loadCaseRegistry({ page: 1 }).catch((error) => toast(error.message, "error"));
  }, 180);
}

function applyCasesQuickFilter(filter) {
  state.casesPage = 1;
  state.casesQuickFilter = filter || "";
  state.casesResponsibleFilter = "";
  if ($("#casesSearch")) $("#casesSearch").value = "";
  showView("cases");
  if (state.loadedViews.has("cases")) {
    loadCaseRegistry({ page: 1 }).catch((error) => toast(error.message, "error"));
  }
}

function applyCasesResponsibleFilter(responsible) {
  state.casesPage = 1;
  state.casesResponsibleFilter = responsible || "";
  state.casesQuickFilter = "";
  if ($("#casesSearch")) $("#casesSearch").value = "";
  showView("cases");
  if (state.loadedViews.has("cases")) {
    loadCaseRegistry({ page: 1 }).catch((error) => toast(error.message, "error"));
  }
}

function applyCasesCellFilter(field, value) {
  const normalizedField = String(field ?? "").trim();
  const normalizedValue = String(value ?? "").trim();
  if (!caseCellFilterFields.has(normalizedField) || !normalizedValue) return;
  state.casesCellFilter = { field: normalizedField, value: normalizedValue };
  state.casesPage = 1;
  if ($("#casesSearch")) $("#casesSearch").value = "";
  showView("cases");
  if (state.loadedViews.has("cases")) {
    loadCaseRegistry({ page: 1 }).catch((error) => toast(error.message, "error"));
  }
}

function clearCasesCellFilter() {
  state.casesCellFilter = null;
  state.casesPage = 1;
  loadCaseRegistry({ page: 1 }).catch((error) => toast(error.message, "error"));
}

function closeCaseImportModal() {
  $("#caseImportModal")?.classList.remove("show");
  $("#caseImportModal")?.setAttribute("aria-hidden", "true");
  if ($("#caseImportInput")) $("#caseImportInput").value = "";
}

function cleanImportValue(value) {
  return String(value ?? "").trim();
}

function caseImportItemReady(item) {
  if (item.responsibleMode !== "manual") return true;
  return Boolean(cleanImportValue(state.caseImportResponsibleOverrides?.[String(item.rowNumber)]));
}

function caseImportInvalidErrors(item) {
  return item.errors ?? String(item.reason ?? "").split(", ").filter(Boolean);
}

function caseImportNeedsOnlyRegion(item) {
  const errors = caseImportInvalidErrors(item);
  return errors.length === 1 && errors[0] === "не удалось определить регион";
}

function caseImportRegions() {
  const allRegions = Object.values(state.data?.directories?.regionsByYuc ?? {}).flat();
  return [...new Set(allRegions.map((region) => cleanImportValue(region)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "ru"));
}

function caseImportResolvedInvalidRows() {
  const plan = state.caseImportPlan;
  if (!plan) return [];
  return (plan.invalid ?? [])
    .filter((item) => caseImportNeedsOnlyRegion(item))
    .map((item) => {
      const region = cleanImportValue(state.caseImportRegionOverrides?.[String(item.rowNumber)]);
      if (!region) return null;
      return {
        ...item,
        source: { ...item.source, "Регион": region },
        responsibleMode: "matched",
      };
    })
    .filter(Boolean);
}

function selectedCaseImportRows() {
  const plan = state.caseImportPlan;
  if (!plan) return [];
  return [...(plan.toAdd ?? []), ...caseImportResolvedInvalidRows()]
    .filter(caseImportItemReady)
    .map((item) => ({
      ...item,
      source: {
        ...item.source,
        "Ответственный": state.caseImportResponsibleOverrides?.[String(item.rowNumber)] || item.source["Ответственный"],
      },
    }));
}

function selectedCaseImportUpdates() {
  const plan = state.caseImportPlan;
  if (!plan) return [];
  return (plan.existing ?? [])
    .filter((item) => item.changes?.length)
    .map((item) => ({ caseId: item.caseId, rowNumber: item.rowNumber, source: item.source }));
}

function updateCaseImportSelectionState() {
  const selectedCount = selectedCaseImportRows().length;
  const selectedUpdates = selectedCaseImportUpdates().length;
  const applyButton = $("#caseImportApplyBtn");
  if (applyButton) {
    applyButton.disabled = selectedCount + selectedUpdates === 0;
    applyButton.textContent = selectedCount + selectedUpdates
      ? `Импортировать: добавить ${selectedCount} · обновить ${selectedUpdates}`
      : "Нет подготовленных дел для импорта";
  }
}

function caseImportUpdateRow(item) {
  const checked = state.caseImportSelectedUpdates.has(String(item.caseId)) ? "checked" : "";
  const changes = item.changes ?? [];
  return `
    <li class="import-row import-update-row">
      <label class="import-row-check">
        <input type="checkbox" class="case-import-update-check" data-case-id="${escapeHtml(item.caseId)}" ${checked} />
        <span class="checkbox-ui"></span>
      </label>
      <div class="import-row-body">
        <div><strong>Строка ${item.rowNumber}: ${escapeHtml(item.source["Предмет"])}</strong></div>
        <div class="muted">${escapeHtml(item.reason || "уже есть")} · изменений: ${changes.length}</div>
        <ul class="import-change-list">
          ${changes.map((change) => `<li><strong>${escapeHtml(change.field)}:</strong> <span>${escapeHtml(change.previous || "—")}</span> → <span>${escapeHtml(change.next || "—")}</span></li>`).join("")}
        </ul>
      </div>
    </li>
  `;
}

function caseImportRow(item, options = {}) {
  const checked = options.checked ? "checked" : "";
  const manualChoice = item.responsibleMode === "manual";
  const rowReady = caseImportItemReady(item);
  const disabled = options.disabled || (manualChoice && !rowReady) ? "disabled" : "";
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
        ${manualChoice && !options.disabled ? `
          <label class="import-responsible-choice">
            <span>Назначить руководителя</span>
            <select class="case-import-responsible" data-row-number="${escapeHtml(item.rowNumber)}">
              <option value="">Выберите сотрудника</option>
              ${(item.responsibleOptions ?? []).map((name) => `<option value="${escapeHtml(name)}" ${state.caseImportResponsibleOverrides?.[String(item.rowNumber)] === name ? "selected" : ""}>${escapeHtml(displayName(name))}</option>`).join("")}
            </select>
          </label>
        ` : ""}
      </div>
    </li>
  `;
}

function caseImportInvalidRow(item) {
  const rawRegion = String(item.sourceRegion ?? "").trim();
  const sourceResponsible = String(item.sourceResponsible ?? item.source?.["Ответственный"] ?? "").trim();
  const regionInfo = item.reason?.includes("регион")
    ? `<div class="import-invalid-detail"><strong>Исходное подразделение заказчика:</strong> ${escapeHtml(rawRegion || "не указано в выгрузке")}</div>`
    : "";
  const canChooseRegion = caseImportNeedsOnlyRegion(item);
  const selectedRegion = state.caseImportRegionOverrides?.[String(item.rowNumber)] ?? "";
  return `
    <li class="import-invalid-row">
      <div><strong>Строка ${item.rowNumber}:</strong> ${escapeHtml(item.reason)}</div>
      <div class="import-invalid-subject">${escapeHtml(item.source?.["Предмет"] || "предмет не указан")}</div>
      ${sourceResponsible ? `<div class="import-invalid-detail"><strong>Исполнитель:</strong> ${escapeHtml(sourceResponsible)}</div>` : ""}
      ${regionInfo}
      ${canChooseRegion ? `
        <label class="import-responsible-choice import-region-choice">
          <span>Назначить регион</span>
          <select class="case-import-region" data-row-number="${escapeHtml(item.rowNumber)}">
            <option value="">Выберите регион</option>
            ${caseImportRegions().map((region) => `<option value="${escapeHtml(region)}" ${selectedRegion === region ? "selected" : ""}>${escapeHtml(region)}</option>`).join("")}
          </select>
        </label>
      ` : ""}
    </li>
  `;
}

function renderCaseImportModal() {
  const plan = state.caseImportPlan;
  const content = $("#caseImportContent");
  const applyButton = $("#caseImportApplyBtn");
  if (!content || !applyButton || !plan) return;
  const pendingInvalid = (plan.invalid ?? []).filter((item) => !caseImportNeedsOnlyRegion(item) || !cleanImportValue(state.caseImportRegionOverrides?.[String(item.rowNumber)]));
  const pendingResponsible = (plan.toAdd ?? []).filter((item) => !caseImportItemReady(item));
  const issues = [
    ...pendingInvalid.map((item) => ({ kind: "invalid", item })),
    ...pendingResponsible.map((item) => ({ kind: "responsible", item })),
    ...(plan.duplicateInFile ?? []).map((item) => ({ kind: "duplicate", item })),
  ];
  const updateCandidates = (plan.existing ?? []).filter((item) => item.changes?.length);
  const preparedRows = selectedCaseImportRows().length;
  content.innerHTML = `
    <p class="muted">
      ЮЦ: <strong>${escapeHtml(state.caseImportYuc)}</strong>. Подготовленные дела будут импортированы автоматически; очередь назначения не изменяется.
    </p>
    <div class="import-summary-grid">
      <div class="import-summary-card"><span>Лист</span><strong>${escapeHtml(plan.sheetName || "—")}</strong></div>
      <div class="import-summary-card"><span>Строк в файле</span><strong>${plan.stats?.sourceRows ?? 0}</strong></div>
      <div class="import-summary-card"><span>Будет добавлено</span><strong>${preparedRows}</strong></div>
      <div class="import-summary-card"><span>Будет обновлено</span><strong>${updateCandidates.length}</strong></div>
      <div class="import-summary-card"><span>Требуют внимания</span><strong>${issues.length}</strong></div>
    </div>
    ${issues.length ? `
      <h3>Требуют внимания</h3>
      <p class="muted">Показаны только строки с недостатками. Выберите регион для строки без региона — она сразу станет подготовленной к импорту.</p>
      <ul class="import-list import-invalid-list">
        ${issues.map(({ kind, item }) => {
          if (kind === "invalid") return caseImportInvalidRow(item);
          if (kind === "responsible") return caseImportRow(item, { disabled: false, reason: "нужно назначить руководителя" });
          return `<li class="import-invalid-row"><div><strong>Строка ${item.rowNumber}:</strong> повтор строки ${item.duplicateOfRow} в файле</div><div class="import-invalid-subject">${escapeHtml(item.source?.["Предмет"] || "предмет не указан")}</div></li>`;
        }).join("")}
      </ul>
    ` : `<p class="import-success-note">Недостатков не найдено. Нажмите «Импортировать», чтобы применить подготовленные изменения.</p>`}
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
  state.caseImportResponsibleOverrides = {};
  state.caseImportRegionOverrides = {};
  state.caseImportSelectedRows = new Set((payload.plan?.toAdd ?? []).filter(caseImportItemReady).map((item) => String(item.rowNumber)));
  state.caseImportSelectedUpdates = new Set((payload.plan?.existing ?? []).filter((item) => item.changes?.length).map((item) => String(item.caseId)));
  state.caseImportActiveTab = "new";
  renderCaseImportModal();
  setStatus("Готово");
}

async function applyCaseImport() {
  if (!state.caseImportPlan) return;
  const selectedRows = selectedCaseImportRows();
  const selectedUpdates = selectedCaseImportUpdates();
  if (!selectedRows.length && !selectedUpdates.length) {
    toast("Выберите хотя бы одно новое дело или обновление.", "error");
    return;
  }
  setStatus("Применяю импорт в MTS Tabs…");
  const payload = await api("/api/cases/import-apply", {
    method: "POST",
    body: JSON.stringify({ rows: selectedRows, updates: selectedUpdates, cacheVersions: state.caseImportPlan.cacheVersions ?? {} }),
  });
  mergeChangedCases(payload.cases, payload.employees);
  state.caseImportPlan = null;
  state.caseImportSelectedRows = new Set();
  state.caseImportSelectedUpdates = new Set();
  state.caseImportResponsibleOverrides = {};
  state.caseImportRegionOverrides = {};
  closeCaseImportModal();
  toast(`Импорт завершён: добавлено ${payload.result?.added ?? 0}, обновлено ${payload.result?.updated ?? 0}.`);
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

function currentLoadCoefficientConfig() {
  return loadCoefficientConfig(state.data?.loadCoefficients ?? []);
}

function settingsNumberStepper({ value, min = 0, step = 1, inputClass = "", inputAttributes = "", label = "Числовое значение", disabled = false } = {}) {
  const numericValue = Number(value);
  const minusDisabled = disabled || (Number.isFinite(numericValue) && numericValue <= min);
  return `
    <span class="settings-number-stepper">
      <button class="settings-number-step" type="button" data-settings-number-step="-1" aria-label="Уменьшить: ${escapeHtml(label)}" ${minusDisabled ? "disabled" : ""}>−</button>
      <input class="settings-number-input ${inputClass}" type="number" min="${escapeHtml(min)}" step="${escapeHtml(step)}" inputmode="decimal" value="${escapeHtml(value ?? "")}" ${inputAttributes} ${disabled ? "disabled" : ""} aria-label="${escapeHtml(label)}" />
      <button class="settings-number-step" type="button" data-settings-number-step="1" aria-label="Увеличить: ${escapeHtml(label)}" ${disabled ? "disabled" : ""}>+</button>
    </span>
  `;
}

function renderLoadCoefficients() {
  const table = $("#loadCoefficientsTable");
  const saveButton = $("#saveLoadCoefficientsBtn");
  const note = $("#loadCoefficientsNote");
  if (!table) return;
  const admin = isAdminUser();
  const config = currentLoadCoefficientConfig();
  table.innerHTML = loadCoefficientTypes.map((type) => `
    <div class="load-coefficient-item" data-load-coefficient-type="${escapeHtml(type)}">
      <span>${escapeHtml(type)}</span>
      ${settingsNumberStepper({ value: config.values[type] ?? "", min: 0.05, step: 0.05, inputClass: "load-coefficient-input", label: `Коэффициент: ${type}`, disabled: !admin })}
    </div>
  `).join("");
  saveButton?.classList.toggle("hidden", !admin);
  if (note) {
    note.textContent = config.valid
      ? admin ? "Коэффициенты действуют во всех ЮЦ и только на историческом дэшборде." : "Глобальные коэффициенты доступны только для просмотра и применяются на историческом дэшборде."
      : `Приведённая нагрузка недоступна: ${config.errors.join("; ")}.`;
    note.classList.toggle("is-error", !config.valid);
  }
}

function syncSettingsNumberStepper(input) {
  const stepper = input?.closest(".settings-number-stepper");
  if (!stepper) return;
  const value = Number(String(input.value || "").replace(",", "."));
  const min = Number(input.min);
  const max = Number(input.max);
  const minus = stepper.querySelector('[data-settings-number-step="-1"]');
  const plus = stepper.querySelector('[data-settings-number-step="1"]');
  if (minus) minus.disabled = input.disabled || (Number.isFinite(min) && Number.isFinite(value) && value <= min);
  if (plus) plus.disabled = input.disabled || (input.max !== "" && Number.isFinite(max) && Number.isFinite(value) && value >= max);
}

function changeSettingsNumber(button) {
  const stepper = button.closest(".settings-number-stepper");
  const input = stepper?.querySelector("input[type='number']");
  if (!input || input.disabled) return;
  const current = Number(String(input.value || "").replace(",", "."));
  const direction = Number(button.dataset.settingsNumberStep) || 0;
  const step = Number(input.step) || 1;
  const min = input.min !== "" && Number.isFinite(Number(input.min)) ? Number(input.min) : Number.NEGATIVE_INFINITY;
  const max = input.max !== "" && Number.isFinite(Number(input.max)) ? Number(input.max) : Number.POSITIVE_INFINITY;
  const precision = (String(step).split(".")[1] ?? "").length;
  const base = Number.isFinite(current) ? current : Math.max(min, 0);
  const next = Math.min(max, Math.max(min, Number((base + direction * step).toFixed(precision))));
  input.value = String(next);
  syncSettingsNumberStepper(input);
  input.dispatchEvent(new Event("change", { bubbles: true }));
  setStatus("Есть несохраненные изменения");
}

function renderDeadlineSettings() {
  const table = $("#deadlineSettingsTable");
  if (!table) return;
  table.innerHTML = deadlineSettingsForSelectedYuc().map((row) => `
    <tr data-deadline-type="${escapeHtml(row["Тип дела"])}">
      <td>${escapeHtml(row["Тип дела"])}</td>
      <td>${settingsNumberStepper({ value: row["Активность, дни"], min: 1, inputClass: "deadline-input deadline-setting-field", inputAttributes: 'data-field="Активность, дни"', label: `Активность, дни: ${row["Тип дела"]}` })}</td>
      <td>${settingsNumberStepper({ value: row["Автозавершение, дни"], min: 1, inputClass: "deadline-input deadline-setting-field", inputAttributes: 'data-field="Автозавершение, дни"', label: `Автозавершение, дни: ${row["Тип дела"]}` })}</td>
      <td>${yesNoToggle({
        className: "deadline-setting-field",
        attrs: `data-field="Учитывать долг"`,
        checked: yes(row["Учитывать долг"]),
      })}</td>
      <td>${settingsNumberStepper({ value: row["Максимальный долг"], min: 0, inputClass: "deadline-input deadline-setting-field", inputAttributes: 'data-field="Максимальный долг"', label: `Максимальный долг: ${row["Тип дела"]}` })}</td>
      <td>${settingsNumberStepper({ value: row["Порог перегруза"], min: 0, inputClass: "deadline-input deadline-setting-field", inputAttributes: 'data-field="Порог перегруза"', label: `Порог перегруза: ${row["Тип дела"]}` })}</td>
    </tr>
  `).join("");
}

function renderYucSettingsForm() {
  const form = $("#yucSettingsForm");
  if (!form) return;
  const settings = yucSettingsForSelectedYuc();
  form.elements["Учитывать неактивные незавершенные в нагрузке"].checked = yes(settings["Учитывать неактивные незавершенные в нагрузке"]);
  form.elements["Региональные очереди вкл\\выкл"].checked = yes(settings["Региональные очереди вкл\\выкл"]);
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
  if (addAssignment) addAssignment.disabled = !enabled;
  const addSubstitution = $("#addRegionalSubstitutionBtn");
  if (addSubstitution) addSubstitution.disabled = !enabled;
  $$(".regional-assignment-field, .regional-substitution-field, .save-regional-assignment, .delete-regional-assignment, .save-regional-substitution, .delete-regional-substitution").forEach((control) => {
    control.disabled = !enabled;
    control.closest(".toggle-inline")?.classList.toggle("disabled", !enabled);
  });
  panel?.querySelectorAll(".settings-number-input").forEach(syncSettingsNumberStepper);
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
      <td><input class="inline-input regional-substitution-field" data-field="Комментарий" value="${escapeHtml(row["Комментарий"] || "")}" /></td>
      <td>
        <div class="case-actions">
          <button class="icon-btn confirm save-regional-substitution" title="Сохранить замещение">✓</button>
          <button class="icon-btn cancel ${isNew ? "cancel-new-regional-substitution" : "delete-regional-substitution"}" title="${isNew ? "Отменить" : "Удалить"}">${isNew ? "×" : "🗑"}</button>
        </div>
      </td>
    </tr>
  `;
}

function renderRegionalSubstitutions() {
  const rows = regionalSubstitutionsForSelectedYuc();
  const html = rows.map((row, index) => regionalSubstitutionRow(row, index, false)).join("");
  const employees = employeesForSelectedYuc();
  const draft = state.substitutionDraftOpen ? regionalSubstitutionRow({
    "ЮЦ": selectedYuc(),
    "Регион": selectedYucRegions()[0] ?? "",
    "Основной сотрудник": employees[0]?.["ФИО"] ?? "",
    "Замещающий сотрудник": employees[1]?.["ФИО"] ?? employees[0]?.["ФИО"] ?? "",
    "Тип нагрузки": "все",
    "Активно": "Да",
    "Комментарий": "",
  }, -1, true) : "";
  $("#regionalSubstitutionsTable").innerHTML = html || draft
    ? `${draft}${html}`
    : `<tr><td colspan="7" class="empty-cell">Замещения выбранного ЮЦ пока не настроены.</td></tr>`;
}

function renderSettings() {
  renderLoadCoefficients();
  renderDeadlineSettings();
  renderYucSettingsForm();
  renderRegionalAssignments();
  renderRegionalSubstitutions();
  updateRegionalSettingsAvailability();
}

async function saveLoadCoefficients() {
  if (!isAdminUser()) return;
  const rows = $$("#loadCoefficientsTable .load-coefficient-item").map((row) => ({
    "Тип нагрузки": row.dataset.loadCoefficientType,
    "Коэффициент": Number(String(row.querySelector(".load-coefficient-input")?.value ?? "").replace(",", ".")),
  }));
  const payload = await api("/api/load-coefficients", { method: "PUT", body: JSON.stringify({ rows }) });
  setDataFromPayload(payload);
  toast("Глобальные коэффициенты сохранены.");
}

const settingsHelp = {
  loadCoefficients: {
    title: "Коэффициенты приведённой нагрузки",
    body: `
      <p>Коэффициент задаёт условный вес одного дела каждого типа.</p>
      <ul>
        <li>Приведённая нагрузка равна сумме: количество дел каждого типа × его коэффициент.</li>
        <li>Пример: 2 судебных × 1,00 + 3 претензии × 0,30 = 2,90.</li>
        <li>Коэффициенты едины для всех ЮЦ. После изменения вся история пересчитывается по новым значениям.</li>
        <li>Значение должно быть больше нуля и иметь не более двух знаков после запятой.</li>
        <li>Расчёт доступен только на историческом дэшборде и не влияет на рекомендации, перегруз и автоназначение.</li>
      </ul>
    `,
  },
  deadlines: {
    title: "Настройки по типам нагрузки",
    body: `
      <p>Значения задаются отдельно для выбранного ЮЦ и типа нагрузки.</p>
      <ul>
        <li><strong>Активность, дни</strong> — период, в течение которого дело считается активным для расчёта нагрузки.</li>
        <li><strong>Автозавершение, дни</strong> — срок контроля: после его истечения дело попадает в список «К завершению», где руководитель принимает решение.</li>
        <li><strong>Учитывать долг</strong> — включает приоритет сотрудника, который пропустил очередь из-за недоступности.</li>
        <li><strong>Максимальный долг</strong> — ограничивает размер такого приоритета; после назначения долг погашается.</li>
        <li><strong>Порог перегруза</strong> — допустимая разница между минимальной нагрузкой региональной группы и общей очереди для этого типа. Уголовные и банкротные дела используют судебный порог.</li>
      </ul>
    `,
  },
  loadAccounting: {
    title: "Расчёт нагрузки ЮЦ",
    body: `
      <p>Настройка применяется только к выбранному сверху юридическому центру.</p>
      <ul>
        <li>Если переключатель выключен, в нагрузке участвуют только незавершённые дела, срок активности которых ещё не закончился.</li>
        <li>Если переключатель включён, учитываются все незавершённые дела, включая дела с истёкшим сроком активности.</li>
        <li>Настройка влияет на сравнение нагрузки сотрудников при автоматическом назначении.</li>
      </ul>
    `,
  },
  regionalRules: {
    title: "Региональное распределение",
    body: `
      <p>Правила применяются только к выбранному сверху юридическому центру.</p>
      <ul>
        <li>При включённом учёте региона приложение сначала ищет сотрудников, закреплённых за регионом и типом нагрузки.</li>
        <li>Если закреплений нет, применяется выбранный сценарий: общая очередь или остановка автоназначения.</li>
        <li>Если закреплённые сотрудники недоступны, приложение использует настроенное замещение, общую очередь либо останавливает автоназначение.</li>
        <li>Если региональная группа перегружена сверх порога выбранного типа, назначение переходит в общую очередь.</li>
      </ul>
    `,
  },
  regionalAssignments: {
    title: "Региональные закрепления",
    body: `
      <p>Каждая строка связывает регион, сотрудника и тип нагрузки. Для всех типов выберите «все».</p>
      <ul>
        <li>В одном регионе может быть несколько сотрудников, а один сотрудник может быть закреплён за несколькими регионами.</li>
        <li>Выключенное закрепление хранится в таблице, но в назначении не участвует.</li>
      </ul>
    `,
  },
  regionalSubstitutions: {
    title: "Региональные замещения",
    body: `
      <p>Это правила резервной очереди назначения, а не роли доступа пользователей.</p>
      <ul>
        <li>Замещения применяются только когда недоступна вся основная региональная группа.</li>
        <li>Для одного основного сотрудника можно настроить несколько замещающих; повторяющиеся кандидаты исключаются.</li>
        <li>Замещающий должен быть активен и участвовать в очереди соответствующего типа.</li>
        <li>Роль доступа «Заместитель» настраивается отдельно в разделе «Доступы».</li>
      </ul>
    `,
  },
};

function openSettingsHelp(key) {
  const help = settingsHelp[key];
  if (!help) return;
  $("#settingsHelpTitle").textContent = help.title;
  $("#settingsHelpBody").innerHTML = help.body;
  $("#settingsHelpModal").classList.add("show");
  $("#settingsHelpModal").setAttribute("aria-hidden", "false");
}

function closeSettingsHelp() {
  $("#settingsHelpModal")?.classList.remove("show");
  $("#settingsHelpModal")?.setAttribute("aria-hidden", "true");
}

function markDataViewsDirty(names = dataViewNames) {
  for (const name of names) state.dirtyViews.add(name);
}

function activeDataViewName() {
  return $(".view.active")?.id?.replace(/^view-/, "") || (isEmployeeUser() ? "cases" : "dashboard");
}

function renderDataView(name, { force = false } = {}) {
  if (!state.data || !dataViewNames.includes(name)) return;
  if (!force && !state.dirtyViews.has(name)) return;
  if (name === "dashboard") {
    renderSummary();
    renderCompletionControl();
    renderWorkloadDashboard();
  } else if (name === "distribution") {
    renderYucRegionSelects();
  } else if (name === "cases") {
    renderCases();
  } else if (name === "employees") {
    if (state.employeeSection === "vacations") renderVacations();
    else resetEmployeeAvailabilityDrafts();
  } else if (name === "settings") {
    renderSettings();
  }
  state.dirtyViews.delete(name);
}

function renderAll() {
  if (!state.data) return;
  renderYucTabs();
  renderDataView(activeDataViewName());
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
  const visible = workloadCaseType(type) === "судебное";
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
  if (mode === "regional-substitution") items.push({ text: "замещение", kind: "orange" });
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
  const debtToggles = $$(`tr[data-employee-row="${CSS.escape(employeeId)}"] .employee-debt-field`);
  const debts = [];
  for (const input of debtToggles) {
    if (input.disabled) continue;
    const max = Number(input.max) || Number.POSITIVE_INFINITY;
    const value = Math.max(0, Math.min(max, Math.floor(Number(input.value) || 0)));
    debts.push({ queue_id: input.dataset.queue, employee_id: input.dataset.employee, [input.dataset.field]: value });
  }
  const payload = await api(`/api/employees/${encodeURIComponent(employeeId)}`, {
    method: "PATCH",
    body: JSON.stringify({ employee: patch, debts }),
  });
  state.data.employees = state.data.employees.map((row) => row.employee_id === employeeId ? { ...row, ...payload.employee } : row);
  const updatedQueues = new Map((payload.queues ?? []).map((row) => [`${row.queue_id}::${row.employee_id}`, row]));
  state.data.queues = state.data.queues.map((row) => updatedQueues.get(`${row.queue_id}::${row.employee_id}`) ?? row);
  markDataViewsDirty(["dashboard", "employees", "distribution"]);
  renderEmployees();
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
  setStatus("Сохраняю настройки по типам нагрузки…");
  const payload = await api("/api/deadline-settings", {
    method: "POST",
    body: JSON.stringify({ yuc: selectedYuc(), rows }),
  });
  setDataFromPayload(payload);
  setStatus("Сохранено");
  toast("Настройки по типам нагрузки сохранены.");
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
    toast("Сначала включите учёт региона при автоматическом назначении.", "error");
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
    toast("Сначала включите учёт региона при автоматическом назначении.", "error");
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
    toast("Сначала включите учёт региона при автоматическом назначении.", "error");
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
  if (!regionalQueuesCurrentlyEnabled()) return;
  const tr = button.closest("tr");
  const index = Number(tr.dataset.regionalSubstitutionIndex);
  const row = regionalSubstitutionsForSelectedYuc()[index];
  if (!row || !window.confirm("Удалить региональное замещение?")) return;
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
  state.casesPage = 1;
  loadCaseRegistry({ page: 1 }).catch((error) => toast(error.message, "error"));
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

const caseModalEditableFields = [
  "Номер дела",
  "Ссылка",
  "Тип дела",
  "Статус",
  "Ответственный",
  "Регион",
  "Дата поступления",
  "Истец",
  "Ответчик",
  "Третье лицо",
  "Предмет",
  "Движение дела",
];

function canEditCaseRow(row) {
  if (!row || isExternalReadOnlyYuc()) return false;
  if (!isEmployeeUser()) return true;
  return nameMatches(row["Ответственный"], state.authUser?.name);
}

function editableCaseModalFields() {
  const row = caseModalRow();
  if (!canEditCaseRow(row)) return [];
  return isEmployeeUser()
    ? ["Номер дела", "Ссылка", "Статус", "Истец", "Ответчик", "Третье лицо", "Предмет"]
    : caseModalEditableFields;
}

function caseModalFieldReadonlyForUser(field) {
  return !editableCaseModalFields().includes(field);
}

function caseModalRow() {
  if (!state.caseModalCaseId) return null;
  return state.data?.cases?.find((item) => item.case_id === state.caseModalCaseId) ?? null;
}

function caseModalLinkValue(row) {
  return caseLinkInfo(row?.["Ссылка"])?.url || String(row?.["Ссылка"] ?? "");
}

function caseModalInitialDraft(row) {
  return {
    "Номер дела": row["Номер дела"] ?? "",
    "Ссылка": caseModalLinkValue(row),
    "Тип дела": row["Тип дела"] ?? "",
    "Статус": row["Статус"] ?? "",
    "Ответственный": row["Ответственный"] ?? "",
    "Регион": row["Регион"] ?? "",
    "Дата поступления": row["Дата поступления"] ?? "",
    "Истец": row["Истец"] ?? "",
    "Ответчик": row["Ответчик"] ?? "",
    "Третье лицо": row["Третье лицо"] ?? "",
    "Предмет": row["Предмет"] ?? "",
    "Движение дела": row["Движение дела"] ?? "",
  };
}

function caseModalDraft() {
  const row = caseModalRow();
  if (!row) return {};
  return state.caseModalEditing && state.caseModalDraft
    ? state.caseModalDraft
    : caseModalInitialDraft(row);
}

function caseModalOption(value, selected, label = value) {
  return `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function caseModalResponsibleOptions(selected) {
  const employees = employeesForSelectedYuc();
  const options = [];
  if (selected && !employees.some((employee) => nameMatches(employee["ФИО"], selected))) {
    options.push(caseModalOption(selected, selected, displayName(selected)));
  }
  options.push(...employees
    .slice()
    .sort((a, b) => displayName(a["ФИО"]).localeCompare(displayName(b["ФИО"]), "ru"))
    .map((employee) => caseModalOption(employee["ФИО"], selected, displayName(employee["ФИО"]))));
  return `<option value="">Не назначен</option>${options.join("")}`;
}

function caseModalRegionOptions(selected) {
  const regions = state.data?.directories?.regionsByYuc?.[selectedYuc()] ?? [];
  const normalized = String(selected ?? "").trim();
  const options = [];
  if (normalized && !regions.includes(normalized)) {
    options.push(caseModalOption(normalized, normalized));
  }
  options.push(...regions.map((region) => caseModalOption(region, normalized)));
  return `<option value="">Не выбран</option>${options.join("")}`;
}

function caseModalReadonlyValue(field, value) {
  if (field === "Ответственный") return escapeHtml(displayName(value));
  if (field === "Дата поступления") return escapeHtml(formatRuDateDash(value) || "—");
  if (field === "Ссылка") {
    const link = caseLinkInfo(value);
    if (!link) return "—";
    const safeUrl = escapeHtml(link.url);
    return `<a class="case-link-chip" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.title)}</a>`;
  }
  return escapeHtml(value || "—");
}

function caseModalMultilineValue(value) {
  return String(value ?? "")
    .replace(/&#(?:0*10|x0*a);/gi, "\n")
    .replace(/\r\n?/g, "\n");
}

function caseModalField({ field, label, type = "text", wide = false, rows = 3, readonly = false }) {
  const draft = caseModalDraft();
  const value = draft[field] ?? "";
  const editing = state.caseModalEditing && !readonly;
  const multiline = type === "textarea";
  const classes = ["case-edit-field", wide ? "wide" : ""].filter(Boolean).join(" ");
  if (!editing) {
    const displayValue = multiline
      ? escapeHtml(caseModalMultilineValue(value) || "—")
      : caseModalReadonlyValue(field, value);
    return `
      <div class="case-detail-item ${wide ? "wide" : ""} ${multiline ? "multiline" : ""}" data-case-detail-field="${escapeHtml(field)}">
        <span>${escapeHtml(label)}</span>
        <strong>${displayValue}</strong>
      </div>
    `;
  }
  if (type === "textarea") {
    return `
      <label class="field ${classes}">
        <span>${escapeHtml(label)}</span>
        <textarea data-case-modal-field="${escapeHtml(field)}" rows="${rows}">${escapeHtml(caseModalMultilineValue(value))}</textarea>
      </label>
    `;
  }
  if (type === "select") {
    let options = "";
    if (field === "Тип дела") {
      options = `<option value="">Выберите тип</option>${caseTypes.map((item) => caseModalOption(item, value, item[0].toUpperCase() + item.slice(1))).join("")}`;
    } else if (field === "Статус") {
      const allowed = isEmployeeUser() ? ["В работе", "Приостановлено", "Завершено"] : statuses;
      const statusOptions = allowed.includes(value) || !value ? allowed : [value, ...allowed];
      options = statusOptions.map((item) => caseModalOption(item, value)).join("");
    } else if (field === "Ответственный") {
      options = caseModalResponsibleOptions(value);
    } else if (field === "Регион") {
      options = caseModalRegionOptions(value);
    }
    return `
      <label class="field ${classes}">
        <span>${escapeHtml(label)}</span>
        <select data-case-modal-field="${escapeHtml(field)}">${options}</select>
      </label>
    `;
  }
  return `
    <label class="field ${classes}">
      <span>${escapeHtml(label)}</span>
      <input data-case-modal-field="${escapeHtml(field)}" type="${type}" value="${escapeHtml(value)}" />
    </label>
  `;
}

function caseDocuments(row) {
  return Array.isArray(row?.["Документы"]) ? row["Документы"] : [];
}

function formatDocumentSize(value) {
  const bytes = Number(value) || 0;
  if (!bytes) return "размер не указан";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function caseDocumentKey(document) {
  return String(document?.id || document?.token || document?.url || "").trim();
}

function caseDocumentsSection(row, canEdit) {
  const pendingDeletes = new Set(state.caseDocumentPendingDeletes ?? []);
  const documents = caseDocuments(row).filter((document) => !pendingDeletes.has(caseDocumentKey(document)));
  const pendingFiles = state.caseDocumentPendingFiles ?? [];
  const savedItems = documents.length
    ? documents.map((document) => {
      const key = caseDocumentKey(document);
      const downloadUrl = key
        ? `/api/cases/${encodeURIComponent(row.case_id)}/documents/${encodeURIComponent(key)}/download`
        : "";
      return `
        <div class="case-document-item">
          <span class="case-document-icon" aria-hidden="true">▤</span>
          <div class="case-document-info">
            <strong title="${escapeHtml(document.name || "Документ")}">${escapeHtml(document.name || "Документ")}</strong>
            <span>${escapeHtml(formatDocumentSize(document.size))}</span>
          </div>
          ${key ? `<button class="icon-btn case-document-preview" type="button" data-case-id="${escapeHtml(row.case_id)}" data-document-id="${escapeHtml(key)}" title="Открыть для просмотра" aria-label="Открыть ${escapeHtml(document.name || "документ")} для просмотра"><svg class="case-document-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2.75h7l5 5v13.5H6zM13 2.75v5h5M9 12h6M9 15.5h6" /></svg></button>` : ""}
          ${downloadUrl ? `<a class="icon-btn case-document-download" href="${downloadUrl}" title="Скачать документ" aria-label="Скачать ${escapeHtml(document.name || "документ")}"><svg class="case-document-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10.5m0 0 4-4m-4 4-4-4M5 15.5v4.75h14V15.5" /></svg></a>` : ""}
          ${state.caseModalEditing && canEdit && key ? `<button class="icon-btn case-document-delete" type="button" data-document-id="${escapeHtml(key)}" data-document-name="${escapeHtml(document.name || "Документ")}" title="Удалить документ" aria-label="Удалить ${escapeHtml(document.name || "документ")}"><svg class="case-document-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M9 7V4.5h6V7m-8 0 .8 13h8.4L17 7M10 10.5v6M14 10.5v6" /></svg></button>` : ""}
        </div>
      `;
    }).join("")
    : "";
  const pendingItems = pendingFiles.map((file, index) => `
    <div class="case-document-item case-document-item-pending">
      <span class="case-document-icon" aria-hidden="true">＋</span>
      <div class="case-document-info">
        <strong title="${escapeHtml(file.name || "Документ")}">${escapeHtml(file.name || "Документ")}</strong>
        <span>${escapeHtml(formatDocumentSize(file.size))} · будет загружен после сохранения</span>
      </div>
      <button class="icon-btn case-document-unstage" type="button" data-pending-index="${index}" title="Убрать из загрузки" aria-label="Убрать ${escapeHtml(file.name || "документ")} из загрузки">×</button>
    </div>
  `).join("");
  const items = savedItems || pendingItems
    ? `${savedItems}${pendingItems}`
    : `<div class="case-documents-empty">Документы не приложены.</div>`;
  const resultCount = documents.length + pendingFiles.length;
  return `
    <section class="case-documents-section">
      <div class="case-documents-head">
        <div>
          <span>Документы</span>
          <small>${resultCount ? `${resultCount} ${resultCount === 1 ? "файл" : "файлов"} после сохранения` : ""}</small>
        </div>
        ${pendingDeletes.size ? `<button class="tiny-btn light case-document-restore-deletes" type="button">Отменить удаление (${pendingDeletes.size})</button>` : ""}
      </div>
      <div class="case-documents-list">${items}</div>
      ${state.caseModalEditing && canEdit ? `
        <button class="case-document-dropzone" type="button" ${state.caseDocumentUploading ? "disabled" : ""}>
          <svg class="case-document-drop-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14V3.5m0 0 4 4m-4-4-4 4M5 15.5v4.75h14V15.5" /></svg>
          <span><strong>${state.caseDocumentUploading ? "Загрузка файлов…" : "Перетащите файлы сюда"}</strong><small>${state.caseDocumentUploading ? "Дождитесь завершения операции" : "Файлы загрузятся только после нажатия «Сохранить»"}</small></span>
        </button>
      ` : ""}
      ${state.caseModalEditing && canEdit ? `<input id="caseDocumentInput" class="hidden" type="file" multiple />` : ""}
    </section>
  `;
}

function documentPreviewKind(document = {}) {
  const mime = String(document.mimeType || "").toLowerCase();
  const name = String(document.name || "").toLowerCase();
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name)) return "image";
  if (mime.includes("wordprocessingml.document") || name.endsWith(".docx")) return "docx";
  if (mime.includes("spreadsheetml") || /\.(xlsx|xlsm)$/.test(name)) return "xlsx";
  return "unsupported";
}

function officePreviewHtml(preview = {}) {
  if (preview.type === "docx") {
    const blocks = (preview.blocks ?? []).map((block) => block.type === "table"
      ? `<div class="office-preview-table-wrap"><table class="office-preview-table">${(block.rows ?? []).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</table></div>`
      : `<p class="office-preview-paragraph">${escapeHtml(block.text)}</p>`).join("");
    return `<div class="office-preview office-preview-docx">${blocks || "<p>В документе не найден текст для отображения.</p>"}${preview.truncated ? "<p class=\"office-preview-note\">Показана начальная часть документа.</p>" : ""}</div>`;
  }
  const sheets = (preview.sheets ?? []).map((sheet) => `
    <section class="office-preview-sheet">
      <h3>${escapeHtml(sheet.name || "Лист")}</h3>
      <div class="office-preview-table-wrap"><table class="office-preview-table">${(sheet.rows ?? []).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("") || "<tr><td>Лист пуст.</td></tr>"}</table></div>
    </section>
  `).join("");
  return `<div class="office-preview office-preview-xlsx">${sheets || "<p>В книге не найдено листов для отображения.</p>"}${preview.truncated ? "<p class=\"office-preview-note\">Показана начальная часть книги.</p>" : ""}</div>`;
}

async function loadOfficeDocumentPreview(caseId, documentId) {
  const previewKey = `${caseId}::${documentId}`;
  try {
    const payload = await api(`/api/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/office-preview`);
    if (state.documentPreviewKey !== previewKey) return;
    $("#documentPreviewBody").innerHTML = officePreviewHtml(payload.preview);
  } catch (error) {
    if (state.documentPreviewKey !== previewKey) return;
    $("#documentPreviewBody").innerHTML = `<div class="document-preview-unsupported"><strong>Не удалось подготовить предпросмотр.</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

function closeDocumentPreview() {
  $("#documentPreviewModal")?.classList.remove("show");
  $("#documentPreviewModal")?.setAttribute("aria-hidden", "true");
  if ($("#documentPreviewBody")) $("#documentPreviewBody").innerHTML = "";
  if ($("#documentPreviewDownload")) $("#documentPreviewDownload").setAttribute("href", "#");
  state.documentPreviewKey = "";
}

function openDocumentPreview(caseId, documentId) {
  const row = state.data?.cases?.find((item) => item.case_id === caseId);
  const document = caseDocuments(row).find((item) => caseDocumentKey(item) === documentId);
  if (!row || !document) {
    toast("Документ не найден. Обновите данные и повторите попытку.", "error");
    return;
  }
  const source = `/api/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/preview`;
  const download = `/api/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/download`;
  const kind = documentPreviewKind(document);
  const previewKey = `${caseId}::${documentId}`;
  state.documentPreviewKey = previewKey;
  $("#documentPreviewTitle").textContent = document.name || "Документ";
  $("#documentPreviewDownload").setAttribute("href", download);
  $("#documentPreviewBody").innerHTML = kind === "pdf"
    ? `<iframe class="document-preview-frame" src="${source}" title="${escapeHtml(document.name || "Документ")}"></iframe>`
    : kind === "image"
      ? `<div class="document-preview-image-wrap"><img src="${source}" alt="${escapeHtml(document.name || "Документ")}" /></div>`
      : ["docx", "xlsx"].includes(kind)
        ? `<div class="document-preview-loading"><span class="loading-spinner" aria-hidden="true"></span><span>Подготавливаю предпросмотр…</span></div>`
      : `<div class="document-preview-unsupported"><strong>Для этого типа файла предпросмотр пока недоступен.</strong><span>Скачайте документ, чтобы открыть его в подходящей программе.</span></div>`;
  $("#documentPreviewModal")?.classList.add("show");
  $("#documentPreviewModal")?.setAttribute("aria-hidden", "false");
  $("#documentPreviewClose")?.focus();
  if (["docx", "xlsx"].includes(kind)) loadOfficeDocumentPreview(caseId, documentId);
}

function stageCaseDocuments(files) {
  const pendingFiles = [...(files ?? [])].filter((file) => file?.size >= 0);
  const row = caseModalRow();
  if (!pendingFiles.length || state.caseDocumentUploading || !row || !canEditCaseRow(row) || !state.caseModalEditing) return;
  state.caseDocumentPendingFiles.push(...pendingFiles);
  renderCaseModal();
  toast(pendingFiles.length === 1
    ? `Файл «${pendingFiles[0].name || "Документ"}» добавлен в черновик.`
    : `Файлов добавлено в черновик: ${pendingFiles.length}.`);
}

function unstageCaseDocument(index) {
  if (!state.caseModalEditing) return;
  state.caseDocumentPendingFiles.splice(Number(index), 1);
  renderCaseModal();
}

function stageCaseDocumentDeletion(documentId, name) {
  const row = caseModalRow();
  if (!row || !state.caseModalEditing || !canEditCaseRow(row)) return;
  if (!window.confirm(`Удалить документ «${name || "Документ"}» из карточки после нажатия «Сохранить»?`)) return;
  if (!state.caseDocumentPendingDeletes.includes(documentId)) state.caseDocumentPendingDeletes.push(documentId);
  renderCaseModal();
}

async function commitCaseDocumentUploads(files) {
  const pendingFiles = [...(files ?? [])];
  const row = caseModalRow();
  if (!pendingFiles.length || !row) return 0;
  const caseId = row.case_id;
  const successful = [];
  const failed = [];
  state.caseDocumentUploading = true;
  renderCaseModal();
  beginWriteLock();
  setStatus(`Загружаю файлы: 0 из ${pendingFiles.length}…`);
  try {
    for (const [index, file] of pendingFiles.entries()) {
      setStatus(`Загружаю файлы: ${index + 1} из ${pendingFiles.length}…`);
      try {
        const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/documents`, {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "X-File-Name": encodeURIComponent(file.name || "document"),
            "X-File-Type": file.type || "application/octet-stream",
          },
          body: file,
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Не удалось загрузить документ.");
        setDataFromPayload(payload);
        state.caseModalCaseId = payload.case?.case_id || caseId;
        successful.push(file.name || "Документ");
      } catch (error) {
        failed.push({ file, name: file.name || "Документ", error: error.message || "Неизвестная ошибка" });
      }
    }
    state.caseDocumentPendingFiles = failed.map((item) => item.file);
    if (failed.length) throw new Error(successful.length
      ? `Добавлено файлов: ${successful.length} из ${pendingFiles.length}. Не удалось: ${failed.map((item) => item.name).join(", ")}.`
      : `Не удалось загрузить файлы: ${failed.map((item) => item.name).join(", ")}.`);
    return successful.length;
  } finally {
    state.caseDocumentUploading = false;
    endWriteLock();
    if (caseModalRow()) renderCaseModal();
  }
}

function uploadDroppedCaseDocument(event) {
  stageCaseDocuments(event.dataTransfer?.files);
}

function renderCaseModal() {
  const row = caseModalRow();
  if (!row) return;
  const draft = caseModalDraft();
  const isJudicial = workloadCaseType(draft["Тип дела"]) === "судебное";
  const canEdit = !isDeletedCase(row) && canEditCaseRow(row);
  $("#caseModalTitle").textContent = `Карточка ${row.case_id}${state.caseModalLoading ? " · обновляю…" : ""}`;
  $("#caseModalBody").innerHTML = `
    <div class="case-modal-form ${state.caseModalEditing ? "editing" : "readonly"}">
      <div class="case-modal-status-row">
        <div class="case-detail-item case-id-preview">
          <span>ID</span>
          <strong>${escapeHtml(row.case_id)}</strong>
        </div>
        ${caseModalField({ field: "Статус", label: "Статус", type: "select", readonly: caseModalFieldReadonlyForUser("Статус") })}
        ${caseModalField({ field: "Ответственный", label: "Ответственный", type: "select", readonly: caseModalFieldReadonlyForUser("Ответственный") })}
      </div>
      <div class="case-modal-grid">
        ${caseModalField({ field: "Тип дела", label: "Тип дела", type: "select", readonly: caseModalFieldReadonlyForUser("Тип дела") })}
        ${caseModalField({ field: "Регион", label: "Регион", type: "select", readonly: caseModalFieldReadonlyForUser("Регион") })}
        ${caseModalField({ field: "Дата поступления", label: "Дата поступления", type: "date", readonly: caseModalFieldReadonlyForUser("Дата поступления") })}
        ${caseModalField({ field: "Номер дела", label: "Номер дела", readonly: caseModalFieldReadonlyForUser("Номер дела") })}
        ${caseModalField({ field: "Ссылка", label: "Ссылка на карточку в CasePRO", type: "url", wide: true, readonly: caseModalFieldReadonlyForUser("Ссылка") })}
      </div>
      <div class="case-modal-party-grid ${isJudicial ? "has-third-party" : ""}">
        ${caseModalField({ field: "Истец", label: "Истец / заявитель", readonly: caseModalFieldReadonlyForUser("Истец") })}
        ${caseModalField({ field: "Ответчик", label: "Ответчик", readonly: caseModalFieldReadonlyForUser("Ответчик") })}
        ${isJudicial ? caseModalField({ field: "Третье лицо", label: "Третье лицо", readonly: caseModalFieldReadonlyForUser("Третье лицо") }) : ""}
      </div>
      <div class="case-modal-grid">
        ${caseModalField({ field: "Предмет", label: "Предмет", type: "textarea", wide: true, rows: 4, readonly: caseModalFieldReadonlyForUser("Предмет") })}
        ${caseModalField({ field: "Движение дела", label: "Движение дела", type: "textarea", wide: true, rows: 5, readonly: caseModalFieldReadonlyForUser("Движение дела") })}
      </div>
      ${caseDocumentsSection(row, canEdit)}
    </div>
  `;
  $("#caseModalEdit").classList.toggle("hidden", state.caseModalEditing || !canEdit);
  $("#caseModalSave").classList.toggle("hidden", !state.caseModalEditing);
  $("#caseModalCancelEdit").classList.toggle("hidden", !state.caseModalEditing);
  $("#caseModalOk").textContent = state.caseModalEditing ? "Закрыть" : "Закрыть";
}

function openCaseModal(caseId) {
  const row = state.data.cases.find((item) => item.case_id === caseId);
  if (!row) return;
  state.caseModalCaseId = caseId;
  state.caseModalEditing = false;
  state.caseModalDraft = null;
  state.caseDocumentUploading = false;
  state.caseDocumentPendingFiles = [];
  state.caseDocumentPendingDeletes = [];
  state.caseModalLoading = true;
  renderCaseModal();
  $("#caseModal").classList.add("show");
  $("#caseModalEdit").focus();
  refreshCaseModal(caseId);
}

async function refreshCaseModal(caseId) {
  try {
    const payload = await api(`/api/cases/${encodeURIComponent(caseId)}`);
    // Пользователь мог закрыть одну карточку и открыть другую до ответа API.
    if (state.caseModalCaseId !== caseId || !payload.case) return;
    const index = state.data?.cases?.findIndex((item) => item.case_id === caseId) ?? -1;
    if (index >= 0) state.data.cases[index] = payload.case;
    const registryIndex = state.caseRegistryRows.findIndex((item) => item.case_id === caseId);
    if (registryIndex >= 0) state.caseRegistryRows[registryIndex] = payload.case;
  } catch (error) {
    if (state.caseModalCaseId === caseId) {
      toast(`Не удалось обновить карточку: ${error.message}`, "error");
    }
  } finally {
    if (state.caseModalCaseId === caseId) {
      state.caseModalLoading = false;
      renderCaseModal();
    }
  }
}

function closeCaseModal() {
  if (state.caseModalEditing && hasCaseModalChanges()) {
    const confirmed = window.confirm("Закрыть карточку без сохранения изменений?");
    if (!confirmed) return;
  }
  $("#caseModal").classList.remove("show");
  state.caseModalCaseId = "";
  state.caseModalEditing = false;
  state.caseModalDraft = null;
  state.caseDocumentUploading = false;
  state.caseDocumentPendingFiles = [];
  state.caseDocumentPendingDeletes = [];
  state.caseModalLoading = false;
}

function startCaseModalEdit() {
  const row = caseModalRow();
  if (!row) return;
  if (isDeletedCase(row)) {
    toast("Удалённое дело сначала нужно восстановить.", "error");
    return;
  }
  if (!canEditCaseRow(row)) {
    toast("В чужом ЮЦ карточка доступна только для просмотра.", "error");
    return;
  }
  state.caseModalEditing = true;
  state.caseModalDraft = caseModalInitialDraft(row);
  state.caseDocumentPendingFiles = [];
  state.caseDocumentPendingDeletes = [];
  renderCaseModal();
}

function cancelCaseModalEdit() {
  state.caseModalEditing = false;
  state.caseModalDraft = null;
  state.caseDocumentPendingFiles = [];
  state.caseDocumentPendingDeletes = [];
  renderCaseModal();
}

function updateCaseModalDraft(field, value) {
  if (!state.caseModalEditing || !state.caseModalDraft) return;
  state.caseModalDraft[field] = value;
  if (field === "Тип дела" && workloadCaseType(value) !== "судебное") {
    state.caseModalDraft["Третье лицо"] = "";
  }
  renderCaseModal();
}

function normalizedCaseModalValue(field, value) {
  if (field === "Тип дела") return normalizeCaseType(value);
  return String(value ?? "").trim();
}

function hasCaseModalChanges() {
  const row = caseModalRow();
  if (!row || !state.caseModalDraft) return false;
  const initial = caseModalInitialDraft(row);
  return state.caseDocumentPendingFiles.length > 0
    || state.caseDocumentPendingDeletes.length > 0
    || editableCaseModalFields().some((field) =>
    normalizedCaseModalValue(field, state.caseModalDraft[field]) !== normalizedCaseModalValue(field, initial[field])
  );
}

async function saveCaseModal() {
  const row = caseModalRow();
  if (!row || !state.caseModalDraft) return;
  const initial = caseModalInitialDraft(row);
  const patch = {};
  for (const field of editableCaseModalFields()) {
    const nextValue = normalizedCaseModalValue(field, state.caseModalDraft[field]);
    const currentValue = normalizedCaseModalValue(field, initial[field]);
    if (nextValue !== currentValue) {
      patch[field] = nextValue;
    }
  }
  const pendingDeletes = [...state.caseDocumentPendingDeletes];
  const pendingFiles = [...state.caseDocumentPendingFiles];
  if (!Object.keys(patch).length && !pendingDeletes.length && !pendingFiles.length) {
    cancelCaseModalEdit();
    return;
  }
  if (!isEmployeeUser() && patch["Статус"] && ["Завершено", "Отменено"].includes(patch["Статус"]) && !row["Дата завершения"]) {
    patch["Дата завершения"] = today();
  }
  setStatus("Сохраняю карточку дела…");
  let payload = null;
  if (Object.keys(patch).length) {
    payload = await api(`/api/cases/${encodeURIComponent(row.case_id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    setDataFromPayload(payload);
  }
  if (pendingDeletes.length) {
    setStatus("Удаляю выбранные документы…");
    payload = await api(`/api/cases/${encodeURIComponent(row.case_id)}/documents`, {
      method: "DELETE",
      body: JSON.stringify({ documentIds: pendingDeletes }),
    });
    setDataFromPayload(payload);
    state.caseDocumentPendingDeletes = [];
  }
  const uploadedCount = pendingFiles.length ? await commitCaseDocumentUploads(pendingFiles) : 0;
  state.lastRecommendation = null;
  state.caseModalCaseId = payload?.case?.case_id || row.case_id;
  state.caseModalEditing = false;
  state.caseModalDraft = null;
  state.caseDocumentPendingFiles = [];
  state.caseDocumentPendingDeletes = [];
  renderCaseModal();
  setStatus("Сохранено");
  const documentChanges = pendingDeletes.length + uploadedCount;
  toast(documentChanges
    ? `Карточка ${row.case_id} сохранена. Изменений документов: ${documentChanges}.`
    : `Карточка ${row.case_id} сохранена.`);
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
  await logOut();
}

function bindEvents() {
  document.addEventListener("click", blockWritePendingButtonEvents, true);
  $$(".nav-link").forEach((link) => {
    link.addEventListener("click", () => showView(link.dataset.view));
  });
  $("#refreshBtn").addEventListener("click", () => loadData({ view: activeDataViewName(), force: true }));
  $("#settingsHelpClose")?.addEventListener("click", closeSettingsHelp);
  $("#settingsHelpModal")?.addEventListener("click", (event) => {
    if (event.target.id === "settingsHelpModal") closeSettingsHelp();
  });
  $("#authLoginForm")?.addEventListener("submit", (event) => logIn(event).catch((error) => setAuthMessage(error.message, "error")));
  $("#authFirstAccessForm")?.addEventListener("submit", (event) => completeFirstAccess(event).catch((error) => setAuthMessage(error.message, "error")));
  $$(".auth-mode").forEach((button) => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
  $("#refreshAccessBtn")?.addEventListener("click", () => loadAccessUsers({ force: true }).catch((error) => toast(error.message, "error")));
  $("#closeAccessCodeBtn")?.addEventListener("click", closeAccessCodeModal);
  $("#copyAccessCodeBtn")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText($("#accessCodeValue").textContent || ""); toast("Код скопирован."); } catch { toast("Не удалось скопировать код. Скопируйте его вручную.", "error"); } });
  $("#accessCodeModal")?.addEventListener("click", (event) => { if (event.target.id === "accessCodeModal") closeAccessCodeModal(); });
  $("#exitBtn").addEventListener("click", () => exitApplication());
  $("#toggleHistoricalDashboard")?.addEventListener("click", toggleHistoricalDashboardWithFlip);
  $("#themeToggle")?.addEventListener("change", (event) => {
    applyTheme(event.target.checked ? redTheme : blueTheme);
  });
  $("#saveYucSettingsBtn")?.addEventListener("click", () => saveYucSettings().catch((error) => {
    setStatus("Ошибка");
    toast(error.message, "error");
  }));
  $("#saveLoadCoefficientsBtn")?.addEventListener("click", () => saveLoadCoefficients().catch((error) => {
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
  $("#caseModalEdit")?.addEventListener("click", startCaseModalEdit);
  $("#caseModalCancelEdit")?.addEventListener("click", cancelCaseModalEdit);
  $("#caseModalSave")?.addEventListener("click", () => saveCaseModal().catch((error) => {
    setStatus("Ошибка");
    toast(error.message, "error");
  }));
  $("#caseModal").addEventListener("click", (event) => {
    if (event.target.id === "caseModal") closeCaseModal();
  });
  $("#caseModal").addEventListener("dragover", (event) => {
    const dropzone = event.target.closest(".case-document-dropzone:not([disabled])");
    if (!dropzone) return;
    event.preventDefault();
    dropzone.classList.add("is-dragging");
  });
  $("#caseModal").addEventListener("dragleave", (event) => {
    const dropzone = event.target.closest(".case-document-dropzone");
    if (!dropzone || dropzone.contains(event.relatedTarget)) return;
    dropzone.classList.remove("is-dragging");
  });
  $("#caseModal").addEventListener("drop", (event) => {
    const dropzone = event.target.closest(".case-document-dropzone:not([disabled])");
    if (!dropzone) return;
    event.preventDefault();
    dropzone.classList.remove("is-dragging");
    uploadDroppedCaseDocument(event);
  });
  $("#documentPreviewClose")?.addEventListener("click", closeDocumentPreview);
  $("#documentPreviewOk")?.addEventListener("click", closeDocumentPreview);
  $("#documentPreviewModal")?.addEventListener("click", (event) => {
    if (event.target.id === "documentPreviewModal") closeDocumentPreview();
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
  $("#caseImportBtn")?.addEventListener("click", () => {
    state.caseImportYuc = selectedYuc();
    if (!state.caseImportYuc || isExternalReadOnlyYuc()) {
      toast("Выберите доступную вкладку юридического центра для импорта.", "error");
      return;
    }
    $("#caseImportInput")?.click();
  });
  $("#caseImportInput")?.addEventListener("change", (event) => {
    previewCaseImport(event.target.files?.[0]).catch((error) => {
      recordClientError(error, "Предварительная проверка Excel-импорта");
      setStatus("Ошибка");
      toast(error.message, "error");
    });
  });
  $("#caseImportCancelBtn")?.addEventListener("click", closeCaseImportModal);
  $("#caseImportModal")?.addEventListener("click", (event) => {
    if (event.target.id === "caseImportModal") closeCaseImportModal();
    const tab = event.target.closest("[data-import-tab]");
    if (tab) {
      state.caseImportActiveTab = tab.dataset.importTab === "updates" ? "updates" : "new";
      renderCaseImportModal();
      return;
    }
    if (event.target.closest("#caseImportSelectAllBtn")) {
      state.caseImportSelectedRows = new Set((state.caseImportPlan?.toAdd ?? []).map((item) => String(item.rowNumber)));
      renderCaseImportModal();
    }
    if (event.target.closest("#caseImportClearAllBtn")) {
      state.caseImportSelectedRows = new Set();
      renderCaseImportModal();
    }
    if (event.target.closest("#caseImportUpdateSelectAllBtn")) {
      state.caseImportSelectedUpdates = new Set((state.caseImportPlan?.existing ?? []).filter((item) => item.changes?.length).map((item) => String(item.caseId)));
      renderCaseImportModal();
    }
    if (event.target.closest("#caseImportUpdateClearAllBtn")) {
      state.caseImportSelectedUpdates = new Set();
      renderCaseImportModal();
    }
  });
  $("#caseImportApplyBtn")?.addEventListener("click", () => applyCaseImport().catch((error) => {
    recordClientError(error, "Применение Excel-импорта");
    setStatus("Ошибка");
    toast(error.message, "error");
  }));
  $("#saveStatus")?.addEventListener("click", () => copyLastApiError().catch((error) => toast(error.message, "error")));
  $("#saveStatus")?.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && state.lastApiError) {
      event.preventDefault();
      copyLastApiError().catch((error) => toast(error.message, "error"));
    }
  });
  $("#caseForm").addEventListener("change", handleCaseFormRecommendationChange);
  $("#casesSearch").addEventListener("input", scheduleCasesRender);
  $("#casesSearchClear")?.addEventListener("click", () => {
    const input = $("#casesSearch");
    if (!input) return;
    input.value = "";
    state.casesPage = 1;
    loadCaseRegistry({ page: 1 }).catch((error) => toast(error.message, "error"));
    input.focus();
  });
  $("#caseColumnsInline")?.addEventListener("click", (event) => {
    if (event.target.closest(".case-columns-toggle")) toggleCaseColumnsPanel();
  });
  $("#casesQuickFilterStrip")?.addEventListener("click", (event) => {
    if (event.target.closest("#clearCasesQuickFilter")) {
      state.casesQuickFilter = "";
      state.casesPage = 1;
      loadCaseRegistry({ page: 1 }).catch((error) => toast(error.message, "error"));
    }
    if (event.target.closest("#clearCasesResponsibleFilter")) {
      state.casesResponsibleFilter = "";
      state.casesPage = 1;
      loadCaseRegistry({ page: 1 }).catch((error) => toast(error.message, "error"));
    }
    if (event.target.closest("#clearCasesCellFilter")) {
      clearCasesCellFilter();
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
      if (state.data) {
        if (state.employeeSection === "vacations") renderVacations();
        else resetEmployeeAvailabilityDrafts();
      }
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
    const settingsNumberButton = event.target.closest("[data-settings-number-step]");
    if (settingsNumberButton) {
      changeSettingsNumber(settingsNumberButton);
      return;
    }
    const settingsHelpButton = event.target.closest("[data-settings-help]");
    if (settingsHelpButton) {
      openSettingsHelp(settingsHelpButton.dataset.settingsHelp);
      return;
    }
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
    const historicalPresetButton = event.target.closest(".historical-preset");
    if (historicalPresetButton) {
      setHistoricalPreset(historicalPresetButton.dataset.preset);
      return;
    }
    const casesPageButton = event.target.closest(".cases-page-button");
    if (casesPageButton && !casesPageButton.disabled) {
      state.casesPage = Math.max(1, Number(casesPageButton.dataset.casesPage) || 1);
      loadCaseRegistry({ page: state.casesPage }).catch((error) => toast(error.message, "error"));
      return;
    }
    const historicalSegmentButton = event.target.closest(".historical-segment");
    if (historicalSegmentButton) {
      applyHistoricalCaseFilter(historicalSegmentButton.dataset.responsible, historicalSegmentButton.dataset.type);
      return;
    }
    const historicalFilterButton = event.target.closest(".historical-filter");
    if (historicalFilterButton) {
      applyHistoricalCaseFilter(historicalFilterButton.dataset.responsible);
      return;
    }
    const saveAccessRoleButton = event.target.closest(".save-access-role");
    if (saveAccessRoleButton) { saveAccessRole(saveAccessRoleButton.dataset.employeeId).catch((error) => toast(error.message, "error")); return; }
    const issueAccessCodeButton = event.target.closest(".issue-access-code");
    if (issueAccessCodeButton) { issueAccessCode(issueAccessCodeButton.dataset.employeeId).catch((error) => toast(error.message, "error")); return; }
    const resetAccessPasswordButton = event.target.closest(".reset-access-password");
    if (resetAccessPasswordButton) { resetAccessPassword(resetAccessPasswordButton.dataset.employeeId).catch((error) => toast(error.message, "error")); return; }
    const accessYucToggle = event.target.closest(".access-yuc-toggle");
    if (accessYucToggle) { toggleAccessYuc(accessYucToggle.dataset.accessYuc); return; }
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
    if (yucTab?.dataset.caseScope === "mine") {
      selectCaseListScope("mine");
      return;
    }
    if (yucTab) setSelectedYuc(yucTab.dataset.yuc);
    const caseCellFilterButton = event.target.closest(".case-cell-filter");
    if (caseCellFilterButton) {
      if (canUseCaseCellFilters()) {
        applyCasesCellFilter(caseCellFilterButton.dataset.caseFilterField, caseCellFilterButton.dataset.caseFilterValue);
      }
      return;
    }
    const caseDocumentDropzone = event.target.closest(".case-document-dropzone:not([disabled])");
    if (caseDocumentDropzone) {
      $("#caseDocumentInput")?.click();
      return;
    }
    const deleteCaseDocumentButton = event.target.closest(".case-document-delete");
    if (deleteCaseDocumentButton) {
      stageCaseDocumentDeletion(deleteCaseDocumentButton.dataset.documentId, deleteCaseDocumentButton.dataset.documentName);
      return;
    }
    const unstageCaseDocumentButton = event.target.closest(".case-document-unstage");
    if (unstageCaseDocumentButton) {
      unstageCaseDocument(unstageCaseDocumentButton.dataset.pendingIndex);
      return;
    }
    const restoreCaseDocumentDeletesButton = event.target.closest(".case-document-restore-deletes");
    if (restoreCaseDocumentDeletesButton) {
      state.caseDocumentPendingDeletes = [];
      renderCaseModal();
      return;
    }
    const previewCaseDocumentButton = event.target.closest(".case-document-preview");
    if (previewCaseDocumentButton) {
      openDocumentPreview(previewCaseDocumentButton.dataset.caseId, previewCaseDocumentButton.dataset.documentId);
      return;
    }
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
    if (event.target.matches(".settings-number-input")) {
      syncSettingsNumberStepper(event.target);
      setStatus("Есть несохраненные изменения");
      return;
    }
    if (event.target.matches("#weightedDashboardToggle")) {
      setWeightedDashboard(event.target.checked);
      return;
    }
    if (event.target.matches(".case-column-visibility")) {
      setCaseColumnVisibility(event.target.dataset.columnKey, event.target.checked);
      return;
    }
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
    if (event.target.matches("#caseImportUpdateSelectAll")) {
      state.caseImportSelectedUpdates = event.target.checked
        ? new Set((state.caseImportPlan?.existing ?? []).filter((item) => item.changes?.length).map((item) => String(item.caseId)))
        : new Set();
      renderCaseImportModal();
      return;
    }
    if (event.target.matches(".case-import-update-check")) {
      const caseId = String(event.target.dataset.caseId ?? "");
      if (caseId) {
        if (event.target.checked) state.caseImportSelectedUpdates.add(caseId);
        else state.caseImportSelectedUpdates.delete(caseId);
      }
      updateCaseImportSelectionState();
      return;
    }
    if (event.target.matches(".case-import-responsible")) {
      const rowNumber = String(event.target.dataset.rowNumber ?? "");
      if (rowNumber) {
        const value = event.target.value;
        if (value) {
          state.caseImportResponsibleOverrides[rowNumber] = value;
          state.caseImportSelectedRows.add(rowNumber);
        } else {
          delete state.caseImportResponsibleOverrides[rowNumber];
          state.caseImportSelectedRows.delete(rowNumber);
        }
      }
      renderCaseImportModal();
      return;
    }
    if (event.target.matches(".case-import-region")) {
      const rowNumber = String(event.target.dataset.rowNumber ?? "");
      if (rowNumber) {
        const region = cleanImportValue(event.target.value);
        if (region) state.caseImportRegionOverrides[rowNumber] = region;
        else delete state.caseImportRegionOverrides[rowNumber];
      }
      renderCaseImportModal();
      return;
    }
    if (event.target.matches("#historicalFrom")) {
      state.historicalAllTime = false;
      state.historicalInitialized = true;
      state.historicalPeriodPreset = "custom";
      state.historicalFrom = event.target.value;
      renderWorkloadDashboard();
      return;
    }
    if (event.target.matches("#historicalTo")) {
      state.historicalAllTime = false;
      state.historicalInitialized = true;
      state.historicalPeriodPreset = "custom";
      state.historicalTo = event.target.value;
      renderWorkloadDashboard();
      return;
    }
    if (event.target.matches("#historicalDateMode")) {
      state.historicalDateMode = event.target.value === "completed" ? "completed" : "assigned";
      renderWorkloadDashboard();
      return;
    }
    if (event.target.matches("#caseDocumentInput")) {
      const files = [...(event.target.files ?? [])];
      event.target.value = "";
      stageCaseDocuments(files);
      return;
    }
    if (event.target.matches("[data-case-modal-field]")) {
      updateCaseModalDraft(event.target.dataset.caseModalField, event.target.value);
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
      closeDocumentPreview();
    }
  });
}

async function init() {
  applyTheme(savedTheme(), false);
  $("#caseForm").elements["Дата поступления"].value = today();
  updateThirdPartyVisibility();
  bindEvents();
  try {
    const session = await api("/api/auth/session");
    if (!session.configured) { showAuthGate(session.message || "Авторизация ещё не настроена."); return; }
    if (!session.authenticated) { showAuthGate(); return; }
    applyAuthUser(session.user);
    hideAuthGate();
    await loadData();
  } catch (error) {
    showAuthGate(error.message || "Не удалось проверить вход в приложение.");
  }
}

init();

window.addEventListener("error", (event) => {
  recordClientError(event.error ?? event.message, "Необработанная ошибка интерфейса");
  setStatus("Ошибка");
});
window.addEventListener("unhandledrejection", (event) => {
  recordClientError(event.reason, "Необработанная ошибка операции");
  setStatus("Ошибка");
});


// Safari может восстановить вкладку из back/forward cache без повторного запуска init().
// В таком случае заново сверяем серверный сеанс: удалённый хэш пароля должен немедленно
// закрывать доступ и после возвращения к уже открытой вкладке.
window.addEventListener("pageshow", async (event) => {
  if (!event.persisted) return;
  try {
    const session = await api("/api/auth/session");
    if (!session.authenticated) showAuthGate();
  } catch {
    showAuthGate();
  }
});
