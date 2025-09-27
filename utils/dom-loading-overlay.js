export function createLoadingOverlayController(element) {
  let el = element ?? null;
  let counter = 0;

  const setHidden = (isHidden) => {
    if (!el) return;
    if (typeof el.toggleAttribute === 'function') {
      el.toggleAttribute('hidden', isHidden);
    } else if (isHidden) {
      el.setAttribute?.('hidden', '');
    } else {
      el.removeAttribute?.('hidden');
    }
  };

  const setDisplay = (isActive) => {
    if (!el || !el.style) return;
    el.style.display = isActive ? 'flex' : 'none';
  };

  const setAriaState = (isActive) => {
    if (!el) return;
    el.setAttribute?.('aria-hidden', isActive ? 'false' : 'true');
    el.setAttribute?.('aria-busy', isActive ? 'true' : 'false');
  };

  const syncState = () => {
    const isActive = counter > 0;
    setHidden(!isActive);
    setDisplay(isActive);
    setAriaState(isActive);
  };

  const normaliseCounter = (value) => {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    return Math.floor(value);
  };

  const api = {
    attach(elementLike) {
      el = elementLike ?? null;
      syncState();
      return el;
    },
    increment() {
      counter += 1;
      syncState();
      return counter;
    },
    decrement() {
      counter = Math.max(0, counter - 1);
      syncState();
      return counter;
    },
    setCounter(value) {
      counter = normaliseCounter(value);
      syncState();
      return counter;
    },
    reset() {
      counter = 0;
      syncState();
      return counter;
    },
    isActive() {
      return counter > 0;
    },
    getCounter() {
      return counter;
    },
    sync() {
      syncState();
      return counter;
    },
  };

  syncState();
  return api;
}

export default createLoadingOverlayController;
