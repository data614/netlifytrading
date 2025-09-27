import { createSymbolInput, createRangeSelector, createStatusBanner, createLoadingOverlay } from './ui-components.js';
import {
  fetchPriceHistory,
  fetchLatestQuote,
  fetchCompanyNews,
  fetchSecFilings,
  AVAILABLE_RANGES,
  describeRange,
  fetchResearchLabSnapshot,
  fetchScreenerPreview,
} from './api-client.js';
import { createNewsFeed, createFilingsFeed, createMarketRadarShell, createDocumentViewer } from './feeds.js';
import { createResearchLabPanel, createScreenerPreview } from './research-modules.js';
import { createDeskMonitor } from './monitoring.js';

const state = {
  symbol: 'AAPL',
  range: '6M',
  chart: null,
  chartCtx: null,
  loading: false,
  lastQuote: null,
  filings: [],
  selectedFilingId: null,
  autoRefreshPaused: false,
};

const statusBanner = createStatusBanner();
let symbolControl;
let rangeSelector;
let loadingOverlay;
let newsFeed;
let filingsFeed;
let documentViewer;
let marketRadarShell;
let researchLabPanel;
let screenerPreviewCard;
let deskMonitor;
let dataRefreshTimer;
let intelRefreshTimer;
let onlineHandler;
let offlineHandler;
let errorHandler;
let rejectionHandler;

const getFilingId = (item) =>
  item?.id || item?.url || (item?.documentType ? `${item.documentType}-${item?.publishedAt || ''}` : item?.publishedAt || '');

const DATA_REFRESH_INTERVAL = 60 * 1000;
const INTEL_REFRESH_INTERVAL = 3 * 60 * 1000;

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

function setLoading(isLoading, { silent = false } = {}) {
  state.loading = isLoading;
  if (silent) return;
  if (isLoading) {
    loadingOverlay?.show();
    statusBanner.setMessage('Loading market data…', 'default');
  } else {
    loadingOverlay?.hide();
  }
}

function clearRefreshTimers() {
  if (dataRefreshTimer) {
    clearInterval(dataRefreshTimer);
    dataRefreshTimer = null;
  }
  if (intelRefreshTimer) {
    clearInterval(intelRefreshTimer);
    intelRefreshTimer = null;
  }
}

function scheduleRefreshTimers() {
  clearRefreshTimers();
  dataRefreshTimer = window.setInterval(() => {
    refreshData({ silent: true });
  }, DATA_REFRESH_INTERVAL);
  intelRefreshTimer = window.setInterval(() => {
    refreshIntel({ silent: true });
  }, INTEL_REFRESH_INTERVAL);
}

function pauseAutoRefresh() {
  if (state.autoRefreshPaused) return;
  state.autoRefreshPaused = true;
  clearRefreshTimers();
  deskMonitor?.log('warning', 'Auto-refresh paused', 'Tab inactive');
}

function resumeAutoRefresh() {
  if (!state.autoRefreshPaused) return;
  state.autoRefreshPaused = false;
  deskMonitor?.log('info', 'Auto-refresh resumed');
  refreshData({ silent: true });
  refreshIntel({ silent: true });
  scheduleRefreshTimers();
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

async function refreshNews({ silent = false } = {}) {
  if (!newsFeed) return;
  const tracker = deskMonitor?.beginChannel('news-feed', 'News feed', { silent });
  const showLoader = !silent;
  if (showLoader) {
    newsFeed.setLoading(true);
  }
  try {
    const data = await fetchCompanyNews(state.symbol, { limit: 20 });
    newsFeed.update(data);
    const count = Array.isArray(data?.rows) ? data.rows.length : 0;
    tracker?.success({
      message: `${count} headline${count === 1 ? '' : 's'} refreshed`,
      detail: `${count} total`,
      logMessage: `${state.symbol} news updated`,
    });
  } catch (error) {
    console.error(error);
    newsFeed.update({ rows: [], meta: { source: 'mock', reason: 'news_error' }, warning: error?.message || 'Unable to load news.' });
    tracker?.error(error, { logMessage: `${state.symbol} news failed` });
  } finally {
    if (showLoader) {
      newsFeed.setLoading(false);
    }
  }
}

async function refreshFilings({ silent = false } = {}) {
  if (!filingsFeed) return;
  const tracker = deskMonitor?.beginChannel('sec-filings', 'SEC filings', { silent });
  const showLoader = !silent;
  if (showLoader) {
    filingsFeed.setLoading(true);
  }
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
    tracker?.success({
      message: `${state.filings.length} filing${state.filings.length === 1 ? '' : 's'} synced`,
      detail: `${state.symbol} filings`,
      logMessage: `${state.symbol} filings updated`,
    });
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
    tracker?.error(error, { logMessage: `${state.symbol} filings failed` });
  } finally {
    if (showLoader) {
      filingsFeed.setLoading(false);
    }
  }
}

