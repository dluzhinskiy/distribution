import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allDatesInRange, assignAutomatically, assignExistingAutomatically, assignExistingManually, assignManually, changeCaseResponsible, clearVacationYear, enrichData, normalizeDraft, recommend, setVacationDates, toISODate } from "./lib/domain.mjs";
import { readData, saveData, storagePath } from "./lib/excel-store.mjs";
import { directoriesPath, readDirectories } from "./lib/directories.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 8766);
const HOST = process.env.HOST || (process.env.RENDER || process.env.RENDER_SERVICE_ID ? "0.0.0.0" : "127.0.0.1");

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
    return sendJson(res, 200, { ok: true, data, storagePath: storagePath(), directoriesPath: directoriesPath() });
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
    await saveData(data);
    return sendJson(res, 200, { ok: true, ...created, data: enrichData(data) });
  }

  if (req.method === "POST" && url.pathname === "/api/assign-manual") {
    const body = await readBody(req);
    const data = await readData();
    const created = assignManually(data, body.draft ?? body, body.responsible, body.comment);
    await saveData(data);
    return sendJson(res, 200, { ok: true, ...created, data: enrichData(data) });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/assign-auto")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    await readBody(req);
    const data = await readData();
    const assigned = assignExistingAutomatically(data, caseId);
    await saveData(data);
    return sendJson(res, 200, { ok: true, ...assigned, data: enrichData(data) });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/assign-manual")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    const body = await readBody(req);
    const data = await readData();
    const assigned = assignExistingManually(data, caseId, body.responsible, body.comment);
    await saveData(data);
    return sendJson(res, 200, { ok: true, ...assigned, data: enrichData(data) });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/responsible")) {
    const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
    const body = await readBody(req);
    const data = await readData();
    const updated = changeCaseResponsible(data, caseId, body.responsible);
    await saveData(data);
    return sendJson(res, 200, { ok: true, ...updated, data: enrichData(data) });
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/employees/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const patch = await readBody(req);
    const data = await readData();
    const employee = data.employees.find((item) => item.employee_id === id);
    if (!employee) return sendJson(res, 404, { ok: false, error: "Сотрудник не найден." });
    Object.assign(employee, patch);
    await saveData(data);
    return sendJson(res, 200, { ok: true, employee, data: enrichData(data) });
  }

  if (req.method === "POST" && url.pathname === "/api/vacations/toggle") {
    const body = await readBody(req);
    const data = await readData();
    const day = toISODate(body.date);
    if (!body.employee_id || !day) return sendJson(res, 400, { ok: false, error: "Нужны employee_id и date." });
    const exists = (data.vacations ?? []).some((item) => item.employee_id === body.employee_id && toISODate(item["Дата"]) === day);
    const dates = setVacationDates(data, body.employee_id, [day], !exists);
    await saveData(data);
    return sendJson(res, 200, { ok: true, enabled: !exists, dates, data: enrichData(data) });
  }

  if (req.method === "POST" && url.pathname === "/api/vacations/range") {
    const body = await readBody(req);
    const data = await readData();
    const dates = allDatesInRange(body.start, body.end);
    if (!body.employee_id || !dates.length) return sendJson(res, 400, { ok: false, error: "Нужны employee_id, start и end." });
    const enabled = body.action !== "clear";
    const employeeDates = setVacationDates(data, body.employee_id, dates, enabled);
    await saveData(data);
    return sendJson(res, 200, { ok: true, enabled, dates: employeeDates, data: enrichData(data) });
  }

  if (req.method === "POST" && url.pathname === "/api/vacations/clear-year") {
    const body = await readBody(req);
    const data = await readData();
    if (!body.employee_id || !body.year) return sendJson(res, 400, { ok: false, error: "Нужны employee_id и year." });
    const dates = clearVacationYear(data, body.employee_id, body.year);
    await saveData(data);
    return sendJson(res, 200, { ok: true, dates, data: enrichData(data) });
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/cases/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const patch = await readBody(req);
    const data = await readData();
    const caseRow = data.cases.find((item) => item.case_id === id);
    if (!caseRow) return sendJson(res, 404, { ok: false, error: "Дело не найдено." });
    Object.assign(caseRow, patch);
    await saveData(data);
    return sendJson(res, 200, { ok: true, case: caseRow, data: enrichData(data) });
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/queues/")) {
    const [, , , queueId, employeeId] = url.pathname.split("/");
    const patch = await readBody(req);
    const data = await readData();
    const row = data.queues.find((item) => item.queue_id === decodeURIComponent(queueId) && item.employee_id === decodeURIComponent(employeeId));
    if (!row) return sendJson(res, 404, { ok: false, error: "Строка очереди не найдена." });
    Object.assign(row, patch);
    await saveData(data);
    return sendJson(res, 200, { ok: true, queue: row, data: enrichData(data) });
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/state/")) {
    const queueId = decodeURIComponent(url.pathname.split("/").pop());
    const patch = await readBody(req);
    const data = await readData();
    const row = data.state.find((item) => item.queue_id === queueId);
    if (!row) return sendJson(res, 404, { ok: false, error: "Состояние очереди не найдено." });
    Object.assign(row, patch);
    await saveData(data);
    return sendJson(res, 200, { ok: true, state: row, data: enrichData(data) });
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
  console.log(`Excel-хранилище: ${storagePath()}`);
});
