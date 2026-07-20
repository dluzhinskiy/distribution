import { timingSafeEqual } from "node:crypto";
import {
  ROLE,
  SYSTEM_EMPLOYEE_ID,
  assertPasswordPolicy,
  cleanLogin,
  createSessionToken,
  generateFirstAccessCode,
  hashSecret,
  isAdminRole,
  isManagerRole,
  isSystemEmployee,
  normalizeRole,
  passwordVersion,
  sessionTtlSeconds,
  verifySecret,
  verifySessionToken,
} from "./auth.mjs";
import { cleanText, normalizeYuc } from "./domain.mjs";

export const AUTH_SESSION_COOKIE = "load_distribution_session";

export function createAuthController({ readData, saveEmployee, sendJson, readBody }) {
  const secret = cleanText(process.env.AUTH_SESSION_SECRET);
  const bootstrapAdminLogin = cleanLogin(process.env.BOOTSTRAP_ADMIN_LOGIN);
  const bootstrapAdminCode = String(process.env.BOOTSTRAP_ADMIN_CODE ?? "");

  function configured() {
    return secret.length >= 32;
  }

  function parseCookies(req) {
    return Object.fromEntries(String(req.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index < 0 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }));
  }

  function sessionCookie(req, token, maxAge = sessionTtlSeconds()) {
    const values = [
      `${AUTH_SESSION_COOKIE}=${encodeURIComponent(token ?? "")}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${Math.max(0, Number(maxAge) || 0)}`,
    ];
    if (req.headers["x-forwarded-proto"] === "https") values.push("Secure");
    return values.join("; ");
  }

  function publicUser(employee) {
    return {
      employeeId: cleanText(employee.employee_id),
      name: cleanText(employee["ФИО"]),
      login: cleanLogin(employee["Логин"]),
      role: normalizeRole(employee["Роль доступа"]),
      yuc: cleanText(employee["ЮЦ"]),
      system: isSystemEmployee(employee),
    };
  }

  function findByLogin(employees, login) {
    const normalized = cleanLogin(login);
    return (employees ?? []).find((employee) => cleanLogin(employee["Логин"]) === normalized) ?? null;
  }

  function firstAccessExpiresAt(employee = {}) {
    const value = Number(String(employee["Хэш кода первичного входа"] ?? "").split("$").at(-1));
    return Number.isFinite(value) && value > 1_000_000_000_000 ? value : 0;
  }

  function codeHashWithExpiry(hash, expiresAt) {
    return `${hash}$${expiresAt}`;
  }

  function sameSecret(left, right) {
    const a = Buffer.from(String(left ?? ""));
    const b = Buffer.from(String(right ?? ""));
    return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  }

  function sessionHeaders(req, employee, maxAge = sessionTtlSeconds()) {
    const user = publicUser(employee);
    const token = createSessionToken({
      ...user,
      passwordVersion: passwordVersion(cleanText(employee["Хэш-пароля"]), secret),
    }, secret);
    return { user, headers: { "Set-Cookie": sessionCookie(req, token, maxAge) } };
  }

  async function currentUser(req) {
    if (!configured()) return null;
    const claims = verifySessionToken(parseCookies(req)[AUTH_SESSION_COOKIE], secret);
    if (!claims) return null;
    const data = await readData(["employees"]);
    const employee = data.employees.find((item) => cleanText(item.employee_id) === claims.employeeId);
    const hash = cleanText(employee?.["Хэш-пароля"]);
    if (!employee || cleanLogin(employee["Логин"]) !== claims.login || !hash) return null;
    if (passwordVersion(hash, secret) !== claims.passwordVersion) return null;
    return publicUser(employee);
  }

  async function handleAuth(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/auth/session") {
      const user = await currentUser(req);
      sendJson(res, 200, {
        ok: true,
        authenticated: Boolean(user),
        configured: configured(),
        user,
        message: configured() ? "" : "Не задан AUTH_SESSION_SECRET длиной не менее 32 символов.",
      });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      if (!configured()) throw Object.assign(new Error("Авторизация ещё не настроена: задайте AUTH_SESSION_SECRET."), { status: 503 });
      const body = await readBody(req);
      const data = await readData(["employees"], { force: true });
      const employee = findByLogin(data.employees, body.login);
      if (!employee || !cleanText(employee["Хэш-пароля"]) || !await verifySecret(body.password, employee["Хэш-пароля"])) {
        throw Object.assign(new Error("Неверный логин или пароль."), { status: 401 });
      }
      const session = sessionHeaders(req, employee);
      sendJson(res, 200, { ok: true, authenticated: true, user: session.user }, session.headers);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/first-access") {
      if (!configured()) throw Object.assign(new Error("Авторизация ещё не настроена: задайте AUTH_SESSION_SECRET."), { status: 503 });
      const body = await readBody(req);
      assertPasswordPolicy(body.password);
      const login = cleanLogin(body.login);
      const data = await readData(["employees"], { force: true });
      const employee = findByLogin(data.employees, login);
      if (!employee) throw Object.assign(new Error("Неверный логин или код первичного входа."), { status: 401 });
      if (cleanText(employee["Хэш-пароля"])) {
        throw Object.assign(new Error("Пароль уже установлен. Используйте обычный вход."), { status: 409 });
      }
      const storedCode = cleanText(employee["Хэш кода первичного входа"]);
      const codeAccepted = Boolean(storedCode && firstAccessExpiresAt(employee) > Date.now() && await verifySecret(body.code, storedCode));
      const bootstrapAccepted = Boolean(
        cleanText(employee.employee_id) === SYSTEM_EMPLOYEE_ID &&
        isAdminRole(employee["Роль доступа"]) &&
        bootstrapAdminLogin && bootstrapAdminCode && login === bootstrapAdminLogin && sameSecret(body.code, bootstrapAdminCode)
      );
      if (!codeAccepted && !bootstrapAccepted) {
        throw Object.assign(new Error("Неверный или просроченный код первичного входа."), { status: 401 });
      }
      employee["Хэш-пароля"] = await hashSecret(body.password);
      employee["Хэш кода первичного входа"] = "";
      employee["Срок действия кода"] = "";
      const confirmed = await saveEmployee(data, employee);
      const session = sessionHeaders(req, confirmed);
      sendJson(res, 200, { ok: true, authenticated: true, user: session.user }, session.headers);
      return true;
    }

    return false;
  }

  function canManageAccessForEmployee(user, employee) {
    if (isAdminRole(user?.role)) return true;
    const managerYuc = cleanText(user?.yuc);
    const employeeYuc = cleanText(employee?.["ЮЦ"]);
    return isManagerRole(user?.role) && managerYuc && employeeYuc && normalizeYuc(managerYuc) === normalizeYuc(employeeYuc);
  }

  async function handleAccess(req, res, url, user) {
    if (!url.pathname.startsWith("/api/access/")) return false;
    if (!isManagerRole(user?.role)) throw Object.assign(new Error("Для этого действия нужны права руководителя или администратора."), { status: 403 });
    const admin = isAdminRole(user?.role);
    if (req.method === "GET" && url.pathname === "/api/access/users") {
      const data = await readData(["employees"], { force: true });
      const users = data.employees
        .filter((employee) => !isSystemEmployee(employee) && canManageAccessForEmployee(user, employee))
        .map((employee) => ({
          ...publicUser(employee),
          hasPassword: Boolean(cleanText(employee["Хэш-пароля"])),
          firstAccessExpiresAt: firstAccessExpiresAt(employee),
          firstAccessDays: Number(employee["Срок действия кода"]) || 0,
        }))
        .sort((a, b) => Number(b.system) - Number(a.system) || a.name.localeCompare(b.name, "ru"));
      sendJson(res, 200, { ok: true, users, canManageRoles: admin });
      return true;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const employeeId = decodeURIComponent(parts[3] ?? "");
    const data = await readData(["employees"], { force: true });
    const employee = data.employees.find((item) => cleanText(item.employee_id) === employeeId);
    if (!employee) throw Object.assign(new Error("Сотрудник не найден."), { status: 404 });
    if (!canManageAccessForEmployee(user, employee)) throw Object.assign(new Error("Можно выдавать доступ только сотрудникам своего ЮЦ."), { status: 403 });

    if (req.method === "PATCH" && parts.length === 4) {
      if (!admin) throw Object.assign(new Error("Изменять роли может только администратор."), { status: 403 });
      const body = await readBody(req);
      employee["Роль доступа"] = normalizeRole(body.role);
      const confirmed = await saveEmployee(data, employee);
      sendJson(res, 200, { ok: true, user: publicUser(confirmed) });
      return true;
    }

    if (req.method === "POST" && parts.length === 5 && parts[4] === "first-access-code") {
      const body = await readBody(req);
      const days = Math.max(1, Math.min(30, Math.floor(Number(body.days) || 7)));
      const code = generateFirstAccessCode();
      employee["Хэш кода первичного входа"] = codeHashWithExpiry(await hashSecret(code), Date.now() + days * 24 * 60 * 60 * 1000);
      employee["Срок действия кода"] = days;
      const confirmed = await saveEmployee(data, employee);
      sendJson(res, 200, { ok: true, code, expiresAt: firstAccessExpiresAt(confirmed), user: publicUser(confirmed) });
      return true;
    }

    throw Object.assign(new Error("Метод управления доступом не найден."), { status: 404 });
  }

  return {
    configured,
    currentUser,
    handleAuth,
    handleAccess,
    publicUser,
    isManager: (user) => isManagerRole(user?.role),
    isAdmin: (user) => isAdminRole(user?.role),
    isSystemEmployee,
    roleOptions: [ROLE.employee, ROLE.manager, ROLE.admin],
  };
}
