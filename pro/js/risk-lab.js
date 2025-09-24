import {
  searchSymbols,
  fetchPriceSeries,
  formatCurrency,
  formatPercent,
  formatNumber,
  debounce,
  computeReturns,
  computeVolatility,
  computeMaxDrawdown,
  movingAverage,
} from './apiClient.js';
import { buildLineChart } from './charting.js';

const horizonConfig = {
  '1M': { mode: 'eod', limit: 30 },
  '3M': { mode: 'eod', limit: 90 },
  '6M': { mode: 'eod', limit: 180 },
  '1Y': { mode: 'eod', limit: 365 },
  '3Y': { mode: 'eod', limit: 365 * 3 },
};

const state = {
  symbol: 'AAPL',
  exchange: 'XNAS',
  horizon: '3M',
  series: [],
  chart: null,
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
    container.innerHTML = '<p class="pro-empty">Not enough data to compute risk analytics.</p>';
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

function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function computeSkewness(returns) {
  const n = returns.length;
  if (n < 3) return 0;
  const mean = returns.reduce((sum, v) => sum + v, 0) / n;
  const std = Math.sqrt(returns.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1));
  if (std === 0) return 0;
  const skew = returns.reduce((sum, v) => sum + ((v - mean) / std) ** 3, 0);
  return (n / ((n - 1) * (n - 2))) * skew;
}

function computeKurtosis(returns) {
  const n = returns.length;
  if (n < 4) return 0;
  const mean = returns.reduce((sum, v) => sum + v, 0) / n;
  const std = Math.sqrt(returns.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n);
  if (std === 0) return 0;
  const kurt = returns.reduce((sum, v) => sum + ((v - mean) / std) ** 4, 0) / n;
  return kurt - 3; // excess kurtosis
}

function computeHistoricalVar(returns, confidence = 0.95) {
  if (!returns.length) return 0;
  const losses = returns.filter((r) => r < 0);
  if (!losses.length) return 0;
  const percentile = quantile(losses, 1 - confidence);
  return Math.abs(percentile);
}

function updateRiskMetrics() {
  const returns = computeReturns(state.series);
  const vol = computeVolatility(state.series);
  const maxDD = computeMaxDrawdown(state.series);
  const skew = computeSkewness(returns);
  const kurt = computeKurtosis(returns);
  const meanReturn = returns.length
    ? returns.reduce((sum, v) => sum + v, 0) / returns.length
    : 0;
  const var95 = computeHistoricalVar(returns, 0.95);

  const metrics = [
    { label: 'Annualised Volatility', value: formatPercent(vol) },
    { label: 'Average Daily Return', value: formatPercent(meanReturn) },
    { label: 'Max Drawdown', value: formatPercent(maxDD) },
    { label: 'Historical VaR (95%)', value: formatPercent(var95) },
    { label: 'Skewness', value: formatNumber(skew, { maximumFractionDigits: 2 }) },
    { label: 'Excess Kurtosis', value: formatNumber(kurt, { maximumFractionDigits: 2 }) },
  ];
  renderMetrics(dom.metrics, metrics);
}

function updateTrendDiagnostics() {
  const ma20 = movingAverage(state.series, 20).at(-1)?.value;
  const ma50 = movingAverage(state.series, 50).at(-1)?.value;
  const ma200 = movingAverage(state.series, 200).at(-1)?.value;
  const last = Number(state.series.at(-1)?.close ?? state.series.at(-1)?.price ?? 0);
  const currency = 'USD';

  const trendMetrics = [];
  if (last && ma20) {
    trendMetrics.push({
      label: 'Price vs 20D',
      value: formatPercent((last - ma20) / ma20),
      detail: `Price ${last > ma20 ? 'above' : 'below'} short-term trend`,
    });
  }
  if (ma50 && ma200) {
    trendMetrics.push({
      label: '50D vs 200D',
      value: formatPercent((ma50 - ma200) / ma200),
      detail: ma50 > ma200 ? 'Bullish structure' : 'Bearish structure',
    });
  }
  if (ma200) {
    trendMetrics.push({ label: '200D Level', value: formatCurrency(ma200, currency) });
  }
  renderMetrics(dom.trend, trendMetrics);
}

function updateDistributionDiagnostics() {
  const returns = computeReturns(state.series);
  if (!returns.length) {
    renderMetrics(dom.distribution, []);
    return;
  }
  const mean = returns.reduce((sum, v) => sum + v, 0) / returns.length;
  const variance = returns.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (returns.length - 1 || 1);
  const std = Math.sqrt(Math.max(variance, 0));
  const downside = returns.filter((r) => r < 0).reduce((sum, v) => sum + v, 0) / (returns.filter((r) => r < 0).length || 1);
  const upside = returns.filter((r) => r > 0).reduce((sum, v) => sum + v, 0) / (returns.filter((r) => r > 0).length || 1);

  const metrics = [
    { label: 'Mean Daily Return', value: formatPercent(mean) },
    { label: 'Standard Deviation', value: formatPercent(std) },
    { label: 'Downside Capture', value: formatPercent(Math.abs(downside)) },
    { label: 'Upside Capture', value: formatPercent(upside) },
  ];
  renderMetrics(dom.distribution, metrics);
}

