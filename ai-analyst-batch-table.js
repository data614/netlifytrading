const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN'];
const MAX_SYMBOLS = 12;

const state = {
  rows: [],
  sort: { key: 'aiUpsidePct', direction: 'desc' },
  lastSymbols: [...DEFAULT_SYMBOLS],
  loading: false,
  controller: null,
};

const $ = (selector) => document.querySelector(selector);

const parseSymbols = (raw) => {
  return (raw || '')
    .split(/[\s,]+/)
    .map((token) => token.trim().toUpperCase())
    .filter((token, index, arr) => token && arr.indexOf(token) === index)
    .slice(0, MAX_SYMBOLS);
};

const fmtCurrency = (value, currency = 'USD') => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  try {
    return num.toLocaleString(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    });
  } catch (error) {
    console.warn('Currency formatting failed', error);
    return `$${num.toFixed(2)}`;
  }
};

const fmtPercent = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const sign = num > 0 ? '+' : num < 0 ? '−' : '';
  return `${sign}${Math.abs(num).toFixed(1)}%`;
};

const fmtMultiple = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num.toFixed(1)}×`;
};

const formatMetricValue = (metric) => {
  if (!metric || metric.value === null || metric.value === undefined) return '—';
  switch (metric.unit) {
    case 'percent':
      return fmtPercent(metric.value);
    case 'currency':
      return fmtCurrency(metric.value, metric.currency || 'USD');
    case 'multiple':
      return fmtMultiple(metric.value);
    default: {
      const num = Number(metric.value);
      return Number.isFinite(num) ? num.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
    }
  }
};

const setStatus = (message, tone = 'info') => {
  const el = $('#batchStatus');
  if (!el) return;
  el.textContent = message || '';
  el.className = `status-message ${tone}`.trim();
};

const setSummary = (rows) => {
  const el = $('#batchSummary');
  if (!el) return;
  if (!Array.isArray(rows) || !rows.length) {
    el.textContent = '—';
    return;
  }
  const finiteUpsides = rows
    .map((row) => Number(row.aiUpsidePct))
    .filter((value) => Number.isFinite(value));
  const avgUpside = finiteUpsides.length
    ? finiteUpsides.reduce((acc, value) => acc + value, 0) / finiteUpsides.length
    : null;
  el.textContent = `${rows.length} tickers · Avg upside ${fmtPercent(avgUpside)}`;
};

const renderPlaceholder = (message) => {
  const tbody = $('#batchResultsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = 5;
  td.className = 'table-empty-cell';
  td.textContent = message;
  tr.appendChild(td);
  tbody.appendChild(tr);
};

const renderTable = (rows) => {
  const tbody = $('#batchResultsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!Array.isArray(rows) || !rows.length) {
    renderPlaceholder(state.loading ? 'Loading batch intelligence…' : 'Run a batch scan to populate results.');
    return;
  }
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const metric1 = row.metrics?.[0] || null;
    const metric2 = row.metrics?.[1] || null;

    const symbolCell = document.createElement('td');
    symbolCell.textContent = row.symbol || '—';
    tr.appendChild(symbolCell);

    const priceCell = document.createElement('td');
    priceCell.textContent = fmtCurrency(row.price, row.currency || 'USD');
    tr.appendChild(priceCell);

    const upsideCell = document.createElement('td');
    upsideCell.textContent = fmtPercent(row.aiUpsidePct);
    tr.appendChild(upsideCell);

    const metric1Cell = document.createElement('td');
    metric1Cell.textContent = formatMetricValue(metric1);
    if (metric1?.label) metric1Cell.title = metric1.label;
    tr.appendChild(metric1Cell);

    const metric2Cell = document.createElement('td');
    metric2Cell.textContent = formatMetricValue(metric2);
    if (metric2?.label) metric2Cell.title = metric2.label;
    tr.appendChild(metric2Cell);

    tbody.appendChild(tr);
  });
};

const getSortValue = (row, key) => {
  if (!row) return null;
  if (key === 'metric1') return Number(row.metric1);
  if (key === 'metric2') return Number(row.metric2);
  return row[key];
};

const sortRows = (rows) => {
  if (!Array.isArray(rows)) return [];
  const { key, direction } = state.sort;
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = getSortValue(a, key);
    const vb = getSortValue(b, key);
    const aNum = Number(va);
    const bNum = Number(vb);
    const aIsFinite = Number.isFinite(aNum);
    const bIsFinite = Number.isFinite(bNum);
    if (aIsFinite && bIsFinite) {
      return (aNum - bNum) * multiplier;
    }
    if (aIsFinite) return direction === 'asc' ? -1 : 1;
    if (bIsFinite) return direction === 'asc' ? 1 : -1;
    return String(va || '').localeCompare(String(vb || '')) * multiplier;
  });
};

const updateSortIndicators = () => {
  const headers = document.querySelectorAll('#batchResultsTable thead th[data-key]');
  headers.forEach((th) => {
    const { key } = th.dataset;
    if (!key) return;
    if (state.sort.key === key) {
      th.dataset.sort = state.sort.direction;
      th.setAttribute('aria-sort', state.sort.direction === 'asc' ? 'ascending' : 'descending');
    } else {
      th.dataset.sort = 'none';
      th.removeAttribute('aria-sort');
    }
  });
};

const attachSortHandlers = () => {
  const headers = document.querySelectorAll('#batchResultsTable thead th[data-key]');
  headers.forEach((th) => {
    th.dataset.sort = th.dataset.sort || 'none';
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (!key || state.loading) return;
      const nextDirection = state.sort.key === key && state.sort.direction === 'desc' ? 'asc' : 'desc';
      state.sort = { key, direction: nextDirection };
      updateSortIndicators();
      const sorted = sortRows(state.rows);
      renderTable(sorted);
    });
  });
  updateSortIndicators();
};

const setLoading = (flag) => {
  state.loading = flag;
  const runButton = $('#batchRunButton');
  const resetButton = $('#batchResetButton');
  const tableWrapper = $('#batchResultsTable');
  if (flag) {
    runButton?.setAttribute('disabled', 'true');
    resetButton?.setAttribute('disabled', 'true');
    tableWrapper?.setAttribute('aria-busy', 'true');
    renderPlaceholder('Loading batch intelligence…');
  } else {
    runButton?.removeAttribute('disabled');
    resetButton?.removeAttribute('disabled');
    tableWrapper?.removeAttribute('aria-busy');
  }
};

const abortInFlight = () => {
  if (state.controller) {
    state.controller.abort();
    state.controller = null;
  }
};

const buildRequestUrl = (symbols) => {
  const url = new URL('/api/aiAnalystBatch', window.location.origin);
  url.searchParams.set('symbols', symbols.join(','));
  const lookbackValue = Number($('#lookbackInput')?.value);
  if (Number.isFinite(lookbackValue) && lookbackValue > 0) {
    url.searchParams.set('limit', String(Math.min(Math.round(lookbackValue), 500)));
  }
  const timeframe = $('#timeframeSelect')?.value;
  if (timeframe) {
    url.searchParams.set('timeframe', timeframe);
  }
  return url;
};

const aggregateMessages = (payload) => {
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  return [...warnings, ...errors]
    .map((entry) => {
      if (!entry) return '';
      const symbol = entry.symbol ? `${entry.symbol}: ` : '';
      return `${symbol}${entry.message || entry.warning || entry.error || ''}`.trim();
    })
    .filter(Boolean)
    .join(' | ');
};

const normaliseRow = (entry = {}) => {
  const metrics = Array.isArray(entry.metrics) ? entry.metrics.slice(0, 2) : [];
  return {
    symbol: entry.symbol || '',
    price: Number.isFinite(Number(entry.price)) ? Number(entry.price) : null,
    currency: entry.currency || 'USD',
    aiUpsidePct: Number.isFinite(Number(entry.aiUpsidePct)) ? Number(entry.aiUpsidePct) : null,
    metrics,
    metric1: Number.isFinite(Number(entry.metric1)) ? Number(entry.metric1) : null,
    metric2: Number.isFinite(Number(entry.metric2)) ? Number(entry.metric2) : null,
  };
};

const loadBatchResults = async (symbols) => {
  const validSymbols = Array.isArray(symbols) && symbols.length ? symbols : DEFAULT_SYMBOLS;
  abortInFlight();
  if (!validSymbols.length) {
    setStatus('Add at least one valid ticker to run a batch scan.', 'error');
    renderTable([]);
    return;
  }

  const controller = new AbortController();
  state.controller = controller;

  try {
    setLoading(true);
    setStatus(`Loading batch intelligence for ${validSymbols.length} tickers…`, 'info');
    const url = buildRequestUrl(validSymbols);
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      const message = errorPayload?.error || `Batch request failed (${response.status})`;
      throw new Error(message);
    }
    const payload = await response.json();
    const rows = Array.isArray(payload?.results)
      ? payload.results.filter((row) => !row?.error).map((row) => normaliseRow(row))
      : [];
    state.rows = rows;
    state.lastSymbols = [...validSymbols];
    state.sort = state.sort || { key: 'aiUpsidePct', direction: 'desc' };
    const sorted = sortRows(rows);
    renderTable(sorted);
    setSummary(sorted);
    const aggregate = aggregateMessages(payload);
    if (aggregate) {
      setStatus(aggregate, 'warning');
    } else {
      setStatus(`Loaded ${rows.length} tickers from batch call.`, rows.length ? 'success' : 'info');
    }
    if (!rows.length) {
      renderPlaceholder('Batch response returned no usable rows.');
    }
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.error('Batch table load failed', error);
    setStatus(error?.message || 'Unable to load batch intelligence.', 'error');
    renderTable([]);
    setSummary([]);
  } finally {
    if (state.controller === controller) {
      state.controller = null;
    }
    setLoading(false);
  }
};

const handleRunClick = () => {
  const input = $('#batchSymbolsInput');
  const symbols = parseSymbols(input?.value || '');
  loadBatchResults(symbols.length ? symbols : DEFAULT_SYMBOLS);
};

const handleResetClick = () => {
  const input = $('#batchSymbolsInput');
  if (input) {
    input.value = DEFAULT_SYMBOLS.join(', ');
  }
  loadBatchResults([...DEFAULT_SYMBOLS]);
};

export function initBatchResultsModule() {
  const input = $('#batchSymbolsInput');
  if (input && !input.value) {
    input.value = DEFAULT_SYMBOLS.join(', ');
  }
  attachSortHandlers();
  setSummary([]);
  renderTable([]);
  setStatus('Configure tickers and run a batch scan to view aggregate intelligence.', 'info');

  $('#batchRunButton')?.addEventListener('click', handleRunClick);
  $('#batchResetButton')?.addEventListener('click', handleResetClick);
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleRunClick();
    }
  });

  // Auto-run on load for default coverage.
  loadBatchResults([...DEFAULT_SYMBOLS]);
}

export default initBatchResultsModule;
