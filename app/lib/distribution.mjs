// Алгоритм рекомендаций, очередей, нагрузки и назначения дел.
import { normalizeRegionName } from "./regions.mjs";
import { FIELD, YUC_SETTING } from "./domain-schema.mjs";
import { changeCaseResponsible, completeCaseByDeadline, deleteCase, postponeCaseCompletion, restoreCase } from "./case-lifecycle.mjs";
import { allDatesInRange, clearVacationYear, isEmployeeOnVacation, normalizeVacation, replaceVacationDatesForEmployees, replaceVacationYear, setVacationDates, vacationDatesForEmployee, vacationKey } from "./vacations.mjs";
import {
  addDays,
  cleanMultilineText,
  cleanText,
  daysBetween,
  nameMatches,
  normalizeType,
  normalizeYuc,
  nowISO,
  parseISODate,
  shortName,
  todayISO,
  toISODate,
  workloadType,
  yes,
  yesNo,
} from "./domain-values.mjs";
export { FIELD, YUC_SETTING } from "./domain-schema.mjs";
export { changeCaseResponsible, completeCaseByDeadline, deleteCase, postponeCaseCompletion, restoreCase } from "./case-lifecycle.mjs";
export { allDatesInRange, clearVacationYear, isEmployeeOnVacation, normalizeVacation, replaceVacationDatesForEmployees, replaceVacationYear, setVacationDates, vacationDatesForEmployee, vacationKey } from "./vacations.mjs";

export {
  addDays,
  cleanMultilineText,
  cleanText,
  daysBetween,
  nameMatches,
  normalizeType,
  normalizeYuc,
  nowISO,
  parseISODate,
  shortName,
  todayISO,
  toISODate,
  workloadType,
  yes,
  yesNo,
} from "./domain-values.mjs";

