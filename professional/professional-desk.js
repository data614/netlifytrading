import { createSymbolInput, createRangeSelector, createStatusBanner, createLoadingOverlay } from './ui-components.js';
import {
  fetchPriceHistory,
  fetchLatestQuote,
  fetchCompanyNews,
  fetchSecFilings,
  AVAILABLE_RANGES,
  describeRange,
} from './api-client.js';
import { createNewsFeed, createFilingsFeed, createMarketRadarShell, createDocumentViewer } from './feeds.js';

const state = {
  symbol: 'AAPL',
  range: '6M',
  chart: null,
  chartCtx: null,
  loading: false,
  lastQuote: null,
  filings: [],
  selectedFilingId: null,
};

const statusBanner = createStatusBanner();
let symbolControl;
let rangeSelector;
let loadingOverlay;
let newsFeed;
let filingsFeed;
let documentViewer;
let marketRadarShell;

const getFilingId = (item) =>
  item?.id || item?.url || (item?.documentType ? `${item.documentType}-${item?.publishedAt || ''}` : item?.publishedAt || '');

function registerZoomPlugin() {
  const zoomPlugin = window?.ChartZoom || window?.chartjs_plugin_zoom;
  if (zoomPlugin && window.Chart && typeof window.Chart.register === 'function') {
    window.Chart.register(zoomPlugin);
  }
}

function ensureChart(ctx) {
  if (!window.Chart) {
    throw new Error('Chart.js not loaded');
  }

  if (state.chart) {
    return state.chart;
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
  gradient.addColorStop(0, 'rgba(76, 141, 255, 0.45)');
  gradient.addColorStop(1, 'rgba(76, 141, 255, 0.02)');

  state.chart = new window.Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Close',
          data: [],
          tension: 0.35,
          borderColor: 'rgba(76, 141, 255, 0.9)',
          borderWidth: 2.4,
          fill: true,
          backgroundColor: gradient,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: '#fff',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15, 21, 31, 0.92)',
          borderColor: 'rgba(76, 141, 255, 0.45)',
          borderWidth: 1,
          padding: 12,
          displayColors: false,
          callbacks: {
            title: (items) => (items[0]?.label ?? ''),
            label: (item) => `Close: $${Number(item.parsed.y || 0).toFixed(2)}`,
          },
        },
        zoom: {
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            drag: { enabled: false },
            mode: 'x',
          },
          pan: { enabled: true, mode: 'x' },
          limits: { x: { min: 'original', max: 'original' } },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: 'rgba(255, 255, 255, 0.5)',
            maxRotation: 0,
            autoSkipPadding: 24,
          },
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.06)' },
          ticks: {
            color: 'rgba(255, 255, 255, 0.55)',
            callback: (value) => `$${Number(value).toFixed(2)}`,
          },
        },
      },
    },
  });

  return state.chart;
}

function resetZoom() {
  if (state.chart?.resetZoom) {
    state.chart.resetZoom();
  }
}

