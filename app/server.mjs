import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuthController } from "./lib/auth-controller.mjs";
import { FIELD, YUC_SETTING, allDatesInRange, assignAutomatically, assignExistingAutomatically, assignExistingManually, assignManually, changeCaseResponsible, cleanText, clearVacationYear, completeCaseByDeadline, deleteCase, enrichData, importCasesFromRows, normalizeDraft, normalizeType, normalizeYuc, nameMatches, postponeCaseCompletion, recommend, recommendWithPreview, replaceVacationDatesForEmployees, replaceVacationYear, restoreCase, setVacationDates, toISODate, yesNo } from "./lib/domain.mjs";
import { readData as readDataFresh, saveData, storagePath, tabsStorageStatus } from "./lib/tabs-store.mjs";
import { directoriesPath, readDirectories } from "./lib/directories.mjs";
import { parseCaseWorkbook } from "./lib/xlsx-case-import.mjs";
import { parseVacationWorkbook } from "./lib/xlsx-vacation-import.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 8766);
const HOST = process.env.HOST || "127.0.0.1";
const CACHE_TTL = {
  default: Number(process.env.FAST_ENGINE_CACHE_TTL_MS || 30000),
  employees: Number(process.env.FAST_ENGINE_EMPLOYEES_CACHE_TTL_MS || 120000),
  vacations: Number(process.env.FAST_ENGINE_VACATIONS_CACHE_TTL_MS || 120000),
  journal: Number(process.env.FAST_ENGINE_JOURNAL_CACHE_TTL_MS || 300000),
  settings: Number(process.env.FAST_ENGINE_STATIC_CACHE_TTL_MS || 600000),
  yucSettings: Number(process.env.FAST_ENGINE_STATIC_CACHE_TTL_MS || 600000),
  regionalAssignments: Number(process.env.FAST_ENGINE_STATIC_CACHE_TTL_MS || 600000),
};
const ALL_TABLE_KEYS = [
  "cases",
  "employees",
  "queues",
  "state",
  "vacations",
  "journal",
  "settings",
  "yucSettings",
  "regionalAssignments",
];
const BOOTSTRAP_TABLE_KEYS = ALL_TABLE_KEYS.filter((key) => key !== "journal");

const cache = {
  tables: new Map(),
  loadedAt: new Map(),
  pending: new Map(),
};
const performanceLog = {
  startedAt: new Date().toISOString(),
  tableReads: new Map(),
  recentReads: [],
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const PRIVATE_EMPLOYEE_FIELDS = new Set(["Хэш-пароля", "Хэш кода первичного входа"]);

function sanitizeApiPayload(value, key = "") {
  if (Array.isArray(value)) {
    if (key === "employees") {
      return value.map((employee) => {
        const copy = { ...employee };
        for (const field of PRIVATE_EMPLOYEE_FIELDS) delete copy[field];
        return copy;
      });
    }
    return value.map((item) => sanitizeApiPayload(item));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, sanitizeApiPayload(childValue, childKey)]));
}

function sendJson(res, status, payload, headers = {}) {
  // API-ответы, особенно результат проверки сеанса, не должны попадать в HTTP-кэш.
  // Иначе браузер может показать устаревший положительный ответ после сброса пароля.
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
    "Expires": "0",
    ...headers,
  });
  res.end(JSON.stringify(sanitizeApiPayload(payload)));
}


const EMPLOYEE_SELF_EDIT_FIELDS = new Set(["Номер дела", "Ссылка", "Статус", "Истец", "Ответчик", "Третье лицо", "Предмет"]);
const EMPLOYEE_EDITABLE_STATUSES = new Set(["В работе", "Приостановлено", "Завершено"]);

function caseBelongsToEmployee(caseRow, employee) {
  return Boolean(caseRow && employee && nameMatches(caseRow[FIELD.responsible], employee[FIELD.name]));
}

function employeeScopedData(rawData, employee) {
  // Сотруднику доступны все дела для просмотра в чужих ЮЦ, но в его ЮЦ
  // интерфейс дополнительно оставляет редактирование только собственных дел.
  return enrichData({
    cases: rawData.cases ?? [],
    employees: [employee],
    queues: [],
    state: [],
    vacations: [],
    journal: [],
    settings: [],
    yucSettings: [],
    regionalAssignments: [],
  });
}

async function saveAuthEmployee(data, employee) {
  // Авторизация работает только с таблицей сотрудников. Не пропускаем такой
  // неполный набор данных через enrichData(), которому нужны все таблицы.
  await saveData(data, ["employees"]);
  let latest = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    const fresh = await readData(["employees"], { force: true });
    latest = fresh.employees.find((item) => cleanText(item.employee_id) === cleanText(employee.employee_id));
    if (latest) return latest;
  }
  return latest ?? employee;
}

