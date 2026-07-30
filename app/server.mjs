import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuthController } from "./lib/auth-controller.mjs";
import { canManageYuc } from "./lib/access-policy.mjs";
import { FIELD, cleanText, enrichData, normalizeYuc, nameMatches } from "./lib/domain.mjs";
import { createTableRows, patchTableRow, patchTableRows, readData as readDataFresh, saveData, storagePath, tabsStorageStatus } from "./lib/tabs-store.mjs";
import { directoriesPath, readDirectories } from "./lib/directories.mjs";
import { loadRuntimeConfig } from "./lib/runtime-config.mjs";
import { readBinaryBody, readJsonBody as readBody, sendJson, serveStatic } from "./lib/http-utils.mjs";
import { createTableCache } from "./lib/table-cache.mjs";
import { createSettingsRoutes } from "./routes/settings-routes.mjs";
import { createVacationRoutes } from "./routes/vacation-routes.mjs";
import { createCaseImportRoutes } from "./routes/case-import-routes.mjs";
import { createCaseRoutes } from "./routes/case-routes.mjs";
import { createWriteCoordinator, isMutationRequest } from "./lib/write-coordinator.mjs";
import { normalizeError } from "./lib/errors.mjs";
import { assertAllowedFields } from "./lib/validation.mjs";
import { mutationReadTables } from "./lib/mutation-dependencies.mjs";
import { managerScopedData, tableKeysForView } from "./lib/view-data.mjs";
import { createCacheWarmup } from "./lib/cache-warmup.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const LOG_DIR = path.join(__dirname, "logs");
const SERVER_LOG_PATH = path.join(LOG_DIR, "server.log");
const runtime = loadRuntimeConfig();
const PORT = runtime.port;
const HOST = runtime.host;
const CACHE_TTL = {
  default: runtime.cacheTtl.default,
  employees: runtime.cacheTtl.employees,
  vacations: runtime.cacheTtl.vacations,
  settings: runtime.cacheTtl.static,
  yucSettings: runtime.cacheTtl.static,
  regionalAssignments: runtime.cacheTtl.static,
  regionalSubstitutions: runtime.cacheTtl.static,
  loadCoefficients: runtime.cacheTtl.static,
};
const ALL_TABLE_KEYS = [
  "cases",
  "employees",
  "queues",
  "state",
  "vacations",
  "settings",
  "yucSettings",
  "regionalAssignments",
  "regionalSubstitutions",
  "loadCoefficients",
];
const BOOTSTRAP_TABLE_KEYS = ALL_TABLE_KEYS;

const CASE_DOCUMENT_MAX_BYTES = runtime.caseDocumentMaxBytes;
const OFFICE_PREVIEW_MAX_BYTES = runtime.officePreviewMaxBytes;

const tableCache = createTableCache({
  readFresh: readDataFresh,
  tableKeys: ALL_TABLE_KEYS,
  bootstrapKeys: BOOTSTRAP_TABLE_KEYS,
  ttlByTable: CACHE_TTL,
  defaultTtl: CACHE_TTL.default,
});
const readData = tableCache.read;
async function readRouteData(keys = ALL_TABLE_KEYS, options = {}) {
  await readData(keys, options);
  return tableCache.snapshot();
}
const CACHE_WARMUP_TABLE_KEYS = tableKeysForView("dashboard", ALL_TABLE_KEYS);
const cacheWarmup = createCacheWarmup({
  enabled: runtime.cacheWarmupEnabled,
  tableKeys: CACHE_WARMUP_TABLE_KEYS,
  readData,
  readDirectories,
});
function cacheStatus() {
  return { ...tableCache.status(), warmup: cacheWarmup.status() };
}
const writeCoordinator = createWriteCoordinator({
  beforeWrite: ({ method, pathname } = {}) => {
    const tables = mutationReadTables(method, pathname);
    return tables.length ? readData(tables, { force: true }) : undefined;
  },
});


const EMPLOYEE_MANAGER_EDIT_FIELDS = new Set(["Активен", "Судебные", "Административные", "Претензии"]);

function employeeScopedData(rawData, employee) {
  // По принятой матрице доступа сотрудник читает дела всех ЮЦ, но сервер
  // разрешает ему изменять только собственные дела своего ЮЦ.
  return enrichData({
    cases: rawData.cases ?? [],
    employees: [employee],
    queues: [],
    state: [],
    vacations: [],
    settings: [],
    yucSettings: [],
    regionalAssignments: [],
    regionalSubstitutions: [],
    loadCoefficients: rawData.loadCoefficients ?? [],
  });
}

