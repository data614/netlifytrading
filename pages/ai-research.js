import {
  debounce,
  searchSymbols,
  renderSearchResults,
  loadSeries,
  loadFundamentals,
  runAiAnalyst,
  formatCurrency,
  formatPercent,
  formatNumber,
  scoreToLabel,
  momentumToLabel,
  safeArray,
  formatDate,
  clamp,
} from './ai-utils.js';

const dom = {
  searchInput: document.getElementById('researchSearch'),
  searchResults: document.getElementById('researchSearchResults'),
  exchangeSelect: document.getElementById('researchExchange'),
  symbolLabel: document.getElementById('researchSymbolLabel'),
  chartStatus: document.getElementById('researchChartStatus'),
  timeframes: document.getElementById('researchTimeframes'),
  chartCanvas: document.getElementById('researchChart'),
  snapshotTimestamp: document.getElementById('researchSnapshotTimestamp'),
  lastPrice: document.getElementById('researchLastPrice'),
  lastChange: document.getElementById('researchLastChange'),
  fairValue: document.getElementById('researchFairValue'),
  valuationSignal: document.getElementById('researchValuationSignal'),
  qualityScore: document.getElementById('researchQualityScore'),
  qualityLabel: document.getElementById('researchQualityLabel'),
  momentumScore: document.getElementById('researchMomentum'),
  momentumLabel: document.getElementById('researchMomentumLabel'),
  keyMetrics: document.getElementById('researchKeyMetrics'),
  eventsStatus: document.getElementById('researchEventsStatus'),
  eventsList: document.getElementById('researchEventsList'),
  documentsStatus: document.getElementById('researchDocumentsStatus'),
  documentsList: document.getElementById('researchDocumentsList'),
  fundamentalsStatus: document.getElementById('researchFundamentalsStatus'),
  fundamentalsTable: document.querySelector('#researchFundamentalsTable tbody'),
  aiStatus: document.getElementById('researchAiStatus'),
  aiOutput: document.getElementById('researchAiOutput'),
  aiRefresh: document.getElementById('researchAiRefresh'),
};

const state = {
  symbol: 'AAPL',
  exchange: '',
  fundamentals: null,
  aiPayload: null,
  chart: null,
  chartConfig: { kind: 'intraday', interval: '5min', limit: 78 },
};

const buildChart = () => {
  if (state.chart) return state.chart;
  state.chart = new Chart(dom.chartCanvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Price',
          data: [],
          borderColor: '#4f9dff',
          backgroundColor: 'rgba(79,157,255,0.15)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: (ctx) => `${formatCurrency(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: '#9aa4c6',
            maxTicksLimit: 6,
          },
          grid: { display: false },
        },
        y: {
          ticks: {
            color: '#9aa4c6',
            callback: (value) => formatCurrency(value),
          },
          grid: { color: 'rgba(79,157,255,0.08)' },
        },
      },
    },
  });
  return state.chart;
};

function formatSeriesTimestamp(ts, useDateOnly = false) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  if (useDateOnly) return d.toLocaleDateString();
  return d.toLocaleString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
}

async function refreshSeries() {
  dom.chartStatus.textContent = 'Loading price history…';
  const { kind, interval, limit } = state.chartConfig;
  try {
    const result = await loadSeries(state.symbol, {
      kind,
      interval,
      limit,
      exchange: state.exchange,
    });
    const points = safeArray(result?.data).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    const useDateOnly = kind === 'eod';
    const chart = buildChart();
    chart.data.labels = points.map((row) => formatSeriesTimestamp(row.date, useDateOnly));
    chart.data.datasets[0].data = points.map((row) => Number(row.close ?? row.price ?? row.last) || null);
    chart.update('none');
    const warning = result?.warning;
    dom.chartStatus.textContent = warning || '';
    if (!points.length) {
      dom.chartStatus.textContent = warning || 'No series data returned.';
    }
  } catch (error) {
    console.error('Failed to load series', error);
    dom.chartStatus.textContent = 'Price history unavailable. Check Tiingo connectivity.';
  }
}

function renderKeyMetrics(items = []) {
  dom.keyMetrics.innerHTML = '';
  if (!items.length) return;
  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const pill = document.createElement('span');
    pill.className = 'ai-pill';
    pill.textContent = `${item.label}: ${item.value}`;
    fragment.appendChild(pill);
  });
  dom.keyMetrics.appendChild(fragment);
}

