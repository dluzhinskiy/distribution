import { Readable } from "node:stream";
import { canEditCase } from "../lib/access-policy.mjs";
import {
  FIELD,
  assignAutomatically,
  assignExistingAutomatically,
  assignExistingManually,
  assignManually,
  changeCaseResponsible,
  cleanText,
  completeCaseByDeadline,
  deleteCase,
  enrichData,
  isDeletedCase,
  normalizeDraft,
  postponeCaseCompletion,
  recommendWithPreview,
  restoreCase,
} from "../lib/domain.mjs";
import { publicAttachment } from "../lib/http-utils.mjs";
import { previewDocx, previewXlsx } from "../lib/office-preview.mjs";
import { downloadAttachment, uploadAttachment } from "../lib/tabs-store.mjs";
import { assertAllowedFields } from "../lib/validation.mjs";

const EMPLOYEE_SELF_EDIT_FIELDS = new Set(["Номер дела", "Ссылка", "Статус", "Истец", "Ответчик", "Третье лицо", "Предмет"]);
const EMPLOYEE_EDITABLE_STATUSES = new Set(["В работе", "Приостановлено", "Завершено"]);
const MANAGER_CASE_EDIT_FIELDS = new Set([
  "Номер дела", "Ссылка", "Тип дела", "Статус", "Ответственный", "Регион",
  "Дата поступления", "Дата завершения", "Истец", "Ответчик", "Третье лицо",
  "Предмет", "Движение дела",
]);
const DISTRIBUTION_READ_TABLES = [
  "cases", "employees", "queues", "state", "vacations", "settings",
  "yucSettings", "regionalAssignments", "regionalSubstitutions",
];

function findCase(data, caseId) {
  return data.cases.find((item) => item.case_id === caseId);
}

function assertConfirmedCase(data, caseId, action = "сохранено") {
  const caseRow = findCase(data, caseId);
  if (!caseRow) throw new Error(`Дело ${caseId} не найдено в MTS Tabs после операции: ${action}.`);
  return caseRow;
}

