function errorMessage(result) {
  return result.status === "rejected" ? (result.reason?.message || String(result.reason)) : "";
}

export function createCacheWarmup({ enabled = true, tableKeys = [], readData, readDirectories, now = Date.now }) {
  let pending = null;
  let state = {
    enabled,
    state: enabled ? "idle" : "disabled",
    tableKeys: [...tableKeys],
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    errors: [],
  };

  function status() {
    return { ...state, tableKeys: [...state.tableKeys], errors: [...state.errors] };
  }

  async function execute() {
    const started = now();
    state = {
      ...state,
      state: "running",
      startedAt: new Date(started).toISOString(),
      finishedAt: null,
      durationMs: null,
      errors: [],
    };
    const [tablesResult, directoriesResult] = await Promise.allSettled([
      readData(tableKeys),
      readDirectories(),
    ]);
    const errors = [
      ...(tablesResult.status === "rejected" ? [{ source: "tables", message: errorMessage(tablesResult) }] : []),
      ...(directoriesResult.status === "rejected" ? [{ source: "directories", message: errorMessage(directoriesResult) }] : []),
    ];
    const finished = now();
    state = {
      ...state,
      state: errors.length === 0 ? "ready" : errors.length === 2 ? "failed" : "partial",
      finishedAt: new Date(finished).toISOString(),
      durationMs: Math.max(0, finished - started),
      errors,
    };
    return status();
  }

  function run() {
    if (!enabled) return Promise.resolve(status());
    if (!pending) pending = execute().finally(() => { pending = null; });
    return pending;
  }

  return { run, status };
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

export function createDeferredWarmup({
  enabled = false,
  delayMs = 3000,
  run,
  delay = wait,
  now = Date.now,
  onComplete = () => {},
}) {
  let pending = null;
  let state = {
    enabled,
    state: enabled ? "idle" : "disabled",
    delayMs,
    scheduledAt: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    errors: [],
  };

  function status() {
    return { ...state, errors: [...state.errors] };
  }

  async function execute() {
    state = {
      ...state,
      state: "scheduled",
      scheduledAt: new Date(now()).toISOString(),
      errors: [],
    };
    await delay(delayMs);
    const started = now();
    state = {
      ...state,
      state: "running",
      startedAt: new Date(started).toISOString(),
      finishedAt: null,
      durationMs: null,
    };
    try {
      await run();
      const finished = now();
      state = {
        ...state,
        state: "ready",
        finishedAt: new Date(finished).toISOString(),
        durationMs: Math.max(0, finished - started),
      };
    } catch (error) {
      const finished = now();
      state = {
        ...state,
        state: "failed",
        finishedAt: new Date(finished).toISOString(),
        durationMs: Math.max(0, finished - started),
        errors: [{ source: "cases", message: error?.message || String(error) }],
      };
    }
    const result = status();
    onComplete(result);
    return result;
  }

  function schedule() {
    if (!enabled) return Promise.resolve(status());
    if (["scheduled", "running", "ready", "failed"].includes(state.state)) return pending ?? Promise.resolve(status());
    pending = execute();
    return pending;
  }

  return { schedule, status };
}
