import {
  analyseSeries,
  formatNumber,
  formatPercent,
} from './shared/quant.js';

const DEFAULT_SYMBOL = 'AAPL';
const DEFAULT_CURRENCY = 'USD';

const TIMEFRAME_CONFIG = {
  '1D': { kind: 'intraday', interval: '5min', limit: 78, periodsPerYear: 252 * 78, label: '1 day' },
  '5D': { kind: 'intraday', interval: '30min', limit: 65, periodsPerYear: 252 * 13, label: '5 days' },
  '1M': { kind: 'eod', limit: 30, periodsPerYear: 252, label: '1 month' },
  '3M': { kind: 'eod', limit: 65, periodsPerYear: 252, label: '3 months' },
  '6M': { kind: 'eod', limit: 130, periodsPerYear: 252, label: '6 months' },
  '1Y': { kind: 'eod', limit: 260, periodsPerYear: 252, label: '1 year' },
  '5Y': { kind: 'eod', limit: 1300, periodsPerYear: 252, label: '5 years' },
};

const dom = {
  heroSymbol: document.getElementById('heroSymbol'),
  heroPrice: document.getElementById('heroPrice'),
  heroChange: document.getElementById('heroChange'),
  heroFairValue: document.getElementById('heroFairValue'),
  heroUpside: document.getElementById('heroUpside'),
  heroConfidence: document.getElementById('heroConfidence'),
  heroConfidenceDetail: document.getElementById('heroConfidenceDetail'),
  timeframeSwitcher: document.getElementById('timeframeSwitcher'),
  chartCanvas: document.getElementById('deskChart'),
  chartStatus: document.getElementById('chartStatus'),
  metricVolatility: document.getElementById('metricVolatility'),
  metricVolatilityDetail: document.getElementById('metricVolatilityDetail'),
  metricSharpe: document.getElementById('metricSharpe'),
  metricSharpeDetail: document.getElementById('metricSharpeDetail'),
  metricDrawdown: document.getElementById('metricDrawdown'),
  metricDrawdownDetail: document.getElementById('metricDrawdownDetail'),
  metricLiquidity: document.getElementById('metricLiquidity'),
  metricLiquidityDetail: document.getElementById('metricLiquidityDetail'),
  metricMomentum: document.getElementById('metricMomentum'),
  metricMomentumDetail: document.getElementById('metricMomentumDetail'),
  metricRisk: document.getElementById('metricRisk'),
  metricRiskDetail: document.getElementById('metricRiskDetail'),
  symbolForm: document.getElementById('symbolForm'),
  symbolInput: document.getElementById('symbolInput'),
  aiForm: document.getElementById('aiScreenerForm'),
  aiStatus: document.getElementById('aiScreenerStatus'),
  aiOutput: document.getElementById('aiScreenerOutput'),
  aiModel: document.getElementById('aiScreenerModel'),
  aiTickers: document.getElementById('aiTickers'),
  aiFocus: document.getElementById('aiFocus'),
  aiRisk: document.getElementById('aiRisk'),
  aiHorizon: document.getElementById('aiHorizon'),
  aiNotes: document.getElementById('aiNotes'),
  eventStream: document.getElementById('eventStream'),
  eventStatus: document.getElementById('eventStatus'),
  eventTemplate: document.getElementById('eventTemplate'),
  refreshEvents: document.getElementById('refreshEvents'),
  documentForm: document.getElementById('documentForm'),
  documentUrl: document.getElementById('docUrl'),
  documentText: document.getElementById('docText'),
  documentStatus: document.getElementById('documentStatus'),
  documentAnalysis: document.getElementById('documentAnalysis'),
  documentModel: document.getElementById('documentModel'),
  fetchDocumentBtn: document.getElementById('fetchDocument'),
  analyzeDocumentBtn: document.getElementById('analyzeDocument'),
  valuationFairValue: document.getElementById('valuationFairValue'),
  valuationUpside: document.getElementById('valuationUpside'),
  valuationDcfRange: document.getElementById('valuationDcfRange'),
  valuationDcfNotes: document.getElementById('valuationDcfNotes'),
  valuationMultiples: document.getElementById('valuationMultiples'),
  valuationMultiplesNotes: document.getElementById('valuationMultiplesNotes'),
  valuationQuality: document.getElementById('valuationQuality'),
  valuationQualityDetail: document.getElementById('valuationQualityDetail'),
  fundamentalsTable: document.querySelector('#fundamentalsTable tbody'),
  assumptionList: document.getElementById('assumptionList'),
};

