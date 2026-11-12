import test from "node:test";
import assert from "node:assert/strict";
import { fetchTextWithRetry } from "../lib/fetch-retry.mjs";

test("повторяет запрос, если соединение оборвалось при чтении тела", async () => {
  let attempts = 0;
  const result = await fetchTextWithRetry("https://example.test/data", {}, {
    retries: 3,
    timeoutMs: 1_000,
    retryDelayMs: 0,
    sleep: async () => {},
    fetchImpl: async () => {
      attempts += 1;
      return {
        text: async () => {
          if (attempts === 1) throw new TypeError("terminated");
          return '{"ok":true}';
        },
      };
    },
  });

  assert.equal(attempts, 2);
  assert.equal(result.text, '{"ok":true}');
});

test("после исчерпания повторов возвращает последнюю сетевую ошибку", async () => {
  let attempts = 0;
  const failure = new TypeError("terminated");

  await assert.rejects(
    fetchTextWithRetry("https://example.test/data", {}, {
      retries: 3,
      timeoutMs: 1_000,
      retryDelayMs: 0,
      sleep: async () => {},
      fetchImpl: async () => {
        attempts += 1;
        return { text: async () => { throw failure; } };
      },
    }),
    (error) => error === failure,
  );

  assert.equal(attempts, 3);
});

test("не повторяет POST при неизвестном результате записи", async () => {
  let attempts = 0;
  await assert.rejects(
    fetchTextWithRetry("https://example.test/data", { method: "POST", body: "{}" }, {
      retries: 3,
      timeoutMs: 1_000,
      retryDelayMs: 0,
      sleep: async () => {},
      fetchImpl: async () => {
        attempts += 1;
        return { text: async () => { throw new TypeError("terminated"); } };
      },
    }),
    (error) => error.resultUnknown === true && error.method === "POST",
  );
  assert.equal(attempts, 1);
});

test("PATCH можно явно считать повторяемой адресной операцией", async () => {
  let attempts = 0;
  const result = await fetchTextWithRetry("https://example.test/data", { method: "PATCH" }, {
    retryable: true,
    retries: 2,
    timeoutMs: 1_000,
    retryDelayMs: 0,
    sleep: async () => {},
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("terminated");
      return { text: async () => "ok" };
    },
  });
  assert.equal(attempts, 2);
  assert.equal(result.text, "ok");
});
