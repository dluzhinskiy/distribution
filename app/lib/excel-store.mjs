import fs from "node:fs/promises";
import XLSX from "xlsx";
import {
  CASE_HEADERS,
  EMPLOYEE_HEADERS,
  JOURNAL_HEADERS,
  QUEUE_HEADERS,
  SETTINGS_HEADERS,
  SHEETS,
  STATE_HEADERS,
  STORAGE_FILE,
  VACATION_HEADERS,
  cleanText,
  toISODate,
} from "./domain.mjs";

const HEADER_BY_KEY = {
  cases: CASE_HEADERS,
  employees: EMPLOYEE_HEADERS,
  queues: QUEUE_HEADERS,
  state: STATE_HEADERS,
  vacations: VACATION_HEADERS,
  journal: JOURNAL_HEADERS,
  settings: SETTINGS_HEADERS,
};

const SHEET_BY_KEY = {
  cases: SHEETS.cases,
  employees: SHEETS.employees,
  queues: SHEETS.queues,
  state: SHEETS.state,
  vacations: SHEETS.vacations,
  journal: SHEETS.journal,
  settings: SHEETS.settings,
};

export function storagePath() {
  return decodeURIComponent(STORAGE_FILE.pathname);
}

function isEmpty(value) {
  return value === null || value === undefined || cleanText(value) === "";
}

function normalizeValue(value) {
  if (value instanceof Date) return toISODate(value);
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return "";
  return value;
}

function rowToObject(headers, row) {
  const object = {};
  headers.forEach((header, index) => {
    object[header] = normalizeValue(row[index]);
  });
  return object;
}

function objectToRow(headers, object) {
  return headers.map((header) => normalizeValue(object?.[header]));
}

function readSheet(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const values = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  });
  if (!values.length) return [];
  const headers = values[0].map((item) => cleanText(item));
  return values
    .slice(1)
    .filter((row) => row.some((cell) => !isEmpty(cell)))
    .map((row) => rowToObject(headers, row));
}

export async function readData(filePath = storagePath()) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  return {
    cases: readSheet(workbook, SHEETS.cases),
    employees: readSheet(workbook, SHEETS.employees),
    queues: readSheet(workbook, SHEETS.queues),
    state: readSheet(workbook, SHEETS.state),
    vacations: readSheet(workbook, SHEETS.vacations),
    journal: readSheet(workbook, SHEETS.journal),
    settings: readSheet(workbook, SHEETS.settings),
  };
}

function writeSheet(workbook, key, rows) {
  const sheetName = SHEET_BY_KEY[key];
  const headers = HEADER_BY_KEY[key];
  const matrix = [headers, ...rows.map((row) => objectToRow(headers, row))];
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  sheet["!cols"] = headers.map((header) => ({
    wch: Math.min(Math.max(cleanText(header).length + 4, 12), 42),
  }));
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
}

export async function saveData(data, filePath = storagePath()) {
  const workbook = XLSX.utils.book_new();
  for (const key of ["cases", "employees", "queues", "state", "vacations", "journal", "settings"]) {
    writeSheet(workbook, key, data[key] ?? []);
  }
  await fs.mkdir(new URL("../data/", import.meta.url), { recursive: true });
  XLSX.writeFile(workbook, filePath, { bookType: "xlsx" });
}