const auth = createAuthController({ readData, saveEmployee: saveAuthEmployee, sendJson, readBody });

function ownYuc(user) {
  return normalizeYuc(user?.yuc);
}

function canManageYuc(user, yuc) {
  return auth.isAdmin(user) || (
    cleanText(user?.role) === "Руководитель" &&
    Boolean(ownYuc(user)) &&
    normalizeYuc(yuc) === ownYuc(user)
  );
}

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

async function handleCasePatch(req, res, url, user) {
  const id = decodeURIComponent(url.pathname.split("/").pop());
  const patch = await readBody(req);
  if (patch["Статус"] === "Удалено") {
    const error = new Error("Для удаления дела используйте защищённое действие удаления.");
    error.status = 400;
    throw error;
  }
  const data = await readData();
  const caseRow = data.cases.find((item) => item.case_id === id);
  if (!caseRow) {
    const error = new Error("Дело не найдено.");
    error.status = 404;
    throw error;
  }
  const manager = auth.isManager(user);
  if (!manager) {
    const employee = data.employees.find((item) => cleanText(item.employee_id) === user.employeeId);
    if (normalizeYuc(caseRow[FIELD.yuc]) !== ownYuc(user) || !caseBelongsToEmployee(caseRow, employee)) {
      const error = new Error("Можно редактировать только собственные дела.");
      error.status = 403;
      throw error;
    }
    const unsupported = Object.keys(patch).filter((field) => !EMPLOYEE_SELF_EDIT_FIELDS.has(field));
    if (unsupported.length) {
      const error = new Error("Сотрудник не может изменять: " + unsupported.join(", ") + ".");
      error.status = 403;
      throw error;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "Статус") && !EMPLOYEE_EDITABLE_STATUSES.has(cleanText(patch["Статус"]))) {
      const error = new Error("Этот статус сотрудник изменить не может.");
      error.status = 403;
      throw error;
    }
    Object.assign(caseRow, Object.fromEntries(Object.entries(patch).filter(([field]) => EMPLOYEE_SELF_EDIT_FIELDS.has(field))));
    if (patch["Статус"] === "Завершено" && !caseRow["Дата завершения"]) {
      caseRow["Дата завершения"] = new Date().toISOString().slice(0, 10);
    }
  } else {
    requireManageYuc(user, caseRow[FIELD.yuc]);
    Object.assign(caseRow, patch);
  }
  const confirmedData = await confirmedDataAfterSave(data, ["cases"], (freshData) => Boolean(findCase(freshData, id)));
  const confirmedCase = assertConfirmedCase(confirmedData, id, "обновление дела");
  const responseData = manager
    ? confirmedData
    : employeeScopedData(confirmedData, confirmedData.employees.find((item) => cleanText(item.employee_id) === user.employeeId));
  sendJson(res, 200, { ok: true, case: confirmedCase, data: responseData });
}

function normalizeTableKeys(keys = BOOTSTRAP_TABLE_KEYS) {
  const requested = Array.isArray(keys) ? keys : [keys];
  const unique = [...new Set(requested.filter(Boolean))];
  return unique.length ? unique : BOOTSTRAP_TABLE_KEYS;
}

