import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import XLSX from "xlsx";
import {
  CASE_TYPES,
  DEFAULT_RELEVANCE_DAYS,
  cleanText,
  makeQueueId,
  normalizeType,
  normalizeYuc,
  toISODate,
} from "../lib/domain.mjs";
import { normalizeRegionName } from "../lib/regions.mjs";
import { saveData, storagePath } from "../lib/excel-store.mjs";

const ROOT = new URL("../../", import.meta.url);
const MVP_SOURCE = new URL("../../outputs/mvp_raspredelenie_nagruzki/Система_распределения_нагрузки_MVP.xlsx", import.meta.url);
const ORIGINAL_SOURCE = new URL("../../Судебная_нагрузка_ДВ_новый.xlsm", import.meta.url);

async function exists(url) {
  try {
    await fs.access(url);
    return true;
  } catch {
    return false;
  }
}

async function loadWorkbook() {
  const source = process.env.SOURCE_FILE
    ? pathToFileURL(path.resolve(process.env.SOURCE_FILE))
    : (await exists(MVP_SOURCE)) ? MVP_SOURCE : ORIGINAL_SOURCE;
  const filePath = decodeURIComponent(source.pathname);
  return {
    workbook: XLSX.readFile(filePath, { cellDates: true }),
    source: filePath.replace(decodeURIComponent(ROOT.pathname), ""),
  };
}

