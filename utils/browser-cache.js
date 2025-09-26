const DEFAULT_RAF = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
  ? window.requestAnimationFrame.bind(window)
  : (fn) => setTimeout(fn, 16);

/**
 * Creates a lightweight in-memory cache for browser requests with TTL support.
 * The cache deduplicates concurrent lookups and evicts the least recently used entries.
 * @param {object} [options]
 * @param {number} [options.ttl=30000] Default time-to-live in milliseconds.
 * @param {number} [options.maxEntries=64] Maximum number of cached entries.
 */
export function createRequestCache({ ttl = 30000, maxEntries = 64 } = {}) {
  const store = new Map();
  const order = new Map();

  const now = () => Date.now();

  const touch = (key) => {
    if (!store.has(key)) return;
    order.delete(key);
    order.set(key, true);
    while (order.size > maxEntries) {
      const oldest = order.keys().next().value;
      order.delete(oldest);
      store.delete(oldest);
    }
  };

  const isExpired = (entry) => entry && entry.expiresAt !== Infinity && entry.expiresAt <= now();

  const resolveTtl = (customTtl) => {
    if (Number.isFinite(customTtl) && customTtl > 0) return customTtl;
    if (customTtl === 0) return 0;
    return ttl;
  };

  const setValue = (key, value, customTtl) => {
    const ttlMs = resolveTtl(customTtl);
    const expiresAt = ttlMs > 0 ? now() + ttlMs : Infinity;
    store.set(key, { value, expiresAt });
    touch(key);
    return value;
  };

  const getValue = (key) => {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (isExpired(entry)) {
      store.delete(key);
      order.delete(key);
      return undefined;
    }
    if ('value' in entry) {
      touch(key);
      return entry.value;
    }
    if (entry.promise) {
      return undefined;
    }
    return undefined;
  };

  const resolveValue = async (key, loader, customTtl) => {
    const existing = store.get(key);
    const ttlMs = resolveTtl(customTtl);

    if (existing) {
      if (isExpired(existing)) {
        store.delete(key);
        order.delete(key);
      } else if ('value' in existing) {
        touch(key);
        return existing.value;
      } else if (existing.promise) {
        return existing.promise;
      }
    }

    if (ttlMs === 0) {
      return loader();
    }

    const promise = (async () => {
      try {
        const result = await loader();
        setValue(key, result, customTtl);
        return result;
      } catch (error) {
        store.delete(key);
        order.delete(key);
        throw error;
      }
    })();

    store.set(key, { promise, expiresAt: now() + ttlMs });
    touch(key);
    return promise;
  };

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
    /** Clears the cache. */
    clear() {
      store.clear();
      order.clear();
    },
    /** Removes a single cache entry. */
    delete(key) {
      store.delete(key);
      order.delete(key);
    },
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
