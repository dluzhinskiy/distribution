import {
  FIELD,
  assignAutomatically,
  cleanText,
  employeeParticipates,
  isEmployeeOnVacation,
  nameMatches,
  normalizeType,
  normalizeYuc,
  recommendWithPreview,
  todayISO,
  yes,
} from "../lib/domain.mjs";
import { readData, saveData } from "../lib/tabs-store.mjs";
import { normalizeRegionName } from "../lib/regions.mjs";

const args = process.argv.slice(2);
const write = args.includes("--write");
const stepsArg = args.find((item) => item.startsWith("--steps="));
const steps = Math.max(1, Number(stepsArg?.split("=")[1]) || 1);
const positional = args.filter((item) => item !== "--write" && !item.startsWith("--steps="));
const yuc = normalizeYuc(positional[0] || "Дальний Восток");
const type = normalizeType(positional[1] || "судебное");
const region = normalizeRegionName(positional[2] || "Приморский край");
const date = new Date();

function regionalTypeMatches(value) {
  const normalized = normalizeType(value);
  return normalized === "все" || normalized === type;
}

function queueDebt(row) {
  const value = Number(row?.[FIELD.debt]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function employeeByName(data, name) {
  return data.employees.find((employee) => nameMatches(employee[FIELD.name], name));
}

function employeeForQueueRow(data, row) {
  const employeeId = cleanText(row.employee_id);
  return data.employees.find((employee) => cleanText(employee.employee_id) === employeeId) ??
    employeeByName(data, row[FIELD.name]);
}

function queueRowsForEmployees(data, employees) {
  const names = employees.map((employee) => cleanText(employee[FIELD.name])).filter(Boolean);
  return data.queues
    .filter((row) =>
      normalizeYuc(row[FIELD.yuc]) === yuc &&
      normalizeType(row[FIELD.caseType]) === type &&
      names.some((name) => nameMatches(row[FIELD.name], name))
    )
    .sort((a, b) => Number(a[FIELD.position]) - Number(b[FIELD.position]));
}

function uniqueEmployees(items) {
  const result = [];
  for (const employee of items) {
    const name = cleanText(employee?.[FIELD.name]);
    if (!name || result.some((item) => nameMatches(item[FIELD.name], name))) continue;
    result.push(employee);
  }
  return result;
}

const data = await readData();
const draft = {
  [FIELD.yuc]: yuc,
  [FIELD.caseType]: type,
  "Регион": region,
  "Дата поступления": todayISO(date),
  "Предмет": "Диагностика регионального долга",
};

const assignments = (data.regionalAssignments ?? []).filter((row) =>
  yes(row[FIELD.ruleActive]) &&
  normalizeYuc(row[FIELD.yuc]) === yuc &&
  normalizeRegionName(row["Регион"]) === region &&
  regionalTypeMatches(row[FIELD.workloadType])
);
const regionalEmployees = uniqueEmployees(assignments.map((row) => employeeByName(data, row["Сотрудник"])).filter(Boolean));
const regionalRows = queueRowsForEmployees(data, regionalEmployees);

console.log(`ЮЦ: ${yuc}; тип: ${type}; регион: ${region}`);
console.log(`Региональных закреплений: ${assignments.length}; сотрудников: ${regionalEmployees.length}`);
console.log(`Шагов симуляции: ${steps}`);
console.table(regionalRows.map((row) => {
  const employee = employeeForQueueRow(data, row);
  return {
    position: row[FIELD.position],
    queue_id: row.queue_id,
    employee: row[FIELD.name],
    active: employee?.[FIELD.employeeActive] ?? "",
    participates: employee ? employeeParticipates(employee, type) : false,
    vacation_today: employee ? isEmployeeOnVacation(employee, date, data.vacations ?? []) : false,
    debt: row[FIELD.debt],
  };
}));

const beforeDebt = new Map((data.queues ?? []).map((row) => [`${cleanText(row.queue_id)}::${cleanText(row.employee_id) || cleanText(row[FIELD.name])}`, queueDebt(row)]));
const simulation = structuredClone(data);
const recommendation = recommendWithPreview(simulation, draft, date);
const assignmentsLog = [];
for (let index = 0; index < steps; index += 1) {
  const stepDraft = {
    ...draft,
    "Предмет": `Диагностика регионального долга ${index + 1}`,
  };
  const assigned = assignAutomatically(simulation, stepDraft, date);
  assignmentsLog.push({
    step: index + 1,
    case_id: assigned.case.case_id,
    responsible: assigned.case[FIELD.responsible],
    basis: assigned.result.basis,
    debtAccrualQueueIds: assigned.result.debtAccrualQueueIds,
  });
}
const afterDebt = new Map((simulation.queues ?? []).map((row) => [`${cleanText(row.queue_id)}::${cleanText(row.employee_id) || cleanText(row[FIELD.name])}`, queueDebt(row)]));
const changedDebt = (simulation.queues ?? [])
  .map((row) => {
    const queueId = `${cleanText(row.queue_id)}::${cleanText(row.employee_id) || cleanText(row[FIELD.name])}`;
    const before = beforeDebt.get(queueId) ?? 0;
    const after = afterDebt.get(queueId) ?? 0;
    return { row, before, after };
  })
  .filter((item) => item.before !== item.after);

console.log("Рекомендация до назначения:");
console.log(JSON.stringify({
  ok: recommendation.ok,
  candidate: recommendation.candidate,
  basis: recommendation.basis,
  reason: recommendation.reason,
  skippedVacation: recommendation.skippedVacation,
  debtAccrualQueueIds: recommendation.debtAccrualQueueIds,
}, null, 2));

console.log("Симуляция назначения:");
console.log(JSON.stringify(assignmentsLog, null, 2));

console.log("Изменения долга после симуляции:");
console.table(changedDebt.map(({ row, before, after }) => ({
  queue_id: row.queue_id,
  position: row[FIELD.position],
  employee: row[FIELD.name],
  before,
  after,
})));

if (write) {
  await saveData(simulation, ["cases", "queues", "state", "journal"]);
  const confirmed = await readData(["queues", "state", "cases"]);
  const lastAssignment = assignmentsLog.at(-1);
  const confirmedCase = confirmed.cases.find((row) => cleanText(row.case_id) === cleanText(lastAssignment.case_id));
  console.log("Запись выполнена и перечитана:");
  console.log(JSON.stringify({
    case_id: confirmedCase?.case_id,
    responsible: confirmedCase?.[FIELD.responsible],
    changedDebt: changedDebt.map(({ row, before, after }) => {
      const confirmedRow = confirmed.queues.find((item) =>
        cleanText(item.queue_id) === cleanText(row.queue_id) &&
        (
          cleanText(item.employee_id) === cleanText(row.employee_id) ||
          nameMatches(item[FIELD.name], row[FIELD.name])
        )
      );
      return {
        queue_id: row.queue_id,
        employee_id: row.employee_id,
        employee: row[FIELD.name],
        before,
        expectedAfter: after,
        confirmedAfter: queueDebt(confirmedRow),
      };
    }),
  }, null, 2));
}
