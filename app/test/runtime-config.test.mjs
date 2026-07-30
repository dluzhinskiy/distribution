import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntimeConfig } from "../lib/runtime-config.mjs";

test("local runtime binds only to loopback and allows file logs", () => {
  const config = loadRuntimeConfig({});
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8766);
  assert.equal(config.fileLogging, true);
  assert.equal(config.cacheWarmupEnabled, true);
  assert.equal(config.fullCasesWarmupEnabled, false);
  assert.equal(config.fullCasesWarmupDelayMs, 3000);
  assert.equal(config.cacheTtl.cases, 120_000);
});

test("Render runtime is stateless and listens on the platform interface", () => {
  const config = loadRuntimeConfig({ RENDER: "true", PORT: "10000" });
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 10000);
  assert.equal(config.fileLogging, false);
});

test("invalid numeric settings fall back to safe defaults", () => {
  const config = loadRuntimeConfig({ PORT: "invalid", CASE_DOCUMENT_MAX_BYTES: "-1" });
  assert.equal(config.port, 8766);
  assert.equal(config.caseDocumentMaxBytes, 12_000_000);
});

test("cache warmup can be disabled from environment", () => {
  assert.equal(loadRuntimeConfig({ FAST_ENGINE_CACHE_WARMUP: "0" }).cacheWarmupEnabled, false);
});

test("deferred full-case warmup is configured independently", () => {
  const config = loadRuntimeConfig({
    FAST_ENGINE_FULL_CASES_WARMUP: "1",
    FAST_ENGINE_FULL_CASES_WARMUP_DELAY_MS: "4500",
    FAST_ENGINE_CASES_CACHE_TTL_MS: "180000",
  });
  assert.equal(config.fullCasesWarmupEnabled, true);
  assert.equal(config.fullCasesWarmupDelayMs, 4500);
  assert.equal(config.cacheTtl.cases, 180_000);
});
