import { createRenderQueue, createRequestCache } from './utils/browser-cache.js';
import { enrichError, getFriendlyErrorMessage } from './utils/frontend-errors.js';
import { loadPreferences, updatePreferences } from './utils/user-preferences.js';
import { createLatestPromiseRunner, createOperationTokenSource } from './utils/task-guards.js';

const createMemoryStorage = () => {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
};

if (typeof window === 'undefined') {
  globalThis.window = {
    location: { origin: 'http://localhost' },
    localStorage: createMemoryStorage(),
  };
}

if (!window.localStorage) {
  window.localStorage = createMemoryStorage();
}

if (typeof localStorage === 'undefined') {
  globalThis.localStorage = window.localStorage;
}

if (typeof document === 'undefined') {
  const createStubElement = () => ({
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    dataset: {},
    appendChild() {},
    setAttribute() {},
    remove() {},
    replaceChildren() {},
  });
  globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => createStubElement(),
    createDocumentFragment: () => ({ appendChild() {}, firstChild: null }),
    addEventListener: () => {},
  };
}

let userPreferences = loadPreferences();
const applyPreferenceUpdate = (patch) => {
  userPreferences = updatePreferences(patch || {});
  return userPreferences;
};

// Minimal frontend logic to fetch from Netlify functions and render the UI
// Uses the existing _redirects mapping: `/api/* -> /.netlify/functions/:splat`
// So all requests go to `/api/tiingo` locally (netlify dev) and when deployed.

/* DOM helpers */
const $ = (id) => document.getElementById(id);
let loadingCounter = 0;
function showLoading(on) {
  const el = $('loading');
  if (!el) return;
  loadingCounter = Math.max(0, loadingCounter + (on ? 1 : -1));
  el.style.display = loadingCounter > 0 ? 'flex' : 'none';
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
const fmtPct = (n) => {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  const sign = num >= 0 ? '+' : '';
  return `${sign}${Math.abs(num).toFixed(2)}%`;
};

/* API wrapper */
const API = '/api';
const tiingoRequestCache = createRequestCache({ ttl: 30000, maxEntries: 80 });
const searchResultCache = createRequestCache({ ttl: 120000, maxEntries: 120 });
const newsRequestCache = createRequestCache({ ttl: 5 * 60 * 1000, maxEntries: 12 });
const eventFeedCache = createRequestCache({ ttl: 3 * 60 * 1000, maxEntries: 32 });

const scheduleWatchlistRender = createRenderQueue();
const scheduleMoversRender = createRenderQueue();
const scheduleNewsRender = createRenderQueue();
const scheduleSearchRender = createRenderQueue();
const scheduleEventFeedRender = createRenderQueue();

const runLatestTimeframeTask = createLatestPromiseRunner();
const runLatestEventFeedTask = createLatestPromiseRunner();
const runLatestNewsTask = createLatestPromiseRunner();

const timeframeLoadTokens = createOperationTokenSource();
const eventFeedLoadTokens = createOperationTokenSource();
const newsLoadTokens = createOperationTokenSource();

const timeLabelFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dateLabelFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const eventDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const eventDateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});
let timeframeButtons = [];
let timeframeLoading = false;
let lastChartSymbol = '';
let eventFeedSymbolInFlight = '';

function defaultTiingoCacheTtl(params = {}) {
  const kind = String(params?.kind || '').toLowerCase();
  if (kind === 'intraday_latest') return 10_000;
  if (kind === 'intraday') return 20_000;
  if (kind === 'eod') return 600_000;
  if (kind === 'valuation') return 15 * 60_000;
  return 60_000;
}

async function callTiingo(params, options = {}) {
  const { silent = false, forceRefresh = false, cacheTtl } = options || {};
  const url = new URL(`${API}/tiingo`, window.location.origin);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const key = url.toString();
  if (!forceRefresh) {
    const cached = tiingoRequestCache.get(key);
    if (cached) {
      if (!silent) showLoading(false);
      // Mirror "main" branch behavior: surface friendly warnings on cached hits too
      if (!silent && cached?.meta?.reason === 'exception') {
        const friendlyWarning = getFriendlyErrorMessage({
          context: 'tiingo',
          message: cached?.warning || cached?.meta?.message || '',
          detail: cached?.meta?.message || '',
          fallback: 'Live market data is temporarily unavailable. Displaying sample data.',
        });
        showError(friendlyWarning);
      } else if (!silent) {
        showError('');
      }
      return cached;
    }
  }
  if (!silent) showLoading(true);
  const ttl = cacheTtl ?? defaultTiingoCacheTtl(params);
  try {
    const loader = async () => {
      const resp = await fetch(url, { headers: { accept: 'application/json' } });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const error = new Error(data?.warning || data?.error || resp.statusText || 'Tiingo request failed.');
        error.status = resp.status;
        error.response = data;
        throw error;
      }
      if (data?.warning) console.warn('tiingo warning:', data.warning);
      const responseMeta = data?.meta && typeof data.meta === 'object' ? { ...data.meta } : {};
      const meta = {
        ...responseMeta,
        source: resp.headers.get('x-tiingo-source') || responseMeta.source || '',
        fallback: resp.headers.get('x-tiingo-fallback') || responseMeta.fallback || '',
        tokenPreview: resp.headers.get('x-tiingo-token-preview') || '',
        chosenKey: resp.headers.get('x-tiingo-chosen-key') || '',
        kind: params?.kind || responseMeta.kind || '',
      };
      return {
        body: data,
        data: data?.data,
        symbol: data?.symbol || params?.symbol || '',
        warning: data?.warning || '',
        meta,
      };
    };

    const payload = await tiingoRequestCache.resolve(key, loader, ttl);

    if (!silent) {
      if (payload?.meta?.reason === 'exception') {
        const friendlyWarning = getFriendlyErrorMessage({
          context: 'tiingo',
          message: payload?.warning || payload?.meta?.message || '',
          detail: payload?.meta?.message || '',
          fallback: 'Live market data is temporarily unavailable. Displaying sample data.',
        });
        showError(friendlyWarning);
      } else {
        showError('');
      }
    }

    return payload;
  } catch (err) {
    const enhanced = enrichError(err, {
      context: 'tiingo',
      fallback: 'Unable to load market data. Please try again shortly.',
    });
    if (!silent) {
      showError(enhanced.userMessage || enhanced.message);
    } else {
      console.warn('Tiingo request failed', enhanced);
    }
    // ensure bad entries aren’t retained
    tiingoRequestCache.delete(key);
    throw enhanced;
  } finally {
    if (!silent) showLoading(false);
  }
}

/* App state */
let priceChart = null;
let currentSymbol = userPreferences.symbol || 'AAPL';
let currentSymbolName = userPreferences.symbolName || 'Apple Inc.';
let currentExchange = userPreferences.exchange || 'XNAS';
let currentTimeframe = userPreferences.timeframe || '1D';
let watchlist = [];
let selectedExchange = userPreferences.searchExchange || '';
let searchAbortController = null;
let searchDebounceTimer = null;
let searchInputEl = null;
let searchResultsEl = null;
let exchangeFilterEl = null;
let newsAbortController = null;
let preferredNewsSource = userPreferences.newsSource || 'All';
const watchlistQuotes = new Map();
let watchlistRefreshTimer = null;
const chartEventCache = new Map();

