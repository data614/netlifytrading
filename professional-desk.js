const DEFAULT_SYMBOL = 'AAPL';
const DEFAULT_TIMEFRAME = '1D';
const AI_DEFAULT_MODEL = 'chatgpt-5';
const SEARCH_RESULT_LIMIT = 12;

const TIMEFRAMES = {
  '1D': { kind: 'intraday', interval: '5min', limit: 96, label: '1 Day', chartInterval: 'time' },
  '1W': { kind: 'eod', limit: 7, label: '1 Week', chartInterval: 'date' },
  '1M': { kind: 'eod', limit: 22, label: '1 Month', chartInterval: 'date' },
  '3M': { kind: 'eod', limit: 66, label: '3 Months', chartInterval: 'date' },
  '6M': { kind: 'eod', limit: 132, label: '6 Months', chartInterval: 'date' },
  '1Y': { kind: 'eod', limit: 252, label: '1 Year', chartInterval: 'date' },
  '2Y': { kind: 'eod', limit: 504, label: '2 Years', chartInterval: 'date' },
};

const state = {
  symbol: DEFAULT_SYMBOL,
  timeframe: DEFAULT_TIMEFRAME,
  symbolUniverse: [],
  chart: null,
  priceSeries: [],
  research: null,
  ai: null,
  loadingToken: 0,
  aiToken: 0,
};

const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function formatCurrency(value, currency = 'USD') {
  if (value == null || Number.isNaN(value)) return '—';
  try {
    const maximumFractionDigits = Math.abs(value) >= 100 ? 0 : 2;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits,
    }).format(value);
  } catch (error) {
    console.warn('currency format error', error);
    return `${currency} ${numberFormatter.format(value)}`;
  }
}

function formatNumber(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—';
  return Number(value).toFixed(digits);
}

