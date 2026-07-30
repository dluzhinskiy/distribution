function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Повторяет весь HTTP-запрос, включая чтение тела ответа.
 *
 * Node fetch (Undici) может вернуть заголовки, а затем выбросить
 * `TypeError: terminated` во время response.text(). Поэтому чтение тела должно
 * оставаться внутри того же цикла повторов и общего таймаута.
 */
export async function fetchTextWithRetry(url, options = {}, config = {}) {
  const retries = positiveInteger(config.retries, 3);
  const timeoutMs = positiveInteger(config.timeoutMs, 30_000);
  const retryDelayMs = Math.max(0, Number(config.retryDelayMs ?? 600) || 0);
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const sleep = config.sleep ?? wait;
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        ...options,
        signal: controller.signal,
      });
      const text = await response.text();
      return { response, text };
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await sleep(retryDelayMs * attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error("HTTP-запрос завершился сетевой ошибкой.");
}
