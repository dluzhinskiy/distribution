function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function key(value) {
  return cleanText(value)
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[.,]/g, "")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MANUAL_REGION_ALIASES = new Map(Object.entries({
  "благовещенск": "Амурская область",
  "амур": "Амурская область",
  "амурская": "Амурская область",
  "бурятия": "Республика Бурятия",
  "иркутск": "Иркутская область",
  "иркутская": "Иркутская область",
  "камчатка": "Камчатский край",
  "камчатский": "Камчатский край",
  "приморье": "Приморский край",
  "приморский": "Приморский край",
  "сахалин": "Сахалинская область",
  "сахалинская": "Сахалинская область",
  "хабаровск": "Хабаровский край",
  "хабаровский": "Хабаровский край",
  "чита": "Забайкальский край",
  "забайкалье": "Забайкальский край",
  "забайкальский": "Забайкальский край",
  "якутия": "Республика Саха (Якутия)",
  "саха": "Республика Саха (Якутия)",
  "саха якутия": "Республика Саха (Якутия)",
}));

function generatedAliases(canonical) {
  const text = cleanText(canonical);
  const aliases = new Set([text]);
  aliases.add(text.replace(/^Республика\s+/i, ""));
  aliases.add(text.replace(/\s+область$/i, ""));
  aliases.add(text.replace(/\s+край$/i, ""));
  aliases.add(text.replace(/\s+автономн[ыи]й\s+округ$/i, ""));
  aliases.add(text.replace(/\s+автономная\s+область$/i, ""));
  if (/Саха/i.test(text) && /Якутия/i.test(text)) {
    aliases.add("Якутия");
    aliases.add("Саха");
    aliases.add("Саха Якутия");
  }
  return [...aliases].map(key).filter(Boolean);
}

export function normalizeRegionName(value, canonicalRegions = []) {
  const original = cleanText(value);
  if (!original) return "";
  const lookup = new Map();
  for (const region of canonicalRegions) {
    const canonical = cleanText(region);
    if (!canonical) continue;
    for (const alias of generatedAliases(canonical)) {
      lookup.set(alias, canonical);
    }
  }
  for (const [alias, canonical] of MANUAL_REGION_ALIASES) {
    if (!canonicalRegions.length || canonicalRegions.some((region) => key(region) === key(canonical))) {
      lookup.set(alias, canonical);
    }
  }
  return lookup.get(key(original)) ?? original;
}

export function regionKey(value) {
  return key(value);
}
