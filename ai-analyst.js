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

const fmtMultiple = (value, digits = 1) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num.toFixed(digits)}×`;
};

const fmtRatio = (value, digits = 2) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toFixed(digits);
};

const fmtDate = (iso) => {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const isFiniteNumber = (value) =>
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);

const scorePositive = (value, floor, ceiling) => {
  const num = Number(value);
  if (!Number.isFinite(num) || ceiling === floor) return null;
  const normalized = (num - floor) / (ceiling - floor);
  return clamp(normalized);
};

const scoreInverse = (value, floor, ceiling) => {
  const num = Number(value);
  if (!Number.isFinite(num) || ceiling === floor) return null;
  const normalized = 1 - (num - floor) / (ceiling - floor);
  return clamp(normalized);
};

const describeScore = (score) => {
  if (!Number.isFinite(score)) {
    return { label: 'Pending', tone: 'caution' };
  }
  if (score >= 80) return { label: 'Strong', tone: 'positive' };
  if (score >= 60) return { label: 'Constructive', tone: 'positive' };
  if (score >= 40) return { label: 'Balanced', tone: 'caution' };
  if (score >= 20) return { label: 'Stretched', tone: 'negative' };
  return { label: 'At risk', tone: 'negative' };
};

let priceChart;
let valuationRadarChart;
let lastAnalysis = null;
let runButtonDefaultHtml = '';

function extractValuationMetrics(valuationData = {}) {
  const valuation = valuationData?.valuation || valuationData;
  const price = valuation?.price ?? valuationData?.price ?? valuationData?.quote?.price;
  const fairValue = valuation?.fairValue ?? valuation?.valuation?.fairValue ?? null;
  const upside = price && fairValue ? (fairValue - price) / price : null;
  const entry = valuation?.suggestedEntry ?? valuation?.valuation?.suggestedEntry ?? valuationData?.suggestedEntry;
  const breakdown = valuation?.valuation?.components || valuation?.components || {};
  const fundamentals = valuationData?.fundamentals || valuation?.fundamentals || null;
  const marginOfSafety = valuation?.marginOfSafety ?? valuation?.valuation?.marginOfSafety ?? null;
  const growth = valuation?.growth ?? valuation?.valuation?.growth ?? {};
  const scenarios = valuation?.scenarios ?? valuation?.valuation?.scenarios ?? {};

  return { price, fairValue, upside, entry, breakdown, fundamentals, marginOfSafety, growth, scenarios };
}

function resetValuationCard(
  message = 'Awaiting valuation inputs from Tiingo fundamentals.',
  radarMessage,
) {
  $('#valuationPrice').textContent = '—';
  $('#valuationFair').textContent = '—';
  $('#valuationUpside').textContent = '—';
  $('#valuationEntry').textContent = '—';
  $('#valuationBreakdown').textContent = message;
  resetValuationRadar(radarMessage || message);
}

function resetPriceChart(message = 'Awaiting price data.') {
  $('#priceOverview').textContent = message;
  if (priceChart) {
    priceChart.destroy();
    priceChart = null;
  }
}

async function fetchIntel({ symbol, limit, timeframe }) {
  const url = new URL('/.netlify/functions/ai-analyst', window.location.origin);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('limit', limit);
  url.searchParams.set('timeframe', timeframe);
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json();
}

function updateValuationCard(valuationData = {}) {
  const { price, fairValue, upside, entry, breakdown } = extractValuationMetrics(valuationData);

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

function resetValuationRadar(message = 'Awaiting valuation radar intelligence.') {
  const placeholder = $('#valuationRadarEmpty');
  if (placeholder) {
    placeholder.textContent = message;
    placeholder.classList.remove('hidden');
  }
  const legend = $('#valuationRadarLegend');
  if (legend) {
    legend.innerHTML = '';
  }
  const canvas = $('#valuationRadarChart');
  if (canvas) {
    canvas.style.display = 'none';
  }
  if (valuationRadarChart) {
    valuationRadarChart.destroy();
    valuationRadarChart = null;
  }
}

function computeValuationRadarMetrics(analysis = {}) {
  const valuationData = analysis?.valuation || analysis;
  const quantMetrics = analysis?.quant
    || analysis?.quantMetrics
    || valuationData?.quant
    || analysis?.tiingo?.data?.quant
    || analysis?.tiingo?.data?.quantMetrics
    || {};

  const { upside, marginOfSafety, growth } = extractValuationMetrics(valuationData || {});

  const baseGrowth = isFiniteNumber(growth?.base) ? Number(growth.base) : null;
  const margin = isFiniteNumber(marginOfSafety) ? Number(marginOfSafety) : null;
  const upsideValue = isFiniteNumber(upside) ? Number(upside) : null;

  const pe = isFiniteNumber(quantMetrics.priceToEarnings) ? Number(quantMetrics.priceToEarnings) : null;
  const ps = isFiniteNumber(quantMetrics.priceToSales) ? Number(quantMetrics.priceToSales) : null;
  const fcfYield = isFiniteNumber(quantMetrics.freeCashFlowYield)
    ? Number(quantMetrics.freeCashFlowYield)
    : null;
  const debtToEquity = isFiniteNumber(quantMetrics.debtToEquity)
    ? Number(quantMetrics.debtToEquity)
    : null;
  const netDebtToEBITDA = isFiniteNumber(quantMetrics.netDebtToEBITDA)
    ? Number(quantMetrics.netDebtToEBITDA)
    : null;
  const roe = isFiniteNumber(quantMetrics.returnOnEquity)
    ? Number(quantMetrics.returnOnEquity)
    : null;

  const leverageScores = [];
  if (debtToEquity !== null) leverageScores.push(scoreInverse(debtToEquity, 0.4, 2.5));
  if (netDebtToEBITDA !== null) leverageScores.push(scoreInverse(netDebtToEBITDA, 0.5, 4));
  const validLeverageScores = leverageScores.filter((value) => Number.isFinite(value));
  const leverageScore = validLeverageScores.length
    ? validLeverageScores.reduce((sum, value) => sum + value, 0) / validLeverageScores.length
    : null;

  const metrics = [
    {
      id: 'upside',
      label: 'Upside potential',
      valueText: upsideValue !== null ? fmtPercent(upsideValue * 100) : '—',
      detail: 'Fair value premium to market price.',
      score: upsideValue !== null ? scorePositive(upsideValue, -0.2, 0.5) : null,
    },
    {
      id: 'safety',
      label: 'Margin of safety',
      valueText: margin !== null ? fmtPercent(margin * 100) : '—',
      detail: 'Discount buffer embedded in Tiingo valuation.',
      score: margin !== null ? scorePositive(margin, 0, 0.35) : null,
    },
    {
      id: 'growth',
      label: 'Base growth outlook',
      valueText: baseGrowth !== null ? fmtPercent(baseGrowth * 100) : '—',
      detail: 'Mid-case growth implied by valuation model.',
      score: baseGrowth !== null ? scorePositive(baseGrowth, -0.05, 0.15) : null,
    },
    {
      id: 'pe',
      label: 'P/E advantage',
      valueText: pe !== null ? fmtMultiple(pe) : '—',
      detail: 'Earnings multiple relative to price.',
      score: pe !== null ? scoreInverse(pe, 10, 40) : null,
    },
    {
      id: 'ps',
      label: 'P/S discipline',
      valueText: ps !== null ? fmtMultiple(ps) : '—',
      detail: 'Revenue multiple competitiveness.',
      score: ps !== null ? scoreInverse(ps, 1.5, 10) : null,
    },
    {
      id: 'fcf',
      label: 'Free cash flow yield',
      valueText: fcfYield !== null ? fmtPercent(fcfYield * 100) : '—',
      detail: 'Cash generation relative to equity value.',
      score: fcfYield !== null ? scorePositive(fcfYield, -0.02, 0.12) : null,
    },
    {
      id: 'leverage',
      label: 'Balance sheet strength',
      valueText: [
        debtToEquity !== null ? `D/E ${fmtRatio(debtToEquity, 2)}` : null,
        netDebtToEBITDA !== null ? `Net Debt/EBITDA ${fmtRatio(netDebtToEBITDA, 2)}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
        || '—',
      detail: 'Lower leverage supports durability.',
      score: leverageScore !== null ? clamp(leverageScore) : null,
    },
    {
      id: 'roe',
      label: 'Return on equity',
      valueText: roe !== null ? fmtPercent(roe * 100) : '—',
      detail: 'Profitability of shareholder capital.',
      score: roe !== null ? scorePositive(roe, 0.05, 0.3) : null,
    },
  ];

  return metrics.map((metric) => {
    const normalized = Number.isFinite(metric.score) ? clamp(metric.score) : null;
    const percentScore = Number.isFinite(normalized) ? Math.round(normalized * 100) : null;
    const { label, tone } = describeScore(percentScore);
    return {
      ...metric,
      normalized,
      score: percentScore,
      band: label,
      tone,
    };
  });
}