function formatPercent(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${Number(value).toFixed(digits)}%`;
}

function formatVolume(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return numberFormatter.format(value);
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function htmlEscape(str) {
  return String(str || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch));
}

function setStatus(message = '', tone = 'info') {
  const el = document.getElementById('pdStatus');
  if (!el) return;
  if (!message) {
    el.textContent = '';
    el.className = 'prodesk-status';
    return;
  }
  el.textContent = message;
  el.className = `prodesk-status visible status-${tone}`;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value == null || value === '' ? '—' : value;
}

function setList(id, items) {
  const el = document.getElementById(id);
  if (!el) return;
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) {
    el.innerHTML = '<li class="muted">No data available.</li>';
    return;
  }
  el.innerHTML = list.map((item) => `<li>${htmlEscape(item)}</li>`).join('');
}

function updateClock() {
  const clock = document.getElementById('pdSessionClock');
  if (!clock) return;
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const zone = Intl.DateTimeFormat('en', { timeZoneName: 'short' }).format(now).split(' ').slice(-1)[0] || 'UTC';
  clock.textContent = `${time} ${zone}`;
}

setInterval(updateClock, 1000);
updateClock();

async function ensureSymbolsLoaded() {
  if (state.symbolUniverse.length) return state.symbolUniverse;
  try {
    const response = await fetch('data/symbols.json');
    if (!response.ok) throw new Error(`Symbol directory unavailable (${response.status})`);
    const payload = await response.json();
    const list = Array.isArray(payload) ? payload : (payload?.symbols || []);
    state.symbolUniverse = list
      .map((entry) => ({
        symbol: String(entry.symbol || '').toUpperCase(),
        name: entry.name || '',
        exchange: entry.exchange || entry.mic || '',
        mic: entry.mic || '',
        country: entry.country || '',
      }))
      .filter((entry) => entry.symbol);
  } catch (error) {
    console.error('Failed to load symbols', error);
    setStatus(`Symbol reference failed: ${error.message || error}`, 'warn');
  }
  return state.symbolUniverse;
}

function filterSymbols(query) {
  const trimmed = (query || '').trim().toUpperCase();
  if (!trimmed) return [];
  const words = trimmed.split(/\s+/).filter(Boolean);
  const entries = state.symbolUniverse;
  if (!entries.length) return [];
  return entries
    .map((entry) => {
      let score = 0;
      if (entry.symbol.startsWith(trimmed)) score += 6;
      if (entry.symbol.includes(trimmed)) score += 4;
      if ((entry.name || '').toUpperCase().includes(trimmed)) score += 3;
      for (const word of words) {
        if (entry.name && entry.name.toUpperCase().includes(word)) score += 1;
        if (entry.exchange && entry.exchange.toUpperCase().includes(word)) score += 0.5;
      }
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, SEARCH_RESULT_LIMIT)
    .map((item) => item.entry);
}

function bindSearchComponents() {
  const components = document.querySelectorAll('[data-component="symbol-search"]');
  components.forEach((component) => {
    const input = component.querySelector('[data-symbol-input]');
    const resultsPanel = component.querySelector('[data-symbol-suggestions]');
    if (!input || !resultsPanel) return;

    let activeIndex = -1;
    let currentResults = [];

    const closePanel = () => {
      resultsPanel.innerHTML = '';
      resultsPanel.classList.remove('visible');
      activeIndex = -1;
    };

    const highlight = () => {
      Array.from(resultsPanel.querySelectorAll('button')).forEach((btn, idx) => {
        if (idx === activeIndex) btn.classList.add('active');
        else btn.classList.remove('active');
      });
    };

    const commitSelection = (symbol) => {
      closePanel();
      input.value = symbol;
      setSymbol(symbol);
    };

    input.addEventListener('input', async (event) => {
      const query = event.target.value || '';
      if (!query.trim()) {
        closePanel();
        return;
      }
      await ensureSymbolsLoaded();
      currentResults = filterSymbols(query);
      if (!currentResults.length) {
        closePanel();
        return;
      }
      resultsPanel.innerHTML = currentResults
        .map((entry) => {
          const subtitle = [entry.exchange, entry.country].filter(Boolean).join(' · ');
          return `<button type="button" data-symbol="${htmlEscape(entry.symbol)}"><strong>${htmlEscape(entry.symbol)}</strong><br><span class="muted">${htmlEscape(entry.name)}</span><br><span class="muted small">${htmlEscape(subtitle)}</span></button>`;
        })
        .join('');
      resultsPanel.classList.add('visible');
      activeIndex = -1;
    });

    input.addEventListener('keydown', (event) => {
      if (!resultsPanel.classList.contains('visible')) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        activeIndex = (activeIndex + 1) % currentResults.length;
        highlight();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        activeIndex = (activeIndex - 1 + currentResults.length) % currentResults.length;
        highlight();
      } else if (event.key === 'Enter') {
        if (activeIndex >= 0 && currentResults[activeIndex]) {
          event.preventDefault();
          commitSelection(currentResults[activeIndex].symbol);
        }
      } else if (event.key === 'Escape') {
        closePanel();
      }
    });

    resultsPanel.addEventListener('mousedown', (event) => {
      const button = event.target.closest('button[data-symbol]');
      if (!button) return;
      event.preventDefault();
      const symbol = button.dataset.symbol;
      if (symbol) commitSelection(symbol);
    });

    document.addEventListener('click', (event) => {
      if (!component.contains(event.target)) closePanel();
    });
  });
}

function applyChangeStyles(value, element) {
  if (!element) return;
  element.classList.remove('positive', 'negative', 'neutral');
  if (value > 0) element.classList.add('positive');
  else if (value < 0) element.classList.add('negative');
  else element.classList.add('neutral');
}

function updateOverview(research) {
  if (!research) return;
  const metrics = research.metrics || {};
  const company = research.company || {};
  setText('pdSymbol', research.symbol || state.symbol);
  setText('pdCompanyName', company.name || company.legalName || '—');
  setText('pdExchange', company.exchange || metrics.exchange || '—');
  setText('pdCurrency', metrics.currency || company.currency || 'USD');

  const priceEl = document.getElementById('pdPrice');
  if (priceEl) priceEl.textContent = formatCurrency(metrics.currentPrice, metrics.currency || 'USD');
  const changeEl = document.getElementById('pdChange');
  if (changeEl) {
    changeEl.textContent = formatCurrency(metrics.change, metrics.currency || 'USD');
    applyChangeStyles(metrics.change, changeEl);
  }
  const changePctEl = document.getElementById('pdChangePct');
  if (changePctEl) {
    changePctEl.textContent = formatPercent(metrics.changePercent);
    applyChangeStyles(metrics.changePercent, changePctEl);
  }

  setText('pdPrevClose', formatCurrency(metrics.previousClose, metrics.currency));
  const dayRangeText = metrics.dayLow != null && metrics.dayHigh != null
    ? `${formatCurrency(metrics.dayLow, metrics.currency)} – ${formatCurrency(metrics.dayHigh, metrics.currency)}`
    : metrics.dayRange || '—';
  setText('pdDayRange', dayRangeText);
  const range52 = metrics.fiftyTwoWeekLow != null && metrics.fiftyTwoWeekHigh != null
    ? `${formatCurrency(metrics.fiftyTwoWeekLow, metrics.currency)} – ${formatCurrency(metrics.fiftyTwoWeekHigh, metrics.currency)}`
    : '—';
  setText('pd52Week', range52);
  const volumeText = metrics.volume || metrics.averageVolume
    ? `${formatVolume(metrics.volume)} / ${formatVolume(metrics.averageVolume)} avg`
    : '—';
  setText('pdVolume', volumeText);
  setText('pdVolatility', metrics.volatilityLabel || formatPercent(metrics.volatilityAnnualized));
  setText('pdMomentum', metrics.momentumLabel || formatPercent(metrics.momentumScore));
  setText('pdRiskScore', metrics.riskLabel || metrics.riskScore || '—');

  if (research.warnings && research.warnings.length) {
    setStatus(research.warnings.join(' '), 'warn');
  } else if (research.note) {
    setStatus(research.note, 'info');
  } else {
    setStatus(`Viewing ${research.symbol} — ${company.name || ''}`.trim(), 'info');
  }

  document.title = `Trading Desk — ${research.symbol}`;
}

function renderSnapshots(research) {
  const container = document.getElementById('pdSnapshotRow');
  if (!container) return;
  const snapshots = research?.snapshots || {};
  const entries = Object.entries(snapshots);
  if (!entries.length) {
    container.innerHTML = '<div class="muted">No snapshot data.</div>';
    return;
  }
  container.innerHTML = entries
    .map(([key, snap]) => {
      const pct = Number.isFinite(snap.returnPct) ? snap.returnPct : null;
      const classes = ['snapshot-chip'];
      if (key === state.timeframe) classes.push('active');
      if (pct != null) classes.push(pct > 0 ? 'positive' : pct < 0 ? 'negative' : 'neutral');
      return `<button type="button" class="${classes.join(' ')}" data-tf="${key}"><span>${htmlEscape(snap.label || key)}</span><span>${formatPercent(pct)}</span></button>`;
    })
    .join('');

  container.querySelectorAll('[data-tf]').forEach((button) => {
    button.addEventListener('click', () => {
      const tf = button.dataset.tf;
      if (TIMEFRAMES[tf]) {
        state.timeframe = tf;
        updateTimeframeButtons(tf);
        loadPriceSeries(state.symbol, tf, state.loadingToken);
      }
    });
  });
}

function updateInsights(research) {
  const insights = research?.insights || [];
  setList('pdInsights', insights);
}

function updateLevels(research) {
  const container = document.getElementById('pdKeyLevels');
  if (!container) return;
  const levels = research?.levels || {};
  const order = [
    { key: 'immediateSupport', label: 'Immediate Support' },
    { key: 'pivot', label: 'Pivot' },
    { key: 'immediateResistance', label: 'Immediate Resistance' },
    { key: 'majorSupport', label: 'Major Support' },
    { key: 'majorResistance', label: 'Major Resistance' },
  ];
  const currency = research?.metrics?.currency || 'USD';
  const rows = order
    .map((item) => (levels[item.key] != null ? `<div class="level-pill"><span>${item.label}</span><strong>${formatCurrency(levels[item.key], currency)}</strong></div>` : ''))
    .filter(Boolean);
  container.innerHTML = rows.length ? rows.join('') : '<div class="muted">No technical levels calculated.</div>';
}

function updateEvents(research) {
  const list = document.getElementById('pdEventsList');
  if (!list) return;
  const events = Array.isArray(research?.events) ? research.events : [];
  if (!events.length) {
    list.innerHTML = '<li class="muted">No recent events found.</li>';
    return;
  }
  list.innerHTML = events
    .map((event) => {
      const published = toDate(event.publishedAt || event.date);
      const when = published ? published.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
      const tags = (event.tags || []).map((tag) => `<span>${htmlEscape(tag)}</span>`).join('');
      const link = event.url ? `<a href="${htmlEscape(event.url)}" target="_blank" rel="noopener">Open source</a>` : '';
      return `<li class="event-card"><h4>${htmlEscape(event.title || 'Event')}</h4><time>${htmlEscape(when)}</time><div class="muted">${htmlEscape(event.summary || event.description || '')}</div><div class="event-tags">${tags}</div>${link}</li>`;
    })
    .join('');
}

function updateFilings(research) {
  const tbody = document.getElementById('pdFilingsList');
  if (!tbody) return;
  const filings = Array.isArray(research?.filings) ? research.filings : [];
  if (!filings.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="muted">No filings available.</td></tr>';
    return;
  }
  tbody.innerHTML = filings
    .map((filing) => {
      const filed = toDate(filing.filedAt || filing.date);
      const filedText = filed ? filed.toLocaleDateString() : '—';
      const url = filing.url ? `<a href="${htmlEscape(filing.url)}" target="_blank" rel="noopener">View</a>` : '—';
      return `<tr><td>${htmlEscape(filing.formType || filing.type || '—')}</td><td>${htmlEscape(filedText)}</td><td>${htmlEscape(filing.description || filing.title || '')}</td><td>${url}</td></tr>`;
    })
    .join('');
}

function updateRiskMetrics(research) {
  const table = document.getElementById('pdRiskMetrics');
  if (!table) return;
  const metrics = research?.riskMetrics || {};
  const currency = research?.metrics?.currency || 'USD';
  const rows = [
    ['Value at Risk (95%)', metrics.var95 != null ? formatCurrency(metrics.var95, currency) : null],
    ['Value at Risk (99%)', metrics.var99 != null ? formatCurrency(metrics.var99, currency) : null],
    ['Expected Move (1D)', metrics.expectedMove1D != null ? formatCurrency(metrics.expectedMove1D, currency) : null],
    ['Expected Move (5D)', metrics.expectedMove1W != null ? formatCurrency(metrics.expectedMove1W, currency) : null],
    ['Expected Move (21D)', metrics.expectedMove1M != null ? formatCurrency(metrics.expectedMove1M, currency) : null],
    ['Beta vs SPX', metrics.beta != null ? formatNumber(metrics.beta, 2) : null],
    ['ATR (20D)', metrics.atr != null ? formatCurrency(metrics.atr, currency) : null],
    ['Sharpe (60D est.)', metrics.sharpeEstimate != null ? formatNumber(metrics.sharpeEstimate, 2) : null],
  ].filter((row) => row[1] != null);
  if (!rows.length) {
    table.innerHTML = '<tbody><tr><td class="muted">Risk metrics unavailable.</td></tr></tbody>';
    return;
  }
  table.innerHTML = `<tbody>${rows.map((row) => `<tr><td>${row[0]}</td><td>${row[1]}</td></tr>`).join('')}</tbody>`;
  const note = document.getElementById('pdRiskNote');
  if (note) note.textContent = research?.riskMetrics?.note || '';
}

function updateScenarioTable(source) {
  const table = document.getElementById('pdScenarioTable');
  if (!table) return;
  const scenarios = Array.isArray(source?.scenarios) ? source.scenarios : [];
  if (!scenarios.length) {
    table.innerHTML = '<tbody><tr><td class="muted">Scenario data unavailable.</td></tr></tbody>';
    return;
  }
  table.innerHTML = `<thead><tr><th>Scenario</th><th>Probability</th><th>Target</th><th>Return</th><th>Commentary</th></tr></thead><tbody>${scenarios
    .map((scenario) => {
      const probability = scenario.probability != null ? `${Math.round(scenario.probability * 100)}%` : '—';
      const currency = source?.metrics?.currency || state.research?.metrics?.currency || 'USD';
      const target = scenario.price != null ? formatCurrency(scenario.price, currency) : '—';
      const ret = scenario.returnPct != null ? formatPercent(scenario.returnPct) : '—';
      return `<tr><td>${htmlEscape(scenario.label || scenario.name || 'Scenario')}</td><td>${probability}</td><td>${target}</td><td>${ret}</td><td>${htmlEscape(scenario.commentary || scenario.narrative || '')}</td></tr>`;
    })
    .join('')}</tbody>`;
}

function updateComparables(research, ai) {
  const body = document.getElementById('vlComparablesBody');
  if (!body) return;
  const comparables = (ai?.peerSignals && ai.peerSignals.length) ? ai.peerSignals : (research?.comparables || []);
  if (!comparables.length) {
    body.innerHTML = '<tr><td colspan="5" class="muted">Comparable set unavailable.</td></tr>';
    return;
  }
  const currency = ai?.fairValue?.currency || research?.metrics?.currency || 'USD';
  body.innerHTML = comparables
    .map((peer) => {
      const fairValue = peer.fairValue != null ? formatCurrency(peer.fairValue, currency) : '—';
      const expected = peer.expectedReturn != null ? formatPercent(peer.expectedReturn) : '—';
      return `<tr><td>${htmlEscape(peer.name || peer.symbol || 'Peer')}</td><td>${htmlEscape(peer.profile || '')}</td><td>${fairValue}</td><td>${expected}</td><td>${htmlEscape(peer.notes || '')}</td></tr>`;
    })
    .join('');
}

function updateFairValue(ai, research) {
  const currency = research?.metrics?.currency || ai?.fairValue?.currency || 'USD';
  if (ai?.fairValue?.base != null) {
    setText('pdFairValue', formatCurrency(ai.fairValue.base, currency));
  } else if (research?.metrics?.fairValueEstimate != null) {
    setText('pdFairValue', formatCurrency(research.metrics.fairValueEstimate, currency));
  } else {
    setText('pdFairValue', '—');
  }
  if (ai?.expectedReturn) {
    setText('vlUpside', formatPercent(ai.expectedReturn.upside));
    setText('vlDownside', formatPercent(ai.expectedReturn.downside));
  } else if (research?.metrics?.expectedReturn) {
    setText('vlUpside', formatPercent(research.metrics.expectedReturn.upside));
    setText('vlDownside', formatPercent(research.metrics.expectedReturn.downside));
  }
  if (ai?.conviction) setText('vlConviction', ai.conviction);
  else if (research?.metrics?.conviction) setText('vlConviction', research.metrics.conviction);
}

function updateAiPanels(ai, research) {
  if (!document.getElementById('pdAiSummary')) return;
  if (!ai) {
    setText('pdAiSummary', 'AI valuation pending…');
    setList('pdAiDrivers', []);
    setList('pdAiRisks', []);
    setText('pdAiRecommendation', '');
    setText('pdValuationNote', '');
    updateScenarioTable(research);
    updateComparables(research, null);
    updateFairValue(null, research);
    return;
  }
  setText('pdAiSummary', ai.summary || 'AI valuation available.');
  setList('pdAiDrivers', ai.drivers || []);
  setList('pdAiRisks', ai.risks || []);
  if (ai.recommendation) {
    const recommendation = typeof ai.recommendation === 'string' ? ai.recommendation : ai.recommendation.text;
    setText('pdAiRecommendation', recommendation || '');
  }
  setText('pdValuationNote', ai.note || '');
  updateScenarioTable(ai);
  updateComparables(research, ai);
  updateFairValue(ai, research);
}

function updateTimeframeButtons(active) {
  const container = document.getElementById('pdTimeframes');
  if (container) {
    container.querySelectorAll('button').forEach((button) => {
      button.classList.toggle('active', button.dataset.tf === active);
    });
  }
  const snapshots = document.getElementById('pdSnapshotRow');
  if (snapshots) {
    snapshots.querySelectorAll('[data-tf]').forEach((button) => {
      button.classList.toggle('active', button.dataset.tf === active);
    });
  }
}

function updateChartStatus(message) {
  const el = document.getElementById('pdChartStatus');
  if (!el) return;
  el.textContent = message || '';
}

function renderChart(series, config, warning) {
  const canvas = document.getElementById('proDeskChart');
  if (!canvas || typeof window.Chart !== 'function') return;
  const labels = series.map((row) => {
    const date = toDate(row.date);
    if (!date) return '';
    return config.kind === 'intraday'
      ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  });
  const prices = series.map((row) => row.close ?? row.price ?? row.last ?? null);
  if (!prices.some((value) => Number.isFinite(value))) {
    updateChartStatus('Chart data unavailable.');
    return;
  }

  const ctx = canvas.getContext('2d');
  const gradient = (() => {
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height || 340);
    grad.addColorStop(0, 'rgba(60, 198, 255, 0.32)');
    grad.addColorStop(1, 'rgba(60, 198, 255, 0.05)');
    return grad;
  })();

  if (state.chart) {
    state.chart.data.labels = labels;
    state.chart.data.datasets[0].data = prices;
    state.chart.data.datasets[0].backgroundColor = gradient;
    state.chart.update();
  } else {
    state.chart = new window.Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Price',
            data: prices,
            fill: true,
            borderColor: '#3cc6ff',
            backgroundColor: gradient,
            tension: 0.25,
            pointRadius: 0,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            intersect: false,
            mode: 'index',
            callbacks: {
              label(context) {
                const currency = state.research?.metrics?.currency || 'USD';
                const value = context.parsed.y;
                return formatCurrency(value, currency);
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: 'rgba(255,255,255,0.6)', maxRotation: 0, autoSkip: true },
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: {
              color: 'rgba(255,255,255,0.6)',
              callback(value) {
                const currency = state.research?.metrics?.currency || 'USD';
                return formatCurrency(value, currency);
              },
            },
          },
        },
      },
    });
  }
  updateChartStatus(warning || '');
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch (error) { console.warn('Failed to parse JSON', error, text.slice(0, 200)); }
  }
  if (!response.ok) {
    const detail = data?.error || data?.detail || text || response.statusText;
    throw new Error(detail);
  }
  return data;
}

async function fetchResearch(symbol) {
  const url = new URL('/api/research', window.location.origin);
  url.searchParams.set('symbol', symbol);
  return fetchJson(url.toString());
}

async function fetchPriceSeries(symbol, timeframe) {
  const cfg = TIMEFRAMES[timeframe] || TIMEFRAMES[DEFAULT_TIMEFRAME];
  const url = new URL('/api/tiingo', window.location.origin);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('kind', cfg.kind);
  url.searchParams.set('limit', String(cfg.limit));
  if (cfg.interval) url.searchParams.set('interval', cfg.interval);
  return fetchJson(url.toString());
}

function applyPriceSeries(payload, config) {
  const series = Array.isArray(payload?.data) ? payload.data : [];
  if (!series.length) throw new Error('No price series available');
  state.priceSeries = series;
  renderChart(series, config, payload?.warning);
}

async function loadPriceSeries(symbol, timeframe, token) {
  try {
    const cfg = TIMEFRAMES[timeframe] || TIMEFRAMES[DEFAULT_TIMEFRAME];
    const payload = await fetchPriceSeries(symbol, timeframe);
    if (token !== state.loadingToken) return;
    applyPriceSeries(payload, cfg);
    if (payload?.warning) setStatus(payload.warning, 'warn');
  } catch (error) {
    if (token !== state.loadingToken) return;
    console.error('Price series failed', error);
    updateChartStatus(`Price series unavailable: ${error.message || error}`);
  }
}

async function runAiAnalysis(symbol, research) {
  if (!document.getElementById('pdAiSummary')) return;
  const token = ++state.aiToken;
  setText('pdAiSummary', 'Running ChatGPT 5 valuation…');
  try {
    const payload = await fetchJson('/api/intelligence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        timeframe: state.timeframe,
        model: AI_DEFAULT_MODEL,
        metrics: research.metrics,
        snapshots: research.snapshots,
        events: (research.events || []).slice(0, 12),
        filings: (research.filings || []).slice(0, 8),
        insights: (research.insights || []).slice(0, 10),
        levels: research.levels,
        riskMetrics: research.riskMetrics,
        comparables: research.comparables,
      }),
    });
    if (token !== state.aiToken) return;
    state.ai = payload;
    updateAiPanels(payload, research);
    if (payload?.warning) setStatus(payload.warning, 'warn');
  } catch (error) {
    if (token !== state.aiToken) return;
    console.error('AI analysis failed', error);
    setStatus(`AI analysis unavailable: ${error.message || error}`, 'warn');
    state.ai = null;
    updateAiPanels(null, research);
  }
}

async function setSymbol(symbol, options = {}) {
  const normalized = (symbol || '').trim().toUpperCase() || DEFAULT_SYMBOL;
  if (!options.force && normalized === state.symbol && state.research) {
    loadPriceSeries(normalized, state.timeframe, state.loadingToken);
    if (document.getElementById('pdAiSummary')) runAiAnalysis(normalized, state.research);
    return;
  }
  state.symbol = normalized;
  state.loadingToken += 1;
  const token = state.loadingToken;
  setStatus(`Loading ${normalized}…`, 'info');
  try {
    const research = await fetchResearch(normalized);
    if (token !== state.loadingToken) return;
    state.research = research;
    updateOverview(research);
    renderSnapshots(research);
    updateInsights(research);
    updateLevels(research);
    updateEvents(research);
    updateFilings(research);
    updateRiskMetrics(research);
    updateComparables(research, state.ai);
    updateScenarioTable(research);
    updateAiPanels(state.ai, research);
    updateFairValue(state.ai, research);
    await loadPriceSeries(normalized, state.timeframe, token);
    if (document.getElementById('pdAiSummary')) runAiAnalysis(normalized, research);
  } catch (error) {
    if (token !== state.loadingToken) return;
    console.error('Failed to load research', error);
    setStatus(`Unable to load ${normalized}: ${error.message || error}`, 'error');
  }
}

function bindTimeframes() {
  const container = document.getElementById('pdTimeframes');
  if (!container) return;
  container.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-tf]');
    if (!button) return;
    const tf = button.dataset.tf;
    if (!TIMEFRAMES[tf]) return;
    state.timeframe = tf;
    updateTimeframeButtons(tf);
    loadPriceSeries(state.symbol, tf, state.loadingToken);
  });
}

function bindRefresh() {
  const btn = document.getElementById('pdRefreshButton');
  if (btn) {
    btn.addEventListener('click', () => setSymbol(state.symbol, { force: true }));
  }
  const aiBtn = document.getElementById('pdRunAiButton');
  if (aiBtn) {
    aiBtn.addEventListener('click', () => {
      if (state.research) runAiAnalysis(state.symbol, state.research);
    });
  }
}

function init() {
  ensureSymbolsLoaded();
  bindSearchComponents();
  bindTimeframes();
  bindRefresh();
  updateTimeframeButtons(state.timeframe);
  setSymbol(state.symbol, { force: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
