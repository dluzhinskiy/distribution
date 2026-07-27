import assert from "node:assert/strict";
import test from "node:test";
import { canEditCase, canManageYuc, canReadCase } from "../lib/access-policy.mjs";

const ownEmployee = { employee_id: "E1", "ФИО": "Иванов И.И.", "ЮЦ": "Дальний Восток" };
const ownCase = { case_id: "CASE-1", "ЮЦ": "Дальний Восток", "Ответственный": "Иванов И.И." };
const colleagueCase = { case_id: "CASE-2", "ЮЦ": "Дальний Восток", "Ответственный": "Петров П.П." };
const foreignCase = { case_id: "CASE-3", "ЮЦ": "Юг", "Ответственный": "Петров П.П." };

test("all authenticated roles may read cases from every YUC", () => {
  for (const role of ["Сотрудник", "Руководитель", "Заместитель", "Администратор"]) {
    assert.equal(canReadCase({ employeeId: "E1", role, yuc: "Дальний Восток" }, foreignCase), true);
  }
  assert.equal(canReadCase(null, ownCase), false);
});

test("employee edits only own case in own YUC", () => {
  const user = { employeeId: "E1", role: "Сотрудник", yuc: "Дальний Восток" };
  assert.equal(canEditCase(user, ownEmployee, ownCase), true);
  assert.equal(canEditCase(user, ownEmployee, colleagueCase), false);
  assert.equal(canEditCase(user, ownEmployee, foreignCase), false);
});

test("manager and deputy manage only their YUC; admin manages every YUC", () => {
  for (const role of ["Руководитель", "Заместитель"]) {
    const user = { employeeId: "E2", role, yuc: "Дальний Восток" };
    assert.equal(canManageYuc(user, "Дальний Восток"), true);
    assert.equal(canManageYuc(user, "Юг"), false);
  }
  assert.equal(canManageYuc({ employeeId: "EMP-000", role: "Администратор", yuc: "" }, "Юг"), true);
});
