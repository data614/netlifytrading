import {
  searchSymbols,
  fetchPriceSeries,
  fetchCompanyIntel,
  requestAiInsight,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatDate,
  debounce,
  computeVolatility,
  computeMaxDrawdown,
  compoundGrowthRate,
} from './apiClient.js';
import { buildLineChart } from './charting.js';

const timeframeToSeries = {
  '1D': { mode: 'intraday', interval: '5min', limit: 78 },
  '1W': { mode: 'intraday', interval: '30min', limit: 65 },
  '1M': { mode: 'eod', limit: 30 },
  '3M': { mode: 'eod', limit: 90 },
  '6M': { mode: 'eod', limit: 180 },
  '1Y': { mode: 'eod', limit: 365 },
  '3Y': { mode: 'eod', limit: 365 * 3 },
  '5Y': { mode: 'eod', limit: 365 * 5 },
};

const state = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  exchange: 'XNAS',
  timeframe: '1Y',
  chart: null,
  series: [],
  intel: null,
  aiInFlight: false,
  aiResult: null,
};

const dom = {};

function $(id) {
  return document.getElementById(id);
}

function setStatus(el, text, tone = '') {
  if (!el) return;
  el.textContent = text;
  el.classList.remove('ok', 'warn', 'error');
  if (tone) el.classList.add(tone);
}

function renderMetrics(container, metrics = []) {
  if (!container) return;
  if (!metrics.length) {
    container.innerHTML = '<p class="pro-empty">No data available.</p>';
    return;
  }
  container.innerHTML = metrics
    .map((metric) => `
      <div class="pro-metric">
        <span class="label">${metric.label}</span>
        <span class="value">${metric.value}</span>
        ${metric.detail ? `<span class="pro-status">${metric.detail}</span>` : ''}
      </div>
    `)
    .join('');
}

function renderTimeline(container, items = [], emptyMessage = 'No recent items recorded.') {
  if (!container) return;
  if (!items.length) {
    container.innerHTML = `<div class="pro-empty">${emptyMessage}</div>`;
    return;
  }
  container.innerHTML = items
    .map((item) => `
      <article class="pro-timeline-item">
        <div class="pro-chip-row">
          <span class="pro-chip ${item.tone || ''}">${item.type || 'Update'}</span>
          ${item.tags?.map((tag) => `<span class="pro-chip">${tag}</span>`).join('') || ''}
        </div>
        <strong>${item.headline || item.title}</strong>
        <p>${item.summary || ''}</p>
        <p class="pro-status">${formatDate(item.publishedAt)} — <a href="${item.url}" target="_blank" rel="noopener">Source</a></p>
      </article>
    `)
    .join('');
}

async function updateChart() {
  const canvas = dom.chart;
  if (!canvas) return;
  if (!state.series.length) {
    setStatus(dom.chartStatus, 'No pricing data available for the selected timeframe.', 'warn');
    canvas.replaceWith(canvas.cloneNode(true));
    dom.chart = $('deskChart');
    return;
  }
  setStatus(dom.chartStatus, '', '');
  state.chart = buildLineChart(canvas, state.series);
}

function buildHeadlineMetrics() {
  const latest = state.series.at(-1);
  const first = state.series[0];
  const currency = state.intel?.snapshot?.currency || 'USD';
  const price = formatCurrency(Number(latest?.close ?? latest?.price ?? 0), currency);
  const change = latest && first && Number(first.close) > 0
    ? ((latest.close - first.close) / first.close)
    : 0;
  const vol = computeVolatility(state.series);
  const drawdown = computeMaxDrawdown(state.series);
  const cagr = compoundGrowthRate(state.series);

  return [
    { label: 'Last Price', value: price },
    { label: 'Period Change', value: formatPercent(change || 0) },
    { label: 'Annualised Volatility', value: formatPercent(vol || 0) },
    { label: 'Max Drawdown', value: formatPercent(drawdown || 0) },
    { label: 'Compound Growth', value: formatPercent(cagr || 0) },
  ];
}

function renderSnapshotChips() {
  const container = dom.snapshotChips;
  if (!container) return;
  const chips = [];
  const { intel } = state;
  if (intel?.snapshot?.sector) {
    chips.push(`<span class="pro-chip">${intel.snapshot.sector}</span>`);
  }
  if (intel?.snapshot?.industry) {
    chips.push(`<span class="pro-chip">${intel.snapshot.industry}</span>`);
  }
  if (intel?.snapshot?.marketCap) {
    chips.push(`<span class="pro-chip">Mkt Cap ${formatNumber(intel.snapshot.marketCap, { maximumFractionDigits: 0 })}</span>`);
  }
  if (intel?.snapshot?.country) {
    chips.push(`<span class="pro-chip">${intel.snapshot.country}</span>`);
  }
  container.innerHTML = chips.join('');
}

