import { badRequest } from "./errors.mjs";
import { cleanText, normalizeType } from "./domain-values.mjs";

export const LOAD_COEFFICIENT_TYPES = ["судебное", "административное", "претензия", "уголовное", "банкротное"];
export const LOAD_COEFFICIENT_HEADERS = ["Название", "Тип нагрузки", "Коэффициент"];

export function exactLoadType(value) {
  const type = normalizeType(value);
  return LOAD_COEFFICIENT_TYPES.includes(type) ? type : "";
}

export function normalizeLoadCoefficient(row = {}) {
  return {
    "Название": cleanText(row["Название"]),
    "Тип нагрузки": exactLoadType(row["Тип нагрузки"]),
    "Коэффициент": Number(row["Коэффициент"]),
  };
}

export function validateLoadCoefficients(rows, { requireComplete = true } = {}) {
  if (!Array.isArray(rows)) throw badRequest("Коэффициенты должны быть переданы массивом.");
  const normalized = rows.map(normalizeLoadCoefficient);
  const seen = new Set();
  for (const row of normalized) {
    const type = row["Тип нагрузки"];
    const coefficient = row["Коэффициент"];
    if (!type) throw badRequest("Обнаружен неизвестный тип нагрузки.");
    if (seen.has(type)) throw badRequest(`Тип нагрузки «${type}» указан более одного раза.`);
    if (!Number.isFinite(coefficient) || coefficient <= 0) throw badRequest(`Коэффициент для «${type}» должен быть больше нуля.`);
    if (Math.abs(coefficient * 100 - Math.round(coefficient * 100)) > 1e-8) {
      throw badRequest(`Коэффициент для «${type}» может содержать не более двух знаков после запятой.`);
    }
    row["Коэффициент"] = Math.round(coefficient * 100) / 100;
    seen.add(type);
  }
  if (requireComplete) {
    const missing = LOAD_COEFFICIENT_TYPES.filter((type) => !seen.has(type));
    if (missing.length) throw badRequest(`Не заданы коэффициенты: ${missing.join(", ")}.`);
  }
  return normalized.sort((left, right) => LOAD_COEFFICIENT_TYPES.indexOf(left["Тип нагрузки"]) - LOAD_COEFFICIENT_TYPES.indexOf(right["Тип нагрузки"]));
}
