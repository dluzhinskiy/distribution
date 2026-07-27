import { enrichData } from "./domain.mjs";

export const VIEW_TABLE_KEYS = Object.freeze({
  dashboard: ["cases", "employees", "vacations", "settings", "yucSettings", "loadCoefficients"],
  distribution: ["cases", "employees", "queues", "state", "vacations", "settings", "yucSettings", "regionalAssignments", "regionalSubstitutions"],
  cases: ["cases", "employees", "vacations", "settings"],
  employees: ["cases", "employees", "queues", "vacations", "settings"],
  settings: ["settings", "yucSettings", "regionalAssignments", "regionalSubstitutions", "loadCoefficients"],
});

export function tableKeysForView(view, fallback) {
  return VIEW_TABLE_KEYS[view] ?? fallback;
}

export function managerScopedData(rawData, date = new Date()) {
  const enriched = enrichData(rawData, date);
  const result = {};
  for (const key of Object.keys(rawData)) {
    result[key] = ["cases", "employees", "vacations"].includes(key) ? enriched[key] : rawData[key];
  }
  if (Object.prototype.hasOwnProperty.call(rawData, "cases")) result.summary = enriched.summary;
  return result;
}
