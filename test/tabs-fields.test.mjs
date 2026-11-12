import test from "node:test";
import assert from "node:assert/strict";
import { inboundFieldValue, outboundFieldName, tableFieldKey } from "../lib/tabs-fields.mjs";

test("coefficient table reads and writes field names", () => {
  assert.equal(tableFieldKey({}), "name");
  assert.equal(outboundFieldName({}, "Тип нагрузки"), "Тип нагрузки");
  assert.equal(inboundFieldValue({}, { "Тип нагрузки": "судебное" }, "Тип нагрузки"), "судебное");
});

test("name-based tables tolerate non-breaking whitespace in field names", () => {
  assert.equal(inboundFieldValue({}, { "\u00a0Тип нагрузки": "претензия" }, "Тип нагрузки"), "претензия");
});
