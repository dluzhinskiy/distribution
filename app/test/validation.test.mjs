import test from "node:test";
import assert from "node:assert/strict";
import { assertAllowedFields, positiveNumber, requiredText } from "../lib/validation.mjs";

test("request validation rejects unsupported fields with a stable error code", () => {
  assert.throws(
    () => assertAllowedFields({ allowed: 1, secret: 2 }, new Set(["allowed"])),
    (error) => error.status === 403 && error.code === "FORBIDDEN" && /secret/.test(error.message),
  );
});

test("request validation normalizes required text and numbers", () => {
  assert.equal(requiredText("  значение ", "Поле"), "значение");
  assert.equal(positiveNumber("5", "Срок"), 5);
  assert.throws(() => positiveNumber(0, "Срок"), (error) => error.status === 400);
});