const WATCHLIST_REFRESH_INTERVAL = 60 * 1000;
const WATCHLIST_FETCH_LIMIT = 12;
const EVENT_FEED_LIMIT = 40;
const EVENT_TYPE_LABELS = {
  news: 'News',
  filing: 'SEC Filing',
  document: 'Document',
  dividend: 'Dividend',
  split: 'Stock Split',
};
const CLOCK_ZONES = [
  { label: 'New York (ET)', tz: 'America/New_York' },
  { label: 'London (UK)', tz: 'Europe/London' },
  { label: 'Tokyo (JST)', tz: 'Asia/Tokyo' },
  { label: 'Sydney (AEST)', tz: 'Australia/Sydney' },
];

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

function ema(values, windowSize) {
  const w = Math.max(1, Math.min(windowSize || 1, values.length));
  const out = new Array(values.length).fill(null);
  const multiplier = 2 / (w + 1);
  const window = [];
  let emaPrev = null;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = Number(values[i]);
    if (!Number.isFinite(value)) {
      window.length = 0;
      sum = 0;
      emaPrev = null;
      out[i] = null;
      continue;
    }
    window.push(value);
    sum += value;
    if (window.length < w) {
      out[i] = null;
      continue;
    }
    if (window.length > w) {
      sum -= window.shift();
    }
    if (emaPrev === null) {
      emaPrev = sum / w;
    } else {
      emaPrev = (value - emaPrev) * multiplier + emaPrev;
    }
    out[i] = +emaPrev.toFixed(2);
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

function renderWatchlistNow() {
  const container = $('watchlist');
  if (!container) return;
  const fragment = document.createDocumentFragment();
  if (!watchlist.length) {
    const empty = document.createElement('div');
    empty.className = 'muted watchlist-empty';
    empty.textContent = 'No symbols yet. Search above to add.';
    fragment.appendChild(empty);
    container.replaceChildren(fragment);
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
    const stats = watchlistQuotes.get(key);
    const exchange = (stats?.exchange || item.mic || item.exchange || '').toUpperCase();
    const price = stats ? fmt(stats.price) : '—';
    const pct = stats ? fmtPct(stats.changePct) : '—';
    const changeClass = stats ? (stats.changeAbs >= 0 ? 'positive-change' : 'negative-change') : 'muted';
    const asOf = stats?.asOf ? new Date(stats.asOf).toLocaleString() : '';
    if (asOf) {
      row.title = `Last update: ${asOf}`;
    }
    row.innerHTML = `
      <div class="watchlist-info">
        <div class="watchlist-symbol">${item.symbol}</div>
        <div class="watchlist-name muted">${item.name || ''}</div>
        <div class="watchlist-quote">
          <span class="watchlist-price">${price}</span>
          <span class="watchlist-change ${changeClass}">${pct}</span>
        </div>
      </div>
      <div class="watchlist-meta">
        <span class="watchlist-exchange mono">${exchange}</span>
        <button type="button" class="watchlist-remove" data-action="remove" data-key="${key}" aria-label="Remove ${item.symbol}">&times;</button>
      </div>
    `;
    fragment.appendChild(row);
  });

  container.replaceChildren(fragment);
}

function renderWatchlist() {
  scheduleWatchlistRender(renderWatchlistNow);
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
  refreshWatchlistQuotes();
}

function removeFromWatchlist(key) {
  if (!key) return;
  watchlist = watchlist.filter((item) => getWatchlistKey(item) !== key);
  watchlistQuotes.delete(key);
  persistWatchlist();
  renderWatchlist();
  renderMarketMovers();
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
  scheduleSearchRender(() => {
    if (!searchResultsEl) return;
    if (!message) {
      searchResultsEl.innerHTML = '';
      return;
    }
    const note = document.createElement('div');
    note.className = 'search-empty muted';
    note.textContent = message;
    searchResultsEl.replaceChildren(note);
  });
}

function updateApiBadge(meta = {}) {
  const badge = $('apiKeyEcho');
  if (!badge) return;
  const preview = meta.tokenPreview || '';
  badge.textContent = preview ? `API: ${preview}` : 'API: demo/mock';
  badge.title = meta.chosenKey
    ? `Using ${meta.chosenKey}`
    : preview
      ? 'Tiingo token detected'
      : 'Tiingo token not configured — using fallback data';
  badge.classList.remove('chip-warning', 'chip-live');
  if ((meta.source || '').toLowerCase() === 'live') {
    badge.classList.add('chip-live');
  } else {
    badge.classList.add('chip-warning');
  }
}

function updateChartStatus(meta = {}, warning = '', count = 0) {
  const el = $('chartStatus');
  if (!el) return;
  const source = (meta.source || '').toLowerCase();
  const parts = [];
  let css = 'chart-status';
  if (source === 'live') {
    parts.push('Live Tiingo data');
    css += ' positive';
  } else if (source === 'eod-fallback') {
    parts.push('Tiingo EOD fallback');
    css += ' warning';
  } else if (source === 'mock') {
    parts.push('Sample data (offline)');
    css += ' warning';
  } else if (source) {
    parts.push(source.replace(/-/g, ' '));
  } else {
    parts.push('Awaiting market data…');
    css += ' warning';
  }
  if (count) {
    parts.push(`${count} pts`);
  }
  if (meta.fallback && meta.fallback !== 'mock') {
    parts.push(`fallback: ${meta.fallback}`);
  }
  if (warning) {
    parts.push(warning);
  }
  el.textContent = parts.join(' · ') || 'Awaiting market data…';
  el.className = css;
  el.title = meta.chosenKey ? `Source key: ${meta.chosenKey}` : '';
}

function computeQuoteStats(row) {
  if (!row || typeof row !== 'object') return null;
  const price = Number(row.last ?? row.close ?? row.price);
  if (!Number.isFinite(price)) return null;
  const base = Number(
    Number.isFinite(Number(row.previousClose)) ? row.previousClose
      : Number.isFinite(Number(row.prevClose)) ? row.prevClose
        : Number.isFinite(Number(row.open)) ? row.open
          : price,
  );
  const changeAbs = Number.isFinite(base) ? price - Number(base) : 0;
  const changePct = Number.isFinite(base) && Math.abs(base) > 1e-8 ? (changeAbs / Number(base)) * 100 : 0;
  return {
    price,
    changeAbs,
    changePct,
    exchange: (row.exchange || row.exchangeCode || row.mic || '').toUpperCase(),
    currency: row.currency || 'USD',
    asOf: row.date || row.timestamp || row.datetime || new Date().toISOString(),
  };
}

function setWatchlistQuote(item, row, meta = {}) {
  if (!item) return;
  const key = getWatchlistKey(item);
  if (!key) return;
  const stats = computeQuoteStats(row);
  if (!stats) return;
  watchlistQuotes.set(key, { ...stats, symbol: item.symbol, name: item.name || '', source: meta.source || '' });
}

