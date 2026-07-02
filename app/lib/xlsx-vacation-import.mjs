import path from "node:path";
import zlib from "node:zlib";

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
  throw new Error("Файл не похож на XLSX: не найден каталог zip.");
}

function unzipXlsx(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entriesCount = readUInt16(buffer, eocdOffset + 10);
  const centralDirOffset = readUInt32(buffer, eocdOffset + 16);
  const entries = new Map();
  let offset = centralDirOffset;

  for (let index = 0; index < entriesCount; index += 1) {
    if (readUInt32(buffer, offset) !== 0x02014b50) {
      throw new Error("Не удалось прочитать структуру XLSX.");
    }
    const method = readUInt16(buffer, offset + 10);
    const compressedSize = readUInt32(buffer, offset + 20);
    const fileNameLength = readUInt16(buffer, offset + 28);
    const extraLength = readUInt16(buffer, offset + 30);
    const commentLength = readUInt16(buffer, offset + 32);
    const localHeaderOffset = readUInt32(buffer, offset + 42);
    const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);

    if (readUInt32(buffer, localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Не удалось прочитать файл внутри XLSX: ${fileName}`);
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
      throw new Error(`XLSX использует неподдерживаемый метод сжатия: ${method}.`);
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
    const relationId = attrs["r:id"];
    const target = rels.get(relationId);
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
    const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[2]))) {
      const attrs = parseAttrs(cellMatch[1]);
      const index = attrs.r ? columnIndex(attrs.r) : row.length;
      row[index] = parseCellValue(attrs, cellMatch[2] || "", sharedStrings);
    }
    rows[rowIndex] = row;
  }
  return rows;
}

function excelSerialToISO(value) {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial < 1) return "";
  const milliseconds = Math.round((serial - 25569) * 86_400_000);
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function parseDateHeader(value) {
  if (typeof value === "number") return excelSerialToISO(value);
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^а-яa-z\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(value) {
  return normalizeName(value).split(" ").filter(Boolean);
}

function compactNameKey(value) {
  return nameTokens(value).join(" ");
}

function surnameNameKey(value) {
  const tokens = nameTokens(value);
  if (tokens.length < 2) return "";
  return `${tokens[0]} ${tokens[1]}`;
}

function buildEmployeeMatcher(employees) {
  const exact = new Map();
  const short = new Map();
  for (const employee of employees ?? []) {
    const fullName = employee["ФИО"] ?? "";
    const exactKey = compactNameKey(fullName);
    const shortKey = surnameNameKey(fullName);
    if (exactKey) {
      if (!exact.has(exactKey)) exact.set(exactKey, []);
      exact.get(exactKey).push(employee);
    }
    if (shortKey) {
      if (!short.has(shortKey)) short.set(shortKey, []);
      short.get(shortKey).push(employee);
    }
  }

  return function matchEmployee(sourceName) {
    const sourceTokens = nameTokens(sourceName);
    const exactCandidates = exact.get(compactNameKey(sourceName)) ?? [];
    if (exactCandidates.length === 1) return { status: "matched", employee: exactCandidates[0], by: "full-name" };
    if (exactCandidates.length > 1) return { status: "ambiguous", candidates: exactCandidates, by: "full-name" };

    const shortCandidates = (short.get(surnameNameKey(sourceName)) ?? []).filter((employee) => {
      const employeeTokens = nameTokens(employee["ФИО"]);
      if (sourceTokens.length < 3 || employeeTokens.length < 3) return true;
      return sourceTokens.slice(2).join(" ") === employeeTokens.slice(2).join(" ");
    });
    if (shortCandidates.length === 1) return { status: "matched", employee: shortCandidates[0], by: "surname-name" };
    if (shortCandidates.length > 1) return { status: "ambiguous", candidates: shortCandidates, by: "surname-name" };
    return { status: "unmatched", candidates: [] };
  };
}

function parseVacationFlag(value) {
  if (value === "" || value === null || value === undefined) return 0;
  if (value === 0 || value === 1) return value;
  const text = String(value).trim();
  if (text === "0") return 0;
  if (text === "1") return 1;
  return null;
}

function uniqueYears(dates) {
  return [...new Set(dates.map((date) => date.slice(0, 4)))].sort();
}

export function parseVacationWorkbook(buffer, employees, options = {}) {
  const entries = unzipXlsx(Buffer.from(buffer));
  const sharedStrings = parseSharedStrings(xmlText(entries, "xl/sharedStrings.xml"));
  const sheets = parseWorkbookSheets(
    xmlText(entries, "xl/workbook.xml"),
    xmlText(entries, "xl/_rels/workbook.xml.rels")
  );
  const sheet = sheets.find((item) => item.name === options.sheetName)
    ?? sheets.find((item) => /отпуск/i.test(item.name))
    ?? sheets[0];
  if (!sheet) throw new Error("В Excel-файле не найден ни один лист.");

  const rows = parseSheetRows(xmlText(entries, sheet.path), sharedStrings).filter(Boolean);
  if (!rows.length) throw new Error("Лист с отпусками пуст.");
  const header = rows[0] ?? [];
  if (!String(header[0] ?? "").toLowerCase().includes("фио")) {
    throw new Error("Ожидалась таблица, где первая колонка называется «ФИО».");
  }

  const dateHeaders = header.slice(1).map((value, index) => ({
    column: index + 2,
    source: value,
    date: parseDateHeader(value),
  }));
  const validDateHeaders = dateHeaders.filter((item) => item.date);
  if (!validDateHeaders.length) {
    throw new Error("В первой строке не найдены даты для графика отпусков.");
  }

  const matchEmployee = buildEmployeeMatcher(employees);
  const matched = [];
  const unmatched = [];
  const ambiguous = [];
  const invalidCells = [];

  rows.slice(1).forEach((row, rowOffset) => {
    const rowNumber = rowOffset + 2;
    const sourceName = String(row[0] ?? "").trim();
    if (!sourceName) return;
    const vacationDates = [];
    const invalidValues = [];

    for (const headerInfo of validDateHeaders) {
      const flag = parseVacationFlag(row[headerInfo.column - 1]);
      if (flag === 1) vacationDates.push(headerInfo.date);
      if (flag === null) {
        invalidValues.push({ rowNumber, column: headerInfo.column, value: row[headerInfo.column - 1] });
      }
    }
    invalidCells.push(...invalidValues);
    const match = matchEmployee(sourceName);
    if (match.status === "matched") {
      matched.push({
        rowNumber,
        sourceName,
        employee_id: String(match.employee.employee_id ?? "").trim(),
        employeeName: String(match.employee["ФИО"] ?? "").trim(),
        matchBy: match.by,
        vacationDates,
        vacationDays: vacationDates.length,
      });
      return;
    }
    if (match.status === "ambiguous") {
      ambiguous.push({
        rowNumber,
        sourceName,
        matchBy: match.by,
        candidates: match.candidates.map((employee) => ({
          employee_id: String(employee.employee_id ?? "").trim(),
          employeeName: String(employee["ФИО"] ?? "").trim(),
        })),
        vacationDays: vacationDates.length,
      });
      return;
    }
    unmatched.push({ rowNumber, sourceName, vacationDays: vacationDates.length });
  });

  const scopeDates = validDateHeaders.map((item) => item.date);
  const years = uniqueYears(scopeDates);
  return {
    sheetName: sheet.name,
    year: years.length === 1 ? Number(years[0]) : null,
    years,
    firstDate: scopeDates[0],
    lastDate: scopeDates[scopeDates.length - 1],
    scopeDates,
    sourceRows: rows.length - 1,
    matched,
    unmatched,
    ambiguous,
    invalidCells: invalidCells.slice(0, 100),
    stats: {
      dateColumns: scopeDates.length,
      matchedEmployees: matched.length,
      unmatchedEmployees: unmatched.length,
      ambiguousEmployees: ambiguous.length,
      vacationDays: matched.reduce((sum, item) => sum + item.vacationDays, 0),
      invalidCells: invalidCells.length,
    },
  };
}
