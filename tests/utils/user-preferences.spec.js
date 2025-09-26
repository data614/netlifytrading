import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const createLocalStorageStub = () => {
  const store = new Map();
  return {
    getItem: vi.fn((key) => (store.has(key) ? store.get(key) : null)),
    setItem: vi.fn((key, value) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key) => {
      store.delete(key);
    }),
    __store: store,
  };
};

describe('user-preferences utilities', () => {
  let storage;

  beforeEach(() => {
    vi.resetModules();
    storage = createLocalStorageStub();
    globalThis.localStorage = storage;
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete globalThis.localStorage;
  });

  it('loads defaults when storage is empty or malformed', async () => {
    const mod = await import('../../utils/user-preferences.js');
    expect(mod.loadPreferences()).toEqual(mod.getDefaultPreferences());

    storage.getItem.mockImplementationOnce(() => 'not-json');
    expect(mod.loadPreferences()).toEqual(mod.getDefaultPreferences());
  });

  it('persists updates and normalises values', async () => {
    const mod = await import('../../utils/user-preferences.js');

    const updated = mod.updatePreferences({
      symbol: 'msft',
      symbolName: '  Microsoft Corporation  ',
      exchange: 'xnys',
      timeframe: '3m',
      searchExchange: 'xnas',
      newsSource: 'Reuters',
    });

    expect(updated.symbol).toBe('MSFT');
    expect(updated.symbolName).toBe('Microsoft Corporation');
    expect(updated.exchange).toBe('XNYS');
    expect(updated.timeframe).toBe('3M');
    expect(updated.searchExchange).toBe('XNAS');
    expect(updated.newsSource).toBe('Reuters');

    const savedPayload = JSON.parse(storage.setItem.mock.calls.at(-1)[1]);
    expect(savedPayload).toMatchObject({
      symbol: 'MSFT',
      symbolName: 'Microsoft Corporation',
      exchange: 'XNYS',
      timeframe: '3M',
      searchExchange: 'XNAS',
      newsSource: 'Reuters',
    });

    const reloaded = mod.loadPreferences();
    expect(reloaded).toEqual(updated);
  });

  it('falls back to defaults for unsupported timeframe values', async () => {
    const mod = await import('../../utils/user-preferences.js');
    const next = mod.updatePreferences({ timeframe: '99Y' });
    expect(next.timeframe).toBe('1D');
    const stored = JSON.parse(storage.setItem.mock.calls.at(-1)[1]);
    expect(stored.timeframe).toBe('1D');
  });

  it('clears stored preferences', async () => {
    const mod = await import('../../utils/user-preferences.js');
    mod.updatePreferences({ symbol: 'TSLA' });
    expect(storage.__store.size).toBeGreaterThan(0);

    mod.clearPreferences();
    expect(storage.removeItem).toHaveBeenCalledWith(mod.PREFERENCE_STORAGE_KEY);
    expect(storage.__store.size).toBe(0);
    expect(mod.loadPreferences()).toEqual(mod.getDefaultPreferences());
  });
});