function sheetValues(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Лист не найден: ${sheetName}`);
  }
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  });
}

function rowsByHeader(values, requiredHeader) {
  const headerIndex = values.findIndex((row) => row.some((cell) => cleanText(cell) === requiredHeader));
  if (headerIndex < 0) {
    throw new Error(`Не найдена строка заголовков: ${requiredHeader}`);
  }
  const headers = values[headerIndex].map((item) => cleanText(item));
  return values
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cleanText(cell) !== ""))
    .map((row) => {
      const object = {};
      headers.forEach((header, index) => {
        object[header] = row[index] ?? "";
      });
      return object;
    });
}

function seq(n, width = 4) {
  return String(n).padStart(width, "0");
}

function caseFromMvp(row, index) {
  return {
    case_id: cleanText(row.case_id) || `CASE-${seq(index + 1)}`,
    "Номер дела": cleanText(row["Номер дела"]),
    "Предмет": cleanText(row["Предмет"]),
    "ЮЦ": normalizeYuc(row["ЮЦ"]),
    "Регион": normalizeRegionName(row["Регион"]),
    "Истец": cleanText(row["Истец / заявитель / кредитор"]),
    "Ответчик": cleanText(row["Ответчик / должник"]),
    "Третье лицо": cleanText(row["3-е лицо"]),
    "Тип дела": normalizeType(row["Тип дела"]),
    "Дата поступления": toISODate(row["Дата поступления"]),
    "Статус": cleanText(row["Статус"]) || "В работе",
    "Дата завершения": toISODate(row["Дата завершения"]),
    "Ответственный": cleanText(row["Ответственный"]),
    "Дата распределения": cleanText(row["Дата распределения"]),
    "Основание": cleanText(row["Основание назначения"]) || "Перенос из исходного файла",
    "Распределено системой": cleanText(row["Распределено системой"]) || "Нет",
    "Ручное назначение": cleanText(row["Ручное назначение"]) || "Нет",
    "Комментарий": cleanText(row["Комментарий"]),
    "Ссылка": cleanText(row["Ссылка / источник"]),
  };
}

function caseFromOriginal(row, index) {
  return {
    case_id: `CASE-${seq(index + 1)}`,
    "Номер дела": "",
    "Предмет": cleanText(row["Предмет спора"]),
    "ЮЦ": "Дальний Восток",
    "Регион": normalizeRegionName(row["Регион"]),
    "Истец": cleanText(row["Наименование/ФИО истца, заявителя, кредитора"]),
    "Ответчик": cleanText(row["Наименование/ ФИО ответчика, должника-банкрота"]),
    "Третье лицо": cleanText(row["Наименование/ ФИО 3-го лица"]),
    "Тип дела": normalizeType(row["Судебное/административное/третьи лица"]),
    "Дата поступления": toISODate(row["Дата поступления в работу"]),
    "Статус": "В работе",
    "Дата завершения": "",
    "Ответственный": cleanText(row["Ответственный"]),
    "Дата распределения": "",
    "Основание": "Перенос из исходного файла",
    "Распределено системой": "Нет",
    "Ручное назначение": "Нет",
    "Комментарий": "",
    "Ссылка": "",
  };
}

function normalizeEmployee(row, index) {
  return {
    employee_id: cleanText(row.employee_id) || `EMP-${seq(index + 1, 3)}`,
    "ФИО": cleanText(row["ФИО"] || row["Ответственный"]),
    "ЮЦ": normalizeYuc(row["ЮЦ"]),
    "Активен": cleanText(row["Активен"]) || "Да",
    "Судебные": cleanText(row["Судебные"]) || "Да",
    "Административные": cleanText(row["Административные"]) || "Да",
    "Претензии": cleanText(row["Претензии"]) || "Да",
    "Отпуск с": toISODate(row["Отпуск с"]),
    "Отпуск по": toISODate(row["Отпуск по"]),
    "Комментарий": cleanText(row["Комментарий"]),
  };
}

function makeEmployeesFromCases(cases) {
  return [...new Set(cases.map((item) => cleanText(item["Ответственный"])).filter(Boolean))]
    .map((name, index) => normalizeEmployee({ "ФИО": name }, index));
}

function makeQueues(employees) {
  const rows = [];
  for (const type of CASE_TYPES) {
    employees.forEach((employee, index) => {
      rows.push({
        queue_id: makeQueueId(employee["ЮЦ"], type),
        "ЮЦ": employee["ЮЦ"],
        "Тип дела": type,
        "Позиция": index + 1,
        employee_id: employee.employee_id,
        "ФИО": employee["ФИО"],
        "Долг": 0,
        "Дата долга": "",
        "Примечание": "",
      });
    });
  }
  return rows;
}

function makeState() {
  return CASE_TYPES.map((type) => ({
    queue_id: makeQueueId("Дальний Восток", type),
    "ЮЦ": "Дальний Восток",
    "Тип дела": type,
    "Последняя позиция": type === "претензия" ? 1 : 0,
    "Последний автоназначенный": "",
    "Цикл": 1,
    "Дата последнего автоназначения": "",
    "Комментарий": "Начальное состояние после миграции",
  }));
}

const { workbook, source } = await loadWorkbook();
let cases;
let employees;
let queues;
let state;
let vacations;
let journal;

try {
  cases = rowsByHeader(sheetValues(workbook, "Дела"), "case_id")
    .filter((row) => cleanText(row.case_id))
    .map(caseFromMvp);
  employees = rowsByHeader(sheetValues(workbook, "Сотрудники"), "employee_id")
    .filter((row) => cleanText(row["ФИО"]))
    .map(normalizeEmployee);
  queues = makeQueues(employees);
  state = makeState();
  vacations = [];
  journal = cases.map((item) => ({
    "Дата события": "2026-06-23 00:00:00",
    case_id: item.case_id,
    "Тип дела": item["Тип дела"],
    "Ответственный": item["Ответственный"],
    "Основание": "Перенос в хранилище приложения",
    "Способ": "миграция",
    "ЮЦ": item["ЮЦ"],
    "Цикл": "",
    "Предложенный системой": "",
    "Комментарий": `Источник: ${source}`,
  }));
} catch {
  cases = rowsByHeader(sheetValues(workbook, "База_дел"), "Ответственный").map(caseFromOriginal);
  employees = makeEmployeesFromCases(cases);
  queues = makeQueues(employees);
  state = makeState();
  vacations = [];
  journal = cases.map((item) => ({
    "Дата события": "2026-06-23 00:00:00",
    case_id: item.case_id,
    "Тип дела": item["Тип дела"],
    "Ответственный": item["Ответственный"],
    "Основание": "Перенос в хранилище приложения",
    "Способ": "миграция",
    "ЮЦ": item["ЮЦ"],
    "Цикл": "",
    "Предложенный системой": "",
    "Комментарий": `Источник: ${source}`,
  }));
}

const settings = Object.entries(DEFAULT_RELEVANCE_DAYS).map(([type, days]) => ({
  "Тип дела": type,
  "Срок актуальности": days,
}));

await saveData({ cases, employees, queues, state, vacations, journal, settings });
console.log(`Создано хранилище: ${storagePath()}`);
console.log(`Перенесено дел: ${cases.length}; сотрудников: ${employees.length}; очередей: ${queues.length}.`);
