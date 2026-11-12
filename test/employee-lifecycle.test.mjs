import test from "node:test";
import assert from "node:assert/strict";
import { archiveEmployee, createEmployeeRows, restoreEmployee } from "../lib/employee-lifecycle.mjs";
import { enrichData, isEmployeeAvailable } from "../lib/distribution.mjs";

test("new employee is inactive and receives four queue rows", () => {
  const data = {
    employees: [{ employee_id: "EMP-009", "Логин": "existing" }],
    queues: [{ queue_id: "QUEUE-КЦ-судебное", "ЮЦ": "КЦ", "Тип дела": "судебное", "Позиция": 4 }],
  };
  const { employee, queueRows } = createEmployeeRows(data, {
    "ФИО": "Иванов Иван Иванович",
    "ЮЦ": "КЦ",
    "Логин": "iivanov",
    email: "iivanov@example.ru",
  });
  assert.equal(employee.employee_id, "EMP-010");
  assert.equal(employee["Архивный"], "Нет");
  assert.equal(employee["Активен"], "Нет");
  assert.equal(employee["Роль доступа"], "Сотрудник");
  assert.deepEqual(queueRows.map((row) => row["Тип дела"]), ["судебное", "административное", "претензия", "заключение"]);
  assert.equal(queueRows[0]["Позиция"], 5);
});

test("archive revokes access and workload participation without deleting identity", () => {
  const employee = {
    employee_id: "EMP-010",
    "ФИО": "Иванов Иван Иванович",
    "Активен": "Да",
    "Судебные": "Да",
    "Хэш-пароля": "secret-hash",
  };
  archiveEmployee(employee, "EMP-001");
  assert.equal(employee["ФИО"], "Иванов Иван Иванович");
  assert.equal(employee["Архивный"], "Да");
  assert.equal(employee["Активен"], "Нет");
  assert.equal(employee["Судебные"], "Нет");
  assert.equal(employee["Хэш-пароля"], "");
});

test("restore keeps employee inactive until administrator configures participation", () => {
  const employee = { employee_id: "EMP-010", "Архивный": "Да", "Активен": "Нет" };
  restoreEmployee(employee);
  assert.equal(employee["Архивный"], "Нет");
  assert.equal(employee["Активен"], "Нет");
  assert.equal(employee["Претензии"], "Нет");
  assert.equal(employee["Заключения"], "Нет");
});

test("employee login must be unique and administrator cannot archive self", () => {
  assert.throws(() => createEmployeeRows({ employees: [{ "Логин": "USER" }], queues: [] }, {
    "ФИО": "Петров Петр Петрович", "ЮЦ": "КЦ", "Логин": "user",
  }), /логином уже существует/);
  assert.throws(() => archiveEmployee({ employee_id: "EMP-001" }, "EMP-001"), /собственную/);
});

test("archived employee is excluded from assignment but retained in linked statistics", () => {
  const employee = {
    _recordId: "rec-archived",
    employee_id: "EMP-010",
    "ФИО": "Иванов Иван Иванович",
    "ЮЦ": "КЦ",
    "Архивный": "Да",
    "Активен": "Да",
    "Судебные": "Да",
  };
  assert.equal(isEmployeeAvailable(employee, "судебное", new Date("2026-01-10T12:00:00Z")), false);
  const result = enrichData({
    employees: [employee],
    cases: [{
      case_id: "CASE-0001",
      "ЮЦ": "КЦ",
      "Тип дела": "судебное",
      "Дата поступления": "2026-01-09",
      "Статус": "В работе",
      "Ответственный": "Иванов Иван Иванович",
      "ОтветственныйУЗ": ["rec-archived"],
    }],
    settings: [],
    vacations: [],
  }, new Date("2026-01-10T12:00:00Z"));
  assert.equal(result.employees.length, 1);
  assert.equal(result.employees[0]["Архивный"], "Да");
  assert.equal(result.employees[0]["Активные всего"], 1);
});
