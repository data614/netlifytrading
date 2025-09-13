/* ========================================================================
   Trading Desk UI — Full App
   - Uses Netlify Functions: /api/marketstack, /api/search, /api/hello
   - Marketstack v2 handled server-side; no client secrets here.
   - Chart.js line chart with SMA(20); y-axis begins at zero.
   ======================================================================== */

/* -------------------------- Utilities & State -------------------------- */
const $id = (id) => document.getElementById(id);
const showLoading = (on) => ($id('loading').style.display = on ? 'flex' : 'none');
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
    return await r.json();
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
      (await fx('marketstack', {
        symbol: currentSymbol,
        exchange: currentExchange,
        kind: 'intraday_latest',
      }))?.data?.[0] || null;
  } catch (_) {}
  if (!q) {
    q =
      (await fx('marketstack', {
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

  const payload = await fx('marketstack', {
    symbol: currentSymbol,
    exchange: currentExchange,
    kind,
    interval: intr || '',
    limit,
  });

  const rows = (payload.data || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  const labels = rows.map((r) =>
    intr ? new Date(r.date).toLocaleTimeString() : new Date(r.date).toLocaleDateString()
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
      animation: { duration: 600, easing: 'easeOutQuart' },
    },
  });
}

/* ---------------------------- 52-Week Stats --------------------------- */
async function load52w() {
  const data = await fx('marketstack', {
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
  watchlist.forEach((it) => refreshWatch(it.symbol, it.exchange));
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

async function refreshWatch(sym, ex) {
  let q = null;
  try {
    q =
      (await fx('marketstack', {
        symbol: sym,
        exchange: ex,
        kind: 'intraday_latest',
      }))?.data?.[0] || null;
  } catch (_) {}
  if (!q) {
    q =
      (await fx('marketstack', {
        symbol: sym,
        exchange: ex,
        kind: 'eod_latest',
      }))?.data?.[0] || null;
  }
  if (!q) return;

  const price = q.close ?? q.last ?? q.price;
  const open = q.open ?? price;
  const pct = open ? ((price - open) / open) * 100 : 0;
  $id(`wp-${sym}`).textContent = fmtMoney(price);
  const ce = $id(`wc-${sym}`);
  ce.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% ${ex ? '(' + ex + ')' : ''}`;
  ce.style.color = pct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
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
const mockNews = {
  Bloomberg: [
    { title: 'Apple Intelligence to Redefine AI Landscape', source: 'Bloomberg', time: '1h ago' },
    { title: 'NVIDIA Hits New High on AI Chip Demand', source: 'Bloomberg', time: '3h ago' },
  ],
  Reuters: [
    { title: 'Microsoft Azure Cloud Sees Unprecedented Growth', source: 'Reuters', time: '2h ago' },
    { title: 'Tesla Faces Stiff Competition in EV Market', source: 'Reuters', time: '5h ago' },
  ],
  Yahoo: [
    { title: 'Is Amazon a Buy After Earnings Beat?', source: 'Yahoo Finance', time: '4h ago' },
    { title: 'Alphabet Doubles Down on Quantum', source: 'Yahoo Finance', time: '6h ago' },
  ],
};
function loadNews(source = 'All') {
  const feed = $id('news-feed');
  feed.innerHTML = '';
  let articles = source === 'All' ? Object.values(mockNews).flat() : mockNews[source] || [];
  // simple ordering by "hours ago"
  articles.sort((a, b) => parseInt(a.time) - parseInt(b.time));
  articles.forEach((a) => {
    const d = document.createElement('div');
    d.className = 'news-item';
    d.innerHTML = `<a href="#" target="_blank">${a.title}</a><small>${a.time} — ${a.source}</small>`;
    feed.appendChild(d);
  });
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
      watchlist.forEach((it) => refreshWatch(it.symbol, it.exchange));
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

  const stats = [];
  for (const it of universe) {
    let q = null;
    try {
      q =
        (await fx('marketstack', {
          symbol: it.symbol,
          exchange: it.exchange || '',
          kind: 'intraday_latest',
        }))?.data?.[0] || null;
    } catch (_) {}
    if (!q) {
      q =
        (await fx('marketstack', {
          symbol: it.symbol,
          exchange: it.exchange || '',
          kind: 'eod_latest',
        }))?.data?.[0] || null;
    }
    if (!q) continue;
    const price = q.close ?? q.last ?? q.price;
    const open = q.open ?? price;
    const pct = open ? ((price - open) / open) * 100 : 0;
    stats.push({ symbol: it.symbol, ex: q.exchange || it.exchange || '', price, pct });
  }

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