async function saveAuthEmployee(data, employee) {
  const authFields = ["Роль доступа", "Хэш-пароля", "Хэш кода первичного входа", "Срок действия кода"];
  if (employee?._recordId) {
    await patchTableRow("employees", employee, authFields);
    tableCache.replace("employees", data.employees);
    return employee;
  }
  await saveData(data, ["employees"]);
  const fresh = await readData(["employees"], { force: true });
  return fresh.employees.find((item) => cleanText(item.employee_id) === cleanText(employee.employee_id)) ?? employee;
}

const auth = createAuthController({ readData, saveEmployee: saveAuthEmployee, sendJson, readBody });

function requireManageYuc(user, yuc) {
  if (canManageYuc(user, yuc)) return;
  const error = new Error("Изменение данных доступно руководителю только в его ЮЦ.");
  error.status = 403;
  throw error;
}

function requireManageCase(user, data, caseId) {
  const caseRow = findCase(data, caseId);
  if (!caseRow) {
    const error = new Error("Дело не найдено.");
    error.status = 404;
    throw error;
  }
  requireManageYuc(user, caseRow[FIELD.yuc]);
  return caseRow;
}

function requireManageEmployee(user, data, employeeId) {
  const employee = data.employees.find((item) => cleanText(item.employee_id) === cleanText(employeeId));
  if (!employee) {
    const error = new Error("Сотрудник не найден.");
    error.status = 404;
    throw error;
  }
  requireManageYuc(user, employee[FIELD.yuc]);
  return employee;
}

function requireEmployeeInYuc(data, name, yuc, label = "Сотрудник") {
  const employee = data.employees.find((item) =>
    nameMatches(item[FIELD.name], name) && normalizeYuc(item[FIELD.yuc]) === normalizeYuc(yuc)
  );
  if (employee) return employee;
  const error = new Error(`${label} «${cleanText(name) || "не указан"}» не найден в ЮЦ «${normalizeYuc(yuc)}».`);
  error.status = 400;
  throw error;
}

async function confirmedDataAfterSave(data, changedTables = null, confirm = null) {
  if (typeof changedTables === "function") {
    confirm = changedTables;
    changedTables = null;
  }
  const tablesToSave = changedTables ?? ALL_TABLE_KEYS;
  const currentData = await readData(tablesToSave, { cacheOnly: true });
  await saveData(data, tablesToSave, { currentData });
  let lastData = null;
  const refreshTables = changedTables;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt) {
      await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    }
    const freshData = changedTables
      ? { ...data, ...(refreshTables?.length ? await readData(refreshTables, { force: true }) : {}) }
      : await readData(undefined, { force: true });
    lastData = enrichData(freshData);
    if (!confirm || confirm(lastData)) return lastData;
  }
  return lastData;
}

function findCase(data, caseId) {
  return data.cases.find((item) => item.case_id === caseId);
}

const handleSettingsRoute = createSettingsRoutes({
  readBody,
  readData: readRouteData,
  saveAndConfirm: confirmedDataAfterSave,
  sendJson,
  requireManageYuc,
  requireEmployeeInYuc,
  requireAdmin: (user) => {
    if (auth.isAdmin(user)) return;
    const error = new Error("Изменять глобальные коэффициенты может только администратор.");
    error.status = 403;
    throw error;
  },
});
const handleVacationRoute = createVacationRoutes({
  readBody,
  readBinaryBody,
  readData: readRouteData,
  saveAndConfirm: confirmedDataAfterSave,
  sendJson,
  requireManageEmployee,
});
const handleCaseImportRoute = createCaseImportRoutes({
  readBody,
  readBinaryBody,
  readData: readRouteData,
  readDirectories,
  createTableRows,
  patchTableRows,
  cacheVersions: tableCache.versions,
  sendJson,
  requireManageYuc,
  requireEmployeeInYuc,
  findCase,
});
const handleCaseRoute = createCaseRoutes({
  auth,
  readBody,
  readBinaryBody,
  readData: readRouteData,
  saveAndConfirm: confirmedDataAfterSave,
  sendJson,
  requireManageYuc,
  requireManageCase,
  employeeScopedData,
  patchCachedRow: async (table, row, fields, data) => {
    await patchTableRow(table, row, fields);
    tableCache.replace(table, data[table]);
  },
  caseDocumentMaxBytes: CASE_DOCUMENT_MAX_BYTES,
  officePreviewMaxBytes: OFFICE_PREVIEW_MAX_BYTES,
});

