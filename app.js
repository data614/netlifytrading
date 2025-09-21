/* ========================================================================
   Trading Desk UI — Full App
   - Uses Netlify Functions: /api/tiingo, /api/search, /api/hello
   - Tiingo data handled server-side; no client secrets here.
   - Chart.js line chart with SMA(20); y-axis begins at zero.
   ======================================================================== */

/* -------------------------- Utilities & State -------------------------- */
const $id = (id) => document.getElementById(id);
const loadingEl = $id('loading');
const LOADING_DELAY_MS = 150;
let loadingCounter = 0;
let loadingTimer = null;
// remove refresh animation overlay for smoother UX
const showLoading = (show) => {
  if (!loadingEl) return;
  const shouldShow = Boolean(show);

  if (shouldShow) {
    loadingCounter += 1;
    if (loadingCounter === 1) {
      if (loadingTimer) clearTimeout(loadingTimer);
      loadingTimer = setTimeout(() => {
        loadingEl.style.display = 'flex';
        loadingTimer = null;
      }, LOADING_DELAY_MS);
    }
    return;
  }

  if (loadingCounter > 0) loadingCounter -= 1;
  if (loadingCounter === 0) {
    if (loadingTimer) {
      clearTimeout(loadingTimer);
      loadingTimer = null;
    }
    loadingEl.style.display = 'none';
  }
};
const showError = (msg) => {
  const box = $id('error');
  box.textContent = msg;
  box.style.display = 'block';
  setTimeout(() => (box.style.display = 'none'), 6000);
};
const fmtMoney = (n) => (n == null || Number.isNaN(+n) ? '—' : '$' + Number(n).toFixed(2));
const fmtNum = (n) => (n == null || Number.isNaN(+n) ? '—' : Number(n).toLocaleString());
const fmtVol = (v) => {
  const n = Number(v || 0);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return String(n);
};
const fmtNewsTime = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Math.max(Date.now() - d.getTime(), 0);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  if (diff < minute) return 'Just now';
  if (diff < hour) return `${Math.round(diff / minute)}m ago`;
  if (diff < day) return `${Math.round(diff / hour)}h ago`;
  if (diff < month) return `${Math.round(diff / day)}d ago`;
  return d.toLocaleDateString();
};
const sma = (arr, p) => {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
     const start = Math.max(0, i - p + 1);
    const window = arr.slice(start, i + 1);
    const sum = window.reduce((a, b) => a + b, 0);
    out.push(sum / window.length);

  }
  return out;
};
const intradayInterval = (tf) =>
  tf === '1D' ? '5min' : tf === '1W' ? '30min' : tf === '1M' ? '1hour' : null;

let currentSymbol = 'AAPL';
let currentExchange = ''; // e.g. XNAS, XNYS, XASX
let currentName = '';
let priceChart = null;
let selectedExchange = ''; // search filter
let watchlist = JSON.parse(localStorage.getItem('stockWatchlistV2') || '[]');
let latestWatchlistQuotes = {};
let lastWarningKey = '';

/* ---------------------------- Fetch via FX ----------------------------- */
async function fx(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const base = path.startsWith('http') ? path : `/api/${path}`;
  const url = `${base}${qs ? `?${qs}` : ''}`;
  showLoading(true);
  try {
    const r = await fetch(url);
    showLoading(false);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const data = await r.json();
    if (data && typeof data === 'object' && data.warning) {
      const warnKey = `${path}::${data.warning}`;
      if (warnKey !== lastWarningKey) {
        showError(data.warning);
        lastWarningKey = warnKey;
      }
    } else {
      lastWarningKey = '';
    }
    return data;
  } catch (e) {
    showLoading(false);
    showError(`Request failed (${path}) — ${e.message}`);
    throw e;
  }
}

