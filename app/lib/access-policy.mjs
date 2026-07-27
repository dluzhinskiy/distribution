import { ROLE, normalizeRole } from "./auth.mjs";
import { FIELD, nameMatches, normalizeYuc } from "./domain.mjs";

export function canReadCase(user) {
  return Boolean(user?.employeeId && normalizeRole(user.role));
}

export function canManageYuc(user, yuc) {
  const role = normalizeRole(user?.role);
  if (role === ROLE.admin) return true;
  return [ROLE.manager, ROLE.deputy].includes(role) &&
    Boolean(normalizeYuc(user?.yuc)) &&
    normalizeYuc(user.yuc) === normalizeYuc(yuc);
}

export function canEditCase(user, employee, caseRow) {
  if (!user || !caseRow) return false;
  if (canManageYuc(user, caseRow[FIELD.yuc])) return true;
  return normalizeRole(user.role) === ROLE.employee &&
    normalizeYuc(user.yuc) === normalizeYuc(caseRow[FIELD.yuc]) &&
    nameMatches(employee?.[FIELD.name], caseRow[FIELD.responsible]);
}
