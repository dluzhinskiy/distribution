import {
  CASE_HEADERS,
  EMPLOYEE_HEADERS,
  QUEUE_HEADERS,
  REGIONAL_ASSIGNMENT_HEADERS,
  REGIONAL_SUBSTITUTION_HEADERS,
  SETTINGS_HEADERS,
  STATE_HEADERS,
  VACATION_HEADERS,
  YUC_SETTINGS_HEADERS,
  cleanText,
} from "./domain.mjs";
import { LOAD_COEFFICIENT_HEADERS } from "./load-coefficients.mjs";
import { inboundFieldValue, outboundFieldName, tableFieldKey } from "./tabs-fields.mjs";
import { fetchTextWithRetry } from "./fetch-retry.mjs";

const API_BASE = process.env.TABS_API_BASE || "https://tabs.mts.ru/fusion/v1";
const TOKEN = process.env.TABS_API_TOKEN;
const FIELD_KEY = "name";
function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
const PAGE_SIZE = positiveInteger(process.env.TABS_PAGE_SIZE, 1000);
const DASHBOARD_PAGE_SIZE = positiveInteger(process.env.TABS_DASHBOARD_PAGE_SIZE, 1000);
const REQUEST_TIMEOUT_MS = positiveInteger(process.env.TABS_REQUEST_TIMEOUT_MS, 30000);
const REQUEST_RETRIES = positiveInteger(process.env.TABS_REQUEST_RETRIES, 3);
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

export const DASHBOARD_CASE_HEADERS = Object.freeze([
  "case_id",
  "ЮЦ",
  "Регион",
  "Тип дела",
  "Дата поступления",
  "Статус",
  "Дата завершения",
  "Отложить завершение до",
  "Причина отложения завершения дела",
  "Дата предупреждения о завершении",
  "Ответственный",
  "Дата распределения",
]);

const OPERATIONAL_CASE_DETAIL_HEADERS = Object.freeze([
  "case_id", "Номер дела", "Предмет", "Истец", "Ответчик", "Третье лицо", "Ссылка",
]);
export const OPERATIONAL_CASE_HEADERS = Object.freeze([
  ...new Set([...DASHBOARD_CASE_HEADERS, ...OPERATIONAL_CASE_DETAIL_HEADERS]),
]);

