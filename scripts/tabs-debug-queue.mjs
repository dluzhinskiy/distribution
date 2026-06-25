import { employeeParticipates, isEmployeeOnVacation, normalizeType, normalizeYuc, recommend, todayISO } from "../lib/domain.mjs";
import { readData } from "../lib/tabs-store.mjs";

const yuc = process.argv[2] || "Дальний Восток";
const type = process.argv[3] || "судебное";
const normalizedYuc = normalizeYuc(yuc);
const normalizedType = normalizeType(type);

function clean(value) {
  return String(value ?? "").trim();
}

try {
  const data = await readData();
  const rows = data.queues
    .filter((row) => normalizeYuc(row["ЮЦ"]) === normalizedYuc && normalizeType(row["Тип дела"]) === normalizedType)
    .sort((a, b) => Number(a["Позиция"]) - Number(b["Позиция"]));

  function byId(employeeId) {
    const id = clean(employeeId);
    return data.employees.find((employee) => clean(employee.employee_id) === id);
  }

  function byName(name) {
    const fio = clean(name);
    return data.employees.find((employee) => clean(employee["ФИО"]) === fio);
  }

  console.log(`ЮЦ: ${normalizedYuc}; тип: ${normalizedType}`);
  console.log(`Строк очереди: ${rows.length}; сотрудников: ${data.employees.length}`);

  console.table(rows.map((row) => {
    const employee = byId(row.employee_id) ?? byName(row["ФИО"]);
    const link = byId(row.employee_id) ? "employee_id" : byName(row["ФИО"]) ? "ФИО" : "нет";
    return {
      position: row["Позиция"],
      queue_employee_id: row.employee_id,
      queue_fio: row["ФИО"],
      link,
      employee_fio: employee?.["ФИО"] ?? "",
      active: employee?.["Активен"] ?? "",
      participates: employee ? employeeParticipates(employee, normalizedType) : false,
      vacation_today: employee ? isEmployeeOnVacation(employee, new Date(), data.vacations ?? []) : false,
      debt: row["Долг"],
    };
  }));

  const result = recommend(data, {
    "ЮЦ": normalizedYuc,
    "Тип дела": normalizedType,
    "Предмет": "Диагностика рекомендации",
    "Регион": "Иркутская область",
    "Дата поступления": todayISO(),
  }, new Date());

  console.log("Рекомендация:");
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
}
