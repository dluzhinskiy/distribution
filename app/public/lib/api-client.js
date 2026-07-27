export class ApiError extends Error {
  constructor(message, { status = 0, code = "", errorId = "", path = "", method = "GET" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.errorId = errorId;
    this.path = path;
    this.method = method;
  }
}

export function requestMethod(options = {}) {
  return String(options.method || "GET").toUpperCase();
}

export function isWriteRequest(options = {}) {
  return !["GET", "HEAD", "OPTIONS"].includes(requestMethod(options));
}

function operationId() {
  return globalThis.crypto?.randomUUID?.() || `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function requestJson(path, options = {}) {
  const method = requestMethod(options);
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (isWriteRequest(options) && !headers.has("X-Operation-Id")) headers.set("X-Operation-Id", operationId());
  const response = await fetch(path, { cache: "no-store", ...options, method, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new ApiError(payload.error || `Ошибка HTTP ${response.status}`, {
      status: response.status,
      code: payload.code || "",
      errorId: payload.errorId || "",
      path,
      method,
    });
  }
  return payload;
}

export function uploadBinary(path, file) {
  return requestJson(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
}
