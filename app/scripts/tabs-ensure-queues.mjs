import {
  CASE_TYPES,
  cleanText,
  employeeParticipates,
  makeQueueId,
  makeQueueState,
  nameMatches,
  normalizeType,
  normalizeYuc,
} from "../lib/domain.mjs";
import { readData, upsertTableRows } from "../lib/tabs-store.mjs";

const WRITE_ENABLED = process.argv.includes("--write");

function queueRowMatchesEmployee(row, employee) {
  return cleanText(row.employee_id) === cleanText(employee.employee_id) ||
    nameMatches(row["ФИО"], employee["ФИО"]);
}

function queueRowsFor(data, yuc, type) {
  const normalizedYuc = normalizeYuc(yuc);
  const normalizedType = normalizeType(type);
  return (data.queues ?? [])
    .filter((row) => normalizeYuc(row["ЮЦ"]) === normalizedYuc && normalizeType(row["Тип дела"]) === normalizedType)
    .sort((a, b) => Number(a["Позиция"]) - Number(b["Позиция"]));
}

function employeesByYuc(data) {
  const result = new Map();
  for (const employee of data.employees ?? []) {
    const yuc = normalizeYuc(employee["ЮЦ"]);
    if (!cleanText(employee["ФИО"])) continue;
    if (!result.has(yuc)) result.set(yuc, []);
    result.get(yuc).push(employee);
  }
  for (const employees of result.values()) {
    employees.sort((a, b) => cleanText(a["ФИО"]).localeCompare(cleanText(b["ФИО"]), "ru"));
  }
  return result;
}

function ensureQueues(data) {
  const createdQueues = [];
  const repairedQueues = [];
  const createdStates = [];
  const repairedStates = [];
  const groupedEmployees = employeesByYuc(data);

  data.queues ??= [];
  data.state ??= [];

  for (const [yuc, employees] of groupedEmployees.entries()) {
    for (const type of CASE_TYPES) {
      const participants = employees.filter((employee) => employeeParticipates(employee, type));
      if (!participants.length) continue;

      const queueId = makeQueueId(yuc, type);
      const existingRows = queueRowsFor(data, yuc, type);
      let nextPosition = Math.max(0, ...existingRows.map((row) => Number(row["Позиция"]) || 0)) + 1;

      for (const employee of participants) {
        const existing = existingRows.find((row) => queueRowMatchesEmployee(row, employee));
        if (existing) {
          const before = JSON.stringify({
            queue_id: existing.queue_id,
            "ЮЦ": existing["ЮЦ"],
            "Тип дела": existing["Тип дела"],
            employee_id: existing.employee_id,
            "ФИО": existing["ФИО"],
          });
          existing.queue_id = queueId;
          existing["ЮЦ"] = yuc;
          existing["Тип дела"] = normalizeType(type);
          existing.employee_id = employee.employee_id;
          existing["ФИО"] = employee["ФИО"];
          const after = JSON.stringify({
            queue_id: existing.queue_id,
            "ЮЦ": existing["ЮЦ"],
            "Тип дела": existing["Тип дела"],
            employee_id: existing.employee_id,
            "ФИО": existing["ФИО"],
          });
          if (before !== after) repairedQueues.push(existing);
          continue;
        }

        const created = {
          queue_id: queueId,
          "ЮЦ": yuc,
          "Тип дела": normalizeType(type),
          "Позиция": nextPosition,
          employee_id: employee.employee_id,
          "ФИО": employee["ФИО"],
          "Долг": 0,
          "Дата долга": "",
          "Примечание": "Создано автоматически для очереди ЮЦ.",
        };
        data.queues.push(created);
        existingRows.push(created);
        createdQueues.push(created);
        nextPosition += 1;
      }

      const hadState = data.state.some((row) =>
        normalizeYuc(row["ЮЦ"]) === yuc &&
        normalizeType(row["Тип дела"]) === normalizeType(type)
      );
      const queueState = makeQueueState(data, yuc, type);
      const stateBefore = JSON.stringify({
        queue_id: queueState.queue_id,
        "ЮЦ": queueState["ЮЦ"],
        "Тип дела": queueState["Тип дела"],
      });
      queueState.queue_id = queueId;
      queueState["ЮЦ"] = yuc;
      queueState["Тип дела"] = normalizeType(type);
      if (!hadState) createdStates.push(queueState);
      if (hadState) {
        const stateAfter = JSON.stringify({
          queue_id: queueState.queue_id,
          "ЮЦ": queueState["ЮЦ"],
          "Тип дела": queueState["Тип дела"],
        });
        if (stateBefore !== stateAfter) repairedStates.push(queueState);
      }
    }
  }

  return { createdQueues, repairedQueues, createdStates, repairedStates };
}

const data = await readData();
const result = ensureQueues(data);

console.log("Проверка очередей по ЮЦ");
console.log(`  Новые строки очередей: ${result.createdQueues.length}`);
console.log(`  Исправленные строки очередей: ${result.repairedQueues.length}`);
console.log(`  Новые строки состояния: ${result.createdStates.length}`);
console.log(`  Исправленные строки состояния: ${result.repairedStates.length}`);

if (result.createdQueues.length) {
  console.log("\nБудут добавлены очереди:");
  for (const row of result.createdQueues) {
    console.log(`  ${row["ЮЦ"]} · ${row["Тип дела"]} · позиция ${row["Позиция"]} · ${row["ФИО"]}`);
  }
}

if (result.createdStates.length) {
  console.log("\nБудут добавлены состояния:");
  for (const row of result.createdStates) {
    console.log(`  ${row["ЮЦ"]} · ${row["Тип дела"]}`);
  }
}

if (!WRITE_ENABLED) {
  console.log("\nРежим просмотра. Для записи запустите с --write.");
  process.exit(0);
}

if (!result.createdQueues.length && !result.repairedQueues.length && !result.createdStates.length && !result.repairedStates.length) {
  console.log("\nИзменений нет. Запись не требуется.");
  process.exit(0);
}

const queueResult = await upsertTableRows("queues", [...result.createdQueues, ...result.repairedQueues]);
const stateResult = await upsertTableRows("state", [...result.createdStates, ...result.repairedStates]);
console.log("\nГотово: недостающие очереди и состояния записаны в MTS Tabs.");
console.log(`  Очереди: создано ${queueResult.created}, обновлено ${queueResult.updated}`);
console.log(`  Состояние: создано ${stateResult.created}, обновлено ${stateResult.updated}`);