/* --------------------------- Header / Quote ---------------------------- */
async function loadQuote() {
  let q = null;
  try {
    q =
      (await fx('tiingo', {
        symbol: currentSymbol,
        exchange: currentExchange,
        kind: 'intraday_latest',
      }))?.data?.[0] || null;
  } catch (_) {}
  if (!q) {
    q =
      (await fx('tiingo', {
        symbol: currentSymbol,
        exchange: currentExchange,
        kind: 'eod_latest',
      }))?.data?.[0] || null;
  }
  if (!q) {
    showError('No recent quote data');
    return;
  }

  const price = q.close ?? q.last ?? q.price;
  const open = q.open ?? price;
  const high = q.high;
  const low = q.low;
  const vol = q.volume;

  $id('stockPrice').textContent = fmtMoney(price);

  const deltaAbs = price - open;
  const deltaPct = open ? (deltaAbs / open) * 100 : 0;
  const up = deltaAbs >= 0;
  const ce = $id('stockChange');
  ce.textContent = `${up ? '+' : ''}${deltaAbs.toFixed(2)} (${up ? '+' : ''}${deltaPct.toFixed(
    2
  )}%)`;
  ce.className = `stock-change ${up ? 'positive-change' : 'negative-change'}`;

  $id('statOpen').textContent = fmtMoney(open);
  $id('statHigh').textContent = fmtMoney(high);
  $id('statLow').textContent = fmtMoney(low);
  $id('statVolume').textContent = fmtVol(vol);
}

/* ------------------------------ Charting ------------------------------ */
async function loadTimeframe(tf) {
  document.querySelectorAll('#tfControls button').forEach((b) => b.classList.remove('active'));
  const btn = document.querySelector(`#tfControls button[data-tf="${tf}"]`);
  if (btn) btn.classList.add('active');

  const intr = intradayInterval(tf);
  const kind = intr ? 'intraday' : 'eod';
  const limit = intr ? (tf === '1D' ? 150 : tf === '1W' ? 300 : 500) : tf === '3M' ? 70 : tf === '6M' ? 140 : 260;

  const payload = await fx('tiingo', {
    symbol: currentSymbol,
    exchange: currentExchange,
    kind,
    interval: intr || '',
    limit,
  });

  const rows = (payload.data || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  let useIntraday = Boolean(intr);
  if (useIntraday && rows.length >= 2) {
    const last = new Date(rows[rows.length - 1].date).getTime();
    const prev = new Date(rows[rows.length - 2].date).getTime();
    if (!Number.isFinite(last) || !Number.isFinite(prev) || last - prev > 12 * 60 * 60 * 1000) {
      useIntraday = false;
    }
  }

  const labels = rows.map((r) =>
    useIntraday ? new Date(r.date).toLocaleTimeString() : new Date(r.date).toLocaleDateString()
  );
  const prices = rows.map((r) => Number(r.close));

  // filter out NaNs while keeping aligned labels
  const clean = { labels: [], values: [] };
  prices.forEach((v, i) => {
    if (Number.isFinite(v)) {
      clean.labels.push(labels[i]);
      clean.values.push(v);
    }
  });
  const minPrice = clean.values.length ? Math.min(...clean.values) : 0;
  const maxPrice = clean.values.length ? Math.max(...clean.values) : 1;
  const padding = (maxPrice - minPrice) * 0.1;
  const yMin = Math.max(minPrice - padding, 0);
  const yMax = maxPrice + padding;
  const sma20 = sma(clean.values, Math.min(20, clean.values.length));

  if (priceChart) priceChart.destroy();
  priceChart = new Chart($id('stockChart'), {
    type: 'line',
    data: {
      labels: clean.labels,
      datasets: [
        {
          label: 'Price',
          data: clean.values,
          borderColor: '#2ecc71',
          backgroundColor: 'rgba(46,204,113,.14)',
          fill: clean.values.length > 1,
          tension: 0.12,
          spanGaps: false,
          clip: 5,
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
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
          y: {
          min: yMin,
          max: yMax,
          grid: { color: 'rgba(255,255,255,.08)' },
          ticks: { color: '#cfd3da' },
        },
        x: {
          grid: { color: 'rgba(255,255,255,.06)' },
          ticks: { color: '#cfd3da', maxTicksLimit: 10 },
        },
      },
      plugins: {
        legend: { labels: { color: '#cfd3da' } },
        tooltip: { mode: 'index', intersect: false },
      },
      animation: false,
    },
  });
}

// allow users to switch chart timeframes via the UI controls
$id('tfControls').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (btn && btn.dataset.tf) {
    loadTimeframe(btn.dataset.tf);
  }
});

