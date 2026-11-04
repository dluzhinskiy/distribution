import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssUrl = new URL("../public/styles.css", import.meta.url);
const appUrl = new URL("../public/app.js", import.meta.url);

test("календарь обозначает нерабочий день звездочкой, а отпуск синим", async () => {
  const css = await readFile(cssUrl, "utf8");

  assert.match(css, /\.day-cell\.non-working::after\s*\{[\s\S]*content:\s*"★"/);
  assert.match(css, /\.day-cell\.vacation-working\s*\{[\s\S]*background:\s*var\(--vacation-day-bg\)/);
  assert.match(css, /\.day-cell\.vacation-non-working\s*\{[\s\S]*background:\s*var\(--vacation-day-bg\)/);
  assert.match(css, /body\.theme-apple\.theme-red\s*\{[\s\S]*--non-working-star:\s*#f59e0b/);
});

test("легенда объясняет новые обозначения календаря", async () => {
  const app = await readFile(appUrl, "utf8");

  assert.match(app, /Рабочий день — без отметки/);
  assert.match(app, /Нерабочий день — звёздочка/);
  assert.match(app, />Отпуск<\/span>/);
  assert.match(app, /Отпуск в нерабочий день/);
});
