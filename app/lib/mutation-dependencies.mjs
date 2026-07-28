const DISTRIBUTION_TABLES = [
  "cases", "employees", "queues", "state", "vacations", "settings",
  "yucSettings", "regionalAssignments", "regionalSubstitutions",
];

export const ALL_MUTATION_TABLES = [...DISTRIBUTION_TABLES, "loadCoefficients"];

export function mutationReadTables(method = "", pathname = "") {
  const verb = String(method).toUpperCase();
  const path = String(pathname);
  if (path.startsWith("/api/access/") || path === "/api/auth/first-access") return ["employees"];
  if (verb === "PATCH" && path.startsWith("/api/employees/")) return ["employees", "queues"];
  if (verb === "PATCH" && path.startsWith("/api/queues/")) return ["queues"];
  if (path === "/api/load-coefficients") return ["loadCoefficients"];
  if (path.startsWith("/api/yuc-settings/")) return ["yucSettings"];
  if (path === "/api/deadline-settings") return ["settings"];
  if (path.startsWith("/api/regional-assignments/")) return ["employees", "regionalAssignments"];
  if (path.startsWith("/api/regional-substitutions/")) return ["employees", "regionalSubstitutions"];
  if (path.startsWith("/api/vacations/")) return ["employees", "vacations"];
  // Preview уже сформировал актуальный снимок. Route сама проверит TTL/версии
  // кэша и дочитает таблицы, только если они успели устареть.
  if (path === "/api/cases/import-apply") return [];
  if (verb === "PATCH" && /^\/api\/cases\/[^/]+$/.test(path)) return ["cases", "employees"];
  if (/^\/api\/cases\/[^/]+\/documents$/.test(path)) return ["cases", "employees"];
  if (path.endsWith("/responsible")) return ["cases", "employees"];
  if (["/delete", "/restore", "/complete-deadline", "/postpone-completion"].some((suffix) => path.endsWith(suffix))) return ["cases"];
  if (path.startsWith("/api/cases/") || path === "/api/assign-auto" || path === "/api/assign-manual") {
    return DISTRIBUTION_TABLES;
  }
  return ALL_MUTATION_TABLES;
}
