import { AppError } from "./errors.mjs";

export function createOperationGuard({ ttlMs = 600_000, now = Date.now } = {}) {
  const operations = new Map();

  function cleanup() {
    const cutoff = now() - ttlMs;
    for (const [id, entry] of operations) {
      if (entry.finishedAt && entry.finishedAt < cutoff) operations.delete(id);
    }
  }

  async function run(operationId, operation) {
    const id = String(operationId ?? "").trim();
    if (!id) return operation();
    cleanup();
    const existing = operations.get(id);
    if (existing) {
      throw new AppError(
        existing.finishedAt
          ? "Эта операция уже была обработана. Обновите данные перед повторным действием."
          : "Эта операция уже выполняется. Дождитесь результата и обновите данные.",
        409,
        "DUPLICATE_OPERATION",
        { operationId: id, state: existing.finishedAt ? "completed" : "running" },
      );
    }
    const entry = { startedAt: now(), finishedAt: null };
    operations.set(id, entry);
    try {
      return await operation();
    } finally {
      entry.finishedAt = now();
    }
  }

  return { run };
}
