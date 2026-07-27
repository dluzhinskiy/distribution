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

const CASEPRO_BRANCH_FIELD = "Название филиала";
const EXTRA_CASEPRO_BRANCH_ALIASES = new Map([
  ["Москва", [
    'Регион "Москва"',
  ]],
  ["Краснодарский край", [
    'Филиал ПАО "МТС" в Краснодарском крае',
    'Филиал ПАО "МТС" в г. Сочи',
    'Подразделение ПАО "МТС" в г. Новороссийске',
    "Филиал в Краснодарском крае",
    "Филиал в г. Сочи",
    "Подразделение в г. Новороссийске",
  ]],
]);

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

// Нормализуем только оформление. Совпадение возможно лишь с полным
// названием филиала из справочника или с явным алиасом.
export function caseproBranchKey(value) {
  const original = cleanText(value).replaceAll("_", " ");
  // В выгрузке перед филиалом может быть название функционального блока.
  // Для региона значим только хвост, начинающийся с названия филиала.
  const branchStart = original.search(/(?:филиал(?:а)?|подразделение)\s+пао\s*[«"]?мтс/iu);
  const branch = branchStart >= 0
    ? original.slice(branchStart)
    // КЦ в CasePRO передаётся как суффикс после названия блока. Это отдельное
    // точное значение справочника, не эвристика по словам.
    : /(?:^|\s)КЦ\s*$/iu.test(original) ? "КЦ" : original;
  const directoryAlias = /регион\s*[«"]?\s*москва\s*[»"]?/iu.test(branch)
    ? "Регион Москва"
    : branch;
  return directoryAlias
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/^юп\s+/i, "")
    .replace(/филиала/gi, "филиал")
    .replace(/[«»"'`.,()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function branchNames(value) {
  const text = cleanText(value);
  if (!text) return [];
  // В одном поле справочника могут быть указаны несколько филиалов.
  return text
    .split(/(?=(?:Филиал|Подразделение)\s+(?:ПАО|АО)(?:\s|[«"]))/iu)
    .map(cleanText)
    .filter(Boolean);
}

async function readRemoteDirectories() {
  const rows = await readDirectoryRecords();
  const pairs = rows
    .map((row) => ({
      yuc: normalizeDirectoryYuc(row["Опции"]),
      region: normalizeRegionName(row["Название"]),
      branches: branchNames(row[CASEPRO_BRANCH_FIELD]),
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
  const regionsByCaseproBranch = Object.fromEntries(yucs.map((yuc) => [yuc, {}]));
  const regionByCaseproBranch = {};
  const ambiguousBranches = new Set();
  for (const pair of pairs) {
    const aliases = [
      ...pair.branches,
      ...(EXTRA_CASEPRO_BRANCH_ALIASES.get(pair.region) ?? []),
    ];
    for (const alias of aliases) {
      const branch = caseproBranchKey(alias);
      if (!branch) continue;
      const current = regionsByCaseproBranch[pair.yuc][branch];
      // Одинаковый филиал допустим только в строках одного региона.
      if (!current || current === pair.region) {
        regionsByCaseproBranch[pair.yuc][branch] = pair.region;
      } else {
        delete regionsByCaseproBranch[pair.yuc][branch];
      }
      if (ambiguousBranches.has(branch)) continue;
      const globalRegion = regionByCaseproBranch[branch];
      if (!globalRegion || globalRegion === pair.region) {
        regionByCaseproBranch[branch] = pair.region;
      } else {
        delete regionByCaseproBranch[branch];
        ambiguousBranches.add(branch);
      }
    }
  }
  return {
    yucs,
    regionsByYuc,
    regionsByCaseproBranch,
    regionByCaseproBranch,
    source: `${directoriesPath()} (${DIRECTORY_TABLE.datasheetId})`,
  };
}

export async function readDirectories() {
  return readRemoteDirectories();
}
