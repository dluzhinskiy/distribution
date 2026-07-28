import test from "node:test";
import assert from "node:assert/strict";
import { FIELD, cleanText } from "../lib/domain.mjs";
import { createCaseImportRoutes } from "../routes/case-import-routes.mjs";

function createHarness({ body, data }) {
  const responses = [];
  const created = [];
  const patched = [];
  let reads = 0;
  const handle = createCaseImportRoutes({
    readBody: async () => body,
    readBinaryBody: async () => Buffer.alloc(0),
    readData: async () => {
      reads += 1;
      return data;
    },
    readDirectories: async () => ({}),
    createTableRows: async (table, rows) => created.push({ table, rows: [...rows] }),
    patchTableRows: async (table, rows) => patched.push({ table, rows: [...rows] }),
    cacheVersions: () => ({ cases: 4, employees: 2 }),
    sendJson: (_res, status, payload) => responses.push({ status, payload }),
    requireManageYuc: () => {},
    requireEmployeeInYuc: () => {},
    findCase: (currentData, caseId) => (currentData.cases ?? [])
      .find((row) => cleanText(row.case_id) === cleanText(caseId)),
  });
  return { handle, responses, created, patched, get reads() { return reads; } };
}

test("case import apply writes only changed rows and returns a compact delta", async () => {
  const data = {
    cases: [{
      case_id: "CASE-0001",
      [FIELD.yuc]: "ЮЦ 1",
      [FIELD.caseType]: "судебное",
      [FIELD.responsible]: "Иванов Иван Иванович",
      [FIELD.status]: "В работе",
      "Дата поступления": "2026-07-28",
      [FIELD.caseMovement]: "Старое движение",
      "Ссылка": "https://casepro.example/existing",
    }],
    employees: [{
      employee_id: "EMP-1",
      [FIELD.name]: "Иванов Иван Иванович",
      [FIELD.yuc]: "ЮЦ 1",
      [FIELD.employeeActive]: "Да",
      "Судебные": "Да",
    }],
  };
  const body = {
    cacheVersions: { cases: 4, employees: 2 },
    updates: [{
      caseId: "CASE-0001",
      source: { [FIELD.caseMovement]: "Новое движение" },
    }],
    rows: [{
      rowNumber: 8,
      source: {
        "Номер дела": "А40-8/2026",
        "Предмет": "Новый спор",
        [FIELD.yuc]: "ЮЦ 1",
        "Регион": "Регион 1",
        [FIELD.caseType]: "судебное",
        "Дата поступления": "2026-07-28",
        [FIELD.responsible]: "Иванов Иван Иванович",
        "Ссылка": "https://casepro.example/new",
      },
    }],
  };
  const harness = createHarness({ body, data });
  const matched = await harness.handle(
    { method: "POST" },
    {},
    new URL("http://localhost/api/cases/import-apply"),
    { role: "Руководитель", yuc: "ЮЦ 1" },
  );

  assert.equal(matched, true);
  assert.equal(harness.responses[0].status, 200);
  assert.deepEqual(harness.responses[0].payload.result, {
    added: 1,
    updated: 1,
    skipped: 0,
    movementConfirmed: 1,
    firstCaseId: "CASE-0002",
    lastCaseId: "CASE-0002",
    previewSnapshotCurrent: true,
  });
  assert.deepEqual(harness.responses[0].payload.cases.map((row) => row.case_id), ["CASE-0002", "CASE-0001"]);
  assert.equal(harness.responses[0].payload.employees[0]["Активные всего"], 2);
  assert.equal(harness.patched.length, 1);
  assert.deepEqual(harness.patched[0].rows[0].changedFields, [FIELD.caseMovement]);
  assert.equal(harness.created.length, 1);
  assert.equal(harness.created[0].rows.length, 1);
  assert.equal(harness.reads, 2);
  assert.equal(Object.hasOwn(harness.responses[0].payload, "data"), false);
});
