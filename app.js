// Minimal frontend logic to fetch from Netlify functions and render the UI
// Uses the existing _redirects mapping: `/api/* -> /.netlify/functions/:splat`
// So all requests go to `/api/tiingo` locally (netlify dev) and when deployed.

/* DOM helpers */
const $ = (id) => document.getElementById(id);
function showLoading(on) {
  const el = $('loading');
  if (!el) return;
  el.style.display = on ? 'block' : 'none';
}
function showError(msg) {
  const el = $('error');
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

/* Formatting */
const fmt = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—');
const fmtVol = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '—');

/* API wrapper */
const API = '/api';
async function callTiingo(params) {
  const url = new URL(`${API}/tiingo`, window.location.origin);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  showLoading(true);
  try {
    const resp = await fetch(url, { headers: { accept: 'application/json' } });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data?.warning || data?.error || resp.statusText);
    if (data?.warning) console.warn('tiingo warning:', data.warning);
    return data;
  } catch (err) {
    showError(`Request failed: ${String(err.message || err)}`);
    throw err;
  } finally {
    showLoading(false);
  }
}

/* App state */
let priceChart = null;
let currentSymbol = 'AAPL';
let currentSymbolName = 'Apple Inc.';
let currentExchange = 'XNAS';
let currentTimeframe = '1D';
let watchlist = [];
let selectedExchange = '';
let searchAbortController = null;
let searchDebounceTimer = null;
let searchInputEl = null;
let searchResultsEl = null;
let exchangeFilterEl = null;

const WATCHLIST_STORAGE_KEY = 'tiingo.watchlist';
const DEFAULT_WATCHLIST = [
  { symbol: 'AAPL', name: 'Apple Inc.', mic: 'XNAS', exchange: 'NASDAQ' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', mic: 'XNAS', exchange: 'NASDAQ' },
  { symbol: 'TSLA', name: 'Tesla, Inc.', mic: 'XNAS', exchange: 'NASDAQ' },
];
const SEARCH_PLACEHOLDER = 'Start typing to search…';

function sma(values, windowSize) {
  const w = Math.max(1, Math.min(windowSize || 1, values.length));
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = Number(values[i]);
    if (Number.isFinite(v)) sum += v; else return out;
    if (i >= w) sum -= Number(values[i - w]);
    if (i >= w - 1) out[i] = +(sum / w).toFixed(2);
  }
  return out;
}

const getWatchlistKey = (item) => {
  if (!item || !item.symbol) return '';
  const symbol = String(item.symbol).toUpperCase();
  const mic = String(item.mic || item.exchange || '').toUpperCase();
  return `${symbol}::${mic}`;
};

function loadStoredWatchlist() {
  try {
    const raw = JSON.parse(localStorage.getItem(WATCHLIST_STORAGE_KEY) || '[]');
    if (Array.isArray(raw) && raw.length) {
      watchlist = raw
        .map((item) => ({
          symbol: String(item.symbol || '').toUpperCase(),
          name: item.name || '',
          mic: item.mic || item.exchange || '',
          exchange: item.exchange || '',
        }))
        .filter((item) => item.symbol);
      if (watchlist.length) return;
    }
  } catch (err) {
    console.warn('Failed to parse stored watchlist', err);
  }
  watchlist = DEFAULT_WATCHLIST.map((item) => ({ ...item }));
}

function persistWatchlist() {
  const serialisable = watchlist.map((item) => ({
    symbol: item.symbol,
    name: item.name,
    mic: item.mic || '',
    exchange: item.exchange || '',
  }));
  localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(serialisable));
}

function renderWatchlist() {
  const container = $('watchlist');
  if (!container) return;
  container.innerHTML = '';
  if (!watchlist.length) {
    const empty = document.createElement('div');
    empty.className = 'muted watchlist-empty';
    empty.textContent = 'No symbols yet. Search above to add.';
    container.appendChild(empty);
    return;
  }

  watchlist.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'watchlist-item';
    if (item.symbol === currentSymbol) {
      row.classList.add('active');
    }
    const key = getWatchlistKey(item);
    row.dataset.key = key;
    row.innerHTML = `
      <div class="watchlist-info">
        <div class="watchlist-symbol">${item.symbol}</div>
        <div class="watchlist-name muted">${item.name || ''}</div>
      </div>
      <div class="watchlist-meta">
        <span class="watchlist-exchange mono">${(item.mic || item.exchange || '').toUpperCase()}</span>
        <button type="button" class="watchlist-remove" data-action="remove" data-key="${key}" aria-label="Remove ${item.symbol}">&times;</button>
      </div>
    `;
    container.appendChild(row);
  });
}

