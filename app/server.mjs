import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allDatesInRange, assignAutomatically, assignExistingAutomatically, assignExistingManually, assignManually, changeCaseResponsible, clearVacationYear, deleteCase, enrichData, normalizeDraft, recommend, restoreCase, setVacationDates, toISODate } from "./lib/domain.mjs";
import { readData, saveData, storagePath, tabsStorageStatus } from "./lib/tabs-store.mjs";
import { directoriesPath, readDirectories } from "./lib/directories.mjs";

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

async function confirmedDataAfterSave(data, confirm = null) {
  await saveData(data);
  let lastData = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt) {
      await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    }
    lastData = enrichData(await readData());
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
    const confirmedData = await confirmedDataAfterSave(data, (freshData) => Boolean(findCase(freshData, created.case.case_id)));
    const confirmedCase = assertConfirmedCase(confirmedData, created.case.case_id, "автоназначение нового дела");
    return sendJson(res, 200, { ok: true, ...created, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/assign-manual") {
    const body = await readBody(req);
    const data = await readData();
    const created = assignManually(data, body.draft ?? body, body.responsible, body.comment);
    const confirmedData = await confirmedDataAfterSave(data, (freshData) => Boolean(findCase(freshData, created.case.case_id)));
    const confirmedCase = assertConfirmedCase(confirmedData, created.case.case_id, "ручное назначение нового дела");
    return sendJson(res, 200, { ok: true, ...created, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/assign-auto")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    await readBody(req);
    const data = await readData();
    const assigned = assignExistingAutomatically(data, caseId);
    const confirmedData = await confirmedDataAfterSave(data, (freshData) => Boolean(findCase(freshData, caseId)));
    const confirmedCase = assertConfirmedCase(confirmedData, caseId, "автоназначение существующего дела");
    return sendJson(res, 200, { ok: true, ...assigned, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/assign-manual")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    const body = await readBody(req);
    const data = await readData();
    const assigned = assignExistingManually(data, caseId, body.responsible, body.comment);
    const confirmedData = await confirmedDataAfterSave(data, (freshData) => Boolean(findCase(freshData, caseId)));
    const confirmedCase = assertConfirmedCase(confirmedData, caseId, "ручное назначение существующего дела");
    return sendJson(res, 200, { ok: true, ...assigned, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/responsible")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    const body = await readBody(req);
    const data = await readData();
    const updated = changeCaseResponsible(data, caseId, body.responsible);
    const confirmedData = await confirmedDataAfterSave(data, (freshData) => Boolean(findCase(freshData, caseId)));
    const confirmedCase = assertConfirmedCase(confirmedData, caseId, "смена ответственного");
    return sendJson(res, 200, { ok: true, ...updated, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/delete")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    const body = await readBody(req);
    const data = await readData();
    const deleted = deleteCase(data, caseId, body.confirmCaseId ?? body.case_id);
    const confirmedData = await confirmedDataAfterSave(data, (freshData) => Boolean(findCase(freshData, caseId)));
    const confirmedCase = assertConfirmedCase(confirmedData, caseId, "удаление дела");
    return sendJson(res, 200, { ok: true, ...deleted, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/restore")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    await readBody(req);
    const data = await readData();
    const restored = restoreCase(data, caseId);
    const confirmedData = await confirmedDataAfterSave(data, (freshData) => Boolean(findCase(freshData, caseId)));
    const confirmedCase = assertConfirmedCase(confirmedData, caseId, "восстановление дела");
    return sendJson(res, 200, { ok: true, ...restored, case: confirmedCase, data: confirmedData });
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/employees/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const patch = await readBody(req);
    const data = await readData();
    const employee = data.employees.find((item) => item.employee_id === id);
    if (!employee) return sendJson(res, 404, { ok: false, error: "Сотрудник не найден." });
    Object.assign(employee, patch);
    const confirmedData = await confirmedDataAfterSave(data, (freshData) => Boolean(freshData.employees.find((item) => item.employee_id === id)));
    const confirmedEmployee = confirmedData.employees.find((item) => item.employee_id === id) ?? employee;
    return sendJson(res, 200, { ok: true, employee: confirmedEmployee, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/vacations/toggle") {
    const body = await readBody(req);
    const data = await readData();
    const day = toISODate(body.date);
    if (!body.employee_id || !day) return sendJson(res, 400, { ok: false, error: "Нужны employee_id и date." });
    const exists = (data.vacations ?? []).some((item) => item.employee_id === body.employee_id && toISODate(item["Дата"]) === day);
    const dates = setVacationDates(data, body.employee_id, [day], !exists);
    const confirmedData = await confirmedDataAfterSave(data);
    return sendJson(res, 200, { ok: true, enabled: !exists, dates, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/vacations/range") {
    const body = await readBody(req);
    const data = await readData();
    const dates = allDatesInRange(body.start, body.end);
    if (!body.employee_id || !dates.length) return sendJson(res, 400, { ok: false, error: "Нужны employee_id, start и end." });
    const enabled = body.action !== "clear";
    const employeeDates = setVacationDates(data, body.employee_id, dates, enabled);
    const confirmedData = await confirmedDataAfterSave(data);
    return sendJson(res, 200, { ok: true, enabled, dates: employeeDates, data: confirmedData });
  }

  if (req.method === "POST" && url.pathname === "/api/vacations/clear-year") {
    const body = await readBody(req);
    const data = await readData();
    if (!body.employee_id || !body.year) return sendJson(res, 400, { ok: false, error: "Нужны employee_id и year." });
    const dates = clearVacationYear(data, body.employee_id, body.year);
    const confirmedData = await confirmedDataAfterSave(data);
    return sendJson(res, 200, { ok: true, dates, data: confirmedData });
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
    const confirmedData = await confirmedDataAfterSave(data, (freshData) => Boolean(findCase(freshData, id)));
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
    const confirmedData = await confirmedDataAfterSave(data, (freshData) => Boolean(freshData.queues.find((item) => item.queue_id === row.queue_id && item.employee_id === row.employee_id)));
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
    const confirmedData = await confirmedDataAfterSave(data, (freshData) => Boolean(freshData.state.find((item) => item.queue_id === queueId)));
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
