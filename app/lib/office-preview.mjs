import path from "node:path";
import zlib from "node:zlib";

const LIMITS = {
  maxSheets: 8,
  maxRowsPerSheet: 160,
  maxColumns: 36,
  maxCellLength: 500,
  maxDocxBlocks: 260,
  maxDocxTableRows: 80,
  maxDocxTableColumns: 24,
  maxDocxTextLength: 18_000,
};

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
    .replaceAll("&amp;", "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function parseAttrs(text = "") {
  const attrs = {};
  const attrRe = /([:\w-]+)="([^"]*)"/g;
  let match;
  while ((match = attrRe.exec(text))) attrs[match[1]] = decodeXml(match[2]);
  return attrs;
}

function findEndOfCentralDirectory(buffer) {
  const signature = 0x06054b50;
  const minOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (readUInt32(buffer, offset) === signature) return offset;
  }
  throw new Error("Файл не похож на документ Office.");
}

function unzipOfficeFile(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entriesCount = readUInt16(buffer, eocdOffset + 10);
  const centralDirOffset = readUInt32(buffer, eocdOffset + 16);
  const entries = new Map();
  let offset = centralDirOffset;

  for (let index = 0; index < entriesCount; index += 1) {
    if (readUInt32(buffer, offset) !== 0x02014b50) throw new Error("Не удалось прочитать структуру документа Office.");
    const method = readUInt16(buffer, offset + 10);
    const compressedSize = readUInt32(buffer, offset + 20);
    const fileNameLength = readUInt16(buffer, offset + 28);
    const extraLength = readUInt16(buffer, offset + 30);
    const commentLength = readUInt16(buffer, offset + 32);
    const localHeaderOffset = readUInt32(buffer, offset + 42);
    const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength).replaceAll("\\", "/");
    if (readUInt32(buffer, localHeaderOffset) !== 0x04034b50) throw new Error(`Не удалось прочитать файл внутри документа: ${fileName}`);
    const localNameLength = readUInt16(buffer, localHeaderOffset + 26);
    const localExtraLength = readUInt16(buffer, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? compressed : method === 8 ? zlib.inflateRawSync(compressed) : null;
    if (!data) throw new Error("Документ использует неподдерживаемый метод сжатия.");
    entries.set(fileName, data);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function xmlText(entries, name) {
  return entries.get(name)?.toString("utf8") || "";
}

function compactText(value, max = LIMITS.maxCellLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function wordXmlToText(xml) {
  return compactText(decodeXml(String(xml ?? "")
    .replace(/<w:tab\b[^/>]*\/>/g, "\t")
    .replace(/<w:(?:br|cr)\b[^/>]*\/>/g, "\n")
    .replace(/<[^>]+>/g, "")), LIMITS.maxDocxTextLength);
}

export function previewDocx(buffer) {
  const entries = unzipOfficeFile(Buffer.from(buffer));
  const source = xmlText(entries, "word/document.xml");
  if (!source) throw new Error("В DOCX не найдено основное содержимое.");
  const body = source.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/)?.[1] || source;
  const blocks = [];
  const blockRe = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g;
  let match;
  let truncated = false;
  while ((match = blockRe.exec(body))) {
    if (blocks.length >= LIMITS.maxDocxBlocks) {
      truncated = true;
      break;
    }
    const markup = match[0];
    if (markup.startsWith("<w:tbl")) {
      const rows = [];
      const rowRe = /<w:tr\b[\s\S]*?<\/w:tr>/g;
      let rowMatch;
      while ((rowMatch = rowRe.exec(markup))) {
        if (rows.length >= LIMITS.maxDocxTableRows) {
          truncated = true;
          break;
        }
        const cells = [];
        const cellRe = /<w:tc\b[\s\S]*?<\/w:tc>/g;
        let cellMatch;
        while ((cellMatch = cellRe.exec(rowMatch[0]))) {
          if (cells.length >= LIMITS.maxDocxTableColumns) {
            truncated = true;
            break;
          }
          cells.push(wordXmlToText(cellMatch[0]));
        }
        if (cells.some(Boolean)) rows.push(cells);
      }
      if (rows.length) blocks.push({ type: "table", rows });
    } else {
      const text = wordXmlToText(markup);
      if (text) blocks.push({ type: "paragraph", text });
    }
  }
  return { type: "docx", blocks, truncated };
}

function parseSharedStrings(xml) {
  const values = [];
  const itemRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let item;
  while ((item = itemRe.exec(xml))) {
    const parts = [];
    const textRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let text;
    while ((text = textRe.exec(item[1]))) parts.push(decodeXml(text[1]));
    values.push(parts.join(""));
  }
  return values;
}

function parseWorkbookSheets(workbookXml, relsXml) {
  const rels = new Map();
  const relRe = /<Relationship\b([^>]*)\/?>/g;
  let relation;
  while ((relation = relRe.exec(relsXml))) {
    const attrs = parseAttrs(relation[1]);
    if (attrs.Id && attrs.Target) rels.set(attrs.Id, attrs.Target);
  }
  const sheets = [];
  const sheetRe = /<sheet\b([^>]*)\/?>/g;
  let sheet;
  while ((sheet = sheetRe.exec(workbookXml))) {
    const attrs = parseAttrs(sheet[1]);
    const target = rels.get(attrs["r:id"]);
    if (!attrs.name || !target) continue;
    sheets.push({
      name: attrs.name,
      path: target.startsWith("/") ? target.slice(1) : path.posix.normalize(path.posix.join("xl", target)),
    });
  }
  return sheets;
}

function columnIndex(reference = "") {
  const letters = String(reference).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "";
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

function parseSpreadsheetValue(attrs, inner, sharedStrings) {
  if (attrs.t === "inlineStr") {
    const values = [...String(inner).matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1]));
    return values.join("");
  }
  const raw = String(inner).match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
  if (raw === undefined) return "";
  const value = decodeXml(raw);
  if (attrs.t === "s") return sharedStrings[Number(value)] ?? "";
  return value;
}

function parseSpreadsheetRows(xml, sharedStrings) {
  const rows = [];
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(xml))) {
    if (rows.length >= LIMITS.maxRowsPerSheet) break;
    const row = [];
    const cellRe = /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cell;
    while ((cell = cellRe.exec(rowMatch[2]))) {
      const attrs = parseAttrs(cell[1] ?? cell[2]);
      const index = attrs.r ? columnIndex(attrs.r) : row.length;
      if (index < 0 || index >= LIMITS.maxColumns) continue;
      row[index] = compactText(parseSpreadsheetValue(attrs, cell[3] || "", sharedStrings));
    }
    rows.push(Array.from({ length: Math.min(Math.max(row.length, 1), LIMITS.maxColumns) }, (_, index) => row[index] ?? ""));
  }
  return rows;
}

export function previewXlsx(buffer) {
  const entries = unzipOfficeFile(Buffer.from(buffer));
  const sheets = parseWorkbookSheets(xmlText(entries, "xl/workbook.xml"), xmlText(entries, "xl/_rels/workbook.xml.rels"));
  if (!sheets.length) throw new Error("В XLSX не найдено ни одного листа.");
  const sharedStrings = parseSharedStrings(xmlText(entries, "xl/sharedStrings.xml"));
  const visibleSheets = sheets.slice(0, LIMITS.maxSheets).map((sheet) => ({
    name: sheet.name,
    rows: parseSpreadsheetRows(xmlText(entries, sheet.path), sharedStrings),
  }));
  return {
    type: "xlsx",
    sheets: visibleSheets,
    truncated: sheets.length > visibleSheets.length || visibleSheets.some((sheet) => sheet.rows.length >= LIMITS.maxRowsPerSheet),
  };
}
