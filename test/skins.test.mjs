import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { defaultSkin, getSkin, skins, workloadSkinIcon } from "../public/skins/catalog.js";

test("appearance menu offers existing themes and the separate gray skin", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/skins.css", import.meta.url), "utf8");
  const tokens = await readFile(new URL("../public/skins/tokens.css", import.meta.url), "utf8");
  for (const skin of ["blue", "red", "gray", "gray-dark"]) assert.equal(getSkin(skin).id, skin);
  assert.equal(getSkin("constructor").id, defaultSkin);
  assert.equal(getSkin(skins.gray.alternate).alternate, "gray");
  assert.match(html, /href="\/skins\/tokens\.css"/);
  assert.match(html, /href="\/skins\.css"/);
  assert.match(app, /mts-load-distribution-theme/);
  assert.match(app, /getSkin\(localStorage\.getItem\(themeStorageKey\)\)/);
  assert.match(app, /localStorage\.setItem\(themeStorageKey, theme\)/);
  assert.match(css, /body\.theme-apple\.theme-gray/);
  assert.match(html, /skin-icon-dashboard/);
  assert.match(app, /skin-metric-icon/);
  assert.match(css, /\.skin-nav-icon, \.skin-metric-icon \{ display: none/);
  for (const type of ["claim", "conclusion", "admin", "court"]) {
    assert.match(css, new RegExp(`\\.load-type-${type}`));
    assert.match(css, new RegExp(`\\.historical-segment\\.${type}`));
  }
  assert.match(css, /\.historical-segment\.weighted/);
  assert.match(tokens, /--font: Arial/);
  assert.match(css, /\.historical-preset\.active/);
  assert.match(css, /\.nav-link\.hidden \{ display: none/);
  assert.match(css, /theme-gray \.historical-chart\s*\{/);
  assert.match(css, /theme-gray \.historical-segment\s*\{[\s\S]*?height:\s*32px/);
  assert.match(css, /theme-gray select\s*\{/);
  assert.match(css, /theme-gray \.historical-custom-period\.is-locked/);
  assert.match(css, /theme-gray \.workload-table\s*\{/);
  assert.match(css, /theme-gray input\[type="checkbox"\]:checked \+ \.switch-ui::after\s*\{[\s\S]*?content:\s*"✓"/);
  assert.match(css, /theme-gray \.case-column-toggle input:checked \+ \.switch-ui::after/);
  assert.match(css, /theme-gray input\[type="checkbox"\]:focus-visible \+ \.switch-ui/);
  assert.match(css, /#workloadCardBadge\[data-mode="weighted"\]::before/);
  assert.match(app, /currentToggle\?\.setAttribute\("aria-pressed"/);
  assert.match(html, /id="toggleCurrentDashboard"/);
  assert.match(css, /\.status-pill\.status-error/);
  assert.match(tokens, /--gray-vacation-icon:/);
  assert.match(css, /\.day-cell\.vacation::before/);
  assert.match(css, /\.vacation-legend-swatch\.is-vacation-non-working::before/);
  assert.match(css, /theme-gray \.quick-filter-chip\s*\{[\s\S]*?border-radius:\s*var\(--skin-radius-/);
  assert.match(css, /theme-gray-dark \.quick-filter-chip button/);
  assert.match(css, /\.edit-toggle:not\(\.plain-toggle\)/);
  assert.match(css, /\.plain-toggle input\[type="checkbox"\]\s*\{[\s\S]*?opacity:\s*1/);
  assert.match(css, /theme-gray \.plain-toggle input\[type="checkbox"\]:checked/);
  assert.match(css, /theme-gray-dark \.plain-toggle input\[type="checkbox"\]:checked/);
  assert.match(app, /function deleteIcon\(\)/);
  assert.doesNotMatch(app, /🗑/);
  assert.match(css, /theme-gray-dark :is\(\.open-delete-case/);
  assert.match(css, /theme-gray \.case-document-dropzone/);
  assert.match(css, /theme-gray-dark \.case-document-dropzone/);
  assert.match(css, /\.case-document-dropzone\.is-dragging/);
  assert.match(html, /id="skinDayNight"/);
  assert.match(html, /<\/nav>\s*<section class="table-operation-progress hidden"[\s\S]*?<div class="sidebar-bottom">/);
  assert.match(css, /theme-gray-dark/);
  assert.match(css, /theme-gray \.auth-gate/);
  assert.match(css, /theme-gray-dark \.auth-card/);
  assert.match(app, /applyTheme\(currentSkin\(\)\.alternate\)/);
});

test("component styles and pictograms resolve to the central skin catalog", async () => {
  const read = (name) => readFile(new URL(`../public/${name}`, import.meta.url), "utf8");
  const [html, app, base, overrides, tokens, icons] = await Promise.all(
    ["index.html", "app.js", "styles.css", "skins.css", "skins/tokens.css", "skins/icons.svg"].map(read),
  );
  const components = base + overrides;
  const definedTokens = new Set([...tokens.matchAll(/(--skin-[\w-]+):/g)].map((match) => match[1]));
  for (const [, name] of components.matchAll(/var\((--skin-[\w-]+)/g)) assert.ok(definedTokens.has(name), name);
  assert.doesNotMatch(components.replace(/\/\*[\s\S]*?\*\//g, ""), /#[a-f\d]{3,8}\b|\brgba?\(/i);
  const ids = new Set([...icons.matchAll(/<symbol id="(skin-icon-[\w-]+)"/g)].map((match) => match[1]));
  for (const [, id] of (html + app).matchAll(/\/skins\/icons\.svg#(skin-icon-[\w-]+)"/g)) assert.ok(ids.has(id), id);
  for (const type of ["судебное", "административное", "претензия", "заключение", "уголовное", "банкротное"]) assert.ok(ids.has(`skin-icon-${workloadSkinIcon(type)}`));
  assert.equal([...html.matchAll(/icons\.svg#skin-icon-refresh/g)].length, 2);
  assert.match(app, /save-action-icon[^\n]+icons\.svg#skin-icon-save/);
});
