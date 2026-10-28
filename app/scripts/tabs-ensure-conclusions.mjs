import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
if (!process.env.TABS_API_TOKEN && typeof process.loadEnvFile === "function") process.loadEnvFile(envPath);

const { createTableRows, deleteTableRows, readData } = await import("../lib/tabs-store.mjs");
const { makeQueueId } = await import("../lib/domain.mjs");
const { cleanText, isArchivedEmployee, normalizeType, normalizeYuc, yes } = await import("../lib/domain-values.mjs");

const WRITE_ENABLED = process.argv.includes("--write");
const TYPE = "заключение";

function sameType(value) {
  return normalizeType(value) === TYPE;
}

function queueEmployeeKey(row = {}) {
  return cleanText(row.employee_id) || `${normalizeYuc(row["ЮЦ"])}::${cleanText(row["ФИО"])}`;
}

const data = await readData(["employees", "queues", "state", "settings", "loadCoefficients"]);
const participants = data.employees.filter((employee) =>
  cleanText(employee.employee_id) !== "EMP-000" &&
  cleanText(employee["ФИО"]) &&
  cleanText(employee["ЮЦ"]) &&
  !isArchivedEmployee(employee) &&
  yes(employee["Заключения"])
);
const yucs = [...new Set(participants.map((employee) => normalizeYuc(employee["ЮЦ"])))].sort((a, b) => a.localeCompare(b, "ru"));

const existingConclusionQueues = data.queues.filter((row) => sameType(row["Тип дела"]));
const existingQueueKeys = new Set(existingConclusionQueues.map(queueEmployeeKey));
const queuesToCreate = [];
for (const yuc of yucs) {
  const judicialPositions = new Map(data.queues
    .filter((row) => normalizeYuc(row["ЮЦ"]) === yuc && normalizeType(row["Тип дела"]) === "судебное")
    .map((row) => [queueEmployeeKey(row), Number(row["Позиция"]) || Number.MAX_SAFE_INTEGER]));
  const employees = participants
    .filter((employee) => normalizeYuc(employee["ЮЦ"]) === yuc)
    .sort((left, right) =>
      (judicialPositions.get(queueEmployeeKey(left)) ?? Number.MAX_SAFE_INTEGER) - (judicialPositions.get(queueEmployeeKey(right)) ?? Number.MAX_SAFE_INTEGER) ||
      cleanText(left["ФИО"]).localeCompare(cleanText(right["ФИО"]), "ru")
    );
  let position = Math.max(0, ...existingConclusionQueues
    .filter((row) => normalizeYuc(row["ЮЦ"]) === yuc)
    .map((row) => Number(row["Позиция"]) || 0)) + 1;
  for (const employee of employees) {
    if (existingQueueKeys.has(queueEmployeeKey(employee))) continue;
    queuesToCreate.push({
      queue_id: makeQueueId(yuc, TYPE),
      "ЮЦ": yuc,
      "Тип дела": TYPE,
      "Позиция": position,
      employee_id: employee.employee_id,
      "ФИО": employee["ФИО"],
      "Долг": 0,
      "Дата долга": "",
      "Примечание": "Создано при добавлении типа нагрузки «заключение».",
    });
    existingQueueKeys.add(queueEmployeeKey(employee));
    position += 1;
  }
}

const statesToCreate = yucs
  .filter((yuc) => !(data.state ?? []).some((row) => normalizeYuc(row["ЮЦ"]) === yuc && sameType(row["Тип дела"])))
  .map((yuc) => ({
    queue_id: makeQueueId(yuc, TYPE),
    "ЮЦ": yuc,
    "Тип дела": TYPE,
    "Последняя позиция": 0,
    "Последний автоназначенный": "",
    "Цикл": 1,
    "Дата последнего автоназначения": "",
    "Комментарий": "Создано при добавлении типа нагрузки «заключение».",
  }));

const settingsToCreate = yucs
  .filter((yuc) => !(data.settings ?? []).some((row) => normalizeYuc(row["ЮЦ"]) === yuc && sameType(row["Тип дела"])))
  .map((yuc) => ({
    "ЮЦ": yuc,
    "Тип дела": TYPE,
    "Активность, дни": 5,
    "Автозавершение, дни": 30,
    "Учитывать долг": "Да",
    "Максимальный долг": 2,
    "Порог перегруза": 3,
  }));

const coefficientsToCreate = (data.loadCoefficients ?? []).some((row) => normalizeType(row["Тип нагрузки"]) === TYPE)
  ? []
  : [{ "Название": "", "Тип нагрузки": TYPE, "Коэффициент": 1 }];
const legacyStatesToDelete = (data.state ?? []).filter((row) =>
  cleanText(row["Тип дела"]).toLowerCase() === "заключения" &&
  (data.state ?? []).some((candidate) =>
    candidate !== row &&
    cleanText(candidate["Тип дела"]).toLowerCase() === TYPE &&
    normalizeYuc(candidate["ЮЦ"]) === normalizeYuc(row["ЮЦ"])
  ) &&
  !cleanText(row["Последний автоназначенный"]) &&
  !cleanText(row["Дата последнего автоназначения"]) &&
  (Number(row["Последняя позиция"]) || 0) === 0 &&
  (Number(row["Цикл"]) || 1) === 1
);
const emptyCoefficientsToDelete = (data.loadCoefficients ?? []).filter((row) =>
  !cleanText(row["Тип нагрузки"]) && row._recordId
);

console.log(JSON.stringify({
  mode: WRITE_ENABLED ? "write" : "preview",
  participants: participants.length,
  yucs,
  create: {
    queues: queuesToCreate.length,
    state: statesToCreate.length,
    settings: settingsToCreate.map((row) => row["ЮЦ"]),
    coefficients: coefficientsToCreate.length,
    deleteLegacyPluralStates: legacyStatesToDelete.length,
    deleteEmptyCoefficientRows: emptyCoefficientsToDelete.length,
  },
}, null, 2));

if (!WRITE_ENABLED) process.exit(0);
if (queuesToCreate.length) await createTableRows("queues", queuesToCreate);
if (statesToCreate.length) await createTableRows("state", statesToCreate);
if (settingsToCreate.length) await createTableRows("settings", settingsToCreate);
if (coefficientsToCreate.length) await createTableRows("loadCoefficients", coefficientsToCreate);
if (legacyStatesToDelete.length) await deleteTableRows("state", legacyStatesToDelete);
if (emptyCoefficientsToDelete.length) await deleteTableRows("loadCoefficients", emptyCoefficientsToDelete);

const verified = await readData(["queues", "state", "settings", "loadCoefficients"]);
const verification = {
  queues: verified.queues.filter((row) => sameType(row["Тип дела"])).length,
  state: verified.state.filter((row) => sameType(row["Тип дела"])).length,
  settings: verified.settings.filter((row) => sameType(row["Тип дела"])).length,
  coefficients: verified.loadCoefficients.filter((row) => normalizeType(row["Тип нагрузки"]) === TYPE).length,
};
console.log(JSON.stringify({ verified: verification }, null, 2));
if (verification.queues < participants.length || verification.state < yucs.length || verification.settings < yucs.length || verification.coefficients !== 1) {
  throw new Error("Проверка заполнения типа нагрузки «заключение» не пройдена полностью.");
}
