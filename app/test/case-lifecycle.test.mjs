import test from "node:test";
import assert from "node:assert/strict";
import {
  changeCaseResponsible,
  completeCaseByDeadline,
  deleteCase,
  postponeCaseCompletion,
  restoreCase,
} from "../lib/case-lifecycle.mjs";
import { FIELD } from "../lib/domain-schema.mjs";

function fixture() {
  return {
    employees: [
      { employee_id: "E-1", [FIELD.name]: "Иванов Иван" },
      { employee_id: "E-2", [FIELD.name]: "Петров Пётр" },
    ],
    cases: [{ case_id: "CASE-1", [FIELD.status]: "В работе", [FIELD.responsible]: "Иванов Иван" }],
  };
}

test("case lifecycle changes responsible, postpones and completes a case", () => {
  const data = fixture();
  assert.equal(changeCaseResponsible(data, "CASE-1", "Петров Пётр").changed, true);
  assert.equal(data.cases[0][FIELD.responsible], "Петров Пётр");
  postponeCaseCompletion(data, "CASE-1", "2026-08-10", "Ждём документы", new Date("2026-07-27T10:00:00Z"));
  assert.equal(data.cases[0]["Отложить завершение до"], "2026-08-10");
  completeCaseByDeadline(data, "CASE-1", new Date("2026-07-27T10:00:00Z"));
  assert.equal(data.cases[0][FIELD.status], "Завершено");
  assert.equal(data.cases[0]["Дата завершения"], "2026-07-27");
});

test("deleted case requires exact confirmation and can be restored", () => {
  const data = fixture();
  assert.throws(() => deleteCase(data, "CASE-1", "wrong"), /точный ID/);
  deleteCase(data, "CASE-1", "CASE-1", new Date("2026-07-27T10:00:00Z"));
  assert.equal(data.cases[0][FIELD.status], "Удалено");
  assert.throws(() => changeCaseResponsible(data, "CASE-1", "Петров Пётр"), /восстановить/);
  restoreCase(data, "CASE-1");
  assert.equal(data.cases[0][FIELD.status], "В работе");
});