const state = {
  symbol: DEFAULT_SYMBOL,
  timeframe: '1M',
  seriesCache: new Map(),
  chart: null,
  quote: null,
  currency: DEFAULT_CURRENCY,
  valuations: null,
  events: [],
};

const currencyFormatter = (currency = DEFAULT_CURRENCY, digits = 2) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: digits, minimumFractionDigits: digits });

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const escapeHtml = (value = '') => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const renderMarkdownish = (container, text) => {
  if (!container) return;
  if (!text) {
    container.innerHTML = '<p class="muted">No analysis available yet.</p>';
    return;
  }
  const sections = text.trim().split(/\n{2,}/).map((section) => section.trim()).filter(Boolean);
  const html = sections.map((section) => {
    if (/^-\s+/m.test(section)) {
      const items = section.split(/\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('- '))
        .map((line) => `<li>${escapeHtml(line.replace(/^-\s*/, ''))}</li>`)
        .join('');
      return `<ul>${items}</ul>`;
    }
    return `<p>${escapeHtml(section)}</p>`;
  }).join('');
  container.innerHTML = html;
};

const setActiveTimeframe = (timeframe) => {
  state.timeframe = timeframe;
  if (!dom.timeframeSwitcher) return;
  dom.timeframeSwitcher.querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tf === timeframe);
  });
};

const updateChart = (series, timeframe) => {
  if (!dom.chartCanvas || !window.Chart) return;
  const ctx = dom.chartCanvas.getContext('2d');
  const points = (series || []).map((row) => ({ x: new Date(row.date), y: Number(row.close) }));
  const gradient = ctx.createLinearGradient(0, 0, 0, dom.chartCanvas.height || 320);
  gradient.addColorStop(0, 'rgba(98, 208, 255, 0.4)');
  gradient.addColorStop(1, 'rgba(98, 208, 255, 0)');

  if (!state.chart) {
    state.chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: `${state.symbol} price`,
            data: points,
            borderColor: '#62d0ff',
            backgroundColor: gradient,
            tension: 0.25,
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        scales: {
          x: {
            type: 'time',
            time: { tooltipFormat: timeframe === '1D' ? 'MMM d, HH:mm' : 'MMM d, yyyy' },
            ticks: {
              maxRotation: 0,
              color: 'rgba(235,240,255,0.6)',
            },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            ticks: { color: 'rgba(235,240,255,0.6)' },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: (ctxPoint) => `${currencyFormatter(state.currency, 2).format(ctxPoint.parsed.y)}`,
            },
          },
        },
      },
    });
  } else {
    const dataset = state.chart.data.datasets[0];
    dataset.data = points;
    dataset.label = `${state.symbol} price`;
    state.chart.options.scales.x.time.tooltipFormat = timeframe === '1D' ? 'MMM d, HH:mm' : 'MMM d, yyyy';
    state.chart.update();
  }
};

