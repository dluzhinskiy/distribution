import test from "node:test";
import assert from "node:assert/strict";
import { caseDeepLinkPath, caseIdFromPathname, isCaseDeepLinkPath } from "../public/lib/case-deep-link.js";

test("case deep link combines a stable prefix with encoded case_id", () => {
  assert.equal(caseDeepLinkPath("CASE-1549"), "/case/CASE-1549");
  assert.equal(caseDeepLinkPath(" Дело 15/49 "), "/case/%D0%94%D0%B5%D0%BB%D0%BE%2015%2F49");
});

test("case deep link extracts case_id and rejects unrelated paths", () => {
  assert.equal(caseIdFromPathname("/case/CASE-1549"), "CASE-1549");
  assert.equal(caseIdFromPathname("/case/CASE-1549/"), "CASE-1549");
  assert.equal(caseIdFromPathname("/case/%D0%94%D0%B5%D0%BB%D0%BE-1"), "Дело-1");
  assert.equal(caseIdFromPathname("/cases/CASE-1549"), "");
  assert.equal(isCaseDeepLinkPath("/case/CASE-1549"), true);
});
