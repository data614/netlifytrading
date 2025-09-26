import { createSymbolInput, createStatusBanner } from './ui-components.js';
import { fetchValuationSnapshot } from './api-client.js';

const state = {
  symbol: 'AAPL',
  loading: false,
};

const statusBanner = createStatusBanner();

function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `$${Number(value).toFixed(2)}`;
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const pct = Number(value) * 100;
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

function updateBiasTag(upside) {
  const tag = document.getElementById('valuation-bias');
  if (!tag) return;
  if (upside === null || upside === undefined || Number.isNaN(Number(upside))) {
    tag.textContent = 'Neutral';
    tag.dataset.variant = '';
    return;
  }
  const pct = Number(upside);
  if (pct > 0.1) {
    tag.textContent = 'Bullish Bias';
    tag.dataset.variant = 'bullish';
  } else if (pct < -0.1) {
    tag.textContent = 'Bearish Bias';
    tag.dataset.variant = 'bearish';
  } else {
    tag.textContent = 'Neutral';
    tag.dataset.variant = '';
  }
}

function renderScenarios(snapshot) {
  const table = document.querySelector('#valuation-scenarios tbody');
  if (!table) return;
  table.innerHTML = '';
  const price = Number(snapshot?.price ?? snapshot?.valuation?.price ?? 0) || 0;
  const scenarios = snapshot?.valuation?.scenarios || {};
  const entries = [
    ['Bull', scenarios.bull],
    ['Base', scenarios.base],
    ['Bear', scenarios.bear],
  ];
  entries.forEach(([label, value]) => {
    if (value === null || value === undefined) return;
    const row = document.createElement('tr');
    const delta = price ? ((Number(value) - price) / price) : null;
    row.innerHTML = `
      <td>${label}</td>
      <td>${formatCurrency(value)}</td>
      <td>${delta === null ? '—' : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta * 100).toFixed(1)}%`}</td>
    `;
    table.appendChild(row);
  });
}

function renderSnapshot(snapshot) {
  const valuation = snapshot?.valuation || {};
  const priceEl = document.getElementById('valuation-last-price');
  const fairEl = document.getElementById('valuation-fair-value');
  const entryEl = document.getElementById('valuation-entry');
  const upsideEl = document.getElementById('valuation-upside');
  const narrativeEl = document.getElementById('valuation-narrative');

  if (priceEl) priceEl.textContent = formatCurrency(snapshot?.price ?? valuation.price);
  if (fairEl) fairEl.textContent = formatCurrency(valuation.fairValue);
  if (entryEl) entryEl.textContent = formatCurrency(valuation.suggestedEntry);
  if (upsideEl) upsideEl.textContent = formatPercent(valuation.upside);
  updateBiasTag(valuation.upside);
  if (narrativeEl) {
    narrativeEl.textContent = snapshot?.narrative || 'No valuation narrative available yet.';
  }
  renderScenarios(snapshot);
}

async function refreshSnapshot() {
  if (!state.symbol) return;
  state.loading = true;
  statusBanner.setMessage('Loading valuation snapshot…');
  try {
    const { snapshot, warning, meta } = await fetchValuationSnapshot(state.symbol);
    renderSnapshot(snapshot);
    if (warning) {
      statusBanner.setMessage(warning, 'warning');
    } else {
      const source = meta?.source === 'live' ? 'Live feed' : meta?.source === 'eod-fallback' ? 'EOD fallback' : 'Sample data';
      statusBanner.setMessage(`${state.symbol} · ${source}`);
    }
  } catch (error) {
    console.error(error);
    statusBanner.setMessage(error?.message || 'Unable to load valuation', 'error');
  } finally {
    state.loading = false;
  }
}

function handleSymbolChange(symbol) {
  state.symbol = symbol;
  document.querySelectorAll('[data-active-symbol]').forEach((el) => {
    el.textContent = symbol;
  });
  refreshSnapshot();
}

function init() {
  const controlsHost = document.getElementById('valuation-symbol-controls');
  const statusHost = document.getElementById('valuation-status');
  if (!controlsHost || !statusHost) {
    console.warn('Valuation lab shell missing required mounts');
    return;
  }

  const symbolInput = createSymbolInput({
    initial: state.symbol,
    onSubmit: handleSymbolChange,
    placeholder: 'Enter symbol for valuation…',
  });
  controlsHost.appendChild(symbolInput.element);
  statusHost.appendChild(statusBanner.element);

  document.querySelectorAll('[data-active-symbol]').forEach((el) => {
    el.textContent = state.symbol;
  });

  refreshSnapshot();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
