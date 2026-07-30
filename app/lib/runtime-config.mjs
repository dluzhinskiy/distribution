function finiteNumber(value, fallback, { min = Number.NEGATIVE_INFINITY } = {}) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function enabled(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "да"].includes(String(value).trim().toLowerCase());
}

export function loadRuntimeConfig(env = process.env) {
  const render = Boolean(env.RENDER);
  return {
    host: env.HOST || (render ? "0.0.0.0" : "127.0.0.1"),
    port: finiteNumber(env.PORT, 8766, { min: 1 }),
    render,
    fileLogging: enabled(env.FILE_LOGGING, !render),
    cacheWarmupEnabled: enabled(env.FAST_ENGINE_CACHE_WARMUP, true),
    fullCasesWarmupEnabled: enabled(env.FAST_ENGINE_FULL_CASES_WARMUP, false),
    fullCasesWarmupDelayMs: finiteNumber(env.FAST_ENGINE_FULL_CASES_WARMUP_DELAY_MS, 3000, { min: 0 }),
    operationIdTtlMs: finiteNumber(env.OPERATION_ID_TTL_MS, 600_000, { min: 1 }),
    slowRequestLogMs: finiteNumber(env.SLOW_REQUEST_LOG_MS, 2_000, { min: 0 }),
    caseDocumentMaxBytes: finiteNumber(env.CASE_DOCUMENT_MAX_BYTES, 12_000_000, { min: 1 }),
    officePreviewMaxBytes: finiteNumber(env.OFFICE_PREVIEW_MAX_BYTES, 12_000_000, { min: 1 }),
    cacheTtl: {
      default: finiteNumber(env.FAST_ENGINE_CACHE_TTL_MS, 300_000, { min: 0 }),
      cases: finiteNumber(env.FAST_ENGINE_CASES_CACHE_TTL_MS, 600_000, { min: 0 }),
      employees: finiteNumber(env.FAST_ENGINE_EMPLOYEES_CACHE_TTL_MS, 300_000, { min: 0 }),
      vacations: finiteNumber(env.FAST_ENGINE_VACATIONS_CACHE_TTL_MS, 300_000, { min: 0 }),
      static: finiteNumber(env.FAST_ENGINE_STATIC_CACHE_TTL_MS, 600_000, { min: 0 }),
    },
  };
}