function renderMarketMoversNow() {
  const table = $('marketMoversTable');
  if (!table) return;
  const body = table.querySelector('tbody');
  if (!body) return;
  const fragment = document.createDocumentFragment();
  const entries = (watchlist.length ? watchlist : DEFAULT_WATCHLIST)
    .map((item) => {
      const key = getWatchlistKey(item);
      const stats = watchlistQuotes.get(key);
      if (!stats) return null;
      return { ...stats, symbol: item.symbol };
    })
    .filter(Boolean);

  if (!entries.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.className = 'muted';
    cell.textContent = 'Price data unavailable. Add symbols or wait for refresh.';
    row.appendChild(cell);
    fragment.appendChild(row);
    body.replaceChildren(fragment);
    return;
  }

  entries.sort((a, b) => b.changePct - a.changePct);
  entries.slice(0, 10).forEach((entry) => {
    const tr = document.createElement('tr');
    const changeClass = entry.changeAbs >= 0 ? 'positive-change' : 'negative-change';
    tr.innerHTML = `
      <td class="mono">${entry.symbol}</td>
      <td>${fmt(entry.price)}</td>
      <td class="${changeClass}">${fmtPct(entry.changePct)}</td>
    `;
    fragment.appendChild(tr);
  });

  body.replaceChildren(fragment);
}

function renderMarketMovers() {
  scheduleMoversRender(renderMarketMoversNow);
}

async function refreshWatchlistQuotes() {
  const entries = (watchlist.length ? watchlist : DEFAULT_WATCHLIST).slice(0, WATCHLIST_FETCH_LIMIT);
  if (!entries.length) {
    watchlistQuotes.clear();
    renderMarketMovers();
    return;
  }
  const results = await Promise.all(entries.map((item) =>
    callTiingo({ symbol: item.symbol, kind: 'intraday_latest' }, { silent: true, cacheTtl: 15_000 })
      .then((res) => ({ item, res }))
      .catch((err) => {
        console.warn('Quote refresh failed', item.symbol, err);
        return null;
      })
  ));
  let updated = false;
  results.forEach((result) => {
    if (!result) return;
    const { item, res } = result;
    const rows = Array.isArray(res?.data) ? res.data : [];
    const row = rows[0] || null;
    if (row) {
      setWatchlistQuote(item, row, res.meta || {});
      updated = true;
      if (res.meta) updateApiBadge(res.meta);
    }
  });
  if (updated) {
    renderWatchlist();
  }
  renderMarketMovers();
}

function startWatchlistAutoRefresh() {
  if (watchlistRefreshTimer) {
    clearInterval(watchlistRefreshTimer);
  }
  watchlistRefreshTimer = setInterval(() => {
    refreshWatchlistQuotes();
    if (currentSymbol) {
      loadLatestQuote(currentSymbol, { silent: true }).catch(() => {});
    }
  }, WATCHLIST_REFRESH_INTERVAL);
}

function startClock() {
  const container = $('digitalClockContainer');
  if (!container) return;
  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'digital-clock-grid';
  container.appendChild(grid);

  const items = CLOCK_ZONES.map(({ label, tz }) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'clock-item';
    const zone = document.createElement('div');
    zone.className = 'clock-zone-name';
    zone.textContent = label;
    const timeEl = document.createElement('div');
    timeEl.className = 'clock-time';
    const dateEl = document.createElement('div');
    dateEl.className = 'clock-date';
    wrapper.append(zone, timeEl, dateEl);
    grid.appendChild(wrapper);
    return { timeEl, dateEl, tz };
  });

  const renderTick = () => {
    const now = Date.now();
    items.forEach(({ timeEl, dateEl, tz }) => {
      const date = new Date(now);
      timeEl.textContent = date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: tz,
      });
      dateEl.textContent = date.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: tz,
      });
    });
  };

  renderTick();
  setInterval(renderTick, 1000);
}

function formatRelativeTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes <= 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr${diffHours === 1 ? '' : 's'} ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

function renderNewsArticles(container, articles, source) {
  scheduleNewsRender(() => {
    if (!container) return;
    if (!Array.isArray(articles) || !articles.length) {
      container.innerHTML = '<div class="muted">No articles available right now.</div>';
      return;
    }
    const fragment = document.createDocumentFragment();
    articles.forEach((article) => {
      const item = document.createElement('div');
      item.className = 'news-item';
      const relative = formatRelativeTime(article.publishedAt);
      const metaParts = [article.source || source];
      if (relative) metaParts.push(relative);
      item.innerHTML = `
        <a href="${article.url}" target="_blank" rel="noopener">${article.title}</a>
        <small>${metaParts.join(' · ')}</small>
      `;
      fragment.appendChild(item);
    });
    container.replaceChildren(fragment);
  });
}

async function loadNews(source = 'All') {
  const feed = $('news-feed');
  if (!feed) return;
  const cacheKey = `news:${source}`;
  const requestToken = newsLoadTokens.next();
  const cached = newsRequestCache.get(cacheKey);
  if (cached && Array.isArray(cached.articles)) {
    if (!newsLoadTokens.isCurrent(requestToken)) return;
    renderNewsArticles(feed, cached.articles, source);
    return;
  }

  if (newsAbortController) {
    newsAbortController.abort();
  }
  newsRequestCache.delete(cacheKey);
  const controller = new AbortController();
  newsAbortController = controller;
  feed.innerHTML = '<div class="muted">Loading news…</div>';

  try {
    const { cancelled, result: payload } = await runLatestNewsTask(async () => {
      const response = await newsRequestCache.resolve(cacheKey, async () => {
        const resp = await fetch(`${API}/news?source=${encodeURIComponent(source)}`, {
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          throw new Error(body?.error || resp.statusText);
        }
        const articles = Array.isArray(body?.articles) ? body.articles : [];
        return { articles };
      }, 3 * 60 * 1000);
      return response;
    });
    if (!newsLoadTokens.isCurrent(requestToken) || controller.signal.aborted || cancelled) return;
    const safePayload = payload || { articles: [] };
    renderNewsArticles(feed, safePayload.articles || [], source);
  } catch (err) {
    if (!newsLoadTokens.isCurrent(requestToken) || controller.signal.aborted) return;
    scheduleNewsRender(() => {
      feed.innerHTML = `<div class="muted">News unavailable. ${err.message || err}</div>`;
    });
    newsRequestCache.delete(cacheKey);
  } finally {
    if (newsLoadTokens.isCurrent(requestToken) && newsAbortController === controller) {
      newsAbortController = null;
    }
  }
}

function setupNews() {
  const container = $('newsApiButtons');
  if (!container) return;
  const buttons = Array.from(container.querySelectorAll('button[data-source]'));
  const availableSources = buttons.map((button) => button.dataset.source || 'All');
  const initialSource = availableSources.includes(preferredNewsSource) ? preferredNewsSource : 'All';
  preferredNewsSource = initialSource;
  buttons.forEach((button) => {
    const source = button.dataset.source || 'All';
    button.classList.toggle('active', source === initialSource);
  });
  container.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-source]');
    if (!button) return;
    container.querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('active', btn === button);
    });
    preferredNewsSource = button.dataset.source || 'All';
    applyPreferenceUpdate({ newsSource: preferredNewsSource });
    loadNews(preferredNewsSource);
  });
  loadNews(initialSource);
}

