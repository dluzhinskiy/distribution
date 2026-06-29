import assert from "node:assert/strict";
import { recommend } from "../lib/domain.mjs";

function yucSettings(overrides = {}) {
  return {
    "ЮЦ": "Дальний Восток",
    "Региональные очереди вкл\\выкл": "Да",
    "Автоназначение вне региона вкл/выкл": "Да",
    "Порог перегруза": 5,
    "Считать перегруз по": "общая нагрузка",
    "Регион не настроен": "общая очередь",
    "Региональные юристы недоступны": "заместитель затем общая очередь",
    ...overrides,
  };
}

function baseData({ regionalLoad = 0, regionalEnabled = "Да" } = {}) {
  const regionalCases = Array.from({ length: regionalLoad }, (_, index) => ({
    case_id: `CASE-${String(index + 1).padStart(4, "0")}`,
    "ЮЦ": "Дальний Восток",
    "Регион": "Хабаровский край",
    "Тип дела": "судебное",
    "Дата поступления": "2026-06-01",
    "Статус": "В работе",
    "Ответственный": "Иванов И.И.",
  }));

  return {
    employees: [
      { employee_id: "E1", "ФИО": "Иванов И.И.", "ЮЦ": "Дальний Восток", "Активен": "Да", "Судебные": "Да", "Административные": "Да", "Претензии": "Да" },
      { employee_id: "E2", "ФИО": "Петров П.П.", "ЮЦ": "Дальний Восток", "Активен": "Да", "Судебные": "Да", "Административные": "Да", "Претензии": "Да" },
    ],
    queues: [
      { queue_id: "Q1", employee_id: "E1", "ФИО": "Иванов И.И.", "ЮЦ": "Дальний Восток", "Тип дела": "судебное", "Позиция": 1, "Долг": "Нет" },
      { queue_id: "Q2", employee_id: "E2", "ФИО": "Петров П.П.", "ЮЦ": "Дальний Восток", "Тип дела": "судебное", "Позиция": 2, "Долг": "Нет" },
    ],
    state: [
      { queue_id: "QUEUE-Дальний Восток-судебное", "ЮЦ": "Дальний Восток", "Тип дела": "судебное", "Последняя позиция": 1, "Последний автоназначенный": "Иванов И.И.", "Цикл": 1 },
    ],
    cases: regionalCases,
    vacations: [],
    settings: [],
    yucSettings: [yucSettings({ "Региональные очереди вкл\\выкл": regionalEnabled })],
    regionalAssignments: [
      { "ЮЦ": "Дальний Восток", "Регион": "Хабаровский край", "Сотрудник": "Иванов И.И.", "Тип нагрузки": "судебное", "Активно": "Да" },
    ],
    regionalSubstitutions: [],
  };
}

function draft() {
  return { "ЮЦ": "Дальний Восток", "Регион": "Хабаровский край", "Тип дела": "судебное" };
}

const date = new Date("2026-06-28T12:00:00");

{
  const result = recommend(baseData(), draft(), date);
  assert.equal(result.ok, true);
  assert.equal(result.candidate, "Иванов И.И.");
  assert.match(result.basis, /повтор допускается региональным правилом/);
}

{
  const result = recommend(baseData({ regionalLoad: 10 }), draft(), date);
  assert.equal(result.ok, true);
  assert.equal(result.candidate, "Петров П.П.");
  assert.match(result.basis, /вне региона: перегруз региональной группы/);
}

{
  const data = baseData({ regionalEnabled: "Нет" });
  data.employees = data.employees.slice(0, 1);
  data.queues = data.queues.slice(0, 1);
  const result = recommend(data, draft(), date);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Единственный доступный сотрудник уже был предыдущим автополучателем/);
}

console.log("Domain smoke test: OK");
