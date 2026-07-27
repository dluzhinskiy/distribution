import { FIELD } from "./domain-schema.mjs";
import { cleanText, nowISO, parseISODate, todayISO, toISODate } from "./domain-values.mjs";

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
    [FIELD.name]: cleanText(row[FIELD.name]),
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
  const employeeId = cleanText(employee.employee_id);
  const day = todayISO(date);
  if (employeeId && (vacations ?? []).map(normalizeVacation).some((item) => (
    cleanText(item.employee_id) === employeeId && item["Дата начала"] &&
    item["Дата начала"] <= day && day <= (item["Дата окончания"] || item["Дата начала"])
  ))) return true;
  const from = toISODate(employee["Отпуск с"]);
  const to = toISODate(employee["Отпуск по"]);
  return Boolean(from && to && from <= day && day <= to);
}

function vacationRowsFromDates(employee, dates, comment = "", date = new Date()) {
  const normalizedDates = [...new Set((dates ?? []).map(toISODate).filter(Boolean))].sort();
  const rows = [];
  let start = null;
  let previous = null;
  for (const day of normalizedDates) {
    if (!start) {
      start = day;
      previous = day;
      continue;
    }
    if (allDatesInRange(previous, day).length === 2) {
      previous = day;
      continue;
    }
    rows.push(vacationRow(employee, start, previous, comment, date));
    start = day;
    previous = day;
  }
  if (start) rows.push(vacationRow(employee, start, previous, comment, date));
  return rows;
}

function vacationRow(employee, start, end, comment, date) {
  return {
    employee_id: cleanText(employee.employee_id),
    [FIELD.name]: cleanText(employee[FIELD.name]),
    "Дата начала": start,
    "Дата окончания": end,
    "Тип": "Отпуск",
    "Комментарий": comment,
    "Изменено": nowISO(date),
  };
}

function replaceEmployeeDatesInScope(data, employeeId, scopeDates, vacationDates, comment = "", date = new Date()) {
  const employee = (data.employees ?? []).find((item) => cleanText(item.employee_id) === cleanText(employeeId));
  if (!employee) throw new Error("Сотрудник не найден.");
  const scope = new Set((scopeDates ?? []).map(toISODate).filter(Boolean));
  if (!scope.size) throw new Error("Нет дат для сохранения.");
  const targetId = cleanText(employeeId);
  const preserved = [];
  for (const item of (data.vacations ?? []).map(normalizeVacation)) {
    if (!item.employee_id || !item["Дата начала"]) continue;
    if (cleanText(item.employee_id) !== targetId) {
      preserved.push(item);
      continue;
    }
    const outsideDates = allDatesInRange(item["Дата начала"], item["Дата окончания"] || item["Дата начала"])
      .filter((day) => !scope.has(day));
    preserved.push(...vacationRowsFromDates(employee, outsideDates, item["Комментарий"], date));
  }
  data.vacations = [...preserved, ...vacationRowsFromDates(employee, vacationDates, comment, date)].sort(compareVacationRows);
  return vacationDatesForEmployee(data.vacations, employeeId);
}

function compareVacationRows(a, b) {
  return cleanText(a[FIELD.name]).localeCompare(cleanText(b[FIELD.name]), "ru") ||
    cleanText(a["Дата начала"]).localeCompare(cleanText(b["Дата начала"]));
}

export function setVacationDates(data, employeeId, dates, enabled, date = new Date()) {
  const employee = (data.employees ?? []).find((item) => cleanText(item.employee_id) === cleanText(employeeId));
  if (!employee) throw new Error("Сотрудник не найден.");
  const normalizedDates = [...new Set((dates ?? []).map(toISODate).filter(Boolean))].sort();
  const current = new Set(vacationDatesForEmployee(data.vacations, employeeId));
  for (const day of normalizedDates) enabled ? current.add(day) : current.delete(day);
  return replaceEmployeeDatesInScope(data, employeeId, normalizedDates, [...current].filter((day) => normalizedDates.includes(day)), "", date);
}

export function replaceVacationYear(data, employeeId, year, dates, date = new Date()) {
  const normalizedYear = Number(year);
  const scopeDates = allDatesInRange(`${normalizedYear}-01-01`, `${normalizedYear}-12-31`);
  const vacationDates = [...new Set((dates ?? []).map(toISODate).filter((day) => day.startsWith(`${normalizedYear}-`)))].sort();
  return replaceEmployeeDatesInScope(data, employeeId, scopeDates, vacationDates, "", date);
}

export function clearVacationYear(data, employeeId, year) {
  return replaceVacationYear(data, employeeId, year, []);
}

export function replaceVacationDatesForEmployees(data, employeePlans, scopeDates, date = new Date()) {
  const scope = new Set((scopeDates ?? []).map(toISODate).filter(Boolean));
  const plans = (employeePlans ?? []).map((plan) => ({
    employee_id: cleanText(plan.employee_id),
    vacationDates: [...new Set((plan.vacationDates ?? []).map(toISODate).filter((day) => scope.has(day)))].sort(),
  })).filter((plan) => plan.employee_id);
  if (!scope.size) throw new Error("В плане импорта нет дат.");
  if (!plans.length) throw new Error("В плане импорта нет сопоставленных сотрудников.");

  const planIds = new Set(plans.map((plan) => plan.employee_id));
  const employeesById = new Map((data.employees ?? []).map((employee) => [cleanText(employee.employee_id), employee]));
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
  data.vacations.sort(compareVacationRows);
  return { employees: plans.length, scopeDates: scope.size, vacationDays: added };
}
