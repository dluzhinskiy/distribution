import test from "node:test";
import assert from "node:assert/strict";
import { createAppState, viewTitles } from "../public/lib/app-state.js";

test("each client state owns independent mutable collections", () => {
  const first = createAppState();
  const second = createAppState();
  first.caseImportSelectedRows.add(4);
  first.dirtyViews.clear();
  first.loadedViews.add("cases");
  first.loadingViews.add("settings");
  first.responsibleDrafts.CASE = "Иванов";
  assert.equal(second.caseImportSelectedRows.size, 0);
  assert.deepEqual(second.responsibleDrafts, {});
  assert.equal(second.dirtyViews.has("dashboard"), true);
  assert.equal(second.loadedViews.size, 0);
  assert.equal(second.loadingViews.size, 0);
  assert.equal(viewTitles.settings, "Настройки региональных правил");
});
