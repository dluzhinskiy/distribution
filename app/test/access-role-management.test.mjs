import test from "node:test";
import assert from "node:assert/strict";
import { ROLE, accessRoleOptionsFor, canAssignAccessRole } from "../lib/auth.mjs";

const manager = { employeeId: "M-1", role: ROLE.manager };
const employee = { employee_id: "E-1", "Роль доступа": ROLE.employee };
const deputy = { employee_id: "D-1", "Роль доступа": ROLE.deputy };

test("manager assigns only employee and deputy roles to subordinates", () => {
  assert.deepEqual(accessRoleOptionsFor(manager, employee), [ROLE.employee, ROLE.deputy]);
  assert.equal(canAssignAccessRole(manager, employee, ROLE.deputy), true);
  assert.equal(canAssignAccessRole(manager, deputy, ROLE.employee), true);
  assert.equal(canAssignAccessRole(manager, employee, ROLE.manager), false);
  assert.equal(canAssignAccessRole(manager, employee, ROLE.admin), false);
});

test("manager cannot change own, another manager or administrator role", () => {
  assert.deepEqual(accessRoleOptionsFor(manager, { employee_id: "M-1", "Роль доступа": ROLE.manager }), []);
  assert.deepEqual(accessRoleOptionsFor(manager, { employee_id: "M-2", "Роль доступа": ROLE.manager }), []);
  assert.deepEqual(accessRoleOptionsFor(manager, { employee_id: "A-1", "Роль доступа": ROLE.admin }), []);
});

test("deputy cannot assign roles and administrator retains all options", () => {
  assert.deepEqual(accessRoleOptionsFor({ employeeId: "D-1", role: ROLE.deputy }, employee), []);
  assert.deepEqual(accessRoleOptionsFor({ employeeId: "A-1", role: ROLE.admin }, employee), [
    ROLE.employee, ROLE.manager, ROLE.deputy, ROLE.admin,
  ]);
});
