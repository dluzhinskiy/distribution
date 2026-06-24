import { CASE_TYPES, makeQueueId, normalizeType, normalizeYuc } from "../lib/domain.mjs";
import { readData, saveData, storagePath } from "../lib/excel-store.mjs";

const data = await readData();

for (const row of data.cases) {
  row["ЮЦ"] = normalizeYuc(row["ЮЦ"]);
}

for (const employee of data.employees) {
  employee["ЮЦ"] = normalizeYuc(employee["ЮЦ"]);
}

for (const row of data.queues) {
  row["ЮЦ"] = normalizeYuc(row["ЮЦ"]);
  row["Тип дела"] = normalizeType(row["Тип дела"]);
  row.queue_id = makeQueueId(row["ЮЦ"], row["Тип дела"]);
}

for (const row of data.state) {
  row["ЮЦ"] = normalizeYuc(row["ЮЦ"]);
  row["Тип дела"] = normalizeType(row["Тип дела"]);
  row.queue_id = makeQueueId(row["ЮЦ"], row["Тип дела"]);
}

for (const row of data.journal) {
  row["ЮЦ"] = normalizeYuc(row["ЮЦ"]);
}

for (const type of CASE_TYPES) {
  const queueId = makeQueueId("Дальний Восток", type);
  if (!data.state.some((row) => row.queue_id === queueId)) {
    data.state.push({
      queue_id: queueId,
      "ЮЦ": "Дальний Восток",
      "Тип дела": type,
      "Последняя позиция": type === "претензия" ? 1 : 0,
      "Последний автоназначенный": "",
      "Цикл": 1,
      "Дата последнего автоназначения": "",
      "Комментарий": "Создано при нормализации ЮЦ",
    });
  }
}

await saveData(data);

console.log(`ЮЦ в хранилище нормализован: ${storagePath()}`);
