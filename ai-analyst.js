import { computeValuationScores, VALUATION_RADAR_LABELS } from './utils/valuation-scorer.js';
import { enrichError } from './utils/frontend-errors.js';

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
let lastAnalysis = null;
let runButtonDefaultHtml = '';

const fmtMultiple = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num.toFixed(1)}×`;
};

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

function resetValuationCard(
  message = 'Awaiting valuation inputs from Tiingo fundamentals.',
  radarMessage = 'Quant metrics awaiting Tiingo fundamentals.',
) {
  $('#valuationPrice').textContent = '—';
  $('#valuationFair').textContent = '—';
  $('#valuationUpside').textContent = '—';
  $('#valuationEntry').textContent = '—';
  $('#valuationBreakdown').textContent = message;
  resetValuationRadar(radarMessage);
}

function resetPriceChart(message = 'Awaiting price data.') {
  $('#priceOverview').textContent = message;
  if (priceChart) {
    priceChart.destroy();
    priceChart = null;
  }
}

function setMetricBar(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (Number.isFinite(value)) {
    el.style.width = `${Math.max(0, Math.min(100, value))}%`;
    el.dataset.empty = 'false';
  } else {
    el.style.width = '0%';
    el.dataset.empty = 'true';
  }
}

function resetValuationRadar(message = 'Quant metrics awaiting Tiingo fundamentals.') {
  const centerScore = document.getElementById('valuationAiScore');
  if (centerScore) {
    centerScore.textContent = '—';
    delete centerScore.dataset.unit;
  }
  const inlineScore = document.getElementById('valuationAiScoreInline');
  if (inlineScore) inlineScore.textContent = '—';
  const peEl = document.getElementById('valuationPe');
  if (peEl) peEl.textContent = '—';
  const psEl = document.getElementById('valuationPs');
  if (psEl) psEl.textContent = '—';
  const upsideEl = document.getElementById('valuationUpsideMetric');
  if (upsideEl) upsideEl.textContent = '—';
  setMetricBar('valuationPeBar', null);
  setMetricBar('valuationPsBar', null);
  setMetricBar('valuationUpsideBar', null);
  setMetricBar('valuationScoreBar', null);
  const caption = document.getElementById('valuationRadarCaption');
  if (caption) caption.textContent = message;
  const container = document.getElementById('valuationRadar');
  if (container) container.classList.add('is-empty');
  if (valuationRadarChart) {
    valuationRadarChart.destroy();
    valuationRadarChart = null;
  }
}

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
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(context) {
                const label = context.label || '';
                const value = Number.isFinite(context.parsed.r) ? context.parsed.r.toFixed(0) : '0';
                return `${label}: ${value}`;
              },
            },
          },
        },
        scales: {
          r: {
            suggestedMin: 0,
            suggestedMax: 100,
            beginAtZero: true,
            ticks: {
              display: false,
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.08)',
            },
            angleLines: {
              color: 'rgba(255, 255, 255, 0.08)',
            },
            pointLabels: {
              color: 'rgba(255, 255, 255, 0.7)',
              font: {
                size: 11,
              },
            },
          },
        },
      },
    });
  } else {
    valuationRadarChart.data.datasets[0].data = datasetValues;
    valuationRadarChart.update();
  }
}

function renderValuationRadar({ price, upside, fundamentals }) {
  const { pe, ps, upside: upsideMetric, composite } = computeValuationScores({
    price,
    upside,
    fundamentals,
  });

  const peEl = document.getElementById('valuationPe');
  if (peEl) peEl.textContent = fmtMultiple(pe?.ratio);
  const psEl = document.getElementById('valuationPs');
  if (psEl) psEl.textContent = fmtMultiple(ps?.ratio);
  const upsideEl = document.getElementById('valuationUpsideMetric');
  if (upsideEl) upsideEl.textContent = Number.isFinite(upsideMetric?.percent)
    ? fmtPercent(upsideMetric.percent)
    : '—';

  const inlineScore = document.getElementById('valuationAiScoreInline');
  if (inlineScore) inlineScore.textContent = Number.isFinite(composite?.score)
    ? `${Math.round(composite.score)}%`
    : '—';

  const centerScore = document.getElementById('valuationAiScore');
  if (centerScore) {
    if (Number.isFinite(composite?.score)) {
      centerScore.textContent = Math.round(composite.score).toString();
      centerScore.dataset.unit = 'percent';
    } else {
      centerScore.textContent = '—';
      delete centerScore.dataset.unit;
    }
  }

  setMetricBar('valuationPeBar', pe?.score);
  setMetricBar('valuationPsBar', ps?.score);
  setMetricBar('valuationUpsideBar', upsideMetric?.score);
  setMetricBar('valuationScoreBar', composite?.score);

  const caption = document.getElementById('valuationRadarCaption');
  if (caption) {
    caption.textContent = composite?.availableCount
      ? 'Normalized valuation signals (0-100, higher indicates stronger relative value).'
      : 'Quant metrics awaiting Tiingo fundamentals.';
  }

  const container = document.getElementById('valuationRadar');
  if (container) container.classList.toggle('is-empty', !composite?.availableCount);

  updateRadarChart([pe?.score, ps?.score, upsideMetric?.score, composite?.score]);
}

async function fetchIntel({ symbol, limit, timeframe }) {
  const url = new URL('/.netlify/functions/ai-analyst', window.location.origin);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('limit', limit);
  url.searchParams.set('timeframe', timeframe);

  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    const contentType = (response.headers.get('content-type') || '').toLowerCase();

    if (!response.ok) {
      let payload = null;
      let text = '';
      if (contentType.includes('application/json')) {
        payload = await response.json().catch(() => null);
      } else {
        text = await response.text().catch(() => '');
      }

      const rawMessage = payload?.error || payload?.message || payload?.detail || text || response.statusText;
      const error = new Error(rawMessage || 'AI Analyst request failed.');
      error.status = response.status;
      if (payload) {
        error.response = payload;
        error.detail = payload?.detail || payload?.error || payload?.message || '';
      } else if (text) {
        error.responseText = text;
      }
      throw error;
    }

    const body = await response.json();
    return body;
  } catch (error) {
    throw enrichError(error, {
      context: 'ai-analyst',
      fallback: 'AI Analyst is currently unavailable. Please try again shortly.',
    });
  }
}

function updateValuationCard(valuationData = {}) {
  const { price, fairValue, upside, entry, breakdown, fundamentals } = extractValuationMetrics(valuationData);

  $('#valuationPrice').textContent = fmtCurrency(price);
  $('#valuationFair').textContent = fmtCurrency(fairValue);
  $('#valuationUpside').textContent = Number.isFinite(upside) ? fmtPercent(upside * 100) : '—';
  $('#valuationEntry').textContent = fmtCurrency(entry);

  const items = [
    ['Discounted cash flow', breakdown.discountedCashFlow],
    ['Earnings power', breakdown.earningsPower],
    ['Revenue multiple', breakdown.revenueMultiple],
    ['Book value', breakdown.bookValue],
  ].filter(([, value]) => Number.isFinite(Number(value)));

  $('#valuationBreakdown').textContent = items.length
    ? items.map(([label, value]) => `${label}: ${fmtCurrency(value)}`).join(' · ')
    : 'Awaiting valuation inputs from Tiingo fundamentals.';

  renderValuationRadar({ price, upside, fundamentals });
}

function renderTimeline(timeline = []) {
  const container = $('#timeline');
  container.innerHTML = '';
  const template = $('#timelineItemTemplate');
  timeline.slice(0, 20).forEach((event) => {
    const clone = template.content.cloneNode(true);
    clone.querySelector('.timeline-time').textContent = fmtDate(event.publishedAt);
    clone.querySelector('.timeline-title').textContent = event.headline || event.type;
    clone.querySelector('.timeline-body').textContent = event.summary || '';
    container.appendChild(clone);
  });
  if (!timeline.length) {
    container.innerHTML = '<li class="placeholder-item">No events available for the selected window.</li>';
  }
}

function renderDocuments(documents = []) {
  const container = $('#documents');
  container.innerHTML = '';
  const template = $('#documentItemTemplate');
  documents.slice(0, 12).forEach((doc) => {
    const clone = template.content.cloneNode(true);
    clone.querySelector('.document-title').textContent = doc.headline || doc.documentType || 'Document';
    clone.querySelector('.document-link').href = doc.url || '#';
    clone.querySelector('.document-meta').textContent = `${doc.documentType || 'Filing'} · ${fmtDate(doc.publishedAt)}`;
    container.appendChild(clone);
  });
  if (!documents.length) {
    container.innerHTML = '<li class="placeholder-item">No regulatory documents detected in the lookback window.</li>';
  }
}

function newsToneClass(sentiment) {
  if (Number.isFinite(Number(sentiment))) {
    if (sentiment > 0.2) return 'positive';
    if (sentiment < -0.2) return 'negative';
  }
  return 'neutral';
}

function renderNews(news = []) {
  const container = $('#newsList');
  container.innerHTML = '';
  const template = $('#newsItemTemplate');
  news.slice(0, 20).forEach((item) => {
    const clone = template.content.cloneNode(true);
    clone.querySelector('.news-source').textContent = item.source || 'Unknown';
    clone.querySelector('.news-date').textContent = fmtDate(item.publishedAt);
    const link = clone.querySelector('.news-headline');
    link.textContent = item.headline || 'View story';
    link.href = item.url || '#';
    clone.querySelector('.news-summary').textContent = item.summary || '';
    clone.querySelector('.news-item').classList.add(newsToneClass(item.sentiment));
    container.appendChild(clone);
  });
  if (!news.length) {
    container.innerHTML = '<li class="placeholder-item">No news flow captured for the chosen horizon.</li>';
  }
}

function renderChart(rows = []) {
  const ctx = $('#priceChart');
  if (!ctx) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    resetPriceChart('Price data unavailable from Tiingo.');
    return;
  }
  const parsed = rows
    .map((row) => ({
      label: row?.date ? new Date(row.date).toLocaleDateString() : '',
      value: Number(row?.close ?? row?.price ?? row?.last),
    }))
    .filter((point) => point.label && Number.isFinite(point.value));

  if (!parsed.length) {
    resetPriceChart('Price data unavailable from Tiingo.');
    return;
  }

  const labels = parsed.map((point) => point.label);
  const data = parsed.map((point) => point.value);
  const start = data[0];
  const end = data[data.length - 1];
  if (Number.isFinite(start) && Number.isFinite(end) && Math.abs(start) > 1e-6) {
    const change = ((end - start) / start) * 100;
    $('#priceOverview').textContent = `${fmtCurrency(start)} → ${fmtCurrency(end)} (${fmtPercent(change)})`;
  } else {
    $('#priceOverview').textContent = 'Price trend unavailable.';
  }

  if (priceChart) priceChart.destroy();
  priceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Close',
          data,
          tension: 0.2,
          borderColor: '#4ad7a8',
          backgroundColor: 'rgba(74, 215, 168, 0.18)',
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: {
          ticks: { color: '#a7b3c5' },
          grid: { color: 'rgba(255,255,255,0.06)' },
        },
        y: {
          ticks: { color: '#a7b3c5' },
          grid: { color: 'rgba(255,255,255,0.08)' },
        },
      },
    },
  });
}

function showPlaceholderList(selector, message, { element = 'li' } = {}) {
  const container = $(selector);
  if (!container) return;
  container.innerHTML = `<${element} class="placeholder-item">${message}</${element}>`;
}

function renderNarrative(text, placeholder = 'AI narrative unavailable. Please retry.') {
  const panel = $('#aiNarrativePanel');
  if (!panel) return;
  panel.innerHTML = '';
  const content = typeof text === 'string' ? text.trim() : '';
  if (!content) {
    const fallback = document.createElement('p');
    fallback.className = 'ai-summary placeholder';
    fallback.textContent = placeholder;
    panel.appendChild(fallback);
    return;
  }

  const paragraphs = content.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const blocks = paragraphs.length ? paragraphs : [content];
  blocks.forEach((block) => {
    const paragraph = document.createElement('p');
    paragraph.className = 'ai-summary';
    paragraph.textContent = block.replace(/\s+/g, ' ').trim();
    panel.appendChild(paragraph);
  });
}

function setStatus(message, tone = 'info') {
  const el = $('#statusMessage');
  if (!el) return;
  el.textContent = message || '';
  el.className = `status-message ${tone}`;
}

function setLoadingState(isLoading) {
  const runBtn = $('#runAnalysis');
  if (runBtn) {
    if (!runButtonDefaultHtml) {
      runButtonDefaultHtml = runBtn.innerHTML;
    }
    runBtn.disabled = isLoading;
    runBtn.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    runBtn.innerHTML = isLoading
      ? '<span class="spinner" aria-hidden="true"></span><span>Running…</span>'
      : runButtonDefaultHtml;
  }

  const exportBtn = $('#exportReport');
  if (exportBtn) {
    const disabled = isLoading || !lastAnalysis;
    exportBtn.disabled = disabled;
    exportBtn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  }

  const loadingStrip = $('#aiNarrativeLoading');
  if (loadingStrip) {
    loadingStrip.classList.toggle('active', isLoading);
  }

  const panel = $('#aiNarrativePanel');
  if (panel) {
    panel.classList.toggle('loading', isLoading);
  }

  if (document.body) {
    document.body.classList.toggle('is-loading', isLoading);
  }
}

function formatFundamentalSnapshot(fundamentals = {}) {
  const metrics = fundamentals?.metrics || {};
  const latest = fundamentals?.latest || {};
  const lines = [];

  const currencyLine = (label, value) => {
    if (!isFiniteNumber(value)) return null;
    return `- ${label}: ${fmtCurrency(value)}`;
  };

  const percentLine = (label, value) => {
    if (!isFiniteNumber(value)) return null;
    return `- ${label}: ${fmtPercent(Number(value) * 100)}`;
  };

  const metricFields = [
    ['Revenue per share', metrics.revenuePerShare],
    ['Earnings per share', metrics.earningsPerShare],
    ['Free cash flow per share', metrics.freeCashFlowPerShare],
    ['Book value per share', metrics.bookValuePerShare],
  ];

  metricFields.forEach(([label, value]) => {
    const line = currencyLine(label, value);
    if (line) lines.push(line);
  });

  const growthLines = [
    percentLine('Revenue growth', metrics.revenueGrowth),
    percentLine('EPS growth', metrics.epsGrowth),
    percentLine('FCF growth', metrics.fcfGrowth),
  ].filter(Boolean);
  lines.push(...growthLines);

  if (latest?.reportDate) {
    lines.push(`- Latest report date: ${fmtDate(latest.reportDate)}`);
  }

  return lines.length ? lines : ['- Fundamental metrics unavailable from Tiingo.'];
}

function formatTimelineForReport(timeline = []) {
  if (!Array.isArray(timeline) || !timeline.length) {
    return ['- No major corporate events captured.'];
  }
  return timeline.slice(0, 5).map((event) => {
    const date = fmtDate(event.publishedAt ?? event.date);
    const title = event.headline || event.type || 'Event';
    const summary = event.summary ? ` — ${event.summary}` : '';
    return `- ${date}: ${title}${summary}`;
  });
}

function formatNewsForReport(news = []) {
  if (!Array.isArray(news) || !news.length) {
    return ['- No notable news items recorded.'];
  }
  return news.slice(0, 5).map((item) => {
    const date = fmtDate(item.publishedAt);
    const source = item.source || 'Unknown source';
    const sentiment = isFiniteNumber(item.sentiment)
      ? fmtPercent(Number(item.sentiment) * 100)
      : 'n/a';
    const headline = item.headline || 'Headline unavailable';
    return `- ${date} · ${source}: ${headline} (Sentiment ${sentiment})`;
  });
}

function formatPriceForReport(rows = []) {
  if (!Array.isArray(rows) || !rows.length) {
    return 'Price history unavailable.';
  }
  const parsed = rows
    .map((row) => ({
      date: row?.date ? new Date(row.date) : null,
      value: Number(row?.close ?? row?.price ?? row?.last),
    }))
    .filter((point) => point.date && isFiniteNumber(point.value))
    .sort((a, b) => a.date - b.date);

  if (!parsed.length) {
    return 'Price history unavailable.';
  }

  const first = parsed[0];
  const last = parsed[parsed.length - 1];
  const change = Math.abs(first.value) > 1e-6 ? ((last.value - first.value) / first.value) * 100 : null;
  const startDate = first.date.toISOString().slice(0, 10);
  const endDate = last.date.toISOString().slice(0, 10);
  const changeText = Number.isFinite(change) ? fmtPercent(change) : '—';
  return `${fmtCurrency(first.value)} (${startDate}) → ${fmtCurrency(last.value)} (${endDate}) · Change ${changeText}`;
}

function buildReportContent(symbol, data, { limit, timeframe }) {
  const timestamp = (() => {
    const candidate = data?.generatedAt ? new Date(data.generatedAt) : new Date();
    return Number.isNaN(candidate.getTime()) ? new Date().toLocaleString() : candidate.toLocaleString();
  })();

  const { price, fairValue, upside, entry, fundamentals } = extractValuationMetrics(data?.valuation || {});
  const valuationLines = [
    `- Last price: ${fmtCurrency(price)}`,
    `- Fair value: ${fmtCurrency(fairValue)}`,
    `- Upside: ${Number.isFinite(upside) ? fmtPercent(upside * 100) : '—'}`,
    `- Suggested entry: ${fmtCurrency(entry)}`,
  ];

  const fundamentalsLines = formatFundamentalSnapshot(fundamentals);
  const timelineLines = formatTimelineForReport(data?.timeline);
  const newsLines = formatNewsForReport(data?.news);
  const priceLine = formatPriceForReport(data?.trend);
  const narrative = (data?.aiSummary || '').trim() || 'AI narrative unavailable.';

  return [
    `# AI Analyst Desk Report: ${symbol}`,
    '',
    `Generated: ${timestamp}`,
    `Lookback: ${limit} candles · Horizon ${timeframe}`,
    '',
    '## Narrative',
    narrative,
    '',
    '## Valuation Snapshot',
    ...valuationLines,
    '',
    '## Price Action',
    `- ${priceLine}`,
    '',
    '## Key Fundamentals',
    ...fundamentalsLines,
    '',
    '## Recent Corporate Events',
    ...timelineLines,
    '',
    '## News Highlights',
    ...newsLines,
    '',
    '---',
    '_Generated by the AI Analyst Desk using Tiingo market intelligence._',
    '',
  ].join('\n');
}

