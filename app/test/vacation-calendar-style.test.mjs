import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssUrl = new URL("../public/styles.css", import.meta.url);
const appUrl = new URL("../public/app.js", import.meta.url);

test("календарь обозначает нерабочий день звездочкой, а отпуск цветом темы", async () => {
  const css = await readFile(cssUrl, "utf8");

  assert.match(css, /\.day-cell\.non-working::after\s*\{[\s\S]*content:\s*"★"/);
  assert.match(css, /\.day-cell\.vacation-working\s*\{[\s\S]*background:\s*var\(--vacation-day-bg\)/);
  assert.match(css, /\.day-cell\.vacation-non-working\s*\{[\s\S]*background:\s*var\(--vacation-day-bg\)/);
  assert.match(css, /body\.theme-apple\s*\{[\s\S]*--vacation-day-bg:\s*#2f80ed/);
  assert.match(css, /body\.theme-apple\.theme-red\s*\{[\s\S]*--vacation-day-bg:\s*linear-gradient\(135deg, #ff6670, #e30611\)/);
  assert.match(css, /body\.theme-apple\.theme-red\s*\{[\s\S]*--non-working-star:\s*#f59e0b/);
});

test("легенда объясняет новые обозначения календаря", async () => {
  const app = await readFile(appUrl, "utf8");

  assert.match(app, /Рабочий день — без отметки/);
  assert.match(app, /Нерабочий день — звёздочка/);
  assert.match(app, />Отпуск<\/span>/);
  assert.match(app, /Отпуск в нерабочий день/);
});

test("предупреждение перед отпуском компактно расположено внизу карточки", async () => {
  const [app, css] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(app, />Пропустить<\/button>/);
  assert.doesNotMatch(app, />Пропустить назначение<\/button>/);
  assert.match(app, /отпуск через \$\{formatDayCount\(vacation\.daysUntil\)\} на \$\{formatDayCount\(duration\)\}/);
  assert.match(css, /\.queue-upcoming-vacation-note\s*\{[\s\S]*grid-column:\s*1 \/ -1;[\s\S]*white-space:\s*nowrap;/);
  assert.match(css, /\.queue-preview-action\s*\{[\s\S]*align-self:\s*start;/);
});
