import test from "node:test";
import assert from "node:assert/strict";
import { FIELD } from "../lib/domain.mjs";
import {
  assertRegionalSubstitution,
  normalizeRegionalAssignment,
  normalizeRegionalSubstitution,
  regionalAssignmentKey,
} from "../lib/regional-rules.mjs";

test("regional assignment key is stable after normalization", () => {
  const row = normalizeRegionalAssignment({ "Регион": " Москва ", "Сотрудник": "Иванов И.И.", [FIELD.workloadType]: " ВСЕ " }, "ЮЦ 1");
  assert.equal(row[FIELD.ruleActive], "Нет");
  assert.equal(regionalAssignmentKey(row), "ЮЦ 1::Москва::Иванов И.И.::все");
});

test("algorithmic substitution cannot point an employee to self", () => {
  const row = normalizeRegionalSubstitution({
    "Регион": "Москва",
    "Основной сотрудник": "Иванов Иван Иванович",
    "Замещающий сотрудник": "  Иванов Иван Иванович  ",
    [FIELD.workloadType]: "Судебные",
  }, "ЮЦ 1");
  assert.throws(() => assertRegionalSubstitution(row), /не могут совпадать/);
});
