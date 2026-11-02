import { FIELD } from "./domain-schema.mjs";
import { cleanText, normalizeYuc, yes } from "./domain-values.mjs";

export const ATTACHMENTS_SETTING = "Вложения в карточках";

export function attachmentsEnabledForYuc(rows = [], yuc = "") {
  const normalizedYuc = normalizeYuc(yuc);
  const row = (Array.isArray(rows) ? rows : []).find((item) => normalizeYuc(item?.[FIELD.yuc]) === normalizedYuc);
  return yes(row?.[ATTACHMENTS_SETTING]);
}

export function attachmentSettingsSummary(rows = []) {
  const configured = (Array.isArray(rows) ? rows : []).filter((row) => cleanText(row?.[FIELD.yuc]));
  return {
    enabled: configured.length > 0 && configured.every((row) => yes(row?.[ATTACHMENTS_SETTING])),
    configuredYucs: configured.length,
    enabledYucs: configured.filter((row) => yes(row?.[ATTACHMENTS_SETTING])).length,
  };
}
