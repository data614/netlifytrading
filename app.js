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
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v); });
  showLoading(true);
  try {
    const resp = await fetch(url, { headers: { 'accept': 'application/json' } });
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

/* Chart state */
let priceChart = null;
let currentSymbol = 'AAPL';

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

function renderQuote(q) {
  if (!q) return;
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
  $('exchangeAcronym').textContent = q.exchange ? `· ${q.exchange}` : '';
}

function renderChart(rows, intraday) {
  const ctx = $('stockChart');
  if (!ctx || !Array.isArray(rows)) return;
  const labels = rows.map(r => new Date(r.date)[intraday ? 'toLocaleTimeString' : 'toLocaleDateString']());
  const values = rows.map(r => Number(r.close));
  const ma = sma(values, Math.min(20, values.length));
  if (priceChart) { priceChart.destroy(); priceChart = null; }
  priceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Price', data: values, borderColor: '#2ecc71', backgroundColor: 'rgba(46,204,113,.14)', fill: values.length > 1, tension: .12, spanGaps: false, clip: 5 },
        { label: 'SMA 20', data: ma, borderColor: '#f1c40f', borderDash: [6, 4], fill: false, tension: 0, spanGaps: false, clip: 5 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { grid: { color: 'rgba(255,255,255,.08)' }, ticks: { color: '#cfd3da' } },
        x: { grid: { color: 'rgba(255,255,255,.06)' }, ticks: { color: '#cfd3da', maxTicksLimit: 10 } },
      },
      plugins: { legend: { labels: { color: '#cfd3da' } }, tooltip: { mode: 'index', intersect: false } },
      animation: { duration: 400 }
    }
  });
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
  document.querySelectorAll('#tfControls button').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`#tfControls button[data-tf="${tf}"]`);
  if (btn) btn.classList.add('active');
  const { intraday, interval, limit } = tfParams(tf);
  const params = intraday ? { symbol: currentSymbol, kind: 'intraday', interval, limit } : { symbol: currentSymbol, kind: 'eod', limit };
  const res = await callTiingo(params);
  const rows = Array.isArray(res?.data) ? res.data.slice().sort((a, b) => new Date(a.date) - new Date(b.date)) : [];
  if (!rows.length) { showError('No data returned.'); return; }
  renderChart(rows, intraday);
}

async function init() {
  showError('');
  $('stockSymbol').textContent = currentSymbol;
  try {
    await loadLatestQuote(currentSymbol);
  } catch (_) {}
  try {
    await loadTimeframe('1D');
  } catch (_) {}

  // Wire up timeframe buttons
  document.querySelectorAll('#tfControls button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tf = btn.getAttribute('data-tf');
      await loadTimeframe(tf);
    });
  });
}

window.addEventListener('DOMContentLoaded', init);