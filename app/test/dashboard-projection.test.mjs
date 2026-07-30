import test from "node:test";
import assert from "node:assert/strict";
import { DASHBOARD_CASE_HEADERS } from "../lib/tabs-store.mjs";

test("облегчённый дэшборд не читает тяжёлые поля карточки дела", () => {
  assert.ok(DASHBOARD_CASE_HEADERS.includes("case_id"));
  assert.ok(DASHBOARD_CASE_HEADERS.includes("Тип дела"));
  assert.ok(DASHBOARD_CASE_HEADERS.includes("Ответственный"));
  assert.ok(DASHBOARD_CASE_HEADERS.includes("Дата поступления"));
  assert.equal(DASHBOARD_CASE_HEADERS.includes("Движение дела"), false);
  assert.equal(DASHBOARD_CASE_HEADERS.includes("Документы"), false);
  assert.equal(DASHBOARD_CASE_HEADERS.includes("Предмет"), false);
});
