import test from "node:test";
import assert from "node:assert/strict";
import { FIELD, assignAutomatically, assignManually, overloadThreshold, recommend } from "../lib/domain.mjs";

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

test("criminal and bankruptcy cases use the judicial overload threshold", () => {
  const settings = [
    { [FIELD.yuc]: "Дальний Восток", [FIELD.caseType]: "судебное", "Порог перегруза": 4 },
    { [FIELD.yuc]: "Дальний Восток", [FIELD.caseType]: "административное", "Порог перегруза": 2 },
    { [FIELD.yuc]: "Дальний Восток", [FIELD.caseType]: "претензия", "Порог перегруза": 1 },
  ];
  assert.equal(overloadThreshold(settings, "Дальний Восток", "уголовное"), 4);
  assert.equal(overloadThreshold(settings, "Дальний Восток", "банкротное"), 4);
  assert.equal(overloadThreshold(settings, "Дальний Восток", "административное"), 2);
  assert.equal(overloadThreshold([{ [FIELD.yuc]: "ЮЦ 1", [FIELD.caseType]: "судебное", "Порог перегруза": "" }], "ЮЦ 1", "судебное"), 5);
});

test("regional overload compares only the selected workload type and ignores legacy YUC threshold", () => {
  const data = distributionData();
  data.yucSettings = [{
    [FIELD.yuc]: "Дальний Восток",
    "Региональные очереди вкл\\выкл": "Да",
    "Порог перегруза": 100,
    "Считать перегруз по": "общая нагрузка",
  }];
  data.regionalAssignments = [{
    [FIELD.yuc]: "Дальний Восток",
    "Регион": "Хабаровский край",
    "Сотрудник": "Иванов И.И.",
    "Тип нагрузки": "судебное",
    "Активно": "Да",
  }];
  data.settings = [
    { [FIELD.yuc]: "Дальний Восток", [FIELD.caseType]: "судебное", "Активность, дни": 30, "Автозавершение, дни": 360, "Порог перегруза": 2 },
    { [FIELD.yuc]: "Дальний Восток", [FIELD.caseType]: "административное", "Активность, дни": 30, "Автозавершение, дни": 90, "Порог перегруза": 9 },
  ];
  data.cases = [
    ...Array.from({ length: 3 }, (_, index) => ({
      case_id: `J-${index}`,
      [FIELD.yuc]: "Дальний Восток",
      [FIELD.caseType]: "судебное",
      "Дата поступления": "2026-07-27",
      [FIELD.status]: "В работе",
      [FIELD.responsible]: "Иванов И.И.",
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      case_id: `A-${index}`,
      [FIELD.yuc]: "Дальний Восток",
      [FIELD.caseType]: "административное",
      "Дата поступления": "2026-07-27",
      [FIELD.status]: "В работе",
      [FIELD.responsible]: "Петров П.П.",
    })),
  ];
  const result = recommend(data, draft, new Date(2026, 6, 27, 12, 0, 0));
  assert.equal(result.ok, true);
  assert.equal(result.candidate, "Петров П.П.");
  assert.match(result.basis, /> 2/);
});

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

test("dashboard coefficients do not affect recommendation or queue selection", () => {
  const withoutCoefficients = distributionData();
  const withCoefficients = distributionData();
  withCoefficients.loadCoefficients = [
    { "Тип нагрузки": "судебное", "Коэффициент": 99 },
    { "Тип нагрузки": "уголовное", "Коэффициент": 0.01 },
  ];
  const date = new Date(2026, 6, 27, 12, 0, 0);
  assert.deepEqual(recommend(withCoefficients, draft, date), recommend(withoutCoefficients, draft, date));
});