const describeMomentum = (analysis, latestPrice) => {
  if (!analysis) return { label: '—', detail: 'Insufficient history' };
  const { sma20, sma50, ema21, rsi } = analysis;
  if (sma20 == null || sma50 == null) return { label: 'Neutral', detail: 'Not enough data for trend' };
  const momentum = sma20 > sma50 ? 'Positive' : sma20 < sma50 ? 'Negative' : 'Neutral';
  let detail = `20d SMA ${sma20?.toFixed(2) ?? '—'} vs 50d ${sma50?.toFixed(2) ?? '—'}`;
  if (ema21 != null && latestPrice != null) {
    const bias = latestPrice > ema21 ? 'above' : 'below';
    detail += ` · Price ${bias} 21d EMA`;
  }
  if (rsi != null) {
    detail += ` · RSI ${rsi.toFixed(1)}`;
  }
  return { label: momentum, detail };
};

const describeRisk = (analysis) => {
  if (!analysis || analysis.volatility == null) return { label: '—', detail: 'Insufficient data' };
  const vol = analysis.volatility;
  const label = vol > 0.6 ? 'Elevated' : vol > 0.35 ? 'Moderate' : 'Calm';
  const detail = `Ann. vol ${formatPercent(vol)} · Sharpe ${analysis.sharpe != null ? analysis.sharpe.toFixed(2) : '—'}`;
  return { label, detail };
};

const updateTechnicalSection = (series, timeframe) => {
  const config = TIMEFRAME_CONFIG[timeframe] || TIMEFRAME_CONFIG['1M'];
  const analysis = analyseSeries(series, { periodsPerYear: config.periodsPerYear });

  if (analysis.volatility != null) {
    dom.metricVolatility.textContent = formatPercent(analysis.volatility);
    dom.metricVolatilityDetail.textContent = `${config.label} basis`; 
  } else {
    dom.metricVolatility.textContent = '—';
    dom.metricVolatilityDetail.textContent = 'Not enough data';
  }

  if (analysis.sharpe != null) {
    dom.metricSharpe.textContent = analysis.sharpe.toFixed(2);
    dom.metricSharpeDetail.textContent = analysis.sharpe > 1
      ? 'Risk-adjusted performance >1σ'
      : 'Subdued risk-adjusted returns';
  } else {
    dom.metricSharpe.textContent = '—';
    dom.metricSharpeDetail.textContent = 'Insufficient history';
  }

  if (analysis.drawdown != null) {
    dom.metricDrawdown.textContent = formatPercent(Math.abs(analysis.drawdown));
    dom.metricDrawdownDetail.textContent = 'Worst peak-to-trough';
  } else {
    dom.metricDrawdown.textContent = '—';
    dom.metricDrawdownDetail.textContent = 'Insufficient history';
  }

  if (analysis.averageVolume != null) {
    dom.metricLiquidity.textContent = formatNumber(analysis.averageVolume, 2);
    dom.metricLiquidityDetail.textContent = '30-bar avg volume';
  } else {
    dom.metricLiquidity.textContent = '—';
    dom.metricLiquidityDetail.textContent = 'Volume unavailable';
  }

  const latestClose = series?.[series.length - 1]?.close ?? null;
  const { label: momentumLabel, detail: momentumDetail } = describeMomentum(analysis, latestClose);
  dom.metricMomentum.textContent = momentumLabel;
  dom.metricMomentumDetail.textContent = momentumDetail;

  const { label: riskLabel, detail: riskDetail } = describeRisk(analysis);
  dom.metricRisk.textContent = riskLabel;
  dom.metricRiskDetail.textContent = riskDetail;
};

const updateHero = (quote) => {
  if (!quote) return;
  const fmt = currencyFormatter(quote.currency || state.currency);
  dom.heroSymbol.textContent = quote.symbol || state.symbol;
  dom.heroPrice.textContent = fmt.format(quote.price ?? quote.close ?? quote.last ?? 0);
  const previous = quote.previousClose ?? quote.open;
  if (previous != null && quote.price != null) {
    const change = quote.price - previous;
    const pct = previous ? change / previous : 0;
    const sign = change >= 0 ? '+' : '';
    dom.heroChange.textContent = `${sign}${fmt.format(change)} (${formatPercent(pct)})`;
    dom.heroChange.style.color = change >= 0 ? '#5fe1a1' : '#ff6b81';
  } else {
    dom.heroChange.textContent = '—';
    dom.heroChange.style.color = 'inherit';
  }
};