export const SHEETS = {
  cases: "Дела",
  employees: "Сотрудники",
  queues: "Очереди",
  state: "Состояние",
  vacations: "Отпуска",
  settings: "Настройки",
  yucSettings: "Настройки ЮЦ",
  regionalAssignments: "Региональные закрепления",
  regionalSubstitutions: "Региональные замещения",
  loadCoefficients: "Коэффициенты нагрузки",
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
  "Движение дела",
  "Документы",
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
  "Логин",
  "Хэш-пароля",
  "Роль доступа",
  "Хэш кода первичного входа",
  "Срок действия кода",
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

export const SETTINGS_HEADERS = ["ЮЦ", "Тип дела", "Активность, дни", "Автозавершение, дни", "Учитывать долг", "Максимальный долг", "Порог перегруза"];

export const YUC_SETTINGS_HEADERS = [
  "Название",
  "ЮЦ",
  "Региональные очереди вкл\\выкл",
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

export const CASE_TYPES = ["претензия", "административное", "судебное", "уголовное", "банкротное"];
export const WORKLOAD_TYPES = ["претензия", "административное", "судебное"];

const DELETED_STATUS = "Удалено";
const COMPLETE_STATUSES = new Set(["Завершено", "Отменено", DELETED_STATUS]);
const LOAD_MODE_TOTAL = "общая нагрузка";
const LOAD_MODE_BY_TYPE = "тип нагрузки";
export const DEFAULT_OVERLOAD_THRESHOLD = 5;
const REGIONAL_UNAVAILABLE_SUBSTITUTE_THEN_GENERAL = "заместитель затем общая очередь";
const REGIONAL_MODE_ERROR = "ошибка";
const REGIONAL_REPEAT_BASIS = "повтор допускается региональным правилом";
export function typeSettings(settings, yuc, type) {
  const normalizedYuc = normalizeYuc(yuc);
  const normalized = workloadType(type);
  return (settings ?? []).find((item) =>
    normalizeYuc(item[FIELD.yuc]) === normalizedYuc &&
    normalizeType(item[FIELD.caseType]) === normalized
  ) ?? (settings ?? []).find((item) =>
    !cleanText(item[FIELD.yuc]) &&
    normalizeType(item[FIELD.caseType]) === normalized
  );
}

export function activityDays(settings, yuc, type) {
  const normalized = workloadType(type);
  const row = typeSettings(settings, yuc, normalized);
  const days = Number(row?.["Активность, дни"] ?? row?.["Срок актуальности"]);
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_ACTIVITY_DAYS[normalized] ?? "";
}

export function autocompletionDays(settings, yuc, type) {
  const normalized = workloadType(type);
  const row = typeSettings(settings, yuc, normalized);
  const days = Number(row?.["Автозавершение, дни"]);
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_AUTOCOMPLETE_DAYS[normalized] ?? "";
}

export function debtEnabled(settings, yuc, type) {
  const row = typeSettings(settings, yuc, workloadType(type));
  return yes(row?.["Учитывать долг"]);
}

export function maxDebt(settings, yuc, type) {
  const row = typeSettings(settings, yuc, workloadType(type));
  const value = Number(row?.["Максимальный долг"]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function overloadThreshold(settings, yuc, type) {
  const raw = typeSettings(settings, yuc, workloadType(type))?.["Порог перегруза"];
  if (!cleanText(raw)) return DEFAULT_OVERLOAD_THRESHOLD;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_OVERLOAD_THRESHOLD;
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

export function employeeParticipates(employee, type) {
  if (cleanText(employee?.employee_id) === "EMP-000") return false;
  const normalized = workloadType(type);
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
  const cases = (data.cases ?? []).map((item) => caseDerived(item, data.settings, date));
  const activeRegisterCases = cases.filter((caseRow) => !isDeletedCase(caseRow));
  const sourceEmployees = (data.employees ?? []).filter((employee) => cleanText(employee.employee_id) !== "EMP-000");
  const employeeNameIndex = new Map();
  const activeLoads = sourceEmployees.map(() => ({ total: 0, judicial: 0, administrative: 0, claim: 0 }));
  for (let index = 0; index < sourceEmployees.length; index += 1) {
    const name = cleanText(sourceEmployees[index][FIELD.name]);
    const aliases = new Set([name, shortName(name)].filter(Boolean));
    for (const alias of aliases) {
      if (!employeeNameIndex.has(alias)) employeeNameIndex.set(alias, []);
      employeeNameIndex.get(alias).push(index);
    }
  }
  let activeCasesCount = 0;
  let unassignedCases = 0;
  const totalsByType = new Map(WORKLOAD_TYPES.map((type) => [workloadType(type), { total: 0, active: 0 }]));
  for (const caseRow of activeRegisterCases) {
    const active = caseRow["Активное число"] === 1;
    const responsible = cleanText(caseRow[FIELD.responsible]);
    const normalizedType = workloadType(caseRow[FIELD.caseType]);
    if (active) activeCasesCount += 1;
    if (!responsible) unassignedCases += 1;
    const typeTotals = totalsByType.get(normalizedType);
    if (typeTotals) {
      typeTotals.total += 1;
      if (active) typeTotals.active += 1;
    }
    if (!active || !responsible) continue;
    const candidateIndexes = new Set([
      ...(employeeNameIndex.get(responsible) ?? []),
      ...(employeeNameIndex.get(shortName(responsible)) ?? []),
    ]);
    for (const index of candidateIndexes) {
      const employeeName = sourceEmployees[index][FIELD.name];
      if (!nameMatches(responsible, employeeName)) continue;
      const load = activeLoads[index];
      load.total += 1;
      if (normalizedType === "судебное") load.judicial += 1;
      else if (normalizedType === "административное") load.administrative += 1;
      else if (normalizedType === "претензия") load.claim += 1;
    }
  }
  const employees = sourceEmployees.map((employee, index) => {
    const load = activeLoads[index];
    return {
      ...employee,
      "Отпуск с": toISODate(employee["Отпуск с"]),
      "Отпуск по": toISODate(employee["Отпуск по"]),
      "Сейчас в отпуске": isEmployeeOnVacation(employee, date, vacations) ? "Да" : "Нет",
      "Активные всего": load.total,
      "Активные судебные": load.judicial,
      "Активные административные": load.administrative,
      "Активные претензии": load.claim,
    };
  });
  const summary = {
    totalCases: activeRegisterCases.length,
    activeCases: activeCasesCount,
    unassignedCases,
    activeEmployees: employees.filter((item) => yes(item[FIELD.employeeActive])).length,
    byType: WORKLOAD_TYPES.map((type) => ({
      type,
      total: totalsByType.get(workloadType(type))?.total ?? 0,
      active: totalsByType.get(workloadType(type))?.active ?? 0,
      activityDays: DEFAULT_ACTIVITY_DAYS[workloadType(type)] ?? "",
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
  return `QUEUE-${normalizeYuc(yuc)}-${workloadType(type)}`;
}

export function makeQueueState(data, yuc, type) {
  const normalizedType = workloadType(type);
  const normalizedYuc = normalizeYuc(yuc);
  const queueId = makeQueueId(normalizedYuc, normalizedType);
  let state = data.state.find((item) =>
    normalizeYuc(item[FIELD.yuc]) === normalizedYuc &&
    workloadType(item[FIELD.caseType]) === normalizedType
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
  const normalizedType = workloadType(type);
  return data.queues
    .filter((row) => normalizeYuc(row[FIELD.yuc]) === normalizedYuc && workloadType(row[FIELD.caseType]) === normalizedType)
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
    [YUC_SETTING.allowOutsideRegion]: "Да",
    [YUC_SETTING.includeInactiveLoad]: "Нет",
    [YUC_SETTING.missingRegionMode]: "общая очередь",
    [YUC_SETTING.unavailableRegionalMode]: REGIONAL_UNAVAILABLE_SUBSTITUTE_THEN_GENERAL,
  };
}

function regionalTypeMatches(value, type) {
  const normalized = normalizeType(value);
  return normalized === "все" || workloadType(normalized) === workloadType(type);
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

function queueRowForEmployee(data, yuc, type, employee) {
  const employeeId = cleanText(employee?.employee_id);
  const name = cleanText(employee?.[FIELD.name]);
  return queueRowsFor(data, yuc, type).find((row) =>
    (employeeId && cleanText(row.employee_id) === employeeId) ||
    (name && nameMatches(row[FIELD.name], name))
  );
}

function substitutionRowsForRegionalAbsence(data, yuc, region, type, mainEmployees, regionalRows, date) {
  const result = [];
  const usedSubstitutes = new Set();
  for (const regionalRow of regionalRows.slice().sort((a, b) => Number(a[FIELD.position]) - Number(b[FIELD.position]))) {
    const mainEmployee = employeeForQueueRow(data, regionalRow);
    if (!mainEmployee || isEmployeeAvailable(mainEmployee, type, date, data.vacations ?? [])) continue;
    const mainName = cleanText(mainEmployee[FIELD.name]);
    const substitutions = (data.regionalSubstitutions ?? []).filter((row) =>
      yes(row[FIELD.ruleActive]) &&
      normalizeYuc(row[FIELD.yuc]) === normalizeYuc(yuc) &&
      normalizeRegionName(row["Регион"]) === normalizeRegionName(region) &&
      regionalTypeMatches(row[FIELD.workloadType], type) &&
      nameMatches(row["Основной сотрудник"], mainName)
    );
    for (const substitution of substitutions) {
      const substitute = employeeByName(data, substitution["Замещающий сотрудник"]);
      const substituteRow = queueRowForEmployee(data, yuc, type, substitute);
      const substituteKey = queueRowKey(substituteRow);
      if (!substitute || !substituteRow || !substituteKey || usedSubstitutes.has(substituteKey)) continue;
      usedSubstitutes.add(substituteKey);
      result.push({
        ...substituteRow,
        [FIELD.position]: Number(regionalRow[FIELD.position]) || Number(substituteRow[FIELD.position]) || 0,
        "Замещает": mainName,
      });
    }
  }
  return result;
}

function includeInactiveInLoad(data, yuc) {
  return yes(yucRegionalSettings(data, yuc)[YUC_SETTING.includeInactiveLoad]);
}

function caseForLoad(data, caseRow, date = new Date()) {
  return caseDerived(caseRow, data.settings ?? [], date);
}

function employeeLoad(data, employee, type, mode = LOAD_MODE_TOTAL, yuc = employee?.[FIELD.yuc], date = new Date()) {
  const name = cleanText(employee?.[FIELD.name]);
  if (!name) return 0;
  const normalizedYuc = normalizeYuc(yuc);
  const normalizedType = workloadType(type);
  const includeInactive = includeInactiveInLoad(data, normalizedYuc);
  return (data.cases ?? []).filter((caseRow) => {
    const calculated = caseForLoad(data, caseRow, date);
    const status = cleanText(calculated[FIELD.status]) || "В работе";
    if (COMPLETE_STATUSES.has(status)) return false;
    if (normalizedYuc && normalizeYuc(calculated[FIELD.yuc]) !== normalizedYuc) return false;
    if (!includeInactive && Number(calculated["Активное число"]) !== 1) return false;
    if (!nameMatches(calculated[FIELD.responsible], name)) return false;
    if (mode === LOAD_MODE_BY_TYPE && workloadType(calculated[FIELD.caseType]) !== normalizedType) return false;
    return true;
  }).length;
}

function rowAssignmentLoad(data, row, yuc, type, date = new Date()) {
  const info = queueCandidateInfo(data, row, type, date);
  return info.employee ? employeeLoad(data, info.employee, type, LOAD_MODE_BY_TYPE, yuc, date) : Number.POSITIVE_INFINITY;
}

function queueRowKey(row) {
  const queueId = cleanText(row?.queue_id);
  const employeeId = cleanText(row?.employee_id);
  const name = cleanText(row?.[FIELD.name]);
  return [queueId, employeeId || name].filter(Boolean).join("::");
}

function sameQueueRow(row, key) {
  const normalizedKey = cleanText(key);
  if (!normalizedKey) return false;
  if (queueRowKey(row) === normalizedKey) return true;
  return !normalizedKey.includes("::") && cleanText(row?.queue_id) === normalizedKey;
}

function compareRowsForAssignment(data, yuc, type, lastPosition = 0, date = new Date()) {
  return (a, b) => {
    const loadDiff = rowAssignmentLoad(data, a, yuc, type, date) - rowAssignmentLoad(data, b, yuc, type, date);
    if (loadDiff) return loadDiff;
    const posA = Number(a[FIELD.position]) || 0;
    const posB = Number(b[FIELD.position]) || 0;
    const cycleA = lastPosition > 0 && posA <= lastPosition ? 1 : 0;
    const cycleB = lastPosition > 0 && posB <= lastPosition ? 1 : 0;
    return cycleA - cycleB || posA - posB;
  };
}

function orderedRowsForAssignment(data, rows, yuc, type, lastPosition = 0, date = new Date()) {
  return rows.slice().sort(compareRowsForAssignment(data, yuc, type, lastPosition, date));
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
    substituteFor: cleanText(candidateInfo.row["Замещает"]),
    basis,
    queueEffect,
    reason: "",
    skippedVacation: vacationNames(skippedVacation),
    debtAccrualQueueIds: candidateInfo.debtAccrualQueueIds ?? [],
  };
}

function crossedQueueRows(rows, lastPosition, selectedPosition) {
  const selected = Number(selectedPosition) || 0;
  if (!selected) return [];
  const last = Number(lastPosition) || 0;
  return rows
    .slice()
    .sort((a, b) => Number(a[FIELD.position]) - Number(b[FIELD.position]))
    .filter((row) => {
      const position = Number(row[FIELD.position]) || 0;
      if (!position) return false;
      if (!last) return position <= selected;
      if (selected <= last) return position > last || position <= selected;
      return position > last && position <= selected;
    });
}

function unavailableDebtAccrualForCrossedRows(data, rows, type, date, lastPosition, selectedRow) {
  const selectedQueueKey = queueRowKey(selectedRow);
  const selectedPosition = Number(selectedRow?.[FIELD.position]) || 0;
  const debtAccrualQueueIds = [];
  const skippedVacation = [];
  for (const row of crossedQueueRows(rows, lastPosition, selectedPosition)) {
    if (selectedQueueKey && queueRowKey(row) === selectedQueueKey) continue;
    const info = queueCandidateInfo(data, row, type, date);
    if (!info.employee) continue;
    if (!yes(info.employee[FIELD.employeeActive]) || !employeeParticipates(info.employee, type)) {
      debtAccrualQueueIds.push(queueRowKey(row));
      continue;
    }
    if (info.vacation) {
      skippedVacation.push(row);
      debtAccrualQueueIds.push(queueRowKey(row));
    }
  }
  return { debtAccrualQueueIds, skippedVacation };
}

function unavailableDebtAccrualForRows(data, rows, type, date) {
  const debtAccrualQueueIds = [];
  const skippedVacation = [];
  for (const row of rows) {
    const info = queueCandidateInfo(data, row, type, date);
    if (!info.employee) continue;
    if (!yes(info.employee[FIELD.employeeActive]) || !employeeParticipates(info.employee, type)) {
      debtAccrualQueueIds.push(queueRowKey(row));
      continue;
    }
    if (info.vacation) {
      skippedVacation.push(row);
      debtAccrualQueueIds.push(queueRowKey(row));
    }
  }
  return { debtAccrualQueueIds, skippedVacation };
}

function mergeRecommendationDebt(result, extraDebt) {
  return {
    ...result,
    skippedVacation: [
      ...vacationNames(extraDebt.skippedVacation),
      ...(result.skippedVacation ?? []),
    ].filter(Boolean),
    debtAccrualQueueIds: [
      ...new Set([
        ...(extraDebt.debtAccrualQueueIds ?? []),
        ...(result.debtAccrualQueueIds ?? []),
      ].filter(Boolean)),
    ],
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
      const row = queueRows.find((item) => sameQueueRow(item, queueId));
      if (!row) continue;
      setQueueDebt(row, queueDebtAmount(row) + 1, debtLimit, date);
    }
  }

  if (result.ok) {
    const selectedQueueRow = queueRows.find((row) =>
      cleanText(row.employee_id) && cleanText(row.employee_id) === cleanText(result.employee_id)
    ) ?? queueRows.find((row) => nameMatches(row[FIELD.name], result.candidate));
    if (result.queueEffect === "debt" && selectedQueueRow) {
      setQueueDebt(selectedQueueRow, queueDebtAmount(selectedQueueRow) - 1, debtLimit || Number.POSITIVE_INFINITY, date);
    }
    if ((result.queueEffect === "queue" || result.queueEffect === "debt") && selectedQueueRow) {
      const oldPosition = Number(state["Последняя позиция"]) || 0;
      const newPosition = Number(result.position) || Number(selectedQueueRow[FIELD.position]) || 0;
      if (oldPosition > 0 && newPosition <= oldPosition) {
        state["Цикл"] = (Number(state["Цикл"]) || 1) + 1;
      }
      state["Последняя позиция"] = newPosition;
    }
    state["Последний автоназначенный"] = result.candidate;
    state["Дата последнего автоназначения"] = nowISO(date);
  }
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
      const loadDiff = employeeLoad(data, a.employee, type, LOAD_MODE_BY_TYPE, yuc, date) - employeeLoad(data, b.employee, type, LOAD_MODE_BY_TYPE, yuc, date);
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

  const ordered = orderedRowsForAssignment(data, rows, yuc, type, lastPosition, date);
  let availableCount = 0;
  let previousAvailable = false;
  let previousCandidate = null;
  const skippedVacation = [];
  for (const row of ordered) {
    const info = queueCandidateInfo(data, row, type, date);
    if (!info.employee) continue;
    if (!yes(info.employee[FIELD.employeeActive]) || !employeeParticipates(info.employee, type)) {
      continue;
    }
    if (info.vacation) {
      skippedVacation.push(row);
      continue;
    }
    availableCount += 1;
    if (cleanText(row[FIELD.name]) === lastAuto) {
      previousAvailable = true;
      previousCandidate = { row, ...info };
      continue;
    }
    const crossed = unavailableDebtAccrualForCrossedRows(data, rows, type, date, lastPosition, row);
    return recommendationResult({ row, ...info, debtAccrualQueueIds: crossed.debtAccrualQueueIds }, basisPrefix, "queue", crossed.skippedVacation);
  }
  if (allowRepeatLastAuto && previousCandidate) {
    const crossed = unavailableDebtAccrualForCrossedRows(data, rows, type, date, lastPosition, previousCandidate.row);
    return recommendationResult(
      { ...previousCandidate, debtAccrualQueueIds: crossed.debtAccrualQueueIds },
      `${basisPrefix}: ${REGIONAL_REPEAT_BASIS}`,
      "queue",
      crossed.skippedVacation,
    );
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
    employeeLoad(data, a.employee, type, loadMode, yuc, date) - employeeLoad(data, b.employee, type, loadMode, yuc, date) ||
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
      const substituteFor = cleanText(row["Замещает"]);
      const markers = [];
      if (recommendedRow) markers.push("кандидат");
      if (substituteFor) markers.push(`замещает ${shortName(substituteFor)}`);
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
        substituteFor,
        available,
        load: info.employee ? employeeLoad(data, info.employee, type, LOAD_MODE_BY_TYPE, yuc, date) : 0,
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
    } else if (cleanText(recommendation?.basis).startsWith(`региональная очередь: ${region} (замещение)`)) {
      rows = substitutionRowsForRegionalAbsence(data, yuc, region, type, mainEmployees, regionalRows, date);
      mode = "regional-substitution";
      title = "Региональная очередь";
      note = `Основные региональные юристы недоступны; заместители временно показаны на позициях замещаемых сотрудников.`;
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
    return { ok: false, candidate: "", basis: "", reason: "Укажите тип дела: претензия, административное, судебное, уголовное или банкротное." };
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
  const unavailableRegionalDebt = unavailableDebtAccrualForRows(data, regionalRows, type, date);

  if (availableRegional.length) {
    const allRows = queueRowsFor(data, normalizedYuc, type);
    const regionalNames = mainEmployees.map((employee) => cleanText(employee[FIELD.name])).filter(Boolean);
    const outsideRows = allRows.filter((row) => !regionalNames.some((name) => nameMatches(row[FIELD.name], name)));
    const outsideAvailability = availableCandidateRows(data, outsideRows, type, date, "");
    const outsideCandidates = outsideAvailability.candidates;
    const allowOutside = yes(settings[YUC_SETTING.allowOutsideRegion]);
    const threshold = overloadThreshold(data.settings ?? [], normalizedYuc, type);

    if (allowOutside && outsideCandidates.length) {
      const minRegionalLoad = Math.min(...availableRegional.map((item) => employeeLoad(data, item.employee, type, LOAD_MODE_BY_TYPE, normalizedYuc, date)));
      const minOutsideLoad = Math.min(...outsideCandidates.map((item) => employeeLoad(data, item.employee, type, LOAD_MODE_BY_TYPE, normalizedYuc, date)));
      if (minRegionalLoad - minOutsideLoad > threshold) {
        const outside = recommendFromQueueRows(
          data,
          outsideRows,
          normalizedYuc,
          type,
          date,
          `вне региона: перегруз региональной группы ${minRegionalLoad - minOutsideLoad} > ${threshold}`,
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
    const substituteRows = substitutionRowsForRegionalAbsence(
      data,
      normalizedYuc,
      region,
      type,
      mainEmployees,
      regionalRows,
      date,
    );
    const substitute = recommendFromQueueRows(
      data,
      substituteRows,
      normalizedYuc,
      type,
      date,
      `региональная очередь: ${region} (замещение)`,
      { allowRepeatLastAuto: true },
    );
    if (substitute.ok) {
      return mergeRecommendationDebt(substitute, unavailableRegionalDebt);
    }
  }

  const general = {
    ...recommendGeneral(data, normalizedYuc, type, date),
    basis: "общая очередь после недоступности региональных юристов",
  };
  return mergeRecommendationDebt(general, unavailableRegionalDebt);
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
    "Движение дела": cleanMultilineText(draft["Движение дела"]),
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

  return { recommendation, case: caseRow };
}

function comparableCaseImportText(value) {
  return cleanText(value).toLowerCase().replaceAll("ё", "е");
}

function duplicateCaseText(value) {
  return comparableCaseImportText(value)
    .replaceAll("№", " ")
    .replace(/["«»„“”]/g, "")
    .replace(/[^а-яa-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function duplicateCaseTextCompact(value) {
  return duplicateCaseText(value).replace(/\s+/g, "");
}

function legalCaseNumbers(value) {
  const text = comparableCaseImportText(value).toUpperCase();
  const numbers = new Set();
  const patterns = [
    /[АA]\d{1,3}[-–—]\d+\/\d{4}/g,
    /\d+[-–—]\d+\/\d{4}/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      numbers.add(match[0].replace(/[–—]/g, "-"));
    }
  }
  return numbers;
}

function levenshteinDistance(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i += 1) {
    const current = [i + 1];
    for (let j = 0; j < right.length; j += 1) {
      const cost = left[i] === right[j] ? 0 : 1;
      current[j + 1] = Math.min(
        current[j] + 1,
        previous[j + 1] + 1,
        previous[j] + cost,
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function subjectSimilarity(a, b) {
  const left = duplicateCaseText(a);
  const right = duplicateCaseText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftCompact = duplicateCaseTextCompact(a);
  const rightCompact = duplicateCaseTextCompact(b);
  if (!leftCompact || !rightCompact) return 0;
  if (leftCompact === rightCompact) return 1;
  const shorter = leftCompact.length <= rightCompact.length ? leftCompact : rightCompact;
  const longer = leftCompact.length > rightCompact.length ? leftCompact : rightCompact;
  if (shorter.length >= 18 && longer.includes(shorter)) return 0.96;
  const maxLength = Math.max(leftCompact.length, rightCompact.length);
  if (!maxLength || maxLength > 320) return 0;
  return 1 - levenshteinDistance(leftCompact, rightCompact) / maxLength;
}

function sameCaseType(a, b) {
  const left = normalizeType(a?.[FIELD.caseType]);
  const right = normalizeType(b?.[FIELD.caseType]);
  return Boolean(left && right && left === right);
}

function sameCaseDate(a, b) {
  const left = toISODate(a?.["Дата поступления"]);
  const right = toISODate(b?.["Дата поступления"]);
  return Boolean(left && right && left === right);
}

function sameCaseRegion(a, b) {
  const left = normalizeRegionName(a?.["Регион"]);
  const right = normalizeRegionName(b?.["Регион"]);
  return Boolean(left && right && left === right);
}

function sameCaseResponsible(a, b) {
  return nameMatches(a?.[FIELD.responsible], b?.[FIELD.responsible]);
}

function sameCaseParty(a, b) {
  const leftParties = ["Истец", "Ответчик", "Третье лицо"]
    .map((field) => duplicateCaseText(a?.[field]))
    .filter(Boolean);
  const rightParties = ["Истец", "Ответчик", "Третье лицо"]
    .map((field) => duplicateCaseText(b?.[field]))
    .filter(Boolean);
  return leftParties.some((left) => rightParties.includes(left));
}

export function caseDuplicateReason(candidate, existing, options = {}) {
  if (!candidate || !existing) return "";
  const candidateLink = cleanText(candidate["Ссылка"]);
  const existingLink = cleanText(existing["Ссылка"]);
  if (candidateLink && existingLink && candidateLink === existingLink) return "совпадает ссылка CasePRO";
  if (!sameCaseType(candidate, existing)) return "";
  if (caseImportKey(candidate) === caseImportKey(existing)) return "строгое совпадение основных полей";

  const candidateNumbers = legalCaseNumbers(candidate["Предмет"]);
  const existingNumbers = legalCaseNumbers(existing["Предмет"]);
  const commonNumber = [...candidateNumbers].find((number) => existingNumbers.has(number));
  if (commonNumber) return `совпадает номер дела ${commonNumber}`;
  if (options.strictOnly) return "";
  if (candidateNumbers.size && existingNumbers.size) return "";

  const subjectScore = subjectSimilarity(candidate["Предмет"], existing["Предмет"]);
  if (subjectScore < 0.92) return "";

  const anchors = [
    sameCaseResponsible(candidate, existing) ? "ответственный" : "",
    sameCaseRegion(candidate, existing) ? "регион" : "",
    sameCaseParty(candidate, existing) ? "сторона" : "",
    sameCaseDate(candidate, existing) ? "дата поступления" : "",
  ].filter(Boolean);
  if (!anchors.length) return "";
  return subjectScore === 1
    ? `совпадает предмет и ${anchors[0]}`
    : `похожий предмет (${Math.round(subjectScore * 100)}%) и ${anchors[0]}`;
}

export function caseImportKey(row) {
  return [
    normalizeType(row?.[FIELD.caseType]),
    toISODate(row?.["Дата поступления"]),
    normalizeRegionName(row?.["Регион"]),
    comparableCaseImportText(row?.["Предмет"]),
    comparableCaseImportText(row?.["Истец"]),
    comparableCaseImportText(row?.["Ответчик"]),
    comparableCaseImportText(row?.["Третье лицо"]),
  ].join("::");
}

// Для повторного импорта CasePRO-ссылка — неизменяемый идентификатор карточки.
// Похожий предмет, одинаковый исполнитель или регион не доказывают, что это
// то же дело: такие эвристики допустимы лишь для подсказки, но не для слияния.
export function caseImportDuplicateReason(candidate, existing) {
  if (!candidate || !existing) return "";
  const candidateLink = cleanText(candidate["Ссылка"]);
  const existingLink = cleanText(existing["Ссылка"]);
  if (candidateLink || existingLink) {
    return candidateLink && existingLink && candidateLink === existingLink
      ? "совпадает ссылка CasePRO"
      : "";
  }
  return caseImportKey(candidate) === caseImportKey(existing)
    ? "строгое совпадение основных полей (ссылка отсутствует)"
    : "";
}

export function importCasesFromRows(data, rows, date = new Date()) {
  const added = [];
  const skipped = [];
  const duplicateIndex = new Map();
  for (const caseRow of data.cases ?? []) {
    const link = cleanText(caseRow["Ссылка"]);
    const key = link ? `link:${link}` : `fields:${caseImportKey(caseRow)}`;
    if (!duplicateIndex.has(key)) duplicateIndex.set(key, caseRow);
  }
  let nextCaseNumber = (data.cases ?? []).reduce((max, caseRow) => {
    const match = cleanText(caseRow.case_id).match(/CASE-(\d+)/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  for (const item of rows ?? []) {
    const source = item.source ?? item;
    const normalized = normalizeDraft(source);
    const link = cleanText(normalized["Ссылка"]);
    const duplicateKey = link ? `link:${link}` : `fields:${caseImportKey(normalized)}`;
    const duplicateRow = duplicateIndex.get(duplicateKey);
    const duplicateReason = duplicateRow ? caseImportDuplicateReason(normalized, duplicateRow) : "";
    if (duplicateReason) {
      skipped.push({ rowNumber: item.rowNumber, reason: duplicateReason || "уже есть", source: normalized });
      continue;
    }
    const responsible = cleanText(source[FIELD.responsible]);
    const caseId = `CASE-${String(nextCaseNumber).padStart(4, "0")}`;
    nextCaseNumber += 1;
    const created = {
      case_id: caseId,
      "Номер дела": normalized["Номер дела"],
      "Предмет": normalized["Предмет"],
      [FIELD.yuc]: normalized[FIELD.yuc],
      "Регион": normalized["Регион"],
      "Истец": normalized["Истец"],
      "Ответчик": normalized["Ответчик"],
      "Третье лицо": normalized["Третье лицо"],
      [FIELD.caseType]: normalized[FIELD.caseType],
      "Дата поступления": normalized["Дата поступления"],
      [FIELD.status]: responsible ? "В работе" : "Ожидает распределения",
      "Дата завершения": "",
      "Отложить завершение до": "",
      "Причина отложения завершения дела": "",
      "Дата предупреждения о завершении": "",
      [FIELD.responsible]: responsible,
      "Дата распределения": "",
      "Основание": "Импорт из Excel",
      "Распределено системой": "Нет",
      "Ручное назначение": "Нет",
      "Комментарий": `Импорт из Excel${item.rowNumber ? `, строка ${item.rowNumber}` : ""}`,
      "Ссылка": normalized["Ссылка"],
      "Движение дела": normalized["Движение дела"],
    };
    data.cases.push(created);
    duplicateIndex.set(duplicateKey, created);
    added.push(created);
  }
  return { added, skipped };
}
