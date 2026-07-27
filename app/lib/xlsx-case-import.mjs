import path from "node:path";
import zlib from "node:zlib";
import { caseImportDuplicateReason, caseImportKey as domainCaseImportKey, cleanMultilineText, cleanText, nameMatches, normalizeType, normalizeYuc, toISODate } from "./domain.mjs";
import { caseproBranchKey } from "./directories.mjs";
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
  responsible: ["ответственный", "фиоисполнителя"],
  subject: ["предметспора", "предмет"],
  region: ["регион", "наименованиеюпрегионаотделакц"],
  customerUnit: ["подразделениезаказчика"],
  plaintiff: ["наименованиефиоистцазаявителякредитора", "заявительистецпоосновномуиску", "истец", "заявитель", "истецзаявитель"],
  defendant: ["наименованиефиоответчикадолжникабанкрота", "лицопривлекаемоекотвтиответчикпоосновномуиску", "ответчик", "должник"],
  thirdParty: ["наименованиефио3голица", "3илица", "третьелицо", "3елицо"],
  type: ["судебноеадминистративноетретьилица", "типдела", "судебноеадминистративное3лица", "направлениеработысудадмилиуголовноедело"],
  date: ["датапоступлениявработу", "датапоступления", "датасозданиякарточки"],
  caseNumber: ["номердела", "номерделавсуде"],
  caseNumberFallback: ["номерделадосуддляадмиуголдел"],
  link: ["ссылка", "ссылканакарточкуделаскрыть"],
  yuc: ["юц", "наименованиеюцдептакц"],
  movement: ["движениедела"],
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

function findHeaderRow(rows) {
  return rows.findIndex((row) => {
    const keys = new Set((row ?? []).map(headerKey).filter(Boolean));
    return keys.has("предметспора") || (keys.has("типдела") && keys.has("датапоступления")) ||
      (keys.has("наименованиеюцдептакц") && keys.has("направлениеработысудадмилиуголовноедело"));
  });
}

function parseDate(value) {
  return toISODate(value);
}

function reportType(value) {
  const text = cleanText(value).toLowerCase();
  if (text.includes("банкрот")) return "банкротное";
  if (text.includes("уголов")) return "уголовное";
  if (text.includes("админ")) return "административное";
  if (text.includes("судеб")) return "судебное";
  return normalizeType(value);
}

function reportYuc(value) {
  const text = cleanText(value).replace(/^юц\s+/i, "");
  return text ? normalizeYuc(text) : "";
}

function reportEmployeeName(value) {
  return cleanText(value).replace(/\s*тел(?:ефон)?\s*:?\s*\d+[\s\S]*$/i, "").trim();
}

function resolveReportRegion(value, directories, yuc) {
  // При импорте регион может относиться к другому ЮЦ: это информационное
  // свойство карточки и не меняет правила очередей выбранного ЮЦ.
  return directories?.regionByCaseproBranch?.[caseproBranchKey(value)] ?? "";
}

function resolveResponsible(sourceName, employees, yuc) {
  const normalized = reportEmployeeName(sourceName);
  const matchingEmployees = (employees ?? []).filter((employee) => nameMatches(employee["ФИО"], normalized));
  if (matchingEmployees.length === 1) return { responsible: cleanText(matchingEmployees[0]["ФИО"]), mode: "matched" };
  if (matchingEmployees.length > 1) {
    return { responsible: "", mode: "manual", options: matchingEmployees.map((employee) => cleanText(employee["ФИО"])) };
  }
  const managers = (employees ?? []).filter((employee) =>
    normalizeYuc(employee["ЮЦ"]) === normalizeYuc(yuc) && cleanText(employee["Роль доступа"]).toLowerCase() === "руководитель"
  );
  if (managers.length === 1) return { responsible: cleanText(managers[0]["ФИО"]), mode: "leader-fallback" };
  if (managers.length > 1) return { responsible: "", mode: "manual", options: managers.map((employee) => cleanText(employee["ФИО"])), fallback: true };
  return { responsible: "", mode: "missing" };
}