const updateHeroValuation = (valuations, quote) => {
  if (!valuations) {
    dom.heroFairValue.textContent = '—';
    dom.heroUpside.textContent = '—';
    dom.heroConfidence.textContent = '—';
    dom.heroConfidenceDetail.textContent = 'No valuation data yet';
    return;
  }
  const fmt = currencyFormatter((quote && quote.currency) || state.currency);
  const blended = valuations.blended || {};
  const fairValue = blended.fairValue ?? valuations.dcf?.fairValue ?? valuations.multiples?.fairValue ?? null;
  dom.heroFairValue.textContent = fairValue != null ? fmt.format(fairValue) : '—';
  if (fairValue != null && quote?.price != null) {
    const diff = fairValue - quote.price;
    const pct = quote.price ? diff / quote.price : 0;
    const sign = diff >= 0 ? '+' : '';
    dom.heroUpside.textContent = `${sign}${formatPercent(pct)} vs spot`;
    dom.heroUpside.style.color = diff >= 0 ? '#5fe1a1' : '#ff6b81';
  } else {
    dom.heroUpside.textContent = '—';
    dom.heroUpside.style.color = 'inherit';
  }
  if (blended.confidence != null) {
    dom.heroConfidence.textContent = `${Math.round(clamp(blended.confidence, 0, 1) * 100)}%`;
    dom.heroConfidenceDetail.textContent = blended.rationale || 'Model confidence';
  } else {
    dom.heroConfidence.textContent = '—';
    dom.heroConfidenceDetail.textContent = blended?.rationale || 'Confidence unavailable';
  }
};

