import { createSymbolInput, createStatusBanner } from './ui-components.js';
import { fetchValuationSnapshot } from './api-client.js';
import { buildValuationView, createScenarioCsv } from './valuation-model.js';

const state = {
  symbol: 'AAPL',
  loading: false,
  lastUpdated: null,
  currentView: null,
  events: [],
  monitorTimer: null,
};

const statusBanner = createStatusBanner();

const controlDefaults = {
  revenueCagr: 12,
  terminalGrowth: '3',
  growthMode: 'accelerating',
  ebitdaMargin: 28,
  operatingLeverage: 'balanced',
  fcfConversion: 85,
  costMode: 'opex',
  discountRate: 8,
  debtRatio: 0.8,
  buyback: 'neutral',
};

const AUTO_REFRESH_MS = 5 * 60 * 1000;
const STALE_THRESHOLD_MS = 3 * 60 * 1000;
const EVENT_LIMIT = 8;

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

function renderScenarios(view) {
  const table = document.querySelector('#valuation-scenarios tbody');
  if (!table) return;
  table.innerHTML = '';
  const price = Number(view?.valuation?.price ?? view?.price ?? 0) || 0;
  const scenarios = view?.valuation?.scenarios || {};
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

function renderDiagnostics(view) {
  const diagnostics = view?.diagnostics;
  if (!diagnostics) return;

  const mc = document.getElementById('valuation-monte-carlo');
  if (mc) {
    mc.innerHTML = `
      <div class="valuation-diagnostic-quick">
        <strong>${diagnostics.dispersion.toFixed(1)}% σ</strong>
        <span>Dispersion</span>
      </div>
      <p>Median ${formatCurrency(diagnostics.distribution.median)} · p10 ${formatCurrency(diagnostics.distribution.p10)} · p90 ${formatCurrency(diagnostics.distribution.p90)}</p>
      <p>Confidence ${diagnostics.confidence.toFixed(0)}% · Tilt ${diagnostics.riskTilt}</p>
    `;
  }

  const sensitivityTable = document.querySelector('#valuation-sensitivity tbody');
  if (sensitivityTable) {
    const rows = sensitivityTable.querySelectorAll('tr');
    if (rows[0]) {
      const cells = rows[0].querySelectorAll('td');
      if (cells[0]) cells[0].textContent = `${Number(diagnostics.sensitivity.revenue.positive).toFixed(1)}x`;
      if (cells[1]) cells[1].textContent = `${Number(diagnostics.sensitivity.revenue.neutral).toFixed(1)}x`;
      if (cells[2]) cells[2].textContent = `${Number(diagnostics.sensitivity.revenue.negative).toFixed(1)}x`;
    }
    if (rows[1]) {
      const cells = rows[1].querySelectorAll('td');
      if (cells[0]) cells[0].textContent = `${Number(diagnostics.sensitivity.margins.positive).toFixed(1)}x`;
      if (cells[1]) cells[1].textContent = `${Number(diagnostics.sensitivity.margins.neutral).toFixed(1)}x`;
      if (cells[2]) cells[2].textContent = `${Number(diagnostics.sensitivity.margins.negative).toFixed(1)}x`;
    }
    if (rows[2]) {
      const cells = rows[2].querySelectorAll('td');
      if (cells[0]) cells[0].textContent = `${Number(diagnostics.sensitivity.discount.positive).toFixed(1)}x`;
      if (cells[1]) cells[1].textContent = `${Number(diagnostics.sensitivity.discount.neutral).toFixed(1)}x`;
      if (cells[2]) cells[2].textContent = `${Number(diagnostics.sensitivity.discount.negative).toFixed(1)}x`;
    }
  }

  const peerTiles = document.querySelectorAll('#valuation-peer-tiles .valuation-peer-tile');
  if (peerTiles.length >= 4) {
    const { peerPositioning } = diagnostics;
    peerTiles[0].querySelector('strong').textContent = `${peerPositioning.pe >= 0 ? '+' : ''}${peerPositioning.pe.toFixed(1)}σ`;
    peerTiles[0].querySelector('small').textContent = peerPositioning.pe >= 1 ? 'Premium' : peerPositioning.pe <= -1 ? 'Discount' : 'In-Line';
    peerTiles[1].querySelector('strong').textContent = `${peerPositioning.sales >= 0 ? '+' : ''}${peerPositioning.sales.toFixed(1)}σ`;
    peerTiles[1].querySelector('small').textContent = peerPositioning.sales >= 1 ? 'Premium' : peerPositioning.sales <= -1 ? 'Discount' : 'In-Line';
    peerTiles[2].querySelector('strong').textContent = `${peerPositioning.fcf >= 0 ? '+' : ''}${peerPositioning.fcf.toFixed(1)}σ`;
    peerTiles[2].querySelector('small').textContent = peerPositioning.fcf >= 0 ? 'Premium' : 'Discount';
    peerTiles[3].querySelector('strong').textContent = `${peerPositioning.rule40 >= 0 ? '+' : ''}${peerPositioning.rule40.toFixed(1)}σ`;
    peerTiles[3].querySelector('small').textContent = peerPositioning.rule40 >= 1 ? 'Leadership' : peerPositioning.rule40 <= -1 ? 'Lagging' : 'Balanced';
  }
}

function renderSnapshot(view) {
  const valuation = view?.valuation || {};
  const priceEl = document.getElementById('valuation-last-price');
  const fairEl = document.getElementById('valuation-fair-value');
  const entryEl = document.getElementById('valuation-entry');
  const upsideEl = document.getElementById('valuation-upside');
  const narrativeEl = document.getElementById('valuation-narrative');

  if (priceEl) priceEl.textContent = formatCurrency(view?.price ?? valuation.price);
  if (fairEl) fairEl.textContent = formatCurrency(valuation.fairValue);
  if (entryEl) entryEl.textContent = formatCurrency(valuation.suggestedEntry);
  if (upsideEl) upsideEl.textContent = formatPercent(valuation.upside);
  updateBiasTag(valuation.upside);
  if (narrativeEl) {
    narrativeEl.textContent = view?.narrative || 'No valuation narrative available yet.';
  }
  renderScenarios(view);
  renderDiagnostics(view);
}

function updateSliderDisplay(inputId, outputId, formatter) {
  const input = document.getElementById(inputId);
  const output = document.getElementById(outputId);
  if (!input || !output) return;
  const value = input.value;
  output.textContent = formatter ? formatter(value) : value;
}

function setActiveToggle(groupId, mode) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.querySelectorAll('.valuation-toggle').forEach((btn) => {
    const isActive = btn.dataset.mode === mode;
    btn.classList.toggle('active', isActive);
  });
}