function normalizeEventTimestamp(value) {
  if (!value) return { iso: '', ms: 0 };
  const tryParse = (input) => {
    if (!input) return null;
    const parsed = new Date(input);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  let date = tryParse(value);
  if (!date && typeof value === 'string') {
    date = tryParse(`${value}T00:00:00Z`);
  }
  if (!date) return { iso: '', ms: 0 };
  return { iso: date.toISOString(), ms: date.getTime() };
}

function formatEventDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return eventDateTimeFormatter.format(date);
}

function formatEventDateOnly(value) {
  if (!value) return '';
  const { iso } = normalizeEventTimestamp(value);
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return eventDateFormatter.format(date);
}

function mapNewsEvent(article) {
  if (!article) return null;
  const title = article.headline || article.title || article.summary || '';
  const { iso, ms } = normalizeEventTimestamp(article.publishedAt || article.date);
  const id = article.id || article.url || `${title || 'news'}-${ms}`;
  return {
    id,
    type: 'news',
    tag: EVENT_TYPE_LABELS.news,
    title: title || 'News update',
    summary: article.summary || '',
    url: article.url || '',
    timestamp: iso,
    timeValue: ms,
    source: article.source || '',
  };
}

function mapDocumentEvent(document) {
  if (!document) return null;
  const title = document.headline || document.title || document.summary || document.documentType || 'Company filing';
  const { iso, ms } = normalizeEventTimestamp(document.publishedAt || document.date);
  const docType = typeof document.documentType === 'string' ? document.documentType.trim() : '';
  const tag = docType || EVENT_TYPE_LABELS.filing;
  const id = document.id || document.url || `${tag}-${ms}`;
  return {
    id,
    type: 'filing',
    tag,
    title,
    summary: document.summary || '',
    url: document.url || '',
    timestamp: iso,
    timeValue: ms,
    source: document.source || 'SEC Filing',
    documentType: docType && docType !== tag ? docType : '',
  };
}

function mapDividendEvent(dividend, symbol) {
  if (!dividend) return null;
  const { iso, ms } = normalizeEventTimestamp(dividend.exDate || dividend.payDate || dividend.recordDate);
  const amount = Number(dividend.amount);
  const hasAmount = Number.isFinite(amount);
  const currency = dividend.currency || 'USD';
  const amountLabel = hasAmount ? `${currency} ${fmt(amount)}` : '';
  const title = amountLabel ? `Dividend ${amountLabel}` : 'Dividend announcement';
  const detailsParts = [];
  if (dividend.exDate) detailsParts.push(`Ex-date ${formatEventDateOnly(dividend.exDate)}`);
  if (dividend.recordDate) detailsParts.push(`Record ${formatEventDateOnly(dividend.recordDate)}`);
  if (dividend.payDate) detailsParts.push(`Payable ${formatEventDateOnly(dividend.payDate)}`);
  const id = `dividend-${symbol || ''}-${dividend.exDate || iso || ms}-${hasAmount ? amount.toFixed(4) : 'na'}`;
  return {
    id,
    type: 'dividend',
    tag: EVENT_TYPE_LABELS.dividend,
    title,
    summary: '',
    details: detailsParts.join(' · '),
    url: '',
    timestamp: iso,
    timeValue: ms,
    source: 'Corporate Action',
    amount: hasAmount ? amount : null,
    currency,
  };
}

function mapSplitEvent(split, symbol) {
  if (!split) return null;
  const { iso, ms } = normalizeEventTimestamp(split.exDate || split.payDate);
  const numerator = Number(split.numerator);
  const denominator = Number(split.denominator);
  let ratioLabel = '';
  if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
    ratioLabel = `${numerator}-for-${denominator}`;
  }
  const title = ratioLabel ? `Stock split ${ratioLabel}` : 'Stock split announced';
  const detailsParts = [];
  if (split.exDate) detailsParts.push(`Ex-date ${formatEventDateOnly(split.exDate)}`);
  if (split.payDate) detailsParts.push(`Payable ${formatEventDateOnly(split.payDate)}`);
  const id = `split-${symbol || ''}-${split.exDate || iso || ms}-${ratioLabel || 'ratio'}`;
  return {
    id,
    type: 'split',
    tag: EVENT_TYPE_LABELS.split,
    title,
    summary: '',
    details: detailsParts.join(' · '),
    url: '',
    timestamp: iso,
    timeValue: ms,
    source: 'Corporate Action',
    ratio: ratioLabel,
  };
}

function summariseEventStatus(sources = [], warnings = [], errors = [], count = 0) {
  const normalizedSources = sources
    .map((meta) => (meta && typeof meta.source === 'string' ? meta.source.toLowerCase() : ''))
    .filter(Boolean);
  const hasMock = normalizedSources.includes('mock');
  const hasLive = normalizedSources.includes('live');
  const hasFallback = normalizedSources.some((src) => src !== 'mock' && src !== 'live');
  const cleanWarnings = [...new Set((warnings || []).filter(Boolean).map((msg) => String(msg)))];
  const cleanErrors = [...new Set((errors || []).filter(Boolean).map((msg) => String(msg)))];
  let text = 'Events: —';
  if (hasMock) {
    text = 'Events: Sample';
  } else if (hasFallback) {
    text = 'Events: Fallback';
  } else if (hasLive) {
    text = 'Events: Live';
  } else if (cleanErrors.length) {
    text = 'Events: Unavailable';
  } else if (count) {
    text = 'Events: Mixed';
  }
  const className = hasMock || hasFallback || cleanErrors.length ? 'chip chip-warning' : hasLive ? 'chip chip-live' : 'chip';
  const titleParts = [...cleanWarnings, ...cleanErrors];
  return {
    text,
    className,
    title: titleParts.join(' • '),
    warnings: cleanWarnings,
    errors: cleanErrors,
  };
}

function updateEventFeedBadge(status = {}) {
  const badge = $('eventFeedBadge');
  if (!badge) return;
  scheduleEventFeedRender(() => {
    badge.textContent = status.text || 'Events: —';
    const nextClass = typeof status.className === 'string' && status.className.includes('chip')
      ? status.className
      : `chip${status.className ? ` ${status.className}` : ''}`;
    badge.className = nextClass.trim() || 'chip';
    if (status.title) {
      badge.title = status.title;
    } else {
      badge.removeAttribute('title');
    }
  });
}

