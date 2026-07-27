import test from "node:test";
import assert from "node:assert/strict";
import { managerScopedData, tableKeysForView } from "../lib/view-data.mjs";

test("each screen declares only its required MTS Tabs tables", () => {
  assert.deepEqual(tableKeysForView("settings", []), [
    "settings", "yucSettings", "regionalAssignments", "regionalSubstitutions", "loadCoefficients",
  ]);
  assert.equal(tableKeysForView("dashboard", []).includes("queues"), false);
  assert.equal(tableKeysForView("distribution", []).includes("loadCoefficients"), false);
});

test("partial screen response never invents empty tables", () => {
  const raw = { settings: [{ "ЮЦ": "Юг" }], loadCoefficients: [{ "Тип нагрузки": "судебное", "Коэффициент": 1 }] };
  const result = managerScopedData(raw, new Date(2026, 6, 28));
  assert.deepEqual(Object.keys(result).sort(), ["loadCoefficients", "settings"]);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "cases"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "employees"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "vacations"), false);
});