function getActiveToggle(groupId, fallback) {
  const group = document.getElementById(groupId);
  if (!group) return fallback;
  const active = group.querySelector('.valuation-toggle.active');
  return active ? active.dataset.mode : fallback;
}

function resetControls({ silent } = {}) {
  const revenue = document.getElementById('valuation-revenue-cagr');
  const terminal = document.getElementById('valuation-terminal-growth');
  const ebitda = document.getElementById('valuation-ebitda-margin');
  const leverage = document.getElementById('valuation-operating-leverage');
  const conversion = document.getElementById('valuation-fcf-conversion');
  const discount = document.getElementById('valuation-discount-rate');
  const debt = document.getElementById('valuation-debt-ratio');
  const buyback = document.getElementById('valuation-share-buyback');

  if (revenue) revenue.value = controlDefaults.revenueCagr;
  if (terminal) terminal.value = controlDefaults.terminalGrowth;
  if (ebitda) ebitda.value = controlDefaults.ebitdaMargin;
  if (leverage) leverage.value = controlDefaults.operatingLeverage;
  if (conversion) conversion.value = controlDefaults.fcfConversion;
  if (discount) discount.value = controlDefaults.discountRate;
  if (debt) debt.value = controlDefaults.debtRatio;
  if (buyback) buyback.value = controlDefaults.buyback;

  updateSliderDisplay('valuation-revenue-cagr', 'valuation-revenue-cagr-value', (val) => `${Number(val).toFixed(0)}%`);
  updateSliderDisplay('valuation-ebitda-margin', 'valuation-ebitda-margin-value', (val) => `${Number(val).toFixed(0)}%`);
  updateSliderDisplay('valuation-discount-rate', 'valuation-discount-rate-value', (val) => `${Number(val).toFixed(0)}%`);

  setActiveToggle('valuation-growth-mode-group', controlDefaults.growthMode);
  setActiveToggle('valuation-cost-mode-group', controlDefaults.costMode);

  state.currentControls = { ...controlDefaults };
  if (!silent) {
    statusBanner.setMessage('Controls reverted to baseline assumptions.');
  }
}

