import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeRegionName } from "./regions.mjs";

export const SEED_STORAGE_FILE = new URL("../data/raspredelenie_storage.xlsx", import.meta.url);

function storageFileUrl() {
  if (process.env.STORAGE_FILE) return pathToFileURL(process.env.STORAGE_FILE);
  if (process.env.DATA_DIR) return pathToFileURL(path.join(process.env.DATA_DIR, "raspredelenie_storage.xlsx"));
  return SEED_STORAGE_FILE;
}

export const STORAGE_FILE = storageFileUrl();

export const SHEETS = {
  cases: "Дела",
  employees: "Сотрудники",
  queues: "Очереди",
  state: "Состояние",
  vacations: "Отпуска",
  journal: "Журнал",
  settings: "Настройки",
};

export const CASE_HEADERS = [
  "case_id",
  "Номер дела",
  "Предмет",
  "ЮЦ",
  "Регион",
  "Истец",
  "Ответчик",
  "Третье лицо",
  "Тип дела",
  "Дата поступления",
  "Статус",
  "Дата завершения",
  "Ответственный",
  "Дата распределения",
  "Основание",
  "Распределено системой",
  "Ручное назначение",
  "Комментарий",
  "Ссылка",
];

export const EMPLOYEE_HEADERS = [
  "employee_id",
  "ФИО",
  "ЮЦ",
  "Активен",
  "Судебные",
  "Административные",
  "Претензии",
  "Отпуск с",
  "Отпуск по",
  "Комментарий",
];

export const QUEUE_HEADERS = [
  "queue_id",
  "ЮЦ",
  "Тип дела",
  "Позиция",
  "employee_id",
  "ФИО",
  "Долг",
  "Дата долга",
  "Примечание",
];

export const STATE_HEADERS = [
  "queue_id",
  "ЮЦ",
  "Тип дела",
  "Последняя позиция",
  "Последний автоназначенный",
  "Цикл",
  "Дата последнего автоназначения",
  "Комментарий",
];

export const VACATION_HEADERS = [
  "employee_id",
  "ФИО",
  "Дата",
  "Тип",
  "Комментарий",
  "Изменено",
];

export const JOURNAL_HEADERS = [
  "Дата события",
  "case_id",
  "Тип дела",
  "Ответственный",
  "Основание",
  "Способ",
  "ЮЦ",
  "Цикл",
  "Предложенный системой",
  "Комментарий",
];

export const SETTINGS_HEADERS = ["Тип дела", "Срок актуальности"];

export const DEFAULT_RELEVANCE_DAYS = {
  "претензия": 5,
  "административное": 10,
  "судебное": 30,
};

export const CASE_STATUSES = [
  "В работе",
  "Ожидает распределения",
  "Завершено",
  "Отменено",
  "Приостановлено",
];

export const CASE_TYPES = ["претензия", "административное", "судебное"];

const COMPLETE_STATUSES = new Set(["Завершено", "Отменено"]);
const YUC_ALIASES = new Map([
  ["дв", "Дальний Восток"],
  ["дальний восток", "Дальний Восток"],
]);

export function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

export function yes(value) {
  return cleanText(value).toLowerCase() === "да";
}

export function normalizeType(value) {
  const type = cleanText(value).toLowerCase();
  if (type === "админ") return "административное";
  if (type === "суд" || type === "третьи лица") return "судебное";
  return type;
}

export function normalizeYuc(value) {
  const text = cleanText(value);
  if (!text) return "Дальний Восток";
  return YUC_ALIASES.get(text.toLowerCase()) ?? text;
}

export function todayISO(date = new Date()) {
  return toISODate(date);
}

export function nowISO(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function toISODate(value) {
  if (!value && value !== 0) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return toISODate(parsed);
    return trimmed;
  }
  if (typeof value === "number") {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return toISODate(new Date(excelEpoch + value * 24 * 60 * 60 * 1000));
  }
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return "";
}

