import test from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  nameMatches,
  normalizeCaseType,
  normalizeYucName,
  uniqueYucs,
  workloadCaseType,
  yesNo,
} from "../public/lib/ui-utils.js";

test("client normalization follows application dictionaries", () => {
  assert.equal(normalizeYucName(" юц дв "), "Дальний Восток");
  assert.equal(normalizeCaseType("СУД"), "судебное");
  assert.equal(workloadCaseType("банкротное"), "судебное");
  assert.equal(yesNo("1"), "Да");
  assert.deepEqual(uniqueYucs(["ДВ", "Дальний Восток", "КЦ/ДСАП"]), ["Дальний Восток", "КЦ"]);
});

test("client text helpers escape HTML and compare supported name forms", () => {
  assert.equal(escapeHtml('<a href="x">'), "&lt;a href=&quot;x&quot;&gt;");
  assert.equal(nameMatches("Иванов Иван Иванович", "Иванов И.И."), true);
  assert.equal(nameMatches("Иванов Иван", "Петров П.П."), false);
});
