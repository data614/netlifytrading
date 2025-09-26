import normalizeAiAnalystPayload from './utils/ai-analyst-normalizer.js';
import { createScreenPreferenceStore } from './utils/persistent-screen-preferences.js';
import { computeRow, passesFilters, screenUniverse, suggestConcurrency } from './utils/quant-screener-core.js';
import { computeAggregateMetrics, createEmptyAggregateMetrics } from './utils/quant-screener-analytics.js';
import { createRunHistoryStore } from './utils/screen-run-history.js';
import createAsyncCache from './utils/cache.js';

const $ = (selector) => document.querySelector(selector);

const fmtCurrency = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
};

const fmtCompactCurrency = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 2,
  });
};

const fmtPercent = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num > 0 ? '+' : ''}${num.toFixed(1)}%`;
};

const HEATMAP_LIMIT = 18;

const clamp = (value, min, max) => {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const blendChannel = (start, end, ratio) => Math.round(start + (end - start) * ratio);

function computeHeatColor(value, min, max) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const low = [200, 68, 68];
  const high = [46, 163, 83];

  if (max === min) {
    const rgb = value >= 0 ? high : low;
    const background = `rgb(${rgb.join(', ')})`;
    const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
    const text = brightness < 140 ? '#f8fbff' : '#04141f';
    return { background, text };
  }

  const span = max - min;
  const ratio = clamp((value - min) / span, 0, 1);
  const rgb = [
    blendChannel(low[0], high[0], ratio),
    blendChannel(low[1], high[1], ratio),
    blendChannel(low[2], high[2], ratio),
  ];
  const background = `rgb(${rgb.join(', ')})`;
  const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
  const text = brightness < 140 ? '#f8fbff' : '#04141f';
  return { background, text };
}

const defaultUniverse = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'NFLX'];
const DEFAULT_SORT = Object.freeze({ key: 'upside', direction: 'desc' });
const DEFAULT_FILTER_INPUTS = Object.freeze({
  minUpside: '5',
  maxUpside: '',
  marketCapMin: '',
  marketCapMax: '',
  sectors: '',
  batchCap: '6',
});

let currentResults = [];
let processedRows = [];
let currentSort = { ...DEFAULT_SORT };
let isScreening = false;
let visibleRows = [];
const intelCache = createAsyncCache({ ttlMs: 5 * 60 * 1000, maxSize: 256 });

const preferenceStore = createScreenPreferenceStore({
  defaults: {
    universe: defaultUniverse.join(', '),
    filters: { ...DEFAULT_FILTER_INPUTS },
    sort: DEFAULT_SORT,
  },
});

const runHistoryStore = createRunHistoryStore();
let latestMetrics = createEmptyAggregateMetrics();

const runtimeBridge = {
  getLatestMetrics: () => ({
    ...latestMetrics,
    bestUpside: latestMetrics.bestUpside ? { ...latestMetrics.bestUpside } : null,
    worstUpside: latestMetrics.worstUpside ? { ...latestMetrics.worstUpside } : null,
    bestMomentum: latestMetrics.bestMomentum ? { ...latestMetrics.bestMomentum } : null,
    sectorLeaders: latestMetrics.sectorLeaders.map((leader) => ({ ...leader })),
  }),
  getRunHistory: () => runHistoryStore.list(),
};

function publishRuntimeBridge() {
  if (typeof window === 'undefined') return;
  const namespace = window.netlifyTrading || (window.netlifyTrading = {});
  namespace.quantScreener = runtimeBridge;
}

publishRuntimeBridge();

async function fetchIntel(symbol) {
  return intelCache.get(symbol, async () => {
    const url = new URL('/api/aiAnalyst', window.location.origin);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('limit', 120);
    url.searchParams.set('priceLimit', 120);
    url.searchParams.set('timeframe', '3M');
    url.searchParams.set('newsLimit', 12);
    url.searchParams.set('documentLimit', 12);
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`Failed to analyse ${symbol}: ${response.status}`);
    }
    const body = await response.json();
    const warningHeader =
      response.headers.get('x-ai-analyst-warning')
      || response.headers.get('x-intel-warning')
      || '';
    return normalizeAiAnalystPayload(body, { warningHeader });
  });
}

function parseUniverse(raw) {
  if (!raw) return defaultUniverse;
  return raw
    .split(/[\s,]+/)
    .map((token) => token.trim().toUpperCase())
    .filter((token, index, arr) => token && arr.indexOf(token) === index);
}

function parseList(raw) {
  return (raw || '')
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readFilters() {
  const parseNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  let minUpside = parseNumber($('#upsideFilter')?.value);
  let maxUpside = parseNumber($('#upsideMaxFilter')?.value);
  let minCap = parseNumber($('#marketCapMin')?.value);
  let maxCap = parseNumber($('#marketCapMax')?.value);
  if (minUpside !== null && maxUpside !== null && maxUpside < minUpside) {
    [minUpside, maxUpside] = [maxUpside, minUpside];
  }
  if (minCap !== null && minCap < 0) minCap = 0;
  if (maxCap !== null && maxCap < 0) maxCap = 0;

  let batchCap = parseNumber($('#batchSize')?.value);
  if (!Number.isFinite(batchCap) || batchCap === null) batchCap = 6;
  batchCap = Math.max(1, Math.min(batchCap, 50));

  const sectors = parseList($('#sectorFilter')?.value).map((sector) => sector.toLowerCase());

  return {
    minUpside,
    maxUpside,
    marketCapMin: minCap !== null ? minCap * 1_000_000_000 : null,
    marketCapMax: maxCap !== null ? maxCap * 1_000_000_000 : null,
    sectors,
    batchCap,
  };
}

const readInputValue = (selector, fallback = '') => {
  const el = $(selector);
  if (!el) return fallback;
  return el.value ?? fallback;
};

const toInputString = (value) => {
  if (value === undefined || value === null) return '';
  return String(value);
};

function captureFormState() {
  return {
    universe: readInputValue('#universeInput'),
    filters: {
      minUpside: readInputValue('#upsideFilter'),
      maxUpside: readInputValue('#upsideMaxFilter'),
      marketCapMin: readInputValue('#marketCapMin'),
      marketCapMax: readInputValue('#marketCapMax'),
      sectors: readInputValue('#sectorFilter'),
      batchCap: readInputValue('#batchSize'),
    },
    sort: { ...currentSort },
  };
}

function persistPreferences(partial = {}) {
  const snapshot = captureFormState();
  const payload = {
    ...snapshot,
    ...partial,
    filters: { ...snapshot.filters, ...(partial.filters || {}) },
    sort: { ...snapshot.sort, ...(partial.sort || {}) },
  };
  preferenceStore.merge(payload);
}

function applySavedPreferences() {
  const saved = preferenceStore.load();
  const filters = saved.filters || {};
  const assign = (selector, value, fallback = '') => {
    const el = $(selector);
    if (!el) return;
    const resolved = value === undefined ? fallback : value;
    el.value = toInputString(resolved);
  };

  assign('#universeInput', saved.universe, defaultUniverse.join(', '));
  assign('#upsideFilter', filters.minUpside, DEFAULT_FILTER_INPUTS.minUpside);
  assign('#upsideMaxFilter', filters.maxUpside, DEFAULT_FILTER_INPUTS.maxUpside);
  assign('#marketCapMin', filters.marketCapMin, DEFAULT_FILTER_INPUTS.marketCapMin);
  assign('#marketCapMax', filters.marketCapMax, DEFAULT_FILTER_INPUTS.marketCapMax);
  assign('#sectorFilter', filters.sectors, DEFAULT_FILTER_INPUTS.sectors);
  assign('#batchSize', filters.batchCap, DEFAULT_FILTER_INPUTS.batchCap);

  const sort = saved.sort || {};
  if (sort.key) {
    currentSort = {
      key: sort.key,
      direction: sort.direction === 'asc' ? 'asc' : 'desc',
    };
  } else {
    currentSort = { ...DEFAULT_SORT };
  }

  return saved;
}

function renderHeatmap(rows) {
  const container = $('#heatmap');
  if (!container) return;

  container.classList.remove('is-empty');
  container.innerHTML = '';

  if (!rows.length) {
    container.classList.add('is-empty');
    container.textContent = 'Run the screener to populate aggregated intelligence.';
    return;
  }

  const numericUpsides = rows.map((row) => Number(row.upside)).filter((value) => Number.isFinite(value));
  if (!numericUpsides.length) {
    container.classList.add('is-empty');
    container.textContent = 'Upside estimates are unavailable for the current results.';
    return;
  }

  const minUpside = Math.min(...numericUpsides);
  const maxUpside = Math.max(...numericUpsides);
  const sorted = [...rows].sort((a, b) => (b.upside ?? -Infinity) - (a.upside ?? -Infinity));
  const limited = sorted.slice(0, HEATMAP_LIMIT);

  const grid = document.createElement('div');
  grid.className = 'market-radar-grid';

  limited.forEach((row, index) => {
    const cell = document.createElement('div');
    cell.className = 'market-radar-cell';
    const heat = computeHeatColor(Number(row.upside), minUpside, maxUpside);
    if (!heat) {
      cell.classList.add('is-neutral');
    } else {
      cell.style.setProperty('--heat-color', heat.background);
      cell.style.setProperty('--heat-text', heat.text);
    }
    const upsideLabel = fmtPercent(row.upside);
    const momentumLabel = fmtPercent(row.momentum);
    const rank = index + 1;
    cell.title = `${row.symbol} · Upside ${upsideLabel} · Momentum ${momentumLabel} · Rank ${rank}`;
    cell.innerHTML = `
      <span class="market-radar-symbol">${row.symbol}</span>
      <span class="market-radar-metric">Upside ${upsideLabel}</span>
      <span class="market-radar-details">Momentum ${momentumLabel}</span>
    `;
    grid.appendChild(cell);
  });

  container.appendChild(grid);

  const legend = document.createElement('div');
  legend.className = 'market-radar-legend';
  legend.innerHTML = `
    <span class="legend-label">Low upside</span>
    <span class="legend-scale" aria-hidden="true"></span>
    <span class="legend-label">High upside</span>
  `;
  container.appendChild(legend);

  if (sorted.length > limited.length) {
    const footnote = document.createElement('div');
    footnote.className = 'market-radar-footnote';
    footnote.textContent = `Displaying top ${limited.length} of ${sorted.length} results by upside.`;
    container.appendChild(footnote);
  }
}

function renderTable(rows) {
  const tbody = $('#screenerTable tbody');
  tbody.innerHTML = '';
  visibleRows = Array.isArray(rows) ? [...rows] : [];
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.symbol}</td>
      <td>${row.sector || '—'}</td>
      <td>${fmtCompactCurrency(row.marketCap)}</td>
      <td>${fmtCurrency(row.price)}</td>
      <td>${fmtCurrency(row.fairValue)}</td>
      <td>${fmtPercent(row.upside)}</td>
      <td>${fmtPercent(row.momentum)}</td>
      <td class="summary-cell">${row.summary || '—'}</td>
    `;
    tbody.appendChild(tr);
  });
  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="8" style="text-align:center; padding:1.5rem;">No tickers met the filter criteria.</td>';
    tbody.appendChild(tr);
  }
}

