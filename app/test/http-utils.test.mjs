import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { publicAttachment, sanitizeApiPayload, sendJson, serveStatic } from "../lib/http-utils.mjs";
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

test("new attachment receives an opaque public id without exposing its storage token", () => {
  const attachment = publicAttachment({ token: "private/storage/token", name: "new.pdf", size: 42 });
  assert.match(attachment.id, /^doc_[a-f0-9]{24}$/);
  assert.equal(JSON.stringify(attachment).includes("private/storage/token"), false);
  assert.equal(attachment.name, "new.pdf");
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

test("JavaScript is revalidated so browser cannot mix application releases", async () => {
  const publicDir = await fs.mkdtemp(path.join(os.tmpdir(), "mts-static-cache-"));
  await fs.writeFile(path.join(publicDir, "app.js"), "export const version = 1;\n");
  const response = {
    status: 0,
    headers: {},
    body: Buffer.alloc(0),
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
    end(body = Buffer.alloc(0)) { this.body = body; },
  };
  await serveStatic({ headers: {} }, response, new URL("http://localhost/app.js"), publicDir);
  assert.equal(response.status, 200);
  assert.equal(response.headers["Cache-Control"], "public, no-cache, must-revalidate");
  assert.match(response.headers.ETag, /^W\//);
});
