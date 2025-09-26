import { fetchAnalystIntel } from './ai-analyst-client.js';

const ABORT_ERROR_NAME = 'AbortError';

function createAbortError(reason) {
  if (reason instanceof Error) return reason;
  const error = new Error(typeof reason === 'string' ? reason : 'Batch aborted');
  error.name = ABORT_ERROR_NAME;
  return error;
}

function isAbortError(error) {
  if (!error) return false;
  if (error.name === ABORT_ERROR_NAME) return true;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === ABORT_ERROR_NAME || error.code === DOMException.ABORT_ERR;
  }
  return false;
}

function linkAbortSignal(signal) {
  if (!signal) {
    return { signal: undefined, cleanup() {} };
  }
  if (signal.aborted) {
    const controller = new AbortController();
    controller.abort(signal.reason);
    return { signal: controller.signal, cleanup() {} };
  }
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', forwardAbort, { once: true });
  const cleanup = () => signal.removeEventListener('abort', forwardAbort);
  return { signal: controller.signal, cleanup };
}

function pause(delayMs, signal) {
  if (!delayMs || delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(createAbortError(signal?.reason));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
  });
}

export function normalizeSymbolList(input) {
  if (!input) return [];

  let rawList;
  if (Array.isArray(input)) {
    rawList = input;
  } else if (typeof input === 'string') {
    rawList = input.split(/[\s,;\n\r]+/);
  } else if (input instanceof Set) {
    rawList = Array.from(input);
  } else if (typeof input === 'object') {
    if (Array.isArray(input.symbols)) {
      rawList = input.symbols;
    } else if (Array.isArray(input.tickers)) {
      rawList = input.tickers;
    } else {
      rawList = [];
    }
  } else {
    rawList = [];
  }

  const seen = new Set();
  const normalized = [];
  rawList.forEach((value) => {
    if (value === null || value === undefined) return;
    const symbol = String(value).trim().toUpperCase();
    if (!symbol) return;
    if (!seen.has(symbol)) {
      seen.add(symbol);
      normalized.push(symbol);
    }
  });

  return normalized;
}

export async function runBatchAnalystIntel({
  symbols,
  limit,
  timeframe,
  concurrency = 4,
  delayMs = 0,
  fetchImpl,
  onProgress,
  signal,
} = {}) {
  const list = normalizeSymbolList(symbols);
  if (!list.length) {
    throw new Error('No valid symbols provided for batch AI Analyst run.');
  }

  const maxConcurrency = Math.max(1, Math.floor(concurrency || 1));
  const total = list.length;
  const progressState = { total, active: 0, completed: 0 };
  const outcomes = new Array(total);
  let cursor = 0;
  const batchStartedAt = Date.now();

  const emitProgress = (event) => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress({
        total: progressState.total,
        active: progressState.active,
        completed: progressState.completed,
        pending: Math.max(progressState.total - progressState.completed - progressState.active, 0),
        ...event,
      });
    } catch (error) {
      console.error('onProgress handler failed', error); // eslint-disable-line no-console
    }
  };

  const nextTask = () => {
    if (cursor >= total) return null;
    const index = cursor;
    const symbol = list[cursor];
    cursor += 1;
    return { symbol, index };
  };

  const workers = Array.from({ length: Math.min(maxConcurrency, total) }, () =>
    (async function worker() {
      while (true) {
        if (signal?.aborted) throw createAbortError(signal.reason);
        const task = nextTask();
        if (!task) return;
        const { symbol, index } = task;
        progressState.active += 1;
        emitProgress({ symbol, index, status: 'started' });
        const startedAt = Date.now();
        const { signal: fetchSignal, cleanup } = linkAbortSignal(signal);
        try {
          const payload = await fetchAnalystIntel({
            symbol,
            limit,
            timeframe,
            fetchImpl,
            signal: fetchSignal,
          });
          outcomes[index] = {
            symbol,
            index,
            status: 'fulfilled',
            value: payload,
            startedAt,
            finishedAt: Date.now(),
          };
        } catch (error) {
          if (signal?.aborted && isAbortError(error)) {
            outcomes[index] = {
              symbol,
              index,
              status: 'aborted',
              reason: error,
              startedAt,
              finishedAt: Date.now(),
            };
            cleanup();
            throw error;
          }
          outcomes[index] = {
            symbol,
            index,
            status: 'rejected',
            reason: error,
            startedAt,
            finishedAt: Date.now(),
          };
        } finally {
          cleanup();
          progressState.active -= 1;
          progressState.completed += 1;
          const outcome = outcomes[index];
          emitProgress({
            symbol,
            index,
            status: outcome?.status ?? 'unknown',
            durationMs: outcome ? outcome.finishedAt - outcome.startedAt : 0,
            data: outcome?.value?.data,
            warning: outcome?.value?.warning,
            error: outcome?.reason,
          });
        }

        if (delayMs > 0 && cursor < total) {
          await pause(delayMs, signal);
        }
      }
    })(),
  );

  try {
    await Promise.all(workers);
  } catch (error) {
    if (isAbortError(error)) {
      throw createAbortError(error);
    }
    throw error;
  }

  const successes = outcomes
    .filter((item) => item?.status === 'fulfilled')
    .map(({ symbol, index, value, startedAt, finishedAt }) => ({
      symbol,
      index,
      data: value?.data,
      warning: value?.warning,
      durationMs: finishedAt - startedAt,
    }));
  const failures = outcomes
    .filter((item) => item?.status === 'rejected')
    .map(({ symbol, index, reason, startedAt, finishedAt }) => ({
      symbol,
      index,
      error: reason,
      durationMs: finishedAt - startedAt,
    }));

  return {
    total,
    successes,
    failures,
    outcomes,
    completed: progressState.completed,
    durationMs: Date.now() - batchStartedAt,
  };
}

export default runBatchAnalystIntel;
