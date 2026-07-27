const YUC_ALIASES = new Map([
  ["дв", "Дальний Восток"],
  ["дальний восток", "Дальний Восток"],
  ["кц/дсап", "КЦ"],
  ["кц / дсап", "КЦ"],
]);

export function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

export function cleanMultilineText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&#(?:0*10|x0*a);/gi, "\n")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function yes(value) {
  const text = cleanText(value).toLowerCase();
  return text === "да" || text === "1" || text === "true";
}

export function yesNo(value) {
  return yes(value) ? "Да" : "Нет";
}

export function shortName(value) {
  const parts = cleanText(value).split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  const [surname, first = "", middle = ""] = parts;
  const initials = [first, middle].filter(Boolean).map((part) => `${part[0]}.`).join("");
  return initials ? `${surname} ${initials}` : surname;
}

export function nameMatches(a, b) {
  const left = cleanText(a);
  const right = cleanText(b);
  if (!left || !right) return false;
  return left === right || shortName(left) === right || left === shortName(right);
}

export function normalizeType(value) {
  const type = cleanText(value).toLowerCase();
  if (type === "админ") return "административное";
  if (type === "суд" || type === "третьи лица" || type === "судебное дело") return "судебное";
  if (type === "уголовное дело" || type === "уголовное дело до суда") return "уголовное";
  if (type === "дело о банкротстве" || type === "банкротство") return "банкротное";
  return type;
}

export function workloadType(type) {
  const normalized = normalizeType(type);
  return ["судебное", "уголовное", "банкротное"].includes(normalized) ? "судебное" : normalized;
}

export function normalizeYuc(value) {
  const text = cleanText(value);
  if (!text) return "Дальний Восток";
  return YUC_ALIASES.get(text.toLowerCase()) ?? text;
}

export function todayISO(date = new Date()) {
  return toISODate(date);
}

export function nowISO(date = new Date()) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function toISODate(value) {
  if (!value && value !== 0) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return toISODate(parsed);
    return trimmed;
  }
  if (typeof value === "number") {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return toISODate(new Date(excelEpoch + value * 24 * 60 * 60 * 1000));
  }
  if (value instanceof Date) {
    const pad = (number) => String(number).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return "";
}

export function parseISODate(value) {
  const iso = toISODate(value);
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export function addDays(dateValue, days) {
  const date = parseISODate(dateValue);
  if (!date || !Number.isFinite(Number(days))) return "";
  const next = new Date(date);
  next.setDate(next.getDate() + Number(days));
  return toISODate(next);
}

export function daysBetween(a, b) {
  const start = parseISODate(a);
  const end = parseISODate(b);
  if (!start || !end) return "";
  return Math.round((start.getTime() - end.getTime()) / (24 * 60 * 60 * 1000));
}