function formatLabel(row, rangeKey) {
  const raw = row?.date || row?.timestamp || row?.datetime;
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  if (rangeKey === '1D' || rangeKey === '5D') {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function updateChart(rows, rangeKey) {
  if (!state.chartCtx) return;
  const chart = ensureChart(state.chartCtx);
  const labels = rows.map((row) => formatLabel(row, rangeKey));
  const values = rows.map((row) => Number(row?.close ?? row?.price ?? row?.last ?? 0));

  chart.data.labels = labels;
  chart.data.datasets[0].data = values;
  chart.update('none');
}

function setLoading(isLoading) {
  state.loading = isLoading;
  if (isLoading) {
    loadingOverlay?.show();
    statusBanner.setMessage('Loading market data…', 'default');
  } else {
    loadingOverlay?.hide();
  }
}

function updateStatus({ warning, meta }) {
  if (warning) {
    statusBanner.setMessage(warning, 'warning');
    return;
  }
  const source = meta?.source === 'live' ? 'Live feed' : meta?.source === 'eod-fallback' ? 'EOD fallback' : 'Sample data';
  const label = `${state.symbol} · ${describeRange(state.range)} · ${source}`;
  statusBanner.setMessage(label);
}

function updateQuoteDisplay(quote) {
  const priceEl = document.getElementById('quote-price');
  const changeEl = document.getElementById('quote-change');
  if (!priceEl || !changeEl) return;
  if (!quote) {
    priceEl.textContent = '—';
    changeEl.textContent = '';
    changeEl.dataset.direction = '';
    return;
  }
  const price = Number(quote?.last ?? quote?.close ?? quote?.price ?? 0);
  const previous = Number(quote?.previousClose ?? quote?.close ?? 0);
  const change = price - previous;
  const pct = previous ? (change / previous) * 100 : 0;
  priceEl.textContent = price ? `$${price.toFixed(2)}` : '—';
  if (Number.isFinite(change)) {
    const sign = change > 0 ? '+' : change < 0 ? '−' : '';
    const pctSign = pct > 0 ? '+' : pct < 0 ? '−' : '';
    changeEl.textContent = `${sign}${Math.abs(change).toFixed(2)} (${pctSign}${Math.abs(pct).toFixed(2)}%)`;
    changeEl.dataset.direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  } else {
    changeEl.textContent = '';
    changeEl.dataset.direction = '';
  }
}

async function refreshNews() {
  if (!newsFeed) return;
  newsFeed.setLoading(true);
  try {
    const data = await fetchCompanyNews(state.symbol, { limit: 20 });
    newsFeed.update(data);
  } catch (error) {
    console.error(error);
    newsFeed.update({ rows: [], meta: { source: 'mock', reason: 'news_error' }, warning: error?.message || 'Unable to load news.' });
  } finally {
    newsFeed.setLoading(false);
  }
}

async function refreshFilings() {
  if (!filingsFeed) return;
  filingsFeed.setLoading(true);
  try {
    const data = await fetchSecFilings(state.symbol, { limit: 12 });
    state.filings = Array.isArray(data.rows) ? data.rows : [];
    filingsFeed.update(data);
    if (state.filings.length) {
      const existing = state.filings.find((item) => getFilingId(item) === state.selectedFilingId);
      const next = existing || state.filings[0];
      const nextId = getFilingId(next);
      if (nextId) {
        state.selectedFilingId = nextId;
        documentViewer?.setDocument(next);
        filingsFeed.setActive?.(nextId);
      }
    } else {
      state.selectedFilingId = null;
      documentViewer?.clear?.();
      filingsFeed.setActive?.('');
    }
  } catch (error) {
    console.error(error);
    filingsFeed.update({
      rows: [],
      meta: { source: 'mock', reason: 'filings_error' },
      warning: error?.message || 'Unable to load filings.',
    });
    state.filings = [];
    state.selectedFilingId = null;
    documentViewer?.clear?.();
  } finally {
    filingsFeed.setLoading(false);
  }
}

async function refreshIntel() {
  await Promise.all([refreshNews(), refreshFilings()]);
}

async function refreshData() {
  if (!state.symbol) return;
  setLoading(true);
  try {
    const [{ rows, warning, meta }, latest] = await Promise.all([
      fetchPriceHistory(state.symbol, state.range),
      fetchLatestQuote(state.symbol).catch(() => ({ row: null })),
    ]);
    updateChart(rows, state.range);
    updateStatus({ warning, meta });
    state.lastQuote = latest?.row || rows?.[rows.length - 1] || null;
    updateQuoteDisplay(state.lastQuote);
    resetZoom();
  } catch (error) {
    console.error(error);
    statusBanner.setMessage(error?.message || 'Unable to load data', 'error');
  } finally {
    setLoading(false);
  }
}

function handleSymbolChange(symbol) {
  state.symbol = symbol;
  document.querySelectorAll('[data-active-symbol]').forEach((el) => {
    el.textContent = symbol;
  });
  const watchlist = document.getElementById('watchlist-items');
  if (watchlist) {
    watchlist.querySelectorAll('li').forEach((item) => {
      if (item.dataset.symbol === symbol) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }
  refreshData();
  state.selectedFilingId = null;
  documentViewer?.clear?.();
  refreshIntel();
}

function handleRangeChange(range) {
  state.range = range;
  refreshData();
}

function hydrateWatchlist() {
  const list = document.getElementById('watchlist-items');
  if (!list) return;
  list.querySelectorAll('li[data-symbol]').forEach((item) => {
    item.addEventListener('click', () => {
      const symbol = item.dataset.symbol;
      if (!symbol) return;
      symbolControl?.setValue(symbol);
      handleSymbolChange(symbol);
      list.querySelectorAll('li').forEach((li) => li.classList.remove('active'));
      item.classList.add('active');
    });
  });
}

function init() {
  registerZoomPlugin();

  const controls = document.getElementById('symbol-controls');
  const statusHost = document.getElementById('status-host');
  const chartCard = document.querySelector('.pro-chart-card');
  const canvas = document.getElementById('price-history');
  const intelStreams = document.getElementById('intel-streams');
  const intelTools = document.getElementById('intel-tools');

  if (!controls || !canvas || !chartCard) {
    console.warn('Professional desk shell missing required elements');
    return;
  }

  symbolControl = createSymbolInput({
    initial: state.symbol,
    onSubmit: handleSymbolChange,
  });
  controls.appendChild(symbolControl.element);

  rangeSelector = createRangeSelector(AVAILABLE_RANGES, {
    onChange: handleRangeChange,
    active: state.range,
  });
  controls.appendChild(rangeSelector.element);

  statusHost?.appendChild(statusBanner.element);

  loadingOverlay = createLoadingOverlay();
  chartCard.appendChild(loadingOverlay.element);

  state.chartCtx = canvas.getContext('2d');

  if (intelStreams) {
    newsFeed = createNewsFeed();
    filingsFeed = createFilingsFeed({
      onPreview: (item) => {
        const nextId = getFilingId(item);
        if (!nextId) return;
        state.selectedFilingId = nextId;
        documentViewer?.setDocument(item);
        filingsFeed.setActive?.(nextId);
      },
    });
    intelStreams.innerHTML = '';
    intelStreams.append(newsFeed.element, filingsFeed.element);
  }

  if (intelTools) {
    marketRadarShell = createMarketRadarShell({
      screenerUrl: 'quant-screener.html',
      analystUrl: 'ai-analyst.html',
      additionalLinks: [
        { label: 'Valuation Lab', href: 'valuation-lab.html', target: '_self' },
        { label: 'AI Analyst', href: 'ai-analyst.html', target: '_self' },
      ],
    });
    documentViewer = createDocumentViewer();
    intelTools.innerHTML = '';
    intelTools.append(marketRadarShell.element, documentViewer.element);
  }

  hydrateWatchlist();
  document.querySelectorAll('[data-active-symbol]').forEach((el) => {
    el.textContent = state.symbol;
  });

  refreshData();
  refreshIntel();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
