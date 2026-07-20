import path from "node:path";
import zlib from "node:zlib";
import { caseDuplicateReason, caseImportKey as domainCaseImportKey, cleanText, normalizeType, normalizeYuc, toISODate } from "./domain.mjs";
import { normalizeRegionName } from "./regions.mjs";

function readUInt16(buffer, offset) {
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function decodeXml(value) {
  return String(value ?? "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function parseAttrs(text = "") {
  const attrs = {};
  const attrRe = /([:\w-]+)="([^"]*)"/g;
  let match;
  while ((match = attrRe.exec(text))) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function findEndOfCentralDirectory(buffer) {
  const signature = 0x06054b50;
  const minOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (readUInt32(buffer, offset) === signature) return offset;
  }
  throw new Error("Файл не похож на XLSX/XLSM: не найден каталог zip.");
}

function unzipWorkbook(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entriesCount = readUInt16(buffer, eocdOffset + 10);
  const centralDirOffset = readUInt32(buffer, eocdOffset + 16);
  const entries = new Map();
  let offset = centralDirOffset;

  for (let index = 0; index < entriesCount; index += 1) {
    if (readUInt32(buffer, offset) !== 0x02014b50) {
      throw new Error("Не удалось прочитать структуру Excel-файла.");
    }
    const method = readUInt16(buffer, offset + 10);
    const compressedSize = readUInt32(buffer, offset + 20);
    const fileNameLength = readUInt16(buffer, offset + 28);
    const extraLength = readUInt16(buffer, offset + 30);
    const commentLength = readUInt16(buffer, offset + 32);
    const localHeaderOffset = readUInt32(buffer, offset + 42);
    const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);

    if (readUInt32(buffer, localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Не удалось прочитать файл внутри Excel: ${fileName}`);
    }
    const localNameLength = readUInt16(buffer, localHeaderOffset + 26);
    const localExtraLength = readUInt16(buffer, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) {
      data = compressed;
    } else if (method === 8) {
      data = zlib.inflateRawSync(compressed);
    } else {
      throw new Error(`Excel использует неподдерживаемый метод сжатия: ${method}.`);
    }
    entries.set(fileName.replaceAll("\\", "/"), data);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function xmlText(entries, name) {
  const data = entries.get(name);
  return data ? data.toString("utf8") : "";
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let siMatch;
  while ((siMatch = siRe.exec(xml))) {
    const parts = [];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tMatch;
    while ((tMatch = tRe.exec(siMatch[1]))) {
      parts.push(decodeXml(tMatch[1]));
    }
    strings.push(parts.join(""));
  }
  return strings;
}

function parseWorkbookSheets(workbookXml, relsXml) {
  const rels = new Map();
  const relRe = /<Relationship\b([^>]*)\/?>/g;
  let relMatch;
  while ((relMatch = relRe.exec(relsXml))) {
    const attrs = parseAttrs(relMatch[1]);
    if (attrs.Id && attrs.Target) rels.set(attrs.Id, attrs.Target);
  }

  const sheets = [];
  const sheetRe = /<sheet\b([^>]*)\/?>/g;
  let sheetMatch;
  while ((sheetMatch = sheetRe.exec(workbookXml))) {
    const attrs = parseAttrs(sheetMatch[1]);
    const target = rels.get(attrs["r:id"]);
    if (!attrs.name || !target) continue;
    const normalizedTarget = target.startsWith("/")
      ? target.slice(1)
      : path.posix.normalize(path.posix.join("xl", target));
    sheets.push({ name: attrs.name, path: normalizedTarget });
  }
  return sheets;
}

function columnIndex(ref = "") {
  const letters = String(ref).match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "";
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return index - 1;
}

function parseCellValue(attrs, inner, sharedStrings) {
  if (attrs.t === "inlineStr") {
    const parts = [];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tMatch;
    while ((tMatch = tRe.exec(inner))) parts.push(decodeXml(tMatch[1]));
    return parts.join("");
  }
  const valueMatch = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
  if (!valueMatch) return "";
  const raw = decodeXml(valueMatch[1]);
  if (attrs.t === "s") return sharedStrings[Number(raw)] ?? "";
  if (attrs.t === "str") return raw;
  if (raw.trim() === "") return "";
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : raw;
}

function parseSheetRows(sheetXml, sharedStrings) {
  const rows = [];
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(sheetXml))) {
    const rowAttrs = parseAttrs(rowMatch[1]);
    const rowIndex = Number(rowAttrs.r || rows.length + 1) - 1;
    const row = rows[rowIndex] ?? [];
    const cellRe = /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[2]))) {
      const attrs = parseAttrs(cellMatch[1] ?? cellMatch[2]);
      const index = attrs.r ? columnIndex(attrs.r) : row.length;
      row[index] = parseCellValue(attrs, cellMatch[3] || "", sharedStrings);
    }
    rows[rowIndex] = row;
  }
  return rows;
}

function headerKey(value) {
  return cleanText(value)
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^а-яa-z0-9]+/gi, "");
}

const HEADER_ALIASES = {
  responsible: ["ответственный"],
  subject: ["предметспора", "предмет"],
  region: ["регион"],
  plaintiff: ["наименованиефиоистцазаявителякредитора", "истец", "заявитель", "истецзаявитель"],
  defendant: ["наименованиефиоответчикадолжникабанкрота", "ответчик", "должник"],
  thirdParty: ["наименованиефио3голица", "третьелицо", "3елицо"],
  type: ["судебноеадминистративноетретьилица", "типдела", "судебноеадминистративное3лица"],
  date: ["датапоступлениявработу", "датапоступления"],
  caseNumber: ["номердела"],
  link: ["ссылка"],
};

function buildHeaderMap(header = []) {
  const byKey = new Map();
  header.forEach((value, index) => {
    const key = headerKey(value);
    if (key && !byKey.has(key)) byKey.set(key, index);
  });
  return Object.fromEntries(Object.entries(HEADER_ALIASES).map(([field, aliases]) => {
    const index = aliases.map((alias) => byKey.get(alias)).find((value) => Number.isInteger(value));
    return [field, index ?? -1];
  }));
}

function cell(row, index) {
  return index >= 0 ? row[index] : "";
}

function parseDate(value) {
  return toISODate(value);
}

function sourceCaseFromRow(row, headerMap, rowNumber, defaultYuc) {
  const type = normalizeType(cell(row, headerMap.type));
  const source = {
    "Номер дела": cleanText(cell(row, headerMap.caseNumber)),
    "Предмет": cleanText(cell(row, headerMap.subject)),
    "ЮЦ": normalizeYuc(defaultYuc),
    "Регион": normalizeRegionName(cell(row, headerMap.region)),
    "Истец": cleanText(cell(row, headerMap.plaintiff)),
    "Ответчик": cleanText(cell(row, headerMap.defendant)),
    "Третье лицо": cleanText(cell(row, headerMap.thirdParty)),
    "Тип дела": type,
    "Дата поступления": parseDate(cell(row, headerMap.date)),
    "Ответственный": cleanText(cell(row, headerMap.responsible)),
    "Ссылка": cleanText(cell(row, headerMap.link)),
  };
  const errors = [];
  if (!source["Предмет"]) errors.push("нет предмета");
  if (!source["Тип дела"]) errors.push("нет типа дела");
  if (!source["Дата поступления"]) errors.push("нет даты поступления");
  return { rowNumber, source, errors };
}

function hasMeaningfulSourceData(source) {
  return [
    "Номер дела",
    "Предмет",
    "Регион",
    "Истец",
    "Ответчик",
    "Третье лицо",
    "Тип дела",
    "Дата поступления",
    "Ответственный",
    "Ссылка",
  ].some((field) => cleanText(source[field]));
}

function comparableText(value) {
  return cleanText(value).toLowerCase().replaceAll("ё", "е");
}

export function caseImportKey(row) {
  return domainCaseImportKey(row);
}

function findDuplicate(source, rows, options = {}) {
  for (const row of rows ?? []) {
    const reason = caseDuplicateReason(source, row.source ?? row, options);
    if (reason) return { row, reason };
  }
  return null;
}

export function parseCaseWorkbook(buffer, existingCases = [], options = {}) {
  const entries = unzipWorkbook(Buffer.from(buffer));
  const sharedStrings = parseSharedStrings(xmlText(entries, "xl/sharedStrings.xml"));
  const sheets = parseWorkbookSheets(
    xmlText(entries, "xl/workbook.xml"),
    xmlText(entries, "xl/_rels/workbook.xml.rels")
  );
  const sheet = sheets.find((item) => item.name === options.sheetName)
    ?? sheets.find((item) => /база.*дел/i.test(item.name))
    ?? sheets.find((item) => /актуаль/i.test(item.name))
    ?? sheets[0];
  if (!sheet) throw new Error("В Excel-файле не найден ни один лист.");

  const rows = parseSheetRows(xmlText(entries, sheet.path), sharedStrings).filter(Boolean);
  if (!rows.length) throw new Error("Лист с делами пуст.");

  const header = rows[0] ?? [];
  const headerMap = buildHeaderMap(header);
  if (headerMap.subject < 0 || headerMap.type < 0 || headerMap.date < 0) {
    throw new Error("Не найдены обязательные колонки: предмет, тип дела и дата поступления.");
  }

  const toAdd = [];
  const existing = [];
  const invalid = [];
  const duplicateInFile = [];

  rows.slice(1).forEach((row, offset) => {
    const parsed = sourceCaseFromRow(row, headerMap, offset + 2, options.yuc || "Дальний Восток");
    if (!hasMeaningfulSourceData(parsed.source)) return;
    if (parsed.errors.length) {
      invalid.push({ rowNumber: parsed.rowNumber, reason: parsed.errors.join(", "), source: parsed.source });
      return;
    }
    const existingDuplicate = findDuplicate(parsed.source, existingCases);
    if (existingDuplicate) {
      existing.push({ rowNumber: parsed.rowNumber, reason: existingDuplicate.reason, source: parsed.source });
      return;
    }
    const fileDuplicate = findDuplicate(parsed.source, toAdd, { strictOnly: true });
    if (fileDuplicate) {
      duplicateInFile.push({ rowNumber: parsed.rowNumber, duplicateOfRow: fileDuplicate.row.rowNumber, reason: fileDuplicate.reason, source: parsed.source });
      return;
    }
    toAdd.push({ rowNumber: parsed.rowNumber, source: parsed.source });
  });

  const processedRows = toAdd.length + existing.length + invalid.length + duplicateInFile.length;
  return {
    sheetName: sheet.name,
    sourceRows: processedRows,
    toAdd,
    existing,
    invalid,
    duplicateInFile,
    stats: {
      sourceRows: processedRows,
      newCases: toAdd.length,
      existingCases: existing.length,
      invalidRows: invalid.length,
      duplicateRows: duplicateInFile.length,
    },
  };
}
