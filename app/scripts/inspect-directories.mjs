import XLSX from "xlsx";

const workbook = XLSX.readFile("справочники.xlsx", { cellDates: true });
const sheet = workbook.Sheets["ЮЦ-Регионы"];
if (!sheet) throw new Error("Лист «ЮЦ-Регионы» не найден.");

const rows = XLSX.utils.sheet_to_json(sheet, {
  header: 1,
  defval: "",
  blankrows: false,
  raw: false,
});

console.table(rows.slice(0, 25));
