import {
  CASE_HEADERS,
  EMPLOYEE_HEADERS,
  JOURNAL_HEADERS,
  QUEUE_HEADERS,
  REGIONAL_ASSIGNMENT_HEADERS,
  SETTINGS_HEADERS,
  STATE_HEADERS,
  VACATION_HEADERS,
  YUC_SETTINGS_HEADERS,
  cleanText,
} from "./domain.mjs";

const API_BASE = process.env.TABS_API_BASE || "https://tabs.mts.ru/fusion/v1";
const TOKEN = process.env.TABS_API_TOKEN;
const FIELD_KEY = "name";
const PAGE_SIZE = Number(process.env.TABS_PAGE_SIZE || 1000);
const REQUEST_TIMEOUT_MS = Number(process.env.TABS_REQUEST_TIMEOUT_MS || 30000);
const REQUEST_RETRIES = Number(process.env.TABS_REQUEST_RETRIES || 3);
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

const TABLES = {
  cases: {
    name: "Дела",
    datasheetId: process.env.TABS_CASES_DATASHEET_ID || "dstD5wqizSVQS89kL7",
    viewId: process.env.TABS_CASES_VIEW_ID || "viwBynFRDSNva",
    headers: CASE_HEADERS,
    keyFields: ["case_id"],
    dateFields: ["Дата поступления", "Дата завершения", "Отложить завершение до", "Дата предупреждения о завершении", "Дата распределения"],
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
  journal: {
    name: "Журнал",
    datasheetId: process.env.TABS_JOURNAL_DATASHEET_ID || "dstpntgUBUkCe8Jvv9",
    viewId: process.env.TABS_JOURNAL_VIEW_ID || "viwuyr7QieusY",
    headers: JOURNAL_HEADERS,
    keyFields: [],
    dateFields: ["Дата события"],
    appendOnly: true,
  },
  settings: {
    name: "Настройки",
    datasheetId: process.env.TABS_SETTINGS_DATASHEET_ID || "dstS9sVx6XlxNASvuh",
    viewId: process.env.TABS_SETTINGS_VIEW_ID || "viwk5Dl3c7RoE",
    headers: SETTINGS_HEADERS,
    keyFields: ["ЮЦ", "Тип дела"],
    dateFields: [],
    numberFields: ["Активность, дни", "Автозавершение, дни", "Максимальный долг"],
  },
  yucSettings: {
    name: "Настройки ЮЦ",
    datasheetId: process.env.TABS_YUC_SETTINGS_DATASHEET_ID || "dstGXdrV1Mb3Rkc57E",
    viewId: process.env.TABS_YUC_SETTINGS_VIEW_ID || "viwzMFn8hWD2U",
    headers: YUC_SETTINGS_HEADERS,
    keyFields: ["ЮЦ"],
    dateFields: [],
    numberFields: ["Порог перегруза"],
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
  if (table.viewId) url.searchParams.set("viewId", table.viewId);
  url.searchParams.set("fieldKey", FIELD_KEY);
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
  const response = await fetchWithRetry(tableUrl(table, extra), {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
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
    const response = await fetchWithRetry(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok || payload.success === false || (payload.code && payload.code !== 200)) {
      throw new Error(`DELETE ${table.name}: ${response.status}; ${payload.message || text}`);
    }
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

function normalizeFromTabs(table, fields = {}) {
  const dateSet = new Set(table.dateFields);
  const row = {};
  for (const header of table.headers) {
    const value = fields[header];
    if (table.name === "Дела" && header === "Ссылка") {
      row[header] = fromTabsUrl(value);
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
  const readOnlySet = new Set(table.readOnlyFields ?? []);
  const fields = {};
  for (const header of table.headers) {
    if (readOnlySet.has(header)) continue;
    const value = row[header];
    if (table.name === "Дела" && header === "Ссылка") {
      fields[header] = toTabsUrl(value);
    } else {
      fields[header] = dateSet.has(header)
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

async function readTable(table) {
  const rows = [];
  let pageNum = 1;
  let total = 0;
  do {
    const payload = await request(table, "GET", null, { pageNum, pageSize: PAGE_SIZE });
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
    await request(table, "POST", {
      records: chunk.map((row) => ({ fields: normalizeToTabs(table, row) })),
      fieldKey: FIELD_KEY,
    });
  }
}

async function updateRows(table, updates) {
  for (const chunk of chunks(updates, 10)) {
    await request(table, "PATCH", {
      records: chunk.map(({ recordId, row }) => ({
        recordId,
        fields: normalizeToTabs(table, row),
      })),
      fieldKey: FIELD_KEY,
    });
  }
}

function comparableFields(table, row) {
  return JSON.stringify(normalizeToTabs(table, row));
}

async function syncTable(key, desiredRows = []) {
  const table = TABLES[key];
  const creates = [];
  const updates = [];

  if (table.appendOnly) {
    const existingRows = desiredRows.filter((row) => row._recordId);
    creates.push(...desiredRows.filter((row) => !row._recordId));
    if (existingRows.length) {
      const currentRows = await readTable(table);
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

  const currentRows = await readTable(table);
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

export async function readData(keys = TABLE_KEYS) {
  const tableKeys = normalizeTableKeys(keys);
  const entries = await Promise.all(tableKeys.map(async (key) => [key, await readTable(TABLES[key])]));
  return Object.fromEntries(entries);
}

export async function saveData(data, keys = TABLE_KEYS) {
  for (const key of normalizeTableKeys(keys)) {
    await syncTable(key, data[key] ?? []);
  }
}
