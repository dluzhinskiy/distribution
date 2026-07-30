import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeApiPayload, sendJson } from "../lib/http-utils.mjs";
import { FIELD } from "../lib/domain.mjs";

test("API payload removes authentication secrets and attachment storage tokens", () => {
  const payload = sanitizeApiPayload({
    employees: [{ employee_id: "EMP-1", "Хэш-пароля": "secret", "Хэш кода первичного входа": "code" }],
    cases: [{ case_id: "CASE-1", [FIELD.documents]: [{ id: "DOC-1", token: "private", url: "private-url", name: "file.pdf" }] }],
  });
  assert.deepEqual(payload.employees, [{ employee_id: "EMP-1" }]);
  assert.deepEqual(payload.cases[0][FIELD.documents], [{
    id: "DOC-1",
    name: "file.pdf",
    size: 0,
    mimeType: "application/octet-stream",
    width: 0,
    height: 0,
  }]);
});

test("JSON responses are never cached", () => {
  const response = {
    status: 0,
    headers: {},
    body: "",
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
  };
  sendJson(response, 200, { ok: true });
  assert.equal(response.status, 200);
  assert.match(response.headers["Cache-Control"], /no-store/);
  assert.equal(response.headers["Content-Length"], Buffer.byteLength(response.body));
  assert.deepEqual(JSON.parse(response.body), { ok: true });
});
