export function createSymbolInput({ onSubmit, placeholder = 'Search symbol…', initial = 'AAPL' } = {}) {
  const wrapper = document.createElement('form');
  wrapper.className = 'pro-symbol-input';
  wrapper.setAttribute('autocomplete', 'off');

  const input = document.createElement('input');
  input.type = 'search';
  input.name = 'symbol';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = placeholder;
  input.value = initial;
  input.setAttribute('aria-label', 'Symbol search');

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.title = 'Load symbol';
  submit.innerHTML = '↵';

  wrapper.append(input, submit);

  wrapper.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value.trim().toUpperCase();
    if (!value) return;
    if (typeof onSubmit === 'function') {
      onSubmit(value);
    }
  });

  return {
    element: wrapper,
    input,
    focus: () => input.focus(),
    setValue: (value) => {
      input.value = value || '';
    },
  };
}

export function createRangeSelector(ranges, { onChange, active } = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'pro-range-selector';

  const buttons = ranges.map((key) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = key;
    if (key === active) button.classList.add('active');
    button.addEventListener('click', () => {
      if (button.classList.contains('active')) return;
      buttons.forEach((btn) => btn.classList.remove('active'));
      button.classList.add('active');
      if (typeof onChange === 'function') {
        onChange(key);
      }
    });
    wrapper.appendChild(button);
    return button;
  });

  return { element: wrapper, setActive: (key) => {
    buttons.forEach((btn) => {
      if (btn.textContent === key) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  } };
}

export function createStatusBanner() {
  const el = document.createElement('div');
  el.className = 'pro-status-banner';
  const dot = document.createElement('span');
  dot.className = 'dot';
  const label = document.createElement('span');
  label.textContent = 'Ready';
  el.append(dot, label);

  const setVariant = (variant = 'default') => {
    el.dataset.variant = variant === 'default' ? '' : variant;
  };

  return {
    element: el,
    setMessage: (message, variant = 'default') => {
      label.textContent = message;
      setVariant(variant);
    },
  };
}

export function createLoadingOverlay() {
  const el = document.createElement('div');
  el.className = 'loading-overlay';
  const spinner = document.createElement('div');
  spinner.className = 'loading-spinner';
  el.appendChild(spinner);
  el.style.display = 'none';

  return {
    element: el,
    show: () => {
      el.style.display = 'flex';
    },
    hide: () => {
      el.style.display = 'none';
    },
  };
}
