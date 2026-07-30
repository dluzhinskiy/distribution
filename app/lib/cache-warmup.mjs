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
