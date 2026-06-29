const API_BASE = process.env.TABS_API_BASE || "https://tabs.mts.ru/fusion/v1";
const TOKEN = process.env.TABS_API_TOKEN;
const WRITE_ENABLED = process.argv.includes("--write");
const ONLY = valueAfter("--table");

const casesDatasheetId = process.env.TABS_CASES_DATASHEET_ID || "dstD5wqizSVQS89kL7";
const casesViewId = process.env.TABS_CASES_VIEW_ID || "viwBynFRDSNva";

const tables = [
  {
    key: "cases",
    name: "Дела",
    datasheetId: casesDatasheetId,
    viewId: casesViewId,
    createFields: (stamp) => ({
      case_id: `DIAG-CASE-${stamp}`,
      "Номер дела": `DIAG-${stamp}`,
      "Предмет": "Диагностическая запись API. Можно удалить.",
      "ЮЦ": "Дальний Восток",
      "Регион": "Иркутская область",
      "Истец": "Диагностика API",
      "Ответчик": "Диагностика API",
      "Третье лицо": "",
      "Тип дела": "судебное",
      "Дата поступления": Date.now(),
      "Статус": "Ожидает распределения",
      "Ответственный": "",
      "Дата распределения": null,
      "Основание": "Диагностика API",
      "Распределено системой": "Нет",
      "Ручное назначение": "Нет",
      "Комментарий": "Создано диагностикой. Запись должна быть удалена автоматически.",
      "Ссылка": "",
    }),
    updateFields: (stamp) => ({
      "Комментарий": `Диагностика API: обновлено ${stamp}.`,
      "Статус": "В работе",
    }),
  },
  {
    key: "employees",
    name: "Сотрудники",
    datasheetId: process.env.TABS_EMPLOYEES_DATASHEET_ID || "dstm3BBmBsSc4JqokB",
    viewId: process.env.TABS_EMPLOYEES_VIEW_ID || "viwFcmKElrBo0",
    createFields: (stamp) => ({
      employee_id: `DIAG-EMP-${stamp}`,
      "ФИО": `Диагностика API ${stamp}`,
      "ЮЦ": "Дальний Восток",
      "Активен": "Нет",
      "Судебные": "Нет",
      "Административные": "Нет",
      "Претензии": "Нет",
      "Отпуск с": null,
      "Отпуск по": null,
      "Комментарий": "Создано диагностикой. Запись должна быть удалена автоматически.",
    }),
    updateFields: (stamp) => ({
      "Комментарий": `Диагностика API: обновлено ${stamp}.`,
    }),
  },
  {
    key: "queues",
    name: "Очереди",
    datasheetId: process.env.TABS_QUEUES_DATASHEET_ID || "dstw6EXKiu4xYjDrmN",
    viewId: process.env.TABS_QUEUES_VIEW_ID || "viwMJKJ6Xf0cm",
    createFields: (stamp) => ({
      queue_id: `DIAG-QUEUE-${stamp}`,
      "ЮЦ": "Дальний Восток",
      "Тип дела": "претензия",
      "Позиция": String(stamp).slice(-4),
      employee_id: `DIAG-EMP-${stamp}`,
      "ФИО": `Диагностика API ${stamp}`,
      "Долг": "0",
      "Дата долга": null,
      "Примечание": "Создано диагностикой. Запись должна быть удалена автоматически.",
    }),
    updateFields: (stamp) => ({
      "Примечание": `Диагностика API: обновлено ${stamp}.`,
    }),
  },
  {
    key: "state",
    name: "Состояние",
    datasheetId: process.env.TABS_STATE_DATASHEET_ID || "dsttaEquzJk9JKP9Mt",
    viewId: process.env.TABS_STATE_VIEW_ID || "viwUdgXG3HeLF",
    createFields: (stamp) => ({
      queue_id: `DIAG-STATE-${stamp}`,
      "ЮЦ": "Дальний Восток",
      "Тип дела": "претензия",
      "Последняя позиция": 0,
      "Последний автоназначенный": "",
      "Цикл": 1,
      "Дата последнего автоназначения": null,
      "Комментарий": "Создано диагностикой. Запись должна быть удалена автоматически.",
    }),
    updateFields: (stamp) => ({
      "Комментарий": `Диагностика API: обновлено ${stamp}.`,
      "Цикл": 2,
    }),
  },
  {
    key: "vacations",
    name: "Отпуска",
    datasheetId: process.env.TABS_VACATIONS_DATASHEET_ID || "dstcWl39DcpKnphNyA",
    viewId: process.env.TABS_VACATIONS_VIEW_ID || "viw02s4M43uES",
    createFields: (stamp) => ({
      employee_id: `DIAG-EMP-${stamp}`,
      "ФИО": `Диагностика API ${stamp}`,
      "Дата": Date.now(),
      "Тип": "Отпуск",
      "Комментарий": "Создано диагностикой. Запись должна быть удалена автоматически.",
      "Изменено": new Date().toISOString(),
    }),
    updateFields: (stamp) => ({
      "Комментарий": `Диагностика API: обновлено ${stamp}.`,
      "Изменено": new Date().toISOString(),
    }),
  },
  {
    key: "journal",
    name: "Журнал",
    datasheetId: process.env.TABS_JOURNAL_DATASHEET_ID || "dstpntgUBUkCe8Jvv9",
    viewId: process.env.TABS_JOURNAL_VIEW_ID || "viwuyr7QieusY",
    createFields: (stamp) => ({
      "Дата события": Date.now(),
      case_id: `DIAG-CASE-${stamp}`,
      "Тип дела": "судебное",
      "Ответственный": `Диагностика API ${stamp}`,
      "Основание": "Диагностика API",
      "Способ": "диагностика",
      "ЮЦ": "Дальний Восток",
      "Цикл": "",
      "Предложенный системой": "",
      "Комментарий": "Создано диагностикой. Запись должна быть удалена автоматически.",
    }),
    updateFields: (stamp) => ({
      "Комментарий": `Диагностика API: обновлено ${stamp}.`,
    }),
  },
  {
    key: "settings",
    name: "Настройки",
    datasheetId: process.env.TABS_SETTINGS_DATASHEET_ID || "dstS9sVx6XlxNASvuh",
    viewId: process.env.TABS_SETTINGS_VIEW_ID || "viwk5Dl3c7RoE",
    createFields: (stamp) => ({
      "ЮЦ": "Дальний Восток",
      "Тип дела": "претензия",
      "Активность, дни": 999,
      "Автозавершение, дни": 999,
    }),
    updateFields: () => ({
      "Активность, дни": 998,
      "Автозавершение, дни": 998,
    }),
  },
];

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : "";
}

