export function distributionFeedback(draft, regional) {
  if (!draft["ЮЦ"]) return { label: "ожидает ЮЦ", reason: "Выберите юридический центр." };
  if (!draft["Тип дела"]) return { label: "ожидает типа", reason: "Выберите тип дела, чтобы рассчитать очередь назначения." };
  if (regional && !draft["Регион"]) return { label: "ожидает региона", reason: "Выберите регион, чтобы рассчитать региональную очередь." };
  return { ready: true, label: "расчёт очереди", reason: "Рассчитываем следующего ответственного…" };
}

export function distributionRuleChip(basis) {
  const text = String(basis ?? "").toLowerCase();
  if (text.includes("повтор допускается")) return { text: "повтор разрешён регионом", kind: "orange" };
  if (text.includes("не два подряд") && text.includes("не применяется")) return { text: "не два подряд не применяется", kind: "orange" };
  return { text: "не два подряд", kind: "red" };
}
