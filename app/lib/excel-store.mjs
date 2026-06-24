import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";
import {
  CASE_HEADERS,
  EMPLOYEE_HEADERS,
  JOURNAL_HEADERS,
  QUEUE_HEADERS,
  SETTINGS_HEADERS,
  SEED_STORAGE_FILE,
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
  return activeStoragePath ?? requestedStoragePath();
}

export function requestedStoragePath() {
  return decodeURIComponent(STORAGE_FILE.pathname);
}

function seedStoragePath() {
  return decodeURIComponent(SEED_STORAGE_FILE.pathname);
}

let activeStoragePath = null;
let storageWarning = "";

async function canReadWrite(filePath) {
  await fs.access(filePath, fsConstants.R_OK | fsConstants.W_OK);
}

async function copySeedTo(filePath) {
  const source = seedStoragePath();
  if (source === filePath) {
    throw new Error(`Excel-хранилище не найдено: ${filePath}`);
  }
  await canReadWrite(source);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.copyFile(source, filePath);
}

async function ensureStorageFile(filePath = storagePath()) {
  if (activeStoragePath) {
    try {
      await canReadWrite(activeStoragePath);
      return activeStoragePath;
    } catch {
      activeStoragePath = null;
    }
  }

  try {
    await canReadWrite(filePath);
    activeStoragePath = filePath;
    storageWarning = "";
    return activeStoragePath;
  } catch {
    try {
      await copySeedTo(filePath);
      activeStoragePath = filePath;
      storageWarning = "";
      return activeStoragePath;
    } catch (primaryError) {
      const fallbackPath = path.join(os.tmpdir(), "raspredelenie_storage.xlsx");
      try {
        try {
          await canReadWrite(fallbackPath);
        } catch {
          await copySeedTo(fallbackPath);
        }
        activeStoragePath = fallbackPath;
        storageWarning = [
          `Не удалось использовать основное Excel-хранилище: ${filePath}.`,
          `Временно используется: ${fallbackPath}.`,
          "Изменения в таком режиме могут пропасть после перезапуска сервиса.",
          `Причина: ${primaryError.message}`,
        ].join(" ");
        console.warn(storageWarning);
        return activeStoragePath;
      } catch (fallbackError) {
        throw new Error([
          "Excel-хранилище не прочитано.",
          `Основной путь: ${filePath}.`,
          `Стартовый файл: ${seedStoragePath()}.`,
          `Ошибка основного пути: ${primaryError.message}.`,
          `Ошибка временного пути: ${fallbackError.message}.`,
        ].join(" "));
      }
    }
  }
}

export async function storageStatus() {
  const requested = requestedStoragePath();
  const seed = seedStoragePath();
  const status = {
    requestedPath: requested,
    activePath: activeStoragePath,
    seedPath: seed,
    warning: storageWarning,
    env: {
      STORAGE_FILE: process.env.STORAGE_FILE ?? "",
      DATA_DIR: process.env.DATA_DIR ?? "",
      RENDER: process.env.RENDER ?? "",
      RENDER_SERVICE_ID: process.env.RENDER_SERVICE_ID ?? "",
    },
  };
  for (const [key, filePath] of Object.entries({
    requested,
    active: activeStoragePath,
    seed,
  })) {
    if (!filePath) continue;
    try {
      const stat = await fs.stat(filePath);
      status[`${key}Exists`] = true;
      status[`${key}SizeBytes`] = stat.size;
    } catch (error) {
      status[`${key}Exists`] = false;
      status[`${key}Error`] = error.message;
    }
  }
  return status;
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
  const actualPath = await ensureStorageFile(filePath);
  const workbook = XLSX.readFile(actualPath, { cellDates: true });
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
  const actualPath = await ensureStorageFile(filePath);
  const workbook = XLSX.utils.book_new();
  for (const key of ["cases", "employees", "queues", "state", "vacations", "journal", "settings"]) {
    writeSheet(workbook, key, data[key] ?? []);
  }
  await fs.mkdir(path.dirname(actualPath), { recursive: true });
  XLSX.writeFile(workbook, actualPath, { bookType: "xlsx" });
}
