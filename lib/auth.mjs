import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const PASSWORD_PREFIX = "scrypt";
const SESSION_TTL_SECONDS = Number(process.env.AUTH_SESSION_TTL_SECONDS || 60 * 60 * 24 * 14);

export const ROLE = {
  employee: "Сотрудник",
  manager: "Руководитель",
  admin: "Администратор",
};

export const SYSTEM_EMPLOYEE_ID = "EMP-000";

export function cleanLogin(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeRole(value) {
  const role = String(value ?? "").trim().toLowerCase();
  if (role === ROLE.admin.toLowerCase()) return ROLE.admin;
  if (role === ROLE.manager.toLowerCase()) return ROLE.manager;
  return ROLE.employee;
}

export function isManagerRole(role) {
  const normalized = normalizeRole(role);
  return normalized === ROLE.manager || normalized === ROLE.admin;
}

export function isAdminRole(role) {
  return normalizeRole(role) === ROLE.admin;
}

export function isSystemEmployee(employee = {}) {
  return String(employee.employee_id ?? "").trim() === SYSTEM_EMPLOYEE_ID;
}

export function assertPasswordPolicy(password) {
  const value = String(password ?? "");
  if (value.length < 10) {
    throw new Error("Пароль должен содержать не менее 10 символов.");
  }
  if (value.length > 256) {
    throw new Error("Пароль слишком длинный.");
  }
}

export async function hashSecret(value) {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(String(value ?? ""), salt, 64);
  return `${PASSWORD_PREFIX}$${salt}$${Buffer.from(derived).toString("base64url")}`;
}

export async function verifySecret(value, storedHash) {
  const [prefix, salt, encoded] = String(storedHash ?? "").split("$");
  if (prefix !== PASSWORD_PREFIX || !salt || !encoded) return false;
  try {
    const actual = Buffer.from(await scrypt(String(value ?? ""), salt, 64));
    const expected = Buffer.from(encoded, "base64url");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function parseBase64urlJson(value) {
  try {
    return JSON.parse(Buffer.from(String(value ?? ""), "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function sign(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function passwordVersion(passwordHash, secret) {
  return sign(`password:${String(passwordHash ?? "")}`, secret).slice(0, 20);
}

export function createSessionToken(user, secret, now = Date.now()) {
  const header = base64urlJson({ alg: "HS256", typ: "LDS" });
  const payload = base64urlJson({
    sub: String(user.employeeId ?? ""),
    login: cleanLogin(user.login),
    role: normalizeRole(user.role),
    version: String(user.passwordVersion ?? ""),
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  });
  const signed = `${header}.${payload}`;
  return `${signed}.${sign(signed, secret)}`;
}

export function verifySessionToken(token, secret, now = Date.now()) {
  const [header, payload, signature] = String(token ?? "").split(".");
  if (!header || !payload || !signature) return null;
  const signed = `${header}.${payload}`;
  const expected = sign(signed, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  const claims = parseBase64urlJson(payload);
  if (!claims || !claims.sub || !claims.login || !claims.exp || Number(claims.exp) <= Math.floor(now / 1000)) return null;
  return {
    employeeId: String(claims.sub),
    login: cleanLogin(claims.login),
    role: normalizeRole(claims.role),
    passwordVersion: String(claims.version ?? ""),
    expiresAt: Number(claims.exp) * 1000,
  };
}

export function generateFirstAccessCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  const groups = [];
  for (let index = 0; index < 10; index += 1) {
    if (index && index % 5 === 0) groups.push("-");
    groups.push(alphabet[bytes[index] % alphabet.length]);
  }
  return groups.join("");
}

export function sessionTtlSeconds() {
  return SESSION_TTL_SECONDS;
}
