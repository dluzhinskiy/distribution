import { normalizeCaseType, workloadCaseType } from "./ui-utils.js";

export const loadCoefficientTypes = ["судебное", "административное", "претензия", "уголовное", "банкротное"];

export function loadCoefficientConfig(rows = []) {
  const values = {};
  const errors = [];
  let unknownRows = 0;
  for (const row of rows ?? []) {
    const type = normalizeCaseType(row?.["Тип нагрузки"]);
    const coefficient = Number(row?.["Коэффициент"]);
    if (!loadCoefficientTypes.includes(type)) {
      unknownRows += 1;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(values, type)) errors.push(`Дублируется тип «${type}»`);
    else if (!Number.isFinite(coefficient) || coefficient <= 0) errors.push(`Неверный коэффициент «${type}»`);
    else if (Math.abs(coefficient * 100 - Math.round(coefficient * 100)) > 1e-8) errors.push(`Слишком много знаков у «${type}»`);
    else values[type] = coefficient;
  }
  if (unknownRows) errors.unshift(`Не указан тип нагрузки в ${unknownRows} ${unknownRows === 1 ? "строке" : "строках"}`);
  const missing = loadCoefficientTypes.filter((type) => !Object.prototype.hasOwnProperty.call(values, type));
  if (missing.length) errors.push(`Не заданы: ${missing.join(", ")}`);
  return { valid: errors.length === 0, values, errors };
}

export function exactCaseCoefficient(caseRow, config) {
  const type = normalizeCaseType(caseRow?.["Тип дела"]);
  return Number(config?.values?.[type]) || 0;
}

export function weightedCases(cases = [], config) {
  return (cases ?? []).reduce((sum, row) => sum + exactCaseCoefficient(row, config), 0);
}

export function weightedGroupBreakdown(cases = [], config) {
  const result = Object.fromEntries(["претензия", "административное", "судебное"].map((type) => [type, 0]));
  for (const row of cases ?? []) {
    const group = workloadCaseType(row?.["Тип дела"]);
    if (Object.prototype.hasOwnProperty.call(result, group)) result[group] += exactCaseCoefficient(row, config);
  }
  return result;
}

export function formatWeightedLoad(value) {
  return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value) || 0);
}
