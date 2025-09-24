import {
  debounce,
  searchSymbols,
  renderSearchResults,
  loadFundamentals,
  runAiAnalyst,
  formatCurrency,
  formatPercent,
  formatNumber,
  scoreToLabel,
  momentumToLabel,
  computePortfolioStats,
  renderPortfolioStats,
  uniqSymbols,
  safeArray,
} from './ai-utils.js';

const dom = {
  searchInput: document.getElementById('screenerSearch'),
  searchResults: document.getElementById('screenerSearchResults'),
  exchangeSelect: document.getElementById('screenerExchange'),
  minCap: document.getElementById('screenerMinCap'),
  maxPe: document.getElementById('screenerMaxPe'),
  minYield: document.getElementById('screenerMinYield'),
  momentumWindow: document.getElementById('screenerMomentumWindow'),
  runButton: document.getElementById('screenerRun'),
  clearButton: document.getElementById('screenerClear'),
  status: document.getElementById('screenerStatus'),
  tableBody: document.querySelector('#screenerTable tbody'),
  universeStatus: document.getElementById('screenerUniverseStatus'),
  portfolioStatus: document.getElementById('screenerPortfolioStatus'),
  portfolioStats: document.getElementById('screenerPortfolioStats'),
  aiStatus: document.getElementById('screenerAiStatus'),
  aiOutput: document.getElementById('screenerAiOutput'),
  aiRun: document.getElementById('screenerAiRun'),
};

const state = {
  selections: new Map(),
  rows: [],
  lastQueryResults: [],
  aiPayload: null,
};

function updateUniverseStatus() {
  const count = state.selections.size;
  dom.universeStatus.textContent = count ? `${count} instruments selected` : 'No selections yet.';
}

function addSelection(item) {
  if (!item?.symbol) return;
  const sym = item.symbol.toUpperCase();
  if (state.selections.has(sym)) return;
  state.selections.set(sym, { symbol: sym, mic: item.mic || '', name: item.name || '' });
  updateUniverseStatus();
}

const handleSearch = debounce(async () => {
  const query = dom.searchInput.value.trim();
  if (!query) {
    dom.searchResults.innerHTML = '';
    return;
  }
  dom.searchResults.innerHTML = '<div class="ai-status">Scanning universe…</div>';
  const exchange = dom.exchangeSelect.value;
  const matches = await searchSymbols(query, { exchange, limit: 30 });
  state.lastQueryResults = matches;
  renderSearchResults(dom.searchResults, matches, (item) => {
    addSelection(item);
    dom.searchResults.innerHTML = '';
    dom.searchInput.value = '';
  });
}, 240);

dom.searchInput.addEventListener('input', handleSearch);
dom.exchangeSelect.addEventListener('change', () => {
  if (dom.searchInput.value) handleSearch();
});

dom.clearButton.addEventListener('click', () => {
  state.selections.clear();
  state.rows = [];
  state.aiPayload = null;
  dom.tableBody.innerHTML = '';
  dom.aiOutput.textContent = 'Load a watchlist to draft a multi-asset playbook. The AI will rank opportunities, highlight event risk and flag dislocations.';
  dom.aiStatus.textContent = 'Ready';
  renderPortfolioStats(dom.portfolioStats, []);
  updateUniverseStatus();
});

function buildFilters() {
  return {
    minCap: Number(dom.minCap.value) || 0,
    maxPe: Number(dom.maxPe.value) || Number.POSITIVE_INFINITY,
    minYield: (Number(dom.minYield.value) || 0) / 100,
    momentumWindow: Number(dom.momentumWindow.value) || 63,
  };
}

function applyFilters(rows, filters) {
  return rows.filter((row) => {
    if (filters.minCap && (row.marketCapUsd ?? 0) < filters.minCap * 1_000_000) return false;
    if (Number.isFinite(filters.maxPe) && filters.maxPe > 0) {
      const forwardPe = row.metrics?.forwardPe ?? row.metrics?.pe ?? Infinity;
      if (forwardPe > filters.maxPe) return false;
    }
    if (filters.minYield && (row.dividendYield ?? 0) < filters.minYield) return false;
    return true;
  });
}

