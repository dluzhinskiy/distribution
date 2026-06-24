import fs from "node:fs/promises";
import XLSX from "xlsx";
import { cleanText, normalizeYuc } from "./domain.mjs";
import { normalizeRegionName } from "./regions.mjs";

const DIRECTORY_FILE = new URL("../справочники.xlsx", import.meta.url);
const SHEET_YUC_REGIONS = "ЮЦ-Регионы";

export function directoriesPath() {
  return decodeURIComponent(DIRECTORY_FILE.pathname);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
}

function fallbackDirectories(data) {
  const pairs = [];
  for (const row of data?.cases ?? []) {
    const yuc = normalizeYuc(row["ЮЦ"]);
    const region = cleanText(row["Регион"]);
    if (region) pairs.push({ yuc, region });
  }
  for (const row of data?.queues ?? []) {
    const yuc = normalizeYuc(row["ЮЦ"]);
    if (yuc) pairs.push({ yuc, region: "" });
  }
  const yucs = uniqueSorted(pairs.map((item) => item.yuc));
  const regionsByYuc = Object.fromEntries(yucs.map((yuc) => [
    yuc,
    uniqueSorted(pairs.filter((item) => item.yuc === yuc).map((item) => item.region)),
  ]));
  return { yucs, regionsByYuc, source: "fallback" };
}

export async function readDirectories(dataForFallback = null) {
  try {
    await fs.access(DIRECTORY_FILE);
    const workbook = XLSX.readFile(directoriesPath(), { cellDates: true });
    const sheet = workbook.Sheets[SHEET_YUC_REGIONS];
    if (!sheet) throw new Error("Лист «ЮЦ-Регионы» не найден.");
    const values = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      blankrows: false,
      raw: false,
    });
    const headerIndex = values.findIndex((row) => row.some((cell) => cleanText(cell) === "ЮЦ"));
    if (headerIndex < 0) throw new Error("На листе «ЮЦ-Регионы» не найдена колонка «ЮЦ».");
    const headers = values[headerIndex].map((item) => cleanText(item));
    const yucIndex = headers.indexOf("ЮЦ");
    const regionIndex = headers.indexOf("Регион");
    if (yucIndex < 0 || regionIndex < 0) {
      throw new Error("На листе «ЮЦ-Регионы» нужны колонки «ЮЦ» и «Регион».");
    }
    const pairs = values
      .slice(headerIndex + 1)
      .map((row) => ({
        yuc: normalizeYuc(row[yucIndex]),
        region: normalizeRegionName(row[regionIndex]),
      }))
      .filter((item) => item.yuc && item.region);

    const yucs = uniqueSorted(pairs.map((item) => item.yuc));
    const regionsByYuc = Object.fromEntries(yucs.map((yuc) => [
      yuc,
      uniqueSorted(pairs.filter((item) => item.yuc === yuc).map((item) => item.region)),
    ]));
    return {
      yucs,
      regionsByYuc,
      source: directoriesPath(),
    };
  } catch (error) {
    const fallback = fallbackDirectories(dataForFallback);
    return {
      ...fallback,
      warning: `Справочник не прочитан: ${error.message}`,
    };
  }
}
