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

let priceChart;

async function fetchIntel({ symbol, limit, timeframe }) {
  const url = new URL('/api/aiAnalyst', window.location.origin);
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
  const valuation = valuationData?.valuation || valuationData;
  const fairValue = valuation?.valuation?.fairValue ?? valuation?.fairValue;
  const price = valuation?.price ?? valuation?.valuation?.price ?? valuation?.quote?.price;
  const upside = valuation?.valuation?.upside ?? (price && fairValue ? (fairValue - price) / price : null);
  const entry = valuation?.valuation?.suggestedEntry ?? valuation?.suggestedEntry;

  $('#valuationPrice').textContent = fmtCurrency(price);
  $('#valuationFair').textContent = fmtCurrency(fairValue);
  $('#valuationUpside').textContent = Number.isFinite(upside) ? fmtPercent(upside * 100) : '—';
  $('#valuationEntry').textContent = fmtCurrency(entry);

  const breakdown = valuation?.valuation?.components || valuation?.components || {};
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
    container.innerHTML = '<li class="timeline-item"><div>No events available.</div></li>';
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
    container.innerHTML = '<li class="document-item">No regulatory documents detected in the lookback window.</li>';
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
    container.innerHTML = '<li class="news-item">No news flow captured for the chosen horizon.</li>';
  }
}

function renderChart(rows = []) {
  const ctx = $('#priceChart');
  if (!ctx) return;
  const labels = rows.map((row) => new Date(row.date).toLocaleDateString());
  const data = rows.map((row) => Number(row.close ?? row.price));
  const start = data[0];
  const end = data[data.length - 1];
  if (Number.isFinite(start) && Number.isFinite(end)) {
    const change = ((end - start) / start) * 100;
    $('#priceOverview').textContent = `${fmtCurrency(start)} → ${fmtCurrency(end)} (${fmtPercent(change)})`;
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

function setStatus(message, tone = 'info') {
  const el = $('#statusMessage');
  if (!el) return;
  el.textContent = message || '';
  el.className = `status-message ${tone}`;
}

function downloadReport(symbol, data) {
  const payload = JSON.stringify({ symbol, generatedAt: new Date().toISOString(), ...data }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${symbol}-ai-analyst.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function runAnalysis() {
  const symbol = ($('#tickerInput').value || 'AAPL').trim().toUpperCase();
  const limit = Number($('#lookbackInput').value) || 120;
  const timeframe = $('#timeframeSelect').value || '3M';
  setStatus('Running ChatGPT‑5 analysis…', 'info');
  $('#aiNarrative').textContent = 'Processing latest Tiingo data…';
  try {
    const { data, warning } = await fetchIntel({ symbol, limit, timeframe });
    if (!data) throw new Error('No intelligence returned');
    updateValuationCard(data.valuation);
    renderTimeline(data.timeline);
    renderDocuments(data.documents);
    renderNews(data.news);
    renderChart(data.trend || []);
    $('#aiNarrative').textContent = data.aiSummary || 'AI summary unavailable.';
    $('#intelTimestamp').textContent = data.generatedAt ? `Generated ${fmtDate(data.generatedAt)}` : '';
    setStatus(warning ? `Completed with notice: ${warning}` : 'Analysis completed successfully.');
    $('#exportReport').onclick = () => downloadReport(symbol, data);
  } catch (error) {
    console.error(error);
    setStatus(`Analysis failed: ${error.message}`, 'error');
    $('#aiNarrative').textContent = 'Unable to produce AI narrative. Please retry.';
  }
}

function init() {
  $('#runAnalysis').addEventListener('click', () => {
    runAnalysis();
  });

  $('#tickerInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      runAnalysis();
    }
  });

  runAnalysis().catch((error) => {
    console.error('Initial analysis failed', error);
  });
}

document.addEventListener('DOMContentLoaded', init);
