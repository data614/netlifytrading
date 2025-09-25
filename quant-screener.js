const $ = (selector) => document.querySelector(selector);

const fmtCurrency = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
};

const fmtPercent = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num > 0 ? '+' : ''}${num.toFixed(1)}%`;
};

const defaultUniverse = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'NFLX'];

let currentResults = [];
let currentSort = { key: 'upside', direction: 'desc' };

async function fetchIntel(symbol) {
  const url = new URL('/api/aiAnalyst', window.location.origin);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('limit', 120);
  url.searchParams.set('timeframe', '3M');
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Failed to analyse ${symbol}: ${response.status}`);
  }
  return response.json();
}

function parseUniverse(raw) {
  if (!raw) return defaultUniverse;
  return raw
    .split(/[\s,]+/)
    .map((token) => token.trim().toUpperCase())
    .filter((token, index, arr) => token && arr.indexOf(token) === index);
}

function computeRow(symbol, data) {
  const valuation = data?.valuation?.valuation || data?.valuation;
  const price = data?.valuation?.price ?? valuation?.price ?? data?.valuation?.quote?.price;
  const fairValue = valuation?.fairValue ?? null;
  const upside = price && fairValue ? ((fairValue - price) / price) * 100 : null;
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
    price,
    fairValue,
    upside,
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
    tr.innerHTML = '<td colspan="6" style="text-align:center; padding:1.5rem;">No tickers met the filter criteria.</td>';
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
  const raw = $('#universeInput').value.trim();
  const universe = parseUniverse(raw);
  const minUpside = Number($('#upsideFilter').value) || 0;
  const batchCap = Math.max(1, Math.min(Number($('#batchSize').value) || 6, 20));
  if (!universe.length) {
    setStatus('Universe is empty. Provide at least one ticker.', 'error');
    return;
  }

  setStatus(`Screening ${universe.length} tickers using ChatGPT‑5…`, 'info');
  currentResults = [];
  renderTable([]);

  for (const [index, symbol] of universe.entries()) {
    try {
      const { data } = await fetchIntel(symbol);
      const row = computeRow(symbol, data);
      if (!Number.isFinite(row.upside) || row.upside < minUpside) {
        setStatus(`Processed ${index + 1}/${universe.length}. ${symbol} filtered out.`, 'info');
        continue;
      }
      currentResults.push(row);
      const sorted = sortResults(currentResults, currentSort.key, currentSort.direction);
      renderTable(sorted);
      updateSummary(sorted);
      renderHeatmap(sorted);
      setStatus(`Processed ${index + 1}/${universe.length}. ${currentResults.length} matches so far.`, 'info');
    } catch (error) {
      console.error(error);
      setStatus(`Error processing ${symbol}: ${error.message}`, 'error');
    }

    if (currentResults.length >= batchCap) {
      setStatus(`Reached batch cap of ${batchCap} tickers.`, 'info');
      break;
    }
  }

  if (!currentResults.length) {
    setStatus('Screen complete. No tickers satisfied the filters.', 'error');
    renderHeatmap([]);
    updateSummary([]);
  } else {
    setStatus('Screen complete.', 'success');
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

function downloadCsv() {
  if (!currentResults.length) {
    setStatus('No data to export yet.', 'error');
    return;
  }
  const header = ['Symbol', 'Price', 'FairValue', 'Upside', 'Momentum', 'Summary'];
  const lines = currentResults.map((row) => [
    row.symbol,
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
  renderHeatmap([]);
  updateSummary([]);
}

document.addEventListener('DOMContentLoaded', init);
