import { computeValuationScores, VALUATION_RADAR_LABELS } from './utils/valuation-scorer.js';
import { enrichError } from './utils/frontend-errors.js';
import normalizeAiAnalystPayload from './utils/ai-analyst-normalizer.js';

const $ = (selector) => document.querySelector(selector);

const fmtCurrency = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
};

const fmtPercent = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num > 0 ? '+' : ''}${num.toFixed(1)}%`;
};

const fmtDate = (iso) => {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const isFiniteNumber = (value) =>
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

let priceChart;
let valuationRadarChart;
let heatmapChart;
let lastAnalysis = null;
let runButtonDefaultHtml = '';
let refreshButtonDefaultHtml = '';
let analysisInFlight = false;

const fmtMultiple = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num.toFixed(1)}×`;
};

const humanizeLabel = (value = '') =>
  value
    .toString()
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const setElementText = (id, text) => {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
  }
};

const setMetricBar = (id, score) => {
  const el = document.getElementById(id);
  if (!el) return;
  if (Number.isFinite(score)) {
    el.style.width = `${Math.max(0, Math.min(100, Math.round(score)))}%`;
    el.setAttribute('aria-valuenow', String(Math.round(score)));
  } else {
    el.style.width = '0%';
    el.setAttribute('aria-valuenow', '0');
  }
};

const buttonSpinnerHtml = (label) =>
  `<span class="spinner" aria-hidden="true"></span><span>${label}</span>`;

const setButtonLoading = (button, defaultHtml, isLoading, loadingLabel) => {
  if (!button) return;
  if (isLoading) {
    button.disabled = true;
    button.innerHTML = buttonSpinnerHtml(loadingLabel);
  } else {
    button.disabled = false;
    button.innerHTML = defaultHtml;
  }
};

const describeCompositeCaption = (availableCount) => {
  if (!Number.isFinite(availableCount) || availableCount <= 0) {
    return 'AI valuation metrics are waiting on fresh fundamentals data.';
  }
  if (availableCount < 3) {
    return 'AI composite score is blending the metrics currently available.';
  }
  return 'AI composite score blends valuation multiples and upside factors.';
};

const renderValuationBreakdown = (breakdown) => {
  const container = document.getElementById('valuationBreakdown');
  if (!container) return;

  container.innerHTML = '';

  const isObject = breakdown && typeof breakdown === 'object';
  const entries = isObject ? Object.entries(breakdown) : [];

  if (!entries.length) {
    const fallback = document.createElement('p');
    fallback.className = 'valuation-breakdown-empty';
    fallback.textContent = 'Valuation breakdown will appear once AI valuation data refreshes.';
    container.appendChild(fallback);
    return;
  }

  entries.forEach(([rawKey, rawValue]) => {
    const label = typeof rawValue?.label === 'string' && rawValue.label.trim()
      ? rawValue.label.trim()
      : humanizeLabel(rawKey);

    const row = document.createElement('div');
    row.className = 'valuation-breakdown-line';

    const labelEl = document.createElement('div');
    labelEl.className = 'valuation-breakdown-label';
    labelEl.textContent = label;
    row.appendChild(labelEl);

    const descriptionParts = [];

    if (rawValue && typeof rawValue === 'object') {
      if (typeof rawValue.description === 'string' && rawValue.description.trim()) {
        descriptionParts.push(rawValue.description.trim());
      }

      if (isFiniteNumber(rawValue.score)) {
        descriptionParts.push(`Score ${Math.round(Number(rawValue.score))}`);
      }

      if (isFiniteNumber(rawValue.weight)) {
        descriptionParts.push(`Weight ${(Number(rawValue.weight) * 100).toFixed(0)}%`);
      }

      const contribution = rawValue.contribution ?? rawValue.value ?? null;
      if (isFiniteNumber(contribution)) {
        descriptionParts.push(`Value ${Number(contribution).toFixed(2)}`);
      }

      if (isFiniteNumber(rawValue.ratio)) {
        descriptionParts.push(`Ratio ${Number(rawValue.ratio).toFixed(2)}`);
      }
    } else if (isFiniteNumber(rawValue)) {
      descriptionParts.push(Number(rawValue).toFixed(2));
    } else if (typeof rawValue === 'string') {
      descriptionParts.push(rawValue.trim());
    }

    if (!descriptionParts.length) {
      descriptionParts.push('Data pending');
    }

    const metaEl = document.createElement('div');
    metaEl.className = 'valuation-breakdown-meta';
    metaEl.textContent = descriptionParts.join(' • ');
    row.appendChild(metaEl);

    container.appendChild(row);
  });
};

