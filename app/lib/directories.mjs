import { cleanText, normalizeYuc } from "./domain.mjs";
import { normalizeRegionName } from "./regions.mjs";

const API_BASE = process.env.TABS_API_BASE || "https://tabs.mts.ru/fusion/v1";
const TOKEN = process.env.TABS_API_TOKEN;
const FIELD_KEY = "name";
const PAGE_SIZE = Number(process.env.TABS_PAGE_SIZE || 1000);
const REQUEST_TIMEOUT_MS = Number(process.env.TABS_REQUEST_TIMEOUT_MS || 30000);
const REQUEST_RETRIES = Number(process.env.TABS_REQUEST_RETRIES || 3);

const DIRECTORY_TABLE = {
  name: "Справочник регионов",
  datasheetId: process.env.TABS_DIRECTORIES_DATASHEET_ID || "dstUTQd5tp5sCU7mLv",
  viewId: process.env.TABS_DIRECTORIES_VIEW_ID || "viwV8x7vx4jzL",
};

export function directoriesPath() {
  return `MTS Tabs API: ${DIRECTORY_TABLE.name}`;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
}

function requireToken() {
  if (!TOKEN) {
    throw new Error("Не задан TABS_API_TOKEN. Справочник регионов читается из MTS Tabs.");
  }
}

function tableUrl(extra = {}) {
  const url = new URL(`${API_BASE}/datasheets/${DIRECTORY_TABLE.datasheetId}/records`);
  url.searchParams.set("viewId", DIRECTORY_TABLE.viewId);
  url.searchParams.set("fieldKey", FIELD_KEY);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
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
  throw lastError;
}

async function requestDirectoriesPage(pageNum) {
  requireToken();
  const response = await fetchWithRetry(tableUrl({ pageNum, pageSize: PAGE_SIZE }), {
    method: "GET",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`GET ${DIRECTORY_TABLE.name}: API вернул не JSON (${response.status}): ${text.slice(0, 500)}`);
  }
  if (!response.ok || payload.success === false || (payload.code && payload.code !== 200)) {
    throw new Error(`GET ${DIRECTORY_TABLE.name}: ${response.status}; ${payload.message || text}`);
  }
  return payload;
}

async function readDirectoryRecords() {
  const rows = [];
  let pageNum = 1;
  let total = 0;
  do {
    const payload = await requestDirectoriesPage(pageNum);
    const pageRows = payload?.data?.records ?? [];
    total = Number(payload?.data?.total ?? pageRows.length);
    rows.push(...pageRows.map((record) => record.fields ?? {}));
    pageNum += 1;
  } while (rows.length < total);
  return rows;
}

function normalizeDirectoryYuc(value) {
  const text = cleanText(value).replace(/^ЮЦ\s+/i, "");
  return normalizeYuc(text);
}

async function readRemoteDirectories() {
  const rows = await readDirectoryRecords();
  const pairs = rows
    .map((row) => ({
      yuc: normalizeDirectoryYuc(row["Опции"]),
      region: normalizeRegionName(row["Название"]),
    }))
    .filter((item) => item.yuc && item.region);
  if (!pairs.length) {
    throw new Error("Удалённый справочник регионов пуст или не содержит поля «Название»/«Опции».");
  }
  const yucs = uniqueSorted(pairs.map((item) => item.yuc));
  const regionsByYuc = Object.fromEntries(yucs.map((yuc) => [
    yuc,
    uniqueSorted(pairs.filter((item) => item.yuc === yuc).map((item) => item.region)),
  ]));
  return {
    yucs,
    regionsByYuc,
    source: `${directoriesPath()} (${DIRECTORY_TABLE.datasheetId})`,
  };
}

export async function readDirectories() {
  return readRemoteDirectories();
}