function cloneRow(row) {
  const copy = { ...row };
  if (row && Object.prototype.hasOwnProperty.call(row, "_recordId")) {
    Object.defineProperty(copy, "_recordId", {
      value: row._recordId,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  return copy;
}

function mergeCache(data = {}) {
  const now = Date.now();
  for (const [key, rows] of Object.entries(data)) {
    cache.tables.set(key, Array.isArray(rows) ? rows.map(cloneRow) : rows);
    cache.loadedAt.set(key, now);
  }
}

function recordTableRead(key, entry) {
  const item = {
    table: key,
    at: new Date().toISOString(),
    ...entry,
  };
  performanceLog.tableReads.set(key, item);
  performanceLog.recentReads.unshift(item);
  performanceLog.recentReads = performanceLog.recentReads.slice(0, 80);
}

function cachedTables(keys) {
  return Object.fromEntries(keys.map((key) => [key, (cache.tables.get(key) ?? []).map(cloneRow)]));
}

function cacheAge(key) {
  const loadedAt = cache.loadedAt.get(key) || 0;
  return loadedAt ? Date.now() - loadedAt : Infinity;
}

function cacheTtl(key) {
  return CACHE_TTL[key] ?? CACHE_TTL.default;
}

function cacheRemaining(key) {
  const age = cacheAge(key);
  if (!Number.isFinite(age)) return null;
  return Math.max(cacheTtl(key) - age, 0);
}

function staleKeys(keys, force = false) {
  if (force) return keys;
  return keys.filter((key) => !cache.tables.has(key) || cacheAge(key) > cacheTtl(key));
}

async function readFreshTable(key) {
  const started = Date.now();
  try {
    const data = await readDataFresh([key]);
    const rows = Array.isArray(data[key]) ? data[key].length : 0;
    recordTableRead(key, {
      source: "MTS Tabs",
      durationMs: Date.now() - started,
      rows,
      ok: true,
    });
    return data;
  } catch (error) {
    recordTableRead(key, {
      source: "MTS Tabs",
      durationMs: Date.now() - started,
      rows: 0,
      ok: false,
      error: error.message,
    });
    throw error;
  }
}

async function readFreshIntoCache(keys) {
  const tableKeys = normalizeTableKeys(keys);
  const signature = tableKeys.slice().sort().join(",");
  if (!cache.pending.has(signature)) {
    cache.pending.set(signature, Promise.all(tableKeys.map(readFreshTable))
      .then((items) => {
        const data = Object.assign({}, ...items);
        mergeCache(data);
        return data;
      })
      .finally(() => cache.pending.delete(signature)));
  }
  return cache.pending.get(signature);
}

async function readData(keys = BOOTSTRAP_TABLE_KEYS, options = {}) {
  const tableKeys = normalizeTableKeys(keys);
  const toRefresh = staleKeys(tableKeys, Boolean(options.force));
  if (toRefresh.length) {
    await readFreshIntoCache(toRefresh);
  }
  const data = cachedTables(tableKeys);
  if (!Object.prototype.hasOwnProperty.call(data, "journal")) data.journal = [];
  return data;
}

function cacheStatus() {
  return {
    enabled: true,
    cacheTtlMs: CACHE_TTL.default,
    cacheTtlByTableMs: Object.fromEntries(ALL_TABLE_KEYS.map((key) => [key, cacheTtl(key)])),
    bootstrapTables: BOOTSTRAP_TABLE_KEYS,
    lazyTables: ["journal"],
    cachedTables: Object.fromEntries(ALL_TABLE_KEYS.map((key) => [
      key,
      {
        loaded: cache.tables.has(key),
        ageMs: Number.isFinite(cacheAge(key)) ? cacheAge(key) : null,
        ttlMs: cacheTtl(key),
        remainingMs: cacheRemaining(key),
        stale: !cache.tables.has(key) || cacheAge(key) > cacheTtl(key),
        rows: Array.isArray(cache.tables.get(key)) ? cache.tables.get(key).length : 0,
      },
    ])),
    performance: {
      startedAt: performanceLog.startedAt,
      lastReads: Object.fromEntries(ALL_TABLE_KEYS.map((key) => [key, performanceLog.tableReads.get(key) ?? null])),
      recentReads: performanceLog.recentReads,
    },
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Слишком большой запрос."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Не удалось прочитать JSON."));
      }
    });
    req.on("error", reject);
  });
}