function updateSnapshot(data) {
  if (!data) {
    dom.lastPrice.textContent = '—';
    dom.lastChange.textContent = '—';
    dom.fairValue.textContent = '—';
    dom.valuationSignal.textContent = '—';
    dom.qualityScore.textContent = '—';
    dom.qualityLabel.textContent = '—';
    dom.momentumScore.textContent = '—';
    dom.momentumLabel.textContent = '—';
    dom.keyMetrics.innerHTML = '';
    dom.snapshotTimestamp.textContent = '';
    dom.symbolLabel.textContent = '';
    return;
  }
  const currency = data.currency || 'USD';
  dom.symbolLabel.textContent = `${data.symbol}${data.exchange ? ` · ${data.exchange}` : ''}`;
  dom.snapshotTimestamp.textContent = data.timestamp ? `Updated ${formatDate(data.timestamp)}` : '';
  dom.lastPrice.textContent = formatCurrency(data.price, currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const delta = data.priceChange || {};
  dom.lastChange.textContent = `${formatCurrency(delta.absolute ?? 0, currency, { maximumFractionDigits: 2 })} (${formatPercent(delta.percent ?? 0, 2)})`;
  dom.lastChange.className = `ai-status ${delta.percent > 0 ? 'ok' : delta.percent < 0 ? 'error' : ''}`;
  const valuation = data.valuations || {};
  dom.fairValue.textContent = valuation.fairValue ? formatCurrency(valuation.fairValue, currency) : '—';
  dom.valuationSignal.textContent = valuation.signalLabel || '—';
  dom.valuationSignal.className = `ai-status ${valuation.signalClass || ''}`.trim();
  dom.qualityScore.textContent = data.qualityScore != null ? formatNumber(data.qualityScore, { maximumFractionDigits: 1 }) : '—';
  dom.qualityLabel.textContent = scoreToLabel(data.qualityScore);
  dom.qualityLabel.className = 'ai-status';
  dom.momentumScore.textContent = data.momentumScore != null ? formatNumber(data.momentumScore, { maximumFractionDigits: 1 }) : '—';
  dom.momentumLabel.textContent = momentumToLabel(data.momentumScore);
  dom.momentumLabel.className = 'ai-status';
  renderKeyMetrics(data.keyMetrics || []);
}

function renderEvents(list = []) {
  dom.eventsList.innerHTML = '';
  if (!list.length) {
    dom.eventsStatus.textContent = 'No upcoming events on file.';
    return;
  }
  dom.eventsStatus.textContent = `${list.length} events tracked`;
  const fragment = document.createDocumentFragment();
  list.forEach((event) => {
    const li = document.createElement('li');
    li.className = 'ai-list-item';
    const headline = document.createElement('strong');
    headline.textContent = event.headline || event.type || 'Event';
    const meta = document.createElement('div');
    meta.className = 'ai-muted';
    const importance = event.importance ? ` · ${event.importance}` : '';
    meta.textContent = `${formatDate(event.date)} · ${event.type || 'Event'}${importance}`;
    const detail = document.createElement('div');
    detail.textContent = event.summary || '';
    li.append(headline, meta);
    if (event.url) {
      const link = document.createElement('a');
      link.href = event.url;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.textContent = 'Open source';
      li.appendChild(link);
    }
    if (event.summary) li.appendChild(detail);
    fragment.appendChild(li);
  });
  dom.eventsList.appendChild(fragment);
}

function renderDocuments(list = []) {
  dom.documentsList.innerHTML = '';
  if (!list.length) {
    dom.documentsStatus.textContent = 'Filings cache empty.';
    return;
  }
  dom.documentsStatus.textContent = `${list.length} artefacts ready`;
  const fragment = document.createDocumentFragment();
  list.forEach((doc) => {
    const li = document.createElement('li');
    li.className = 'ai-list-item';
    const title = document.createElement('strong');
    title.textContent = doc.title || `${doc.type || 'Document'} (${formatDate(doc.date)})`;
    const meta = document.createElement('div');
    meta.className = 'ai-muted';
    meta.textContent = `${formatDate(doc.date)}${doc.type ? ` · ${doc.type}` : ''}`;
    li.append(title, meta);
    if (doc.summary) {
      const summary = document.createElement('div');
      summary.textContent = doc.summary;
      li.appendChild(summary);
    }
    if (doc.url) {
      const link = document.createElement('a');
      link.href = doc.url;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.textContent = 'Open document';
      li.appendChild(link);
    }
    fragment.appendChild(li);
  });
  dom.documentsList.appendChild(fragment);
}

function renderFundamentalsTable(rows = []) {
  dom.fundamentalsTable.innerHTML = '';
  if (!rows.length) {
    dom.fundamentalsStatus.textContent = 'No historical metrics';
    return;
  }
  dom.fundamentalsStatus.textContent = '';
  const fragment = document.createDocumentFragment();
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const cells = [
      row.period || '—',
      formatPercent(row.revenueGrowth ?? 0, 1),
      row.eps != null ? formatNumber(row.eps, { maximumFractionDigits: 2 }) : '—',
      formatPercent(row.margin ?? 0, 1),
      row.leverage != null ? formatNumber(row.leverage, { maximumFractionDigits: 2 }) : '—',
    ];
    cells.forEach((value) => {
      const td = document.createElement('td');
      td.textContent = value;
      tr.appendChild(td);
    });
    fragment.appendChild(tr);
  });
  dom.fundamentalsTable.appendChild(fragment);
}

