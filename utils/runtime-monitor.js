const DEFAULT_MAX_EVENTS = 250;
const DEFAULT_HEARTBEAT_INTERVAL = 60_000;

const nowProvider = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.timeOrigin + performance.now();
  }
  return Date.now();
};

const normaliseLevel = (level) => {
  if (level === 'error' || level === 'warn' || level === 'info' || level === 'debug') {
    return level;
  }
  return 'info';
};

const cloneData = (value) => {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => cloneData(item));
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, cloneData(val)]));
};

const safeInvoke = (fn, payload) => {
  if (typeof fn !== 'function') return;
  try {
    fn(payload);
  } catch (error) {
    console.error('app monitor listener failed', error);
  }
};

export function createRuntimeMonitor({
  maxEvents = DEFAULT_MAX_EVENTS,
  heartbeatInterval = DEFAULT_HEARTBEAT_INTERVAL,
  now = nowProvider,
} = {}) {
  const events = [];
  const counters = new Map();
  const gauges = new Map();
  const listeners = new Set();
  const resolveNow = typeof now === 'function' ? () => now() : () => now;
  let lastHeartbeatAt = resolveNow();

  const ensureHeartbeat = () => {
    const ts = resolveNow();
    if (!heartbeatInterval || heartbeatInterval === Infinity) return;
    if (ts - lastHeartbeatAt < heartbeatInterval) return;
    lastHeartbeatAt = ts;
    recordEvent({
      type: 'heartbeat',
      level: 'debug',
      message: 'Application monitor heartbeat',
      data: { timestamp: ts },
    });
  };

  const recordEvent = ({ type = 'event', level = 'info', message = '', data = undefined }) => {
    const timestamp = resolveNow();
    const entry = {
      id: `${timestamp}-${Math.random().toString(36).slice(2)}`,
      type: String(type || 'event'),
      level: normaliseLevel(level),
      message: String(message || ''),
      data: cloneData(data),
      timestamp,
    };
    events.push(entry);
    while (events.length > maxEvents) {
      events.shift();
    }
    ensureHeartbeat();
    listeners.forEach((listener) => safeInvoke(listener, entry));
    return entry;
  };

  const incrementCounter = (name, delta = 1) => {
    const key = String(name || '');
    const current = counters.has(key) ? counters.get(key) : 0;
    const nextValue = current + (Number.isFinite(delta) ? delta : 0);
    counters.set(key, nextValue);
    return nextValue;
  };

  const setGauge = (name, value) => {
    const key = String(name || '');
    const numeric = Number(value);
    gauges.set(key, Number.isFinite(numeric) ? numeric : value);
    return gauges.get(key);
  };

  const snapshot = () => ({
    events: events.slice(),
    counters: Object.fromEntries(counters.entries()),
    gauges: Object.fromEntries(gauges.entries()),
  });

  const flush = () => {
    const snap = snapshot();
    events.length = 0;
    return snap;
  };

  const subscribe = (listener) => {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const trackError = (error, context = '', detail = undefined) => {
    const payload = {
      context,
      detail,
    };
    if (error && typeof error === 'object') {
      payload.name = error.name;
      payload.message = error.message;
      if (error.stack) payload.stack = error.stack;
    } else if (error !== undefined) {
      payload.value = error;
    }
    incrementCounter('errors.total');
    return recordEvent({
      type: 'error',
      level: 'error',
      message: payload.message || String(error?.message || error || 'Unknown error'),
      data: payload,
    });
  };

  const trackWarning = (message, data) => {
    incrementCounter('warnings.total');
    return recordEvent({
      type: 'warning',
      level: 'warn',
      message: message || '',
      data,
    });
  };

  const trackOperationStart = (name, metadata = {}) => {
    const operationName = String(name || 'operation');
    const startedAt = resolveNow();
    incrementCounter(`${operationName}.attempts`);
    recordEvent({
      type: 'operation',
      level: 'debug',
      message: `${operationName} started`,
      data: { name: operationName, stage: 'start', metadata: cloneData(metadata) },
    });

    let done = false;
    const finish = (stage, level, payload = {}) => {
      if (done) return;
      done = true;
      const durationMs = resolveNow() - startedAt;
      const eventLevel = normaliseLevel(level);
      const data = {
        name: operationName,
        stage,
        metadata: cloneData(metadata),
        durationMs,
        ...cloneData(payload),
      };
      recordEvent({
        type: 'operation',
        level: eventLevel,
        message: `${operationName} ${stage}`,
        data,
      });
    };

    return {
      succeed(result) {
        incrementCounter(`${operationName}.success`);
        finish('succeeded', 'info', { result: cloneData(result) });
        return result;
      },
      fail(error) {
        incrementCounter(`${operationName}.failed`);
        finish('failed', 'error', {
          error: error && typeof error === 'object'
            ? { name: error.name, message: error.message, stack: error.stack }
            : { value: error },
        });
        return error;
      },
      cancel(reason) {
        incrementCounter(`${operationName}.cancelled`);
        finish('cancelled', 'warn', { reason: cloneData(reason) });
      },
      end(status = 'completed', data) {
        finish(status, 'info', data);
      },
    };
  };

  const monitor = {
    recordEvent,
    incrementCounter,
    setGauge,
    snapshot,
    flush,
    subscribe,
    trackError,
    trackWarning,
    trackOperationStart,
  };

  return monitor;
}

export function createPassiveRuntimeMonitor(options) {
  const monitor = createRuntimeMonitor(options);
  return {
    ...monitor,
    exposeGlobal(key = '__APP_MONITOR__') {
      if (typeof window !== 'undefined') {
        window[key] = monitor;
      } else {
        globalThis[key] = monitor;
      }
      return monitor;
    },
  };
}
