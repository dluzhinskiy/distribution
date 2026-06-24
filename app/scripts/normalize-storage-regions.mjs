import fs from "node:fs/promises";
import path from "node:path";
import { readDirectories } from "../lib/directories.mjs";
import { readData, saveData, storagePath } from "../lib/excel-store.mjs";
import { cleanText } from "../lib/domain.mjs";
import { normalizeRegionName } from "../lib/regions.mjs";

const data = await readData();
const directories = await readDirectories(data);
const canonicalRegions = Object.values(directories.regionsByYuc ?? {}).flat();
const changes = [];

for (const row of data.cases) {
  const before = cleanText(row["Регион"]);
  const after = normalizeRegionName(before, canonicalRegions);
  if (before && after && before !== after) {
    row["Регион"] = after;
    changes.push({ case_id: row.case_id, before, after });
  }
}

if (changes.length) {
  const filePath = storagePath();
  const parsed = path.parse(filePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(parsed.dir, `${parsed.name}.backup-regions-${stamp}${parsed.ext}`);
  await fs.copyFile(filePath, backupPath);
  await saveData(data);
  console.log(`Нормализовано регионов в делах: ${changes.length}`);
  console.log(`Резервная копия: ${backupPath}`);
  console.table(changes);
} else {
  console.log("Регионы в делах уже соответствуют справочнику.");
}
