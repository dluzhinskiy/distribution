export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function yes(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "да" || text === "1" || text === "true";
}

export function yesNo(value) {
  return yes(value) ? "Да" : "Нет";
}

export function normalizeYucName(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "Дальний Восток";
  const aliases = new Map([
    ["дв", "Дальний Восток"],
    ["юц дв", "Дальний Восток"],
    ["дальний восток", "Дальний Восток"],
    ["кц/дсап", "КЦ"],
    ["кц / дсап", "КЦ"],
  ]);
  return aliases.get(text.toLowerCase()) ?? text;
}

export function uniqueYucs(values) {
  const seen = new Set();
  return values
    .map(normalizeYucName)
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

export function normalizeCaseType(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "админ") return "административное";
  if (text === "суд") return "судебное";
  if (text.includes("уголов")) return "уголовное";
  if (text.includes("банкрот")) return "банкротное";
  return text;
}

export function workloadCaseType(value) {
  const type = normalizeCaseType(value);
  return type === "уголовное" || type === "банкротное" ? "судебное" : type;
}

export function employeeInitials(name) {
  return String(name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function shortName(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  const [surname, first = "", middle = ""] = parts;
  const initials = [first, middle].filter(Boolean).map((part) => `${part[0]}.`).join("");
  return initials ? `${surname} ${initials}` : surname;
}

export function displayName(name) {
  return shortName(name) || "—";
}

export function nameMatches(a, b) {
  const left = String(a ?? "").trim();
  const right = String(b ?? "").trim();
  if (!left || !right) return false;
  return left === right || shortName(left) === right || left === shortName(right);
}