function readControlOverrides() {
  const readNumber = (id, fallback) => {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const num = Number(el.value);
    return Number.isFinite(num) ? num : fallback;
  };

  return {
    revenueCagr: readNumber('valuation-revenue-cagr', controlDefaults.revenueCagr),
    terminalGrowth: Number(document.getElementById('valuation-terminal-growth')?.value ?? controlDefaults.terminalGrowth),
    growthMode: getActiveToggle('valuation-growth-mode-group', controlDefaults.growthMode),
    ebitdaMargin: readNumber('valuation-ebitda-margin', controlDefaults.ebitdaMargin),
    operatingLeverage: document.getElementById('valuation-operating-leverage')?.value || controlDefaults.operatingLeverage,
    fcfConversion: readNumber('valuation-fcf-conversion', controlDefaults.fcfConversion),
    costMode: getActiveToggle('valuation-cost-mode-group', controlDefaults.costMode),
    discountRate: readNumber('valuation-discount-rate', controlDefaults.discountRate),
    debtRatio: Number(document.getElementById('valuation-debt-ratio')?.value ?? controlDefaults.debtRatio),
    buyback: document.getElementById('valuation-share-buyback')?.value || controlDefaults.buyback,
  };
}

function logEvent(level, message) {
  const timestamp = new Date();
  state.events.push({ level, message, timestamp });
  if (state.events.length > EVENT_LIMIT) {
    state.events.splice(0, state.events.length - EVENT_LIMIT);
  }
  const tooltip = state.events
    .map((event) => `[${event.timestamp.toLocaleTimeString()}] ${event.level.toUpperCase()}: ${event.message}`)
    .join('\n');
  statusBanner.element.title = tooltip;
}

function updateStatusMetadata({ sourceMessage } = {}) {
  if (!statusBanner?.element) return;
  const time = state.lastUpdated ? state.lastUpdated.toLocaleTimeString() : null;
  statusBanner.element.dataset.updatedAt = time || '';
  if (sourceMessage && state.lastUpdated) {
    statusBanner.setMessage(`${sourceMessage} · ${time}`);
  }
}

function initControlBindings() {
  const sliders = [
    ['valuation-revenue-cagr', 'valuation-revenue-cagr-value', (val) => `${Number(val).toFixed(0)}%`],
    ['valuation-ebitda-margin', 'valuation-ebitda-margin-value', (val) => `${Number(val).toFixed(0)}%`],
    ['valuation-discount-rate', 'valuation-discount-rate-value', (val) => `${Number(val).toFixed(0)}%`],
  ];

  sliders.forEach(([inputId, outputId, format]) => {
    const input = document.getElementById(inputId);
    if (!input) return;
    updateSliderDisplay(inputId, outputId, format);
    input.addEventListener('input', () => updateSliderDisplay(inputId, outputId, format));
  });

  document.querySelectorAll('.valuation-toggle-group').forEach((group) => {
    group.addEventListener('click', (event) => {
      const button = event.target.closest('.valuation-toggle');
      if (!button) return;
      group.querySelectorAll('.valuation-toggle').forEach((el) => el.classList.remove('active'));
      button.classList.add('active');
    });
  });

  const resetButton = document.getElementById('valuation-reset-controls');
  if (resetButton) {
    resetButton.addEventListener('click', () => resetControls({ silent: false }));
  }

  const applyButton = document.getElementById('valuation-apply-controls');
  if (applyButton) {
    applyButton.addEventListener('click', () => {
      statusBanner.setMessage('Recomputing valuation with scenario overrides…');
      refreshSnapshot({ reason: 'controls' });
    });
  }

  resetControls({ silent: true });
}

