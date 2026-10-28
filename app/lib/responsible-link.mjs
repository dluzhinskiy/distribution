import { cleanText, isArchivedEmployee, nameMatches, normalizeYuc } from './domain-values.mjs';

export const RESPONSIBLE_LINK = 'ОтветственныйУЗ';

export function resolveResponsibleLink(row, employees) {
  const existingLink = Array.isArray(row?.[RESPONSIBLE_LINK]) ? row[RESPONSIBLE_LINK].filter(Boolean) : [];
  if (existingLink.length === 1) return existingLink;
  const name = cleanText(row['Ответственный']);
  if (!name) return [];
  const yucCandidates = employees.filter(employee => normalizeYuc(employee['ЮЦ']) === normalizeYuc(row['ЮЦ']));
  const currentCandidates = yucCandidates.filter(employee => !isArchivedEmployee(employee));
  const candidates = currentCandidates.length ? currentCandidates : yucCandidates;
  const exact = candidates.filter(employee => cleanText(employee['ФИО']) === name);
  const matches = exact.length ? exact : candidates.filter(employee => nameMatches(employee['ФИО'], name));
  if (matches.length !== 1 || !matches[0]._recordId) {
    const error = new Error(`Не удалось однозначно связать ответственного «${name}» с записью сотрудника в ЮЦ «${row['ЮЦ']}». Проверьте ФИО и справочник сотрудников.`);
    error.status = 400;
    error.code = 'RESPONSIBLE_LINK_UNRESOLVED';
    throw error;
  }
  return [matches[0]._recordId];
}