async function refreshAi(force = false) {
  if (!state.aiPayload) return;
  dom.aiStatus.textContent = 'Requesting ChatGPT 5 insight…';
  dom.aiStatus.className = 'ai-status';
  try {
    const payload = force ? { ...state.aiPayload, force } : state.aiPayload;
    const response = await runAiAnalyst(payload);
    dom.aiOutput.textContent = response?.content || 'AI analyst returned no content.';
    dom.aiStatus.textContent = response?.warning ? `⚠️ ${response.warning}` : response?.model ? `Model: ${response.model}` : 'ChatGPT 5 insight ready';
    if (response?.warning) dom.aiStatus.className = 'ai-status error';
  } catch (error) {
    dom.aiOutput.textContent = 'Unable to reach the AI analyst. Configure OPENAI_API_KEY in your environment.';
    dom.aiStatus.textContent = 'AI offline';
    dom.aiStatus.className = 'ai-status error';
  }
}

async function refreshFundamentals() {
  dom.eventsStatus.textContent = 'Loading…';
  dom.documentsStatus.textContent = 'Loading…';
  dom.fundamentalsStatus.textContent = 'Loading…';
  try {
    const response = await loadFundamentals([state.symbol], { exchange: state.exchange });
    const record = safeArray(response?.data)[0];
    state.fundamentals = record || null;
    if (!record) {
      dom.eventsStatus.textContent = 'No data available.';
      dom.documentsStatus.textContent = 'No data available.';
      dom.fundamentalsStatus.textContent = 'No data available.';
      updateSnapshot(null);
      return;
    }
    updateSnapshot(record);
    renderEvents(record.events || []);
    renderDocuments(record.documents || []);
    renderFundamentalsTable(record.history || []);
    state.aiPayload = {
      mode: 'single-equity',
      symbol: record.symbol,
      name: record.name,
      currency: record.currency,
      price: record.price,
      valuations: record.valuations,
      qualityScore: record.qualityScore,
      momentumScore: record.momentumScore,
      events: record.events,
      documents: record.documents,
      metrics: record.metrics,
      narrative: record.narrative,
    };
    await refreshAi();
  } catch (error) {
    console.error('Fundamentals fetch failed', error);
    dom.eventsStatus.textContent = 'Unable to load events.';
    dom.documentsStatus.textContent = 'Unable to load documents.';
    dom.fundamentalsStatus.textContent = 'Unable to load fundamentals.';
  }
}

const handleSearch = debounce(async () => {
  const query = dom.searchInput.value;
  const exchange = dom.exchangeSelect.value;
  if (!query) {
    dom.searchResults.innerHTML = '';
    return;
  }
  dom.searchResults.innerHTML = '<div class="ai-status">Searching…</div>';
  const matches = await searchSymbols(query, { exchange, limit: 25 });
  renderSearchResults(dom.searchResults, matches, (item) => {
    dom.searchResults.innerHTML = '';
    selectSymbol(item.symbol, item.mic || exchange, item.name);
  });
}, 260);

function selectSymbol(symbol, exchange = '', name = '') {
  state.symbol = (symbol || 'AAPL').toUpperCase();
  state.exchange = exchange || '';
  state.chartConfig = { kind: 'intraday', interval: '5min', limit: 78 };
  dom.aiOutput.textContent = 'Refreshing…';
  dom.aiStatus.textContent = 'Preparing insight';
  dom.aiStatus.className = 'ai-status';
  dom.symbolLabel.textContent = `${state.symbol}${exchange ? ` · ${exchange}` : ''}`;
  if (name) dom.symbolLabel.textContent += ` — ${name}`;
  dom.searchInput.value = state.symbol;
  dom.timeframes.querySelectorAll('button').forEach((btn, idx) => {
    btn.classList.toggle('active', idx === 0);
  });
  refreshFundamentals();
  refreshSeries();
}

dom.searchInput.addEventListener('input', handleSearch);
dom.exchangeSelect.addEventListener('change', () => {
  if (dom.searchInput.value) handleSearch();
});
dom.aiRefresh.addEventListener('click', () => refreshAi(true));

dom.timeframes.querySelectorAll('button').forEach((button) => {
  button.addEventListener('click', (event) => {
    dom.timeframes.querySelectorAll('button').forEach((btn) => btn.classList.remove('active'));
    button.classList.add('active');
    const { kind, interval, limit } = event.currentTarget.dataset;
    state.chartConfig = {
      kind: kind || 'intraday',
      interval: interval || '5min',
      limit: clamp(Number(limit) || 78, 10, 1500),
    };
    refreshSeries();
  });
});

selectSymbol(state.symbol);