function renderEventFeed(container, items = [], status = {}) {
  scheduleEventFeedRender(() => {
    if (!container) return;
    const fragment = document.createDocumentFragment();
    const alerts = [...new Set([...(status.warnings || []), ...(status.errors || [])])].filter(Boolean);
    if (alerts.length) {
      const warningEl = document.createElement('div');
      warningEl.className = 'event-feed-warning';
      warningEl.textContent = alerts.join(' • ');
      fragment.appendChild(warningEl);
    }
    const validItems = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!validItems.length) {
      const empty = document.createElement('div');
      empty.className = 'event-feed-empty';
      empty.textContent = 'No events available for this symbol right now.';
      fragment.appendChild(empty);
      container.replaceChildren(fragment);
      return;
    }
    validItems.forEach((event) => {
      const item = document.createElement('article');
      item.className = `event-item event-type-${event.type || 'event'}`;
      item.setAttribute('role', 'article');
      if (event.timestamp) {
        item.dataset.timestamp = event.timestamp;
      }

      const header = document.createElement('div');
      header.className = 'event-item-header';

      const typeLabel = document.createElement('span');
      typeLabel.className = 'event-item-type';
      typeLabel.textContent = event.tag || EVENT_TYPE_LABELS[event.type] || 'Update';
      header.appendChild(typeLabel);

      const metaParts = [];
      if (event.source && event.source.toLowerCase() !== typeLabel.textContent.toLowerCase()) {
        metaParts.push(event.source);
      }
      if (event.documentType && event.documentType.toLowerCase() !== typeLabel.textContent.toLowerCase()) {
        metaParts.push(event.documentType);
      }
      if (Number.isFinite(event.amount)) {
        metaParts.push(`${event.currency || 'USD'} ${fmt(event.amount)}`);
      }
      if (event.ratio) {
        metaParts.push(event.ratio);
      }
      if (event.timestamp) {
        const absolute = formatEventDateTime(event.timestamp);
        const relative = formatRelativeTime(event.timestamp);
        if (absolute) {
          metaParts.push(relative ? `${absolute} · ${relative}` : absolute);
        }
      }
      if (metaParts.length) {
        const meta = document.createElement('span');
        meta.textContent = metaParts.join(' · ');
        header.appendChild(meta);
      }
      item.appendChild(header);

      const titleEl = document.createElement(event.url ? 'a' : 'div');
      titleEl.className = 'event-item-title';
      titleEl.textContent = event.title || 'Update';
      if (event.url) {
        titleEl.href = event.url;
        titleEl.target = '_blank';
        titleEl.rel = 'noopener';
      }
      item.appendChild(titleEl);

      if (event.summary) {
        const summaryEl = document.createElement('p');
        summaryEl.className = 'event-item-summary';
        summaryEl.textContent = event.summary;
        item.appendChild(summaryEl);
      }

      if (event.details) {
        const detailsEl = document.createElement('div');
        detailsEl.className = 'event-item-details';
        detailsEl.textContent = event.details;
        item.appendChild(detailsEl);
      }

      fragment.appendChild(item);
    });

    container.replaceChildren(fragment);
  });
}

async function loadEventFeed(symbol) {
  const container = $('eventFeed');
  if (!container) return;
  const target = String(symbol || '').toUpperCase() || 'AAPL';
  eventFeedSymbolInFlight = target;
  const requestToken = eventFeedLoadTokens.next();

  const cacheKey = `events:${target}`;
  const cached = eventFeedCache.get(cacheKey);
  if (cached) {
    if (!eventFeedLoadTokens.isCurrent(requestToken) || eventFeedSymbolInFlight !== target) return;
    renderEventFeed(container, cached.items, cached.status);
    updateEventFeedBadge(cached.status);
    return;
  }

  updateEventFeedBadge({ text: 'Events: Loading…', className: 'chip' });
  scheduleEventFeedRender(() => {
    container.innerHTML = '<div class="event-feed-empty">Loading events…</div>';
  });

  try {
    const { cancelled, result: payload } = await runLatestEventFeedTask(async () => eventFeedCache.resolve(
      cacheKey,
      async () => {
        const [newsRes, docsRes, actionsRes] = await Promise.all([
          callTiingo({ symbol: target, kind: 'news', limit: 20 }, { silent: true }).catch((error) => ({ error })),
          callTiingo({ symbol: target, kind: 'documents', limit: 12 }, { silent: true }).catch((error) => ({ error })),
          callTiingo({ symbol: target, kind: 'actions' }, { silent: true }).catch((error) => ({ error })),
        ]);

        const sources = [];
        const warnings = [];
        const errors = [];
        const events = [];

        const pushEvent = (event) => {
          if (event) events.push(event);
        };

        if (newsRes) {
          if (newsRes.error) {
            errors.push('News unavailable.');
          } else {
            if (newsRes.meta) sources.push(newsRes.meta);
            if (newsRes.warning) warnings.push(newsRes.warning);
            if (Array.isArray(newsRes.data)) {
              newsRes.data.forEach((article) => pushEvent(mapNewsEvent(article)));
            }
          }
        }

        if (docsRes) {
          if (docsRes.error) {
            errors.push('Filings unavailable.');
          } else {
            if (docsRes.meta) sources.push(docsRes.meta);
            if (docsRes.warning) warnings.push(docsRes.warning);
            if (Array.isArray(docsRes.data)) {
              docsRes.data.forEach((doc) => pushEvent(mapDocumentEvent(doc)));
            }
          }
        }

        if (actionsRes) {
          if (actionsRes.error) {
            errors.push('Corporate actions unavailable.');
          } else {
            if (actionsRes.meta) sources.push(actionsRes.meta);
            if (actionsRes.warning) warnings.push(actionsRes.warning);
            const dividends = Array.isArray(actionsRes.data?.dividends) ? actionsRes.data.dividends : [];
            dividends.forEach((dividend) => pushEvent(mapDividendEvent(dividend, target)));
            const splits = Array.isArray(actionsRes.data?.splits) ? actionsRes.data.splits : [];
            splits.forEach((split) => pushEvent(mapSplitEvent(split, target)));
          }
        }

        const deduped = [];
        const seen = new Set();
        events.forEach((event) => {
          if (!event) return;
          const key = `${event.type}:${event.id}`;
          if (seen.has(key)) return;
          seen.add(key);
          deduped.push(event);
        });

        deduped.sort((a, b) => {
          const diff = (b.timeValue || 0) - (a.timeValue || 0);
          if (diff !== 0) return diff;
          return (b.id || '').localeCompare(a.id || '');
        });

        const limited = deduped.slice(0, EVENT_FEED_LIMIT);
        const status = summariseEventStatus(sources, warnings, errors, limited.length);
        return { items: limited, status };
      },
      3 * 60 * 1000,
    ));

    if (!eventFeedLoadTokens.isCurrent(requestToken) || cancelled || eventFeedSymbolInFlight !== target) return;
    const data = payload || { items: [], status: {} };
    renderEventFeed(container, data.items, data.status);
    updateEventFeedBadge(data.status);
  } catch (error) {
    if (!eventFeedLoadTokens.isCurrent(requestToken) || eventFeedSymbolInFlight !== target) return;
    console.warn('Failed to load event feed', error);
    eventFeedCache.delete(cacheKey);
    const status = summariseEventStatus([], [], ['Events unavailable.'], 0);
    updateEventFeedBadge(status);
    scheduleEventFeedRender(() => {
      container.innerHTML = '<div class="event-feed-empty">Events unavailable right now.</div>';
    });
  }
}

function getStoredProfile() {
  try {
    const raw = JSON.parse(localStorage.getItem('userProfile') || 'null');
    if (raw && typeof raw === 'object') {
      return { name: raw.name || '', email: raw.email || '' };
    }
  } catch (err) {
    console.warn('Failed to parse stored profile', err);
  }
  return { name: '', email: '' };
}

function saveProfile(profile) {
  localStorage.setItem('userProfile', JSON.stringify({
    name: profile.name || '',
    email: profile.email || '',
  }));
}

