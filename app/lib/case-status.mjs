import { todayISO } from './domain-values.mjs';

export function applyCaseStatusPatch(row, patch, date = new Date()) {
  if (row.Статус === 'Удалено') throw Object.assign(new Error('Сначала восстановите дело.'), { status: 409 });
  const next = { ...patch };
  if (Object.hasOwn(next, 'Статус')) {
    next.Статус = String(next.Статус).trim();
    if (!['В работе', 'Приостановлено', 'Завершено', 'Отменено', 'Ожидает распределения'].includes(next.Статус))
      throw Object.assign(new Error('Недопустимый статус.'), { status: 400 });
    next['Дата завершения'] = ['Завершено', 'Отменено'].includes(next.Статус)
      ? (next['Дата завершения'] || row['Дата завершения'] || todayISO(date)) : '';
  }
  Object.assign(row, next);
  return Object.keys(next);
}