function addToWatchlist(item) {
  if (!item || !item.symbol) return;
  const normalised = {
    symbol: String(item.symbol).toUpperCase(),
    name: item.name || '',
    mic: item.mic || item.exchange || '',
    exchange: item.exchange || '',
  };
  const key = getWatchlistKey(normalised);
  if (!key) return;
  if (watchlist.some((existing) => getWatchlistKey(existing) === key)) return;
  watchlist.push(normalised);
  persistWatchlist();
  renderWatchlist();
}

function removeFromWatchlist(key) {
  if (!key) return;
  watchlist = watchlist.filter((item) => getWatchlistKey(item) !== key);
  persistWatchlist();
  renderWatchlist();
}

function handleWatchlistClick(event) {
  const removeBtn = event.target.closest('button[data-action="remove"]');
  if (removeBtn) {
    removeFromWatchlist(removeBtn.dataset.key || '');
    event.stopPropagation();
    return;
  }

  const itemEl = event.target.closest('.watchlist-item');
  if (!itemEl) return;
  const key = itemEl.dataset.key || '';
  const match = watchlist.find((entry) => getWatchlistKey(entry) === key);
  if (!match) return;
  loadSymbol(match.symbol, match.name, match.mic || match.exchange || '');
}

function clearSearchResults(message = SEARCH_PLACEHOLDER) {
  if (!searchResultsEl) return;
  searchResultsEl.innerHTML = '';
  if (message) {
    const note = document.createElement('div');
    note.className = 'search-empty muted';
    note.textContent = message;
    searchResultsEl.appendChild(note);
  }
}

function setSearchLoading() {
  if (!searchResultsEl) return;
  searchResultsEl.innerHTML = '<div class="search-loading">Searching…</div>';
}

function renderSearchResults(items) {
  if (!searchResultsEl) return;
  searchResultsEl.innerHTML = '';
  if (!items.length) {
    clearSearchResults('No matching instruments.');
    return;
  }

  items.forEach((item) => {
    const symbol = (item.symbol || '').toUpperCase();
    if (!symbol) return;
    const name = item.name || '';
    const mic = (item.mic || item.exchange || '').toUpperCase();
    const type = item.type || '';
    const country = item.country || '';
    const meta = [mic, type, country].filter(Boolean).join(' • ');

    const row = document.createElement('div');
    row.className = 'search-result-item';
    row.innerHTML = `
      <div class="search-result-main">
        <div class="search-result-icon">${symbol.charAt(0)}</div>
        <div class="search-result-text">
          <div class="search-result-symbol">${symbol}</div>
          <div class="search-result-name">${name}</div>
          <div class="search-result-meta">${meta}</div>
        </div>
      </div>
      <div class="search-result-actions">
        <button type="button" class="search-result-btn watch" data-action="watch" data-symbol="${symbol}" data-name="${name}" data-mic="${mic}" data-exchange="${item.exchange || ''}">Add</button>
        <button type="button" class="search-result-btn load" data-action="load" data-symbol="${symbol}" data-name="${name}" data-mic="${mic}" data-exchange="${item.exchange || ''}">Load</button>
      </div>
    `;
    searchResultsEl.appendChild(row);
  });
}

async function performSearch(query) {
  const q = query.trim();
  if (q.length < 2) {
    clearSearchResults('Keep typing to search…');
    return;
  }

  if (searchAbortController) {
    searchAbortController.abort();
  }
  const controller = new AbortController();
  searchAbortController = controller;
  setSearchLoading();

  try {
    const endpoint = new URL(`${API}/search`, window.location.origin);
    endpoint.searchParams.set('q', q);
    endpoint.searchParams.set('limit', '12');
    if (selectedExchange) {
      endpoint.searchParams.set('exchange', selectedExchange);
    }
    const response = await fetch(endpoint, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`Search failed with status ${response.status}`);
    }
    const payload = await response.json().catch(() => ({}));
    const items = Array.isArray(payload?.data) ? payload.data : [];
    renderSearchResults(items.slice(0, 12));
  } catch (err) {
    if (controller.signal.aborted) return;
    console.error('Search request failed', err);
    clearSearchResults('Search unavailable. Try again later.');
  }
}