function bindExport() {
  const exportButton = document.getElementById('valuation-export-scenarios');
  if (!exportButton) return;
  exportButton.addEventListener('click', () => {
    if (!state.currentView) return;
    const csv = createScenarioCsv(state.currentView);
    if (!csv) return;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.symbol}-valuation-scenarios.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    logEvent('info', 'Scenario export generated');
  });
}

async function refreshSnapshot({ reason = 'manual', silent = false } = {}) {
  if (!state.symbol) return;
  state.loading = true;
  if (!silent) {
    statusBanner.setMessage('Loading valuation snapshot…');
  }
  try {
    const overrides = readControlOverrides();
    state.currentControls = overrides;
    const { snapshot, warning, meta } = await fetchValuationSnapshot(state.symbol);
    const view = buildValuationView({ symbol: state.symbol, snapshot, overrides });
    state.currentView = view;
    state.lastUpdated = view?.meta?.lastUpdated || new Date();
    renderSnapshot(view);
    if (warning) {
      statusBanner.setMessage(warning, 'warning');
      logEvent('warning', warning);
    } else {
      const source = meta?.source === 'live' ? 'Live feed' : meta?.source === 'eod-fallback' ? 'EOD fallback' : 'Sample data';
      statusBanner.setMessage(`${state.symbol} · ${source}`);
      logEvent('info', `${reason} refresh (${source})`);
    }
  } catch (error) {
    console.error(error);
    const overrides = state.currentControls || readControlOverrides();
    const fallbackView = buildValuationView({ symbol: state.symbol, snapshot: null, overrides });
    state.currentView = fallbackView;
    state.lastUpdated = fallbackView?.meta?.lastUpdated || new Date();
    renderSnapshot(fallbackView);
    const message = error?.message || 'Unable to load valuation';
    statusBanner.setMessage(message, 'error');
    logEvent('error', message);
  } finally {
    state.loading = false;
    updateStatusMetadata();
  }
}

function handleSymbolChange(symbol) {
  state.symbol = symbol;
  document.querySelectorAll('[data-active-symbol]').forEach((el) => {
    el.textContent = symbol;
  });
  refreshSnapshot({ reason: 'symbol' });
}

function handleVisibilityRefresh() {
  if (!state.lastUpdated) return;
  const elapsed = Date.now() - state.lastUpdated.getTime();
  if (elapsed > STALE_THRESHOLD_MS && !state.loading) {
    refreshSnapshot({ reason: 'visibility', silent: true });
  }
}

function startMonitoring() {
  if (state.monitorTimer) {
    clearInterval(state.monitorTimer);
  }
  state.monitorTimer = setInterval(() => {
    if (state.loading) return;
    refreshSnapshot({ reason: 'auto', silent: true });
  }, AUTO_REFRESH_MS);

  window.addEventListener('focus', handleVisibilityRefresh);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      handleVisibilityRefresh();
    }
  });

  window.addEventListener('error', (event) => {
    if (!event?.message) return;
    logEvent('error', event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    const message = typeof reason === 'string' ? reason : reason?.message;
    if (!message) return;
    logEvent('error', message);
  });
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

  initControlBindings();
  bindExport();
  startMonitoring();

  refreshSnapshot({ reason: 'init' });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