export function parseISODate(value) {
  const iso = toISODate(value);
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function addDays(dateValue, days) {
  const date = parseISODate(dateValue);
  if (!date || !Number.isFinite(Number(days))) return "";
  const next = new Date(date);
  next.setDate(next.getDate() + Number(days));
  return toISODate(next);
}

export function daysBetween(a, b) {
  const start = parseISODate(a);
  const end = parseISODate(b);
  if (!start || !end) return "";
  return Math.round((start.getTime() - end.getTime()) / (24 * 60 * 60 * 1000));
}

export function relevanceDays(settings, type) {
  const normalized = normalizeType(type);
  const row = settings.find((item) => normalizeType(item["Тип дела"]) === normalized);
  const days = Number(row?.["Срок актуальности"]);
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_RELEVANCE_DAYS[normalized] ?? "";
}

export function caseDerived(caseRow, settings, date = new Date()) {
  const type = normalizeType(caseRow["Тип дела"]);
  const relevance = relevanceDays(settings, type);
  const hideDate = addDays(caseRow["Дата поступления"], relevance);
  const status = cleanText(caseRow["Статус"]) || "В работе";
  const today = todayISO(date);
  const isActive = Boolean(
    caseRow.case_id &&
    hideDate &&
    !COMPLETE_STATUSES.has(status) &&
    hideDate >= today
  );
  return {
    ...caseRow,
    "Тип дела": type,
    "Регион": normalizeRegionName(caseRow["Регион"]),
    "Дата поступления": toISODate(caseRow["Дата поступления"]),
    "Дата завершения": toISODate(caseRow["Дата завершения"]),
    "Срок актуальности": relevance,
    "Дата скрытия": hideDate,
    "Актуально": isActive ? "Да" : "Нет",
    "Активное число": isActive ? 1 : 0,
    "Дней до скрытия": isActive ? daysBetween(hideDate, today) : "",
  };
}

export function vacationKey(employeeId, dateValue) {
  return `${cleanText(employeeId)}::${toISODate(dateValue)}`;
}

export function normalizeVacation(row) {
  return {
    employee_id: cleanText(row.employee_id),
    "ФИО": cleanText(row["ФИО"]),
    "Дата": toISODate(row["Дата"]),
    "Тип": cleanText(row["Тип"]) || "Отпуск",
    "Комментарий": cleanText(row["Комментарий"]),
    "Изменено": cleanText(row["Изменено"]),
  };
}

export function vacationDatesForEmployee(vacations, employeeId, year = null) {
  return [...new Set((vacations ?? [])
    .map(normalizeVacation)
    .filter((item) => item.employee_id === cleanText(employeeId))
    .map((item) => item["Дата"])
    .filter((date) => date && (!year || date.startsWith(`${year}-`))))].sort();
}

export function isEmployeeOnVacation(employee, date = new Date(), vacations = []) {
  if (!employee) return false;
  const employeeId = cleanText(employee?.employee_id);
  const day = todayISO(date);
  if (employeeId && (vacations ?? []).some((item) => cleanText(item.employee_id) === employeeId && toISODate(item["Дата"]) === day)) {
    return true;
  }
  const from = toISODate(employee["Отпуск с"]);
  const to = toISODate(employee["Отпуск по"]);
  return Boolean(from && to && from <= day && day <= to);
}

export function employeeParticipates(employee, type) {
  const normalized = normalizeType(type);
  if (normalized === "судебное") return yes(employee["Судебные"]);
  if (normalized === "административное") return yes(employee["Административные"]);
  if (normalized === "претензия") return yes(employee["Претензии"]);
  return false;
}

export function isEmployeeAvailable(employee, type, date = new Date(), vacations = []) {
  return Boolean(
    employee &&
    yes(employee["Активен"]) &&
    employeeParticipates(employee, type) &&
    !isEmployeeOnVacation(employee, date, vacations)
  );
}

export function enrichData(data, date = new Date()) {
  const vacations = (data.vacations ?? []).map(normalizeVacation).filter((item) => item.employee_id && item["Дата"]);
  const cases = data.cases.map((item) => caseDerived(item, data.settings, date));
  const employees = data.employees.map((employee) => {
    const name = cleanText(employee["ФИО"]);
    const activeCases = cases.filter((caseRow) => cleanText(caseRow["Ответственный"]) === name && caseRow["Активное число"] === 1);
    return {
      ...employee,
      "Отпуск с": toISODate(employee["Отпуск с"]),
      "Отпуск по": toISODate(employee["Отпуск по"]),
      "Сейчас в отпуске": isEmployeeOnVacation(employee, date, vacations) ? "Да" : "Нет",
      "Активные всего": activeCases.length,
      "Активные судебные": activeCases.filter((item) => item["Тип дела"] === "судебное").length,
      "Активные административные": activeCases.filter((item) => item["Тип дела"] === "административное").length,
      "Активные претензии": activeCases.filter((item) => item["Тип дела"] === "претензия").length,
    };
  });
  const summary = {
    totalCases: cases.length,
    activeCases: cases.filter((item) => item["Активное число"] === 1).length,
    unassignedCases: cases.filter((item) => !cleanText(item["Ответственный"])).length,
    activeEmployees: employees.filter((item) => yes(item["Активен"])).length,
    byType: CASE_TYPES.map((type) => ({
      type,
      total: cases.filter((item) => item["Тип дела"] === type).length,
      active: cases.filter((item) => item["Тип дела"] === type && item["Активное число"] === 1).length,
      relevanceDays: relevanceDays(data.settings, type),
    })),
  };
  return { ...data, vacations, cases, employees, summary };
}

export function makeCaseId(cases) {
  const max = cases.reduce((acc, row) => {
    const match = cleanText(row.case_id).match(/CASE-(\d+)/);
    return match ? Math.max(acc, Number(match[1])) : acc;
  }, 0);
  return `CASE-${String(max + 1).padStart(4, "0")}`;
}

export function makeQueueId(yuc, type) {
  return `QUEUE-${normalizeYuc(yuc)}-${normalizeType(type)}`;
}

export function makeQueueState(data, yuc, type) {
  const normalizedType = normalizeType(type);
  const normalizedYuc = normalizeYuc(yuc);
  const queueId = makeQueueId(normalizedYuc, normalizedType);
  let state = data.state.find((item) =>
    normalizeYuc(item["ЮЦ"]) === normalizedYuc &&
    normalizeType(item["Тип дела"]) === normalizedType
  );
  if (!state) {
    state = {
      queue_id: queueId,
      "ЮЦ": normalizedYuc,
      "Тип дела": normalizedType,
      "Последняя позиция": 0,
      "Последний автоназначенный": "",
      "Цикл": 1,
      "Дата последнего автоназначения": "",
      "Комментарий": "",
    };
    data.state.push(state);
  }
  return state;
}

function employeeByName(data, name) {
  const normalized = cleanText(name);
  return data.employees.find((employee) => cleanText(employee["ФИО"]) === normalized);
}

function queueRowsFor(data, yuc, type) {
  const normalizedYuc = normalizeYuc(yuc);
  const normalizedType = normalizeType(type);
  return data.queues
    .filter((row) => normalizeYuc(row["ЮЦ"]) === normalizedYuc && normalizeType(row["Тип дела"]) === normalizedType)
    .sort((a, b) => Number(a["Позиция"]) - Number(b["Позиция"]));
}

function queueCandidateInfo(data, queueRow, type, date) {
  const employee = employeeByName(data, queueRow["ФИО"]);
  const vacation = employee ? isEmployeeOnVacation(employee, date, data.vacations ?? []) : false;
  const available = isEmployeeAvailable(employee, type, date, data.vacations ?? []);
  return { employee, vacation, available };
}

function caseById(data, caseId) {
  const normalizedId = cleanText(caseId);
  return data.cases.find((item) => cleanText(item.case_id) === normalizedId);
}

function ensureAssignableExistingCase(caseRow) {
  if (!caseRow) throw new Error("Дело не найдено.");
  if (cleanText(caseRow["Ответственный"])) {
    throw new Error("У дела уже есть ответственный.");
  }
  if (cleanText(caseRow["Статус"]) !== "Ожидает распределения") {
    throw new Error("Распределять из реестра можно только дела в статусе «Ожидает распределения».");
  }
}

function applyAutomaticQueueEffects(data, normalized, result, state, date) {
  const queueRows = queueRowsFor(data, normalized["ЮЦ"], normalized["Тип дела"]);
  for (const row of queueRows) {
    const employee = employeeByName(data, row["ФИО"]);
    if (employee && yes(employee["Активен"]) && employeeParticipates(employee, normalized["Тип дела"]) && isEmployeeOnVacation(employee, date, data.vacations ?? [])) {
      row["Долг"] = Math.min(1, Number(row["Долг"]) || 0) || 1;
      row["Дата долга"] = row["Дата долга"] || todayISO(date);
    }
  }

  if (result.ok) {
    const selectedQueueRow = queueRows.find((row) => cleanText(row["ФИО"]) === result.candidate);
    if (result.basis === "долг после отпуска" && selectedQueueRow) {
      selectedQueueRow["Долг"] = 0;
      selectedQueueRow["Дата долга"] = "";
    }
    if (result.basis === "очередь" && selectedQueueRow) {
      const oldPosition = Number(state["Последняя позиция"]) || 0;
      const newPosition = Number(selectedQueueRow["Позиция"]) || 0;
      if (oldPosition > 0 && newPosition <= oldPosition) {
        state["Цикл"] = (Number(state["Цикл"]) || 1) + 1;
      }
      state["Последняя позиция"] = newPosition;
    }
    state["Последний автоназначенный"] = result.candidate;
    state["Дата последнего автоназначения"] = nowISO(date);
  }
}

function appendAutomaticJournal(data, caseId, normalized, result, state, commentPrefix, date) {
  data.journal.push({
    "Дата события": nowISO(date),
    case_id: caseId,
    "Тип дела": normalized["Тип дела"],
    "Ответственный": result.ok ? result.candidate : "",
    "Основание": result.ok ? result.basis : "Не распределено автоматически",
    "Способ": result.ok ? "авто" : "стоп",
    "ЮЦ": normalized["ЮЦ"],
    "Цикл": state["Цикл"],
    "Предложенный системой": result.candidate,
    "Комментарий": result.ok
      ? `${commentPrefix}. Пропущены из-за отпуска: ${(result.skippedVacation ?? []).join(", ") || "нет"}.`
      : result.reason,
  });
}

export function recommend(data, draft, date = new Date()) {
  const yuc = cleanText(draft["ЮЦ"]) || "ДВ";
  const normalizedYuc = normalizeYuc(yuc);
  const type = normalizeType(draft["Тип дела"]);
  if (!CASE_TYPES.includes(type)) {
    return { ok: false, candidate: "", basis: "", reason: "Укажите тип дела: претензия, административное или судебное." };
  }
  const rows = queueRowsFor(data, normalizedYuc, type);
  if (!rows.length) {
    return { ok: false, candidate: "", basis: "", reason: "Для этого ЮЦ и типа дела не настроена очередь." };
  }
  const state = makeQueueState(data, normalizedYuc, type);
  const lastAuto = cleanText(state["Последний автоназначенный"]);
  const lastPosition = Number(state["Последняя позиция"]) || 0;
  const debtCandidates = rows
    .filter((row) => Number(row["Долг"]) > 0)
    .map((row) => ({ row, ...queueCandidateInfo(data, row, type, date) }))
    .filter((item) => item.available && cleanText(item.row["ФИО"]) !== lastAuto)
    .sort((a, b) => {
      const dateA = toISODate(a.row["Дата долга"]) || "9999-12-31";
      const dateB = toISODate(b.row["Дата долга"]) || "9999-12-31";
      return dateA.localeCompare(dateB) || Number(a.row["Позиция"]) - Number(b.row["Позиция"]);
    });
  if (debtCandidates.length) {
    return {
      ok: true,
      candidate: cleanText(debtCandidates[0].row["ФИО"]),
      employee_id: cleanText(debtCandidates[0].row.employee_id),
      position: Number(debtCandidates[0].row["Позиция"]),
      basis: "долг после отпуска",
      reason: "",
    };
  }

  const ordered = [
    ...rows.filter((row) => Number(row["Позиция"]) > lastPosition),
    ...rows.filter((row) => Number(row["Позиция"]) <= lastPosition),
  ];
  let availableCount = 0;
  let previousAvailable = false;
  const skippedVacation = [];
  for (const row of ordered) {
    const info = queueCandidateInfo(data, row, type, date);
    if (!info.employee) continue;
    if (!yes(info.employee["Активен"]) || !employeeParticipates(info.employee, type)) continue;
    if (info.vacation) {
      skippedVacation.push(row);
      continue;
    }
    availableCount += 1;
    if (cleanText(row["ФИО"]) === lastAuto) {
      previousAvailable = true;
      continue;
    }
    return {
      ok: true,
      candidate: cleanText(row["ФИО"]),
      employee_id: cleanText(row.employee_id),
      position: Number(row["Позиция"]),
      basis: "очередь",
      reason: "",
      skippedVacation: skippedVacation.map((item) => cleanText(item["ФИО"])),
    };
  }
  if (availableCount === 1 && previousAvailable) {
    return {
      ok: false,
      candidate: "",
      basis: "",
      reason: "Единственный доступный сотрудник уже был предыдущим автополучателем этого типа. Нужно ручное решение руководителя.",
      skippedVacation: skippedVacation.map((item) => cleanText(item["ФИО"])),
    };
  }
  if (availableCount === 0) {
    return {
      ok: false,
      candidate: "",
      basis: "",
      reason: "Нет доступных сотрудников в очереди.",
      skippedVacation: skippedVacation.map((item) => cleanText(item["ФИО"])),
    };
  }
  return {
    ok: false,
    candidate: "",
    basis: "",
    reason: "Не найден кандидат по очереди.",
    skippedVacation: skippedVacation.map((item) => cleanText(item["ФИО"])),
  };
}

export function normalizeDraft(draft) {
  return {
    "Номер дела": cleanText(draft["Номер дела"]),
    "Предмет": cleanText(draft["Предмет"]),
    "ЮЦ": normalizeYuc(draft["ЮЦ"]),
    "Регион": normalizeRegionName(draft["Регион"]),
    "Истец": cleanText(draft["Истец"]),
    "Ответчик": cleanText(draft["Ответчик"]),
    "Третье лицо": cleanText(draft["Третье лицо"]),
    "Тип дела": normalizeType(draft["Тип дела"]),
    "Дата поступления": toISODate(draft["Дата поступления"]) || todayISO(),
    "Ссылка": cleanText(draft["Ссылка"]),
  };
}

export function assignAutomatically(data, draft, date = new Date()) {
  const normalized = normalizeDraft(draft);
  const result = recommend(data, normalized, date);
  const caseId = makeCaseId(data.cases);
  const state = makeQueueState(data, normalized["ЮЦ"], normalized["Тип дела"]);
  const created = {
    case_id: caseId,
    "Номер дела": normalized["Номер дела"],
    "Предмет": normalized["Предмет"],
    "ЮЦ": normalized["ЮЦ"],
    "Регион": normalized["Регион"],
    "Истец": normalized["Истец"],
    "Ответчик": normalized["Ответчик"],
    "Третье лицо": normalized["Третье лицо"],
    "Тип дела": normalized["Тип дела"],
    "Дата поступления": normalized["Дата поступления"],
    "Статус": result.ok ? "В работе" : "Ожидает распределения",
    "Дата завершения": "",
    "Ответственный": result.ok ? result.candidate : "",
    "Дата распределения": result.ok ? nowISO(date) : "",
    "Основание": result.ok ? result.basis : "Не распределено автоматически",
    "Распределено системой": result.ok ? "Да" : "Нет",
    "Ручное назначение": "Нет",
    "Комментарий": result.ok ? "" : result.reason,
    "Ссылка": normalized["Ссылка"],
  };
  data.cases.push(created);

  applyAutomaticQueueEffects(data, normalized, result, state, date);
  appendAutomaticJournal(data, caseId, normalized, result, state, "Автоматическое назначение", date);

  return { result, case: created };
}

export function assignExistingAutomatically(data, caseId, date = new Date()) {
  const caseRow = caseById(data, caseId);
  ensureAssignableExistingCase(caseRow);
  const normalized = normalizeDraft(caseRow);
  const result = recommend(data, normalized, date);
  const state = makeQueueState(data, normalized["ЮЦ"], normalized["Тип дела"]);

  Object.assign(caseRow, {
    "ЮЦ": normalized["ЮЦ"],
    "Регион": normalized["Регион"],
    "Тип дела": normalized["Тип дела"],
    "Дата поступления": normalized["Дата поступления"],
    "Статус": result.ok ? "В работе" : "Ожидает распределения",
    "Ответственный": result.ok ? result.candidate : "",
    "Дата распределения": result.ok ? nowISO(date) : "",
    "Основание": result.ok ? result.basis : "Не распределено автоматически",
    "Распределено системой": result.ok ? "Да" : "Нет",
    "Ручное назначение": "Нет",
    "Комментарий": result.ok ? "" : result.reason,
  });

  applyAutomaticQueueEffects(data, normalized, result, state, date);
  appendAutomaticJournal(data, cleanText(caseRow.case_id), normalized, result, state, "Автоматическое назначение существующего дела", date);

  return { result, case: caseRow };
}

export function assignManually(data, draft, responsible, comment, date = new Date()) {
  const normalized = normalizeDraft(draft);
  const name = cleanText(responsible);
  const note = cleanText(comment);
  if (!name) throw new Error("Укажите ответственного для ручного назначения.");
  if (!note) throw new Error("Комментарий обязателен для ручного назначения.");
  const caseId = makeCaseId(data.cases);
  const recommendation = recommend(data, normalized, date);
  const created = {
    case_id: caseId,
    "Номер дела": normalized["Номер дела"],
    "Предмет": normalized["Предмет"],
    "ЮЦ": normalized["ЮЦ"],
    "Регион": normalized["Регион"],
    "Истец": normalized["Истец"],
    "Ответчик": normalized["Ответчик"],
    "Третье лицо": normalized["Третье лицо"],
    "Тип дела": normalized["Тип дела"],
    "Дата поступления": normalized["Дата поступления"],
    "Статус": "В работе",
    "Дата завершения": "",
    "Ответственный": name,
    "Дата распределения": nowISO(date),
    "Основание": "Ручное назначение руководителем",
    "Распределено системой": "Нет",
    "Ручное назначение": "Да",
    "Комментарий": note,
    "Ссылка": normalized["Ссылка"],
  };
  data.cases.push(created);
  data.journal.push({
    "Дата события": nowISO(date),
    case_id: caseId,
    "Тип дела": normalized["Тип дела"],
    "Ответственный": name,
    "Основание": "Ручное назначение руководителем",
    "Способ": "ручное",
    "ЮЦ": normalized["ЮЦ"],
    "Цикл": "",
    "Предложенный системой": recommendation.candidate,
    "Комментарий": note,
  });
  return { recommendation, case: created };
}

export function assignExistingManually(data, caseId, responsible, comment, date = new Date()) {
  const caseRow = caseById(data, caseId);
  ensureAssignableExistingCase(caseRow);
  const normalized = normalizeDraft(caseRow);
  const name = cleanText(responsible);
  const note = cleanText(comment);
  if (!name) throw new Error("Укажите ответственного для ручного назначения.");
  if (!note) throw new Error("Комментарий обязателен для ручного назначения.");
  const employee = employeeByName(data, name);
  if (!employee) throw new Error("Ответственный должен быть выбран из списка сотрудников.");
  const recommendation = recommend(data, normalized, date);

  Object.assign(caseRow, {
    "ЮЦ": normalized["ЮЦ"],
    "Регион": normalized["Регион"],
    "Тип дела": normalized["Тип дела"],
    "Дата поступления": normalized["Дата поступления"],
    "Статус": "В работе",
    "Ответственный": name,
    "Дата распределения": nowISO(date),
    "Основание": "Ручное назначение руководителем",
    "Распределено системой": "Нет",
    "Ручное назначение": "Да",
    "Комментарий": note,
  });

  data.journal.push({
    "Дата события": nowISO(date),
    case_id: cleanText(caseRow.case_id),
    "Тип дела": normalized["Тип дела"],
    "Ответственный": name,
    "Основание": "Ручное назначение руководителем",
    "Способ": "ручное",
    "ЮЦ": normalized["ЮЦ"],
    "Цикл": "",
    "Предложенный системой": recommendation.candidate,
    "Комментарий": note,
  });
  return { recommendation, case: caseRow };
}

export function changeCaseResponsible(data, caseId, responsible, date = new Date()) {
  const caseRow = caseById(data, caseId);
  if (!caseRow) throw new Error("Дело не найдено.");
  const name = cleanText(responsible);
  if (!name) throw new Error("Укажите нового ответственного.");
  const employee = employeeByName(data, name);
  if (!employee) throw new Error("Ответственный должен быть выбран из списка сотрудников.");
  const previous = cleanText(caseRow["Ответственный"]);
  if (previous === name) return { case: caseRow, changed: false };
  const normalized = normalizeDraft(caseRow);

  Object.assign(caseRow, {
    "Ответственный": name,
    "Ручное назначение": "Да",
    "Основание": "Принудительная смена ответственного",
    "Комментарий": cleanText(caseRow["Комментарий"]),
  });

  data.journal.push({
    "Дата события": nowISO(date),
    case_id: cleanText(caseRow.case_id),
    "Тип дела": normalized["Тип дела"],
    "Ответственный": name,
    "Основание": "Принудительная смена ответственного",
    "Способ": "ручное",
    "ЮЦ": normalized["ЮЦ"],
    "Цикл": "",
    "Предложенный системой": "",
    "Комментарий": `Ответственный изменён: ${previous || "не был назначен"} → ${name}. Очередь не изменялась.`,
  });

  return { case: caseRow, changed: true, previous };
}

export function allDatesInRange(startValue, endValue) {
  const start = parseISODate(startValue);
  const end = parseISODate(endValue);
  if (!start || !end) return [];
  const from = start <= end ? start : end;
  const to = start <= end ? end : start;
  const dates = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    dates.push(toISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function setVacationDates(data, employeeId, dates, enabled, date = new Date()) {
  const employee = data.employees.find((item) => cleanText(item.employee_id) === cleanText(employeeId));
  if (!employee) throw new Error("Сотрудник не найден.");
  const normalizedDates = [...new Set(dates.map(toISODate).filter(Boolean))].sort();
  data.vacations = (data.vacations ?? []).map(normalizeVacation).filter((item) => item.employee_id && item["Дата"]);
  const removeSet = new Set(normalizedDates.map((day) => vacationKey(employeeId, day)));
  data.vacations = data.vacations.filter((item) => !removeSet.has(vacationKey(item.employee_id, item["Дата"])));
  if (enabled) {
    data.vacations.push(...normalizedDates.map((day) => ({
      employee_id: cleanText(employee.employee_id),
      "ФИО": cleanText(employee["ФИО"]),
      "Дата": day,
      "Тип": "Отпуск",
      "Комментарий": "",
      "Изменено": nowISO(date),
    })));
  }
  data.vacations.sort((a, b) =>
    cleanText(a["ФИО"]).localeCompare(cleanText(b["ФИО"]), "ru") ||
    cleanText(a["Дата"]).localeCompare(cleanText(b["Дата"]))
  );
  return vacationDatesForEmployee(data.vacations, employeeId);
}

export function clearVacationYear(data, employeeId, year) {
  const prefix = `${Number(year)}-`;
  data.vacations = (data.vacations ?? [])
    .map(normalizeVacation)
    .filter((item) => !(cleanText(item.employee_id) === cleanText(employeeId) && item["Дата"].startsWith(prefix)));
  return vacationDatesForEmployee(data.vacations, employeeId, Number(year));
}
