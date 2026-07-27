import test from "node:test";
import assert from "node:assert/strict";
import { FIELD, assignAutomatically, assignManually } from "../lib/domain.mjs";

function distributionData() {
  return {
    cases: [],
    employees: [
      { employee_id: "E1", [FIELD.name]: "Иванов И.И.", [FIELD.yuc]: "Дальний Восток", "Активен": "Да", "Судебные": "Да", "Административные": "Да", "Претензии": "Да" },
      { employee_id: "E2", [FIELD.name]: "Петров П.П.", [FIELD.yuc]: "Дальний Восток", "Активен": "Да", "Судебные": "Да", "Административные": "Да", "Претензии": "Да" },
    ],
    queues: [
      { queue_id: "Q1", employee_id: "E1", [FIELD.name]: "Иванов И.И.", [FIELD.yuc]: "Дальний Восток", [FIELD.caseType]: "судебное", [FIELD.position]: 1, [FIELD.debt]: "Нет" },
      { queue_id: "Q2", employee_id: "E2", [FIELD.name]: "Петров П.П.", [FIELD.yuc]: "Дальний Восток", [FIELD.caseType]: "судебное", [FIELD.position]: 2, [FIELD.debt]: "Нет" },
    ],
    state: [{ queue_id: "QUEUE-Дальний Восток-судебное", [FIELD.yuc]: "Дальний Восток", [FIELD.caseType]: "судебное", "Последняя позиция": 0, "Последний автоназначенный": "", "Цикл": 1 }],
    vacations: [],
    settings: [],
    yucSettings: [],
    regionalAssignments: [],
    regionalSubstitutions: [],
  };
}

const draft = {
  [FIELD.yuc]: "Дальний Восток",
  "Регион": "Хабаровский край",
  [FIELD.caseType]: "судебное",
  "Предмет": "Характеристический тест",
  "Дата поступления": "2026-07-27",
};

test("automatic assignment changes cases and queue state without creating a journal", () => {
  const data = distributionData();
  const assigned = assignAutomatically(data, draft, new Date(2026, 6, 27, 12, 0, 0));
  assert.equal(assigned.result.ok, true);
  assert.equal(assigned.case[FIELD.responsible], "Иванов И.И.");
  assert.equal(data.cases.length, 1);
  assert.equal(data.state[0]["Последняя позиция"], 1);
  assert.equal(Object.prototype.hasOwnProperty.call(data, "journal"), false);
});

test("manual assignment creates only the case and leaves queue state unchanged", () => {
  const data = distributionData();
  const before = structuredClone(data.state);
  const assigned = assignManually(data, draft, "Петров П.П.", "Назначено руководителем", new Date(2026, 6, 27, 12, 0, 0));
  assert.equal(assigned.case[FIELD.responsible], "Петров П.П.");
  assert.deepEqual(data.state, before);
  assert.equal(Object.prototype.hasOwnProperty.call(data, "journal"), false);
});