const renderValuationPanel = (valuationRoot = {}) => {
  const { price, fairValue, upside, entry, breakdown, fundamentals } = extractValuationMetrics(valuationRoot);

  setElementText('valuationPrice', fmtCurrency(price));
  setElementText('valuationFair', fmtCurrency(fairValue));
  setElementText('valuationUpside', Number.isFinite(upside) ? fmtPercent(upside * 100) : '—');
  setElementText('valuationEntry', fmtCurrency(entry));

  const scores = computeValuationScores({ price, upside, fundamentals });

  const peRatio = scores.pe?.ratio;
  const psRatio = scores.ps?.ratio;
  const upsidePercent = scores.upside?.percent;
  const compositeScore = scores.composite?.score;
  const availableCount = scores.composite?.availableCount ?? 0;

  setElementText('valuationPe', Number.isFinite(peRatio) ? fmtMultiple(peRatio) : '—');
  setElementText('valuationPs', Number.isFinite(psRatio) ? fmtMultiple(psRatio) : '—');
  setElementText('valuationUpsideMetric', Number.isFinite(upsidePercent) ? fmtPercent(upsidePercent) : '—');

  const aiScoreLabel = Number.isFinite(compositeScore) ? Math.round(Number(compositeScore)).toString() : '—';
  setElementText('valuationAiScore', aiScoreLabel);
  setElementText('valuationAiScoreInline', aiScoreLabel);

  setMetricBar('valuationPeBar', scores.pe?.score);
  setMetricBar('valuationPsBar', scores.ps?.score);
  setMetricBar('valuationUpsideBar', scores.upside?.score);
  setMetricBar('valuationScoreBar', compositeScore);

  updateRadarChart([
    scores.pe?.score,
    scores.ps?.score,
    scores.upside?.score,
    compositeScore,
  ]);

  setElementText('valuationRadarCaption', describeCompositeCaption(availableCount));
  renderValuationBreakdown(breakdown);
};

const toggleAnalysisLoading = ({ isLoading, forceRefresh }) => {
  const runButton = $('#runAnalysis');
  const refreshButton = $('#refreshValuation');

  if (forceRefresh) {
    setButtonLoading(refreshButton, refreshButtonDefaultHtml, isLoading, 'Refreshing…');
    if (runButton) {
      runButton.disabled = isLoading;
    }
  } else {
    setButtonLoading(runButton, runButtonDefaultHtml, isLoading, 'Running…');
    if (refreshButton) {
      refreshButton.disabled = isLoading;
    }
  }
};

/* -----------------------------
   Core Valuation Utilities
------------------------------ */

function extractValuationMetrics(valuationData = {}) {
  const valuation = valuationData?.valuation || valuationData;
  const price = valuation?.price ?? valuationData?.price ?? valuationData?.quote?.price;
  const fairValue = valuation?.fairValue ?? valuation?.valuation?.fairValue ?? null;
  const upside = price && fairValue ? (fairValue - price) / price : null;
  const entry = valuation?.suggestedEntry ?? valuation?.valuation?.suggestedEntry ?? valuationData?.suggestedEntry;
  const breakdown = valuation?.valuation?.components || valuation?.components || {};
  const fundamentals = valuationData?.fundamentals || valuation?.fundamentals || null;
  return { price, fairValue, upside, entry, breakdown, fundamentals };
}

/* -----------------------------
   Radar Chart Rendering
------------------------------ */

function updateRadarChart(values = []) {
  const canvas = document.getElementById('valuationRadarChart');
  if (!canvas) return;
  const datasetValues = VALUATION_RADAR_LABELS.map((_, index) => {
    const value = values[index];
    return Number.isFinite(value) ? value : 0;
  });

  if (!valuationRadarChart) {
    valuationRadarChart = new Chart(canvas, {
      type: 'radar',
      data: {
        labels: VALUATION_RADAR_LABELS,
        datasets: [
          {
            data: datasetValues,
            fill: true,
            tension: 0.3,
            backgroundColor: 'rgba(74, 215, 168, 0.18)',
            borderColor: 'rgba(74, 215, 168, 0.65)',
            borderWidth: 2,
            pointBackgroundColor: 'rgba(74, 215, 168, 0.9)',
            pointBorderColor: 'rgba(74, 215, 168, 0.9)',
            pointRadius: 3,
            pointHoverRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { r: { suggestedMin: 0, suggestedMax: 100 } },
      },
    });
  } else {
    valuationRadarChart.data.datasets[0].data = datasetValues;
    valuationRadarChart.update();
  }
}

/* -----------------------------
   Heatmap Rendering
------------------------------ */

function renderHeatmap(matrix = []) {
  const canvas = document.getElementById('valuationHeatmap');
  if (!canvas) return;

  if (heatmapChart) {
    heatmapChart.destroy();
  }

  const labelsX = [...new Set(matrix.map((m) => m.x))];
  const labelsY = [...new Set(matrix.map((m) => m.y))];

  heatmapChart = new Chart(canvas, {
    type: 'matrix',
    data: {
      datasets: [
        {
          label: 'Valuation Heatmap',
          data: matrix.map((m) => ({ x: m.x, y: m.y, v: m.v })),
          backgroundColor(ctx) {
            const v = ctx.dataset.data[ctx.dataIndex].v;
            return v > 0 ? `rgba(74,215,168,${v / 100})` : `rgba(255,99,132,${Math.abs(v) / 100})`;
          },
          borderWidth: 1,
          width: () => 25,
          height: () => 25,
        },
      ],
    },
    options: {
      scales: {
        x: { labels: labelsX },
        y: { labels: labelsY },
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => `(${ctx.raw.x}, ${ctx.raw.y}): ${fmtPercent(ctx.raw.v)}`,
          },
        },
      },
    },
  });
}

