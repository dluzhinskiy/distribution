const READ_ONLY_POST_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/recommend",
  "/api/cases/import-preview",
  "/api/vacations/import-preview",
]);

export function isMutationRequest(method = "GET", pathname = "") {
  const normalizedMethod = String(method).toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(normalizedMethod)) return false;
  if (normalizedMethod === "POST" && READ_ONLY_POST_PATHS.has(String(pathname))) return false;
  return true;
}

export function createWriteCoordinator({ beforeWrite = async () => {} } = {}) {
  let tail = Promise.resolve();
  let active = 0;
  let queued = 0;

  async function run(operation, context = {}) {
    queued += 1;
    const previous = tail.catch(() => {});
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    queued -= 1;
    active += 1;
    try {
      await beforeWrite(context);
      return await operation();
    } finally {
      active -= 1;
      release();
    }
  }

  function status() {
    return { active, queued };
  }

  return { run, status };
}
