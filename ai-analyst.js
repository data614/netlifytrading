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

const fmtMultiple = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num.toFixed(1)}×`;
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

async function fetchIntel({ symbol, limit, timeframe }) {
  const url = new URL('/.netlify/functions/ai-analyst', window.location.origin);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('limit', limit);
  url.searchParams.set('timeframe', timeframe);
  url.searchParams.set('newsLimit', 12);
  url.searchParams.set('documentLimit', 12);

  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
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

async function runAnalysis() {
  const symbol = ($('#tickerInput').value || 'AAPL').trim().toUpperCase();
  const limit = Number($('#lookbackInput').value) || 120;
  const timeframe = $('#timeframeSelect').value || '3M';

  lastAnalysis = null;
  setStatus('Running analysis…');

  try {
    const { data } = await fetchIntel({ symbol, limit, timeframe });
    renderHeatmap(data?.heatmap || []); // 👈 heatmap support
    updateRadarChart([10, 20, 40, 80]); // sample radar data
    lastAnalysis = { symbol, limit, timeframe, data };
    setStatus('Analysis completed.');
  } catch (err) {
    console.error(err);
    setStatus(err.message, 'error');
  }
}

/* -----------------------------
   Init
------------------------------ */

function init() {
  $('#runAnalysis')?.addEventListener('click', runAnalysis);
  $('#exportReport')?.addEventListener('click', () => {
    if (!lastAnalysis) return;
    downloadCsv(lastAnalysis.symbol, lastAnalysis.data);
  });
  runAnalysis();
}

document.addEventListener('DOMContentLoaded', init);

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