function sourceCaseFromRow(row, headerMap, rowNumber, options = {}) {
  const importYuc = normalizeYuc(options.yuc || "Дальний Восток");
  const isReport = headerMap.yuc >= 0;
  const sourceYuc = isReport ? reportYuc(cell(row, headerMap.yuc)) : importYuc;
  // Для отчёта CasePRO регион определяется по «Подразделению заказчика».
  // Колонка ЮП/региона служит только информационным полем и не участвует в
  // сопоставлении со справочником.
  const rawRegion = isReport ? cell(row, headerMap.customerUnit) : cell(row, headerMap.region);
  const originalResponsible = cell(row, headerMap.responsible);
  const responsibleInfo = isReport ? resolveResponsible(originalResponsible, options.employees, importYuc) : {
    responsible: cleanText(originalResponsible), mode: "legacy",
  };
  const type = isReport ? reportType(cell(row, headerMap.type)) : normalizeType(cell(row, headerMap.type));
  const source = {
    "Номер дела": cleanText(cell(row, headerMap.caseNumber)) || cleanText(cell(row, headerMap.caseNumberFallback)),
    "Предмет": cleanText(cell(row, headerMap.subject)),
    "ЮЦ": importYuc,
    "Регион": isReport ? resolveReportRegion(rawRegion, options.directories, importYuc) : normalizeRegionName(rawRegion),
    "Истец": cleanText(cell(row, headerMap.plaintiff)),
    "Ответчик": cleanText(cell(row, headerMap.defendant)),
    "Третье лицо": cleanText(cell(row, headerMap.thirdParty)),
    "Тип дела": type,
    "Дата поступления": parseDate(cell(row, headerMap.date)),
    "Ответственный": responsibleInfo.responsible,
    "Ссылка": cleanText(cell(row, headerMap.link)),
    "Движение дела": cleanMultilineText(cell(row, headerMap.movement)),
  };
  const errors = [];
  if (!source["Предмет"]) errors.push("нет предмета");
  if (!source["Тип дела"]) errors.push("нет типа дела");
  if (!source["Дата поступления"]) errors.push("нет даты поступления");
  if (isReport && sourceYuc !== importYuc) errors.push("не относится к выбранному ЮЦ");
  if (!source["Регион"]) errors.push("не удалось определить регион");
  if (responsibleInfo.mode === "missing") errors.push("исполнитель не найден и в ЮЦ нет руководителя для назначения");
  return { rowNumber, source, errors, sourceYuc, isReport, responsibleInfo, rawRegion, rawResponsible: reportEmployeeName(originalResponsible) };
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
    "Движение дела",
  ].some((field) => cleanText(source[field]));
}

function comparableText(value) {
  return cleanText(value).toLowerCase().replaceAll("ё", "е");
}

export const CASE_IMPORT_UPDATE_FIELDS = [
  "Движение дела",
];

