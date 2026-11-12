import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveResponsibleLink } from '../lib/responsible-link.mjs';

const employees = [
  { ФИО: 'Иванов Иван Иванович', ЮЦ: 'КЦ', _recordId: 'recOne' },
  { ФИО: 'Иванов Илья Иванович', ЮЦ: 'КЦ', _recordId: 'recTwo' },
  { ФИО: 'Иванов Иван Иванович', ЮЦ: 'Дальний Восток', _recordId: 'recOther' },
];
test('exact full name and YUC identify the record, not initials or another YUC', () => {
  assert.deepEqual(resolveResponsibleLink({ Ответственный: 'Иванов Иван Иванович', ЮЦ: 'КЦ' }, employees), ['recOne']);
});
test('ambiguous initials and unknown employee stop the write', () => {
  for (const name of ['Иванов И.И.', 'Петров П.П.']) {
    assert.throws(() => resolveResponsibleLink({ Ответственный: name, ЮЦ: 'КЦ' }, employees), { code: 'RESPONSIBLE_LINK_UNRESOLVED' });
  }
});
test('unassignment clears link; a unique abbreviated name resolves', () => {
  assert.deepEqual(resolveResponsibleLink({ Ответственный: '' }, []), []);
  assert.deepEqual(resolveResponsibleLink({ Ответственный: 'Иванов И.И.', ЮЦ: 'Дальний Восток' }, employees), ['recOther']);
});

test('Tabs create and reassignment send an array and do not write lookup email', async () => {
  process.env.TABS_API_TOKEN = 'test-only';
  const previousFetch = globalThis.fetch;
  const writes = [];
  globalThis.fetch = async (_url, options = {}) => {
    if (!options.method || options.method === 'GET') {
      return new Response(JSON.stringify({ success: true, data: { total: 1, records: [{ recordId: 'recOne', fields: { ФИО: 'Иванов Иван Иванович', ЮЦ: 'КЦ', employee_id: 'EMP-001' } }] } }));
    }
    writes.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ success: true, data: { records: [] } }));
  };
  try {
    const { createTableRows, patchTableRows } = await import('../lib/tabs-store.mjs');
    const row = { case_id: 'CASE-TEST', Ответственный: 'Иванов Иван Иванович', ЮЦ: 'КЦ', 'e-mail': 'ignored@example.org' };
    await createTableRows('cases', [row]);
    assert.deepEqual(writes[0].records[0].fields.ОтветственныйУЗ, ['recOne']);
    assert.equal('e-mail' in writes[0].records[0].fields, false);
    row._recordId = 'recCase';
    row.Ответственный = '';
    await patchTableRows('cases', [{ row, changedFields: ['Ответственный'] }]);
    assert.deepEqual(writes[1].records[0].fields, { Ответственный: '', ОтветственныйУЗ: [] });
    await patchTableRows('cases', [{ row, changedFields: ['Статус'] }]);
    assert.equal('ОтветственныйУЗ' in writes[2].records[0].fields, false);
  } finally { globalThis.fetch = previousFetch; }
});
