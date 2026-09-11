const CASE_PATH_PREFIX = "/case/";

export function caseIdFromPathname(pathname = "") {
  const match = /^\/case\/([^/]+)\/?$/.exec(String(pathname));
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return "";
  }
}

export function caseDeepLinkPath(caseId) {
  const normalized = String(caseId ?? "").trim();
  return normalized ? `${CASE_PATH_PREFIX}${encodeURIComponent(normalized)}` : "";
}

export function isCaseDeepLinkPath(pathname = "") {
  return Boolean(caseIdFromPathname(pathname));
}