const TABLES = {
  cases: {
    name: "Дела",
    datasheetId: process.env.TABS_CASES_DATASHEET_ID || "dstD5wqizSVQS89kL7",
    viewId: process.env.TABS_CASES_VIEW_ID || "viwBynFRDSNva",
    // Поле вложений может быть скрыто в пользовательском представлении. Для дел
    // читаем полный набор полей, чтобы обычное сохранение не потеряло документы.
    readAllFields: true,
    headers: CASE_HEADERS,
    keyFields: ["case_id"],
    dateFields: ["Дата поступления", "Дата завершения", "Отложить завершение до", "Дата предупреждения о завершении", "Дата распределения"],
    attachmentFields: ["Документы"],
    writeFieldNames: {
      "Дата предупреждения о завершении": "Дата предупрежедения о завершении",
    },
  },
  employees: {
    name: "Сотрудники",
    datasheetId: process.env.TABS_EMPLOYEES_DATASHEET_ID || "dstm3BBmBsSc4JqokB",
    viewId: process.env.TABS_EMPLOYEES_VIEW_ID || "viwFcmKElrBo0",
    headers: EMPLOYEE_HEADERS,
    keyFields: ["employee_id"],
    dateFields: ["Отпуск с", "Отпуск по"],
    numberFields: ["Срок действия кода"],
  },
  queues: {
    name: "Очереди",
    datasheetId: process.env.TABS_QUEUES_DATASHEET_ID || "dstw6EXKiu4xYjDrmN",
    viewId: process.env.TABS_QUEUES_VIEW_ID || "viwMJKJ6Xf0cm",
    headers: QUEUE_HEADERS,
    keyFields: ["queue_id", "employee_id"],
    dateFields: ["Дата долга"],
    numberFields: ["Долг"],
  },
  state: {
    name: "Состояние",
    datasheetId: process.env.TABS_STATE_DATASHEET_ID || "dsttaEquzJk9JKP9Mt",
    viewId: process.env.TABS_STATE_VIEW_ID || "viwUdgXG3HeLF",
    headers: STATE_HEADERS,
    keyFields: ["queue_id"],
    dateFields: ["Дата последнего автоназначения"],
    numberFields: ["Последняя позиция", "Цикл"],
  },
  vacations: {
    name: "Отпуска",
    datasheetId: process.env.TABS_VACATIONS_DATASHEET_ID || "dstcWl39DcpKnphNyA",
    viewId: process.env.TABS_VACATIONS_VIEW_ID || "viw02s4M43uES",
    headers: VACATION_HEADERS,
    keyFields: ["employee_id", "Дата начала"],
    dateFields: ["Дата начала", "Дата окончания"],
  },
  settings: {
    name: "Настройки",
    datasheetId: process.env.TABS_SETTINGS_DATASHEET_ID || "dstS9sVx6XlxNASvuh",
    viewId: process.env.TABS_SETTINGS_VIEW_ID || "viwk5Dl3c7RoE",
    headers: SETTINGS_HEADERS,
    keyFields: ["ЮЦ", "Тип дела"],
    dateFields: [],
    numberFields: ["Активность, дни", "Автозавершение, дни", "Максимальный долг", "Порог перегруза"],
  },
  yucSettings: {
    name: "Настройки ЮЦ",
    datasheetId: process.env.TABS_YUC_SETTINGS_DATASHEET_ID || "dstGXdrV1Mb3Rkc57E",
    viewId: process.env.TABS_YUC_SETTINGS_VIEW_ID || "viwzMFn8hWD2U",
    headers: YUC_SETTINGS_HEADERS,
    keyFields: ["ЮЦ"],
    dateFields: [],
    numberFields: [],
    readOnlyFields: ["Название"],
  },
  regionalAssignments: {
    name: "Региональные закрепления",
    datasheetId: process.env.TABS_REGIONAL_ASSIGNMENTS_DATASHEET_ID || "dstPFbxwoPH7YfCRAz",
    viewId: process.env.TABS_REGIONAL_ASSIGNMENTS_VIEW_ID || "viwrYdxBbj4UD",
    headers: REGIONAL_ASSIGNMENT_HEADERS,
    keyFields: ["ЮЦ", "Регион", "Сотрудник", "Тип нагрузки"],
    dateFields: [],
    readOnlyFields: ["Название"],
  },
  regionalSubstitutions: {
    name: "Региональные замещения",
    datasheetId: process.env.TABS_REGIONAL_SUBSTITUTIONS_DATASHEET_ID || "dstZng9NVviKd5PhnZ",
    viewId: process.env.TABS_REGIONAL_SUBSTITUTIONS_VIEW_ID || "viwMkyAsobxjs",
    headers: REGIONAL_SUBSTITUTION_HEADERS,
    keyFields: ["ЮЦ", "Регион", "Основной сотрудник", "Замещающий сотрудник", "Тип нагрузки"],
    dateFields: [],
    readOnlyFields: ["Название"],
  },
  loadCoefficients: {
    name: "Коэффициенты нагрузки",
    datasheetId: process.env.TABS_LOAD_COEFFICIENTS_DATASHEET_ID || "dstMwyNHdQBXtX4hzP",
    viewId: process.env.TABS_LOAD_COEFFICIENTS_VIEW_ID || "viwj6WawdPEJM",
    headers: LOAD_COEFFICIENT_HEADERS,
    keyFields: ["Тип нагрузки"],
    numberFields: ["Коэффициент"],
    readOnlyFields: ["Название"],
  },
};

const TABLE_KEYS = Object.keys(TABLES);

export function storagePath() {
  return "MTS Tabs API";
}

export function tabsStorageStatus() {
  return {
    mode: "tabs",
    apiBase: API_BASE,
    tokenConfigured: Boolean(TOKEN),
    tables: Object.fromEntries(Object.entries(TABLES).map(([key, table]) => [
      key,
      {
        name: table.name,
        datasheetId: table.datasheetId,
        viewId: table.viewId,
      },
    ])),
  };
}