async function sendWatchlistSummary() {
  const statusEl = $('sendSummaryStatus');
  const btn = $('sendSummaryBtn');
  const nameEl = $('userName');
  const emailEl = $('userEmail');
  if (!statusEl || !btn || !nameEl || !emailEl) return;
  const profile = { name: nameEl.value.trim(), email: emailEl.value.trim() };
  if (!profile.email) {
    statusEl.textContent = 'Add your email address before sending a summary.';
    statusEl.className = 'status-msg error';
    return;
  }
  saveProfile(profile);
  const universe = watchlist.length ? watchlist : DEFAULT_WATCHLIST;
  const lines = universe.map((item) => {
    const stats = watchlistQuotes.get(getWatchlistKey(item));
    const price = stats ? fmt(stats.price) : '—';
    const pct = stats ? fmtPct(stats.changePct) : '—';
    return `${item.symbol} ${price} (${pct})`;
  });
  statusEl.textContent = 'Sending summary…';
  statusEl.className = 'status-msg';
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/sendEmail`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        template_params: {
          user_name: profile.name || 'Trader',
          user_email: profile.email,
          watchlist_lines: lines.join('\n'),
          generated_at: new Date().toISOString(),
        },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) {
      throw new Error(body?.error || res.statusText || 'Unable to send summary');
    }
    statusEl.textContent = 'Summary sent successfully!';
    statusEl.className = 'status-msg success';
  } catch (err) {
    statusEl.textContent = err.message || 'Unable to send summary.';
    statusEl.className = 'status-msg error';
  } finally {
    btn.disabled = false;
    setTimeout(() => {
      statusEl.textContent = '';
      statusEl.className = 'status-msg';
    }, 4000);
  }
}

function setupProfile() {
  const form = $('profileForm');
  if (!form) return;
  const nameEl = $('userName');
  const emailEl = $('userEmail');
  const confirmationEl = $('saveConfirmation');
  const stored = getStoredProfile();
  if (nameEl) nameEl.value = stored.name || '';
  if (emailEl) emailEl.value = stored.email || '';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const profile = {
      name: nameEl?.value.trim() || '',
      email: emailEl?.value.trim() || '',
    };
    saveProfile(profile);
    if (confirmationEl) {
      confirmationEl.textContent = 'Details saved successfully!';
      setTimeout(() => {
        confirmationEl.textContent = '';
      }, 3000);
    }
  });
  const sendBtn = $('sendSummaryBtn');
  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      sendWatchlistSummary();
    });
  }
}

function setSearchLoading() {
  if (!searchResultsEl) return;
  scheduleSearchRender(() => {
    if (!searchResultsEl) return;
    searchResultsEl.innerHTML = '<div class="search-loading">Searching…</div>';
  });
}

function renderSearchResults(items) {
  if (!searchResultsEl) return;
  if (!Array.isArray(items) || !items.length) {
    clearSearchResults('No matching instruments.');
    return;
  }

  scheduleSearchRender(() => {
    if (!searchResultsEl) return;
    const fragment = document.createDocumentFragment();
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
      fragment.appendChild(row);
    });
    searchResultsEl.replaceChildren(fragment);
  });
}

async function performSearch(query) {
  const q = query.trim();
  if (q.length < 2) {
    clearSearchResults('Keep typing to search…');
    return;
  }

  const key = `${(selectedExchange || 'ALL').toUpperCase()}::${q.toUpperCase()}`;
  const cached = searchResultCache.get(key);
  if (cached) {
    renderSearchResults(cached);
    return;
  }

  if (searchAbortController) {
    searchAbortController.abort();
  }
  const controller = new AbortController();
  searchAbortController = controller;
  setSearchLoading();

  try {
    const items = await searchResultCache.resolve(key, async () => {
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
      const items = Array.isArray(payload?.data) ? payload.data.slice(0, 12) : [];
      return items;
    }, 2 * 60 * 1000);
    if (controller.signal.aborted) return;
    renderSearchResults(items);
  } catch (err) {
    if (controller.signal.aborted) return;
    console.error('Search request failed', err);
    searchResultCache.delete(key);
    clearSearchResults('Search unavailable. Try again later.');
  } finally {
    if (searchAbortController === controller) {
      searchAbortController = null;
    }
  }
}

function setupSearch() {
  searchInputEl = $('stockSearchInput');
  searchResultsEl = $('searchResults');
  exchangeFilterEl = $('exchangeFilters');

  if (exchangeFilterEl) {
    if (selectedExchange) {
      const hasOption = Array.from(exchangeFilterEl.options || []).some((option) => option.value === selectedExchange);
      if (hasOption) {
        exchangeFilterEl.value = selectedExchange;
      } else {
        selectedExchange = '';
      }
    }
    if (!selectedExchange) {
      selectedExchange = exchangeFilterEl.value || '';
    }
    exchangeFilterEl.addEventListener('change', () => {
      selectedExchange = exchangeFilterEl.value || '';
      applyPreferenceUpdate({ searchExchange: selectedExchange });
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

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatChartLabel(value, intraday) {
  const date = parseDate(value);
  if (!date) return '';
  return intraday ? timeLabelFormatter.format(date) : dateLabelFormatter.format(date);
}

const EVENT_TYPE_META = {
  earnings: { color: '#f39c12', shape: 'triangle', label: 'Earnings' },
  filing: { color: '#2980b9', shape: 'rectRot', label: 'Filing' },
  dividend: { color: '#9b59b6', shape: 'circle', label: 'Dividend' },
  split: { color: '#1abc9c', shape: 'rect', label: 'Split' },
  default: { color: '#95a5a6', shape: 'circle', label: 'Event' },
};

const getEventMeta = (type) => EVENT_TYPE_META[type] || EVENT_TYPE_META.default;

const normaliseDateKey = (value) => {
  const date = parseDate(value);
  if (!date) return '';
  return date.toISOString().slice(0, 10);
};

async function loadChartEventsForSymbol(symbol) {
  const key = String(symbol || '').toUpperCase();
  if (!key) return [];
  if (chartEventCache.has(key)) {
    return chartEventCache.get(key);
  }

  const loader = (async () => {
    const [statementsRes, filingsRes, actionsRes] = await Promise.allSettled([
      callTiingo({ symbol: key, kind: 'statements', limit: 8 }, { silent: true }).catch(() => null),
      callTiingo({ symbol: key, kind: 'filings', limit: 12 }, { silent: true }).catch(() => null),
      callTiingo({ symbol: key, kind: 'actions' }, { silent: true }).catch(() => null),
    ]);

    const events = [];

    if (statementsRes.status === 'fulfilled') {
      const incomeRows = statementsRes.value?.data?.income || [];
      incomeRows.forEach((row, index) => {
        const dateKey = normaliseDateKey(row?.reportDate || row?.endDate || row?.date);
        if (!dateKey) return;
        const meta = getEventMeta('earnings');
        const details = [];
        if (Number.isFinite(Number(row?.earningsPerShare))) {
          details.push(`EPS ${Number(row.earningsPerShare).toFixed(2)}`);
        }
        if (Number.isFinite(Number(row?.revenue))) {
          details.push(`Revenue ${fmt(row.revenue)}`);
        }
        events.push({
          id: `earnings-${dateKey}-${index}`,
          type: 'earnings',
          date: dateKey,
          title: row?.period ? `${meta.label} ${row.period}` : meta.label,
          description: details.join(' · '),
          style: meta,
        });
      });
    }

    if (filingsRes.status === 'fulfilled') {
      const filings = Array.isArray(filingsRes.value?.data) ? filingsRes.value.data : [];
      filings.forEach((filing) => {
        const dateKey = normaliseDateKey(filing?.publishedAt || filing?.date);
        if (!dateKey) return;
        const meta = getEventMeta('filing');
        events.push({
          id: `filing-${filing?.id || dateKey}`,
          type: 'filing',
          date: dateKey,
          title: filing?.documentType ? `${meta.label} ${filing.documentType}` : meta.label,
          description: filing?.headline || filing?.summary || '',
          style: meta,
        });
      });
    }

    if (actionsRes.status === 'fulfilled') {
      const dividends = Array.isArray(actionsRes.value?.data?.dividends)
        ? actionsRes.value.data.dividends
        : [];
      dividends.forEach((dividend, index) => {
        const dateKey = normaliseDateKey(dividend?.exDate || dividend?.payDate);
        if (!dateKey) return;
        const meta = getEventMeta('dividend');
        const amount = Number(dividend?.amount);
        events.push({
          id: `dividend-${dateKey}-${index}`,
          type: 'dividend',
          date: dateKey,
          title: meta.label,
          description: Number.isFinite(amount) ? `Ex-Date • ${fmt(amount)}` : 'Ex-Date',
          style: meta,
        });
      });

      const splits = Array.isArray(actionsRes.value?.data?.splits) ? actionsRes.value.data.splits : [];
      splits.forEach((split, index) => {
        const dateKey = normaliseDateKey(split?.exDate || split?.payDate);
        if (!dateKey) return;
        const meta = getEventMeta('split');
        const numerator = Number(split?.numerator);
        const denominator = Number(split?.denominator);
        const ratio = Number.isFinite(numerator) && Number.isFinite(denominator)
          ? `${numerator}:${denominator}`
          : '';
        events.push({
          id: `split-${dateKey}-${index}`,
          type: 'split',
          date: dateKey,
          title: meta.label,
          description: ratio ? `Ratio ${ratio}` : '',
          style: meta,
        });
      });
    }

    events.sort((a, b) => new Date(a.date) - new Date(b.date));
    return events;
  })();

  chartEventCache.set(key, loader);
  try {
    const events = await loader;
    return events;
  } catch (err) {
    chartEventCache.delete(key);
    console.warn('Failed to load chart events', err);
    return [];
  }
}

function updateTimeframeButtons(activeTf) {
  timeframeButtons.forEach((btn) => {
    const isActive = btn.dataset.tf === activeTf;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
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

function renderChart(rows, intraday, events = []) {
  const canvas = $('stockChart');
  if (!canvas || !Array.isArray(rows)) return;

  const labels = [];
  const numericValues = [];
  const plottedValues = [];
  const dateKeys = [];
  let validValueCount = 0;

  rows.forEach((row) => {
    labels.push(formatChartLabel(row?.date, intraday));
    const raw = Number(row?.close ?? row?.last ?? row?.price);
    numericValues.push(raw);
    dateKeys.push(normaliseDateKey(row?.date));
    if (Number.isFinite(raw)) {
      const rounded = Number(raw.toFixed(2));
      plottedValues.push(rounded);
      validValueCount += 1;
    } else {
      plottedValues.push(null);
    }
  });

  const sma20 = sma(numericValues, Math.min(20, numericValues.length));
  const sma50 = sma(numericValues, Math.min(50, numericValues.length));
  const ema12 = ema(numericValues, Math.min(12, numericValues.length));
  const ema26 = ema(numericValues, Math.min(26, numericValues.length));
  const hasMultiplePoints = validValueCount > 1;
  const animation = { duration: intraday ? 280 : 400, easing: 'easeOutCubic' };
  const xTickLimit = intraday ? 8 : 10;

  const eventsByDate = new Map();
  events.forEach((event) => {
    const key = event?.date ? normaliseDateKey(event.date) : '';
    if (!key) return;
    if (!eventsByDate.has(key)) {
      eventsByDate.set(key, []);
    }
    eventsByDate.get(key).push(event);
  });

  const eventSeries = dateKeys.map((key, index) => {
    const eventList = eventsByDate.get(key);
    if (!eventList || !eventList.length) return null;
    let value = plottedValues[index];
    if (!Number.isFinite(value)) {
      for (let back = index - 1; back >= 0; back -= 1) {
        if (Number.isFinite(plottedValues[back])) {
          value = plottedValues[back];
          break;
        }
      }
    }
    if (!Number.isFinite(value)) {
      for (let forward = index + 1; forward < plottedValues.length; forward += 1) {
        if (Number.isFinite(plottedValues[forward])) {
          value = plottedValues[forward];
          break;
        }
      }
    }
    if (!Number.isFinite(value)) return null;
    const style = eventList[eventList.length - 1]?.style || getEventMeta();
    return {
      y: value,
      events: eventList,
      style,
      label: eventList.map((evt) => evt.title).join(' • '),
    };
  });

  const tooltipCallbacks = {
    label(context) {
      if (context.dataset?.metaType === 'event') {
        const raw = context.raw;
        if (!raw || !raw.events || !raw.events.length) return null;
        return raw.events.map((evt) => {
          const base = evt?.title || context.dataset.label || 'Event';
          return evt?.description ? `${base}: ${evt.description}` : base;
        });
      }
      const datasetLabel = context.dataset?.label || '';
      const value = Number.isFinite(context.parsed?.y)
        ? context.parsed.y
        : Number.isFinite(Number(context.parsed))
          ? Number(context.parsed)
          : null;
      if (!Number.isFinite(value)) return null;
      return `${datasetLabel}: ${fmt(value)}`;
    },
  };

  const datasets = [
    {
      label: 'Price',
      data: plottedValues,
      borderColor: '#2ecc71',
      backgroundColor: 'rgba(46,204,113,.14)',
      fill: hasMultiplePoints,
      tension: 0.12,
      spanGaps: false,
      clip: 5,
      pointRadius: 0,
      borderWidth: 2,
      order: 0,
    },
    {
      label: 'SMA 20',
      data: sma20,
      borderColor: '#f1c40f',
      borderDash: [6, 4],
      fill: false,
      tension: 0,
      spanGaps: false,
      clip: 5,
      pointRadius: 0,
      borderWidth: 2,
      order: 1,
    },
    {
      label: 'SMA 50',
      data: sma50,
      borderColor: '#3498db',
      borderDash: [4, 4],
      fill: false,
      tension: 0,
      spanGaps: false,
      clip: 5,
      pointRadius: 0,
      borderWidth: 2,
      order: 1,
    },
    {
      label: 'EMA 12',
      data: ema12,
      borderColor: '#e74c3c',
      borderDash: [],
      fill: false,
      tension: 0.12,
      spanGaps: false,
      clip: 5,
      pointRadius: 0,
      borderWidth: 1.5,
      order: 2,
    },
    {
      label: 'EMA 26',
      data: ema26,
      borderColor: '#8e44ad',
      borderDash: [2, 2],
      fill: false,
      tension: 0.1,
      spanGaps: false,
      clip: 5,
      pointRadius: 0,
      borderWidth: 1.5,
      order: 2,
    },
    {
      label: 'Events',
      data: eventSeries,
      borderColor: 'transparent',
      backgroundColor: 'transparent',
      pointRadius: (ctx) => (ctx?.raw && ctx.raw.events ? 5 : 0),
      pointHoverRadius: (ctx) => (ctx?.raw && ctx.raw.events ? 7 : 0),
      pointBackgroundColor: (ctx) => ctx?.raw?.style?.color || EVENT_TYPE_META.default.color,
      pointBorderColor: (ctx) => ctx?.raw?.style?.color || EVENT_TYPE_META.default.color,
      pointStyle: (ctx) => ctx?.raw?.style?.shape || EVENT_TYPE_META.default.shape,
      hitRadius: 14,
      showLine: false,
      order: 3,
      metaType: 'event',
    },
  ];

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation,
    interaction: { mode: 'nearest', intersect: false },
    scales: {
      y: { grid: { color: 'rgba(255,255,255,.08)' }, ticks: { color: '#cfd3da' } },
      x: { grid: { color: 'rgba(255,255,255,.06)' }, ticks: { color: '#cfd3da', maxTicksLimit: xTickLimit } },
    },
    plugins: {
      legend: { labels: { color: '#cfd3da' } },
      tooltip: { mode: 'index', intersect: false, callbacks: tooltipCallbacks },
    },
  };

  if (!priceChart) {
    // eslint-disable-next-line no-undef
    priceChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets,
      },
      options: chartOptions,
    });
  } else {
    priceChart.data.labels = labels;
    priceChart.data.datasets = datasets;
    priceChart.options.animation = chartOptions.animation;
    priceChart.options.interaction = chartOptions.interaction;
    priceChart.options.scales = {
      ...(priceChart.options.scales || {}),
      y: { ...(priceChart.options.scales?.y || {}), ...chartOptions.scales.y },
      x: { ...(priceChart.options.scales?.x || {}), ...chartOptions.scales.x },
    };
    priceChart.options.plugins = {
      ...(priceChart.options.plugins || {}),
      legend: { ...(priceChart.options.plugins?.legend || {}), ...chartOptions.plugins.legend },
      tooltip: { ...(priceChart.options.plugins?.tooltip || {}), ...chartOptions.plugins.tooltip },
    };
    priceChart.update('active');
  }

  if (!intraday) {
    updateRangeStats(rows);
  } else {
    updateRangeStats([]);
  }
}

async function loadLatestQuote(symbol, options = {}) {
  const res = await callTiingo({ symbol, kind: 'intraday_latest' }, options);
  const q = Array.isArray(res?.data) ? res.data[0] : null;
  if (res?.meta) updateApiBadge(res.meta);
  renderQuote(q);
  const match = watchlist.find((item) => item.symbol === String(symbol).toUpperCase());
  if (match && q) {
    setWatchlistQuote(match, q, res.meta || {});
    renderWatchlist();
    renderMarketMovers();
  }
  return { quote: q, meta: res?.meta, warning: res?.warning };
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

async function loadTimeframe(tf, { force = false } = {}) {
  if (!tf) return;
  const target = String(tf).toUpperCase();
  const sameTimeframe = target === currentTimeframe;
  const symbolForRequest = currentSymbol;
  const symbolChanged = symbolForRequest !== lastChartSymbol;
  if (!force && sameTimeframe && priceChart && !symbolChanged) {
    updateTimeframeButtons(target);
    return;
  }

  const requestToken = timeframeLoadTokens.next();
  timeframeLoading = true;
  currentTimeframe = target;
  updateTimeframeButtons(target);
  applyPreferenceUpdate({ timeframe: currentTimeframe });

  try {
    const { cancelled, result: payload } = await runLatestTimeframeTask(async () => {
      const { intraday, interval, limit } = tfParams(target);
      const params = intraday
        ? { symbol: symbolForRequest, kind: 'intraday', interval, limit }
        : { symbol: symbolForRequest, kind: 'eod', limit };
      const eventsPromise = loadChartEventsForSymbol(symbolForRequest);
      const res = await callTiingo(params);
      const rows = Array.isArray(res?.data)
        ? res.data.slice().sort((a, b) => new Date(a.date) - new Date(b.date))
        : [];
      const events = await eventsPromise;
      return {
        rows,
        intraday,
        events,
        meta: res?.meta,
        warning: res?.warning,
      };
    });

    if (!timeframeLoadTokens.isCurrent(requestToken) || cancelled) return;

    const { rows = [], intraday, events = [], meta = null, warning = '' } = payload || {};
    if (!rows.length) {
      showError('No data returned.');
      updateChartStatus(meta || {}, warning || 'No data returned', 0);
      return;
    }
    renderChart(rows, intraday, events);
    updateChartStatus(meta || {}, warning || '', rows.length);
    if (meta) updateApiBadge(meta);
    lastChartSymbol = symbolForRequest;
  } catch (error) {
    if (!timeframeLoadTokens.isCurrent(requestToken)) return;
    throw error;
  } finally {
    if (timeframeLoadTokens.isCurrent(requestToken)) {
      timeframeLoading = false;
    }
  }
}

async function loadSymbol(symbol, name, exchange) {
  if (!symbol) return;
  currentSymbol = String(symbol).toUpperCase();
  currentSymbolName = name || currentSymbol;
  if (exchange) {
    currentExchange = String(exchange).toUpperCase();
  }
  applyPreferenceUpdate({
    symbol: currentSymbol,
    symbolName: currentSymbolName,
    exchange: currentExchange || '',
  });
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
  loadEventFeed(currentSymbol).catch((err) => {
    console.warn('Failed to load event feed', err);
  });
}

async function init() {
  showError('');
  loadStoredWatchlist();
  setupWatchlist();
  setupSearch();
  setupNews();
  setupProfile();
  startClock();
  renderWatchlist();
  renderMarketMovers();
  updateApiBadge({});
  const tfControls = $('tfControls');
  timeframeButtons = tfControls ? Array.from(tfControls.querySelectorAll('button')) : [];
  updateTimeframeButtons(currentTimeframe);
  timeframeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tf = btn.getAttribute('data-tf');
      if (!tf) return;
      loadTimeframe(tf).catch((err) => {
        console.warn('Failed to load timeframe data', err);
      });
    });
  });
  $('stockSymbol').textContent = currentSymbol;
  $('stockName').textContent = currentSymbolName;
  $('exchangeAcronym').textContent = currentExchange ? ` ${currentExchange}` : '';
  try {
    await loadLatestQuote(currentSymbol);
  } catch (err) {
    console.warn('Initial quote load failed', err);
  }
  try {
    await loadTimeframe(currentTimeframe, { force: true });
  } catch (err) {
    console.warn('Initial timeframe load failed', err);
  }
  try {
    await loadEventFeed(currentSymbol);
  } catch (err) {
    console.warn('Initial event feed load failed', err);
  }
  try {
    await refreshWatchlistQuotes();
  } catch (err) {
    console.warn('Initial watchlist refresh failed', err);
  }
  startWatchlistAutoRefresh();
}

if (typeof document !== 'undefined' && document?.addEventListener) {
  document.addEventListener('DOMContentLoaded', () => {
    init().catch((err) => {
      console.error('App initialisation failed', err);
      showError('Unable to start the trading desk. Please reload.');
    });
  }, { once: true });
}