function sortResults(rows, key, direction) {
  const sorted = [...rows].sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    if (Number.isFinite(va) && Number.isFinite(vb)) {
      return direction === 'asc' ? va - vb : vb - va;
    }
    return String(va || '').localeCompare(String(vb || '')) * (direction === 'asc' ? 1 : -1);
  });
  return sorted;
}

function applyFilters({ silent = false } = {}) {
  if (!processedRows.length) return;
  const filters = readFilters();
  const matches = [];
  for (const row of processedRows) {
    if (passesFilters(row, filters)) {
      matches.push(row);
      if (matches.length >= filters.batchCap) break;
    }
  }
  currentResults = matches;
  const sorted = sortResults(currentResults, currentSort.key, currentSort.direction);
  renderTable(sorted);
  updateSummary(sorted);
  renderHeatmap(sorted);
  if (!silent) {
    setStatus(`${sorted.length} matches after applying filters.`, sorted.length ? 'info' : 'error');
  }
}

function assignSummaryChipDataset(chip, metrics) {
  const assign = (key, value) => {
    if (value === null || value === undefined || Number.isNaN(value)) {
      delete chip.dataset[key];
      return;
    }
    chip.dataset[key] = typeof value === 'number' ? String(value) : String(value);
  };

  assign('count', metrics.count ?? 0);
  assign('avgUpside', metrics.avgUpside);
  assign('medianUpside', metrics.medianUpside);
  assign('positiveUpsideCount', metrics.positiveUpsideCount ?? 0);
  assign('negativeUpsideCount', metrics.negativeUpsideCount ?? 0);
  assign('zeroUpsideCount', metrics.zeroUpsideCount ?? 0);
  assign('totalMarketCap', metrics.totalMarketCap);
  assign('averageMarketCap', metrics.averageMarketCap);
  assign('momentumAverage', metrics.momentumAverage);
  assign('momentumMedian', metrics.momentumMedian);

  if (metrics.bestUpside) {
    assign('bestUpsideSymbol', metrics.bestUpside.symbol);
    assign('bestUpsideValue', metrics.bestUpside.value);
  } else {
    delete chip.dataset.bestUpsideSymbol;
    delete chip.dataset.bestUpsideValue;
  }

  if (metrics.worstUpside) {
    assign('worstUpsideSymbol', metrics.worstUpside.symbol);
    assign('worstUpsideValue', metrics.worstUpside.value);
  } else {
    delete chip.dataset.worstUpsideSymbol;
    delete chip.dataset.worstUpsideValue;
  }

  if (metrics.bestMomentum) {
    assign('bestMomentumSymbol', metrics.bestMomentum.symbol);
    assign('bestMomentumValue', metrics.bestMomentum.value);
  } else {
    delete chip.dataset.bestMomentumSymbol;
    delete chip.dataset.bestMomentumValue;
  }

  if (metrics.sectorLeaders && metrics.sectorLeaders.length) {
    assign(
      'topSectors',
      JSON.stringify(
        metrics.sectorLeaders.map((leader) => ({
          name: leader.name,
          count: leader.count,
          weight: leader.weight,
          averageUpside: leader.averageUpside,
        }))
      )
    );
  } else {
    delete chip.dataset.topSectors;
  }
}

