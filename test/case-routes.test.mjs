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
    isAdmin: (user) => user.role === "Администратор",
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
    uploadCaseAttachment: async (_table, file) => ({
      id: "DOC-UPLOADED",
      token: "token-uploaded",
      name: file.name,
      mimeType: file.mimeType,
      size: 0,
    }),
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

test("test distribution is admin-only and does not persist queue effects", async () => {
  const data = {
    cases: [],
    employees: [
      { employee_id: "EMP-1", [FIELD.name]: "Иванов И.И.", [FIELD.yuc]: "ЮЦ 1", "Активен": "Да", "Судебные": "Да" },
    ],
    queues: [
      { queue_id: "Q-1", employee_id: "EMP-1", [FIELD.name]: "Иванов И.И.", [FIELD.yuc]: "ЮЦ 1", [FIELD.caseType]: "судебное", [FIELD.position]: 1, [FIELD.debt]: 0 },
    ],
    state: [{ queue_id: "QUEUE-ЮЦ 1-судебное", [FIELD.yuc]: "ЮЦ 1", [FIELD.caseType]: "судебное", "Последняя позиция": 0, "Последний автоназначенный": "", "Цикл": 1 }],
    vacations: [],
    settings: [],
    yucSettings: [],
    regionalAssignments: [],
    regionalSubstitutions: [],
  };
  const body = { draft: { [FIELD.yuc]: "ЮЦ 1", [FIELD.caseType]: "судебное", "Предмет": "Проверка", "Дата поступления": "2026-11-02" } };
  const before = structuredClone(data);
  const manager = createHarness({ body, data });
  await assert.rejects(
    manager.handle({ method: "POST" }, {}, new URL("http://localhost/api/recommend-test"), { role: "Руководитель", yuc: "ЮЦ 1" }),
    (error) => error.status === 403 && error.code === "ADMIN_REQUIRED",
  );

  const admin = createHarness({ body, data });
  const matched = await admin.handle(
    { method: "POST" },
    {},
    new URL("http://localhost/api/recommend-test"),
    { role: "Администратор", yuc: "" },
  );
  assert.equal(matched, true);
  assert.equal(admin.responses[0].payload.persisted, false);
  assert.equal(admin.responses[0].payload.result.candidate, "Иванов И.И.");
  assert.deepEqual(data, before);
  assert.deepEqual(admin.savedTables, []);
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

test("disabled attachments reject deletion and preserve existing files", async () => {
  const documents = [{ id:"DOC-1", token:"token-1" }];
  const data = {
    cases:[{ case_id:"CASE-1", [FIELD.yuc]: "ЮЦ 1", Документы:documents }],
    employees:[],
    yucSettings: [{ [FIELD.yuc]: "ЮЦ 1", "Вложения в карточках": "Нет" }],
  };
  const harness = createHarness({ body:{ documentIds:["DOC-1"] }, data });
  await assert.rejects(
    harness.handle({method:"DELETE"}, {}, new URL("http://localhost/api/cases/CASE-1/documents"), {role:"Администратор"}),
    (error) => error.status === 410 && error.code === "ATTACHMENTS_DISABLED",
  );
  assert.equal(harness.attachmentReplacements.length, 0);
  assert.deepEqual(data.cases[0].Документы, documents);
});

test("enabled attachments allow administrator to remove a selected file", async () => {
  const documents = [
    { id:"DOC-1", token:"token-1" },
    { id:"DOC-2", token:"token-2" },
  ];
  const data = {
    cases:[{ case_id:"CASE-1", [FIELD.yuc]: "ЮЦ 1", Документы:documents }],
    employees:[],
    yucSettings: [{ [FIELD.yuc]: "ЮЦ 1", "Вложения в карточках": "Да" }],
  };
  const harness = createHarness({ body:{ documentIds:["DOC-1"] }, data });
  const matched = await harness.handle(
    {method:"DELETE"},
    {},
    new URL("http://localhost/api/cases/CASE-1/documents"),
    {role:"Администратор"},
  );
  assert.equal(matched, true);
  assert.equal(harness.responses[0].status, 200);
  assert.equal(harness.attachmentReplacements.length, 1);
  assert.deepEqual(data.cases[0].Документы, [documents[1]]);
});

test("enabled upload persists the complete attachment array through the dedicated writer", async () => {
  const existing = { id:"DOC-1", token:"token-1", name:"old.pdf" };
  const data = {
    cases:[{ case_id:"CASE-1", [FIELD.yuc]: "ЮЦ 1", Документы:[existing] }],
    employees:[],
    yucSettings: [{ [FIELD.yuc]: "ЮЦ 1", "Вложения в карточках": "Да" }],
  };
  const harness = createHarness({ data });
  const matched = await harness.handle(
    { method:"POST", headers:{ "x-file-name":"new.pdf", "x-file-type":"application/pdf" } },
    {},
    new URL("http://localhost/api/cases/CASE-1/documents"),
    { role:"Администратор" },
  );
  assert.equal(matched, true);
  assert.equal(harness.responses[0].status, 200);
  assert.equal(harness.attachmentReplacements.length, 1);
  assert.deepEqual(data.cases[0].Документы.map((item) => item.name), ["old.pdf", "new.pdf"]);
});
