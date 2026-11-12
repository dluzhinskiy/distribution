import test from "node:test";
import assert from "node:assert/strict";
import { createOperationGuard } from "../lib/operation-guard.mjs";

test("operation guard prevents concurrent and completed duplicate mutations", async () => {
  const guard = createOperationGuard();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const first = guard.run("op-1", async () => pending);
  await assert.rejects(guard.run("op-1", async () => "duplicate"), (error) => (
    error.status === 409 && error.code === "DUPLICATE_OPERATION" && error.details.state === "running"
  ));
  release("ok");
  assert.equal(await first, "ok");
  await assert.rejects(guard.run("op-1", async () => "duplicate"), (error) => error.details.state === "completed");
});

test("operation guard does not deduplicate requests without an operation id", async () => {
  const guard = createOperationGuard();
  assert.equal(await guard.run("", async () => 1), 1);
  assert.equal(await guard.run(null, async () => 2), 2);
});
