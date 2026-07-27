import { FIELD } from "./domain-schema.mjs";
import { cleanText, nameMatches, todayISO, toISODate } from "./domain-values.mjs";

const DELETED_STATUS = "Удалено";

function caseById(data, caseId) {
  return (data.cases ?? []).find((row) => cleanText(row.case_id) === cleanText(caseId));
}

function employeeByName(data, name) {
  return (data.employees ?? []).find((employee) => nameMatches(employee[FIELD.name], name));
}

function isDeletedCase(caseRow) {
  return cleanText(caseRow?.[FIELD.status]) === DELETED_STATUS;
}

export function changeCaseResponsible(data, caseId, responsible) {
  const caseRow = caseById(data, caseId);
  if (!caseRow) throw new Error("Дело не найдено.");
  if (isDeletedCase(caseRow)) throw new Error("Удалённое дело сначала нужно восстановить.");
  const name = cleanText(responsible);
  if (!name) throw new Error("Укажите нового ответственного.");
  if (!employeeByName(data, name)) throw new Error("Ответственный должен быть выбран из списка сотрудников.");
  const previous = cleanText(caseRow[FIELD.responsible]);
  if (previous === name) return { case: caseRow, changed: false };
  Object.assign(caseRow, {
    [FIELD.responsible]: name,
    "Ручное назначение": "Да",
    "Основание": "Принудительная смена ответственного",
    "Комментарий": cleanText(caseRow["Комментарий"]),
  });
  return { case: caseRow, changed: true, previous };
}

export function completeCaseByDeadline(data, caseId, date = new Date()) {
  const caseRow = caseById(data, caseId);
  if (!caseRow) throw new Error("Дело не найдено.");
  if (isDeletedCase(caseRow)) throw new Error("Удалённое дело сначала нужно восстановить.");
  const previousStatus = cleanText(caseRow[FIELD.status]) || "В работе";
  if (previousStatus === "Завершено") return { case: caseRow, changed: false };
  Object.assign(caseRow, {
    [FIELD.status]: "Завершено",
    "Дата завершения": todayISO(date),
    "Дата предупреждения о завершении": todayISO(date),
    "Комментарий": cleanText(caseRow["Комментарий"]),
  });
  return { case: caseRow, changed: true, previousStatus };
}

export function postponeCaseCompletion(data, caseId, postponeTo, reason, date = new Date()) {
  const caseRow = caseById(data, caseId);
  if (!caseRow) throw new Error("Дело не найдено.");
  if (isDeletedCase(caseRow)) throw new Error("Удалённое дело сначала нужно восстановить.");
  const postponedDate = toISODate(postponeTo);
  if (!postponedDate) throw new Error("Укажите дату, до которой отложить завершение.");
  if (postponedDate < todayISO(date)) throw new Error("Дата отложения не может быть раньше сегодняшней даты.");
  const note = cleanText(reason);
  if (!note) throw new Error("Укажите причину отложения завершения.");
  Object.assign(caseRow, {
    "Отложить завершение до": postponedDate,
    "Причина отложения завершения дела": note,
    "Дата предупреждения о завершении": todayISO(date),
    "Комментарий": cleanText(caseRow["Комментарий"]),
  });
  return { case: caseRow, changed: true };
}

export function deleteCase(data, caseId, confirmCaseId, date = new Date()) {
  const caseRow = caseById(data, caseId);
  if (!caseRow) throw new Error("Дело не найдено.");
  const normalizedId = cleanText(caseRow.case_id);
  if (cleanText(confirmCaseId) !== normalizedId) throw new Error(`Для удаления нужно ввести точный ID дела: ${normalizedId}`);
  if (isDeletedCase(caseRow)) return { case: caseRow, changed: false };
  const previousStatus = cleanText(caseRow[FIELD.status]) || "В работе";
  Object.assign(caseRow, {
    [FIELD.status]: DELETED_STATUS,
    "Дата завершения": todayISO(date),
    "Комментарий": cleanText(caseRow["Комментарий"]),
  });
  return { case: caseRow, changed: true, previousStatus };
}

export function restoreCase(data, caseId) {
  const caseRow = caseById(data, caseId);
  if (!caseRow) throw new Error("Дело не найдено.");
  if (!isDeletedCase(caseRow)) return { case: caseRow, changed: false };
  const restoredStatus = cleanText(caseRow[FIELD.responsible]) ? "В работе" : "Ожидает распределения";
  Object.assign(caseRow, {
    [FIELD.status]: restoredStatus,
    "Дата завершения": "",
    "Комментарий": cleanText(caseRow["Комментарий"]),
  });
  return { case: caseRow, changed: true, restoredStatus };
}
