import {
  allDatesInRange,
  clearVacationYear,
  enrichData,
  replaceVacationDatesForEmployees,
  replaceVacationYear,
  setVacationDates,
  toISODate,
} from "../lib/domain.mjs";
import { parseVacationWorkbook } from "../lib/xlsx-vacation-import.mjs";

export function createVacationRoutes({
  readBody,
  readBinaryBody,
  readData,
  saveAndConfirm,
  sendJson,
  requireManageEmployee,
}) {
  return async function handleVacationRoute(req, res, url, user) {
    if (req.method === "POST" && url.pathname === "/api/vacations/toggle") {
      const body = await readBody(req);
      const data = await readData(["employees", "vacations"]);
      requireManageEmployee(user, data, body.employee_id);
      const day = toISODate(body.date);
      if (!body.employee_id || !day) {
        sendJson(res, 400, { ok: false, error: "Нужны employee_id и date." });
        return true;
      }
      const enriched = enrichData(data);
      const exists = (enriched.vacations ?? []).some((item) => (
        item.employee_id === body.employee_id &&
        item["Дата начала"] <= day &&
        day <= (item["Дата окончания"] || item["Дата начала"])
      ));
      const dates = setVacationDates(data, body.employee_id, [day], !exists);
      const confirmedData = await saveAndConfirm(data, ["vacations"]);
      sendJson(res, 200, { ok: true, enabled: !exists, dates, data: confirmedData });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/vacations/range") {
      const body = await readBody(req);
      const data = await readData(["employees", "vacations"]);
      requireManageEmployee(user, data, body.employee_id);
      const dates = allDatesInRange(body.start, body.end);
      if (!body.employee_id || !dates.length) {
        sendJson(res, 400, { ok: false, error: "Нужны employee_id, start и end." });
        return true;
      }
      const enabled = body.action !== "clear";
      const employeeDates = setVacationDates(data, body.employee_id, dates, enabled);
      const confirmedData = await saveAndConfirm(data, ["vacations"]);
      sendJson(res, 200, { ok: true, enabled, dates: employeeDates, data: confirmedData });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/vacations/save-year") {
      const body = await readBody(req);
      const data = await readData(["employees", "vacations"]);
      requireManageEmployee(user, data, body.employee_id);
      if (!body.employee_id || !body.year) {
        sendJson(res, 400, { ok: false, error: "Нужны employee_id и year." });
        return true;
      }
      const dates = replaceVacationYear(data, body.employee_id, body.year, body.dates ?? []);
      const confirmedData = await saveAndConfirm(data, ["vacations"]);
      sendJson(res, 200, { ok: true, dates, data: confirmedData });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/vacations/clear-year") {
      const body = await readBody(req);
      const data = await readData(["employees", "vacations"]);
      requireManageEmployee(user, data, body.employee_id);
      if (!body.employee_id || !body.year) {
        sendJson(res, 400, { ok: false, error: "Нужны employee_id и year." });
        return true;
      }
      const dates = clearVacationYear(data, body.employee_id, body.year);
      const confirmedData = await saveAndConfirm(data, ["vacations"]);
      sendJson(res, 200, { ok: true, dates, data: confirmedData });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/vacations/import-preview") {
      const buffer = await readBinaryBody(req);
      const data = await readData(["employees", "vacations"]);
      const plan = parseVacationWorkbook(buffer, data.employees ?? []);
      sendJson(res, 200, { ok: true, plan });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/vacations/import-apply") {
      const body = await readBody(req);
      const plan = body.plan;
      if (!plan?.scopeDates?.length || !plan?.matched?.length) {
        sendJson(res, 400, { ok: false, error: "Нет подготовленного плана импорта." });
        return true;
      }
      const data = await readData(["employees", "vacations"]);
      for (const item of plan.matched) requireManageEmployee(user, data, item.employee_id);
      const result = replaceVacationDatesForEmployees(data, plan.matched, plan.scopeDates);
      const confirmedData = await saveAndConfirm(data, ["vacations"]);
      sendJson(res, 200, { ok: true, result, data: confirmedData });
      return true;
    }

    return false;
  };
}
