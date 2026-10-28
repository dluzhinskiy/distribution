import { ROLE, SYSTEM_EMPLOYEE_ID, cleanLogin } from "./auth.mjs";
import { cleanText, normalizeYuc, workloadType } from "./domain-values.mjs";

const WORKLOAD_TYPES = ["судебное", "административное", "претензия", "заключение"];

function lifecycleError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function nextEmployeeId(employees) {
  const maximum = (employees ?? []).reduce((result, employee) => {
    const match = cleanText(employee?.employee_id).match(/^EMP-(\d+)$/i);
    return match ? Math.max(result, Number(match[1])) : result;
  }, 0);
  return `EMP-${String(maximum + 1).padStart(3, "0")}`;
}

function nextQueuePosition(queues, yuc, type) {
  const normalizedYuc = normalizeYuc(yuc);
  const normalizedType = workloadType(type);
  return (queues ?? []).reduce((maximum, row) => {
    if (normalizeYuc(row?.["ЮЦ"]) !== normalizedYuc || workloadType(row?.["Тип дела"]) !== normalizedType) return maximum;
    return Math.max(maximum, Math.max(0, Math.floor(Number(row?.["Позиция"]) || 0)));
  }, 0) + 1;
}

function queueId(yuc, type) {
  return `QUEUE-${normalizeYuc(yuc)}-${workloadType(type)}`;
}

export function createEmployeeRows(data, input = {}) {
  const employees = data?.employees ?? [];
  const queues = data?.queues ?? [];
  const name = cleanText(input["ФИО"] ?? input.name);
  const yuc = cleanText(input["ЮЦ"] ?? input.yuc);
  const login = cleanLogin(input["Логин"] ?? input.login);
  const email = cleanText(input.email ?? input["E-mail"] ?? input["e-mail"]);

  if (!name) throw lifecycleError("Укажите ФИО сотрудника.");
  if (!yuc) throw lifecycleError("Укажите ЮЦ сотрудника.");
  if (!login) throw lifecycleError("Укажите логин сотрудника.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw lifecycleError("Проверьте адрес электронной почты.");
  if (employees.some((employee) => cleanLogin(employee?.["Логин"]) === login)) throw lifecycleError("Сотрудник с таким логином уже существует.", 409);

  const employeeId = nextEmployeeId(employees);
  const employee = {
    employee_id: employeeId,
    "ФИО": name,
    "ЮЦ": yuc,
    "Архивный": "Нет",
    "Активен": "Нет",
    "Судебные": "Нет",
    "Административные": "Нет",
    "Претензии": "Нет",
    "Заключения": "Нет",
    "Комментарий": "Добавлен через приложение. Для участия в назначении включите сотрудника и нужные типы нагрузки.",
    "Логин": login,
    "Роль доступа": ROLE.employee,
    "Хэш-пароля": "",
    "Хэш кода первичного входа": "",
    "Срок действия кода": "",
    email,
  };
  const queueRows = WORKLOAD_TYPES.map((type) => ({
    queue_id: queueId(yuc, type),
    "ЮЦ": yuc,
    "Тип дела": type,
    "Позиция": nextQueuePosition(queues, yuc, type),
    employee_id: employeeId,
    "ФИО": name,
    "Долг": 0,
    "Дата долга": "",
    "Примечание": "Создано при добавлении сотрудника",
  }));
  return { employee, queueRows };
}

export function archiveEmployee(employee, actorEmployeeId = "") {
  if (!employee) throw lifecycleError("Сотрудник не найден.", 404);
  if (cleanText(employee.employee_id) === SYSTEM_EMPLOYEE_ID) throw lifecycleError("Системную учётную запись нельзя уволить.", 409);
  if (cleanText(employee.employee_id) === cleanText(actorEmployeeId)) throw lifecycleError("Нельзя уволить собственную учётную запись.", 409);
  Object.assign(employee, {
    "Архивный": "Да",
    "Активен": "Нет",
    "Судебные": "Нет",
    "Административные": "Нет",
    "Претензии": "Нет",
    "Заключения": "Нет",
    "Хэш-пароля": "",
    "Хэш кода первичного входа": "",
    "Срок действия кода": "",
  });
  return employee;
}

export function restoreEmployee(employee) {
  if (!employee) throw lifecycleError("Сотрудник не найден.", 404);
  if (cleanText(employee.employee_id) === SYSTEM_EMPLOYEE_ID) throw lifecycleError("Системная учётная запись не архивируется.", 409);
  Object.assign(employee, {
    "Архивный": "Нет",
    "Активен": "Нет",
    "Судебные": "Нет",
    "Административные": "Нет",
    "Претензии": "Нет",
    "Заключения": "Нет",
  });
  return employee;
}

export const EMPLOYEE_ARCHIVE_FIELDS = Object.freeze([
  "Архивный", "Активен", "Судебные", "Административные", "Претензии", "Заключения",
  "Хэш-пароля", "Хэш кода первичного входа", "Срок действия кода",
]);
