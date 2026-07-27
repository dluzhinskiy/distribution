import test from "node:test";
import assert from "node:assert/strict";
import { createWriteCoordinator, isMutationRequest } from "../lib/write-coordinator.mjs";

test("write coordinator runs mutations sequentially and refreshes before each", async () => {
  const events = [];
  const coordinator = createWriteCoordinator({ beforeWrite: async () => events.push("refresh") });
  let releaseFirst;
  let markFirstStarted;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  const first = coordinator.run(async () => {
    events.push("first-start");
    markFirstStarted();
    await firstGate;
    events.push("first-end");
  });
  const second = coordinator.run(async () => events.push("second"));
  await firstStarted;
  assert.deepEqual(events, ["refresh", "first-start"]);
  assert.equal(coordinator.status().queued, 1);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["refresh", "first-start", "first-end", "refresh", "second"]);
});

test("request method classification leaves reads outside the write queue", () => {
  assert.equal(isMutationRequest("GET"), false);
  assert.equal(isMutationRequest("HEAD"), false);
  assert.equal(isMutationRequest("POST"), true);
  assert.equal(isMutationRequest("PATCH"), true);
  assert.equal(isMutationRequest("POST", "/api/recommend"), false);
  assert.equal(isMutationRequest("POST", "/api/cases/import-preview"), false);
  assert.equal(isMutationRequest("POST", "/api/vacations/import-preview"), false);
  assert.equal(isMutationRequest("POST", "/api/auth/login"), false);
  assert.equal(isMutationRequest("POST", "/api/assign-auto"), true);
});
