import { FIELD, cleanText, nameMatches, normalizeType, normalizeYuc, yesNo } from "./domain.mjs";

export function regionalType(value) {
  const text = cleanText(value).toLowerCase();
  return text === "все" ? "все" : normalizeType(text);
}

export function regionalAssignmentKey(row = {}) {
  return [normalizeYuc(row[FIELD.yuc]), cleanText(row["Регион"]), cleanText(row["Сотрудник"]), regionalType(row[FIELD.workloadType])].join("::");
}

export function normalizeRegionalAssignment(row = {}, yuc = "") {
  return {
    "Название": cleanText(row["Название"]),
    [FIELD.yuc]: normalizeYuc(row[FIELD.yuc] || yuc),
    "Регион": cleanText(row["Регион"]),
    "Сотрудник": cleanText(row["Сотрудник"]),
    [FIELD.workloadType]: regionalType(row[FIELD.workloadType] || "все"),
    [FIELD.ruleActive]: yesNo(row[FIELD.ruleActive]),
  };
}

export function assertRegionalAssignment(row) {
  if (!row[FIELD.yuc] || !row["Регион"] || !row["Сотрудник"] || !row[FIELD.workloadType]) {
    throw new Error("Для закрепления нужны ЮЦ, регион, сотрудник и тип нагрузки.");
  }
}

export function regionalSubstitutionKey(row = {}) {
  return [
    normalizeYuc(row[FIELD.yuc]),
    cleanText(row["Регион"]),
    cleanText(row["Основной сотрудник"]),
    cleanText(row["Замещающий сотрудник"]),
    regionalType(row[FIELD.workloadType]),
  ].join("::");
}

export function normalizeRegionalSubstitution(row = {}, yuc = "") {
  return {
    "Название": cleanText(row["Название"]),
    [FIELD.yuc]: normalizeYuc(row[FIELD.yuc] || yuc),
    "Регион": cleanText(row["Регион"]),
    "Основной сотрудник": cleanText(row["Основной сотрудник"]),
    "Замещающий сотрудник": cleanText(row["Замещающий сотрудник"]),
    [FIELD.workloadType]: regionalType(row[FIELD.workloadType] || "все"),
    [FIELD.ruleActive]: yesNo(row[FIELD.ruleActive]),
    "Комментарий": cleanText(row["Комментарий"]),
  };
}

export function assertRegionalSubstitution(row) {
  if (!row[FIELD.yuc] || !row["Регион"] || !row["Основной сотрудник"] || !row["Замещающий сотрудник"] || !row[FIELD.workloadType]) {
    throw new Error("Для замещения нужны ЮЦ, регион, основной и замещающий сотрудники, а также тип нагрузки.");
  }
  if (nameMatches(row["Основной сотрудник"], row["Замещающий сотрудник"])) {
    throw new Error("Основной и замещающий сотрудники не могут совпадать.");
  }
}