function requireToken() {
  if (!TOKEN) {
    throw new Error("Не задан TABS_API_TOKEN. Для API-версии приложения токен обязателен.");
  }
}

function tableUrl(table, extra = {}) {
  const url = new URL(`${API_BASE}/datasheets/${table.datasheetId}/records`);
  if (table.viewId && !table.readAllFields) url.searchParams.set("viewId", table.viewId);
  url.searchParams.set("fieldKey", tableFieldKey(table));
  for (const [key, value] of Object.entries(extra)) {
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, item));
    } else if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function request(table, method, body = null, extra = {}) {
  requireToken();
  const url = tableUrl(table, extra);
  const { response, text } = await fetchText(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${method} ${table.name}: API вернул не JSON (${response.status}): ${text.slice(0, 500)}`);
  }
  if (!response.ok || payload.success === false || (payload.code && ![200, 201].includes(payload.code))) {
    throw new Error(`${method} ${table.name}: ${response.status}; ${payload.message || text}`);
  }
  return payload;
}

async function deleteRecords(table, recordIds) {
  if (!recordIds.length) return;
  requireToken();
  for (const chunk of chunks(recordIds, 10)) {
    const url = new URL(`${API_BASE}/datasheets/${table.datasheetId}/records`);
    chunk.forEach((recordId) => url.searchParams.append("recordIds", recordId));
    const { response, text } = await fetchText(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok || payload.success === false || (payload.code && payload.code !== 200)) {
      throw new Error(`DELETE ${table.name}: ${response.status}; ${payload.message || text}`);
    }
  }
}

async function fetchText(url, options = {}) {
  try {
    const method = String(options.method || "GET").toUpperCase();
    return await fetchTextWithRetry(url, options, {
      retries: REQUEST_RETRIES,
      timeoutMs: REQUEST_TIMEOUT_MS,
      retryable: ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"].includes(method),
    });
  } catch (error) {
    const unknownWriteResult = Boolean(error?.resultUnknown);
    const wrapped = new Error(
      unknownWriteResult
        ? `${formatNetworkError(url, error)} Результат операции требует проверки.`
        : formatNetworkError(url, error),
      { cause: error },
    );
    if (unknownWriteResult) {
      wrapped.status = 502;
      wrapped.code = "WRITE_RESULT_UNKNOWN";
      wrapped.resultUnknown = true;
      wrapped.details = { method: error.method || options.method || "POST" };
    }
    throw wrapped;
  }
}

async function fetchWithRetry(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= REQUEST_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } catch (error) {
      lastError = error;
      if (attempt >= REQUEST_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(formatNetworkError(url, lastError));
}

function formatNetworkError(url, error) {
  const host = url instanceof URL ? url.host : new URL(String(url)).host;
  const cause = error?.cause;
  const code = cause?.code || error?.code || "";
  if (code === "UND_ERR_CONNECT_TIMEOUT" || error?.name === "AbortError") {
    return `Не удалось подключиться к ${host}: истёк таймаут ${REQUEST_TIMEOUT_MS} мс. Проверьте VPN/корпоративную сеть или повторите позже.`;
  }
  return `Не удалось подключиться к ${host}: ${cause?.message || error?.message || "сетевая ошибка"}.`;
}

function defineRecordMeta(row, recordId) {
  Object.defineProperty(row, "_recordId", {
    value: recordId,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return row;
}

function fromTabsDate(value, withTime = false) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value + MOSCOW_OFFSET_MS);
    const iso = date.toISOString();
    if (!withTime) return iso.slice(0, 10);
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return fromTabsDate(Number(value), withTime);
  }
  return cleanText(value);
}

function toTabsDate(value, withTime = false) {
  const text = cleanText(value);
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, y, m, d] = dateOnly.map(Number);
    return Date.UTC(y, m - 1, d) - MOSCOW_OFFSET_MS;
  }
  const dateTime = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (dateTime) {
    const [, y, m, d, hh, mm, ss = "0"] = dateTime;
    return Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)) - MOSCOW_OFFSET_MS;
  }
  const parsed = new Date(withTime ? text : `${text}T00:00:00+03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function fromTabsUrl(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "object") {
    return cleanText(value.text ?? value.url ?? value.title ?? "");
  }
  return cleanText(value);
}

function toTabsUrl(value) {
  const text = cleanText(value);
  if (!text) return null;
  return {
    title: "CasePRO",
    text,
    favicon: "",
  };
}

function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({ ...item }));
}