/* ---------------------------- 52-Week Stats --------------------------- */
async function load52w() {
  const data = await fx('tiingo', {
    symbol: currentSymbol,
    exchange: currentExchange,
    kind: 'eod',
    limit: 260,
  });
  const rows = data.data || [];
  if (!rows.length) {
    $id('stat52wHigh').textContent = '—';
    $id('stat52wLow').textContent = '—';
    return;
  }
  const highs = rows.map((r) => Number(r.high)).filter(Number.isFinite);
  const lows = rows.map((r) => Number(r.low)).filter(Number.isFinite);
  $id('stat52wHigh').textContent = fmtMoney(Math.max(...highs));
  $id('stat52wLow').textContent = fmtMoney(Math.min(...lows));
}

/* ------------------------------ Watchlist ----------------------------- */
function saveWatch() {
  localStorage.setItem('stockWatchlistV2', JSON.stringify(watchlist));
}
function renderWatchlist() {
  const el = $id('watchlist');
  el.innerHTML = '';
  if (!watchlist.length) {
    el.innerHTML = '<p class="muted" style="text-align:center">No symbols yet. Search above to add.</p>';
    return;
  }
  watchlist.forEach((it) => {
    const row = document.createElement('div');
    row.className = 'watchlist-item';
    row.dataset.symbol = it.symbol;
    row.innerHTML = `
      <div>
        <div class="watchlist-symbol">${it.symbol}</div>
        <div class="muted" style="font-size:.85em">${it.name || ''}</div>
      </div>
      <div style="text-align:right">
        <div class="mono" id="wp-${it.symbol}">—</div>
        <div class="mono muted" id="wc-${it.symbol}">—</div>
      </div>
      <span class="watchlist-remove" data-symbol="${it.symbol}">&times;</span>
    `;
    el.appendChild(row);
  });
  // refresh quotes for all
  refreshWatchlist();
}
function addToWatchlist(symbol, exchange, name) {
  if (!symbol) return;
  if (!watchlist.some((x) => x.symbol === symbol)) {
    watchlist.push({ symbol, exchange: exchange || '', name: name || '' });
    saveWatch();
    renderWatchlist();
  }
}
function removeFromWatchlist(symbol) {
  watchlist = watchlist.filter((s) => s.symbol !== symbol);
  saveWatch();
  renderWatchlist();
}

$id('watchlist').addEventListener('click', (e) => {
  if (e.target.classList.contains('watchlist-remove')) {
    removeFromWatchlist(e.target.dataset.symbol);
    return;
  }
  const row = e.target.closest('.watchlist-item');
  if (row) {
    const sym = row.dataset.symbol;
    const it = watchlist.find((x) => x.symbol === sym);
    loadSymbol(sym, it?.exchange || '', it?.name || '');
  }
});