async function refreshWorkspaceExtensions({ silent = false } = {}) {
  const tasks = [];
  const tracker = deskMonitor?.beginChannel('research-suite', 'Research suite', { silent });
  let failures = 0;
  let modulesLoaded = 0;

  if (researchLabPanel) {
    researchLabPanel.setLoading(true);
    tasks.push(
      fetchResearchLabSnapshot(state.symbol)
        .then((data) => {
          researchLabPanel.setSource?.(data.meta || {});
          researchLabPanel.update({ ...data });
          modulesLoaded += 1;
        })
        .catch((error) => {
          console.error(error);
          researchLabPanel.setSource?.({ label: 'Unavailable', title: error?.message || '' });
          researchLabPanel.update({
            symbol: state.symbol,
            summary: error?.message || 'Unable to load research insights.',
            quickStats: [],
            diligence: [],
            catalysts: [],
          });
          failures += 1;
        })
        .finally(() => {
          researchLabPanel.setLoading(false);
        }),
    );
  }

  if (screenerPreviewCard) {
    screenerPreviewCard.setLoading(true);
    tasks.push(
      fetchScreenerPreview(state.symbol)
        .then((data) => {
          screenerPreviewCard.setSource?.(data.meta || {});
          screenerPreviewCard.update({ ...data });
          modulesLoaded += 1;
        })
        .catch((error) => {
          console.error(error);
          screenerPreviewCard.setSource?.({ label: 'Unavailable', title: error?.message || '' });
          screenerPreviewCard.update({
            symbol: state.symbol,
            summary: error?.message || 'Unable to load screener data.',
            metrics: [],
            topIdeas: [],
          });
          failures += 1;
        })
        .finally(() => {
          screenerPreviewCard.setLoading(false);
        }),
    );
  }

  if (tasks.length) {
    await Promise.all(tasks);
    if (tracker) {
      if (failures) {
        tracker.warning({
          message: `${modulesLoaded} module${modulesLoaded === 1 ? '' : 's'} loaded · ${failures} issue${failures === 1 ? '' : 's'}`,
          detail: `${modulesLoaded} ok / ${failures} issues`,
          logMessage: `${state.symbol} research partially loaded`,
        });
      } else {
        tracker.success({
          message: `${modulesLoaded} module${modulesLoaded === 1 ? '' : 's'} refreshed`,
          detail: `${modulesLoaded} modules`,
          logMessage: `${state.symbol} research suite updated`,
        });
      }
    }
  } else {
    tracker?.success({ message: 'No modules active', detail: 'Idle' });
  }
}

async function refreshIntel({ silent = false } = {}) {
  await Promise.allSettled([
    refreshNews({ silent }),
    refreshFilings({ silent }),
    refreshWorkspaceExtensions({ silent }),
  ]);
}

async function refreshData({ silent = false } = {}) {
  if (!state.symbol) return;
  setLoading(true, { silent });
  const tracker = deskMonitor?.beginChannel('market-data', 'Market data', { silent });
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
    const count = Array.isArray(rows) ? rows.length : 0;
    tracker?.success({
      message: `${count} datapoint${count === 1 ? '' : 's'} loaded`,
      detail: `${state.symbol} · ${describeRange(state.range)}`,
      logMessage: `${state.symbol} market data refreshed`,
    });
  } catch (error) {
    console.error(error);
    statusBanner.setMessage(error?.message || 'Unable to load data', 'error');
    tracker?.error(error, { logMessage: `${state.symbol} market data failed` });
  } finally {
    setLoading(false, { silent });
  }
}