function updateSummary(rows) {
  const chip = $('#summaryChip');
  if (!chip) return;

  latestMetrics = computeAggregateMetrics(rows);
  assignSummaryChipDataset(chip, latestMetrics);

  if (!rows.length) {
    chip.textContent = '0 matches';
    publishRuntimeBridge();
    return;
  }

  const avgUpsideDisplay = Number.isFinite(latestMetrics.avgUpside) ? latestMetrics.avgUpside : 0;
  chip.textContent = `${rows.length} matches · Avg upside ${fmtPercent(avgUpsideDisplay)}`;
  publishRuntimeBridge();
}

function setStatus(message, tone = 'info') {
  const el = $('#screenStatus');
  if (!el) return;
  el.textContent = message;
  el.className = `status-message ${tone}`;
}

async function runScreen() {
  if (isScreening) return;
  const raw = $('#universeInput').value.trim();
  const universe = parseUniverse(raw);
  const filters = readFilters();
  const batchCap = filters.batchCap;
  if (!universe.length) {
    setStatus('Universe is empty. Provide at least one ticker.', 'error');
    return;
  }

  isScreening = true;
  processedRows = [];
  currentResults = [];
  renderTable([]);
  renderHeatmap([]);
  updateSummary([]);
  setStatus(`Screening ${universe.length} tickers using ChatGPT‑5…`, 'info');

  persistPreferences();

  const concurrency = suggestConcurrency(universe.length);
  const startTime = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

  const { matches, processed, reachedCap, errors } = await screenUniverse(universe, {
    fetchIntel,
    computeRow,
    passesFilters: (row) => passesFilters(row, filters),
    filters,
    batchCap,
    concurrency,
    onItemComplete: ({
      symbol,
      row,
      passes,
      processedCount,
      total: totalSymbols,
      matchesCount,
      reachedCap: capReached,
    }) => {
      processedRows.push(row);
      if (!passes) {
        setStatus(`Processed ${processedCount}/${totalSymbols}. ${symbol} filtered out by criteria.`, 'info');
        return;
      }

      currentResults.push(row);
      const sorted = sortResults(currentResults, currentSort.key, currentSort.direction);
      renderTable(sorted);
      updateSummary(sorted);
      renderHeatmap(sorted);
      if (capReached) {
        setStatus(`Reached batch cap of ${batchCap} tickers.`, 'success');
      } else {
        setStatus(`Processed ${processedCount}/${totalSymbols}. ${matchesCount} matches so far.`, 'info');
      }
    },
    onError: ({ symbol, error, processedCount, total: totalSymbols }) => {
      console.error(error);
      const message = error?.message || 'Unknown error';
      setStatus(`Error processing ${symbol} (${processedCount}/${totalSymbols}): ${message}`, 'error');
    },
  });

  processedRows = processed;
  currentResults = matches;
  isScreening = false;

  applyFilters({ silent: true });
  const latestFilters = readFilters();

  const finishedTime = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
  const durationMs = finishedTime - startTime;
  const normalizedDuration = Number.isFinite(durationMs) ? Math.round(durationMs) : null;
  const runTimestamp = Date.now();
  persistPreferences({
    lastRun: {
      timestamp: runTimestamp,
      universeCount: universe.length,
      matchesCount: currentResults.length,
      reachedCap,
      durationMs: normalizedDuration,
    },
  });

  runHistoryStore.record({
    timestamp: runTimestamp,
    universeCount: universe.length,
    matches: currentResults.length,
    durationMs: normalizedDuration,
    reachedCap,
    errorCount: Array.isArray(errors) ? errors.length : 0,
    filters: latestFilters,
    sort: currentSort,
    universeSample: universe,
    metrics: latestMetrics,
  });
  publishRuntimeBridge();

  if (!currentResults.length) {
    renderHeatmap([]);
    updateSummary([]);
    setStatus('Screen complete. No tickers satisfied the filters.', 'error');
    return;
  }

  if (currentResults.length >= latestFilters.batchCap) {
    setStatus(`Reached batch cap of ${latestFilters.batchCap} tickers.`, 'success');
  } else {
    setStatus(`Screen complete. ${currentResults.length} matches within filters.`, 'success');
  }
}

