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

test("case import assigns IDs in one pass and detects duplicates inside the batch", () => {
  const cases = Array.from({ length: 10_000 }, (_, index) => ({
    case_id: `CASE-${String(index + 1).padStart(5, "0")}`,
    "Ссылка": `https://casepro.example/case/${index + 1}`,
  }));
  const rows = Array.from({ length: 500 }, (_, index) => ({
    rowNumber: index + 2,
    source: {
      "Предмет": `Предмет ${index}`,
      "Тип дела": "судебное",
      "Дата поступления": "2026-07-28",
      "ЮЦ": "ЮЦ 1",
      "Регион": "Регион 1",
      "Ссылка": `https://casepro.example/new/${index}`,
    },
  }));
  rows.push({ ...rows[0], rowNumber: 502 });

  const result = importCasesFromRows({ cases }, rows);
  assert.equal(result.added.length, 500);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.added[0].case_id, "CASE-10001");
  assert.equal(result.added.at(-1).case_id, "CASE-10500");
});
