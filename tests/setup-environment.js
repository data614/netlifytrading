const createMemoryStorage = () => {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
};

if (typeof globalThis.window === 'undefined') {
  globalThis.window = { location: { origin: 'http://localhost' } };
}

if (!globalThis.window.localStorage) {
  globalThis.window.localStorage = createMemoryStorage();
}

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = globalThis.window.localStorage;
}

if (typeof globalThis.document === 'undefined') {
  const createStubElement = () => ({
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    dataset: {},
    appendChild() {},
    setAttribute() {},
    remove() {},
    replaceChildren() {},
  });

  globalThis.document = {
    querySelector: () => null,
    getElementById: () => null,
    createElement: () => createStubElement(),
    createDocumentFragment: () => ({ appendChild() {}, firstChild: null, childNodes: [] }),
    addEventListener: () => {},
  };
}

if (typeof globalThis.navigator === 'undefined') {
  globalThis.navigator = { userAgent: 'node' };
}