function assertToken() {
  if (!TOKEN) {
    throw new Error("Не задан TABS_API_TOKEN. Передайте токен через переменную окружения, не вставляйте его в код.");
  }
}

function urlFor(table, extra = {}) {
  const url = new URL(`${API_BASE}/datasheets/${table.datasheetId}/records`);
  if (table.viewId) url.searchParams.set("viewId", table.viewId);
  url.searchParams.set("fieldKey", "name");
  for (const [key, value] of Object.entries(extra)) {
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, item));
    } else if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function request(table, method, body = null, extra = {}) {
  const response = await fetch(urlFor(table, extra), {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${method} ${table.name}: API вернул не JSON (${response.status}): ${text.slice(0, 500)}`);
  }
  if (!response.ok || payload.success === false || (payload.code && ![200, 201].includes(payload.code))) {
    throw new Error(`${method} ${table.name}: ${response.status}; ${payload.message || text}`);
  }
  return payload;
}

async function readRecords(table) {
  return request(table, "GET", null, { pageNum: 1, pageSize: 1 });
}

async function createRecord(table, fields) {
  const payload = await request(table, "POST", { records: [{ fields }], fieldKey: "name" });
  const record = payload?.data?.records?.[0];
  if (!record?.recordId) {
    throw new Error(`Создание ${table.name}: в ответе нет data.records[0].recordId.`);
  }
  return record;
}

async function updateRecord(table, recordId, fields) {
  return request(table, "PATCH", { records: [{ recordId, fields }], fieldKey: "name" });
}

async function deleteRecord(table, recordId) {
  const url = new URL(`${API_BASE}/datasheets/${table.datasheetId}/records`);
  url.searchParams.append("recordIds", recordId);
  const response = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok || payload.success === false || (payload.code && payload.code !== 200)) {
    throw new Error(`DELETE ${table.name}: ${response.status}; ${payload.message || text}`);
  }
  return payload;
}

async function diagnoseTable(table) {
  const stamp = Date.now();
  console.log(`\n[${table.name}] ${table.datasheetId} / ${table.viewId || "без viewId"}`);

  const readPayload = await readRecords(table);
  const total = readPayload?.data?.total ?? "не указано";
  console.log(`  ✓ чтение: OK, всего записей: ${total}`);

  if (!WRITE_ENABLED) {
    console.log("  - запись/обновление/удаление пропущены: добавьте --write");
    return;
  }

  let recordId = "";
  try {
    const created = await createRecord(table, table.createFields(stamp));
    recordId = created.recordId;
    console.log(`  ✓ создание: OK, recordId=${recordId}`);

    await updateRecord(table, recordId, table.updateFields(stamp));
    console.log("  ✓ обновление: OK");
  } finally {
    if (recordId) {
      await deleteRecord(table, recordId);
      console.log("  ✓ удаление: OK");
    }
  }
}

async function main() {
  assertToken();
  const selected = ONLY ? tables.filter((table) => table.key === ONLY || table.name === ONLY) : tables;
  if (!selected.length) {
    throw new Error(`Таблица не найдена: ${ONLY}. Доступные ключи: ${tables.map((table) => table.key).join(", ")}`);
  }
  console.log(`Tabs API diagnostics: ${WRITE_ENABLED ? "read/write/update/delete" : "read only"}`);
  for (const table of selected) {
    await diagnoseTable(table);
  }
  console.log("\nГотово.");
}

main().catch((error) => {
  console.error(`\nОшибка: ${error.message}`);
  process.exitCode = 1;
});