function handleSymbolChange(symbol) {
  state.symbol = symbol;
  deskMonitor?.setSymbol(symbol);
  document.querySelectorAll('[data-active-symbol]').forEach((el) => {
    el.textContent = symbol;
  });
  researchLabPanel?.setLoading(true);
  screenerPreviewCard?.setLoading(true);
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
  clearRefreshTimers();
  refreshData();
  state.selectedFilingId = null;
  documentViewer?.clear?.();
  refreshIntel();
  if (!state.autoRefreshPaused) {
    scheduleRefreshTimers();
  }
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

  deskMonitor = createDeskMonitor({
    channels: [
      { key: 'market-data', label: 'Market data' },
      { key: 'news-feed', label: 'News feed' },
      { key: 'sec-filings', label: 'SEC filings' },
      { key: 'research-suite', label: 'Research suite' },
      { key: 'connectivity', label: 'Connectivity' },
    ],
  });

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
    researchLabPanel = createResearchLabPanel({
      labUrl: 'valuation-lab.html',
      onLogFollowUp: (activeSymbol) => {
        const symbol = activeSymbol || state.symbol;
        const detail = { symbol };
        window.dispatchEvent(new CustomEvent('professional-desk:log-follow-up', { detail }));
        console.info('Follow-up logged for research lab focus', detail);
      },
    });
    screenerPreviewCard = createScreenerPreview({
      screenerUrl: 'quant-screener.html',
      exportUrl: 'quant-screener.html#export',
      linkBuilder: (item = {}) => {
        const token = (item.symbol || '').trim().toUpperCase();
        return token ? `quant-screener.html#${token}` : 'quant-screener.html';
      },
    });
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
    intelTools.append(
      researchLabPanel.element,
      screenerPreviewCard.element,
      marketRadarShell.element,
      deskMonitor.element,
      documentViewer.element,
    );
  } else if (deskMonitor?.element) {
    document.querySelector('.pro-main')?.appendChild(deskMonitor.element);
  }

  hydrateWatchlist();
  document.querySelectorAll('[data-active-symbol]').forEach((el) => {
    el.textContent = state.symbol;
  });

  const connectivityState = navigator.onLine ? 'online' : 'offline';
  deskMonitor?.setNetworkState(connectivityState, connectivityState === 'online' ? 'Network ready' : 'Waiting for network');

  onlineHandler = () => deskMonitor?.setNetworkState('online', 'Network restored');
  offlineHandler = () => deskMonitor?.setNetworkState('offline', 'Connection lost');
  window.addEventListener('online', onlineHandler);
  window.addEventListener('offline', offlineHandler);

  errorHandler = (event) => {
    if (!event) return;
    const location = event.filename ? `${event.filename}:${event.lineno || 0}` : '';
    const detail = [event.message, location].filter(Boolean).join(' · ');
    deskMonitor?.log('error', 'Runtime error captured', detail);
  };
  window.addEventListener('error', errorHandler);

  rejectionHandler = (event) => {
    if (!event) return;
    const reason = event.reason;
    const message = typeof reason === 'string' ? reason : reason?.message || 'Unhandled rejection';
    deskMonitor?.log('error', 'Unhandled promise rejection', message);
  };
  window.addEventListener('unhandledrejection', rejectionHandler);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pauseAutoRefresh();
    } else {
      resumeAutoRefresh();
    }
  });

  window.addEventListener('beforeunload', clearRefreshTimers);

  refreshData();
  refreshIntel();
  if (!document.hidden) {
    scheduleRefreshTimers();
  } else {
    state.autoRefreshPaused = true;
    deskMonitor?.log('warning', 'Auto-refresh paused', 'Tab inactive');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
