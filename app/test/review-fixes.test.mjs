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
test('all attachment endpoints are disabled before storage access', async () => {
  const handler = createCaseRoutes({ sendJson: (_res, status, payload) => {
    assert.equal(status, 410);
    assert.equal(payload.code, 'ATTACHMENTS_DISABLED');
  } });
  for (const [method, suffix] of [['POST',''],['DELETE',''],['GET','/id/preview'],['GET','/id/download'],['GET','/id/office-preview']]) {
    assert.equal(await handler({method}, {}, new URL('http://localhost/api/cases/CASE-1/documents'+suffix), {}), true);
  }
});