const updateValuationPanel = (payload, quote) => {
  state.valuations = payload?.valuations || null;
  updateHeroValuation(state.valuations, quote);

  if (!payload) {
    dom.valuationFairValue.textContent = '—';
    dom.valuationUpside.textContent = '—';
    dom.valuationDcfRange.textContent = '—';
    dom.valuationDcfNotes.textContent = 'No DCF data';
    dom.valuationMultiples.textContent = '—';
    dom.valuationMultiplesNotes.textContent = 'No comparable data';
    dom.valuationQuality.textContent = '—';
    dom.valuationQualityDetail.textContent = '—';
    dom.fundamentalsTable.innerHTML = '';
    dom.assumptionList.innerHTML = '';
    return;
  }

  const fmt = currencyFormatter((quote && quote.currency) || state.currency);
  const { valuations = {}, qualityNarrative, table = [], assumptions = [] } = payload;
  const blended = valuations.blended || {};
  if (blended.fairValue != null) {
    dom.valuationFairValue.textContent = fmt.format(blended.fairValue);
    if (quote?.price != null) {
      const pct = (blended.fairValue - quote.price) / quote.price;
      dom.valuationUpside.textContent = `${formatPercent(pct)} vs spot`;
      dom.valuationUpside.style.color = pct >= 0 ? '#5fe1a1' : '#ff6b81';
    } else {
      dom.valuationUpside.textContent = '—';
      dom.valuationUpside.style.color = 'inherit';
    }
  } else {
    dom.valuationFairValue.textContent = '—';
    dom.valuationUpside.textContent = '—';
  }

  if (valuations.dcf) {
    const { low, high, fairValue, discountRate, terminalGrowth } = valuations.dcf;
    if (low != null && high != null) {
      dom.valuationDcfRange.textContent = `${fmt.format(low)} – ${fmt.format(high)}`;
    } else if (fairValue != null) {
      dom.valuationDcfRange.textContent = fmt.format(fairValue);
    } else {
      dom.valuationDcfRange.textContent = '—';
    }
    const dr = discountRate != null ? `${formatPercent(discountRate)}` : '—';
    const tg = terminalGrowth != null ? `${formatPercent(terminalGrowth)}` : '—';
    dom.valuationDcfNotes.textContent = `Discount ${dr}, terminal growth ${tg}`;
  } else {
    dom.valuationDcfRange.textContent = '—';
    dom.valuationDcfNotes.textContent = 'DCF unavailable';
  }

  if (valuations.multiples) {
    const { fairValue, low, high, notes } = valuations.multiples;
    if (low != null && high != null) {
      dom.valuationMultiples.textContent = `${fmt.format(low)} – ${fmt.format(high)}`;
    } else if (fairValue != null) {
      dom.valuationMultiples.textContent = fmt.format(fairValue);
    } else {
      dom.valuationMultiples.textContent = '—';
    }
    dom.valuationMultiplesNotes.textContent = notes || 'Comps blend of P/E, P/S, P/B';
  } else {
    dom.valuationMultiples.textContent = '—';
    dom.valuationMultiplesNotes.textContent = 'No multiples available';
  }

  if (blended.qualityScore != null) {
    dom.valuationQuality.textContent = `${Math.round(blended.qualityScore)}/100`;
    dom.valuationQualityDetail.textContent = blended.rationale || qualityNarrative || 'Composite of profitability, growth, leverage';
  } else {
    dom.valuationQuality.textContent = '—';
    dom.valuationQualityDetail.textContent = qualityNarrative || '—';
  }

  dom.fundamentalsTable.innerHTML = '';
  (table || []).forEach((row) => {
    const tr = document.createElement('tr');
    const tdMetric = document.createElement('td'); tdMetric.textContent = row.metric || '';
    const tdValue = document.createElement('td'); tdValue.textContent = row.value || '—';
    const tdTrend = document.createElement('td'); tdTrend.textContent = row.trend || '—';
    tr.append(tdMetric, tdValue, tdTrend);
    dom.fundamentalsTable.appendChild(tr);
  });

  dom.assumptionList.innerHTML = '';
  (assumptions || []).forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    dom.assumptionList.appendChild(li);
  });
};

const updateEvents = (payload) => {
  if (!dom.eventStream) return;
  dom.eventStream.innerHTML = '';
  if (!payload || !Array.isArray(payload.events) || payload.events.length === 0) {
    dom.eventStatus.textContent = payload?.warning || 'No recent events detected.';
    return;
  }
  dom.eventStatus.textContent = payload.warning || '';
  payload.events.forEach((event) => {
    const clone = dom.eventTemplate.content.firstElementChild.cloneNode(true);
    const title = clone.querySelector('.event-title');
    const meta = clone.querySelector('.event-meta');
    const summary = clone.querySelector('.event-summary');
    const score = clone.querySelector('.event-score');
    const footer = clone.querySelector('.event-footer');
    if (title) {
      title.textContent = event.title || 'Untitled event';
      if (event.url) title.href = event.url;
    }
    if (meta) {
      const published = event.date ? new Date(event.date).toLocaleString() : 'Unknown time';
      const type = event.type ? ` · ${event.type}` : '';
      const source = event.source ? ` · ${event.source}` : '';
      meta.textContent = `${published}${type}${source}`;
    }
    if (summary) summary.textContent = event.summary || '';
    if (score) score.textContent = event.impactScore != null ? `Impact ${event.impactScore}/5` : '';
    if (footer) footer.textContent = event.highlights || (event.tags ? event.tags.join(', ') : '');
    dom.eventStream.appendChild(clone);
  });
};

const buildTiingoUrl = (symbol, timeframe) => {
  const config = TIMEFRAME_CONFIG[timeframe] || TIMEFRAME_CONFIG['1M'];
  const params = new URLSearchParams({ symbol, kind: config.kind, limit: String(config.limit) });
  if (config.interval) params.set('interval', config.interval);
  return `/api/tiingo?${params.toString()}`;
};

