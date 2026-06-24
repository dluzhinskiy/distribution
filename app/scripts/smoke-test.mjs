import assert from "node:assert/strict";
import {
  assignAutomatically,
  assignExistingAutomatically,
  assignExistingManually,
  assignManually,
  changeCaseResponsible,
  enrichData,
  recommend,
  setVacationDates,
} from "../lib/domain.mjs";
import { normalizeRegionName } from "../lib/regions.mjs";
import { readData } from "../lib/excel-store.mjs";

const source = await readData();
const data = structuredClone(source);
const enriched = enrichData(data, new Date("2026-06-23T12:00:00"));

assert.ok(enriched.cases.length >= 69, "В хранилище должны читаться перенесённые дела");
assert.equal(enriched.employees.length, 9, "Должно быть перенесено 9 сотрудников");
assert.equal(enriched.queues.length, 27, "Должно быть 27 строк очередей");

const draft = {
  "Тип дела": "судебное",
  "Предмет": "Smoke test: судебное дело",
  "ЮЦ": "ДВ",
  "Регион": "Иркутск",
  "Дата поступления": "2026-06-23",
};

const first = recommend(data, draft, new Date("2026-06-23T12:00:00"));
assert.equal(first.ok, true, "Судебное дело должно получить рекомендацию");
assert.equal(first.candidate, "Старинских Е.Н.", "Первый кандидат судебной очереди");

const vacationData = structuredClone(source);
setVacationDates(vacationData, "EMP-001", ["2026-06-23"], true, new Date("2026-06-23T09:00:00"));
const vacationSkip = recommend(vacationData, draft, new Date("2026-06-23T12:00:00"));
assert.equal(vacationSkip.ok, true, "При отпуске первого сотрудника рекомендация должна перейти к следующему");
assert.notEqual(vacationSkip.candidate, "Старинских Е.Н.", "Отпуск из календаря должен исключить сотрудника из автоназначения");

const assigned = assignAutomatically(data, draft, new Date("2026-06-23T12:00:00"));
assert.equal(assigned.result.ok, true, "Автоназначение должно пройти");
assert.equal(assigned.case["Ответственный"], "Старинских Е.Н.", "Автоназначение сохраняет кандидата");
assert.equal(assigned.case["Регион"], "Иркутская область", "Короткое название региона должно нормализоваться до справочника");
assert.equal(normalizeRegionName("Хабаровск"), "Хабаровский край", "Хабаровск должен нормализоваться до Хабаровского края");

const second = recommend(data, draft, new Date("2026-06-23T12:05:00"));
assert.equal(second.ok, true, "Следующее судебное дело тоже должно получить рекомендацию");
assert.notEqual(second.candidate, "Старинских Е.Н.", "Запрет двух подряд должен пропустить предыдущего автополучателя");

const constrained = structuredClone(data);
for (const employee of constrained.employees) {
  if (employee["ФИО"] !== "Старинских Е.Н.") employee["Активен"] = "Нет";
}
const stopped = recommend(constrained, draft, new Date("2026-06-23T12:10:00"));
assert.equal(stopped.ok, false, "Если доступен только предыдущий автополучатель, автоназначение должно остановиться");

assert.throws(
  () => assignManually(data, draft, "Старинских Е.Н.", "", new Date("2026-06-23T12:15:00")),
  /Комментарий обязателен/,
  "Ручное назначение без комментария запрещено",
);

const manual = assignManually(data, draft, "Старинских Е.Н.", "Решение руководителя для smoke-test", new Date("2026-06-23T12:20:00"));
assert.equal(manual.case["Ручное назначение"], "Да", "Ручное назначение должно сохраняться как ручное");

const existingAutoData = structuredClone(source);
existingAutoData.cases.push({
  case_id: "CASE-SMOKE-AUTO",
  "Номер дела": "SMOKE-AUTO",
  "Предмет": "Smoke test: уже заведённое дело под автоназначение",
  "ЮЦ": "ДВ",
  "Регион": "Иркутск",
  "Истец": "",
  "Ответчик": "",
  "Третье лицо": "",
  "Тип дела": "судебное",
  "Дата поступления": "2026-06-23",
  "Статус": "Ожидает распределения",
  "Дата завершения": "",
  "Ответственный": "",
  "Дата распределения": "",
  "Основание": "",
  "Распределено системой": "Нет",
  "Ручное назначение": "Нет",
  "Комментарий": "",
  "Ссылка": "",
});
const beforeExistingAutoCount = existingAutoData.cases.length;
const existingAuto = assignExistingAutomatically(existingAutoData, "CASE-SMOKE-AUTO", new Date("2026-06-23T12:25:00"));
assert.equal(existingAutoData.cases.length, beforeExistingAutoCount, "Автоназначение существующего дела не должно создавать дубль");
assert.equal(existingAuto.result.ok, true, "Существующее дело должно получить автоназначение");
assert.equal(existingAuto.case["Статус"], "В работе", "Существующее дело после автоназначения должно перейти в работу");
assert.ok(existingAuto.case["Ответственный"], "У существующего дела должен появиться ответственный");

const existingManualData = structuredClone(source);
existingManualData.cases.push({
  case_id: "CASE-SMOKE-MANUAL",
  "Номер дела": "SMOKE-MANUAL",
  "Предмет": "Smoke test: уже заведённое дело под ручное назначение",
  "ЮЦ": "ДВ",
  "Регион": "Иркутск",
  "Истец": "",
  "Ответчик": "",
  "Третье лицо": "",
  "Тип дела": "судебное",
  "Дата поступления": "2026-06-23",
  "Статус": "Ожидает распределения",
  "Дата завершения": "",
  "Ответственный": "",
  "Дата распределения": "",
  "Основание": "",
  "Распределено системой": "Нет",
  "Ручное назначение": "Нет",
  "Комментарий": "",
  "Ссылка": "",
});
const beforeExistingManualCount = existingManualData.cases.length;
const existingManual = assignExistingManually(existingManualData, "CASE-SMOKE-MANUAL", "Старинских Е.Н.", "Ручное распределение уже заведённого дела", new Date("2026-06-23T12:30:00"));
assert.equal(existingManualData.cases.length, beforeExistingManualCount, "Ручное назначение существующего дела не должно создавать дубль");
assert.equal(existingManual.case["Ручное назначение"], "Да", "Существующее дело должно сохранять признак ручного назначения");
assert.equal(existingManual.case["Ответственный"], "Старинских Е.Н.", "Существующее дело должно получить ручного ответственного");

const responsibleChangeData = structuredClone(source);
const caseToChange = responsibleChangeData.cases.find((row) => row.case_id);
const beforeResponsibleChangeCount = responsibleChangeData.cases.length;
const responsibleChange = changeCaseResponsible(responsibleChangeData, caseToChange.case_id, "Некрасова И.С.", new Date("2026-06-23T12:35:00"));
assert.equal(responsibleChangeData.cases.length, beforeResponsibleChangeCount, "Смена ответственного не должна создавать дубль дела");
assert.equal(responsibleChange.case["Ответственный"], "Некрасова И.С.", "Ответственный должен измениться на выбранного сотрудника");
assert.equal(responsibleChange.case["Ручное назначение"], "Да", "Принудительная смена ответственного должна отмечаться как ручная");

console.log("Smoke-test OK");