function safeAttachmentName(value) {
  const decoded = (() => {
    try { return decodeURIComponent(String(value ?? "")); } catch { return String(value ?? ""); }
  })();
  return decoded.replace(/[\u0000-\u001f\\/:*?"<>|]/g, "_").trim().slice(0, 180) || "document";
}

function attachmentId(attachment = {}) {
  return cleanText(attachment.id || attachment.token || attachment.url);
}

function attachmentDownloadHeaders(attachment, upstream, disposition = "attachment") {
  const name = safeAttachmentName(attachment?.name || "document");
  return {
    "Content-Type": upstream.headers.get("content-type") || attachment?.mimeType || "application/octet-stream",
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

function officePreviewType(attachment = {}) {
  const name = cleanText(attachment.name).toLowerCase();
  const mime = cleanText(attachment.mimeType).toLowerCase();
  if (name.endsWith(".docx") || mime.includes("wordprocessingml.document")) return "docx";
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm") || mime.includes("spreadsheetml.sheet") || mime.includes("spreadsheetml.template")) return "xlsx";
  return "";
}

export function createCaseRoutes({
  auth,
  readBody,
  readBinaryBody,
  readData,
  saveAndConfirm,
  sendJson,
  requireManageYuc,
  requireManageCase,
  employeeScopedData,
  patchCachedRow = async (table, _row, _fields, data) => saveAndConfirm(data, [table]),
  caseDocumentMaxBytes,
  officePreviewMaxBytes,
}) {
  function requireCaseDocumentWrite(user, data, caseRow) {
    const employee = data.employees.find((item) => cleanText(item.employee_id) === user.employeeId);
    if (!canEditCase(user, employee, caseRow)) {
      const error = new Error("Добавлять документы можно только в собственное дело своего ЮЦ.");
      error.status = 403;
      throw error;
    }
  }

  async function findCaseAttachment(caseId, documentId) {
    const data = await readData(["cases"]);
    const caseRow = findCase(data, caseId);
    if (!caseRow) {
      const error = new Error("Дело не найдено.");
      error.status = 404;
      throw error;
    }
    const attachment = (Array.isArray(caseRow[FIELD.documents]) ? caseRow[FIELD.documents] : [])
      .find((item) => attachmentId(item) === documentId);
    if (!attachment) {
      const error = new Error("Документ не найден.");
      error.status = 404;
      throw error;
    }
    return attachment;
  }

  async function streamCaseAttachment(res, attachment, disposition) {
    const upstream = await downloadAttachment("cases", attachment);
    res.writeHead(200, attachmentDownloadHeaders(attachment, upstream, disposition));
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
  }

  async function getOfficePreview(attachment) {
    const type = officePreviewType(attachment);
    if (!type) {
      const error = new Error("Предпросмотр доступен для файлов DOCX, XLSX и XLSM.");
      error.status = 415;
      throw error;
    }
    const upstream = await downloadAttachment("cases", attachment);
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > officePreviewMaxBytes) {
      const error = new Error("Файл слишком большой для предпросмотра. Его можно скачать и открыть на устройстве.");
      error.status = 413;
      throw error;
    }
    return type === "docx" ? previewDocx(buffer) : previewXlsx(buffer);
  }

  async function patchCase(req, res, url, user) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const patch = await readBody(req);
    if (patch["Статус"] === "Удалено") {
      const error = new Error("Для удаления дела используйте защищённое действие удаления.");
      error.status = 400;
      throw error;
    }
    const data = await readData(["cases", "employees", "settings", "vacations"]);
    const caseRow = findCase(data, id);
    if (!caseRow) {
      const error = new Error("Дело не найдено.");
      error.status = 404;
      throw error;
    }
    const manager = auth.isManager(user);
    if (!manager) {
      const employee = data.employees.find((item) => cleanText(item.employee_id) === user.employeeId);
      if (!canEditCase(user, employee, caseRow)) {
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
      if (patch["Статус"] === "Завершено" && !caseRow["Дата завершения"]) caseRow["Дата завершения"] = new Date().toISOString().slice(0, 10);
    } else {
      requireManageYuc(user, caseRow[FIELD.yuc]);
      assertAllowedFields(patch, MANAGER_CASE_EDIT_FIELDS, "Через карточку нельзя изменять");
      Object.assign(caseRow, patch);
    }
    const changedFields = [...Object.keys(patch)];
    if (patch["Статус"] === "Завершено" && !changedFields.includes("Дата завершения")) changedFields.push("Дата завершения");
    await patchCachedRow("cases", caseRow, changedFields, data);
    const confirmedData = enrichData(data);
    const confirmedCase = assertConfirmedCase(confirmedData, id, "обновление дела");
    const responseData = manager
      ? confirmedData
      : employeeScopedData(confirmedData, confirmedData.employees.find((item) => cleanText(item.employee_id) === user.employeeId));
    sendJson(res, 200, { ok: true, case: confirmedCase, data: responseData });
  }

  return async function handleCaseRoute(req, res, url, user) {
    if (req.method === "GET" && /^\/api\/cases\/[^/]+$/.test(url.pathname)) {
      const caseId = decodeURIComponent(url.pathname.split("/").pop());
      const data = await readData(["cases"]);
      const caseRow = findCase(data, caseId);
      if (!caseRow) {
        const error = new Error("Дело не найдено.");
        error.status = 404;
        throw error;
      }
      sendJson(res, 200, { ok: true, case: caseRow });
      return true;
    }

    if (req.method === "POST" && /^\/api\/cases\/[^/]+\/documents$/.test(url.pathname)) {
      const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
      const data = await readData(["cases", "employees", "settings", "vacations"]);
      const caseRow = findCase(data, caseId);
      if (!caseRow) {
        const error = new Error("Дело не найдено.");
        error.status = 404;
        throw error;
      }
      if (isDeletedCase(caseRow)) {
        const error = new Error("Нельзя добавлять документы в удалённое дело.");
        error.status = 409;
        throw error;
      }
      requireCaseDocumentWrite(user, data, caseRow);
      const file = await readBinaryBody(req, caseDocumentMaxBytes);
      const name = safeAttachmentName(req.headers["x-file-name"]);
      const mimeType = cleanText(req.headers["x-file-type"]) || "application/octet-stream";
      const attachment = await uploadAttachment("cases", { buffer: file, name, mimeType });
      caseRow[FIELD.documents] = [...(Array.isArray(caseRow[FIELD.documents]) ? caseRow[FIELD.documents] : []), attachment];
      await patchCachedRow("cases", caseRow, [FIELD.documents], data);
      const confirmedData = enrichData(data);
      const confirmedCase = assertConfirmedCase(confirmedData, caseId, "добавление документа");
      const responseData = auth.isManager(user)
        ? confirmedData
        : employeeScopedData(confirmedData, confirmedData.employees.find((item) => cleanText(item.employee_id) === user.employeeId));
      sendJson(res, 200, { ok: true, attachment: publicAttachment(attachment), case: confirmedCase, data: responseData });
      return true;
    }

    const documentParts = url.pathname.split("/").filter(Boolean);
    if (req.method === "GET" && /^\/api\/cases\/[^/]+\/documents\/[^/]+\/preview$/.test(url.pathname)) {
      const attachment = await findCaseAttachment(decodeURIComponent(documentParts[2]), decodeURIComponent(documentParts[4]));
      await streamCaseAttachment(res, attachment, "inline");
      return true;
    }
    if (req.method === "GET" && /^\/api\/cases\/[^/]+\/documents\/[^/]+\/office-preview$/.test(url.pathname)) {
      const attachment = await findCaseAttachment(decodeURIComponent(documentParts[2]), decodeURIComponent(documentParts[4]));
      sendJson(res, 200, { ok: true, preview: await getOfficePreview(attachment) });
      return true;
    }
    if (req.method === "GET" && /^\/api\/cases\/[^/]+\/documents\/[^/]+\/download$/.test(url.pathname)) {
      const attachment = await findCaseAttachment(decodeURIComponent(documentParts[2]), decodeURIComponent(documentParts[4]));
      await streamCaseAttachment(res, attachment, "attachment");
      return true;
    }
    if (req.method === "PATCH" && /^\/api\/cases\/[^/]+$/.test(url.pathname)) {
      await patchCase(req, res, url, user);
      return true;
    }

    if (!auth.isManager(user)) return false;

    if (req.method === "POST" && url.pathname === "/api/recommend") {
      const body = await readBody(req);
      const data = await readData(DISTRIBUTION_READ_TABLES);
      const draft = normalizeDraft(body.draft ?? body);
      requireManageYuc(user, draft[FIELD.yuc]);
      sendJson(res, 200, { ok: true, result: recommendWithPreview(data, draft) });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/assign-auto") {
      const body = await readBody(req);
      const data = await readData(DISTRIBUTION_READ_TABLES);
      const draft = normalizeDraft(body.draft ?? body);
      requireManageYuc(user, draft[FIELD.yuc]);
      const created = assignAutomatically(data, draft);
      const confirmedData = await saveAndConfirm(data, ["cases", "queues", "state"], (freshData) => Boolean(findCase(freshData, created.case.case_id)));
      sendJson(res, 200, { ok: true, ...created, case: assertConfirmedCase(confirmedData, created.case.case_id, "автоназначение нового дела"), data: confirmedData });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/assign-manual") {
      const body = await readBody(req);
      const data = await readData(DISTRIBUTION_READ_TABLES);
      const draft = normalizeDraft(body.draft ?? body);
      requireManageYuc(user, draft[FIELD.yuc]);
      const created = assignManually(data, draft, body.responsible, body.comment);
      const confirmedData = await saveAndConfirm(data, ["cases", "state"], (freshData) => Boolean(findCase(freshData, created.case.case_id)));
      sendJson(res, 200, { ok: true, ...created, case: assertConfirmedCase(confirmedData, created.case.case_id, "ручное назначение нового дела"), data: confirmedData });
      return true;
    }

    const existingAction = async (action, tables, label, readTables = tables) => {
      const caseId = decodeURIComponent(url.pathname.split("/").at(-2));
      const data = await readData(readTables);
      requireManageCase(user, data, caseId);
      const beforeCase = { ...findCase(data, caseId) };
      const result = await action(data, caseId);
      let confirmedData;
      if (tables.length === 1 && tables[0] === "cases") {
        const changedCase = findCase(data, caseId);
        const changedFields = Object.keys(changedCase).filter((field) => JSON.stringify(beforeCase[field]) !== JSON.stringify(changedCase[field]));
        await patchCachedRow("cases", changedCase, changedFields, data);
        confirmedData = enrichData(data);
      } else {
        confirmedData = await saveAndConfirm(data, tables, (freshData) => Boolean(findCase(freshData, caseId)));
      }
      sendJson(res, 200, { ok: true, ...result, case: assertConfirmedCase(confirmedData, caseId, label), data: confirmedData });
      return true;
    };

    if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/assign-auto")) {
      await readBody(req);
      return existingAction((data, caseId) => assignExistingAutomatically(data, caseId), ["cases", "queues", "state"], "автоназначение существующего дела", DISTRIBUTION_READ_TABLES);
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/assign-manual")) {
      const body = await readBody(req);
      return existingAction((data, caseId) => assignExistingManually(data, caseId, body.responsible, body.comment), ["cases", "state"], "ручное назначение существующего дела", DISTRIBUTION_READ_TABLES);
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/responsible")) {
      const body = await readBody(req);
      return existingAction((data, caseId) => changeCaseResponsible(data, caseId, body.responsible), ["cases"], "смена ответственного", ["cases", "employees"]);
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/delete")) {
      const body = await readBody(req);
      return existingAction((data, caseId) => deleteCase(data, caseId, body.confirmCaseId ?? body.case_id), ["cases"], "удаление дела");
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/restore")) {
      await readBody(req);
      return existingAction((data, caseId) => restoreCase(data, caseId), ["cases"], "восстановление дела");
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/complete-deadline")) {
      await readBody(req);
      return existingAction((data, caseId) => completeCaseByDeadline(data, caseId), ["cases"], "завершение по контрольному сроку");
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/postpone-completion")) {
      const body = await readBody(req);
      return existingAction((data, caseId) => postponeCaseCompletion(data, caseId, body.postponeTo, body.reason), ["cases"], "отложение завершения");
    }

    return false;
  };
}
