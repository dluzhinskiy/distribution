import test from "node:test";
import assert from "node:assert/strict";
import { validateLoadCoefficients } from "../lib/load-coefficients.mjs";
import { loadCoefficientConfig, weightedCases, weightedGroupBreakdown } from "../public/lib/load-coefficients.js";

const rows = [
  ["судебное", 1], ["административное", 0.5], ["претензия", 0.3], ["уголовное", 1.5], ["банкротное", 2],
].map(([type, coefficient]) => ({ "Тип нагрузки": type, "Коэффициент": coefficient }));

test("five positive coefficients form a valid global configuration", () => {
  assert.equal(validateLoadCoefficients(rows).length, 5);
  assert.equal(loadCoefficientConfig(rows).valid, true);
  assert.throws(() => validateLoadCoefficients(rows.map((row, index) => index ? row : { ...row, "Коэффициент": 0 })), /больше нуля/);
});

test("weighted dashboard keeps criminal and bankruptcy in the judicial group with exact coefficients", () => {
  const config = loadCoefficientConfig(rows);
  const cases = ["судебное", "административное", "претензия", "уголовное", "банкротное"].map((type) => ({ "Тип дела": type }));
  assert.equal(weightedCases(cases, config), 5.3);
  assert.equal(weightedCases([{ "Тип дела": "Судебное дело" }], config), 1);
  assert.deepEqual(weightedGroupBreakdown(cases, config), { "претензия": 0.3, "административное": 0.5, "судебное": 4.5 });
});
