import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIELD, YUC_SETTING, allDatesInRange, assignAutomatically, assignExistingAutomatically, assignExistingManually, assignManually, changeCaseResponsible, cleanText, clearVacationYear, completeCaseByDeadline, deleteCase, enrichData, normalizeDraft, normalizeType, normalizeYuc, postponeCaseCompletion, recommend, replaceVacationDatesForEmployees, replaceVacationYear, restoreCase, setVacationDates, toISODate, yesNo } from "./lib/domain.mjs";
import { readData, saveData, storagePath, tabsStorageStatus } from "./lib/tabs-store.mjs";
import { directoriesPath, readDirectories } from "./lib/directories.mjs";
import { parseVacationWorkbook } from "./lib/xlsx-vacation-import.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 8766);
const HOST = process.env.HOST || "127.0.0.1";

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

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
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
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt) {
      await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    }
    const freshData = changedTables ? { ...data, ...(await readData(changedTables)) } : await readData();
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

function regionalSubstitutionKey(row = {}) {
  return [
    normalizeYuc(row[FIELD.yuc]),
    cleanText(row["Регион"]),
    cleanText(row["Основной сотрудник"]),
    cleanText(row["Замещающий сотрудник"]),
    regionalType(row[FIELD.workloadType]),
  ].join("::");
}

function normalizeRegionalAssignment(row = {}, yuc = "") {
  return {
    "Название": cleanText(row["Название"]),
    [FIELD.yuc]: normalizeYuc(row[FIELD.yuc] || yuc),
    "Регион": cleanText(row["Регион"]),
    "Сотрудник": cleanText(row["Сотрудник"]),
    [FIELD.workloadType]: regionalType(row[FIELD.workloadType] || "все"),
    [FIELD.ruleActive]: yesNo(row[FIELD.ruleActive]),
  };
}

function normalizeRegionalSubstitution(row = {}, yuc = "") {
  return {
    "Название": cleanText(row["Название"]),
    [FIELD.yuc]: normalizeYuc(row[FIELD.yuc] || yuc),
    "Регион": cleanText(row["Регион"]),
    "Основной сотрудник": cleanText(row["Основной сотрудник"]),
    "Замещающий сотрудник": cleanText(row["Замещающий сотрудник"]),
    [FIELD.workloadType]: regionalType(row[FIELD.workloadType] || "все"),
    [FIELD.ruleActive]: yesNo(row[FIELD.ruleActive]),
    "Комментарий": cleanText(row["Комментарий"]),
  };
}

function assertRegionalAssignment(row) {
  if (!row[FIELD.yuc] || !row["Регион"] || !row["Сотрудник"] || !row[FIELD.workloadType]) {
    throw new Error("Для закрепления нужны ЮЦ, регион, сотрудник и тип нагрузки.");
  }
}

function assertRegionalSubstitution(row) {
  if (!row[FIELD.yuc] || !row["Регион"] || !row["Основной сотрудник"] || !row["Замещающий сотрудник"] || !row[FIELD.workloadType]) {
    throw new Error("Для замещения нужны ЮЦ, регион, основной сотрудник, заместитель и тип нагрузки.");
  }
  if (row["Основной сотрудник"] === row["Замещающий сотрудник"]) {
    throw new Error("Основной сотрудник и заместитель не могут совпадать.");
  }
}

