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
  if (entriesCount > 2048) throw Object.assign(new Error("Слишком много элементов в Excel-архиве."), { status: 413 });
  let expandedBytes = 0;
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
      data = zlib.inflateRawSync(compressed, { maxOutputLength: 32 * 1024 * 1024 });
    } else {
      throw new Error(`XLSX использует неподдерживаемый метод сжатия: ${method}.`);
    }
    expandedBytes += data.length;
    if (data.length > 32 * 1024 * 1024 || expandedBytes > 64 * 1024 * 1024)
      throw Object.assign(new Error("Превышен допустимый размер распакованного Excel."), { status: 413 });
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
    const cellStyles = row.cellStyles ?? [];
    const cellRe = /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[2]))) {
      const attrs = parseAttrs(cellMatch[1] ?? cellMatch[2]);
      const index = attrs.r ? columnIndex(attrs.r) : row.length;
      row[index] = parseCellValue(attrs, cellMatch[3] || "", sharedStrings);
      cellStyles[index] = Number(attrs.s || 0);
    }
    row.cellStyles = cellStyles;
    rows[rowIndex] = row;
  }
  return rows;
}

function parseCellStyleFills(stylesXml) {
  const fills = [];
  const fillsMatch = stylesXml.match(/<fills\b[^>]*>([\s\S]*?)<\/fills>/);
  const fillRe = /<fill\b[^>]*>([\s\S]*?)<\/fill>/g;
  let fillMatch;
  while ((fillMatch = fillRe.exec(fillsMatch?.[1] ?? ""))) {
    const patternMatch = fillMatch[1].match(/<patternFill\b([^>]*)>/);
    const colorMatch = fillMatch[1].match(/<fgColor\b([^>]*)\/?>(?:<\/fgColor>)?/);
    const pattern = parseAttrs(patternMatch?.[1] ?? "").patternType ?? "";
    const colorAttrs = parseAttrs(colorMatch?.[1] ?? "");
    fills.push({ pattern, rgb: String(colorAttrs.rgb ?? "").toUpperCase(), theme: colorAttrs.theme ?? "" });
  }

  const styleFills = new Map();
  const cellXfsMatch = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  const xfRe = /<xf\b([^>]*)\/?>(?:<\/xf>)?/g;
  let xfMatch;
  let styleIndex = 0;
  while ((xfMatch = xfRe.exec(cellXfsMatch?.[1] ?? ""))) {
    const attrs = parseAttrs(xfMatch[1]);
    styleFills.set(styleIndex, fills[Number(attrs.fillId || 0)] ?? { pattern: "", rgb: "", theme: "" });
    styleIndex += 1;
  }
  return styleFills;
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

const RUSSIAN_MONTHS = new Map([
  ["январь", 1], ["февраль", 2], ["март", 3], ["апрель", 4],
  ["май", 5], ["июнь", 6], ["июль", 7], ["август", 8],
  ["сентябрь", 9], ["октябрь", 10], ["ноябрь", 11], ["декабрь", 12],
]);

function parseMonthHeader(value) {
  const match = String(value ?? "").trim().toLowerCase().match(/^([а-яё]+)\s+(\d{4})$/i);
  const month = RUSSIAN_MONTHS.get(match?.[1]?.replaceAll("ё", "е") ?? "");
  const year = Number(match?.[2]);
  return month && year >= 2000 && year <= 2200 ? { year, month } : null;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isHighlightedVacationStyle(styleIndex, styleFills) {
  const fill = styleFills.get(Number(styleIndex));
  if (!fill || fill.pattern !== "solid") return false;
  if (fill.theme !== "") return true;
  return Boolean(fill.rgb && !["FFFFFFFF", "FFF2F2F2"].includes(fill.rgb));
}

export function parseMonthlyVacationRows(rows, styleFills) {
  const sourceRows = [];
  const scopeDates = [];
  let currentMonth = null;
  rows.forEach((row, rowIndex) => {
    const monthHeader = parseMonthHeader(row?.[0]);
    if (monthHeader) {
      currentMonth = monthHeader;
      for (let day = 1; day <= daysInMonth(monthHeader.year, monthHeader.month); day += 1) {
        scopeDates.push(monthDate(monthHeader.year, monthHeader.month, day));
      }
      return;
    }
    const sourceName = String(row?.[0] ?? "").trim();
    if (!currentMonth || !sourceName) return;
    const vacationDates = [];
    const invalidDays = [];
    for (let column = 1; column < row.length; column += 1) {
      const rawDay = row[column];
      if (rawDay === "" || rawDay === null || rawDay === undefined) continue;
      const day = Number(rawDay);
      if (!Number.isInteger(day) || day < 1 || day > daysInMonth(currentMonth.year, currentMonth.month)) {
        invalidDays.push({ rowNumber: rowIndex + 1, column: column + 1, value: rawDay });
        continue;
      }
      if (isHighlightedVacationStyle(row.cellStyles?.[column], styleFills)) {
        vacationDates.push(monthDate(currentMonth.year, currentMonth.month, day));
      }
    }
    sourceRows.push({ rowNumber: rowIndex + 1, sourceName, vacationDates, invalidDays });
  });
  return {
    sourceRows,
    scopeDates: [...new Set(scopeDates)].sort(),
  };
}

function buildMonthlyVacationPlan(rows, employees, styleFills, sheetName) {
  const parsed = parseMonthlyVacationRows(rows, styleFills);
  if (!parsed.scopeDates.length || !parsed.sourceRows.length) {
    throw new Error("Не найден помесячный график: нужны строки вида «Январь 2026» и сотрудники с днями месяца.");
  }
  const grouped = new Map();
  for (const sourceRow of parsed.sourceRows) {
    const key = compactNameKey(sourceRow.sourceName);
    if (!key) continue;
    const current = grouped.get(key) ?? {
      rowNumber: sourceRow.rowNumber,
      rowNumbers: [],
      sourceName: sourceRow.sourceName,
      vacationDates: [],
      invalidValues: [],
    };
    current.rowNumbers.push(sourceRow.rowNumber);
    current.vacationDates.push(...sourceRow.vacationDates);
    current.invalidValues.push(...sourceRow.invalidDays);
    grouped.set(key, current);
  }

  const matchEmployee = buildEmployeeMatcher(employees);
  const matchedByEmployee = new Map();
  const unmatched = [];
  const ambiguous = [];
  const invalidCells = [];
  for (const source of grouped.values()) {
    source.vacationDates = [...new Set(source.vacationDates)].sort();
    invalidCells.push(...source.invalidValues);
    const match = matchEmployee(source.sourceName);
    if (match.status === "matched") {
      const employeeId = String(match.employee.employee_id ?? "").trim();
      const current = matchedByEmployee.get(employeeId) ?? {
        rowNumber: source.rowNumber,
        rowNumbers: [],
        sourceName: source.sourceName,
        employee_id: employeeId,
        employeeName: String(match.employee["ФИО"] ?? "").trim(),
        matchBy: match.by,
        vacationDates: [],
      };
      current.rowNumbers.push(...source.rowNumbers);
      current.vacationDates.push(...source.vacationDates);
      current.vacationDates = [...new Set(current.vacationDates)].sort();
      current.vacationDays = current.vacationDates.length;
      matchedByEmployee.set(employeeId, current);
    } else if (match.status === "ambiguous") {
      ambiguous.push({
        rowNumber: source.rowNumber,
        rowNumbers: source.rowNumbers,
        sourceName: source.sourceName,
        matchBy: match.by,
        candidates: match.candidates.map((employee) => ({
          employee_id: String(employee.employee_id ?? "").trim(),
          employeeName: String(employee["ФИО"] ?? "").trim(),
        })),
        vacationDays: source.vacationDates.length,
      });
    } else {
      unmatched.push({
        rowNumber: source.rowNumber,
        rowNumbers: source.rowNumbers,
        sourceName: source.sourceName,
        vacationDays: source.vacationDates.length,
      });
    }
  }

  const matched = [...matchedByEmployee.values()];
  const years = uniqueYears(parsed.scopeDates);
  return {
    format: "monthly-colored-grid",
    sheetName,
    year: years.length === 1 ? Number(years[0]) : null,
    years,
    firstDate: parsed.scopeDates[0],
    lastDate: parsed.scopeDates[parsed.scopeDates.length - 1],
    scopeDates: parsed.scopeDates,
    sourceRows: parsed.sourceRows.length,
    matched,
    unmatched,
    ambiguous,
    invalidCells: invalidCells.slice(0, 100),
    stats: {
      dateColumns: parsed.scopeDates.length,
      matchedEmployees: matched.length,
      unmatchedEmployees: unmatched.length,
      ambiguousEmployees: ambiguous.length,
      vacationDays: matched.reduce((sum, item) => sum + item.vacationDays, 0),
      invalidCells: invalidCells.length,
    },
  };
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
    return buildMonthlyVacationPlan(
      rows,
      employees,
      parseCellStyleFills(xmlText(entries, "xl/styles.xml")),
      sheet.name,
    );
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
