import test from "node:test";
import assert from "node:assert/strict";
import { importCasesFromRows } from "../lib/domain.mjs";
import { FIELD } from "../lib/domain-schema.mjs";

test("case import saves movement in the same flow and skips exact CasePRO duplicate", () => {
  const data = { cases: [] };
  const source = {
    "Номер дела": "А40-123/2026",
    "Ссылка": "https://casepro.example/case/123",
    [FIELD.yuc]: "ЮЦ 1",
    [FIELD.caseType]: "Судебное",
    "Движение дела": "Назначено заседание на 10.08.2026",
  };
  const first = importCasesFromRows(data, [{ rowNumber: 2, source }], new Date("2026-07-27T10:00:00Z"));
  assert.equal(first.added.length, 1);
  assert.equal(first.skipped.length, 0);
  assert.equal(first.added[0]["Движение дела"], source["Движение дела"]);

  const second = importCasesFromRows(data, [{ rowNumber: 2, source }]);
  assert.equal(second.added.length, 0);
  assert.match(second.skipped[0].reason, /CasePRO/);
});