function comparableImportValue(field, value) {
  if (field === "Дата поступления") return toISODate(value);
  if (field === "Тип дела") return normalizeType(value);
  if (field === "Движение дела") return cleanMultilineText(value).toLowerCase().replaceAll("ё", "е");
  return comparableText(value);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sameMovementValue(existing, source) {
  const current = cleanMultilineText(existing).toLowerCase().replaceAll("ё", "е");
  const imported = cleanMultilineText(source).toLowerCase().replaceAll("ё", "е");
  if (current === imported) return true;

  // MTS Tabs иногда возвращает пару U+FFFD вместо одного символа исходного
  // текста. Считаем такой фрагмент одним неизвестным символом, но только при
  // сравнении уже сохранённого значения с импортом. Остальной текст обязан
  // совпадать полностью.
  if (!current.includes("\uFFFD")) return false;
  const pattern = current
    .split(/\uFFFD+/u)
    .map(escapeRegExp)
    .join("[\\s\\S]");
  return new RegExp(`^${pattern}$`, "u").test(imported);
}

export function caseImportChanges(existing = {}, source = {}) {
  return CASE_IMPORT_UPDATE_FIELDS
    .filter((field) => cleanText(source[field]))
    .filter((field) => field === "Движение дела"
      ? !sameMovementValue(existing[field], source[field])
      : comparableImportValue(field, existing[field]) !== comparableImportValue(field, source[field]))
    .map((field) => ({
      field,
      previous: field === "Движение дела" ? cleanMultilineText(existing[field]) : cleanText(existing[field]),
      next: field === "Движение дела" ? cleanMultilineText(source[field]) : cleanText(source[field]),
    }));
}

export function caseImportKey(row) {
  return domainCaseImportKey(row);
}

function findDuplicate(source, rows, options = {}) {
  for (const row of rows ?? []) {
    const reason = caseImportDuplicateReason(source, row.source ?? row, options);
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

  const headerIndex = findHeaderRow(rows);
  if (headerIndex < 0) throw new Error("Не найдена строка заголовков в Excel-файле.");
  const header = rows[headerIndex] ?? [];
  const headerMap = buildHeaderMap(header);
  if (headerMap.subject < 0 || headerMap.type < 0 || headerMap.date < 0) {
    throw new Error("Не найдены обязательные колонки: предмет, тип дела и дата поступления.");
  }

  const toAdd = [];
  const existing = [];
  const invalid = [];
  const duplicateInFile = [];

  const excluded = [];
  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const parsed = sourceCaseFromRow(row, headerMap, headerIndex + offset + 2, options);
    if (!hasMeaningfulSourceData(parsed.source)) return;
    if (parsed.isReport && parsed.sourceYuc !== normalizeYuc(options.yuc || "Дальний Восток")) {
      excluded.push({ rowNumber: parsed.rowNumber, reason: !cleanText(parsed.sourceYuc) ? "ЮЦ не указан" : `другой ЮЦ: ${parsed.sourceYuc}`, source: parsed.source });
      return;
    }
    if (parsed.errors.length) {
      invalid.push({
        rowNumber: parsed.rowNumber,
        reason: parsed.errors.join(", "),
        errors: parsed.errors,
        source: parsed.source,
        sourceRegion: cleanText(parsed.rawRegion),
        sourceResponsible: parsed.rawResponsible,
      });
      return;
    }
    const existingDuplicate = findDuplicate(parsed.source, existingCases);
    if (existingDuplicate) {
      existing.push({
        rowNumber: parsed.rowNumber,
        reason: existingDuplicate.reason,
        source: parsed.source,
        caseId: cleanText(existingDuplicate.row.case_id),
        changes: caseImportChanges(existingDuplicate.row, parsed.source),
      });
      return;
    }
    const fileDuplicate = findDuplicate(parsed.source, toAdd, { strictOnly: true });
    if (fileDuplicate) {
      duplicateInFile.push({ rowNumber: parsed.rowNumber, duplicateOfRow: fileDuplicate.row.rowNumber, reason: fileDuplicate.reason, source: parsed.source });
      return;
    }
    toAdd.push({
      rowNumber: parsed.rowNumber,
      source: parsed.source,
      responsibleMode: parsed.responsibleInfo.mode,
      responsibleOptions: parsed.responsibleInfo.options ?? [],
      rawResponsible: parsed.rawResponsible,
    });
  });

  const processedRows = toAdd.length + existing.length + invalid.length + duplicateInFile.length + excluded.length;
  return {
    sheetName: sheet.name,
    sourceRows: processedRows,
    toAdd,
    existing,
    invalid,
    duplicateInFile,
    excluded,
    stats: {
      sourceRows: processedRows,
      newCases: toAdd.length,
      existingCases: existing.length,
      updateCandidates: existing.filter((item) => item.changes.length).length,
      invalidRows: invalid.length,
      duplicateRows: duplicateInFile.length,
      excludedRows: excluded.length,
    },
  };
}