async function refreshWatchlist() {
  if (!watchlist.length) {
    latestWatchlistQuotes = {};
    return {};
  }
  const symbols = watchlist.map((it) => it.symbol).join(',');
  let payload = null;
  try {
    payload = await fx('tiingo', { symbol: symbols, kind: 'intraday_latest' });
  } catch (_) {}
  if (!payload || !(payload.data && payload.data.length)) {
    payload = await fx('tiingo', { symbol: symbols, kind: 'eod_latest' });
  }
  const rows = payload.data || [];
  const map = {};
  rows.forEach((r) => (map[r.symbol] = r));

  latestWatchlistQuotes = map;

  watchlist.forEach((it) => {
    const q = map[it.symbol];
    if (!q) return;
    const price = q.close ?? q.last ?? q.price;
    const open = q.open ?? price;
    const pct = open ? ((price - open) / open) * 100 : 0;
    $id(`wp-${it.symbol}`).textContent = fmtMoney(price);
    const ce = $id(`wc-${it.symbol}`);
    ce.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% ${it.exchange ? '(' + it.exchange + ')' : ''}`;
    ce.style.color = pct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
  });
  return map;
}

/* -------------------------------- Search ------------------------------ */
const searchInput = $id('stockSearchInput');
const searchResultsContainer = $id('searchResults');

searchInput.addEventListener('input', async (e) => {
  const q = e.target.value.trim();
  searchResultsContainer.innerHTML = '';
  if (q.length < 2) return;

  const r = await fx('search', { q, exchange: selectedExchange || '' });
  const items = (r.data || []).slice(0, 10);

  items.forEach((it) => {
    const row = document.createElement('div');
    row.className = 'search-result-item';
    row.innerHTML = `
      <span><span class="mono">${it.symbol}</span> — ${it.name || ''} <span class="chip">${it.exchange || ''}</span></span>
      <div style="display:flex; gap:6px">
        <button data-symbol="${it.symbol}" data-ex="${it.mic || ''}" data-name="${it.name || ''}">Add</button>
        <button data-load="${it.symbol}" data-ex="${it.mic || ''}" data-name="${it.name || ''}" style="background:#2ecc71">Load</button>
      </div>`;
    searchResultsContainer.appendChild(row);
  });
});

searchResultsContainer.addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  const sym = e.target.dataset.symbol || e.target.dataset.load;
  const ex = e.target.dataset.ex || '';
  const nm = e.target.dataset.name || '';
  if (e.target.dataset.symbol) {
    addToWatchlist(sym, ex, nm);
    searchInput.value = '';
    searchResultsContainer.innerHTML = '';
  } else {
    loadSymbol(sym, ex, nm);
  }
});

/* ----------------------------- Filters (EX) ---------------------------- */
$id('exchangeFilters').addEventListener('change', (e) => {
  selectedExchange = e.target.value || '';
  // re-run current search
  const ev = new Event('input', { bubbles: true });
  searchInput.dispatchEvent(ev);
});

/* -------------------------------- News -------------------------------- */
async function loadNews(source = 'All') {
  const feed = $id('news-feed');
  feed.innerHTML = '<div class="news-item muted">Loading latest headlines…</div>';
  try {
    const resp = await fetch(`/api/news?source=${encodeURIComponent(source)}`);
    if (!resp.ok) {
      throw new Error(`${resp.status} ${resp.statusText || ''}`.trim());
    }
    const data = await resp.json();
    const articles = Array.isArray(data.articles) ? data.articles : [];

    feed.innerHTML = '';
    if (data.fromCache) {
      const notice = document.createElement('div');
      notice.className = 'news-item muted';
      notice.textContent = 'Showing cached headlines.';
      feed.appendChild(notice);
    }

    if (!articles.length) {
      const empty = document.createElement('div');
      empty.className = 'news-item muted';
      empty.textContent = 'No articles found for this source.';
      feed.appendChild(empty);
      if (data.error) {
        showError(`News fallback in use — ${data.error}`);
      }
      return;
    }

    articles.forEach((article) => {
      const item = document.createElement('div');
      item.className = 'news-item';

      const defaultUrl = `https://www.google.com/search?q=${encodeURIComponent(
        article.title || ''
      )}&tbm=nws`;
      const href =
        typeof article.url === 'string' && article.url.startsWith('http')
          ? article.url
          : defaultUrl;

      const link = document.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = article.title || 'Untitled article';
      item.appendChild(link);

      const timeLabel =
        fmtNewsTime(article.publishedAt) ||
        fmtNewsTime(article.time) ||
        (article.time && typeof article.time === 'string' ? article.time : '');
      const sourceLabel = typeof article.source === 'string' ? article.source : '';
      const metaParts = [];
      if (timeLabel) metaParts.push(timeLabel);
      if (sourceLabel) metaParts.push(sourceLabel);
      if (metaParts.length) {
        const meta = document.createElement('small');
        meta.textContent = metaParts.join(' — ');
        item.appendChild(meta);
      }

      feed.appendChild(item);
    });

    if (data.error) {
      showError(`News fallback in use — ${data.error}`);
    }
    if (data.warning) {
      console.warn('News API warning:', data.warning);
    }
  } catch (error) {
    console.error('loadNews error', error);
    feed.innerHTML = '';
    const err = document.createElement('div');
    err.className = 'news-item muted';
    err.textContent = 'Unable to load news right now.';
    feed.appendChild(err);
    showError(`News feed unavailable — ${error.message}`);
  }
}
$id('newsApiButtons').addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  $id('newsApiButtons').querySelector('.active').classList.remove('active');
  e.target.classList.add('active');
  loadNews(e.target.dataset.source);
});

/* ------------------------------- Profile ------------------------------- */
const profileForm = $id('profileForm');
profileForm.addEventListener('submit', (e) => {
  e.preventDefault();
  localStorage.setItem(
    'userProfile',
    JSON.stringify({ name: $id('userName').value, email: $id('userEmail').value })
  );
  $id('saveConfirmation').textContent = 'Details saved successfully!';
  setTimeout(() => ($id('saveConfirmation').textContent = ''), 3000);
});
function loadProfile() {
  const u = JSON.parse(localStorage.getItem('userProfile') || 'null');
  if (u) {
    $id('userName').value = u.name || '';
    $id('userEmail').value = u.email || '';
  }
}

const sendSummaryBtn = $id('sendSummaryBtn');
const sendSummaryStatus = $id('sendSummaryStatus');
let emailFeatureReady = false;

function setEmailStatus(message, state = 'info') {
  if (!sendSummaryStatus) return;
  sendSummaryStatus.textContent = message || '';
  sendSummaryStatus.className = state && state !== 'info' ? `status-msg ${state}` : 'status-msg';
}

function buildWatchlistEmailPayload() {
  const storedProfile = JSON.parse(localStorage.getItem('userProfile') || 'null');
  const name = (storedProfile?.name || '').trim();
  const email = (storedProfile?.email || '').trim();
  if (!email) {
    throw new Error('Save your name and email in the profile section before sending a summary.');
  }
  if (!watchlist.length) {
    throw new Error('Your watchlist is empty. Add at least one symbol before emailing a summary.');
  }

  const summaryData = watchlist.map((item) => {
    const quote = latestWatchlistQuotes[item.symbol];
    const label = `${item.symbol}${item.name ? ` — ${item.name}` : ''}`;
    if (!quote) {
      return { symbol: item.symbol, hasQuote: false, line: `${label}: quote unavailable` };
    }
    const price = Number(quote.close ?? quote.last ?? quote.price);
    const open = Number(quote.open ?? price);
    if (!Number.isFinite(price)) {
      return { symbol: item.symbol, hasQuote: false, line: `${label}: quote unavailable` };
    }
    const pct = Number.isFinite(open) && open !== 0 ? ((price - open) / open) * 100 : null;
    const pctText = pct == null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
    return {
      symbol: item.symbol,
      hasQuote: true,
      line: `${label}: ${fmtMoney(price)} (${pctText})`,
    };
  });

  const hasLiveQuote = summaryData.some((row) => row.hasQuote);
  if (!hasLiveQuote) {
    throw new Error('Live pricing is still loading. Refresh the watchlist and try again.');
  }

  const summaryLines = summaryData.map((row) => row.line);
  const bulletLines = summaryLines.map((line) => `• ${line}`).join('\n');
  const timestamp = new Date();
  const subjectDate = timestamp.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const subject = `Watchlist summary — ${subjectDate}`;
  const greetingName = name || 'there';
  const message = [
    `Hi ${greetingName},`,
    '',
    'Here is the latest snapshot of your watchlist:',
    '',
    bulletLines,
    '',
    `Generated at ${timestamp.toLocaleString()}.`,
    '',
    '— Netlify Trading Desk',
  ].join('\n');

  return {
    template_params: {
      to_name: name || email,
      to_email: email,
      subject,
      message,
      summary_text: summaryLines.join('\n'),
      generated_at: timestamp.toISOString(),
      watchlist_count: summaryLines.length,
    },
  };
}

async function sendWatchlistSummary() {
  if (!sendSummaryBtn) return;
  if (!emailFeatureReady) {
    setEmailStatus(
      'Email delivery is disabled. Add EmailJS keys in your Netlify environment to enable summaries.',
      'error'
    );
    return;
  }

  if (!Object.keys(latestWatchlistQuotes).length && watchlist.length) {
    try {
      await refreshWatchlist();
    } catch (err) {
      console.warn('Unable to refresh watchlist before sending summary:', err);
    }
  }

  let payload;
  try {
    payload = buildWatchlistEmailPayload();
  } catch (err) {
    setEmailStatus(err.message, 'error');
    return;
  }

  try {
    setEmailStatus('Sending summary…');
    sendSummaryBtn.disabled = true;
    const res = await fetch('/api/sendEmail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      const detail = data?.details ? ` (${data.details})` : '';
      const message = data?.error ? `${data.error}${detail}` : `Request failed${detail}`;
      throw new Error(message);
    }
    const toEmail = payload.template_params?.to_email || 'your inbox';
    setEmailStatus(`Summary sent to ${toEmail}!`, 'success');
  } catch (err) {
    setEmailStatus(`Failed to send summary: ${err.message}`, 'error');
  } finally {
    sendSummaryBtn.disabled = !emailFeatureReady;
  }
}

async function initEmailFeature() {
  if (!sendSummaryBtn) return;
  try {
    const res = await fetch('/api/env-check');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const env = payload?.env || {};
    const ready = !!(env.EMAILJS_PRIVATE_KEY && env.EMAILJS_SERVICE_ID && env.EMAILJS_TEMPLATE_ID);
    emailFeatureReady = ready;
    sendSummaryBtn.disabled = !ready;
    if (!ready) {
      setEmailStatus(
        'Email delivery is disabled. Add EmailJS keys (EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PRIVATE_KEY) in your Netlify environment to enable summaries.',
        'error'
      );
    } else {
      setEmailStatus('', 'info');
    }
  } catch (err) {
    emailFeatureReady = false;
    if (sendSummaryBtn) sendSummaryBtn.disabled = true;
    setEmailStatus('Unable to verify email service configuration. Try again later.', 'error');
    console.warn('Email summary setup failed:', err);
  }
}

if (sendSummaryBtn) {
  sendSummaryBtn.disabled = true;
  sendSummaryBtn.addEventListener('click', sendWatchlistSummary);
}

/* ----------------------------- Load Symbol ---------------------------- */
async function loadSymbol(sym, exchange = '', knownName = '') {
  $id('error').style.display = 'none';
  currentSymbol = (sym || 'AAPL').toUpperCase();
  currentExchange = exchange || '';
  currentName = knownName || currentName || '';
  $id('stockSymbol').textContent = currentSymbol;
  $id('stockName').textContent = currentName || '—';
  $id('exchangeAcronym').textContent = exchange ? `(${exchange})` : '';
  await loadQuote();
  await loadTimeframe('1D');
  await load52w();
}

/* ------------------------------ Bootstrap ----------------------------- */
async function pingBackend() {
  try {
    const r = await fetch('/api/hello');
    const j = await r.json();
    console.log('Hello function:', j);
  } catch (_) {
    console.warn('Backend hello not reachable.');
  }
}

function bootstrap() {
  renderWatchlist();
  loadProfile();
  loadNews('All');
  initEmailFeature();
  if (watchlist.length) {
    const f = watchlist[0];
    loadSymbol(f.symbol, f.exchange || '', f.name || '');
  } else {
    loadSymbol('AAPL');
  }
  // Periodic refresh: quotes + movers + watchlist
  setInterval(() => {
    if (currentSymbol) {
      loadQuote();
      renderMovers();
      refreshWatchlist();
    }
  }, 60 * 1000);
  pingBackend();
}

/* ---------------------------- Market Movers --------------------------- */
async function renderMovers() {
  const rowsEl = document.querySelector('#marketMoversTable tbody');
  if (!rowsEl) return;
  rowsEl.innerHTML = '';

  const universe = (watchlist.length
    ? watchlist
    : [{ symbol: 'AAPL' }, { symbol: 'MSFT' }, { symbol: 'NVDA' }, { symbol: 'AMZN' }, { symbol: 'GOOGL' }, { symbol: 'TSLA' }]
  ).slice(0, 20);

  const symbols = universe.map((it) => it.symbol).join(',');
  let payload = null;
  try {
    payload = await fx('tiingo', { symbol: symbols, kind: 'intraday_latest' });
  } catch (_) {}
  if (!payload || !(payload.data && payload.data.length)) {
    payload = await fx('tiingo', { symbol: symbols, kind: 'eod_latest' });
  }
  const stats = [];
  const rows = payload.data || [];
  const map = {};
  rows.forEach((r) => (map[r.symbol] = r));

  universe.forEach((it) => {
    const q = map[it.symbol];
    if (!q) return;
    const price = q.close ?? q.last ?? q.price;
    const open = q.open ?? price;
    const pct = open ? ((price - open) / open) * 100 : 0;
    stats.push({ symbol: it.symbol, ex: q.exchange || it.exchange || '', price, pct });
  });

  stats.sort((a, b) => b.pct - a.pct);
  stats.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${r.symbol}</td>
      <td>${r.ex || ''}</td>
      <td>${fmtMoney(r.price)}</td>
      <td style="color:${r.pct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">
        ${r.pct >= 0 ? '+' : ''}${r.pct.toFixed(2)}%
      </td>`;
    rowsEl.appendChild(tr);
  });
}

/* --------------------------------- Go --------------------------------- */
document.addEventListener('DOMContentLoaded', bootstrap);