function renderRows(rows) {
  dom.tableBody.innerHTML = '';
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 9;
    td.className = 'ai-status';
    td.textContent = 'No matches for the current filters.';
    tr.appendChild(td);
    dom.tableBody.appendChild(tr);
    return;
  }
  const fragment = document.createDocumentFragment();
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const cells = [
      row.symbol,
      row.name || '—',
      formatCurrency(row.price, row.currency || 'USD'),
      row.valuations?.fairValue ? `${formatCurrency(row.valuations.fairValue, row.currency || 'USD')} (${formatPercent(row.upside ?? 0, 1)})` : '—',
      `${formatNumber(row.qualityScore ?? 0, { maximumFractionDigits: 0 })} (${scoreToLabel(row.qualityScore)})`,
      `${formatNumber(row.momentumScore ?? 0, { maximumFractionDigits: 0 })} (${momentumToLabel(row.momentumScore)})`,
      formatPercent(row.dividendYield ?? 0, 2),
      formatNumber(row.compositeScore ?? 0, { maximumFractionDigits: 1 }),
    ];
    cells.forEach((value) => {
      const td = document.createElement('td');
      td.textContent = value;
      tr.appendChild(td);
    });
    const actionTd = document.createElement('td');
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove';
    removeBtn.className = 'ai-button';
    removeBtn.style.background = 'rgba(248,113,113,0.2)';
    removeBtn.style.color = '#f87171';
    removeBtn.style.boxShadow = 'none';
    removeBtn.addEventListener('click', () => {
      state.selections.delete(row.symbol);
      updateUniverseStatus();
      runScreen();
    });
    actionTd.appendChild(removeBtn);
    tr.appendChild(actionTd);
    fragment.appendChild(tr);
  });
  dom.tableBody.appendChild(fragment);
}

async function runScreen() {
  if (!state.selections.size && !state.lastQueryResults.length) {
    dom.status.textContent = 'Add tickers or a query first.';
    return;
  }
  dom.status.textContent = 'Pulling Tiingo fundamentals…';
  try {
    const symbols = state.selections.size
      ? Array.from(state.selections.keys())
      : uniqSymbols(state.lastQueryResults.map((item) => item.symbol)).slice(0, 12);
    if (!symbols.length) {
      dom.status.textContent = 'No symbols available for screening.';
      return;
    }
    const fundamentals = await loadFundamentals(symbols, { exchange: dom.exchangeSelect.value });
    const rows = applyFilters(safeArray(fundamentals?.data), buildFilters())
      .map((row) => ({
        ...row,
        upside: row.valuations?.upside ?? 0,
        compositeScore: row.compositeScore ?? ((row.qualityScore ?? 0) * 0.6 + (row.momentumScore ?? 0) * 0.4) / 1,
      }))
      .sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0));
    state.rows = rows;
    renderRows(rows);
    renderPortfolioStats(dom.portfolioStats, computePortfolioStats(rows));
    dom.portfolioStatus.textContent = rows.length ? `${rows.length} candidates` : 'Awaiting dataset…';
    dom.status.textContent = fundamentals?.warning ? `Warning: ${fundamentals.warning}` : 'Screen complete';
    state.aiPayload = {
      mode: 'screen',
      universe: rows.map((row) => ({
        symbol: row.symbol,
        name: row.name,
        currency: row.currency,
        price: row.price,
        fairValue: row.valuations?.fairValue,
        upside: row.upside,
        qualityScore: row.qualityScore,
        momentumScore: row.momentumScore,
        dividendYield: row.dividendYield,
        events: row.events?.slice?.(0, 3) || [],
      })),
      filters: buildFilters(),
    };
  } catch (error) {
    console.error('Screen failed', error);
    dom.status.textContent = 'Screen failed. Verify Tiingo configuration.';
  }
}

dom.runButton.addEventListener('click', runScreen);

dom.aiRun.addEventListener('click', async () => {
  if (!state.aiPayload || !state.rows.length) {
    dom.aiStatus.textContent = 'Add instruments and run the screen first.';
    return;
  }
  dom.aiStatus.textContent = 'Requesting ChatGPT 5 playbook…';
  dom.aiStatus.className = 'ai-status';
  try {
    const response = await runAiAnalyst(state.aiPayload);
    dom.aiOutput.textContent = response?.content || 'AI analyst produced no output.';
    dom.aiStatus.textContent = response?.model ? `Model: ${response.model}` : 'ChatGPT 5 playbook ready';
    if (response?.warning) {
      dom.aiStatus.textContent = `⚠️ ${response.warning}`;
      dom.aiStatus.className = 'ai-status error';
    }
  } catch (error) {
    dom.aiOutput.textContent = 'AI playbook unavailable. Configure OPENAI_API_KEY to enable insights.';
    dom.aiStatus.textContent = 'AI offline';
    dom.aiStatus.className = 'ai-status error';
  }
});

updateUniverseStatus();