function renderOperationalMetrics() {
  const block = [];
  const snap = state.intel?.snapshot;
  if (!snap) return block;
  block.push({ label: 'Revenue Growth', value: formatPercent(snap.revenueGrowth ?? 0) });
  block.push({ label: 'EBIT Margin', value: formatPercent(snap.ebitMargin ?? 0) });
  block.push({ label: 'Free Cash Flow', value: formatCurrency(snap.freeCashFlow ?? 0, snap.currency) });
  block.push({ label: 'Return on Equity', value: formatPercent(snap.returnOnEquity ?? 0) });
  block.push({ label: 'Net Debt', value: formatCurrency(snap.netDebt ?? 0, snap.currency) });
  block.push({ label: 'Liquidity Ratio', value: formatNumber(snap.currentRatio ?? 0, { maximumFractionDigits: 2 }) });
  return block;
}

function renderStrategicMetrics() {
  const metrics = [];
  const valuations = state.intel?.valuations;
  if (!valuations) return metrics;
  metrics.push({ label: 'Intrinsic Value', value: formatCurrency(valuations.intrinsicValue ?? 0, state.intel?.snapshot?.currency) });
  metrics.push({ label: 'Margin of Safety', value: formatPercent(valuations.marginOfSafety ?? 0) });
  metrics.push({ label: 'Forward PE', value: formatNumber(valuations.forwardPe ?? valuations.trailingPe ?? 0, { maximumFractionDigits: 1 }) });
  metrics.push({ label: 'EV / EBITDA', value: formatNumber(valuations.evToEbitda ?? 0, { maximumFractionDigits: 1 }) });
  metrics.push({ label: 'Alpha Outlook', value: valuations.alphaOutlook || 'Neutral' });
  metrics.push({ label: 'Risk Premium', value: formatPercent(valuations.riskPremium ?? 0) });
  return metrics;
}

function renderDocuments(documents = []) {
  return documents.map((doc) => ({
    type: doc.category || 'Filing',
    tone: doc.impact || '',
    headline: doc.title,
    summary: doc.summary || '',
    publishedAt: doc.publishedAt,
    url: doc.url,
    tags: doc.tags,
  }));
}

function renderEvents(events = []) {
  return events.map((event) => ({
    type: event.type || 'Event',
    tone: event.severity || '',
    headline: event.headline,
    summary: event.summary,
    publishedAt: event.publishedAt,
    url: event.url,
    tags: event.tags,
  }));
}