function setupSearch() {
  searchInputEl = $('stockSearchInput');
  searchResultsEl = $('searchResults');
  exchangeFilterEl = $('exchangeFilters');

  if (exchangeFilterEl) {
    selectedExchange = exchangeFilterEl.value || '';
    exchangeFilterEl.addEventListener('change', () => {
      selectedExchange = exchangeFilterEl.value || '';
      if (searchInputEl && searchInputEl.value.trim().length >= 2) {
        performSearch(searchInputEl.value);
      }
    });
  }

  if (searchInputEl) {
    searchInputEl.addEventListener('input', () => {
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
      }
      const value = searchInputEl.value;
      if (!value.trim()) {
        clearSearchResults();
        return;
      }
      searchDebounceTimer = setTimeout(() => {
        performSearch(value);
      }, 200);
    });
  }

  if (searchResultsEl) {
    searchResultsEl.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const symbol = button.dataset.symbol || '';
      const name = button.dataset.name || '';
      const mic = button.dataset.mic || '';
      const exchange = button.dataset.exchange || '';
      if (button.dataset.action === 'load') {
        loadSymbol(symbol, name, mic || exchange);
        if (searchInputEl) {
          searchInputEl.value = '';
        }
        clearSearchResults('Select another symbol to view quotes.');
      } else if (button.dataset.action === 'watch') {
        addToWatchlist({ symbol, name, mic, exchange });
      }
    });
  }

  clearSearchResults();
}

function setupWatchlist() {
  const container = $('watchlist');
  if (!container) return;
  container.addEventListener('click', handleWatchlistClick);
}

function updateRangeStats(rows) {
  const highs = [];
  const lows = [];
  rows.forEach((row) => {
    const h = Number(row.high ?? row.close);
    const l = Number(row.low ?? row.close);
    if (Number.isFinite(h)) highs.push(h);
    if (Number.isFinite(l)) lows.push(l);
  });
  if (!highs.length || !lows.length) {
    $('stat52wHigh').textContent = '—';
    $('stat52wLow').textContent = '—';
    return;
  }
  $('stat52wHigh').textContent = fmt(Math.max(...highs));
  $('stat52wLow').textContent = fmt(Math.min(...lows));
}

function renderQuote(q) {
  if (!q) {
    $('stockPrice').textContent = '—';
    $('stockChange').textContent = '—';
    $('stockChange').className = 'stock-change';
    $('statOpen').textContent = '—';
    $('statHigh').textContent = '—';
    $('statLow').textContent = '—';
    $('statVolume').textContent = '—';
    return;
  }
  const price = q.close ?? q.last ?? q.price;
  const open = q.open ?? price;
  const deltaAbs = Number(price) - Number(open || 0);
  const deltaPct = open ? (deltaAbs / open) * 100 : 0;
  $('stockPrice').textContent = fmt(price);
  const changeEl = $('stockChange');
  const pos = deltaAbs >= 0;
  changeEl.textContent = `${pos ? '+' : ''}${deltaAbs.toFixed(2)} (${pos ? '+' : ''}${deltaPct.toFixed(2)}%)`;
  changeEl.className = `stock-change ${pos ? 'positive-change' : 'negative-change'}`;
  $('statOpen').textContent = fmt(open);
  $('statHigh').textContent = fmt(q.high);
  $('statLow').textContent = fmt(q.low);
  $('statVolume').textContent = fmtVol(q.volume);
  const exchange = (q.exchange || q.exchangeCode || currentExchange || '').toUpperCase();
  currentExchange = exchange || currentExchange;
  $('exchangeAcronym').textContent = exchange ? ` ${exchange}` : '';
}

