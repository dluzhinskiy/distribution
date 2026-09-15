import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RESPONSIBLE_LINK, resolveResponsibleLink } from '../lib/responsible-link.mjs';

// Load environment before importing tabs-store, which reads it during initialization.
const args = process.argv.slice(2);
if (args.some(arg => !['--apply', '--help'].includes(arg))) {
  console.error('Допустимые параметры: --apply, --help');
  process.exit(1);
}
if (args.includes('--help')) {
  console.log('node app/scripts/tabs-fill-responsible-links.mjs [--apply]\nБез --apply: только проверка. С --apply: заполнить пустые связи.\nПеред записью отключите рассылку в Tabs; на время выполнения не меняйте ответственных.');
  process.exit(0);
}
const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envPath)) {
  if (typeof process.loadEnvFile !== 'function') throw new Error('Для загрузки .env требуется Node.js 20.12+ или 22+.');
  process.loadEnvFile(envPath);
}

function emptyLink(value) {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

try {
  const { readData, patchTableRows } = await import('../lib/tabs-store.mjs');
  const data = await readData(['cases', 'employees']);
  const planned = [];
  const skipped = [];
  let alreadyLinked = 0;
  for (const row of data.cases) {
    if (!emptyLink(row[RESPONSIBLE_LINK])) { alreadyLinked++; continue; }
    const reason = !row._recordId ? 'Нет recordId дела'
      : !String(row['Ответственный'] ?? '').trim() ? 'Нет ответственного'
      : !String(row['ЮЦ'] ?? '').trim() ? 'Нет ЮЦ' : '';
    if (reason) { skipped.push({ case_id: row.case_id, reason }); continue; }
    try {
      const link = resolveResponsibleLink(row, data.employees);
      planned.push({ row, link });
    } catch (error) {
      skipped.push({ case_id: row.case_id, reason: error.message });
    }
  }
  console.log(JSON.stringify({ mode: args.includes('--apply') ? 'apply' : 'preview', total: data.cases.length, alreadyLinked, planned: planned.length, skipped }, null, 2));
  console.table(planned.map(({ row, link }) => ({ case_id: row.case_id, responsible: row['Ответственный'], yuc: row['ЮЦ'], employeeRecordId: link[0] })));
  if (!args.includes('--apply')) {
    console.log('Записей не изменено. Для заполнения повторите команду с --apply.');
  } else if (planned.length) {
    // Re-read before writing: do not overwrite links or assignments changed during planning.
    const fresh = await readData(['cases', 'employees']);
    const current = new Map(fresh.cases.map(row => [row._recordId, row]));
    const updates = [];
    for (const item of planned) {
      const row = current.get(item.row._recordId);
      if (!row || !emptyLink(row[RESPONSIBLE_LINK]) || row['Ответственный'] !== item.row['Ответственный'] || row['ЮЦ'] !== item.row['ЮЦ']) {
        console.log(`Пропущено изменённое дело: ${item.row.case_id}`);
        continue;
      }
      try {
        const link = resolveResponsibleLink(row, fresh.employees);
        if (link[0] !== item.link[0]) { console.log(`Изменилось соответствие: ${row.case_id}`); continue; }
        row[RESPONSIBLE_LINK] = link;
        updates.push({ row, changedFields: [RESPONSIBLE_LINK] });
      } catch (error) { console.log(`Пропущено ${row.case_id}: ${error.message}`); }
    }
    let confirmedBatches = 0;
    for (let offset = 0; offset < updates.length; offset += 10) {
      const batch = updates.slice(offset, offset + 10);
      try { await patchTableRows('cases', batch); }
      catch (error) {
        console.error(`Остановлено. Успешных записей до текущего пакета: ${confirmedBatches}. Проверьте пакет: ${batch.map(item => item.row.case_id).join(', ')}`);
        throw error;
      }
      confirmedBatches += batch.length;
      console.log(`Записано: ${confirmedBatches}/${updates.length}`);
    }
    const verified = await readData(['cases']);
    const byId = new Map(verified.cases.map(row => [row._recordId, row]));
    const unconfirmed = updates.filter(({ row }) => JSON.stringify(byId.get(row._recordId)?.[RESPONSIBLE_LINK]) !== JSON.stringify(row[RESPONSIBLE_LINK]));
    console.log(`Подтверждено повторным чтением: ${updates.length - unconfirmed.length}/${updates.length}`);
    if (unconfirmed.length) {
      console.error('Требуют проверки:', unconfirmed.map(({ row }) => row.case_id).join(', '));
      process.exitCode = 1;
    }
    console.log('Почту вычисляет Tabs. После внешней записи приложение может показывать старый кэш до его обновления.');
  }
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
}
