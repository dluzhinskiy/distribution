import assert from "node:assert/strict";
import { assignAutomatically, caseDuplicateReason, recommend } from "../lib/domain.mjs";

function yucSettings(overrides = {}) {
  return {
    "ЮЦ": "Дальний Восток",
    "Региональные очереди вкл\\выкл": "Нет",
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
    "Активное число": 1,
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
    journal: [],
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

{
  const data = baseData({ regionalEnabled: "Нет" });
  data.state[0]["Последняя позиция"] = 0;
  data.state[0]["Последний автоназначенный"] = "";
  data.cases.push({
    case_id: "CASE-INACTIVE",
    "ЮЦ": "Дальний Восток",
    "Регион": "Хабаровский край",
    "Тип дела": "судебное",
    "Дата поступления": "2026-06-01",
    "Статус": "В работе",
    "Ответственный": "Иванов И.И.",
    "Активное число": 0,
  });
  assert.equal(recommend(data, draft(), date).candidate, "Иванов И.И.");
  data.yucSettings[0]["Учитывать неактивные незавершенные в нагрузке"] = "Да";
  assert.equal(recommend(data, draft(), date).candidate, "Петров П.П.");
}

{
  const data = baseData({ regionalEnabled: "Нет" });
  data.settings = [{
    "ЮЦ": "Дальний Восток",
    "Тип дела": "судебное",
    "Активность, дни": 30,
    "Автозавершение, дни": 360,
    "Учитывать долг": "Да",
    "Максимальный долг": 3,
  }];
  data.queues[0]["Долг"] = 2;
  const result = recommend(data, draft(), date);
  assert.equal(result.ok, true);
  assert.equal(result.candidate, "Иванов И.И.");
  assert.match(result.basis, /долг 2/);
  assert.match(result.basis, /не два подряд/);
  const assigned = assignAutomatically(data, { ...draft(), "Предмет": "Тест долга" }, date);
  assert.equal(assigned.case["Ответственный"], "Иванов И.И.");
  assert.equal(data.queues[0]["Долг"], 1);
}

{
  const data = baseData({ regionalEnabled: "Нет" });
  data.settings = [{
    "ЮЦ": "Дальний Восток",
    "Тип дела": "судебное",
    "Активность, дни": 30,
    "Автозавершение, дни": 360,
    "Учитывать долг": "Да",
    "Максимальный долг": 2,
  }];
  data.employees[0]["Активен"] = "Нет";
  data.state[0]["Последняя позиция"] = 0;
  data.state[0]["Последний автоназначенный"] = "";
  const assigned = assignAutomatically(data, { ...draft(), "Предмет": "Тест начисления долга" }, date);
  assert.equal(assigned.case["Ответственный"], "Петров П.П.");
  assert.equal(data.queues[0]["Долг"], 1);
}

{
  const existing = {
    "Тип дела": "претензия",
    "Дата поступления": "2026-01-02",
    "Регион": "Забайкальский край",
    "Предмет": "Возмещение убытков от залива",
    "Ответственный": "Анисимова А.В.",
    "Ответчик": "ПАО \"МТС\"",
  };
  const imported = {
    ...existing,
    "Дата поступления": "2026-01-01",
    "Предмет": "возмещение убытков от залива",
  };
  assert.match(caseDuplicateReason(imported, existing), /совпадает предмет/);
}

{
  const existing = {
    "Тип дела": "судебное",
    "Регион": "Приморский край",
    "Предмет": "О взыскании ущерба, причиненного в результате пожара",
    "Ответственный": "Сагитова А.А.",
  };
  const imported = {
    ...existing,
    "Предмет": "О взыскании ущерба, причененного в результате пожара",
  };
  assert.match(caseDuplicateReason(imported, existing), /похожий предмет/);
}

{
  const existing = {
    "Тип дела": "судебное",
    "Регион": "Амурская область",
    "Дата поступления": "2026-06-20",
    "Предмет": "Судебный приказ по делу № А04-4578/2026",
    "Ответственный": "Жукова О.В.",
  };
  const imported = {
    ...existing,
    "Регион": "Хабаровский край",
    "Дата поступления": "2026-06-19",
    "Предмет": "судебный приказ по делу № А04-4578/2026",
  };
  assert.match(caseDuplicateReason(imported, existing), /А04-4578\/2026/);
  assert.equal(caseDuplicateReason(
    { ...imported, "Предмет": "судебный приказ по делу № А04-4579/2026" },
    existing,
  ), "");
}

console.log("Domain smoke test: OK");
