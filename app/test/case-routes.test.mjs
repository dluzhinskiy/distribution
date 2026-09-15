import test from "node:test";
import assert from "node:assert/strict";
import { FIELD } from "../lib/domain.mjs";
import { publicAttachmentId } from "../lib/http-utils.mjs";
import { createCaseRoutes } from "../routes/case-routes.mjs";

function createHarness({ body = {}, data }) {
  const responses = [];
  const savedTables = [];
  const attachmentReplacements = [];
  const auth = {
    isManager: (user) => ["Руководитель", "Заместитель", "Администратор"].includes(user.role),
  };
  const handle = createCaseRoutes({
    auth,
    readBody: async () => body,
    readBinaryBody: async () => Buffer.alloc(0),
    readData: async (keys) => Object.fromEntries(keys.map(key => [key, data[key] ?? []])),
    saveAndConfirm: async (nextData, tables) => {
      savedTables.push(...tables);
      return nextData;
    },
    sendJson: (_res, status, payload) => responses.push({ status, payload }),
    requireManageYuc: () => {},
    requireManageCase: () => {},
    employeeScopedData: (nextData) => nextData,
    replaceAttachments: async (table, row, field, attachments) => {
      attachmentReplacements.push({ table, row, field, attachments });
      row[field] = attachments;
      return row;
    },
    caseDocumentMaxBytes: 1_000,
    officePreviewMaxBytes: 1_000,
  });
  return { handle, responses, savedTables, attachmentReplacements };
}

test("authenticated employee may read a case from another YUC", async () => {
  const data = {
    cases: [{ case_id: "CASE-2", [FIELD.yuc]: "ЮЦ 2", [FIELD.responsible]: "Другой" }],
    employees: [],
  };
  const { handle, responses } = createHarness({ data });
  const matched = await handle(
    { method: "GET" },
    {},
    new URL("http://localhost/api/cases/CASE-2"),
    { employeeId: "EMP-1", role: "Сотрудник", yuc: "ЮЦ 1" },
  );
  assert.equal(matched, true);
  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].payload.case.case_id, "CASE-2");
});

test("case deep link lookup ignores case_id letter case", async () => {
  const data = {
    cases: [{ case_id: "CASE-1500", [FIELD.yuc]: "ЮЦ 1", [FIELD.responsible]: "Иванов Иван" }],
    employees: [],
  };
  const { handle, responses } = createHarness({ data });
  await handle(
    { method: "GET" },
    {},
    new URL("http://localhost/api/cases/case-1500"),
    { employeeId: "EMP-0", role: "Администратор", yuc: "" },
  );
  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].payload.case.case_id, "CASE-1500");
});

test("employee may patch own case and cannot patch colleague case", async () => {
  const ownData = {
    cases: [{ case_id: "CASE-1", [FIELD.yuc]: "ЮЦ 1", [FIELD.responsible]: "Иванов Иван" }],
    employees: [{ employee_id: "EMP-1", [FIELD.yuc]: "ЮЦ 1", [FIELD.name]: "Иванов Иван" }],
  };
  const user = { employeeId: "EMP-1", role: "Сотрудник", yuc: "ЮЦ 1" };
  const own = createHarness({ body: { "Статус": "Приостановлено" }, data: ownData });
  await own.handle({ method: "PATCH" }, {}, new URL("http://localhost/api/cases/CASE-1"), user);
  assert.equal(ownData.cases[0]["Статус"], "Приостановлено");
  assert.deepEqual(own.savedTables, ["cases"]);

  const colleagueData = {
    cases: [{ case_id: "CASE-2", [FIELD.yuc]: "ЮЦ 1", [FIELD.responsible]: "Петров Петр" }],
    employees: ownData.employees,
  };
  const colleague = createHarness({ body: { "Статус": "Завершено" }, data: colleagueData });
  await assert.rejects(
    colleague.handle({ method: "PATCH" }, {}, new URL("http://localhost/api/cases/CASE-2"), user),
    (error) => error.status === 403,
  );
});

test("employee cannot use manager-only case action", async () => {
  const { handle } = createHarness({ data: { cases: [], employees: [] } });
  const matched = await handle(
    { method: "POST" },
    {},
    new URL("http://localhost/api/assign-auto"),
    { employeeId: "EMP-1", role: "Сотрудник", yuc: "ЮЦ 1" },
  );
  assert.equal(matched, false);
});

test("manager case patch accepts business fields and rejects storage fields", async () => {
  const user = { employeeId: "M-1", role: "Руководитель", yuc: "ЮЦ 1" };
  const allowedData = {
    cases: [{ case_id: "CASE-1", [FIELD.yuc]: "ЮЦ 1", [FIELD.status]: "В работе" }],
    employees: [],
  };
  const allowed = createHarness({ body: { "Движение дела": "Назначено заседание" }, data: allowedData });
  await allowed.handle({ method: "PATCH" }, {}, new URL("http://localhost/api/cases/CASE-1"), user);
  assert.equal(allowedData.cases[0]["Движение дела"], "Назначено заседание");

  const rejectedData = {
    cases: [{ case_id: "CASE-2", [FIELD.yuc]: "ЮЦ 1", [FIELD.status]: "В работе" }],
    employees: [],
  };
  const rejected = createHarness({ body: { case_id: "CASE-HIJACK" }, data: rejectedData });
  await assert.rejects(
    rejected.handle({ method: "PATCH" }, {}, new URL("http://localhost/api/cases/CASE-2"), user),
    (error) => error.status === 403 && error.code === "FORBIDDEN",
  );
  assert.equal(rejectedData.cases[0].case_id, "CASE-2");
});

test("disabled deletion preserves existing attachments", async () => {
  const documents = [{ id:"DOC-1", token:"token-1" }];
  const data = { cases:[{ case_id:"CASE-1", Документы:documents }], employees:[] };
  const harness = createHarness({ body:{ documentIds:["DOC-1"] }, data });
  await harness.handle({method:"DELETE"}, {}, new URL("http://localhost/api/cases/CASE-1/documents"), {role:"Администратор"});
  assert.equal(harness.responses[0].status, 410);
  assert.equal(harness.attachmentReplacements.length, 0);
  assert.deepEqual(data.cases[0].Документы, documents);
});
