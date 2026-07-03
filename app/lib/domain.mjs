import { normalizeRegionName } from "./regions.mjs";

export const SHEETS = {
  cases: "Дела",
  employees: "Сотрудники",
  queues: "Очереди",
  state: "Состояние",
  vacations: "Отпуска",
  journal: "Журнал",
  settings: "Настройки",
  yucSettings: "Настройки ЮЦ",
  regionalAssignments: "Региональные закрепления",
  regionalSubstitutions: "Региональные замещения",
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
  "Отложить завершение до",
  "Причина отложения завершения дела",
  "Дата предупреждения о завершении",
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
  "Дата начала",
  "Дата окончания",
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

export const SETTINGS_HEADERS = ["ЮЦ", "Тип дела", "Активность, дни", "Автозавершение, дни", "Учитывать долг", "Максимальный долг"];

export const YUC_SETTINGS_HEADERS = [
  "Название",
  "ЮЦ",
  "Региональные очереди вкл\\выкл",
  "Порог перегруза",
  "Считать перегруз по",
  "Автоназначение вне региона вкл/выкл",
  "Учитывать неактивные незавершенные в нагрузке",
  "Регион не настроен",
  "Региональные юристы недоступны",
];

export const REGIONAL_ASSIGNMENT_HEADERS = [
  "Название",
  "ЮЦ",
  "Регион",
  "Сотрудник",
  "Тип нагрузки",
  "Активно",
];

export const REGIONAL_SUBSTITUTION_HEADERS = [
  "Название",
  "ЮЦ",
  "Регион",
  "Основной сотрудник",
  "Замещающий сотрудник",
  "Тип нагрузки",
  "Активно",
  "Комментарий",
];

export const DEFAULT_ACTIVITY_DAYS = {
  "претензия": 5,
  "административное": 10,
  "судебное": 30,
};

export const DEFAULT_AUTOCOMPLETE_DAYS = {
  "претензия": 30,
  "административное": 90,
  "судебное": 360,
};

export const CASE_STATUSES = [
  "В работе",
  "Ожидает распределения",
  "Завершено",
  "Отменено",
  "Приостановлено",
  "Удалено",
];

export const CASE_TYPES = ["претензия", "административное", "судебное"];

const DELETED_STATUS = "Удалено";
const COMPLETE_STATUSES = new Set(["Завершено", "Отменено", DELETED_STATUS]);
export const FIELD = {
  yuc: "ЮЦ",
  caseType: "Тип дела",
  workloadType: "Тип нагрузки",
  name: "ФИО",
  employeeActive: "Активен",
  ruleActive: "Активно",
  status: "Статус",
  responsible: "Ответственный",
  debt: "Долг",
  debtDate: "Дата долга",
  position: "Позиция",
};
export const YUC_SETTING = {
  regionalEnabled: "Региональные очереди вкл\\выкл",
  overloadThreshold: "Порог перегруза",
  overloadMode: "Считать перегруз по",
  allowOutsideRegion: "Автоназначение вне региона вкл/выкл",
  includeInactiveLoad: "Учитывать неактивные незавершенные в нагрузке",
  missingRegionMode: "Регион не настроен",
  unavailableRegionalMode: "Региональные юристы недоступны",
};
const LOAD_MODE_TOTAL = "общая нагрузка";
const LOAD_MODE_BY_TYPE = "тип нагрузки";
const REGIONAL_UNAVAILABLE_SUBSTITUTE_THEN_GENERAL = "заместитель затем общая очередь";
const REGIONAL_MODE_ERROR = "ошибка";
const REGIONAL_REPEAT_BASIS = "повтор допускается региональным правилом";
const YUC_ALIASES = new Map([
  ["дв", "Дальний Восток"],
  ["дальний восток", "Дальний Восток"],
]);

export function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

export function yes(value) {
  const text = cleanText(value).toLowerCase();
  return text === "да" || text === "1" || text === "true";
}

export function yesNo(value) {
  return yes(value) ? "Да" : "Нет";
}

export function shortName(value) {
  const parts = cleanText(value).split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  const [surname, first = "", middle = ""] = parts;
  const initials = [first, middle]
    .filter(Boolean)
    .map((part) => `${part[0]}.`)
    .join("");
  return initials ? `${surname} ${initials}` : surname;
}

export function nameMatches(a, b) {
  const left = cleanText(a);
  const right = cleanText(b);
  if (!left || !right) return false;
  return left === right || shortName(left) === right || left === shortName(right);
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

export function typeSettings(settings, yuc, type) {
  const normalizedYuc = normalizeYuc(yuc);
  const normalized = normalizeType(type);
  return (settings ?? []).find((item) =>
    normalizeYuc(item[FIELD.yuc]) === normalizedYuc &&
    normalizeType(item[FIELD.caseType]) === normalized
  ) ?? (settings ?? []).find((item) =>
    !cleanText(item[FIELD.yuc]) &&
    normalizeType(item[FIELD.caseType]) === normalized
  );
}

export function activityDays(settings, yuc, type) {
  const normalized = normalizeType(type);
  const row = typeSettings(settings, yuc, normalized);
  const days = Number(row?.["Активность, дни"] ?? row?.["Срок актуальности"]);
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_ACTIVITY_DAYS[normalized] ?? "";
}

export function autocompletionDays(settings, yuc, type) {
  const normalized = normalizeType(type);
  const row = typeSettings(settings, yuc, normalized);
  const days = Number(row?.["Автозавершение, дни"]);
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_AUTOCOMPLETE_DAYS[normalized] ?? "";
}

export function debtEnabled(settings, yuc, type) {
  const row = typeSettings(settings, yuc, normalizeType(type));
  return yes(row?.["Учитывать долг"]);
}

export function maxDebt(settings, yuc, type) {
  const row = typeSettings(settings, yuc, normalizeType(type));
  const value = Number(row?.["Максимальный долг"]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function relevanceDays(settings, type, yuc = "") {
  return activityDays(settings, yuc, type);
}

export function caseDerived(caseRow, settings, date = new Date()) {
  const yuc = normalizeYuc(caseRow[FIELD.yuc]);
  const type = normalizeType(caseRow[FIELD.caseType]);
  const relevance = activityDays(settings, yuc, type);
  const completionLimit = autocompletionDays(settings, yuc, type);
  const hideDate = addDays(caseRow["Дата поступления"], relevance);
  const plannedCompletionDate = addDays(caseRow["Дата поступления"], completionLimit);
  const postponedCompletionDate = toISODate(caseRow["Отложить завершение до"]);
  const completionControlDate = postponedCompletionDate || plannedCompletionDate;
  const status = cleanText(caseRow[FIELD.status]) || "В работе";
  const today = todayISO(date);
  const isComplete = COMPLETE_STATUSES.has(status);
  const isActive = Boolean(
    caseRow.case_id &&
    hideDate &&
    !isComplete &&
    hideDate >= today
  );
  const completionDecisionRequired = Boolean(
    caseRow.case_id &&
    !isComplete &&
    completionControlDate &&
    completionControlDate <= today
  );
  return {
    ...caseRow,
    [FIELD.yuc]: yuc,
    [FIELD.caseType]: type,
    "Регион": normalizeRegionName(caseRow["Регион"]),
    "Дата поступления": toISODate(caseRow["Дата поступления"]),
    "Дата завершения": toISODate(caseRow["Дата завершения"]),
    "Отложить завершение до": postponedCompletionDate,
    "Дата предупреждения о завершении": toISODate(caseRow["Дата предупреждения о завершении"]),
    "Срок активности": relevance,
    "Срок актуальности": relevance,
    "Срок автозавершения": completionLimit,
    "Дата скрытия": hideDate,
    "Плановая дата завершения": plannedCompletionDate,
    "Контрольная дата завершения": completionControlDate,
    "Требует решения о завершении": completionDecisionRequired ? "Да" : "Нет",
    "Дней просрочки завершения": completionDecisionRequired ? Math.max(0, daysBetween(today, completionControlDate)) : "",
    "Актуально": isActive ? "Да" : "Нет",
    "Активное число": isActive ? 1 : 0,
    "Дней до скрытия": isActive ? daysBetween(hideDate, today) : "",
  };
}

export function isDeletedCase(caseRow) {
  return cleanText(caseRow?.["Статус"]) === DELETED_STATUS;
}

export function vacationKey(employeeId, startValue) {
  return `${cleanText(employeeId)}::${toISODate(startValue)}`;
}

export function normalizeVacation(row) {
  const start = toISODate(row["Дата начала"] ?? row["Дата"]);
  const end = toISODate(row["Дата окончания"] ?? row["Дата по"] ?? row["Дата"]) || start;
  const from = start && end && end < start ? end : start;
  const to = start && end && end < start ? start : end;
  return {
    employee_id: cleanText(row.employee_id),
    "ФИО": cleanText(row["ФИО"]),
    "Дата начала": from,
    "Дата окончания": to,
    "Тип": cleanText(row["Тип"]) || "Отпуск",
    "Комментарий": cleanText(row["Комментарий"]),
    "Изменено": cleanText(row["Изменено"]),
  };
}

export function vacationDatesForEmployee(vacations, employeeId, year = null) {
  const prefix = year ? `${Number(year)}-` : "";
  const dates = [];
  for (const item of (vacations ?? []).map(normalizeVacation)) {
    if (item.employee_id !== cleanText(employeeId) || !item["Дата начала"]) continue;
    dates.push(...allDatesInRange(item["Дата начала"], item["Дата окончания"] || item["Дата начала"])
      .filter((date) => !prefix || date.startsWith(prefix)));
  }
  return [...new Set(dates)].sort();
}

export function isEmployeeOnVacation(employee, date = new Date(), vacations = []) {
  if (!employee) return false;
  const employeeId = cleanText(employee?.employee_id);
  const day = todayISO(date);
  if (employeeId && (vacations ?? []).map(normalizeVacation).some((item) =>
    cleanText(item.employee_id) === employeeId &&
    item["Дата начала"] &&
    item["Дата начала"] <= day &&
    day <= (item["Дата окончания"] || item["Дата начала"])
  )) {
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
    yes(employee[FIELD.employeeActive]) &&
    employeeParticipates(employee, type) &&
    !isEmployeeOnVacation(employee, date, vacations)
  );
}

export function enrichData(data, date = new Date()) {
  const vacations = (data.vacations ?? []).map(normalizeVacation).filter((item) => item.employee_id && item["Дата начала"]);
  const cases = data.cases.map((item) => caseDerived(item, data.settings, date));
  const activeRegisterCases = cases.filter((caseRow) => !isDeletedCase(caseRow));
  const employees = data.employees.map((employee) => {
    const name = cleanText(employee[FIELD.name]);
    const activeCases = activeRegisterCases.filter((caseRow) => nameMatches(caseRow[FIELD.responsible], name) && caseRow["Активное число"] === 1);
    return {
      ...employee,
      "Отпуск с": toISODate(employee["Отпуск с"]),
      "Отпуск по": toISODate(employee["Отпуск по"]),
      "Сейчас в отпуске": isEmployeeOnVacation(employee, date, vacations) ? "Да" : "Нет",
      "Активные всего": activeCases.length,
      "Активные судебные": activeCases.filter((item) => item[FIELD.caseType] === "судебное").length,
      "Активные административные": activeCases.filter((item) => item[FIELD.caseType] === "административное").length,
      "Активные претензии": activeCases.filter((item) => item[FIELD.caseType] === "претензия").length,
    };
  });
  const summary = {
    totalCases: activeRegisterCases.length,
    activeCases: activeRegisterCases.filter((item) => item["Активное число"] === 1).length,
    unassignedCases: activeRegisterCases.filter((item) => !cleanText(item[FIELD.responsible])).length,
    activeEmployees: employees.filter((item) => yes(item[FIELD.employeeActive])).length,
    byType: CASE_TYPES.map((type) => ({
      type,
      total: activeRegisterCases.filter((item) => item[FIELD.caseType] === type).length,
      active: activeRegisterCases.filter((item) => item[FIELD.caseType] === type && item["Активное число"] === 1).length,
      activityDays: DEFAULT_ACTIVITY_DAYS[type] ?? "",
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
    normalizeYuc(item[FIELD.yuc]) === normalizedYuc &&
    normalizeType(item[FIELD.caseType]) === normalizedType
  );
  if (!state) {
    state = {
      queue_id: queueId,
      [FIELD.yuc]: normalizedYuc,
      [FIELD.caseType]: normalizedType,
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
  return data.employees.find((employee) => cleanText(employee[FIELD.name]) === normalized);
}

function employeeById(data, employeeId) {
  const normalized = cleanText(employeeId);
  if (!normalized) return null;
  return data.employees.find((employee) => cleanText(employee.employee_id) === normalized) ?? null;
}

function employeeForQueueRow(data, queueRow) {
  return employeeById(data, queueRow.employee_id) ?? employeeByName(data, queueRow[FIELD.name]);
}

function queueRowsFor(data, yuc, type) {
  const normalizedYuc = normalizeYuc(yuc);
  const normalizedType = normalizeType(type);
  return data.queues
    .filter((row) => normalizeYuc(row[FIELD.yuc]) === normalizedYuc && normalizeType(row[FIELD.caseType]) === normalizedType)
    .sort((a, b) => Number(a[FIELD.position]) - Number(b[FIELD.position]));
}

function queueCandidateInfo(data, queueRow, type, date) {
  const employee = employeeForQueueRow(data, queueRow);
  const vacation = employee ? isEmployeeOnVacation(employee, date, data.vacations ?? []) : false;
  const available = isEmployeeAvailable(employee, type, date, data.vacations ?? []);
  return { employee, vacation, available };
}

function yucRegionalSettings(data, yuc) {
  const normalizedYuc = normalizeYuc(yuc);
  return (data.yucSettings ?? []).find((row) => normalizeYuc(row[FIELD.yuc]) === normalizedYuc) ?? {
    [FIELD.yuc]: normalizedYuc,
    [YUC_SETTING.regionalEnabled]: "Нет",
    [YUC_SETTING.overloadThreshold]: 5,
    [YUC_SETTING.overloadMode]: LOAD_MODE_TOTAL,
    [YUC_SETTING.allowOutsideRegion]: "Да",
    [YUC_SETTING.includeInactiveLoad]: "Нет",
    [YUC_SETTING.missingRegionMode]: "общая очередь",
    [YUC_SETTING.unavailableRegionalMode]: REGIONAL_UNAVAILABLE_SUBSTITUTE_THEN_GENERAL,
  };
}

function regionalTypeMatches(value, type) {
  const normalized = normalizeType(value);
  return normalized === "все" || normalized === normalizeType(type);
}

function regionalAssignmentsFor(data, yuc, region, type) {
  const normalizedYuc = normalizeYuc(yuc);
  const normalizedRegion = normalizeRegionName(region);
  return (data.regionalAssignments ?? []).filter((row) =>
    yes(row[FIELD.ruleActive]) &&
    normalizeYuc(row[FIELD.yuc]) === normalizedYuc &&
    normalizeRegionName(row["Регион"]) === normalizedRegion &&
    regionalTypeMatches(row[FIELD.workloadType], type)
  );
}

function regionalSubstitutionsFor(data, yuc, region, type, mainEmployees) {
  const normalizedYuc = normalizeYuc(yuc);
  const normalizedRegion = normalizeRegionName(region);
  const mainNames = new Set(mainEmployees.map((employee) => cleanText(employee[FIELD.name])).filter(Boolean));
  return (data.regionalSubstitutions ?? []).filter((row) =>
    yes(row[FIELD.ruleActive]) &&
    normalizeYuc(row[FIELD.yuc]) === normalizedYuc &&
    normalizeRegionName(row["Регион"]) === normalizedRegion &&
    regionalTypeMatches(row[FIELD.workloadType], type) &&
    [...mainNames].some((name) => nameMatches(name, row["Основной сотрудник"]))
  );
}

function uniqueEmployeesByName(items) {
  const result = [];
  for (const employee of items) {
    const name = cleanText(employee?.[FIELD.name]);
    if (!name || result.some((item) => nameMatches(item[FIELD.name], name))) continue;
    result.push(employee);
  }
  return result;
}

function queueRowsForEmployees(data, yuc, type, employees) {
  const names = employees.map((employee) => cleanText(employee?.[FIELD.name])).filter(Boolean);
  return queueRowsFor(data, yuc, type).filter((row) =>
    names.some((name) => nameMatches(row[FIELD.name], name)) ||
    employees.some((employee) => cleanText(employee?.employee_id) && cleanText(employee.employee_id) === cleanText(row.employee_id))
  );
}

function includeInactiveInLoad(data, yuc) {
  return yes(yucRegionalSettings(data, yuc)[YUC_SETTING.includeInactiveLoad]);
}

function employeeLoad(data, employee, type, mode = LOAD_MODE_TOTAL, yuc = employee?.[FIELD.yuc]) {
  const name = cleanText(employee?.[FIELD.name]);
  if (!name) return 0;
  const normalizedYuc = normalizeYuc(yuc);
  const normalizedType = normalizeType(type);
  const includeInactive = includeInactiveInLoad(data, normalizedYuc);
  return (data.cases ?? []).filter((caseRow) => {
    const status = cleanText(caseRow[FIELD.status]) || "В работе";
    if (COMPLETE_STATUSES.has(status)) return false;
    if (normalizedYuc && normalizeYuc(caseRow[FIELD.yuc]) !== normalizedYuc) return false;
    if (!includeInactive && Number(caseRow["Активное число"]) !== 1) return false;
    if (!nameMatches(caseRow[FIELD.responsible], name)) return false;
    if (mode === LOAD_MODE_BY_TYPE && normalizeType(caseRow[FIELD.caseType]) !== normalizedType) return false;
    return true;
  }).length;
}

function rowAssignmentLoad(data, row, yuc, type) {
  const info = queueCandidateInfo(data, row, type, new Date(0));
  return info.employee ? employeeLoad(data, info.employee, type, LOAD_MODE_BY_TYPE, yuc) : Number.POSITIVE_INFINITY;
}

function compareRowsForAssignment(data, yuc, type, lastPosition = 0) {
  return (a, b) => {
    const loadDiff = rowAssignmentLoad(data, a, yuc, type) - rowAssignmentLoad(data, b, yuc, type);
    if (loadDiff) return loadDiff;
    const posA = Number(a[FIELD.position]) || 0;
    const posB = Number(b[FIELD.position]) || 0;
    const cycleA = lastPosition > 0 && posA <= lastPosition ? 1 : 0;
    const cycleB = lastPosition > 0 && posB <= lastPosition ? 1 : 0;
    return cycleA - cycleB || posA - posB;
  };
}

function orderedRowsForAssignment(data, rows, yuc, type, lastPosition = 0) {
  return rows.slice().sort(compareRowsForAssignment(data, yuc, type, lastPosition));
}

function queueDebtAmount(row) {
  const raw = row?.[FIELD.debt];
  if (yes(raw)) return 1;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function setQueueDebt(row, value, limit = Number.POSITIVE_INFINITY, date = new Date()) {
  if (!row) return;
  const normalized = Math.max(0, Math.min(Number.isFinite(limit) ? limit : Number.POSITIVE_INFINITY, Math.floor(Number(value) || 0)));
  row[FIELD.debt] = normalized;
  row[FIELD.debtDate] = normalized > 0 ? todayISO(date) : "";
}

function debtLimitFor(data, yuc, type) {
  if (!debtEnabled(data.settings ?? [], yuc, type)) return 0;
  return maxDebt(data.settings ?? [], yuc, type);
}

function vacationNames(rows = []) {
  return rows.map((item) => cleanText(item[FIELD.name])).filter(Boolean);
}

function recommendationResult(candidateInfo, basis, queueEffect, skippedVacation = []) {
  return {
    ok: true,
    candidate: cleanText(candidateInfo.row[FIELD.name]),
    employee_id: cleanText(candidateInfo.row.employee_id),
    position: Number(candidateInfo.row[FIELD.position]),
    basis,
    queueEffect,
    reason: "",
    skippedVacation: vacationNames(skippedVacation),
    debtAccrualQueueIds: candidateInfo.debtAccrualQueueIds ?? [],
  };
}

function failedRecommendation(reason, skippedVacation = []) {
  return {
    ok: false,
    candidate: "",
    basis: "",
    reason,
    skippedVacation: vacationNames(skippedVacation),
  };
}

function availableCandidateRows(data, rows, type, date, lastAuto = "") {
  const skippedVacation = [];
  const candidates = [];
  for (const row of rows) {
    const info = queueCandidateInfo(data, row, type, date);
    if (!info.employee) continue;
    if (!yes(info.employee[FIELD.employeeActive]) || !employeeParticipates(info.employee, type)) continue;
    if (info.vacation) {
      skippedVacation.push(row);
      continue;
    }
    if (lastAuto && cleanText(row[FIELD.name]) === lastAuto) continue;
    candidates.push({ row, ...info });
  }
  return { candidates, skippedVacation };
}

function caseById(data, caseId) {
  const normalizedId = cleanText(caseId);
  return data.cases.find((item) => cleanText(item.case_id) === normalizedId);
}

function ensureAssignableExistingCase(caseRow) {
  if (!caseRow) throw new Error("Дело не найдено.");
  if (isDeletedCase(caseRow)) throw new Error("Удалённое дело сначала нужно восстановить.");
  if (cleanText(caseRow["Ответственный"])) {
    throw new Error("У дела уже есть ответственный.");
  }
  if (cleanText(caseRow["Статус"]) !== "Ожидает распределения") {
    throw new Error("Распределять из реестра можно только дела в статусе «Ожидает распределения».");
  }
}

function applyAutomaticQueueEffects(data, normalized, result, state, date) {
  const queueRows = queueRowsFor(data, normalized[FIELD.yuc], normalized[FIELD.caseType]);
  const debtLimit = debtLimitFor(data, normalized[FIELD.yuc], normalized[FIELD.caseType]);
  if (debtLimit > 0) {
    const accrualIds = [...new Set((result.debtAccrualQueueIds ?? []).filter(Boolean))];
    for (const queueId of accrualIds) {
      const row = queueRows.find((item) => cleanText(item.queue_id) === cleanText(queueId));
      if (!row) continue;
      setQueueDebt(row, queueDebtAmount(row) + 1, debtLimit, date);
    }
  }

  if (result.ok) {
    const selectedQueueRow = queueRows.find((row) => cleanText(row[FIELD.name]) === result.candidate);
    if (result.queueEffect === "debt" && selectedQueueRow) {
      setQueueDebt(selectedQueueRow, queueDebtAmount(selectedQueueRow) - 1, debtLimit || Number.POSITIVE_INFINITY, date);
    }
    if ((result.queueEffect === "queue" || result.queueEffect === "debt") && selectedQueueRow) {
      const oldPosition = Number(state["Последняя позиция"]) || 0;
      const newPosition = Number(selectedQueueRow[FIELD.position]) || 0;
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

function recommendFromQueueRows(data, rows, yuc, type, date, basisPrefix = "очередь", options = {}) {
  if (!rows.length) {
    return { ok: false, candidate: "", basis: "", reason: "Для этого ЮЦ и типа дела не настроена очередь." };
  }
  const allowRepeatLastAuto = Boolean(options.allowRepeatLastAuto);
  const state = makeQueueState(data, yuc, type);
  const lastAuto = cleanText(state["Последний автоназначенный"]);
  const lastPosition = Number(state["Последняя позиция"]) || 0;
  const debtLimit = debtLimitFor(data, yuc, type);
  const debtCandidates = debtLimit > 0 ? rows
    .filter((row) => queueDebtAmount(row) > 0)
    .map((row) => ({ row, ...queueCandidateInfo(data, row, type, date) }))
    .filter((item) => item.available)
    .sort((a, b) => {
      const debtDiff = queueDebtAmount(b.row) - queueDebtAmount(a.row);
      const loadDiff = employeeLoad(data, a.employee, type, LOAD_MODE_BY_TYPE, yuc) - employeeLoad(data, b.employee, type, LOAD_MODE_BY_TYPE, yuc);
      return debtDiff || loadDiff || Number(a.row[FIELD.position]) - Number(b.row[FIELD.position]);
    }) : [];
  const debtCandidate = debtCandidates[0] ?? null;
  if (debtCandidate) {
    const debtAmount = queueDebtAmount(debtCandidate.row);
    const basis = basisPrefix === "очередь"
      ? `долг ${debtAmount}: погашение долга, правило «не два подряд» не применяется`
      : `${basisPrefix}: долг ${debtAmount}, правило «не два подряд» не применяется`;
    return recommendationResult(debtCandidate, basis, "debt");
  }

  const ordered = orderedRowsForAssignment(data, rows, yuc, type, lastPosition);
  let availableCount = 0;
  let previousAvailable = false;
  let previousCandidate = null;
  const skippedVacation = [];
  const debtAccrualQueueIds = [];
  for (const row of ordered) {
    const info = queueCandidateInfo(data, row, type, date);
    if (!info.employee) continue;
    if (!yes(info.employee[FIELD.employeeActive]) || !employeeParticipates(info.employee, type)) {
      debtAccrualQueueIds.push(cleanText(row.queue_id));
      continue;
    }
    if (info.vacation) {
      skippedVacation.push(row);
      debtAccrualQueueIds.push(cleanText(row.queue_id));
      continue;
    }
    availableCount += 1;
    if (cleanText(row[FIELD.name]) === lastAuto) {
      previousAvailable = true;
      previousCandidate = { row, ...info, debtAccrualQueueIds: [...debtAccrualQueueIds] };
      continue;
    }
    return recommendationResult({ row, ...info, debtAccrualQueueIds: [...debtAccrualQueueIds] }, basisPrefix, "queue", skippedVacation);
  }
  if (allowRepeatLastAuto && previousCandidate) {
    return recommendationResult(previousCandidate, `${basisPrefix}: ${REGIONAL_REPEAT_BASIS}`, "queue", skippedVacation);
  }
  if (availableCount === 1 && previousAvailable) {
    return failedRecommendation(
      "Единственный доступный сотрудник уже был предыдущим автополучателем этого типа. Нужно ручное решение руководителя.",
      skippedVacation,
    );
  }
  if (availableCount === 0) {
    return failedRecommendation("Нет доступных сотрудников в очереди.", skippedVacation);
  }
  return failedRecommendation("Не найден кандидат по очереди.", skippedVacation);
}

function recommendLeastLoaded(data, rows, yuc, type, date, basis, loadMode = "общая нагрузка") {
  if (!rows.length) {
    return { ok: false, candidate: "", basis: "", reason: "Для этого ЮЦ и типа дела не настроена очередь." };
  }
  const state = makeQueueState(data, yuc, type);
  const lastAuto = cleanText(state["Последний автоназначенный"]);
  const { candidates, skippedVacation } = availableCandidateRows(data, rows, type, date, lastAuto);
  if (!candidates.length) {
    return {
      ok: false,
      candidate: "",
      basis: "",
      reason: "Нет доступных сотрудников вне региона с учётом правила «не два подряд».",
      skippedVacation: skippedVacation.map((item) => cleanText(item["ФИО"])),
    };
  }
  candidates.sort((a, b) =>
    employeeLoad(data, a.employee, type, loadMode, yuc) - employeeLoad(data, b.employee, type, loadMode, yuc) ||
    Number(a.row[FIELD.position]) - Number(b.row[FIELD.position])
  );
  const selected = candidates[0];
  return recommendationResult(selected, basis, "queue", skippedVacation);
}

function recommendGeneral(data, yuc, type, date) {
  return recommendFromQueueRows(data, queueRowsFor(data, yuc, type), yuc, type, date, "очередь");
}

function queuePreviewRows(data, rows, yuc, type, date, recommended = "") {
  const state = makeQueueState(data, yuc, type);
  const lastPosition = Number(state["Последняя позиция"]) || 0;
  const lastAuto = cleanText(state["Последний автоназначенный"]);
  const recommendedName = cleanText(recommended);
  const recommendedPosition = rows
    .map((row) => ({ row, name: cleanText(row[FIELD.name]), position: Number(row[FIELD.position]) || 0 }))
    .find((item) => recommendedName && nameMatches(item.name, recommendedName))?.position || 0;
  const cycleReset = Boolean(lastPosition > 0 && recommendedPosition > 0 && recommendedPosition <= lastPosition);
  return rows
    .map((row) => {
      const info = queueCandidateInfo(data, row, type, date);
      const name = cleanText(row[FIELD.name]);
      const position = Number(row[FIELD.position]) || 0;
      const active = Boolean(info.employee && yes(info.employee[FIELD.employeeActive]));
      const participates = Boolean(info.employee && employeeParticipates(info.employee, type));
      const vacation = Boolean(info.vacation);
      const debt = queueDebtAmount(row);
      const previousAuto = Boolean(lastAuto && name === lastAuto);
      const recommendedRow = Boolean(recommendedName && nameMatches(name, recommendedName));
      const available = Boolean(info.employee && active && participates && !vacation);
      const markers = [];
      if (recommendedRow) markers.push("кандидат");
      if (!info.employee) markers.push("нет в сотрудниках");
      if (info.employee && !active) markers.push("неактивен");
      if (info.employee && !participates) markers.push("не участвует");
      if (vacation) markers.push("отпуск");
      if (debt) markers.push(`долг ${debt}`);
      if (previousAuto) markers.push("предыдущий");
      return {
        position,
        employee_id: cleanText(row.employee_id),
        name,
        displayName: name,
        phase: !cycleReset && lastPosition > 0 && position <= lastPosition ? "passed" : "next",
        active,
        participates,
        vacation,
        debt,
        previousAuto,
        recommended: recommendedRow,
        available,
        load: info.employee ? employeeLoad(data, info.employee, type, LOAD_MODE_BY_TYPE, yuc) : 0,
        markers,
      };
    })
    .sort((a, b) => {
      const loadDiff = a.load - b.load;
      const cycleA = !cycleReset && lastPosition > 0 && a.position <= lastPosition ? 1 : 0;
      const cycleB = !cycleReset && lastPosition > 0 && b.position <= lastPosition ? 1 : 0;
      return loadDiff || cycleA - cycleB || a.position - b.position;
    });
}

function buildQueuePreview(data, draft, recommendation, date = new Date()) {
  const yuc = normalizeYuc(draft[FIELD.yuc]);
  const type = normalizeType(draft[FIELD.caseType]);
  const region = normalizeRegionName(draft["Регион"]);
  if (!CASE_TYPES.includes(type)) return null;

  const settings = yucRegionalSettings(data, yuc);
  const generalRows = queueRowsFor(data, yuc, type);
  let rows = generalRows;
  let mode = "general";
  let title = "Общая очередь";
  let note = "Показывается очередь выбранного ЮЦ и типа нагрузки.";

  if (yes(settings[YUC_SETTING.regionalEnabled])) {
    const assignments = regionalAssignmentsFor(data, yuc, region, type);
    const mainEmployees = uniqueEmployeesByName(assignments
      .map((row) => employeeByName(data, row["Сотрудник"]))
      .filter(Boolean));
    const regionalRows = queueRowsForEmployees(data, yuc, type, mainEmployees);

    if (!assignments.length) {
      mode = "general";
      title = "Общая очередь";
      note = cleanText(settings[YUC_SETTING.missingRegionMode]) === REGIONAL_MODE_ERROR
        ? `Для региона «${region || "не выбран"}» нет закреплений — автоназначение остановлено настройкой ЮЦ.`
        : `Для региона «${region || "не выбран"}» нет закреплений — показана общая очередь.`;
    } else if (cleanText(recommendation?.basis).startsWith("общая очередь после")) {
      mode = "general";
      title = "Общая очередь";
      note = `Региональные юристы по региону «${region}» недоступны; показана общая очередь.`;
    } else if (cleanText(recommendation?.basis).startsWith("замещение региональной очереди")) {
      const substitutions = regionalSubstitutionsFor(data, yuc, region, type, mainEmployees);
      const substituteEmployees = uniqueEmployeesByName(substitutions
        .map((row) => employeeByName(data, row["Замещающий сотрудник"]))
        .filter(Boolean));
      rows = queueRowsForEmployees(data, yuc, type, substituteEmployees);
      mode = "substitution";
      title = "Очередь замещения";
      note = `Все региональные юристы недоступны; показаны заместители для региона «${region}».`;
    } else if (cleanText(recommendation?.basis).startsWith("вне региона")) {
      const regionalNames = mainEmployees.map((employee) => cleanText(employee[FIELD.name])).filter(Boolean);
      rows = generalRows.filter((row) => !regionalNames.some((name) => nameMatches(row[FIELD.name], name)));
      mode = "outside-region";
      title = "Очередь вне региона";
      note = "Региональная группа перегружена сверх порога; показаны доступные сотрудники вне региона.";
    } else if (cleanText(recommendation?.basis).startsWith("региональная очередь") || regionalRows.length) {
      rows = regionalRows;
      mode = "regional";
      title = "Региональная очередь";
      note = `Показаны сотрудники, закрепленные за регионом «${region}».`;
    }
  }

  const state = makeQueueState(data, yuc, type);
  const previewRows = queuePreviewRows(data, rows, yuc, type, date, recommendation?.candidate);
  const rawLastPosition = Number(state["Последняя позиция"]) || 0;
  const recommendedRow = previewRows.find((row) => row.recommended);
  const cycleReset = Boolean(rawLastPosition > 0 && recommendedRow?.position > 0 && recommendedRow.position <= rawLastPosition);
  return {
    mode,
    title,
    note,
    yuc,
    region,
    type,
    lastPosition: cycleReset ? 0 : rawLastPosition,
    lastAuto: cleanText(state["Последний автоназначенный"]),
    cycle: (Number(state["Цикл"]) || 1) + (cycleReset ? 1 : 0),
    cycleReset,
    recommended: cleanText(recommendation?.candidate),
    rows: previewRows,
    passedCount: previewRows.filter((row) => row.phase === "passed").length,
    nextCount: previewRows.filter((row) => row.phase === "next").length,
  };
}

export function recommend(data, draft, date = new Date()) {
  const yuc = cleanText(draft[FIELD.yuc]) || "Дальний Восток";
  const normalizedYuc = normalizeYuc(yuc);
  const type = normalizeType(draft[FIELD.caseType]);
  const region = normalizeRegionName(draft["Регион"]);
  if (!CASE_TYPES.includes(type)) {
    return { ok: false, candidate: "", basis: "", reason: "Укажите тип дела: претензия, административное или судебное." };
  }

  const settings = yucRegionalSettings(data, normalizedYuc);
  if (!yes(settings[YUC_SETTING.regionalEnabled])) {
    return recommendGeneral(data, normalizedYuc, type, date);
  }

  const assignments = regionalAssignmentsFor(data, normalizedYuc, region, type);
  if (!assignments.length) {
    if (cleanText(settings[YUC_SETTING.missingRegionMode]) === REGIONAL_MODE_ERROR) {
      return {
        ok: false,
        candidate: "",
        basis: "",
        reason: `Для региона «${region || "не выбран"}» не настроены региональные закрепления.`,
      };
    }
    return recommendGeneral(data, normalizedYuc, type, date);
  }

  const mainEmployees = uniqueEmployeesByName(assignments
    .map((row) => employeeByName(data, row["Сотрудник"]))
    .filter(Boolean));
  const regionalRows = queueRowsForEmployees(data, normalizedYuc, type, mainEmployees);
  const state = makeQueueState(data, normalizedYuc, type);
  const lastAuto = cleanText(state["Последний автоназначенный"]);
  const regionalAvailability = availableCandidateRows(data, regionalRows, type, date, "");
  const availableRegional = regionalAvailability.candidates;

  if (availableRegional.length) {
    const allRows = queueRowsFor(data, normalizedYuc, type);
    const regionalNames = mainEmployees.map((employee) => cleanText(employee[FIELD.name])).filter(Boolean);
    const outsideRows = allRows.filter((row) => !regionalNames.some((name) => nameMatches(row[FIELD.name], name)));
    const outsideAvailability = availableCandidateRows(data, outsideRows, type, date, "");
    const outsideCandidates = outsideAvailability.candidates;
    const allowOutside = yes(settings[YUC_SETTING.allowOutsideRegion]);
    const overloadThreshold = Number(settings[YUC_SETTING.overloadThreshold]) || 0;
    const loadMode = cleanText(settings[YUC_SETTING.overloadMode]) || LOAD_MODE_TOTAL;

    if (allowOutside && outsideCandidates.length) {
      const minRegionalLoad = Math.min(...availableRegional.map((item) => employeeLoad(data, item.employee, type, loadMode, normalizedYuc)));
      const minOutsideLoad = Math.min(...outsideCandidates.map((item) => employeeLoad(data, item.employee, type, loadMode, normalizedYuc)));
      if (minRegionalLoad - minOutsideLoad > overloadThreshold) {
        const outside = recommendFromQueueRows(
          data,
          outsideRows,
          normalizedYuc,
          type,
          date,
          `вне региона: перегруз региональной группы ${minRegionalLoad - minOutsideLoad} > ${overloadThreshold}`,
        );
        return {
          ...outside,
          skippedVacation: [
            ...vacationNames(regionalAvailability.skippedVacation),
            ...(outside.skippedVacation ?? []),
          ].filter(Boolean),
        };
      }
    }

    const regional = recommendFromQueueRows(
      data,
      regionalRows,
      normalizedYuc,
      type,
      date,
      `региональная очередь: ${region}`,
      { allowRepeatLastAuto: true },
    );
    if (regional.ok) return regional;
    return {
      ...regional,
      reason: `${regional.reason} Региональные очереди включены, уход вне региона не разрешён условиями перегруза.`,
    };
  }

  const unavailableMode = cleanText(settings[YUC_SETTING.unavailableRegionalMode]) || REGIONAL_UNAVAILABLE_SUBSTITUTE_THEN_GENERAL;
  if (unavailableMode === REGIONAL_MODE_ERROR) {
    return {
      ok: false,
      candidate: "",
      basis: "",
      reason: `Все региональные юристы по региону «${region}» недоступны для типа «${type}».`,
      skippedVacation: vacationNames(regionalAvailability.skippedVacation),
    };
  }

  if (unavailableMode === REGIONAL_UNAVAILABLE_SUBSTITUTE_THEN_GENERAL) {
    const substitutions = regionalSubstitutionsFor(data, normalizedYuc, region, type, mainEmployees);
    const substituteEmployees = uniqueEmployeesByName(substitutions
      .map((row) => employeeByName(data, row["Замещающий сотрудник"]))
      .filter(Boolean));
    const substituteRows = queueRowsForEmployees(data, normalizedYuc, type, substituteEmployees);
    const substitute = recommendFromQueueRows(
      data,
      substituteRows,
      normalizedYuc,
      type,
      date,
      `замещение региональной очереди: ${region}`,
      { allowRepeatLastAuto: true },
    );
    if (substitute.ok) {
      return {
        ...substitute,
        skippedVacation: [
          ...vacationNames(regionalAvailability.skippedVacation),
          ...(substitute.skippedVacation ?? []),
        ].filter(Boolean),
      };
    }
  }

  return {
    ...recommendGeneral(data, normalizedYuc, type, date),
    basis: "общая очередь после недоступности региональных юристов",
  };
}

export function recommendWithPreview(data, draft, date = new Date()) {
  const result = recommend(data, draft, date);
  return {
    ...result,
    queuePreview: buildQueuePreview(data, draft, result, date),
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
  if (isDeletedCase(caseRow)) throw new Error("Удалённое дело сначала нужно восстановить.");
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

export function completeCaseByDeadline(data, caseId, date = new Date()) {
  const caseRow = caseById(data, caseId);
  if (!caseRow) throw new Error("Дело не найдено.");
  if (isDeletedCase(caseRow)) throw new Error("Удалённое дело сначала нужно восстановить.");
  const normalized = normalizeDraft(caseRow);
  const previousStatus = cleanText(caseRow["Статус"]) || "В работе";
  if (previousStatus === "Завершено") return { case: caseRow, changed: false };

  Object.assign(caseRow, {
    "Статус": "Завершено",
    "Дата завершения": todayISO(date),
    "Дата предупреждения о завершении": todayISO(date),
    "Комментарий": cleanText(caseRow["Комментарий"]),
  });

  data.journal.push({
    "Дата события": nowISO(date),
    case_id: cleanText(caseRow.case_id),
    "Тип дела": normalized["Тип дела"],
    "Ответственный": cleanText(caseRow["Ответственный"]),
    "Основание": "Завершение по контрольному сроку",
    "Способ": "контроль срока",
    "ЮЦ": normalized["ЮЦ"],
    "Цикл": "",
    "Предложенный системой": "",
    "Комментарий": `Дело завершено руководителем после предупреждения. Предыдущий статус: ${previousStatus}.`,
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
  const normalized = normalizeDraft(caseRow);

  Object.assign(caseRow, {
    "Отложить завершение до": postponedDate,
    "Причина отложения завершения дела": note,
    "Дата предупреждения о завершении": todayISO(date),
    "Комментарий": cleanText(caseRow["Комментарий"]),
  });

  data.journal.push({
    "Дата события": nowISO(date),
    case_id: cleanText(caseRow.case_id),
    "Тип дела": normalized["Тип дела"],
    "Ответственный": cleanText(caseRow["Ответственный"]),
    "Основание": "Отложено завершение по контрольному сроку",
    "Способ": "контроль срока",
    "ЮЦ": normalized["ЮЦ"],
    "Цикл": "",
    "Предложенный системой": "",
    "Комментарий": `Завершение отложено до ${postponedDate}. Причина: ${note}`,
  });

  return { case: caseRow, changed: true };
}

export function deleteCase(data, caseId, confirmCaseId, date = new Date()) {
  const caseRow = caseById(data, caseId);
  if (!caseRow) throw new Error("Дело не найдено.");
  const normalizedId = cleanText(caseRow.case_id);
  if (cleanText(confirmCaseId) !== normalizedId) {
    throw new Error(`Для удаления нужно ввести точный ID дела: ${normalizedId}`);
  }
  if (isDeletedCase(caseRow)) return { case: caseRow, changed: false };
  const previousStatus = cleanText(caseRow["Статус"]) || "В работе";
  const normalized = normalizeDraft(caseRow);

  Object.assign(caseRow, {
    "Статус": DELETED_STATUS,
    "Дата завершения": todayISO(date),
    "Комментарий": cleanText(caseRow["Комментарий"]),
  });

  data.journal.push({
    "Дата события": nowISO(date),
    case_id: normalizedId,
    "Тип дела": normalized["Тип дела"],
    "Ответственный": cleanText(caseRow["Ответственный"]),
    "Основание": "Мягкое удаление дела",
    "Способ": "ручное",
    "ЮЦ": normalized["ЮЦ"],
    "Цикл": "",
    "Предложенный системой": "",
    "Комментарий": `Дело помечено как удалённое. Предыдущий статус: ${previousStatus}.`,
  });

  return { case: caseRow, changed: true, previousStatus };
}

export function restoreCase(data, caseId, date = new Date()) {
  const caseRow = caseById(data, caseId);
  if (!caseRow) throw new Error("Дело не найдено.");
  if (!isDeletedCase(caseRow)) return { case: caseRow, changed: false };
  const restoredStatus = cleanText(caseRow["Ответственный"]) ? "В работе" : "Ожидает распределения";
  const normalized = normalizeDraft(caseRow);

  Object.assign(caseRow, {
    "Статус": restoredStatus,
    "Дата завершения": "",
    "Комментарий": cleanText(caseRow["Комментарий"]),
  });

  data.journal.push({
    "Дата события": nowISO(date),
    case_id: cleanText(caseRow.case_id),
    "Тип дела": normalized["Тип дела"],
    "Ответственный": cleanText(caseRow["Ответственный"]),
    "Основание": "Восстановление удалённого дела",
    "Способ": "ручное",
    "ЮЦ": normalized["ЮЦ"],
    "Цикл": "",
    "Предложенный системой": "",
    "Комментарий": `Дело восстановлено со статусом «${restoredStatus}».`,
  });

  return { case: caseRow, changed: true, restoredStatus };
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

function vacationRowsFromDates(employee, dates, comment = "", date = new Date()) {
  const normalizedDates = [...new Set((dates ?? []).map(toISODate).filter(Boolean))].sort();
  const rows = [];
  let start = null;
  let prev = null;
  for (const day of normalizedDates) {
    if (!start) {
      start = day;
      prev = day;
      continue;
    }
    if (allDatesInRange(prev, day).length === 2) {
      prev = day;
      continue;
    }
    rows.push({
      employee_id: cleanText(employee.employee_id),
      "ФИО": cleanText(employee["ФИО"]),
      "Дата начала": start,
      "Дата окончания": prev,
      "Тип": "Отпуск",
      "Комментарий": comment,
      "Изменено": nowISO(date),
    });
    start = day;
    prev = day;
  }
  if (start) {
    rows.push({
      employee_id: cleanText(employee.employee_id),
      "ФИО": cleanText(employee["ФИО"]),
      "Дата начала": start,
      "Дата окончания": prev,
      "Тип": "Отпуск",
      "Комментарий": comment,
      "Изменено": nowISO(date),
    });
  }
  return rows;
}

function replaceEmployeeDatesInScope(data, employeeId, scopeDates, vacationDates, comment = "", date = new Date()) {
  const employee = data.employees.find((item) => cleanText(item.employee_id) === cleanText(employeeId));
  if (!employee) throw new Error("Сотрудник не найден.");
  const scope = new Set((scopeDates ?? []).map(toISODate).filter(Boolean));
  if (!scope.size) throw new Error("Нет дат для сохранения.");
  const targetId = cleanText(employeeId);
  const currentOutsideScope = [];
  for (const item of (data.vacations ?? []).map(normalizeVacation)) {
    if (!item.employee_id || !item["Дата начала"]) continue;
    if (cleanText(item.employee_id) !== targetId) {
      currentOutsideScope.push(item);
      continue;
    }
    const outsideDates = allDatesInRange(item["Дата начала"], item["Дата окончания"] || item["Дата начала"])
      .filter((day) => !scope.has(day));
    currentOutsideScope.push(...vacationRowsFromDates(employee, outsideDates, item["Комментарий"], date));
  }
  const newRows = vacationRowsFromDates(employee, vacationDates, comment, date);
  data.vacations = [...currentOutsideScope, ...newRows].sort((a, b) =>
    cleanText(a["ФИО"]).localeCompare(cleanText(b["ФИО"]), "ru") ||
    cleanText(a["Дата начала"]).localeCompare(cleanText(b["Дата начала"]))
  );
  return vacationDatesForEmployee(data.vacations, employeeId);
}

export function setVacationDates(data, employeeId, dates, enabled, date = new Date()) {
  const employee = data.employees.find((item) => cleanText(item.employee_id) === cleanText(employeeId));
  if (!employee) throw new Error("Сотрудник не найден.");
  const normalizedDates = [...new Set(dates.map(toISODate).filter(Boolean))].sort();
  const current = new Set(vacationDatesForEmployee(data.vacations, employeeId));
  for (const day of normalizedDates) {
    if (enabled) current.add(day);
    else current.delete(day);
  }
  return replaceEmployeeDatesInScope(data, employeeId, normalizedDates, [...current].filter((day) => normalizedDates.includes(day)), "", date);
}

export function replaceVacationYear(data, employeeId, year, dates, date = new Date()) {
  const scopeDates = allDatesInRange(`${Number(year)}-01-01`, `${Number(year)}-12-31`);
  const vacationDates = [...new Set((dates ?? []).map(toISODate).filter((day) => day.startsWith(`${Number(year)}-`)))].sort();
  return replaceEmployeeDatesInScope(data, employeeId, scopeDates, vacationDates, "", date);
}

export function clearVacationYear(data, employeeId, year) {
  return replaceVacationYear(data, employeeId, year, []);
}

export function replaceVacationDatesForEmployees(data, employeePlans, scopeDates, date = new Date()) {
  const scope = new Set((scopeDates ?? []).map(toISODate).filter(Boolean));
  const plans = (employeePlans ?? [])
    .map((plan) => ({
      employee_id: cleanText(plan.employee_id),
      vacationDates: [...new Set((plan.vacationDates ?? []).map(toISODate).filter((day) => scope.has(day)))].sort(),
    }))
    .filter((plan) => plan.employee_id);
  const planIds = new Set(plans.map((plan) => plan.employee_id));
  const employeesById = new Map((data.employees ?? []).map((employee) => [cleanText(employee.employee_id), employee]));
  if (!scope.size) throw new Error("В плане импорта нет дат.");
  if (!plans.length) throw new Error("В плане импорта нет сопоставленных сотрудников.");

  const preserved = [];
  for (const item of (data.vacations ?? []).map(normalizeVacation)) {
    if (!item.employee_id || !item["Дата начала"]) continue;
    if (!planIds.has(cleanText(item.employee_id))) {
      preserved.push(item);
      continue;
    }
    const employee = employeesById.get(cleanText(item.employee_id));
    if (!employee) continue;
    const outsideDates = allDatesInRange(item["Дата начала"], item["Дата окончания"] || item["Дата начала"])
      .filter((day) => !scope.has(day));
    preserved.push(...vacationRowsFromDates(employee, outsideDates, item["Комментарий"], date));
  }
  data.vacations = preserved;

  let added = 0;
  for (const plan of plans) {
    const employee = employeesById.get(plan.employee_id);
    if (!employee) continue;
    data.vacations.push(...vacationRowsFromDates(employee, plan.vacationDates, "Импорт из Excel", date));
    added += plan.vacationDates.length;
  }

  data.vacations.sort((a, b) =>
    cleanText(a["ФИО"]).localeCompare(cleanText(b["ФИО"]), "ru") ||
    cleanText(a["Дата начала"]).localeCompare(cleanText(b["Дата начала"]))
  );

  return {
    employees: plans.length,
    scopeDates: scope.size,
    vacationDays: added,
  };
}
