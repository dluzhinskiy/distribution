import test from "node:test";
import assert from "node:assert/strict";
import { managerScopedData, readRequestedTables, tableKeysForView } from "../lib/view-data.mjs";

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

test("route reads return only explicitly requested tables", async () => {
  const calls = [];
  const result = await readRequestedTables(async (keys, options) => {
    calls.push({ keys, options });
    return { settings: [{ value: 1 }] };
  }, ["settings"], { force: true });
  assert.deepEqual(calls, [{ keys: ["settings"], options: { force: true } }]);
  assert.deepEqual(result, { settings: [{ value: 1 }] });
  assert.equal(Object.prototype.hasOwnProperty.call(result, "cases"), false);
});