function metricScoreClass(tone) {
  if (tone === 'positive') return 'positive';
  if (tone === 'negative') return 'negative';
  return 'caution';
}

function metricContainerClass(metric) {
  const classes = ['radar-metric'];
  if (!Number.isFinite(metric.score)) {
    classes.push('is-missing');
  } else if (metric.score >= 80) {
    classes.push('is-strong');
  } else if (metric.score <= 30) {
    classes.push('is-weak');
  }
  return classes.join(' ');
}

function renderValuationRadarLegend(metrics = []) {
  const legend = $('#valuationRadarLegend');
  if (!legend) return;
  if (!metrics.length) {
    legend.innerHTML = '';
    return;
  }
  const markup = metrics
    .map((metric) => {
      const scoreText = Number.isFinite(metric.score)
        ? `${metric.score} · ${metric.band}`
        : 'Pending data';
      const scoreClass = `radar-metric-score ${metricScoreClass(metric.tone)}`;
      const barWidth = Number.isFinite(metric.score) ? metric.score : 0;
      const detailText = metric.detail ? `<div class="radar-metric-meta secondary">${metric.detail}</div>` : '';
      return `
        <li class="${metricContainerClass(metric)}">
          <div class="radar-metric-header">
            <span class="radar-metric-label">${metric.label}</span>
            <span class="${scoreClass}">${scoreText}</span>
          </div>
          <div class="radar-metric-meta">${metric.valueText}</div>
          ${detailText}
          <div class="radar-metric-bar"><span style="width:${barWidth}%"></span></div>
        </li>
      `;
    })
    .join('');
  legend.innerHTML = markup;
}

