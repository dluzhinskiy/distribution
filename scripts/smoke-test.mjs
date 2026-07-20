import assert from "node:assert/strict";
import { enrichData, recommend } from "../lib/domain.mjs";
import { readData, tabsStorageStatus } from "../lib/tabs-store.mjs";

const source = await readData();
const enriched = enrichData(structuredClone(source), new Date());

assert.ok(tabsStorageStatus().tokenConfigured, "Для API smoke-test должен быть задан TABS_API_TOKEN");
assert.ok(Array.isArray(enriched.cases), "Дела должны читаться массивом");
assert.ok(Array.isArray(enriched.employees), "Сотрудники должны читаться массивом");
assert.ok(Array.isArray(enriched.queues), "Очереди должны читаться массивом");
assert.ok(Array.isArray(enriched.state), "Состояние должно читаться массивом");
assert.ok(Array.isArray(enriched.vacations), "Отпуска должны читаться массивом");
assert.ok(Array.isArray(enriched.journal), "Журнал должен читаться массивом");
assert.ok(Array.isArray(enriched.settings), "Настройки должны читаться массивом");

assert.ok(enriched.cases.length > 0, "В MTS Tabs должны быть дела");
assert.ok(enriched.employees.length > 0, "В MTS Tabs должны быть сотрудники");
assert.ok(enriched.queues.length > 0, "В MTS Tabs должны быть очереди");
assert.ok(enriched.state.length > 0, "В MTS Tabs должно быть состояние очередей");
assert.ok(enriched.settings.length > 0, "В MTS Tabs должны быть настройки");

const draft = {
  "Тип дела": "судебное",
  "Предмет": "Smoke test API: судебное дело",
  "ЮЦ": "Дальний Восток",
  "Регион": "Иркутская область",
  "Дата поступления": new Date().toISOString().slice(0, 10),
};

const recommendation = recommend(structuredClone(source), draft, new Date());
assert.equal(typeof recommendation.ok, "boolean", "Рекомендация должна возвращать логический результат ok");

console.log("Tabs smoke-test OK");
