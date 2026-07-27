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