function updateScenario() {
  const position = Number(dom.scenarioPosition.value) || 0;
  const movePercent = Number(dom.scenarioMove.value) || 0;
  const volMultiplier = Number(dom.scenarioVol.value) || 1;
  const lastPrice = Number(state.series.at(-1)?.close ?? state.series.at(-1)?.price ?? 0);
  const entryPrice = Number(dom.scenarioEntry.value) || lastPrice;

  if (!position || !lastPrice) {
    dom.scenarioPnL.textContent = '—';
    dom.scenarioVar.textContent = '—';
    setStatus(dom.scenarioStatus, 'Provide position inputs to simulate scenarios.');
    return;
  }

  const scenarioPrice = lastPrice * (1 + movePercent / 100);
  const pnl = (scenarioPrice - entryPrice) * position;
  dom.scenarioPnL.textContent = formatCurrency(pnl, 'USD');
  dom.scenarioPnLDetail.textContent = `Price moves to ${formatCurrency(scenarioPrice, 'USD')} (${formatPercent(movePercent / 100)}).`;

  const returns = computeReturns(state.series);
  const var95 = computeHistoricalVar(returns, 0.95) * volMultiplier;
  const varValue = entryPrice * position * var95;
  dom.scenarioVar.textContent = formatCurrency(varValue, 'USD');
  dom.scenarioVarDetail.textContent = `Historical VaR scaled by ${volMultiplier.toFixed(2)}× volatility.`;
  setStatus(dom.scenarioStatus, 'Scenario analytics refreshed.', 'ok');
}

async function updateChart() {
  if (!dom.chart) return;
  if (!state.series.length) {
    dom.chartStatus.textContent = 'No data for chart.';
    return;
  }
  state.chart = buildLineChart(dom.chart, state.series);
  dom.chartStatus.textContent = '';
}

async function loadSymbol(symbol, opts = {}) {
  state.symbol = symbol || state.symbol;
  state.exchange = opts.exchange || state.exchange;
  dom.search.value = state.symbol;
  dom.searchResults.hidden = true;
  setStatus(dom.status, `Loading price history for ${state.symbol}…`);
  try {
    const config = horizonConfig[state.horizon] || horizonConfig['3M'];
    const { series, warning } = await fetchPriceSeries(state.symbol, { ...config, exchange: state.exchange });
    state.series = series;
    if (warning) setStatus(dom.chartStatus, warning, 'warn');
    await updateChart();
    updateRiskMetrics();
    updateTrendDiagnostics();
    updateDistributionDiagnostics();
    updateScenario();
    setStatus(dom.status, `Risk analytics refreshed for ${state.symbol}.`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus(dom.status, err.message || 'Failed to load risk analytics.', 'error');
  }
}

async function handleSearchInput(value) {
  const query = value.trim();
  if (!query) {
    dom.searchResults.hidden = true;
    dom.searchResults.innerHTML = '';
    return;
  }
  setStatus(dom.status, 'Searching tickers…');
  try {
    const results = await searchSymbols(query, { limit: 15 });
    if (!results.length) {
      dom.searchResults.hidden = true;
      setStatus(dom.status, 'No matches found.', 'warn');
      return;
    }
    dom.searchResults.hidden = false;
    dom.searchResults.innerHTML = results
      .map((item) => `
        <button type="button" data-symbol="${item.symbol}" data-exchange="${item.mic || item.exchange}">
          <span style="flex:1 1 auto;"><strong>${item.symbol}</strong> — ${item.name || ''}</span>
          <span>${item.exchange || item.mic || ''}</span>
        </button>
      `)
      .join('');
  } catch (err) {
    dom.searchResults.hidden = true;
    setStatus(dom.status, err.message || 'Search failed.', 'error');
  }
}

function attachListeners() {
  dom.search.addEventListener('input', debounce((event) => handleSearchInput(event.target.value), 250));
  dom.searchResults.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-symbol]');
    if (!button) return;
    loadSymbol(button.dataset.symbol, { exchange: button.dataset.exchange });
  });
  dom.horizon.addEventListener('change', (event) => {
    state.horizon = event.target.value;
    loadSymbol(state.symbol);
  });
  dom.scenarioForm.addEventListener('input', () => updateScenario());
}

function captureDom() {
  dom.search = $('riskSearch');
  dom.searchResults = $('riskSearchResults');
  dom.status = $('riskStatus');
  dom.chart = $('riskChart');
  dom.chartStatus = $('riskChartStatus');
  dom.metrics = $('riskMetrics');
  dom.trend = $('riskTrend');
  dom.distribution = $('riskDistribution');
  dom.horizon = $('riskHorizon');
  dom.scenarioForm = $('scenarioForm');
  dom.scenarioPosition = $('scenarioPosition');
  dom.scenarioEntry = $('scenarioEntry');
  dom.scenarioMove = $('scenarioMove');
  dom.scenarioVol = $('scenarioVol');
  dom.scenarioPnL = $('scenarioPnL');
  dom.scenarioPnLDetail = $('scenarioPnLDetail');
  dom.scenarioVar = $('scenarioVar');
  dom.scenarioVarDetail = $('scenarioVarDetail');
  dom.scenarioStatus = $('scenarioStatus');
}

async function bootstrap() {
  captureDom();
  attachListeners();
  await loadSymbol(state.symbol, { exchange: state.exchange });
}

document.addEventListener('DOMContentLoaded', bootstrap);