const fetchJson = async (url, init) => {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed ${response.status}: ${text || response.statusText}`);
  }
  return response.json();
};

const loadSeries = async (symbol, timeframe) => {
  const cacheKey = `${symbol}::${timeframe}`;
  if (state.seriesCache.has(cacheKey)) {
    return state.seriesCache.get(cacheKey);
  }
  dom.chartStatus.textContent = 'Loading price history…';
  const data = await fetchJson(buildTiingoUrl(symbol, timeframe));
  if (data.warning) {
    dom.chartStatus.textContent = data.warning;
  } else {
    dom.chartStatus.textContent = '';
  }
  const series = Array.isArray(data.data) ? data.data : [];
  state.seriesCache.set(cacheKey, series);
  return series;
};

const loadQuote = async (symbol) => {
  const params = new URLSearchParams({ symbol, kind: 'intraday_latest' });
  const data = await fetchJson(`/api/tiingo?${params.toString()}`);
  return Array.isArray(data.data) ? data.data[0] : null;
};

const loadFundamentals = async (symbol) => {
  const params = new URLSearchParams({ symbol });
  return fetchJson(`/api/tiingo-fundamentals?${params.toString()}`);
};

const loadEvents = async (symbol) => {
  const params = new URLSearchParams({ symbol, limit: '8' });
  return fetchJson(`/api/tiingo-events?${params.toString()}`);
};

const loadDocument = async (url) => {
  return fetchJson('/api/document-fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
};

const callAiAnalyst = async (payload) => fetchJson('/api/ai-analyst', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

const loadSymbol = async (symbol, timeframe = state.timeframe) => {
  try {
    dom.symbolInput.value = symbol;
    state.symbol = symbol;
    dom.heroSymbol.textContent = symbol;
    dom.chartStatus.textContent = 'Loading market data…';
    const [quote, series] = await Promise.all([
      loadQuote(symbol).catch((err) => {
        console.warn('quote fetch failed', err);
        return null;
      }),
      loadSeries(symbol, timeframe).catch((err) => {
        console.warn('series fetch failed', err);
        dom.chartStatus.textContent = 'Unable to load price history — showing cached or mock data.';
        return [];
      }),
    ]);
    state.quote = quote;
    if (quote?.currency) state.currency = quote.currency;
    updateChart(series, timeframe);
    updateTechnicalSection(series, timeframe);
    if (quote) updateHero(quote);

    loadFundamentals(symbol).then((fundamentals) => {
      updateValuationPanel(fundamentals, quote);
    }).catch((err) => {
      console.warn('fundamentals fetch failed', err);
      updateValuationPanel(null, quote);
    });

    loadEvents(symbol).then((events) => {
      state.events = events?.events || [];
      updateEvents(events);
    }).catch((err) => {
      console.warn('events fetch failed', err);
      dom.eventStatus.textContent = 'Event feed unavailable';
    });
  } catch (error) {
    console.error('loadSymbol failed', error);
    dom.chartStatus.textContent = 'Failed to load market data. Check network/API configuration.';
  }
};

const onTimeframeClick = (event) => {
  const button = event.target.closest('button[data-tf]');
  if (!button) return;
  const { tf } = button.dataset;
  if (!tf || tf === state.timeframe) return;
  setActiveTimeframe(tf);
  loadSeries(state.symbol, tf)
    .then((series) => {
      updateChart(series, tf);
      updateTechnicalSection(series, tf);
    })
    .catch((err) => {
      console.warn('timeframe load failed', err);
      dom.chartStatus.textContent = 'Failed to load timeframe data';
    });
};

const onSymbolSubmit = (event) => {
  event.preventDefault();
  const raw = dom.symbolInput.value.trim().toUpperCase();
  if (!raw) return;
  state.seriesCache.clear();
  loadSymbol(raw, state.timeframe);
};

const onAiFormSubmit = async (event) => {
  event.preventDefault();
  if (!dom.aiStatus) return;
  dom.aiStatus.textContent = 'Synthesizing screening narrative…';
  dom.aiOutput.innerHTML = '';
  const payload = {
    mode: 'screener',
    symbol: state.symbol,
    universe: dom.aiTickers.value,
    focus: dom.aiFocus.value,
    riskTolerance: dom.aiRisk.value,
    horizon: dom.aiHorizon.value,
    notes: dom.aiNotes.value,
    quote: state.quote,
    valuations: state.valuations,
    events: state.events,
  };
  try {
    const result = await callAiAnalyst(payload);
    dom.aiStatus.textContent = result.warning || '';
    dom.aiModel.textContent = result.model ? `Model: ${result.model}` : '';
    renderMarkdownish(dom.aiOutput, result.analysis || 'No analysis returned.');
  } catch (error) {
    console.error('AI screener failed', error);
    dom.aiStatus.textContent = 'AI module unavailable. Configure OPENAI_API_KEY to enable analysis.';
    dom.aiOutput.innerHTML = '';
  }
};

const onRefreshEvents = () => {
  dom.eventStatus.textContent = 'Refreshing events…';
  loadEvents(state.symbol)
    .then((events) => {
      state.events = events?.events || [];
      updateEvents(events);
    })
    .catch((err) => {
      console.warn('refresh events failed', err);
      dom.eventStatus.textContent = 'Unable to refresh event feed';
    });
};

const onFetchDocument = async () => {
  const url = dom.documentUrl.value.trim();
  if (!url) {
    dom.documentStatus.textContent = 'Provide a document URL to fetch.';
    return;
  }
  dom.documentStatus.textContent = 'Fetching and cleaning document…';
  try {
    const result = await loadDocument(url);
    dom.documentStatus.textContent = result.truncated
      ? 'Document truncated for analysis (size limit).'
      : 'Document fetched successfully.';
    dom.documentText.value = result.content || '';
  } catch (error) {
    console.error('document fetch failed', error);
    dom.documentStatus.textContent = 'Unable to fetch document. Ensure CORS-compatible HTTPS URL.';
  }
};

const onAnalyzeDocument = async () => {
  const text = dom.documentText.value.trim();
  if (!text) {
    dom.documentStatus.textContent = 'Paste text or fetch a document first.';
    return;
  }
  dom.documentStatus.textContent = 'Running disclosure audit via AI…';
  dom.documentAnalysis.innerHTML = '';
  try {
    const result = await callAiAnalyst({
      mode: 'document',
      symbol: state.symbol,
      documentText: text,
      quote: state.quote,
      valuations: state.valuations,
    });
    dom.documentStatus.textContent = result.warning || '';
    dom.documentModel.textContent = result.model ? `Model: ${result.model}` : '';
    renderMarkdownish(dom.documentAnalysis, result.analysis || 'No insights returned.');
  } catch (error) {
    console.error('document analysis failed', error);
    dom.documentStatus.textContent = 'AI module unavailable. Configure OPENAI_API_KEY to enable document intelligence.';
  }
};

const init = () => {
  setActiveTimeframe(state.timeframe);
  if (dom.timeframeSwitcher) dom.timeframeSwitcher.addEventListener('click', onTimeframeClick);
  if (dom.symbolForm) dom.symbolForm.addEventListener('submit', onSymbolSubmit);
  if (dom.aiForm) dom.aiForm.addEventListener('submit', onAiFormSubmit);
  if (dom.refreshEvents) dom.refreshEvents.addEventListener('click', onRefreshEvents);
  if (dom.fetchDocumentBtn) dom.fetchDocumentBtn.addEventListener('click', onFetchDocument);
  if (dom.analyzeDocumentBtn) dom.analyzeDocumentBtn.addEventListener('click', onAnalyzeDocument);
  loadSymbol(state.symbol, state.timeframe);
};

init();
