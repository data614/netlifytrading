import normalizeAiAnalystPayload from './utils/ai-analyst-normalizer.js';

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

const defaultUniverse = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'NFLX'];

let currentResults = [];
let processedRows = [];
let currentSort = { key: 'upside', direction: 'desc' };
let isScreening = false;

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

function passesFilters(row, filters) {
  const { minUpside, maxUpside, marketCapMin, marketCapMax, sectors } = filters;

  if (minUpside !== null) {
    if (!Number.isFinite(row.upside) || row.upside < minUpside) return false;
  }

  if (maxUpside !== null) {
    if (!Number.isFinite(row.upside) || row.upside > maxUpside) return false;
  }

  if (marketCapMin !== null) {
    if (!Number.isFinite(row.marketCap) || row.marketCap < marketCapMin) return false;
  }

  if (marketCapMax !== null) {
    if (!Number.isFinite(row.marketCap) || row.marketCap > marketCapMax) return false;
  }

  if (sectors.length) {
    const rowSector = (row.sector || '').toLowerCase();
    if (!rowSector) return false;
    const matches = sectors.some((sector) => rowSector.includes(sector));
    if (!matches) return false;
  }

  return true;
}

function computeRow(symbol, data) {
  const valuation = data?.valuation?.valuation || data?.valuation;
  const valuationRoot = data?.valuation || {};
  const overview = data?.overview || {};
  const fundamentals = valuationRoot?.fundamentals || {};
  const metrics = fundamentals?.metrics || {};
  const price = valuationRoot?.price ?? valuation?.price ?? valuationRoot?.quote?.price;
  const fairValue = valuation?.fairValue ?? null;
  const upside = price && fairValue ? ((fairValue - price) / price) * 100 : null;
  let marketCap = Number(overview.marketCap);
  if (!Number.isFinite(marketCap)) {
    const shares = Number(overview.sharesOutstanding ?? metrics.sharesOutstanding);
    if (Number.isFinite(shares) && Number.isFinite(price)) {
      marketCap = price * shares;
    } else {
      marketCap = null;
    }
  }
  const sector = overview.sector || fundamentals.sector || fundamentals.profile?.sector || '';
  const industry = overview.industry || fundamentals.industry || fundamentals.profile?.industry || '';
  const momentum = (() => {
    if (!Array.isArray(data?.trend) || data.trend.length < 2) return 0;
    const first = Number(data.trend[0]?.close ?? data.trend[0]?.price);
    const last = Number(data.trend[data.trend.length - 1]?.close ?? data.trend[data.trend.length - 1]?.price);
    if (!Number.isFinite(first) || !Number.isFinite(last) || Math.abs(first) < 1e-6) return 0;
    return ((last - first) / first) * 100;
  })();
  const remark = (data?.aiSummary || '').split('. ').slice(0, 2).join('. ');

  return {
    symbol,
    sector,
    industry,
    price,
    fairValue,
    upside,
    marketCap,
    momentum,
    summary: remark,
    raw: data,
  };
}

function renderHeatmap(rows) {
  if (!rows.length) {
    $('#heatmap').textContent = 'Run the screener to populate aggregated intelligence.';
    return;
  }
  const top = [...rows].sort((a, b) => (b.upside ?? -Infinity) - (a.upside ?? -Infinity)).slice(0, 3);
  const laggards = [...rows].sort((a, b) => (a.upside ?? Infinity) - (b.upside ?? Infinity)).slice(0, 3);
  const momentumLeaders = [...rows].sort((a, b) => (b.momentum ?? -Infinity) - (a.momentum ?? -Infinity)).slice(0, 3);

  $('#heatmap').innerHTML = [
    `<strong>Top upside</strong>: ${top.map((row) => `${row.symbol} (${fmtPercent(row.upside)})`).join(', ')}`,
    `<strong>Weakest upside</strong>: ${laggards.map((row) => `${row.symbol} (${fmtPercent(row.upside)})`).join(', ')}`,
    `<strong>Momentum leaders</strong>: ${momentumLeaders.map((row) => `${row.symbol} (${fmtPercent(row.momentum)})`).join(', ')}`,
  ].join('<br/>');
}

function renderTable(rows) {
  const tbody = $('#screenerTable tbody');
  tbody.innerHTML = '';
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

  for (const [index, symbol] of universe.entries()) {
    try {
      const { data } = await fetchIntel(symbol);
      const row = computeRow(symbol, data);
      processedRows.push(row);
      if (!passesFilters(row, filters)) {
        setStatus(`Processed ${index + 1}/${universe.length}. ${symbol} filtered out by criteria.`, 'info');
        continue;
      }
      currentResults.push(row);
      const sorted = sortResults(currentResults, currentSort.key, currentSort.direction);
      renderTable(sorted);
      updateSummary(sorted);
      renderHeatmap(sorted);
      setStatus(`Processed ${index + 1}/${universe.length}. ${currentResults.length} matches so far.`, 'info');
      if (currentResults.length >= batchCap) {
        setStatus(`Reached batch cap of ${batchCap} tickers.`, 'success');
        break;
      }
    } catch (error) {
      console.error(error);
      setStatus(`Error processing ${symbol}: ${error.message}`, 'error');
    }
  }

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
  if (!currentResults.length) {
    setStatus('No data to export yet.', 'error');
    return;
  }
  const header = ['Symbol', 'Sector', 'MarketCap', 'Price', 'FairValue', 'Upside', 'Momentum', 'Summary'];
  const lines = currentResults.map((row) => [
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
  setStatus('CSV exported.', 'success');
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