function readBinaryBody(req, maxBytes = 12_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Файл слишком большой."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function confirmedDataAfterSave(data, changedTables = null, confirm = null) {
  if (typeof changedTables === "function") {
    confirm = changedTables;
    changedTables = null;
  }
  await saveData(data, changedTables ?? undefined);
  let lastData = null;
  const refreshTables = changedTables ? changedTables.filter((key) => key !== "journal") : null;
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

function assertConfirmedCase(data, caseId, action = "сохранено") {
  const caseRow = findCase(data, caseId);
  if (!caseRow) {
    throw new Error(`Дело ${caseId} не найдено в MTS Tabs после операции: ${action}.`);
  }
  return caseRow;
}

function regionalType(value) {
  const text = cleanText(value).toLowerCase();
  return text === "все" ? "все" : normalizeType(text);
}

function regionalAssignmentKey(row = {}) {
  return [
    normalizeYuc(row[FIELD.yuc]),
    cleanText(row["Регион"]),
    cleanText(row["Сотрудник"]),
    regionalType(row[FIELD.workloadType]),
  ].join("::");
}

function normalizeRegionalAssignment(row = {}, yuc = "") {
  return {
    "Название": cleanText(row["Название"]),
    [FIELD.yuc]: normalizeYuc(row[FIELD.yuc] || yuc),
    "Регион": cleanText(row["Регион"]),
    "Сотрудник": cleanText(row["Сотрудник"]),
    "Заместитель": cleanText(row["Заместитель"]) || "нет",
    [FIELD.workloadType]: regionalType(row[FIELD.workloadType] || "все"),
    [FIELD.ruleActive]: yesNo(row[FIELD.ruleActive]),
  };
}

function assertRegionalAssignment(row) {
  if (!row[FIELD.yuc] || !row["Регион"] || !row["Сотрудник"] || !row[FIELD.workloadType]) {
    throw new Error("Для закрепления нужны ЮЦ, регион, сотрудник и тип нагрузки.");
  }
  const substitute = cleanText(row["Заместитель"]);
  if (substitute && substitute.toLowerCase() !== "нет" && substitute === row["Сотрудник"]) {
    throw new Error("Сотрудник и заместитель не могут совпадать.");
  }
}

async function api(req, res, url) {
  if (await auth.handleAuth(req, res, url)) return;
  const user = await auth.currentUser(req);
  if (!user) {
    const error = new Error(auth.configured() ? "Требуется вход в приложение." : "Авторизация ещё не настроена.");
    error.status = 401;
    throw error;
  }

  if (req.method === "GET" && url.pathname === "/api/data") {
    const rawData = await readData();
    if (auth.isManager(user)) {
      const directories = await readDirectories(rawData);
      const data = { ...enrichData(rawData), directories };
      return sendJson(res, 200, { ok: true, user, data, journalLoaded: false, storagePath: storagePath(), tabsStorageStatus: tabsStorageStatus(), cacheStatus: cacheStatus(), directoriesPath: directoriesPath() });
    }
    const employee = rawData.employees.find((item) => cleanText(item.employee_id) === user.employeeId);
    if (!employee) {
      const error = new Error("Учётная запись сотрудника не найдена.");
      error.status = 401;
      throw error;
    }
    const directories = await readDirectories(rawData);
    return sendJson(res, 200, { ok: true, user, data: { ...employeeScopedData(rawData, employee), directories }, journalLoaded: false, storagePath: storagePath(), cacheStatus: cacheStatus() });
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/cases/")) {
    return handleCasePatch(req, res, url, user);
  }

  if (!auth.isManager(user)) {
    const error = new Error("Сотруднику доступен только список собственных дел и их карточки.");
    error.status = 403;
    throw error;
  }

  if (await auth.handleAccess(req, res, url, user)) return;
  if (req.method === "POST" && url.pathname === "/api/shutdown") {
    sendJson(res, 200, { ok: true, message: "Сервер останавливается." });
    setTimeout(() => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1000).unref();
    }, 150).unref();
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/data") {
    const rawData = await readData();
    const directories = await readDirectories(rawData);
    const data = { ...enrichData(rawData), directories };
    return sendJson(res, 200, { ok: true, data, journalLoaded: false, storagePath: storagePath(), tabsStorageStatus: tabsStorageStatus(), cacheStatus: cacheStatus(), directoriesPath: directoriesPath() });
  }

  if (req.method === "GET" && url.pathname === "/api/journal") {
    const force = url.searchParams.get("force") === "1";
    const data = await readData(["journal"], { force });
    return sendJson(res, 200, { ok: true, journal: data.journal, journalLoaded: true, cacheStatus: cacheStatus() });
  }

  if (req.method === "GET" && url.pathname === "/api/cache-status") {
    return sendJson(res, 200, { ok: true, cacheStatus: cacheStatus() });
  }

  if (req.method === "GET" && url.pathname === "/api/storage-status") {
    return sendJson(res, 200, { ok: true, storageStatus: { ...tabsStorageStatus(), cache: cacheStatus() } });
  }

  if (req.method === "GET" && url.pathname === "/api/directories") {
    const directories = await readDirectories(await readData());
    return sendJson(res, 200, { ok: true, directories, directoriesPath: directoriesPath() });
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/yuc-settings/")) {
    const yuc = normalizeYuc(decodeURIComponent(url.pathname.split("/").pop()));
    requireManageYuc(user, yuc);
    const patch = await readBody(req);
    const data = await readData();
    let row = data.yucSettings.find((item) => normalizeYuc(item[FIELD.yuc]) === yuc);
    if (!row) {
      row = {
        "Название": "",
        [FIELD.yuc]: yuc,
        [YUC_SETTING.regionalEnabled]: "Нет",
        [YUC_SETTING.overloadThreshold]: 5,
        [YUC_SETTING.overloadMode]: "общая нагрузка",
        [YUC_SETTING.allowOutsideRegion]: "Да",
        [YUC_SETTING.includeInactiveLoad]: "Нет",
        [YUC_SETTING.missingRegionMode]: "общая очередь",
        [YUC_SETTING.unavailableRegionalMode]: "заместитель затем общая очередь",
      };
      data.yucSettings.push(row);
    }
    Object.assign(row, {
      [YUC_SETTING.regionalEnabled]: yesNo(patch[YUC_SETTING.regionalEnabled]),
      [YUC_SETTING.overloadThreshold]: Number(patch[YUC_SETTING.overloadThreshold]) || 0,
      [YUC_SETTING.overloadMode]: cleanText(patch[YUC_SETTING.overloadMode]) || "общая нагрузка",
      [YUC_SETTING.allowOutsideRegion]: yesNo(patch[YUC_SETTING.allowOutsideRegion]),
      [YUC_SETTING.includeInactiveLoad]: yesNo(patch[YUC_SETTING.includeInactiveLoad]),
      [YUC_SETTING.missingRegionMode]: cleanText(patch[YUC_SETTING.missingRegionMode]) || "общая очередь",
      [YUC_SETTING.unavailableRegionalMode]: cleanText(patch[YUC_SETTING.unavailableRegionalMode]) || "заместитель затем общая очередь",
    });
    const confirmedData = await confirmedDataAfterSave(data, ["yucSettings"], (freshData) => Boolean(freshData.yucSettings.find((item) => normalizeYuc(item[FIELD.yuc]) === yuc)));
    return sendJson(res, 200, { ok: true, settings: confirmedData.yucSettings.find((item) => normalizeYuc(item[FIELD.yuc]) === yuc), data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/deadline-settings") {
    const body = await readBody(req);
    const yuc = normalizeYuc(body.yuc);
    requireManageYuc(user, yuc);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const data = await readData();
    for (const raw of rows) {
      const type = normalizeType(raw[FIELD.caseType]);
      if (!type) continue;
      const activityDays = Number(raw["Активность, дни"]);
      const autocompletionDays = Number(raw["Автозавершение, дни"]);
      const debtEnabledValue = yesNo(raw["Учитывать долг"]);
      const maxDebtValue = Math.max(0, Math.floor(Number(raw["Максимальный долг"]) || 0));
      if (!Number.isFinite(activityDays) || activityDays <= 0) {
        throw new Error(`Срок активности для «${type}» должен быть положительным числом.`);
      }
      if (!Number.isFinite(autocompletionDays) || autocompletionDays <= 0) {
        throw new Error(`Срок автозавершения для «${type}» должен быть положительным числом.`);
      }
      let row = data.settings.find((item) => normalizeYuc(item[FIELD.yuc]) === yuc && normalizeType(item[FIELD.caseType]) === type);
      if (!row) {
        row = {
          [FIELD.yuc]: yuc,
          [FIELD.caseType]: type,
          "Активность, дни": activityDays,
          "Автозавершение, дни": autocompletionDays,
          "Учитывать долг": debtEnabledValue,
          "Максимальный долг": maxDebtValue,
        };
        data.settings.push(row);
      } else {
        Object.assign(row, {
          [FIELD.yuc]: yuc,
          [FIELD.caseType]: type,
          "Активность, дни": activityDays,
          "Автозавершение, дни": autocompletionDays,
          "Учитывать долг": debtEnabledValue,
          "Максимальный долг": maxDebtValue,
        });
      }
    }
    const confirmedData = await confirmedDataAfterSave(data, ["settings"]);
    return sendJson(res, 200, { ok: true, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/regional-assignments/upsert") {
    const body = await readBody(req);
    const data = await readData();
    const row = normalizeRegionalAssignment(body.row, body.yuc);
    requireManageYuc(user, row[FIELD.yuc]);
    const originalKey = body.original ? regionalAssignmentKey(normalizeRegionalAssignment(body.original, body.yuc)) : "";
    assertRegionalAssignment(row);
    const nextKey = regionalAssignmentKey(row);
    const duplicate = data.regionalAssignments.find((item) => regionalAssignmentKey(item) === nextKey && regionalAssignmentKey(item) !== originalKey);
    if (duplicate) throw new Error("Такое региональное закрепление уже существует.");
    const index = data.regionalAssignments.findIndex((item) => regionalAssignmentKey(item) === (originalKey || nextKey));
    if (index >= 0) data.regionalAssignments[index] = { ...data.regionalAssignments[index], ...row };
    else data.regionalAssignments.push(row);
    const confirmedData = await confirmedDataAfterSave(data, ["regionalAssignments"]);
    return sendJson(res, 200, { ok: true, row, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/regional-assignments/delete") {
    const body = await readBody(req);
    const scopedRow = normalizeRegionalAssignment(body.row, body.yuc);
    requireManageYuc(user, scopedRow[FIELD.yuc]);
    const key = regionalAssignmentKey(scopedRow);
    const data = await readData();
    data.regionalAssignments = data.regionalAssignments.filter((item) => regionalAssignmentKey(item) !== key);
    const confirmedData = await confirmedDataAfterSave(data, ["regionalAssignments"]);
    return sendJson(res, 200, { ok: true, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/recommend") {
    const body = await readBody(req);
    const data = await readData();
    const draft = normalizeDraft(body.draft ?? body);
    requireManageYuc(user, draft[FIELD.yuc]);
    const result = recommendWithPreview(data, draft);
    return sendJson(res, 200, { ok: true, result });
  }

  if (req.method === "POST" && url.pathname === "/api/assign-auto") {
    const body = await readBody(req);
    const data = await readData();
    const draft = normalizeDraft(body.draft ?? body);
    requireManageYuc(user, draft[FIELD.yuc]);
    const created = assignAutomatically(data, draft);
    const confirmedData = await confirmedDataAfterSave(data, ["cases", "queues", "state", "journal"], (freshData) => Boolean(findCase(freshData, created.case.case_id)));
    const confirmedCase = assertConfirmedCase(confirmedData, created.case.case_id, "автоназначение нового дела");
    return sendJson(res, 200, { ok: true, ...created, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/assign-manual") {
    const body = await readBody(req);
    const data = await readData();
    const draft = normalizeDraft(body.draft ?? body);
    requireManageYuc(user, draft[FIELD.yuc]);
    const created = assignManually(data, draft, body.responsible, body.comment);
    const confirmedData = await confirmedDataAfterSave(data, ["cases", "state", "journal"], (freshData) => Boolean(findCase(freshData, created.case.case_id)));
    const confirmedCase = assertConfirmedCase(confirmedData, created.case.case_id, "ручное назначение нового дела");
    return sendJson(res, 200, { ok: true, ...created, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/assign-auto")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    await readBody(req);
    const data = await readData();
    requireManageCase(user, data, caseId);
    const assigned = assignExistingAutomatically(data, caseId);
    const confirmedData = await confirmedDataAfterSave(data, ["cases", "queues", "state", "journal"], (freshData) => Boolean(findCase(freshData, caseId)));
    const confirmedCase = assertConfirmedCase(confirmedData, caseId, "автоназначение существующего дела");
    return sendJson(res, 200, { ok: true, ...assigned, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/assign-manual")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    const body = await readBody(req);
    const data = await readData();
    requireManageCase(user, data, caseId);
    const assigned = assignExistingManually(data, caseId, body.responsible, body.comment);
    const confirmedData = await confirmedDataAfterSave(data, ["cases", "state", "journal"], (freshData) => Boolean(findCase(freshData, caseId)));
    const confirmedCase = assertConfirmedCase(confirmedData, caseId, "ручное назначение существующего дела");
    return sendJson(res, 200, { ok: true, ...assigned, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/responsible")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    const body = await readBody(req);
    const data = await readData();
    requireManageCase(user, data, caseId);
    const updated = changeCaseResponsible(data, caseId, body.responsible);
    const confirmedData = await confirmedDataAfterSave(data, ["cases", "journal"], (freshData) => Boolean(findCase(freshData, caseId)));
    const confirmedCase = assertConfirmedCase(confirmedData, caseId, "смена ответственного");
    return sendJson(res, 200, { ok: true, ...updated, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/delete")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    const body = await readBody(req);
    const data = await readData();
    requireManageCase(user, data, caseId);
    const deleted = deleteCase(data, caseId, body.confirmCaseId ?? body.case_id);
    const confirmedData = await confirmedDataAfterSave(data, ["cases", "journal"], (freshData) => Boolean(findCase(freshData, caseId)));
    const confirmedCase = assertConfirmedCase(confirmedData, caseId, "удаление дела");
    return sendJson(res, 200, { ok: true, ...deleted, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/restore")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    await readBody(req);
    const data = await readData();
    requireManageCase(user, data, caseId);
    const restored = restoreCase(data, caseId);
    const confirmedData = await confirmedDataAfterSave(data, ["cases", "journal"], (freshData) => Boolean(findCase(freshData, caseId)));
    const confirmedCase = assertConfirmedCase(confirmedData, caseId, "восстановление дела");
    return sendJson(res, 200, { ok: true, ...restored, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/complete-deadline")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    await readBody(req);
    const data = await readData();
    requireManageCase(user, data, caseId);
    const completed = completeCaseByDeadline(data, caseId);
    const confirmedData = await confirmedDataAfterSave(data, ["cases", "journal"], (freshData) => Boolean(findCase(freshData, caseId)));
    const confirmedCase = assertConfirmedCase(confirmedData, caseId, "завершение по контрольному сроку");
    return sendJson(res, 200, { ok: true, ...completed, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/postpone-completion")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    const body = await readBody(req);
    const data = await readData();
    requireManageCase(user, data, caseId);
    const postponed = postponeCaseCompletion(data, caseId, body.postponeTo, body.reason);
    const confirmedData = await confirmedDataAfterSave(data, ["cases", "journal"], (freshData) => Boolean(findCase(freshData, caseId)));
    const confirmedCase = assertConfirmedCase(confirmedData, caseId, "отложение завершения");
    return sendJson(res, 200, { ok: true, ...postponed, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/employees/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const patch = await readBody(req);
    const data = await readData();
    const employee = data.employees.find((item) => item.employee_id === id);
    if (!employee) return sendJson(res, 404, { ok: false, error: "Сотрудник не найден." });
    requireManageYuc(user, employee[FIELD.yuc]);
    Object.assign(employee, patch);
    const confirmedData = await confirmedDataAfterSave(data, ["employees"], (freshData) => Boolean(freshData.employees.find((item) => item.employee_id === id)));
    const confirmedEmployee = confirmedData.employees.find((item) => item.employee_id === id) ?? employee;
    return sendJson(res, 200, { ok: true, employee: confirmedEmployee, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/vacations/toggle") {
    const body = await readBody(req);
    const data = await readData();
    requireManageEmployee(user, data, body.employee_id);
    const day = toISODate(body.date);
    if (!body.employee_id || !day) return sendJson(res, 400, { ok: false, error: "Нужны employee_id и date." });
    const enriched = enrichData(data);
    const exists = (enriched.vacations ?? []).some((item) =>
      item.employee_id === body.employee_id &&
      item["Дата начала"] <= day &&
      day <= (item["Дата окончания"] || item["Дата начала"])
    );
    const dates = setVacationDates(data, body.employee_id, [day], !exists);
    const confirmedData = await confirmedDataAfterSave(data, ["vacations"]);
    return sendJson(res, 200, { ok: true, enabled: !exists, dates, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/vacations/range") {
    const body = await readBody(req);
    const data = await readData();
    requireManageEmployee(user, data, body.employee_id);
    const dates = allDatesInRange(body.start, body.end);
    if (!body.employee_id || !dates.length) return sendJson(res, 400, { ok: false, error: "Нужны employee_id, start и end." });
    const enabled = body.action !== "clear";
    const employeeDates = setVacationDates(data, body.employee_id, dates, enabled);
    const confirmedData = await confirmedDataAfterSave(data, ["vacations"]);
    return sendJson(res, 200, { ok: true, enabled, dates: employeeDates, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/vacations/save-year") {
    const body = await readBody(req);
    const data = await readData();
    requireManageEmployee(user, data, body.employee_id);
    if (!body.employee_id || !body.year) return sendJson(res, 400, { ok: false, error: "Нужны employee_id и year." });
    const dates = replaceVacationYear(data, body.employee_id, body.year, body.dates ?? []);
    const confirmedData = await confirmedDataAfterSave(data, ["vacations"]);
    return sendJson(res, 200, { ok: true, dates, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/vacations/clear-year") {
    const body = await readBody(req);
    const data = await readData();
    requireManageEmployee(user, data, body.employee_id);
    if (!body.employee_id || !body.year) return sendJson(res, 400, { ok: false, error: "Нужны employee_id и year." });
    const dates = clearVacationYear(data, body.employee_id, body.year);
    const confirmedData = await confirmedDataAfterSave(data, ["vacations"]);
    return sendJson(res, 200, { ok: true, dates, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/vacations/import-preview") {
    const buffer = await readBinaryBody(req);
    const data = await readData(["employees", "vacations"]);
    const plan = parseVacationWorkbook(buffer, data.employees ?? []);
    return sendJson(res, 200, { ok: true, plan });
  }

  if (req.method === "POST" && url.pathname === "/api/vacations/import-apply") {
    const body = await readBody(req);
    const plan = body.plan;
    if (!plan?.scopeDates?.length || !plan?.matched?.length) {
      return sendJson(res, 400, { ok: false, error: "Нет подготовленного плана импорта." });
    }
    const data = await readData();
    const result = replaceVacationDatesForEmployees(data, plan.matched, plan.scopeDates);
    const confirmedData = await confirmedDataAfterSave(data, ["vacations"]);
    return sendJson(res, 200, { ok: true, result, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/cases/import-preview") {
    const importYuc = normalizeYuc(url.searchParams.get("yuc") || "Дальний Восток");
    requireManageYuc(user, importYuc);
    const buffer = await readBinaryBody(req);
    const data = await readData(["cases"]);
    const plan = parseCaseWorkbook(buffer, data.cases ?? [], { yuc: importYuc });
    return sendJson(res, 200, { ok: true, plan });
  }

  if (req.method === "POST" && url.pathname === "/api/cases/import-apply") {
    const body = await readBody(req);
    const rows = body.plan?.toAdd ?? body.rows ?? [];
    if (!rows.length) {
      return sendJson(res, 400, { ok: false, error: "В плане импорта нет новых дел для добавления." });
    }
    const data = await readData();
    for (const row of rows) requireManageYuc(user, row[FIELD.yuc]);
    const result = importCasesFromRows(data, rows);
    const confirmedData = await confirmedDataAfterSave(data, ["cases", "journal"], (freshData) => result.added.every((item) => Boolean(findCase(freshData, item.case_id))));
    return sendJson(res, 200, {
      ok: true,
      result: {
        added: result.added.length,
        skipped: result.skipped.length,
        firstCaseId: result.added[0]?.case_id ?? "",
        lastCaseId: result.added.at(-1)?.case_id ?? "",
      },
      data: confirmedData,
    });
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/cases/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const patch = await readBody(req);
    if (patch["Статус"] === "Удалено") {
      return sendJson(res, 400, { ok: false, error: "Для удаления дела используйте защищённое действие удаления." });
    }
    const data = await readData();
    const caseRow = data.cases.find((item) => item.case_id === id);
    if (!caseRow) return sendJson(res, 404, { ok: false, error: "Дело не найдено." });
    Object.assign(caseRow, patch);
    const confirmedData = await confirmedDataAfterSave(data, ["cases"], (freshData) => Boolean(findCase(freshData, id)));
    const confirmedCase = assertConfirmedCase(confirmedData, id, "обновление дела");
    return sendJson(res, 200, { ok: true, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/queues/")) {
    const [, , , queueId, employeeId] = url.pathname.split("/");
    const patch = await readBody(req);
    const data = await readData();
    const row = data.queues.find((item) => item.queue_id === decodeURIComponent(queueId) && item.employee_id === decodeURIComponent(employeeId));
    if (!row) return sendJson(res, 404, { ok: false, error: "Строка очереди не найдена." });
    requireManageYuc(user, row[FIELD.yuc]);
    Object.assign(row, patch);
    const confirmedData = await confirmedDataAfterSave(data, ["queues"], (freshData) => Boolean(freshData.queues.find((item) => item.queue_id === row.queue_id && item.employee_id === row.employee_id)));
    const confirmedQueue = confirmedData.queues.find((item) => item.queue_id === row.queue_id && item.employee_id === row.employee_id) ?? row;
    return sendJson(res, 200, { ok: true, queue: confirmedQueue, data: confirmedData });
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/state/")) {
    const queueId = decodeURIComponent(url.pathname.split("/").pop());
    const patch = await readBody(req);
    const data = await readData();
    const row = data.state.find((item) => item.queue_id === queueId);
    if (!row) return sendJson(res, 404, { ok: false, error: "Состояние очереди не найдено." });
    requireManageYuc(user, row[FIELD.yuc]);
    Object.assign(row, patch);
    const confirmedData = await confirmedDataAfterSave(data, ["state"], (freshData) => Boolean(freshData.state.find((item) => item.queue_id === queueId)));
    const confirmedState = confirmedData.state.find((item) => item.queue_id === queueId) ?? row;
    return sendJson(res, 200, { ok: true, state: confirmedState, data: confirmedData });
  }

  return sendJson(res, 404, { ok: false, error: "Метод API не найден." });
}

async function staticFile(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    const data = await fs.readFile(filePath);
    const headers = { "Content-Type": MIME[path.extname(filePath)] ?? "application/octet-stream" };
    if (requested === "/index.html") {
      headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private";
      headers.Pragma = "no-cache";
      headers.Expires = "0";
    }
    res.writeHead(200, headers);
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await api(req, res, url);
    } else {
      await staticFile(req, res, url);
    }
  } catch (error) {
    sendJson(res, error.status || 500, { ok: false, error: error.message || "Ошибка сервера." });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Приложение запущено: http://${HOST}:${PORT}`);
  console.log(`MTS Tabs API: ${storagePath()}`);
});
