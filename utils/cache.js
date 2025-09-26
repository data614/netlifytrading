/**
 * A small utility to provide reusable in-memory caching for expensive async operations.
 * The cache is aware of expiry (time-to-live) and deduplicates concurrent requests for
 * the same key while the loader is still in flight.
 */
export function createAsyncCache({ ttlMs = 0, maxSize = Infinity } = {}) {
  if (ttlMs < 0) {
    throw new Error('ttlMs must be a positive number.');
  }

  if (maxSize === Infinity) {
    // unlimited size
  } else if (!Number.isFinite(maxSize) || maxSize <= 0) {
    throw new Error('maxSize must be a finite positive number or Infinity.');
  }

  const store = new Map();

  const computeExpiry = () => (ttlMs > 0 ? Date.now() + ttlMs : Infinity);

  const enforceMaxSize = () => {
    while (store.size > maxSize) {
      const oldestKey = store.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      store.delete(oldestKey);
    }
  };

  const isExpired = (entry) => ttlMs > 0 && entry.expiresAt <= Date.now();

  const load = (key, loader) => {
    const inFlight = (async () => {
      try {
        const value = await loader();
        const nextEntry = {
          value,
          expiresAt: computeExpiry(),
          inFlight: null,
        };
        store.set(key, nextEntry);
        enforceMaxSize();
        return value;
      } catch (error) {
        store.delete(key);
        throw error;
      }
    })();

    store.set(key, {
      value: undefined,
      expiresAt: computeExpiry(),
      inFlight,
    });

    return inFlight;
  };

  const get = (key, loader) => {
    if (!store.has(key)) {
      return load(key, loader);
    }

    const entry = store.get(key);

    if (entry.inFlight) {
      return entry.inFlight;
    }

    if (!isExpired(entry)) {
      return Promise.resolve(entry.value);
    }

    return load(key, loader);
  };

  const deleteKey = (key) => {
    store.delete(key);
  };

  const clear = () => {
    store.clear();
  };

  const size = () => store.size;

  return {
    get,
    delete: deleteKey,
    clear,
    size,
  };
}

export default createAsyncCache;