function renderValuationRadar(analysis = {}) {
  const canvas = $('#valuationRadarChart');
  const placeholder = $('#valuationRadarEmpty');
  if (!canvas || !placeholder) return;

  const metrics = computeValuationRadarMetrics(analysis);
  renderValuationRadarLegend(metrics);

  const availableMetrics = metrics.filter((metric) => Number.isFinite(metric.score));

  if (valuationRadarChart) {
    valuationRadarChart.destroy();
    valuationRadarChart = null;
  }

  if (availableMetrics.length < 3) {
    canvas.style.display = 'none';
    placeholder.textContent = 'Valuation radar requires at least three quantitative signals.';
    placeholder.classList.remove('hidden');
    return;
  }

  placeholder.classList.add('hidden');
  canvas.style.display = 'block';

  valuationRadarChart = new Chart(canvas, {
    type: 'radar',
    data: {
      labels: availableMetrics.map((metric) => metric.label),
      datasets: [
        {
          label: 'Valuation posture',
          data: availableMetrics.map((metric) => metric.score),
          borderColor: '#4ad7a8',
          backgroundColor: 'rgba(74, 215, 168, 0.24)',
          pointBackgroundColor: '#5cf0bd',
          pointHoverBackgroundColor: '#0b1725',
          pointBorderColor: '#0b1725',
          borderWidth: 2,
          pointRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          beginAtZero: true,
          suggestedMax: 100,
          angleLines: { color: 'rgba(255,255,255,0.08)' },
          grid: { color: 'rgba(255,255,255,0.08)' },
          pointLabels: {
            color: '#a7b3c5',
            font: { size: 11 },
          },
          ticks: {
            display: false,
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => {
              const metric = availableMetrics[context.dataIndex];
              return metric ? `${metric.label}: ${context.formattedValue} (${metric.band})` : context.formattedValue;
            },
          },
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
  resetValuationCard('Crunching valuation components…', 'Scoring valuation pillars…');
  showPlaceholderList('#timeline', 'Assembling event timeline…');
  showPlaceholderList('#documents', 'Retrieving regulatory documents…');
  showPlaceholderList('#newsList', 'Streaming latest news and sentiment…');
  resetPriceChart('Loading price data…');
  $('#intelTimestamp').textContent = '';

  try {
    const { data, warning } = await fetchIntel({ symbol, limit, timeframe });
    if (!data) throw new Error('No intelligence returned');

    updateValuationCard(data.valuation);
    renderValuationRadar(data);
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
    setStatus(`Analysis failed: ${error.message}`, 'error');
    resetValuationCard();
    renderTimeline([]);
    renderDocuments([]);
    renderNews([]);
    resetPriceChart('Price history unavailable.');
    renderNarrative('', 'Unable to produce AI narrative. Please retry.');
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
    setStatus('Initial analysis failed. Please retry.', 'error');
  });
}

document.addEventListener('DOMContentLoaded', init);
