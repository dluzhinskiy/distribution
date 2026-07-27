import { badRequest, forbidden } from "./errors.mjs";

export function assertObject(value, label = "Тело запроса") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw badRequest(`${label} должно быть объектом.`);
  return value;
}

export function assertAllowedFields(value, allowedFields, messagePrefix = "Нельзя изменять поля") {
  assertObject(value);
  const allowed = allowedFields instanceof Set ? allowedFields : new Set(allowedFields);
  const unsupported = Object.keys(value).filter((field) => !allowed.has(field));
  if (unsupported.length) throw forbidden(`${messagePrefix}: ${unsupported.join(", ")}.`);
  return value;
}

export function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw badRequest(`Не заполнено обязательное поле «${label}».`);
  return text;
}

export function positiveNumber(value, label, { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) {
    throw badRequest(`Поле «${label}» должно быть ${allowZero ? "неотрицательным" : "положительным"} числом.`);
  }
  return number;
}