function renderChart(rows, intraday) {
  const ctx = $('stockChart');
  if (!ctx || !Array.isArray(rows)) return;
  const labels = rows.map((r) => new Date(r.date)[intraday ? 'toLocaleTimeString' : 'toLocaleDateString']());
  const values = rows.map((r) => Number(r.close));
  const ma = sma(values, Math.min(20, values.length));
  if (priceChart) {
    priceChart.destroy();
    priceChart = null;
  }
  priceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Price', data: values, borderColor: '#2ecc71', backgroundColor: 'rgba(46,204,113,.14)', fill: values.length > 1, tension: 0.12, spanGaps: false, clip: 5 },
        { label: 'SMA 20', data: ma, borderColor: '#f1c40f', borderDash: [6, 4], fill: false, tension: 0, spanGaps: false, clip: 5 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { grid: { color: 'rgba(255,255,255,.08)' }, ticks: { color: '#cfd3da' } },
        x: { grid: { color: 'rgba(255,255,255,.06)' }, ticks: { color: '#cfd3da', maxTicksLimit: 10 } },
      },
      plugins: { legend: { labels: { color: '#cfd3da' } }, tooltip: { mode: 'index', intersect: false } },
      animation: { duration: 400 },
    },
  });

  if (!intraday) {
    updateRangeStats(rows);
  }
}

async function loadLatestQuote(symbol) {
  const res = await callTiingo({ symbol, kind: 'intraday_latest' });
  const q = Array.isArray(res?.data) ? res.data[0] : null;
  renderQuote(q);
}

function tfParams(tf) {
  switch (tf) {
    case '1D': return { intraday: true, interval: '5min', limit: 150 };
    case '1W': return { intraday: false, limit: 7 };
    case '1M': return { intraday: false, limit: 30 };
    case '3M': return { intraday: false, limit: 70 };
    case '6M': return { intraday: false, limit: 140 };
    case '1Y': return { intraday: false, limit: 260 };
    default: return { intraday: false, limit: 30 };
  }
}

async function loadTimeframe(tf) {
  currentTimeframe = tf;
  document.querySelectorAll('#tfControls button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tf === tf);
  });
  const { intraday, interval, limit } = tfParams(tf);
  const params = intraday
    ? { symbol: currentSymbol, kind: 'intraday', interval, limit }
    : { symbol: currentSymbol, kind: 'eod', limit };
  const res = await callTiingo(params);
  const rows = Array.isArray(res?.data)
    ? res.data.slice().sort((a, b) => new Date(a.date) - new Date(b.date))
    : [];
  if (!rows.length) {
    showError('No data returned.');
    return;
  }
  renderChart(rows, intraday);
  if (intraday) {
    updateRangeStats([]);
  }
}

async function loadSymbol(symbol, name, exchange) {
  if (!symbol) return;
  currentSymbol = String(symbol).toUpperCase();
  currentSymbolName = name || currentSymbol;
  if (exchange) {
    currentExchange = String(exchange).toUpperCase();
  }
  $('stockSymbol').textContent = currentSymbol;
  $('stockName').textContent = currentSymbolName;
  $('exchangeAcronym').textContent = currentExchange ? ` ${currentExchange}` : '';
  renderWatchlist();
  showError('');
  try {
    await loadLatestQuote(currentSymbol);
  } catch (err) {
    console.warn('Failed to load latest quote', err);
  }
  try {
    await loadTimeframe(currentTimeframe);
  } catch (err) {
    console.warn('Failed to load timeframe data', err);
  }
}

async function init() {
  showError('');
  loadStoredWatchlist();
  setupWatchlist();
  setupSearch();
  renderWatchlist();
  $('stockSymbol').textContent = currentSymbol;
  $('stockName').textContent = currentSymbolName;
  $('exchangeAcronym').textContent = currentExchange ? ` ${currentExchange}` : '';
  try {
    await loadLatestQuote(currentSymbol);
  } catch (err) {
    console.warn('Initial quote load failed', err);
  }
  try {
    await loadTimeframe(currentTimeframe);
  } catch (err) {
    console.warn('Initial timeframe load failed', err);
  }

  document.querySelectorAll('#tfControls button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tf = btn.getAttribute('data-tf');
      if (!tf) return;
      await loadTimeframe(tf);
    });
  });
}

window.addEventListener('DOMContentLoaded', init);