function normalizeFromTabs(table, fields = {}) {
  const dateSet = new Set(table.dateFields);
  const attachmentSet = new Set(table.attachmentFields ?? []);
  const row = {};
  for (const header of table.headers) {
    const value = inboundFieldValue(table, fields, header);
    if (table.name === "Дела" && header === "Ссылка") {
      row[header] = fromTabsUrl(value);
    } else if (attachmentSet.has(header)) {
      row[header] = normalizeAttachments(value);
    } else {
      row[header] = dateSet.has(header)
        ? fromTabsDate(value, header === "Дата события")
        : value ?? "";
    }
  }
  return row;
}

function normalizeToTabs(table, row = {}) {
  const dateSet = new Set(table.dateFields);
  const numberSet = new Set(table.numberFields ?? []);
  const attachmentSet = new Set(table.attachmentFields ?? []);
  const readOnlySet = new Set(table.readOnlyFields ?? []);
  const fields = {};
  for (const header of table.headers) {
    if (readOnlySet.has(header)) continue;
    const value = row[header];
    if (table.name === "Дела" && header === "Ссылка") {
      fields[outboundFieldName(table, header)] = toTabsUrl(value);
    } else if (attachmentSet.has(header)) {
      fields[outboundFieldName(table, header)] = normalizeAttachments(value);
    } else {
      fields[outboundFieldName(table, header)] = dateSet.has(header)
        ? toTabsDate(value, header === "Дата события")
        : numberSet.has(header)
          ? (value === "" || value === null || value === undefined ? null : Number(value))
          : (value === null || value === undefined ? "" : String(value));
    }
  }
  return fields;
}

function rowKey(table, row) {
  if (!table.keyFields.length) return "";
  return table.keyFields.map((field) => cleanText(row?.[field])).join("::");
}

function normalizeTableKeys(keys = TABLE_KEYS) {
  const requested = Array.isArray(keys) ? keys : [keys];
  const unique = [...new Set(requested.filter(Boolean))];
  for (const key of unique) {
    if (!TABLES[key]) throw new Error(`Неизвестная таблица: ${key}`);
  }
  return unique.length ? unique : TABLE_KEYS;
}

async function readTable(table, { fields = null, pageSize = PAGE_SIZE } = {}) {
  const rows = [];
  let pageNum = 1;
  let total = 0;
  do {
    const payload = await request(table, "GET", null, {
      pageNum,
      pageSize,
      ...(fields?.length ? { "fields[]": fields } : {}),
    });
    const pageRows = payload?.data?.records ?? [];
    total = Number(payload?.data?.total ?? pageRows.length);
    for (const record of pageRows) {
      rows.push(defineRecordMeta(normalizeFromTabs(table, record.fields), record.recordId));
    }
    pageNum += 1;
  } while (rows.length < total);
  return rows;
}

async function createRows(table, rows) {
  for (const chunk of chunks(rows, 1000)) {
    let pendingRows = chunk;
    for (let dispatch = 0; dispatch < 2 && pendingRows.length; dispatch += 1) {
      try {
        await request(table, "POST", {
          records: pendingRows.map((row) => ({ fields: normalizeToTabs(table, row) })),
          fieldKey: tableFieldKey(table),
        });
        pendingRows = [];
      } catch (error) {
        if (!error?.resultUnknown) throw error;
        let currentRows;
        try {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            if (attempt) await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
            currentRows = await readTable(table);
            const existingKeys = new Set(currentRows.map((row) => rowKey(table, row)));
            pendingRows = pendingRows.filter((row) => !existingKeys.has(rowKey(table, row)));
            if (!pendingRows.length) break;
          }
        } catch {
          throw error;
        }
        if (pendingRows.length && dispatch >= 1) throw error;
      }
    }
  }
}

