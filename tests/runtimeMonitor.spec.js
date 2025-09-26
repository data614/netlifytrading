import { describe, expect, it, vi } from 'vitest';
import { createRuntimeMonitor, createPassiveRuntimeMonitor } from '../utils/runtime-monitor.js';

describe('runtime monitor', () => {
  it('records events with bounded history', () => {
    let current = 0;
    const monitor = createRuntimeMonitor({
      maxEvents: 2,
      now: () => {
        current += 1;
        return current;
      },
    });

    monitor.recordEvent({ message: 'first' });
    monitor.recordEvent({ message: 'second' });
    monitor.recordEvent({ message: 'third' });

    const snapshot = monitor.snapshot();
    expect(snapshot.events).toHaveLength(2);
    expect(snapshot.events[0].message).toBe('second');
    expect(snapshot.events[1].message).toBe('third');
  });

  it('tracks counters, gauges, warnings and errors', () => {
    const monitor = createRuntimeMonitor({ now: () => 10 });

    monitor.incrementCounter('requests');
    monitor.incrementCounter('requests', 2);
    monitor.setGauge('queue.size', 5);
    monitor.trackWarning('Heads up', { code: 'WARN' });
    monitor.trackError(new Error('Boom'), 'test-context', { id: 1 });

    const snapshot = monitor.snapshot();
    expect(snapshot.counters.requests).toBe(3);
    expect(snapshot.counters['warnings.total']).toBe(1);
    expect(snapshot.counters['errors.total']).toBe(1);
    expect(snapshot.gauges['queue.size']).toBe(5);

    const lastEvent = snapshot.events.at(-1);
    expect(lastEvent.type).toBe('error');
    expect(lastEvent.level).toBe('error');
    expect(lastEvent.data).toMatchObject({ context: 'test-context', detail: { id: 1 } });
  });

  it('monitors operation lifecycles and supports subscriptions', () => {
    const timestamps = [0, 10, 25, 40, 65, 80];
    let index = 0;
    const monitor = createRuntimeMonitor({ now: () => timestamps[index++] ?? timestamps.at(-1) });

    const listener = vi.fn();
    const unsubscribe = monitor.subscribe(listener);

    const successOp = monitor.trackOperationStart('fetch.data', { symbol: 'AAPL' });
    const result = successOp.succeed({ status: 200 });
    expect(result).toMatchObject({ status: 200 });

    const failureOp = monitor.trackOperationStart('fetch.data', { symbol: 'TSLA' });
    failureOp.fail(new Error('Network down'));

    expect(monitor.snapshot().counters['fetch.data.success']).toBe(1);
    expect(monitor.snapshot().counters['fetch.data.failed']).toBe(1);
    expect(listener).toHaveBeenCalled();

    const callCount = listener.mock.calls.length;
    unsubscribe();

    const cancelled = monitor.trackOperationStart('background.job');
    cancelled.cancel('user-abort');
    expect(listener.mock.calls.length).toBe(callCount);
  });

  it('flushes event history and exposes a global monitor when requested', () => {
    const monitorHandle = createPassiveRuntimeMonitor({ now: () => 5 });
    const monitor = monitorHandle.exposeGlobal('__TEST_MONITOR__');

    monitor.recordEvent({ message: 'hello' });
    const flushed = monitor.flush();
    expect(flushed.events).toHaveLength(1);
    expect(monitor.snapshot().events).toHaveLength(0);
    expect(globalThis.__TEST_MONITOR__).toBe(monitor);

    delete globalThis.__TEST_MONITOR__;
  });
});
