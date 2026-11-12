import test from "node:test";
import assert from "node:assert/strict";
import { createAuthController } from "../lib/auth-controller.mjs";

function responseCapture() {
  return { status: 0, payload: null };
}

function harness({ employees, body = {} }) {
  const saved = [];
  const controller = createAuthController({
    readData: async () => ({ employees }),
    readBody: async () => body,
    saveEmployee: async (_data, employee) => {
      saved.push({ ...employee });
      return employee;
    },
    sendJson: (res, status, payload) => {
      res.status = status;
      res.payload = payload;
    },
  });
  return { controller, saved };
}

const manager = { employeeId: "M-1", role: "Руководитель", yuc: "ЮЦ 1" };

test("manager changes a subordinate between employee and deputy roles", async () => {
  const employees = [{ employee_id: "E-1", "ФИО": "Иванов", "ЮЦ": "ЮЦ 1", "Роль доступа": "Сотрудник" }];
  const { controller, saved } = harness({ employees, body: { role: "Заместитель" } });
  const res = responseCapture();
  assert.equal(await controller.handleAccess(
    { method: "PATCH" }, res, new URL("http://localhost/api/access/users/E-1"), manager,
  ), true);
  assert.equal(res.status, 200);
  assert.equal(res.payload.user.role, "Заместитель");
  assert.equal(saved[0]["Роль доступа"], "Заместитель");
});

test("manager cannot promote to manager or modify another YUC", async () => {
  const own = harness({
    employees: [{ employee_id: "E-1", "ЮЦ": "ЮЦ 1", "Роль доступа": "Сотрудник" }],
    body: { role: "Руководитель" },
  });
  await assert.rejects(
    own.controller.handleAccess(
      { method: "PATCH" }, responseCapture(), new URL("http://localhost/api/access/users/E-1"), manager,
    ),
    (error) => error.status === 403,
  );

  const foreign = harness({
    employees: [{ employee_id: "E-2", "ЮЦ": "ЮЦ 2", "Роль доступа": "Сотрудник" }],
    body: { role: "Заместитель" },
  });
  await assert.rejects(
    foreign.controller.handleAccess(
      { method: "PATCH" }, responseCapture(), new URL("http://localhost/api/access/users/E-2"), manager,
    ),
    (error) => error.status === 403,
  );
});

test("deputy cannot change employee roles", async () => {
  const { controller } = harness({
    employees: [{ employee_id: "E-1", "ЮЦ": "ЮЦ 1", "Роль доступа": "Сотрудник" }],
    body: { role: "Заместитель" },
  });
  await assert.rejects(
    controller.handleAccess(
      { method: "PATCH" }, responseCapture(), new URL("http://localhost/api/access/users/E-1"),
      { employeeId: "D-1", role: "Заместитель", yuc: "ЮЦ 1" },
    ),
    (error) => error.status === 403,
  );
});
