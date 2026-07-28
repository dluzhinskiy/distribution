function cloneRow(row) {
  const copy = { ...row };
  if (row && Object.prototype.hasOwnProperty.call(row, "_recordId")) {
    Object.defineProperty(copy, "_recordId", {
      value: row._recordId,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  return copy;
}

export function createTableCache({ readFresh, tableKeys, bootstrapKeys, ttlByTable, defaultTtl, emptyKeys = [] }) {
  const cache = {
    tables: new Map(),
    loadedAt: new Map(),
    pending: new Map(),
    versions: new Map(),
  };
  const performance = {
    startedAt: new Date().toISOString(),
    tableReads: new Map(),
    recentReads: [],
  };

  function normalizeKeys(keys = bootstrapKeys) {
    const requested = Array.isArray(keys) ? keys : [keys];
    const unique = [...new Set(requested.filter(Boolean))];
    return unique.length ? unique : bootstrapKeys;
  }

  function ttl(key) {
    return ttlByTable[key] ?? defaultTtl;
  }

  function age(key) {
    const loadedAt = cache.loadedAt.get(key) || 0;
    return loadedAt ? Date.now() - loadedAt : Infinity;
  }

  function merge(data = {}) {
    const now = Date.now();
    for (const [key, rows] of Object.entries(data)) {
      cache.tables.set(key, Array.isArray(rows) ? rows.map(cloneRow) : rows);
      cache.loadedAt.set(key, now);
      cache.versions.set(key, (cache.versions.get(key) || 0) + 1);
    }
  }

  function recordRead(key, entry) {
    const item = { table: key, at: new Date().toISOString(), ...entry };
    performance.tableReads.set(key, item);
    performance.recentReads.unshift(item);
    performance.recentReads = performance.recentReads.slice(0, 80);
  }

  async function readFreshTable(key) {
    const started = Date.now();
    try {
      const data = await readFresh([key]);
      recordRead(key, {
        source: "MTS Tabs",
        durationMs: Date.now() - started,
        rows: Array.isArray(data[key]) ? data[key].length : 0,
        ok: true,
      });
      return data;
    } catch (error) {
      recordRead(key, {
        source: "MTS Tabs",
        durationMs: Date.now() - started,
        rows: 0,
        ok: false,
        error: error.message,
      });
      throw error;
    }
  }

  async function refresh(keys) {
    const requested = normalizeKeys(keys);
    const signature = requested.slice().sort().join(",");
    if (!cache.pending.has(signature)) {
      cache.pending.set(signature, Promise.all(requested.map(readFreshTable))
        .then((items) => {
          const data = Object.assign({}, ...items);
          merge(data);
          return data;
        })
        .finally(() => cache.pending.delete(signature)));
    }
    return cache.pending.get(signature);
  }

  async function read(keys = bootstrapKeys, options = {}) {
    const requested = normalizeKeys(keys);
    const stale = options.cacheOnly
      ? requested.filter((key) => !cache.tables.has(key))
      : options.force
      ? requested
      : requested.filter((key) => !cache.tables.has(key) || age(key) > ttl(key));
    if (stale.length) await refresh(stale);
    const data = Object.fromEntries(requested.map((key) => [
      key,
      Array.isArray(cache.tables.get(key)) ? cache.tables.get(key).map(cloneRow) : cache.tables.get(key),
    ]));
    for (const key of emptyKeys) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) data[key] = [];
    }
    return data;
  }

  function replace(key, rows) {
    if (!tableKeys.includes(key)) throw new Error(`Неизвестная таблица кэша: ${key}`);
    merge({ [key]: Array.isArray(rows) ? rows : [] });
  }

  function snapshot(keys = tableKeys) {
    const requested = Array.isArray(keys) ? keys : [keys];
    const data = {};
    for (const key of requested) {
      if (!cache.tables.has(key)) continue;
      const value = cache.tables.get(key);
      data[key] = Array.isArray(value) ? value.map(cloneRow) : value;
    }
    for (const key of emptyKeys) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) data[key] = [];
    }
    return data;
  }

  function invalidate(keys = tableKeys) {
    for (const key of normalizeKeys(keys)) cache.loadedAt.delete(key);
  }

  function versions(keys = tableKeys) {
    const requested = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(requested.map((key) => [key, cache.versions.get(key) || 0]));
  }

  function status() {
    return {
      enabled: true,
      cacheTtlMs: defaultTtl,
      cacheTtlByTableMs: Object.fromEntries(tableKeys.map((key) => [key, ttl(key)])),
      bootstrapTables: bootstrapKeys,
      lazyTables: tableKeys.filter((key) => !bootstrapKeys.includes(key)),
      cachedTables: Object.fromEntries(tableKeys.map((key) => {
        const currentAge = age(key);
        return [key, {
          loaded: cache.tables.has(key),
          ageMs: Number.isFinite(currentAge) ? currentAge : null,
          ttlMs: ttl(key),
          remainingMs: Number.isFinite(currentAge) ? Math.max(ttl(key) - currentAge, 0) : null,
          stale: !cache.tables.has(key) || currentAge > ttl(key),
          rows: Array.isArray(cache.tables.get(key)) ? cache.tables.get(key).length : 0,
          version: cache.versions.get(key) || 0,
        }];
      })),
      performance: {
        startedAt: performance.startedAt,
        lastReads: Object.fromEntries(tableKeys.map((key) => [key, performance.tableReads.get(key) ?? null])),
        recentReads: performance.recentReads,
      },
    };
  }

  return { read, replace, snapshot, versions, invalidate, status };
}
