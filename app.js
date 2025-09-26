import { createRenderQueue, createRequestCache } from './utils/browser-cache.js';
import { enrichError, getFriendlyErrorMessage } from './utils/frontend-errors.js';

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

const scheduleWatchlistRender = createRenderQueue();
const scheduleMoversRender = createRenderQueue();
const scheduleNewsRender = createRenderQueue();
const scheduleSearchRender = createRenderQueue();

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
let newsAbortController = null;
const watchlistQuotes = new Map();
let watchlistRefreshTimer = null;

const WATCHLIST_REFRESH_INTERVAL = 60 * 1000;
const WATCHLIST_FETCH_LIMIT = 12;
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
  const cached = newsRequestCache.get(cacheKey);
  if (cached && Array.isArray(cached.articles)) {
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
    const payload = await newsRequestCache.resolve(cacheKey, async () => {
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
    if (controller.signal.aborted) return;
    renderNewsArticles(feed, payload.articles || [], source);
  } catch (err) {
    if (controller.signal.aborted) return;
    scheduleNewsRender(() => {
      feed.innerHTML = `<div class="muted">News unavailable. ${err.message || err}</div>`;
    });
    newsRequestCache.delete(cacheKey);
  } finally {
    if (newsAbortController === controller) {
      newsAbortController = null;
    }
  }
}

function setupNews() {
  const container = $('newsApiButtons');
  if (!container) return;
  container.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-source]');
    if (!button) return;
    container.querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('active', btn === button);
    });
    loadNews(button.dataset.source || 'All');
  });
  loadNews('All');
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
  // eslint-disable-next-line no-undef
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
    updateChartStatus(res?.meta || {}, res?.warning || 'No data returned', 0);
    return;
  }
  renderChart(rows, intraday);
  updateChartStatus(res?.meta || {}, res?.warning || '', rows.length);
  if (res?.meta) updateApiBadge(res.meta);
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
  setupNews();
  setupProfile();
  startClock();
  renderWatchlist();
  renderMarketMovers();
  updateApiBadge({});
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
  try {
    await refreshWatchlistQuotes();
  } catch (err) {
    console.warn('Initial watchlist refresh failed', err);
  }
  startWatchlistAutoRefresh();

  document.querySelectorAll('#tfControls button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tf = btn.getAttribute('data-tf');
      if (!tf) return;
      await loadTimeframe(tf);
    });
  });
}

window.addEventListener('DOMContentLoaded', init);