export async function createTableRows(key, rows = []) {
  const table = TABLES[key];
  if (!table) throw new Error(`Неизвестная таблица: ${key}`);
  await createRows(table, rows);
  return rows;
}

async function updateRows(table, updates) {
  for (const chunk of chunks(updates, 10)) {
    await request(table, "PATCH", {
      records: chunk.map(({ recordId, row }) => ({
        recordId,
        fields: normalizeToTabs(table, row),
      })),
      fieldKey: tableFieldKey(table),
    });
  }
}

export async function patchTableRows(key, updates = []) {
  const table = TABLES[key];
  if (!table) throw new Error(`Неизвестная таблица: ${key}`);
  const records = updates.map(({ row, changedFields = [] }) => {
    if (!row?._recordId) throw new Error(`Для адресного обновления «${table.name}» не найден recordId.`);
    const allowed = new Set(changedFields.map((field) => outboundFieldName(table, field)));
    const fields = Object.fromEntries(Object.entries(normalizeToTabs(table, row)).filter(([field]) => allowed.has(field)));
    return { recordId: row._recordId, fields };
  }).filter((record) => Object.keys(record.fields).length);
  for (const chunk of chunks(records, 10)) {
    await request(table, "PATCH", { records: chunk, fieldKey: tableFieldKey(table) });
  }
  return updates.map(({ row }) => row);
}

export async function patchTableRow(key, row, changedFields = []) {
  await patchTableRows(key, [{ row, changedFields }]);
  return row;
}

function attachmentFingerprint(attachment = {}) {
  return cleanText(attachment.token || attachment.url)
    || [cleanText(attachment.name), Number(attachment.size) || 0, cleanText(attachment.mimeType)].join("::");
}

