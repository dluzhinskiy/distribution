import { readData } from "../lib/tabs-store.mjs";

const caseId = process.argv[2];

if (!caseId) {
  console.error("Укажите case_id, например: npm run tabs:find-case -- CASE-0082");
  process.exit(1);
}

try {
  const data = await readData();
  const row = data.cases.find((item) => item.case_id === caseId);

  if (!row) {
    console.log(`Дело ${caseId} не найдено в MTS Tabs API.`);
    process.exit(2);
  }

  console.log(JSON.stringify({
    found: true,
    recordId: row._recordId,
    case: row,
  }, null, 2));
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
}
