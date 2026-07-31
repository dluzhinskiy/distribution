import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { FIELD, cleanText } from "./domain.mjs";

const PRIVATE_EMPLOYEE_FIELDS = new Set(["Хэш-пароля", "Хэш кода первичного входа"]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export function publicAttachmentStorageId(attachment = {}) {
  const storageKey = cleanText(attachment.token || attachment.url);
  return storageKey
    ? `doc_${createHash("sha256").update(storageKey).digest("hex").slice(0, 24)}`
    : "";
}

export function publicAttachmentId(attachment = {}) {
  return cleanText(attachment.id) || publicAttachmentStorageId(attachment);
}

export function publicAttachment(attachment = {}) {
  return {
    id: publicAttachmentId(attachment),
    name: cleanText(attachment.name) || "Документ",
    size: Number(attachment.size) || 0,
    mimeType: cleanText(attachment.mimeType) || "application/octet-stream",
    width: Number(attachment.width) || 0,
    height: Number(attachment.height) || 0,
  };
}

export function sanitizeApiPayload(value, key = "") {
  if (Array.isArray(value)) {
    if (key === "employees") {
      return value.map((employee) => {
        const copy = { ...employee };
        for (const field of PRIVATE_EMPLOYEE_FIELDS) delete copy[field];
        return copy;
      });
    }
    if (key === "cases") {
      return value.map((caseRow) => ({
        ...caseRow,
        [FIELD.documents]: Array.isArray(caseRow?.[FIELD.documents])
          ? caseRow[FIELD.documents].map(publicAttachment)
          : [],
      }));
    }
    return value.map((item) => sanitizeApiPayload(item));
  }
  if (!value || typeof value !== "object") return value;
  const sanitized = Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [childKey, sanitizeApiPayload(childValue, childKey)]),
  );
  if (Array.isArray(sanitized[FIELD.documents])) {
    sanitized[FIELD.documents] = sanitized[FIELD.documents].map(publicAttachment);
  }
  return sanitized;
}

export function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(sanitizeApiPayload(payload));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
    "Expires": "0",
    ...headers,
  });
  res.end(body);
}

export function readJsonBody(req, maxBytes = 2_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        const error = new Error("Слишком большой запрос.");
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        const error = new Error("Не удалось прочитать JSON.");
        error.status = 400;
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

export function readBinaryBody(req, maxBytes = 12_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error("Файл слишком большой.");
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function serveStatic(req, res, url, publicDir) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const relativePath = requested.replace(/^\/+/, "");
  const filePath = path.resolve(publicDir, relativePath);
  const publicRoot = `${path.resolve(publicDir)}${path.sep}`;
  if (filePath !== path.resolve(publicDir) && !filePath.startsWith(publicRoot)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    const [data, stat] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)]);
    const etag = `W/\"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}\"`;
    const headers = {
      "Content-Type": MIME[path.extname(filePath)] ?? "application/octet-stream",
      "Content-Length": data.length,
      ETag: etag,
    };
    if (requested === "/index.html") {
      headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private";
      headers.Pragma = "no-cache";
      headers.Expires = "0";
    } else {
      headers["Cache-Control"] = "public, max-age=300, must-revalidate";
    }
    if (req.headers?.["if-none-match"] === etag) {
      res.writeHead(304, { ETag: etag, "Cache-Control": headers["Cache-Control"] });
      return res.end();
    }
    res.writeHead(200, headers);
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}