async function loadSymbol(symbol, opts = {}) {
  state.symbol = symbol || state.symbol;
  state.exchange = opts.exchange || state.exchange;
  state.name = opts.name || state.name;
  const label = `${state.name || symbol} — ${state.exchange || ''}:${symbol}`;
  dom.selectedName.textContent = label;
  try {
    setStatus(dom.searchStatus, 'Loading price action…');
    const tfConfig = timeframeToSeries[state.timeframe] || timeframeToSeries['1Y'];
    const { series, warning } = await fetchPriceSeries(state.symbol, { ...tfConfig, exchange: state.exchange });
    state.series = series || [];
    if (warning) setStatus(dom.chartStatus, warning, 'warn');
    renderMetrics(dom.headlineMetrics, buildHeadlineMetrics());
    await updateChart();
    setStatus(dom.searchStatus, `Loaded ${state.symbol} market data.`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus(dom.searchStatus, err.message || 'Failed to load market data.', 'error');
  }

  try {
    setStatus(dom.aiStatus, 'Refreshing corporate intelligence layers…');
    state.intel = await fetchCompanyIntel(state.symbol, state.exchange);
    renderSnapshotChips();
    renderMetrics(dom.operational, renderOperationalMetrics());
    renderMetrics(dom.strategic, renderStrategicMetrics());
    renderTimeline(dom.events, renderEvents(state.intel?.events), 'No strategic events in the past quarter.');
    renderTimeline(dom.documents, renderDocuments(state.intel?.documents), 'No high-priority filings or transcripts detected.');
    setStatus(dom.aiStatus, 'ChatGPT-5 will combine valuation science with the intelligence layers above.');
  } catch (err) {
    console.error(err);
    setStatus(dom.aiStatus, err.message || 'Failed to load company intelligence.', 'warn');
  }
}

async function handleAiRequest() {
  if (state.aiInFlight) return;
  state.aiInFlight = true;
  dom.aiRunButton.disabled = true;
  setStatus(dom.aiStatus, 'ChatGPT-5 is reviewing filings, events, and valuation drivers…');
  const focusSelect = dom.aiFocus;
  const selected = Array.from(focusSelect?.selectedOptions || []).map((opt) => opt.value);
  const directives = dom.aiDirectives.value.trim();

  try {
    const pricePoint = state.series.at(-1);
    const priceSummary = {
      lastPrice: pricePoint?.close ?? pricePoint?.price ?? null,
      timeframe: state.timeframe,
      change: buildHeadlineMetrics()?.[1]?.value || '',
    };

    const payload = await requestAiInsight({
      symbol: state.symbol,
      timeframe: state.timeframe,
      objectives: { focus: selected, directives },
      intel: state.intel,
      priceSummary,
    });
    state.aiResult = payload;
    dom.aiResult.classList.remove('pro-empty');
    dom.aiResult.innerHTML = `
      <div class="pro-chip-row">
        <span class="pro-chip success">True Value ${payload?.valuation?.fairValue ? formatCurrency(payload.valuation.fairValue, state.intel?.snapshot?.currency) : 'Unavailable'}</span>
        <span class="pro-chip">Confidence ${formatPercent(payload?.valuation?.confidence ?? 0)}</span>
        <span class="pro-chip">Bias ${payload?.valuation?.bias ?? 'Neutral'}</span>
      </div>
      <div>${(payload?.analysis || '').replace(/\n/g, '<br>')}</div>
    `;
    setStatus(dom.aiStatus, payload?.message || 'AI valuation completed.', 'ok');
  } catch (err) {
    console.error(err);
    dom.aiResult.classList.add('pro-empty');
    dom.aiResult.textContent = err.message || 'The analyst could not complete the request.';
    setStatus(dom.aiStatus, err.message || 'ChatGPT-5 could not evaluate the company.', 'error');
  } finally {
    state.aiInFlight = false;
    dom.aiRunButton.disabled = false;
  }
}

async function handleSearchInput(value) {
  const query = value.trim();
  if (!query) {
    dom.searchResults.hidden = true;
    dom.searchResults.innerHTML = '';
    return;
  }
  setStatus(dom.searchStatus, 'Scanning global exchanges…');
  try {
    const results = await searchSymbols(query, { limit: 15 });
    if (!results.length) {
      dom.searchResults.hidden = true;
      dom.searchResults.innerHTML = '';
      setStatus(dom.searchStatus, 'No matches found.', 'warn');
      return;
    }
    dom.searchResults.hidden = false;
    dom.searchResults.innerHTML = results
      .map((item) => `
        <button type="button" data-symbol="${item.symbol}" data-exchange="${item.mic || item.exchange}" data-name="${item.name || item.symbol}">
          <span style="flex:1 1 auto;">
            <strong>${item.symbol}</strong> — ${item.name || ''}
          </span>
          <span>${item.exchange || item.mic || ''}</span>
        </button>
      `)
      .join('');
  } catch (err) {
    dom.searchResults.hidden = true;
    setStatus(dom.searchStatus, err.message || 'Search failed.', 'error');
  }
}

function attachListeners() {
  dom.search.addEventListener('input', debounce((event) => handleSearchInput(event.target.value), 250));
  dom.searchResults.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-symbol]');
    if (!button) return;
    dom.searchResults.hidden = true;
    const symbol = button.dataset.symbol;
    const exchange = button.dataset.exchange;
    const name = button.dataset.name;
    dom.search.value = symbol;
    loadSymbol(symbol, { exchange, name });
  });
  dom.timeframe.addEventListener('change', (event) => {
    state.timeframe = event.target.value;
    loadSymbol(state.symbol);
  });
  dom.aiRunButton.addEventListener('click', (event) => {
    event.preventDefault();
    handleAiRequest();
  });
}

function captureDom() {
  dom.search = $('deskSearch');
  dom.searchResults = $('deskSearchResults');
  dom.searchStatus = $('searchStatus');
  dom.selectedName = $('deskSelectedName');
  dom.chart = $('deskChart');
  dom.chartStatus = $('deskChartStatus');
  dom.snapshotChips = $('deskSnapshotChips');
  dom.headlineMetrics = $('deskHeadlineMetrics');
  dom.operational = $('deskOperational');
  dom.strategic = $('deskStrategic');
  dom.events = $('deskEvents');
  dom.documents = $('deskDocuments');
  dom.timeframe = $('deskTimeframe');
  dom.aiStatus = $('aiStatus');
  dom.aiRunButton = $('aiRunButton');
  dom.aiResult = $('aiResult');
  dom.aiFocus = $('aiFocus');
  dom.aiDirectives = $('aiDirectives');
}

async function bootstrap() {
  captureDom();
  attachListeners();
  await loadSymbol(state.symbol, { exchange: state.exchange, name: state.name });
}

document.addEventListener('DOMContentLoaded', bootstrap);

