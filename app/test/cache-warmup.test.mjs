import test from "node:test";
import assert from "node:assert/strict";
import { createCacheWarmup } from "../lib/cache-warmup.mjs";

test("cache warmup loads startup tables and directories", async () => {
  const calls = [];
  let tick = Date.parse("2026-07-30T10:00:00Z");
  const warmup = createCacheWarmup({
    tableKeys: ["cases", "employees"],
    readData: async (keys) => calls.push(["tables", keys]),
    readDirectories: async () => calls.push(["directories"]),
    now: () => { const value = tick; tick += 25; return value; },
  });
  assert.equal(warmup.status().state, "idle");
  const result = await warmup.run();
  assert.equal(result.state, "ready");
  assert.equal(result.durationMs, 25);
  assert.deepEqual(calls, [["tables", ["cases", "employees"]], ["directories"]]);
});

test("cache warmup is non-fatal and reports partial failures", async () => {
  const warmup = createCacheWarmup({
    tableKeys: ["cases"],
    readData: async () => { throw new Error("MTS unavailable"); },
    readDirectories: async () => ({}),
  });
  const result = await warmup.run();
  assert.equal(result.state, "partial");
  assert.deepEqual(result.errors, [{ source: "tables", message: "MTS unavailable" }]);
});

test("concurrent warmup calls share one run", async () => {
  let calls = 0;
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const warmup = createCacheWarmup({
    tableKeys: ["cases"],
    readData: async () => { calls += 1; await wait; },
    readDirectories: async () => {},
  });
  const first = warmup.run();
  const second = warmup.run();
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test("disabled cache warmup performs no reads", async () => {
  let calls = 0;
  const warmup = createCacheWarmup({
    enabled: false,
    tableKeys: ["cases"],
    readData: async () => { calls += 1; },
    readDirectories: async () => { calls += 1; },
  });
  assert.equal((await warmup.run()).state, "disabled");
  assert.equal(calls, 0);
});