function downloadReport(symbol, data, context) {
  const content = buildReportContent(symbol, data, context);
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${symbol}-ai-analyst-report.md`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function runAnalysis() {
  const symbol = ($('#tickerInput').value || 'AAPL').trim().toUpperCase();
  const limit = Number($('#lookbackInput').value) || 120;
  const timeframe = $('#timeframeSelect').value || '3M';

  lastAnalysis = null;
  setLoadingState(true);
  setStatus('Running ChatGPT‑5 analysis…', 'info');
  renderNarrative('', 'Processing latest Tiingo data…');
  resetValuationCard('Crunching valuation components…', 'Calibrating valuation radar…');
  showPlaceholderList('#timeline', 'Assembling event timeline…');
  showPlaceholderList('#documents', 'Retrieving regulatory documents…');
  showPlaceholderList('#newsList', 'Streaming latest news and sentiment…');
  resetPriceChart('Loading price data…');
  $('#intelTimestamp').textContent = '';

  try {
    const { data, warning } = await fetchIntel({ symbol, limit, timeframe });
    if (!data) throw new Error('No intelligence returned');

    updateValuationCard(data.valuation);
    renderTimeline(data.timeline);
    renderDocuments(data.documents);
    renderNews(data.news);
    renderChart(data.trend || []);
    renderNarrative(data.aiSummary);
    $('#intelTimestamp').textContent = data.generatedAt ? `Generated ${fmtDate(data.generatedAt)}` : '';

    const message = warning ? `Completed with notice: ${warning}` : 'Analysis completed successfully.';
    const tone = warning ? 'info' : 'success';
    setStatus(message, tone);

    lastAnalysis = { symbol, limit, timeframe, data };
  } catch (error) {
    console.error(error);
    setStatus(error?.userMessage || error?.friendlyMessage || error?.message || 'Analysis failed. Please retry.', 'error');
    resetValuationCard();
    renderTimeline([]);
    renderDocuments([]);
    renderNews([]);
    resetPriceChart('Price history unavailable.');
    renderNarrative('', error?.userMessage || error?.friendlyMessage || 'Unable to produce AI narrative. Please retry.');
  } finally {
    setLoadingState(false);
  }
}

function init() {
  const runBtn = $('#runAnalysis');
  if (runBtn) {
    runBtn.addEventListener('click', () => {
      runAnalysis();
    });
  }

  const tickerInput = $('#tickerInput');
  if (tickerInput) {
    tickerInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        runAnalysis();
      }
    });
  }

  const exportBtn = $('#exportReport');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (!lastAnalysis) {
        setStatus('Run an analysis before downloading the report.', 'error');
        return;
      }
      downloadReport(lastAnalysis.symbol, lastAnalysis.data, {
        limit: lastAnalysis.limit,
        timeframe: lastAnalysis.timeframe,
      });
      setStatus('Report downloaded as Markdown snapshot.', 'success');
    });
  }

  runAnalysis().catch((error) => {
    console.error('Initial analysis failed', error);
    setStatus(error?.userMessage || error?.friendlyMessage || 'Initial analysis failed. Please retry.', 'error');
  });
}

document.addEventListener('DOMContentLoaded', init);
