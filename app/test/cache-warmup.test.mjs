import test from "node:test";
import assert from "node:assert/strict";
import { createCacheWarmup, createDeferredWarmup } from "../lib/cache-warmup.mjs";

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

test("deferred full-case warmup waits, runs once and reports readiness", async () => {
  const calls = [];
  let tick = Date.parse("2026-07-30T11:00:00Z");
  const warmup = createDeferredWarmup({
    enabled: true,
    delayMs: 3000,
    delay: async (milliseconds) => calls.push(["delay", milliseconds]),
    run: async () => calls.push(["cases"]),
    now: () => { const value = tick; tick += 20; return value; },
  });

  const first = warmup.schedule();
  const second = warmup.schedule();
  assert.equal(first, second);
  const result = await first;
  assert.equal(result.state, "ready");
  assert.equal(result.durationMs, 20);
  assert.deepEqual(calls, [["delay", 3000], ["cases"]]);
  await warmup.schedule();
  assert.deepEqual(calls, [["delay", 3000], ["cases"]]);
});

test("deferred full-case warmup is non-fatal", async () => {
  let calls = 0;
  const warmup = createDeferredWarmup({
    enabled: true,
    delay: async () => {},
    run: async () => { calls += 1; throw new Error("full cases unavailable"); },
  });
  const result = await warmup.schedule();
  assert.equal(result.state, "failed");
  assert.deepEqual(result.errors, [{ source: "cases", message: "full cases unavailable" }]);
  await warmup.schedule();
  assert.equal(calls, 1);
});

test("disabled deferred warmup does not run", async () => {
  let calls = 0;
  const warmup = createDeferredWarmup({
    enabled: false,
    delay: async () => {},
    run: async () => { calls += 1; },
  });
  assert.equal((await warmup.schedule()).state, "disabled");
  assert.equal(calls, 0);
});

test("deferred warmup can be scheduled again after its cache becomes stale", async () => {
  let runs = 0;
  const warmup = createDeferredWarmup({
    enabled: true,
    delayMs: 0,
    delay: async () => {},
    run: async () => { runs += 1; },
  });
  await warmup.schedule();
  await warmup.schedule();
  assert.equal(runs, 1);
  await warmup.schedule({ force: true });
  assert.equal(runs, 2);
});