function sameAttachments(left = [], right = []) {
  const a = normalizeAttachments(left).map(attachmentFingerprint);
  const b = normalizeAttachments(right).map(attachmentFingerprint);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * MTS Tabs does not remove one attachment when an attachment array is shortened.
 * It also rejects null inside the array. A selective replacement therefore has
 * to clear the whole cell first and then bind the retained attachment tokens.
 */
export async function replaceTableAttachments(key, row, field, attachments = []) {
  const table = TABLES[key];
  if (!table) throw new Error(`Неизвестная таблица: ${key}`);
  if (!(table.attachmentFields ?? []).includes(field)) {
    throw new Error(`Поле «${field}» не является полем вложений таблицы «${table.name}».`);
  }
  if (!row?._recordId) throw new Error(`Для изменения вложений «${table.name}» не найден recordId.`);

  const original = normalizeAttachments(row[field]);
  const desired = normalizeAttachments(attachments);
  const outboundField = outboundFieldName(table, field);
  const writeValue = async (value) => request(table, "PATCH", {
    records: [{ recordId: row._recordId, fields: { [outboundField]: value } }],
    fieldKey: tableFieldKey(table),
  });
  const readConfirmed = async () => {
    const rows = await readTable(table);
    return rows.find((item) => item._recordId === row._recordId) ?? null;
  };
  const restoreOriginal = async () => {
    await writeValue(null);
    if (original.length) await writeValue(original);
    return readConfirmed();
  };

  try {
    await writeValue(null);
    if (desired.length) await writeValue(desired);
    const confirmed = await readConfirmed();
    if (confirmed && sameAttachments(confirmed[field], desired)) return confirmed;
    const restored = await restoreOriginal();
    const error = new Error("MTS Tabs не подтвердил новый состав вложений. Исходный список восстановлен.");
    error.status = 502;
    error.code = "ATTACHMENTS_NOT_CONFIRMED";
    error.restored = Boolean(restored && sameAttachments(restored[field], original));
    throw error;
  } catch (error) {
    if (error?.code === "ATTACHMENTS_NOT_CONFIRMED") throw error;
    let current = null;
    try { current = await readConfirmed(); } catch {}
    if (current && sameAttachments(current[field], desired)) return current;
    let restored = false;
    try {
      const restoredRow = current && sameAttachments(current[field], original)
        ? current
        : await restoreOriginal();
      restored = Boolean(restoredRow && sameAttachments(restoredRow[field], original));
    } catch {}
    const wrapped = new Error(restored
      ? `Не удалось изменить состав вложений. Исходный список восстановлен. ${error.message}`
      : `Результат изменения вложений требует проверки. ${error.message}`,
    { cause: error });
    wrapped.status = 502;
    wrapped.code = restored ? "ATTACHMENTS_RESTORED" : "WRITE_RESULT_UNKNOWN";
    wrapped.resultUnknown = !restored;
    throw wrapped;
  }
}

function comparableFields(table, row) {
  return JSON.stringify(normalizeToTabs(table, row));
}

async function syncTable(key, desiredRows = [], knownCurrentRows = null) {
  const table = TABLES[key];
  const creates = [];
  const updates = [];

  if (table.appendOnly) {
    const existingRows = desiredRows.filter((row) => row._recordId);
    creates.push(...desiredRows.filter((row) => !row._recordId));
    if (existingRows.length) {
      const currentRows = Array.isArray(knownCurrentRows) ? knownCurrentRows : await readTable(table);
      const currentByRecordId = new Map(currentRows.map((row) => [row._recordId, row]));
      for (const row of existingRows) {
        const current = currentByRecordId.get(row._recordId);
        if (!current) {
          creates.push(row);
          continue;
        }
        if (comparableFields(table, current) !== comparableFields(table, row)) {
          updates.push({ recordId: row._recordId, row });
        }
      }
    }
    await updateRows(table, updates);
    await createRows(table, creates);
    return;
  }

  const currentRows = Array.isArray(knownCurrentRows) ? knownCurrentRows : await readTable(table);
  const currentByKey = new Map(currentRows.map((row) => [rowKey(table, row), row]));
  const desiredKeys = new Set();
  for (const row of desiredRows) {
    const keyValue = rowKey(table, row);
    if (!keyValue || keyValue.includes("::") && keyValue.split("::").some((part) => !part)) continue;
    desiredKeys.add(keyValue);
    const current = row._recordId
      ? currentRows.find((item) => item._recordId === row._recordId)
      : currentByKey.get(keyValue);
    if (!current) {
      creates.push(row);
    } else if (comparableFields(table, current) !== comparableFields(table, row)) {
      updates.push({ recordId: current._recordId, row });
    }
  }

  const deleteIds = currentRows
    .filter((row) => !desiredKeys.has(rowKey(table, row)))
    .map((row) => row._recordId)
    .filter(Boolean);

  await updateRows(table, updates);
  await createRows(table, creates);
  await deleteRecords(table, deleteIds);
}

export async function upsertTableRows(key, desiredRows = []) {
  const table = TABLES[key];
  if (!table) throw new Error(`Неизвестная таблица: ${key}`);
  if (!table.keyFields.length) throw new Error(`Для таблицы ${table.name} не настроены ключевые поля.`);
  const currentRows = await readTable(table);
  const currentByKey = new Map(currentRows.map((row) => [rowKey(table, row), row]));
  const creates = [];
  const updates = [];

  for (const row of desiredRows) {
    const keyValue = rowKey(table, row);
    if (!keyValue || keyValue.includes("::") && keyValue.split("::").some((part) => !part)) continue;
    const current = row._recordId
      ? currentRows.find((item) => item._recordId === row._recordId)
      : currentByKey.get(keyValue);
    if (!current) {
      creates.push(row);
    } else if (comparableFields(table, current) !== comparableFields(table, row)) {
      updates.push({ recordId: current._recordId, row });
    }
  }

  await updateRows(table, updates);
  await createRows(table, creates);
  return { created: creates.length, updated: updates.length };
}

function chunks(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

function attachmentEndpoint(table) {
  return new URL(`${API_BASE}/datasheets/${table.datasheetId}/attachments`);
}

function attachmentDownloadUrl(table, attachment = {}) {
  const token = cleanText(attachment.token);
  if (!token) throw new Error("У вложения отсутствует токен для скачивания.");
  const url = new URL(`${API_BASE}/datasheets/${table.datasheetId}/attachments`);
  url.searchParams.set("token", token);
  return url;
}

function attachmentFromUploadPayload(payload = {}) {
  const data = payload?.data;
  const candidates = [
    Array.isArray(data) ? data[0] : null,
    data?.attachment,
    Array.isArray(data?.attachments) ? data.attachments[0] : null,
    data,
  ];
  const attachment = candidates.find((item) => item && typeof item === "object" && !Array.isArray(item));
  if (!attachment || !cleanText(attachment.name || attachment.token || attachment.url || attachment.id)) {
    throw new Error("MTS Tabs не вернул данные загруженного вложения.");
  }
  return { ...attachment };
}

export async function uploadAttachment(tableKey, { buffer, name, mimeType = "application/octet-stream" } = {}) {
  const table = TABLES[tableKey];
  if (!table) throw new Error(`Неизвестная таблица: ${tableKey}`);
  requireToken();
  if (!buffer?.length) throw new Error("Нельзя загрузить пустой файл.");
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), name || "document");
  const { response, text } = await fetchText(attachmentEndpoint(table), {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: form,
  });
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`POST вложения «${table.name}»: API вернул не JSON (${response.status}).`);
  }
  if (!response.ok || payload.success === false || (payload.code && ![200, 201].includes(payload.code))) {
    throw new Error(`Не удалось загрузить вложение: ${payload.message || text || response.status}.`);
  }
  return attachmentFromUploadPayload(payload);
}