async function api(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "load-distribution",
      storage: "mts-tabs",
      persistentLocalStorage: false,
      cacheWarmup: cacheWarmup.status(),
    });
  }
  if (await auth.handleAuth(req, res, url)) return;
  const user = await auth.currentUser(req);
  if (!user) {
    const error = new Error(auth.configured() ? "Требуется вход в приложение." : "Авторизация ещё не настроена.");
    error.status = 401;
    throw error;
  }

  if (req.method === "GET" && url.pathname === "/api/data") {
    const requestedView = cleanText(url.searchParams.get("view"));
    const requestedKeys = tableKeysForView(requestedView, ALL_TABLE_KEYS);
    const rawData = await readData(requestedKeys, { force: url.searchParams.get("refresh") === "1" });
    const loadedTables = Object.keys(rawData);
    if (auth.isManager(user)) {
      const directories = await readDirectories({ force: url.searchParams.get("refreshDirectories") === "1" });
      const data = { ...managerScopedData(rawData), directories };
      return sendJson(res, 200, { ok: true, user, data, loadedTables, view: requestedView || "all", storagePath: storagePath(), tabsStorageStatus: tabsStorageStatus(), cacheStatus: cacheStatus(), directoriesPath: directoriesPath() });
    }
    const employee = rawData.employees.find((item) => cleanText(item.employee_id) === user.employeeId);
    if (!employee) {
      const error = new Error("Учётная запись сотрудника не найдена.");
      error.status = 401;
      throw error;
    }
    const directories = await readDirectories();
    return sendJson(res, 200, { ok: true, user, data: { ...employeeScopedData(rawData, employee), directories }, loadedTables, view: requestedView || "all", storagePath: storagePath(), cacheStatus: cacheStatus() });
  }

  if (await handleCaseRoute(req, res, url, user)) return;

  if (!auth.isManager(user)) {
    const error = new Error("Сотруднику доступен только список собственных дел и их карточки.");
    error.status = 403;
    throw error;
  }

  if (await auth.handleAccess(req, res, url, user)) return;
  if (req.method === "GET" && url.pathname === "/api/cache-status") {
    return sendJson(res, 200, { ok: true, cacheStatus: cacheStatus() });
  }

  if (req.method === "GET" && url.pathname === "/api/storage-status") {
    return sendJson(res, 200, { ok: true, storageStatus: { ...tabsStorageStatus(), cache: cacheStatus() } });
  }

  if (req.method === "GET" && url.pathname === "/api/directories") {
    const directories = await readDirectories({ force: url.searchParams.get("refresh") === "1" });
    return sendJson(res, 200, { ok: true, directories, directoriesPath: directoriesPath() });
  }

  if (await handleSettingsRoute(req, res, url, user)) return;

  if (req.method === "PATCH" && url.pathname.startsWith("/api/employees/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const body = await readBody(req);
    const patch = body.employee && typeof body.employee === "object" ? body.employee : body;
    const debts = Array.isArray(body.debts) ? body.debts : [];
    const data = await readRouteData(["employees", "queues"]);
    const employee = data.employees.find((item) => item.employee_id === id);
    if (!employee) return sendJson(res, 404, { ok: false, error: "Сотрудник не найден." });
    requireManageYuc(user, employee[FIELD.yuc]);
    assertAllowedFields(patch, EMPLOYEE_MANAGER_EDIT_FIELDS, "Через этот экран нельзя изменять");
    Object.assign(employee, Object.fromEntries(Object.entries(patch).filter(([field]) => EMPLOYEE_MANAGER_EDIT_FIELDS.has(field))));
    const debtRows = debts.map((item) => {
      const row = data.queues.find((candidate) => candidate.queue_id === cleanText(item.queue_id) && candidate.employee_id === cleanText(item.employee_id));
      if (!row || row.employee_id !== id) throw Object.assign(new Error("Строка долга сотрудника не найдена."), { status: 404 });
      requireManageYuc(user, row[FIELD.yuc]);
      row[FIELD.debt] = Math.max(0, Math.floor(Number(item[FIELD.debt]) || 0));
      return row;
    });
    await patchTableRow("employees", employee, [...EMPLOYEE_MANAGER_EDIT_FIELDS]);
    if (debtRows.length) await patchTableRows("queues", debtRows.map((row) => ({ row, changedFields: [FIELD.debt] })));
    tableCache.replace("employees", data.employees);
    tableCache.replace("queues", data.queues);
    return sendJson(res, 200, { ok: true, employee, queues: debtRows });
  }

  if (await handleVacationRoute(req, res, url, user)) return;
  if (await handleCaseImportRoute(req, res, url, user)) return;

  if (req.method === "PATCH" && url.pathname.startsWith("/api/queues/")) {
    const [, , , queueId, employeeId] = url.pathname.split("/");
    const patch = await readBody(req);
    const data = await readRouteData(["queues"]);
    const row = data.queues.find((item) => item.queue_id === decodeURIComponent(queueId) && item.employee_id === decodeURIComponent(employeeId));
    if (!row) return sendJson(res, 404, { ok: false, error: "Строка очереди не найдена." });
    requireManageYuc(user, row[FIELD.yuc]);
    assertAllowedFields(patch, new Set([FIELD.debt]), "В очереди нельзя изменять");
    Object.assign(row, patch);
    await patchTableRow("queues", row, [FIELD.debt]);
    tableCache.replace("queues", data.queues);
    return sendJson(res, 200, { ok: true, queue: row, data: enrichData(data) });
  }

  return sendJson(res, 404, { ok: false, error: "Метод API не найден." });
}