function attachSortHandlers() {
  const headers = document.querySelectorAll('.screener-table th');
  headers.forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (!key) return;
      currentSort = {
        key,
        direction: currentSort.key === key && currentSort.direction === 'desc' ? 'asc' : 'desc',
      };
      const sorted = sortResults(currentResults, currentSort.key, currentSort.direction);
      renderTable(sorted);
      updateSummary(sorted);
      renderHeatmap(sorted);
      persistPreferences({ sort: currentSort });
    });
  });
}

function registerFilterControls() {
  const numericSelectors = ['#upsideFilter', '#upsideMaxFilter', '#marketCapMin', '#marketCapMax', '#batchSize'];
  numericSelectors.forEach((selector) => {
    const el = $(selector);
    if (!el) return;
    el.addEventListener('change', () => {
      persistPreferences();
      if (isScreening || !processedRows.length) return;
      applyFilters();
    });
  });

  const sectorInput = $('#sectorFilter');
  if (sectorInput) {
    sectorInput.addEventListener('change', () => {
      persistPreferences();
      if (isScreening || !processedRows.length) return;
      applyFilters();
    });
    sectorInput.addEventListener('input', () => {
      if (isScreening || !processedRows.length) return;
      applyFilters({ silent: true });
    });
  }
}

function downloadCsv() {
  const source = visibleRows.length ? visibleRows : currentResults;
  if (!source.length) {
    setStatus('No table data available to export yet.', 'error');
    return;
  }
  const header = ['Symbol', 'Sector', 'MarketCap', 'Price', 'FairValue', 'Upside', 'Momentum', 'Summary'];
  const lines = source.map((row) => [
    row.symbol,
    row.sector || '',
    Number.isFinite(row.marketCap) ? row.marketCap : '',
    row.price ?? '',
    row.fairValue ?? '',
    row.upside ?? '',
    row.momentum ?? '',
    (row.summary || '').replace(/"/g, "'"),
  ]);
  const csv = [header, ...lines].map((line) => line.map((item) => `"${item}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ai-quant-screener.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  setStatus(`CSV exported with ${source.length} row${source.length === 1 ? '' : 's'}.`, 'success');
}

function init() {
  applySavedPreferences();
  $('#runScreen').addEventListener('click', () => {
    runScreen();
  });
  $('#downloadCsv').addEventListener('click', () => downloadCsv());
  attachSortHandlers();
  registerFilterControls();
  const universeInput = $('#universeInput');
  if (universeInput) {
    universeInput.addEventListener('change', () => persistPreferences());
    universeInput.addEventListener('blur', () => persistPreferences());
  }
  renderHeatmap([]);
  updateSummary([]);
  persistPreferences();
}

document.addEventListener('DOMContentLoaded', init);
