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

export function canEditCase(user, employee, caseRow, employees = []) {
  if (!user || !caseRow) return false;
  if (canManageYuc(user, caseRow[FIELD.yuc])) return true;
  if (normalizeRole(user.role) !== ROLE.employee || !user.yuc || !caseRow[FIELD.yuc] ||
      normalizeYuc(user.yuc) !== normalizeYuc(caseRow[FIELD.yuc])) return false;
  const links = caseRow["ОтветственныйУЗ"];
  if (Array.isArray(links) && links.length) {
    return links.length === 1 && Boolean(employee?._recordId) && links[0] === employee._recordId;
  }
  if (!employees.length) return false;
  const candidates = employees.filter(item =>
    normalizeYuc(item[FIELD.yuc]) === normalizeYuc(caseRow[FIELD.yuc]) &&
    nameMatches(item[FIELD.name], caseRow[FIELD.responsible]));
  return candidates.length === 1 && candidates[0].employee_id === user.employeeId;
}
