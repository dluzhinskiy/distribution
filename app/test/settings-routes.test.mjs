import test from "node:test";
import assert from "node:assert/strict";
import { canManageYuc } from "../lib/access-policy.mjs";
import { FIELD } from "../lib/domain.mjs";
import { createSettingsRoutes } from "../routes/settings-routes.mjs";

function responseCapture() {
  return { status: 0, payload: null };
}

function createHarness(body, data) {
  const savedTables = [];
  const handle = createSettingsRoutes({
    readBody: async () => body,
    readData: async () => data,
    saveAndConfirm: async (nextData, tables) => {
      savedTables.push(...tables);
      return nextData;
    },
    sendJson: (res, status, payload) => { res.status = status; res.payload = payload; },
    requireManageYuc: (user, yuc) => {
      if (!canManageYuc(user, yuc)) {
        const error = new Error("forbidden");
        error.status = 403;
        throw error;
      }
    },
    requireEmployeeInYuc: (currentData, name, yuc) => {
      const employee = currentData.employees.find((item) => item[FIELD.name] === name && item[FIELD.yuc] === yuc);
      if (!employee) throw new Error("employee not found");
      return employee;
    },
    requireAdmin: (user) => {
      if (user.role !== "Администратор") {
        const error = new Error("admin only");
        error.status = 403;
        throw error;
      }
    },
  });
  return { handle, savedTables };
}

test("manager may save an algorithmic substitution in own YUC", async () => {
  const body = {
    yuc: "ЮЦ 1",
    row: {
      "Регион": "Москва",
      "Основной сотрудник": "Основной",
      "Замещающий сотрудник": "Резервный",
      [FIELD.workloadType]: "Судебные",
      [FIELD.ruleActive]: "Да",
    },
  };
  const data = {
    employees: [
      { [FIELD.name]: "Основной", [FIELD.yuc]: "ЮЦ 1" },
      { [FIELD.name]: "Резервный", [FIELD.yuc]: "ЮЦ 1" },
    ],
    regionalSubstitutions: [],
  };
  const { handle, savedTables } = createHarness(body, data);
  const res = responseCapture();
  const matched = await handle(
    { method: "POST" },
    res,
    new URL("http://localhost/api/regional-substitutions/upsert"),
    { role: "Руководитель", yuc: "ЮЦ 1" },
  );
  assert.equal(matched, true);
  assert.equal(res.status, 200);
  assert.deepEqual(savedTables, ["regionalSubstitutions"]);
  assert.equal(data.regionalSubstitutions.length, 1);
});

test("manager cannot change settings of another YUC", async () => {
  const { handle } = createHarness({}, { yucSettings: [] });
  await assert.rejects(
    handle(
      { method: "PATCH" },
      responseCapture(),
      new URL("http://localhost/api/yuc-settings/ЮЦ%202"),
      { role: "Руководитель", yuc: "ЮЦ 1" },
    ),
    (error) => error.status === 403,
  );
});

test("deputy may save overload thresholds by workload type in own YUC", async () => {
  const body = {
    yuc: "ЮЦ 1",
    rows: [{
      [FIELD.caseType]: "судебное",
      "Активность, дни": 30,
      "Автозавершение, дни": 360,
      "Учитывать долг": "Нет",
      "Максимальный долг": 0,
      "Порог перегруза": 4,
    }],
  };
  const data = { settings: [] };
  const { handle, savedTables } = createHarness(body, data);
  const res = responseCapture();
  const matched = await handle(
    { method: "POST" },
    res,
    new URL("http://localhost/api/deadline-settings"),
    { role: "Заместитель", yuc: "ЮЦ 1" },
  );
  assert.equal(matched, true);
  assert.equal(res.status, 200);
  assert.deepEqual(savedTables, ["settings"]);
  assert.equal(data.settings[0]["Порог перегруза"], 4);
});

test("employee cannot save workload settings", async () => {
  const body = { yuc: "ЮЦ 1", rows: [] };
  const { handle } = createHarness(body, { settings: [] });
  await assert.rejects(
    handle(
      { method: "POST" },
      responseCapture(),
      new URL("http://localhost/api/deadline-settings"),
      { role: "Сотрудник", yuc: "ЮЦ 1" },
    ),
    (error) => error.status === 403,
  );
});

test("settings router ignores unrelated endpoints", async () => {
  const { handle } = createHarness({}, {});
  assert.equal(await handle({ method: "GET" }, responseCapture(), new URL("http://localhost/api/data"), {}), false);
});

test("only administrator may save complete global load coefficients", async () => {
  const rows = [
    ["судебное", 1], ["административное", 0.5], ["претензия", 0.3], ["уголовное", 1.2], ["банкротное", 1.8],
  ].map(([type, coefficient]) => ({ "Тип нагрузки": type, "Коэффициент": coefficient }));
  const data = { loadCoefficients: [] };
  const { handle, savedTables } = createHarness({ rows }, data);
  await assert.rejects(
    handle({ method: "PUT" }, responseCapture(), new URL("http://localhost/api/load-coefficients"), { role: "Руководитель" }),
    (error) => error.status === 403,
  );
  const res = responseCapture();
  assert.equal(await handle({ method: "PUT" }, res, new URL("http://localhost/api/load-coefficients"), { role: "Администратор" }), true);
  assert.equal(res.status, 200);
  assert.deepEqual(savedTables, ["loadCoefficients"]);
  assert.equal(data.loadCoefficients.find((row) => row["Тип нагрузки"] === "банкротное")["Коэффициент"], 1.8);
});
