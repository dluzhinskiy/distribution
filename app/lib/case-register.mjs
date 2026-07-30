import { FIELD, cleanText, isDeletedCase, nameMatches, normalizeType, normalizeYuc } from "./domain.mjs";

const ALLOWED_CELL_FIELDS = new Set([
  "Тип дела", "Статус", "Ответственный", "Регион", "Истец", "Ответчик",
  "Третье лицо", "Дата поступления",
]);
const COMPLETED_STATUSES = new Set(["Завершено", "Отменено", "Удалено"]);

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function quickFilterMatches(row, filter) {
  if (filter === "active") return row["Актуально"] === "Да";
  if (filter === "inactive") return row["Актуально"] === "Нет" && !COMPLETED_STATUSES.has(row[FIELD.status]);
  if (filter === "waiting") return row[FIELD.status] === "Ожидает распределения";
  return true;
}

function cellFilterMatches(row, field, value) {
  if (!ALLOWED_CELL_FIELDS.has(field) || !value) return true;
  const current = cleanText(row[field]);
  if (field === FIELD.responsible) return nameMatches(current, value);
  if (field === FIELD.caseType) return normalizeType(current) === normalizeType(value);
  return current === value;
}

export function paginateCaseRegister(rows = [], query = {}, user = {}) {
  const pageSize = Math.min(200, positiveInteger(query.pageSize, 150));
  const requestedPage = positiveInteger(query.page, 1);
  const yuc = normalizeYuc(query.yuc);
  const scope = cleanText(query.scope);
  const responsible = cleanText(query.responsible);
  const cellField = cleanText(query.cellField);
  const cellValue = cleanText(query.cellValue);
  const term = cleanText(query.search).toLowerCase();
  const showDeleted = ["1", "true", "yes"].includes(cleanText(query.showDeleted).toLowerCase());

  const filtered = rows
    .filter((row) => scope === "mine"
      ? nameMatches(row[FIELD.responsible], user.name)
      : !yuc || normalizeYuc(row[FIELD.yuc]) === yuc)
    .filter((row) => showDeleted || !isDeletedCase(row))
    .filter((row) => quickFilterMatches(row, cleanText(query.quickFilter)))
    .filter((row) => !responsible || nameMatches(row[FIELD.responsible], responsible))
    .filter((row) => cellFilterMatches(row, cellField, cellValue))
    .filter((row) => !term || Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(term)))
    .slice()
    .reverse();
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;
  return { rows: filtered.slice(offset, offset + pageSize), page, pageSize, total, totalPages };
}
