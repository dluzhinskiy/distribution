import test from "node:test";
import assert from "node:assert/strict";
import { paginateCaseRegister } from "../lib/case-register.mjs";

const rows = [
  { case_id: "1", "ЮЦ": "Юг", "Ответственный": "Иванов Иван", "Статус": "В работе", "Актуально": "Да", "Тип дела": "судебное" },
  { case_id: "2", "ЮЦ": "Юг", "Ответственный": "Петров Петр", "Статус": "Удалено", "Актуально": "Нет", "Тип дела": "претензия" },
  { case_id: "3", "ЮЦ": "Поволжье", "Ответственный": "Иванов Иван", "Статус": "Ожидает распределения", "Актуально": "Нет", "Тип дела": "судебное" },
];

test("case register filters the full dataset before pagination", () => {
  const result = paginateCaseRegister(rows, { yuc: "Юг", page: 1, pageSize: 1 }, { name: "Руководитель" });
  assert.equal(result.total, 1);
  assert.deepEqual(result.rows.map((row) => row.case_id), ["1"]);
});

test("mine scope and search work across YUCs", () => {
  const result = paginateCaseRegister(rows, { scope: "mine", search: "ожидает" }, { name: "Иванов Иван" });
  assert.equal(result.total, 1);
  assert.equal(result.rows[0].case_id, "3");
});
