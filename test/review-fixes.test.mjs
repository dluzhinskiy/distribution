import test from 'node:test';
import assert from 'node:assert/strict';
import { canEditCase } from '../lib/access-policy.mjs';
import { applyCaseStatusPatch } from '../lib/case-status.mjs';
import { createCaseRoutes } from '../routes/case-routes.mjs';

test('linked ownership takes precedence; ambiguous legacy names cannot grant access', () => {
  const employees = [
    { employee_id:'E1', _recordId:'rec1', ФИО:'Иванов Иван Иванович', ЮЦ:'КЦ' },
    { employee_id:'E2', _recordId:'rec2', ФИО:'Иванов Илья Иванович', ЮЦ:'КЦ' },
  ];
  const user = { employeeId:'E2', role:'Сотрудник', yuc:'КЦ' };
  const row = { Ответственный:'Иванов И.И.', ЮЦ:'КЦ' };
  assert.equal(canEditCase(user, employees[1], row, employees), false);
  row.ОтветственныйУЗ = ['rec1'];
  assert.equal(canEditCase(user, employees[1], row, employees), false);
  row.ОтветственныйУЗ = ['rec2'];
  assert.equal(canEditCase(user, employees[1], row, employees), true);
});
test('status changes set and clear completion date and reject deleted cases', () => {
  const row = { Статус:'В работе' };
  applyCaseStatusPatch(row, { Статус:'Завершено' }, new Date(2026, 8, 14));
  assert.equal(row['Дата завершения'], '2026-09-14');
  applyCaseStatusPatch(row, { Статус:'В работе' });
  assert.equal(row['Дата завершения'], '');
  assert.throws(() => applyCaseStatusPatch({ Статус:'Удалено' }, { Статус:'В работе' }), { status:409 });
});
test('disabled attachment endpoints stop before binary storage access', async () => {
  let binaryReads = 0;
  const data = {
    cases: [{ case_id:'CASE-1', ЮЦ:'КЦ', Документы:[{ id:'id', token:'secret' }] }],
    employees: [],
    yucSettings: [{ ЮЦ:'КЦ', 'Вложения в карточках':'Нет' }],
  };
  const handler = createCaseRoutes({
    auth: { isManager: () => true },
    readBody: async () => ({ documentIds:['id'] }),
    readBinaryBody: async () => { binaryReads += 1; return Buffer.alloc(0); },
    readData: async (keys) => Object.fromEntries(keys.map((key) => [key, data[key] ?? []])),
    sendJson: () => {},
  });
  for (const [method, suffix] of [['POST',''],['DELETE',''],['GET','/id/preview'],['GET','/id/download'],['GET','/id/office-preview']]) {
    await assert.rejects(
      handler({method, headers:{}}, {}, new URL('http://localhost/api/cases/CASE-1/documents'+suffix), {}),
      (error) => error.status === 410 && error.code === 'ATTACHMENTS_DISABLED',
    );
  }
  assert.equal(binaryReads, 0);
});
