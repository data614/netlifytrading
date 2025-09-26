const DEFAULT_RAF = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
  ? window.requestAnimationFrame.bind(window)
  : (fn) => setTimeout(fn, 16);

const DEFAULT_NOW = () => Date.now();
const NOOP = () => {};

const safeInvoke = (handler, payload) => {
  if (typeof handler !== 'function') return;
  try {
    handler(payload);
  } catch (error) {
    console.error('request cache onEvict handler failed', error);
  }
};

/**
 * Creates a lightweight in-memory cache for browser requests with TTL support and
 * optional eviction diagnostics.
 * The cache deduplicates concurrent lookups, exposes runtime statistics and
 * evicts the least recently used entries.
 * @param {object} [options]
 * @param {number} [options.ttl=30000] Default time-to-live in milliseconds.
 * @param {number} [options.maxEntries=64] Maximum number of cached entries.
 * @param {(details: { key: string, reason: string, value: *, hasValue: boolean, pending: boolean, expiresAt: number|undefined }) => void} [options.onEvict]
 *   Optional callback invoked when entries leave the cache.
 * @param {() => number} [options.now] Custom clock used for TTL computations, mainly for testing.
 */
export function createRequestCache({ ttl = 30000, maxEntries = 64, onEvict = NOOP, now: nowProvider } = {}) {
  const store = new Map();
  const order = new Map();
  const now = typeof nowProvider === 'function' ? () => nowProvider() : DEFAULT_NOW;
  const evictCallback = typeof onEvict === 'function' ? onEvict : NOOP;

  const stats = {
    hits: 0,
    misses: 0,
    loads: 0,
    revalidations: 0,
    evictions: 0,
    stale: 0,
    errors: 0,
  };

  const resolveTtl = (customTtl) => {
    if (Number.isFinite(customTtl) && customTtl > 0) return customTtl;
    if (customTtl === 0) return 0;
    if (customTtl === Infinity) return Infinity;
    return ttl;
  };

  const computeExpiry = (ttlMs) => {
    if (ttlMs === Infinity) return Infinity;
    if (ttlMs > 0) return now() + ttlMs;
    return Infinity;
  };

  const isExpired = (entry) => Boolean(entry && entry.expiresAt !== Infinity && entry.expiresAt <= now());

  const evictEntry = (key, reason) => {
    if (!store.has(key)) return false;
    const entry = store.get(key);
    store.delete(key);
    order.delete(key);
    stats.evictions += 1;
    safeInvoke(evictCallback, {
      key,
      reason,
      value: entry && 'value' in entry ? entry.value : undefined,
      hasValue: Boolean(entry && 'value' in entry),
      pending: Boolean(entry && entry.promise),
      expiresAt: entry ? entry.expiresAt : undefined,
    });
    return true;
  };

  const touch = (key) => {
    if (!store.has(key)) return;
    order.delete(key);
    order.set(key, true);
    while (order.size > maxEntries) {
      const oldest = order.keys().next().value;
      evictEntry(oldest, 'capacity');
    }
  };

  const setValue = (key, value, customTtl) => {
    const ttlMs = resolveTtl(customTtl);
    const expiresAt = computeExpiry(ttlMs);
    store.set(key, { value, expiresAt });
    touch(key);
    return value;
  };

  const getValue = (key) => {
    const entry = store.get(key);
    if (!entry) {
      stats.misses += 1;
      return undefined;
    }
    if (isExpired(entry)) {
      stats.stale += 1;
      stats.misses += 1;
      evictEntry(key, 'expired');
      return undefined;
    }
    if ('value' in entry) {
      stats.hits += 1;
      touch(key);
      return entry.value;
    }
    stats.revalidations += 1;
    return undefined;
  };

  const resolveValue = async (key, loader, customTtl) => {
    const existing = store.get(key);
    const ttlMs = resolveTtl(customTtl);

    if (existing) {
      if (isExpired(existing)) {
        stats.stale += 1;
        stats.misses += 1;
        evictEntry(key, 'expired');
      } else if ('value' in existing) {
        stats.hits += 1;
        touch(key);
        return existing.value;
      } else if (existing.promise) {
        stats.revalidations += 1;
        return existing.promise;
      }
    } else {
      stats.misses += 1;
    }

    if (ttlMs === 0) {
      stats.loads += 1;
      try {
        return await loader();
      } catch (error) {
        stats.errors += 1;
        throw error;
      }
    }

    stats.loads += 1;

    const promise = (async () => {
      try {
        const result = await loader();
        setValue(key, result, customTtl);
        return result;
      } catch (error) {
        stats.errors += 1;
        store.delete(key);
        order.delete(key);
        throw error;
      }
    })();

    store.set(key, { promise, expiresAt: computeExpiry(ttlMs) });
    touch(key);
    return promise;
  };

  const statsSnapshot = () => ({
    hits: stats.hits,
    misses: stats.misses,
    loads: stats.loads,
    revalidations: stats.revalidations,
    evictions: stats.evictions,
    stale: stats.stale,
    errors: stats.errors,
    size: store.size,
  });

  return {
    /**
     * Returns the cached value if present and not expired.
     * @param {string} key
     */
    get: getValue,
    /**
     * Stores a value with an optional custom TTL.
     * @param {string} key
     * @param {*} value
     * @param {number} [customTtl]
     */
    set: setValue,
    /**
     * Resolves a value, using the loader when missing, with optional TTL override.
     * @param {string} key
     * @param {() => Promise<*>} loader
     * @param {number} [customTtl]
     */
    resolve: resolveValue,
    /** Clears the cache, issuing eviction callbacks for each entry. */
    clear() {
      const keys = Array.from(store.keys());
      keys.forEach((key) => {
        evictEntry(key, 'clear');
      });
    },
    /** Removes a single cache entry. */
    delete(key) {
      evictEntry(key, 'manual');
    },
    /** Removes all expired entries proactively. */
    prune() {
      const keys = Array.from(order.keys());
      keys.forEach((key) => {
        const entry = store.get(key);
        if (entry && isExpired(entry)) {
          stats.stale += 1;
          evictEntry(key, 'expired');
        }
      });
    },
    /** Returns a snapshot of cache statistics. */
    stats: statsSnapshot,
  };
}

/**
 * Creates a render queue that batches DOM updates onto animation frames.
 * The queue de-duplicates scheduled callbacks and guarantees execution order.
 */
export function createRenderQueue() {
  const tasks = new Set();
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    const pending = Array.from(tasks);
    tasks.clear();
    pending.forEach((task) => {
      try {
        task();
      } catch (error) {
        console.error('render task failed', error);
      }
    });
  };

  return (task) => {
    if (typeof task !== 'function') return;
    tasks.add(task);
    if (!scheduled) {
      scheduled = true;
      DEFAULT_RAF(flush);
    }
  };
}
