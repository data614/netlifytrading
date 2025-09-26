import normalizeAiAnalystPayload from './utils/ai-analyst-normalizer.js';
import { computeRow, passesFilters, screenUniverse, suggestConcurrency } from './utils/quant-screener-core.js';

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

let currentResults = [];
let processedRows = [];
let currentSort = { key: 'upside', direction: 'desc' };
let isScreening = false;
let visibleRows = [];

async function fetchIntel(symbol) {
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

function updateSummary(rows) {
  if (!rows.length) {
    $('#summaryChip').textContent = '0 matches';
    return;
  }
  const avgUpside = rows.reduce((acc, row) => acc + (Number(row.upside) || 0), 0) / rows.length;
  $('#summaryChip').textContent = `${rows.length} matches · Avg upside ${fmtPercent(avgUpside)}`;
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

  const concurrency = suggestConcurrency(universe.length);

  const { matches, processed, reachedCap } = await screenUniverse(universe, {
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
    });
  });
}

function registerFilterControls() {
  const numericSelectors = ['#upsideFilter', '#upsideMaxFilter', '#marketCapMin', '#marketCapMax', '#batchSize'];
  numericSelectors.forEach((selector) => {
    const el = $(selector);
    if (!el) return;
    el.addEventListener('change', () => {
      if (isScreening || !processedRows.length) return;
      applyFilters();
    });
  });

  const sectorInput = $('#sectorFilter');
  if (sectorInput) {
    const trigger = (silent) => {
      if (isScreening || !processedRows.length) return;
      applyFilters({ silent });
    };
    sectorInput.addEventListener('change', () => trigger(false));
    sectorInput.addEventListener('input', () => trigger(true));
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
  $('#universeInput').value = defaultUniverse.join(', ');
  $('#runScreen').addEventListener('click', () => {
    runScreen();
  });
  $('#downloadCsv').addEventListener('click', () => downloadCsv());
  attachSortHandlers();
  registerFilterControls();
  renderHeatmap([]);
  updateSummary([]);
}

document.addEventListener('DOMContentLoaded', init);
