function normalizedFieldName(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim();
}

export function tableFieldKey(table) {
  return table.fieldKey || "name";
}

export function outboundFieldName(table, header) {
  return table.writeFieldNames?.[header] || header;
}

export function inboundFieldValue(table, fields = {}, header) {
  const preferred = outboundFieldName(table, header);
  if (Object.prototype.hasOwnProperty.call(fields, preferred)) return fields[preferred];
  if (Object.prototype.hasOwnProperty.call(fields, header)) return fields[header];
  const aliases = table.fieldAliases?.[header] ?? [];
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(fields, alias)) return fields[alias];
  }
  const normalizedHeader = normalizedFieldName(header);
  const matchingKey = Object.keys(fields).find((key) => normalizedFieldName(key) === normalizedHeader);
  return matchingKey === undefined ? undefined : fields[matchingKey];
}
