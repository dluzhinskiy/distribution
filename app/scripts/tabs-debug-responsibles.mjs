import { nameMatches } from "../lib/domain.mjs";
import { readData } from "../lib/tabs-store.mjs";

try {
  const data = await readData();
  const completed = new Set(["Завершено", "Отменено", "Удалено"]);

  const rows = data.cases
    .filter((caseRow) => caseRow["Ответственный"] && !completed.has(caseRow["Статус"]))
    .map((caseRow) => {
      const employee = data.employees.find((item) => nameMatches(caseRow["Ответственный"], item["ФИО"]));
      return {
        case_id: caseRow.case_id,
        type: caseRow["Тип дела"],
        status: caseRow["Статус"],
        responsible_in_case: caseRow["Ответственный"],
        matched_employee_id: employee?.employee_id ?? "",
        matched_employee: employee?.["ФИО"] ?? "",
      };
    });

  const unmatched = rows.filter((row) => !row.matched_employee_id);

  console.log(`Дел с ответственным и незавершённым статусом: ${rows.length}`);
  console.log(`Не привязались к сотруднику: ${unmatched.length}`);

  if (unmatched.length) {
    console.table(unmatched.slice(0, 50));
  } else {
    console.log("Все ответственные привязались к сотрудникам.");
  }
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
}