export async function downloadAttachment(tableKey, attachment) {
  const table = TABLES[tableKey];
  if (!table) throw new Error(`Неизвестная таблица: ${tableKey}`);
  requireToken();
  const response = await fetchWithRetry(attachmentDownloadUrl(table, attachment), {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Не удалось скачать вложение: ${response.status}; ${text.slice(0, 300)}`);
  }
  return response;
}

export async function readData(keys = TABLE_KEYS) {
  const tableKeys = normalizeTableKeys(keys);
  const entries = await Promise.all(tableKeys.map(async (key) => [key, await readTable(TABLES[key])]));
  return Object.fromEntries(entries);
}

export async function readDashboardCases() {
  const table = {
    ...TABLES.cases,
    viewId: "",
    headers: DASHBOARD_CASE_HEADERS,
  };
  const fields = DASHBOARD_CASE_HEADERS.map((header) => outboundFieldName(table, header));
  return readTable(table, { fields, pageSize: DASHBOARD_PAGE_SIZE });
}

export async function readOperationalCases() {
  const baseTable = {
    ...TABLES.cases,
    viewId: "",
    headers: DASHBOARD_CASE_HEADERS,
  };
  const detailTable = {
    ...TABLES.cases,
    viewId: "",
    headers: OPERATIONAL_CASE_DETAIL_HEADERS,
  };
  const [baseRows, detailRows] = await Promise.all([
    readTable(baseTable, {
      fields: DASHBOARD_CASE_HEADERS.map((header) => outboundFieldName(baseTable, header)),
      pageSize: DASHBOARD_PAGE_SIZE,
    }),
    readTable(detailTable, {
      fields: OPERATIONAL_CASE_DETAIL_HEADERS.map((header) => outboundFieldName(detailTable, header)),
      pageSize: DASHBOARD_PAGE_SIZE,
    }),
  ]);
  const detailsByRecordId = new Map(detailRows.map((row) => [row._recordId, row]));
  return baseRows.map((row) => defineRecordMeta({ ...row, ...(detailsByRecordId.get(row._recordId) ?? {}) }, row._recordId));
}

export async function saveData(data, keys = TABLE_KEYS, { currentData = null } = {}) {
  for (const key of normalizeTableKeys(keys)) {
    await syncTable(key, data[key] ?? [], currentData?.[key] ?? null);
  }
}
