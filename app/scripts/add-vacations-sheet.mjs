import { allDatesInRange, cleanText, nowISO, normalizeVacation } from "../lib/domain.mjs";
import { readData, saveData, storagePath } from "../lib/excel-store.mjs";

const data = await readData();
const existing = (data.vacations ?? []).map(normalizeVacation).filter((item) => item.employee_id && item["Дата"]);
const seen = new Set(existing.map((item) => `${item.employee_id}::${item["Дата"]}`));

for (const employee of data.employees) {
  const employeeId = cleanText(employee.employee_id);
  const name = cleanText(employee["ФИО"]);
  const dates = allDatesInRange(employee["Отпуск с"], employee["Отпуск по"]);
  for (const day of dates) {
    const key = `${employeeId}::${day}`;
    if (!employeeId || seen.has(key)) continue;
    existing.push({
      employee_id: employeeId,
      "ФИО": name,
      "Дата": day,
      "Тип": "Отпуск",
      "Комментарий": "Перенос из полей «Отпуск с/по»",
      "Изменено": nowISO(),
    });
    seen.add(key);
  }
}

data.vacations = existing.sort((a, b) =>
  cleanText(a["ФИО"]).localeCompare(cleanText(b["ФИО"]), "ru") ||
  cleanText(a["Дата"]).localeCompare(cleanText(b["Дата"]))
);

await saveData(data);
console.log(`Лист «Отпуска» создан/обновлён: ${storagePath()}`);
console.log(`Записей отпусков: ${data.vacations.length}`);
