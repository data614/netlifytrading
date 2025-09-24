import {
  searchSymbols,
  fetchCompanyIntel,
  requestAiInsight,
  formatCurrency,
  formatPercent,
  formatNumber,
  formatDate,
  debounce,
} from './apiClient.js';

const state = {
  symbol: 'AAPL',
  exchange: 'XNAS',
  scopeDays: 120,
  intel: null,
  aiInFlight: false,
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

function withinScope(dateStr) {
  if (!dateStr) return true;
  const eventDate = new Date(dateStr).getTime();
  if (Number.isNaN(eventDate)) return true;
  const cutoff = Date.now() - state.scopeDays * 24 * 60 * 60 * 1000;
  return eventDate >= cutoff;
}

function buildEventTimeline(events = []) {
  return events
    .filter((event) => withinScope(event.publishedAt))
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .map((event) => `
      <article class="pro-timeline-item">
        <div class="pro-chip-row">
          <span class="pro-chip ${event.severity || ''}">${event.type || 'Event'}</span>
          ${event.tags?.map((tag) => `<span class="pro-chip">${tag}</span>`).join('') || ''}
        </div>
        <strong>${event.headline}</strong>
        <p>${event.summary || ''}</p>
        <p class="pro-status">${formatDate(event.publishedAt)} — <a href="${event.url}" target="_blank" rel="noopener">View source</a></p>
      </article>
    `)
    .join('');
}

function buildDocumentList(documents = []) {
  return documents
    .filter((doc) => withinScope(doc.publishedAt))
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .map((doc) => `
      <article class="pro-timeline-item">
        <div class="pro-chip-row">
          <span class="pro-chip">${doc.category || 'Document'}</span>
          ${doc.tags?.map((tag) => `<span class="pro-chip">${tag}</span>`).join('') || ''}
        </div>
        <strong>${doc.title}</strong>
        <p>${doc.summary || ''}</p>
        <p class="pro-status">${formatDate(doc.publishedAt)} — <a href="${doc.url}" target="_blank" rel="noopener">Open</a></p>
      </article>
    `)
    .join('');
}

function renderMetrics(container, metrics = []) {
  if (!container) return;
  if (!metrics.length) {
    container.innerHTML = '<p class="pro-empty">No fundamentals available from Tiingo yet.</p>';
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

function buildFinancialMetrics(snapshot) {
  if (!snapshot) return [];
  return [
    { label: 'Revenue Growth', value: formatPercent(snapshot.revenueGrowth ?? 0) },
    { label: 'Gross Margin', value: formatPercent(snapshot.grossMargin ?? 0) },
    { label: 'Operating Margin', value: formatPercent(snapshot.operatingMargin ?? 0) },
    { label: 'Free Cash Flow', value: formatCurrency(snapshot.freeCashFlow ?? 0, snapshot.currency) },
    { label: 'Net Debt', value: formatCurrency(snapshot.netDebt ?? 0, snapshot.currency) },
    { label: 'Interest Coverage', value: formatNumber(snapshot.interestCoverage ?? 0, { maximumFractionDigits: 2 }) },
  ];
}

function buildValuationMetrics(valuations = {}, snapshot = {}) {
  return [
    { label: 'Intrinsic Value', value: formatCurrency(valuations.intrinsicValue ?? 0, snapshot.currency) },
    { label: 'Margin of Safety', value: formatPercent(valuations.marginOfSafety ?? 0) },
    { label: 'Forward PE', value: formatNumber(valuations.forwardPe ?? valuations.trailingPe ?? 0, { maximumFractionDigits: 1 }) },
    { label: 'Price to Sales', value: formatNumber(valuations.priceToSales ?? 0, { maximumFractionDigits: 2 }) },
    { label: 'EV / EBITDA', value: formatNumber(valuations.evToEbitda ?? 0, { maximumFractionDigits: 1 }) },
    { label: 'Risk Premium', value: formatPercent(valuations.riskPremium ?? 0) },
  ];
}

async function runAiNarrative() {
  if (state.aiInFlight) return;
  if (!state.intel) return;
  state.aiInFlight = true;
  setStatus(dom.aiSummary, 'ChatGPT-5 is synthesising the last 120 days of public intelligence…');
  dom.aiNarrative.classList.add('pro-empty');
  dom.aiNarrative.textContent = 'Generating narrative…';

  try {
    const payload = await requestAiInsight({
      symbol: state.symbol,
      timeframe: `${state.scopeDays}d-intel`,
      objectives: { focus: ['events', 'risk', 'sentiment'], directives: 'Deliver a concise intelligence brief with risk hierarchy.' },
      intel: state.intel,
      priceSummary: null,
    });
    dom.aiNarrative.classList.remove('pro-empty');
    dom.aiNarrative.innerHTML = (payload?.analysis || '').replace(/\n/g, '<br>');
    setStatus(dom.aiSummary, payload?.message || 'AI synthesis complete.', 'ok');
  } catch (err) {
    console.error(err);
    dom.aiNarrative.classList.add('pro-empty');
    dom.aiNarrative.textContent = err.message || 'Unable to synthesise intelligence.';
    setStatus(dom.aiSummary, err.message || 'AI synthesis failed.', 'error');
  } finally {
    state.aiInFlight = false;
  }
}

async function loadSymbol(symbol, opts = {}) {
  state.symbol = symbol || state.symbol;
  state.exchange = opts.exchange || state.exchange;
  setStatus(dom.status, `Loading corporate intelligence for ${state.symbol}…`);
  dom.search.value = state.symbol;
  dom.searchResults.hidden = true;
  try {
    const intel = await fetchCompanyIntel(state.symbol, state.exchange);
    state.intel = intel;
    const events = intel?.events || [];
    const documents = intel?.documents || [];
    dom.timeline.innerHTML = buildEventTimeline(events) || '<div class="pro-empty">No notable events in scope.</div>';
    dom.documents.innerHTML = buildDocumentList(documents) || '<div class="pro-empty">No high-priority filings.</div>';
    renderMetrics(dom.financials, buildFinancialMetrics(intel?.snapshot));
    renderMetrics(dom.valuation, buildValuationMetrics(intel?.valuations, intel?.snapshot));
    setStatus(dom.status, `Loaded ${state.symbol} governance stack.`, 'ok');
    runAiNarrative();
  } catch (err) {
    console.error(err);
    setStatus(dom.status, err.message || 'Unable to load company intelligence.', 'error');
  }
}

async function handleSearchInput(value) {
  const query = value.trim();
  if (!query) {
    dom.searchResults.hidden = true;
    dom.searchResults.innerHTML = '';
    return;
  }
  setStatus(dom.status, 'Querying smart symbol universe…');
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
  dom.scope.addEventListener('change', (event) => {
    state.scopeDays = Number(event.target.value) || 120;
    if (state.intel) {
      dom.timeline.innerHTML = buildEventTimeline(state.intel.events) || '<div class="pro-empty">No notable events in scope.</div>';
      dom.documents.innerHTML = buildDocumentList(state.intel.documents) || '<div class="pro-empty">No high-priority filings.</div>';
    }
  });
}

function captureDom() {
  dom.search = $('intelSearch');
  dom.searchResults = $('intelSearchResults');
  dom.status = $('intelStatus');
  dom.timeline = $('intelTimeline');
  dom.documents = $('intelDocuments');
  dom.financials = $('intelFinancials');
  dom.valuation = $('intelValuation');
  dom.scope = $('intelScope');
  dom.aiSummary = $('intelAiSummary');
  dom.aiNarrative = $('intelAiNarrative');
}

async function bootstrap() {
  captureDom();
  attachListeners();
  await loadSymbol(state.symbol, { exchange: state.exchange });
}

document.addEventListener('DOMContentLoaded', bootstrap);