async function api(req, res, url) {
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
    return sendJson(res, 200, { ok: true, data, storagePath: storagePath(), tabsStorageStatus: tabsStorageStatus(), directoriesPath: directoriesPath() });
  }

  if (req.method === "GET" && url.pathname === "/api/storage-status") {
    return sendJson(res, 200, { ok: true, storageStatus: tabsStorageStatus() });
  }

  if (req.method === "GET" && url.pathname === "/api/directories") {
    const directories = await readDirectories(await readData());
    return sendJson(res, 200, { ok: true, directories, directoriesPath: directoriesPath() });
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/yuc-settings/")) {
    const yuc = normalizeYuc(decodeURIComponent(url.pathname.split("/").pop()));
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
      [YUC_SETTING.missingRegionMode]: cleanText(patch[YUC_SETTING.missingRegionMode]) || "общая очередь",
      [YUC_SETTING.unavailableRegionalMode]: cleanText(patch[YUC_SETTING.unavailableRegionalMode]) || "заместитель затем общая очередь",
    });
    const confirmedData = await confirmedDataAfterSave(data, ["yucSettings"], (freshData) => Boolean(freshData.yucSettings.find((item) => normalizeYuc(item[FIELD.yuc]) === yuc)));
    return sendJson(res, 200, { ok: true, settings: confirmedData.yucSettings.find((item) => normalizeYuc(item[FIELD.yuc]) === yuc), data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/deadline-settings") {
    const body = await readBody(req);
    const yuc = normalizeYuc(body.yuc);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const data = await readData();
    for (const raw of rows) {
      const type = normalizeType(raw[FIELD.caseType]);
      if (!type) continue;
      const activityDays = Number(raw["Активность, дни"]);
      const autocompletionDays = Number(raw["Автозавершение, дни"]);
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
        };
        data.settings.push(row);
      } else {
        Object.assign(row, {
          [FIELD.yuc]: yuc,
          [FIELD.caseType]: type,
          "Активность, дни": activityDays,
          "Автозавершение, дни": autocompletionDays,
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
    const key = regionalAssignmentKey(normalizeRegionalAssignment(body.row, body.yuc));
    const data = await readData();
    data.regionalAssignments = data.regionalAssignments.filter((item) => regionalAssignmentKey(item) !== key);
    const confirmedData = await confirmedDataAfterSave(data, ["regionalAssignments"]);
    return sendJson(res, 200, { ok: true, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/regional-substitutions/upsert") {
    const body = await readBody(req);
    const data = await readData();
    const row = normalizeRegionalSubstitution(body.row, body.yuc);
    const originalKey = body.original ? regionalSubstitutionKey(normalizeRegionalSubstitution(body.original, body.yuc)) : "";
    assertRegionalSubstitution(row);
    const nextKey = regionalSubstitutionKey(row);
    const duplicate = data.regionalSubstitutions.find((item) => regionalSubstitutionKey(item) === nextKey && regionalSubstitutionKey(item) !== originalKey);
    if (duplicate) throw new Error("Такое региональное замещение уже существует.");
    const index = data.regionalSubstitutions.findIndex((item) => regionalSubstitutionKey(item) === (originalKey || nextKey));
    if (index >= 0) data.regionalSubstitutions[index] = { ...data.regionalSubstitutions[index], ...row };
    else data.regionalSubstitutions.push(row);
    const confirmedData = await confirmedDataAfterSave(data, ["regionalSubstitutions"]);
    return sendJson(res, 200, { ok: true, row, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/regional-substitutions/delete") {
    const body = await readBody(req);
    const key = regionalSubstitutionKey(normalizeRegionalSubstitution(body.row, body.yuc));
    const data = await readData();
    data.regionalSubstitutions = data.regionalSubstitutions.filter((item) => regionalSubstitutionKey(item) !== key);
    const confirmedData = await confirmedDataAfterSave(data, ["regionalSubstitutions"]);
    return sendJson(res, 200, { ok: true, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/recommend") {
    const body = await readBody(req);
    const data = await readData();
    const draft = normalizeDraft(body.draft ?? body);
    const result = recommend(data, draft);
    return sendJson(res, 200, { ok: true, result });
  }

  if (req.method === "POST" && url.pathname === "/api/assign-auto") {
    const body = await readBody(req);
    const data = await readData();
    const created = assignAutomatically(data, body.draft ?? body);
    const confirmedData = await confirmedDataAfterSave(data, ["cases", "queues", "state", "journal"], (freshData) => Boolean(findCase(freshData, created.case.case_id)));
    const confirmedCase = assertConfirmedCase(confirmedData, created.case.case_id, "автоназначение нового дела");
    return sendJson(res, 200, { ok: true, ...created, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/assign-manual") {
    const body = await readBody(req);
    const data = await readData();
    const created = assignManually(data, body.draft ?? body, body.responsible, body.comment);
    const confirmedData = await confirmedDataAfterSave(data, ["cases", "state", "journal"], (freshData) => Boolean(findCase(freshData, created.case.case_id)));
    const confirmedCase = assertConfirmedCase(confirmedData, created.case.case_id, "ручное назначение нового дела");
    return sendJson(res, 200, { ok: true, ...created, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/assign-auto")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    await readBody(req);
    const data = await readData();
    const assigned = assignExistingAutomatically(data, caseId);
    const confirmedData = await confirmedDataAfterSave(data, ["cases", "queues", "state", "journal"], (freshData) => Boolean(findCase(freshData, caseId)));
    const confirmedCase = assertConfirmedCase(confirmedData, caseId, "автоназначение существующего дела");
    return sendJson(res, 200, { ok: true, ...assigned, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/assign-manual")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    const body = await readBody(req);
    const data = await readData();
    const assigned = assignExistingManually(data, caseId, body.responsible, body.comment);
    const confirmedData = await confirmedDataAfterSave(data, ["cases", "state", "journal"], (freshData) => Boolean(findCase(freshData, caseId)));
    const confirmedCase = assertConfirmedCase(confirmedData, caseId, "ручное назначение существующего дела");
    return sendJson(res, 200, { ok: true, ...assigned, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/responsible")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    const body = await readBody(req);
    const data = await readData();
    const updated = changeCaseResponsible(data, caseId, body.responsible);
    const confirmedData = await confirmedDataAfterSave(data, ["cases", "journal"], (freshData) => Boolean(findCase(freshData, caseId)));
    const confirmedCase = assertConfirmedCase(confirmedData, caseId, "смена ответственного");
    return sendJson(res, 200, { ok: true, ...updated, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/delete")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    const body = await readBody(req);
    const data = await readData();
    const deleted = deleteCase(data, caseId, body.confirmCaseId ?? body.case_id);
    const confirmedData = await confirmedDataAfterSave(data, ["cases", "journal"], (freshData) => Boolean(findCase(freshData, caseId)));
    const confirmedCase = assertConfirmedCase(confirmedData, caseId, "удаление дела");
    return sendJson(res, 200, { ok: true, ...deleted, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/restore")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    await readBody(req);
    const data = await readData();
    const restored = restoreCase(data, caseId);
    const confirmedData = await confirmedDataAfterSave(data, ["cases", "journal"], (freshData) => Boolean(findCase(freshData, caseId)));
    const confirmedCase = assertConfirmedCase(confirmedData, caseId, "восстановление дела");
    return sendJson(res, 200, { ok: true, ...restored, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/complete-deadline")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    await readBody(req);
    const data = await readData();
    const completed = completeCaseByDeadline(data, caseId);
    const confirmedData = await confirmedDataAfterSave(data, ["cases", "journal"], (freshData) => Boolean(findCase(freshData, caseId)));
    const confirmedCase = assertConfirmedCase(confirmedData, caseId, "завершение по контрольному сроку");
    return sendJson(res, 200, { ok: true, ...completed, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/postpone-completion")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    const body = await readBody(req);
    const data = await readData();
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
    Object.assign(employee, patch);
    const confirmedData = await confirmedDataAfterSave(data, ["employees"], (freshData) => Boolean(freshData.employees.find((item) => item.employee_id === id)));
    const confirmedEmployee = confirmedData.employees.find((item) => item.employee_id === id) ?? employee;
    return sendJson(res, 200, { ok: true, employee: confirmedEmployee, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/vacations/toggle") {
    const body = await readBody(req);
    const data = await readData();
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
    if (!body.employee_id || !body.year) return sendJson(res, 400, { ok: false, error: "Нужны employee_id и year." });
    const dates = replaceVacationYear(data, body.employee_id, body.year, body.dates ?? []);
    const confirmedData = await confirmedDataAfterSave(data, ["vacations"]);
    return sendJson(res, 200, { ok: true, dates, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/vacations/clear-year") {
    const body = await readBody(req);
    const data = await readData();
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
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] ?? "application/octet-stream" });
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
    sendJson(res, 500, { ok: false, error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Приложение запущено: http://${HOST}:${PORT}`);
  console.log(`MTS Tabs API: ${storagePath()}`);
});
