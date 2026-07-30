import test from "node:test";
import assert from "node:assert/strict";
import { createTableCache } from "../lib/table-cache.mjs";

test("table cache reuses reads, returns clones and supports forced refresh", async () => {
  let reads = 0;
  const source = [{ value: 1 }];
  const cache = createTableCache({
    readFresh: async ([key]) => {
      reads += 1;
      return { [key]: source.map((row) => ({ ...row })) };
    },
    tableKeys: ["cases"],
    bootstrapKeys: ["cases"],
    ttlByTable: { cases: 60_000 },
    defaultTtl: 60_000,
  });

  const first = await cache.read();
  first.cases[0].value = 99;
  const second = await cache.read();
  assert.equal(reads, 1);
  assert.equal(second.cases[0].value, 1);

  await cache.read(["cases"], { force: true });
  assert.equal(reads, 2);
  assert.equal(cache.status().cachedTables.cases.loaded, true);
});

test("parallel requests for the same table share an in-flight read", async () => {
  let reads = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const cache = createTableCache({
    readFresh: async ([key]) => {
      reads += 1;
      await pending;
      return { [key]: [] };
    },
    tableKeys: ["cases"],
    bootstrapKeys: ["cases"],
    ttlByTable: {},
    defaultTtl: 60_000,
  });
  const first = cache.read();
  const second = cache.read();
  release();
  await Promise.all([first, second]);
  assert.equal(reads, 1);
});

test("overlapping requests share in-flight reads per table", async () => {
  const reads = new Map();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const cache = createTableCache({
    readFresh: async ([key]) => {
      reads.set(key, (reads.get(key) ?? 0) + 1);
      await pending;
      return { [key]: [] };
    },
    tableKeys: ["cases", "employees"],
    bootstrapKeys: ["cases", "employees"],
    ttlByTable: {},
    defaultTtl: 60_000,
  });
  const first = cache.read(["cases", "employees"]);
  const second = cache.read(["employees"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(Object.fromEntries(reads), { cases: 1, employees: 1 });
});

test("successful mutation can replace one cached table without reading storage", async () => {
  let reads = 0;
  const cache = createTableCache({
    readFresh: async () => { reads += 1; return { employees: [{ employee_id: "OLD" }] }; },
    tableKeys: ["employees"],
    bootstrapKeys: ["employees"],
    ttlByTable: {},
    defaultTtl: 60_000,
  });
  await cache.read(["employees"]);
  cache.replace("employees", [{ employee_id: "NEW" }]);
  assert.deepEqual((await cache.read(["employees"])).employees, [{ employee_id: "NEW" }]);
  assert.equal(reads, 1);
  assert.equal(cache.status().cachedTables.employees.version, 2);
});

test("cache exposes lightweight table versions for import preview snapshots", async () => {
  const cache = createTableCache({
    readFresh: async ([key]) => ({ [key]: [] }),
    tableKeys: ["cases", "employees"],
    bootstrapKeys: ["cases", "employees"],
    ttlByTable: {},
    defaultTtl: 60_000,
  });
  assert.deepEqual(cache.versions(["cases", "employees"]), { cases: 0, employees: 0 });
  await cache.read(["cases"]);
  assert.deepEqual(cache.versions(["cases", "employees"]), { cases: 1, employees: 0 });
  cache.replace("employees", []);
  assert.deepEqual(cache.versions(["cases", "employees"]), { cases: 1, employees: 1 });
});

test("cache snapshot returns only loaded tables and never triggers missing reads", async () => {
  let reads = 0;
  const cache = createTableCache({
    readFresh: async ([key]) => { reads += 1; return { [key]: [{ key }] }; },
    tableKeys: ["cases", "employees"],
    bootstrapKeys: ["cases", "employees"],
    ttlByTable: {},
    defaultTtl: 60_000,
  });
  await cache.read(["employees"]);
  const snapshot = cache.snapshot();
  assert.deepEqual(Object.keys(snapshot), ["employees"]);
  assert.deepEqual(snapshot.employees, [{ key: "employees" }]);
  assert.equal(reads, 1);
});
