import assert from "node:assert/strict";

process.env.AUTH_SESSION_SECRET = "auth-smoke-test-secret-with-more-than-thirty-two-characters";
process.env.BOOTSTRAP_ADMIN_LOGIN = "admin";
process.env.BOOTSTRAP_ADMIN_CODE = "ABCD-1234";

const { createAuthController } = await import("../lib/auth-controller.mjs");

const data = {
  employees: [{
    employee_id: "EMP-000",
    "ФИО": "Администратор",
    "Логин": "admin",
    "Роль доступа": "Администратор",
    "Хэш-пароля": "",
    "Хэш кода первичного входа": "",
    "Срок действия кода": "",
  }],
};
let response = null;
const controller = createAuthController({
  readData: async () => data,
  saveEmployee: async (_data, employee) => employee,
  readBody: async () => ({ login: "admin", code: "ABCD-1234", password: "пароль-для-проверки" }),
  sendJson: (_res, status, body, headers = {}) => {
    response = { status, body, headers };
  },
});

await controller.handleAuth({ method: "POST", headers: {} }, {}, new URL("http://localhost/api/auth/first-access"));
assert.equal(response.status, 200);
assert.equal(response.body.user.role, "Администратор");
assert.ok(data.employees[0]["Хэш-пароля"]);
assert.equal(data.employees[0]["Хэш кода первичного входа"], "");

const cookie = String(response.headers["Set-Cookie"]).split(";")[0];
const current = await controller.currentUser({ headers: { cookie } });
assert.equal(current?.employeeId, "EMP-000");

console.log("Auth smoke-test OK");
