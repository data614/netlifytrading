/**
 * Lightweight in-memory cache for serverless functions.
 * Entries are stored in-process and cleared when the function container is recycled.
 * Provides TTL support, basic LRU eviction, and request coalescing via shared promises.
 */
export function createCache({ ttl = 60_000, maxEntries = 256 } = {}) {
  const store = new Map();
  const order = new Map();

  const now = () => Date.now();

  const touch = (key) => {
    if (!store.has(key)) return;
    order.delete(key);
    order.set(key, true);
    if (order.size <= maxEntries) return;
    const oldest = order.keys().next().value;
    if (oldest !== undefined) {
      order.delete(oldest);
      store.delete(oldest);
    }
  };

  const pruneIfExpired = (key, entry) => {
    if (!entry) return true;
    if (entry.expiresAt !== Infinity && entry.expiresAt <= now()) {
      store.delete(key);
      order.delete(key);
      return true;
    }
    return false;
  };

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
    if (pruneIfExpired(key, entry)) return undefined;
    if ('value' in entry) {
      touch(key);
      return entry.value;
    }
    if (entry.promise) return undefined;
    return undefined;
  };

  const resolveValue = async (key, loader, customTtl) => {
    const existing = store.get(key);
    const ttlMs = resolveTtl(customTtl);

    if (existing && !pruneIfExpired(key, existing)) {
      if ('value' in existing) {
        touch(key);
        return existing.value;
      }
      if (existing.promise) {
        return existing.promise;
      }
    }

    if (ttlMs === 0) {
      return loader();
    }

    const pending = (async () => {
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

    store.set(key, { promise: pending, expiresAt: now() + ttlMs });
    touch(key);
    return pending;
  };

  return {
    get: getValue,
    set: setValue,
    resolve: resolveValue,
    delete(key) {
      store.delete(key);
      order.delete(key);
    },
    clear() {
      store.clear();
      order.clear();
    },
    size() {
      return store.size;
    },
  };
}