async function staticFile(req, res, url) {
  return serveStatic(req, res, url, PUBLIC_DIR);
}

function errorLogId() {
  return `ERR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

async function writeServerErrorLog({ id, req, url, error }) {
  const entry = {
    timestamp: new Date().toISOString(),
    id,
    method: req.method,
    path: url.pathname,
    status: error?.status || 500,
    message: error?.message || "Ошибка сервера.",
    stack: error?.stack || "",
  };
  if (!runtime.fileLogging) return;
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(SERVER_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (logError) {
    console.error("Не удалось записать файл ошибки:", logError?.message || logError);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestStarted = performance.now();
  const originalWriteHead = res.writeHead.bind(res);
  res.writeHead = (statusCode, statusMessageOrHeaders, maybeHeaders) => {
    const timing = `app;dur=${Math.max(0, performance.now() - requestStarted).toFixed(1)}`;
    if (typeof statusMessageOrHeaders === "string") {
      return originalWriteHead(statusCode, statusMessageOrHeaders, { ...(maybeHeaders ?? {}), "Server-Timing": timing });
    }
    return originalWriteHead(statusCode, { ...(statusMessageOrHeaders ?? {}), "Server-Timing": timing });
  };
  try {
    if (url.pathname.startsWith("/api/")) {
      if (isMutationRequest(req.method, url.pathname)) {
        await writeCoordinator.run(() => api(req, res, url), { method: req.method, pathname: url.pathname });
      }
      else await api(req, res, url);
    } else {
      await staticFile(req, res, url);
    }
  } catch (error) {
    const normalizedError = normalizeError(error);
    const id = errorLogId();
    if (normalizedError.status >= 500) {
      console.error(`[${id}] ${req.method} ${url.pathname}:`, normalizedError.stack || normalizedError);
      await writeServerErrorLog({ id, req, url, error: normalizedError });
    }
    sendJson(res, normalizedError.status, {
      ok: false,
      error: normalizedError.status >= 500 ? `${normalizedError.message} Код ошибки: ${id}` : normalizedError.message,
      code: normalizedError.code,
      ...(normalizedError.details ? { details: normalizedError.details } : {}),
      ...(normalizedError.status >= 500 ? { errorId: id } : {}),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Приложение запущено: http://${HOST}:${PORT}`);
  console.log(`MTS Tabs API: ${storagePath()}`);
  void cacheWarmup.run().then((warmup) => {
    const message = `Прогрев кэша: ${warmup.state}, ${warmup.durationMs ?? 0} мс`;
    if (warmup.errors.length) console.warn(message, warmup.errors);
    else console.log(message);
  });
});

function shutdown(signal) {
  console.log(`Получен ${signal}. Сервер завершает работу.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