/* -----------------------------
   CSV Export
------------------------------ */

function downloadCsv(symbol, data) {
  const rows = [];
  rows.push(['Metric', 'Value']);
  const { price, fairValue, upside, entry } = extractValuationMetrics(data?.valuation || {});
  rows.push(['Last price', price]);
  rows.push(['Fair value', fairValue]);
  rows.push(['Upside', upside]);
  rows.push(['Entry', entry]);

  if (Array.isArray(data?.trend)) {
    rows.push([]);
    rows.push(['Date', 'Price']);
    data.trend.forEach((t) => {
      rows.push([t.date, t.close ?? t.price ?? t.last]);
    });
  }

  let csv = rows.map((r) => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${symbol}-ai-analyst.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* -----------------------------
   Intel Fetcher
------------------------------ */

async function fetchIntel({ symbol, limit, timeframe, forceRefresh = false }) {
  const url = new URL('/.netlify/functions/ai-analyst', window.location.origin);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('limit', limit);
  url.searchParams.set('timeframe', timeframe);
  url.searchParams.set('newsLimit', 12);
  url.searchParams.set('documentLimit', 12);
  if (forceRefresh) {
    url.searchParams.set('refreshTs', Date.now().toString());
    url.searchParams.set('forceRefresh', '1');
  }

  try {
    const fetchOptions = {
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      cache: forceRefresh ? 'reload' : 'default',
    };
    const response = await fetch(url, fetchOptions);
    if (!response.ok) throw new Error(`AI Analyst request failed (${response.status})`);
    const body = await response.json();
    const warningHeader = response.headers.get('x-ai-analyst-warning') || '';
    return normalizeAiAnalystPayload(body, { warningHeader });
  } catch (error) {
    throw enrichError(error, {
      context: 'ai-analyst',
      fallback: 'AI Analyst is currently unavailable. Please try again shortly.',
    });
  }
}

/* -----------------------------
   Analysis Runner
------------------------------ */

async function runAnalysis(options = {}) {
  const { forceRefresh = false } = options;
  if (analysisInFlight) return;

  const symbol = ($('#tickerInput').value || 'AAPL').trim().toUpperCase();
  const limit = Number($('#lookbackInput').value) || 120;
  const timeframe = $('#timeframeSelect').value || '3M';

  analysisInFlight = true;
  lastAnalysis = null;
  toggleAnalysisLoading({ isLoading: true, forceRefresh });
  setStatus(forceRefresh ? 'Refreshing valuation…' : 'Running analysis…');

  try {
    const { data, warning } = await fetchIntel({ symbol, limit, timeframe, forceRefresh });
    renderHeatmap(data?.heatmap || []); // 👈 heatmap support
    renderValuationPanel(data?.valuation || {});
    lastAnalysis = { symbol, limit, timeframe, data, warning };
    const message = warning || (forceRefresh ? 'Valuation refreshed.' : 'Analysis completed.');
    setStatus(message, warning ? 'info' : 'success');
  } catch (err) {
    console.error(err);
    setStatus(err.message, 'error');
  } finally {
    analysisInFlight = false;
    toggleAnalysisLoading({ isLoading: false, forceRefresh });
  }
}

/* -----------------------------
   Init
------------------------------ */

function init() {
  const runButton = $('#runAnalysis');
  const refreshButton = $('#refreshValuation');

  if (runButton) {
    runButtonDefaultHtml = runButton.innerHTML;
    runButton.addEventListener('click', () => runAnalysis({ forceRefresh: false }));
  }

  if (refreshButton) {
    refreshButtonDefaultHtml = refreshButton.innerHTML;
    refreshButton.addEventListener('click', () => runAnalysis({ forceRefresh: true }));
  }

  $('#exportReport')?.addEventListener('click', () => {
    if (!lastAnalysis) return;
    downloadCsv(lastAnalysis.symbol, lastAnalysis.data);
  });
  runAnalysis();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}

/* -----------------------------
   Status Helper
------------------------------ */

function setStatus(msg, tone = 'info') {
  const el = $('#statusMessage');
  if (el) {
    el.textContent = msg;
    el.className = `status-message ${tone}`;
  }
}
