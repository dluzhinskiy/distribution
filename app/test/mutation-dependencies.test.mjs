import test from "node:test";
import assert from "node:assert/strict";
import { mutationReadTables } from "../lib/mutation-dependencies.mjs";

test("access mutations refresh only employees", () => {
  assert.deepEqual(mutationReadTables("POST", "/api/access/users/EMP-001/first-access-code"), ["employees"]);
  assert.deepEqual(mutationReadTables("PATCH", "/api/access/users/EMP-001"), ["employees"]);
});

test("employee availability and debts are refreshed as one operation", () => {
  assert.deepEqual(mutationReadTables("PATCH", "/api/employees/EMP-001"), ["employees", "queues"]);
});

test("settings mutations refresh only their dependencies", () => {
  assert.deepEqual(mutationReadTables("PUT", "/api/load-coefficients"), ["loadCoefficients"]);
  assert.deepEqual(mutationReadTables("POST", "/api/regional-assignments/upsert"), ["employees", "regionalAssignments"]);
});

test("automatic assignment refreshes the distribution snapshot without dashboard coefficients", () => {
  const tables = mutationReadTables("POST", "/api/assign-auto");
  assert.equal(tables.includes("cases"), true);
  assert.equal(tables.includes("queues"), true);
  assert.equal(tables.includes("loadCoefficients"), false);
});
