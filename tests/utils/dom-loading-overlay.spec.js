import { describe, it, expect } from 'vitest';
import { createLoadingOverlayController } from '../../utils/dom-loading-overlay.js';

describe('dom loading overlay controller', () => {
  it('keeps the overlay hidden until activated', () => {
    const el = document.createElement('div');
    const controller = createLoadingOverlayController(el);

    expect(el.hidden).toBe(true);
    expect(el.style.display).toBe('none');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.getAttribute('aria-busy')).toBe('false');
    expect(controller.isActive()).toBe(false);

    controller.increment();
    expect(controller.isActive()).toBe(true);
    expect(el.hidden).toBe(false);
    expect(el.style.display).toBe('flex');
    expect(el.getAttribute('aria-hidden')).toBe('false');
    expect(el.getAttribute('aria-busy')).toBe('true');

    controller.decrement();
    expect(controller.isActive()).toBe(false);
    expect(el.hidden).toBe(true);
    expect(el.style.display).toBe('none');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.getAttribute('aria-busy')).toBe('false');
  });

  it('can attach to an element after initialisation', () => {
    const controller = createLoadingOverlayController(null);
    controller.setCounter(2);
    expect(controller.getCounter()).toBe(2);
    expect(controller.isActive()).toBe(true);

    const el = document.createElement('div');
    controller.attach(el);
    expect(el.hidden).toBe(false);
    expect(el.style.display).toBe('flex');

    controller.reset();
    expect(controller.getCounter()).toBe(0);
    expect(el.hidden).toBe(true);
  });

  it('normalises counter values', () => {
    const el = document.createElement('div');
    const controller = createLoadingOverlayController(el);

    controller.setCounter(3.7);
    expect(controller.getCounter()).toBe(3);
    expect(el.hidden).toBe(false);

    controller.setCounter(-2);
    expect(controller.getCounter()).toBe(0);
    expect(el.hidden).toBe(true);
  });
});
