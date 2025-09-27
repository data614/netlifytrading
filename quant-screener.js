import normalizeAiAnalystPayload from './utils/ai-analyst-normalizer.js';
import { createScreenPreferenceStore } from './utils/persistent-screen-preferences.js';
import { computeRow, passesFilters, screenUniverse, suggestConcurrency } from './utils/quant-screener-core.js';
import { computeAggregateMetrics, createEmptyAggregateMetrics } from './utils/quant-screener-analytics.js';
import { createRunHistoryStore } from './utils/screen-run-history.js';
import createAsyncCache from './utils/cache.js';
import escapeHtml, { sanitizeAttribute, sanitizeText } from './utils/html-sanitizer.js';

const $ = (selector) => document.querySelector(selector);

const fmtCurrency = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
};

const fmtCompactCurrency = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 2,
  });
};

const fmtPercent = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num > 0 ? '+' : ''}${num.toFixed(1)}%`;
};

const fmtCount = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString();
};

const HEATMAP_LIMIT = 18;

const clamp = (value, min, max) => {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const blendChannel = (start, end, ratio) => Math.round(start + (end - start) * ratio);

function computeHeatColor(value, min, max) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const low = [200, 68, 68];
  const high = [46, 163, 83];

  if (max === min) {
    const rgb = value >= 0 ? high : low;
    const background = `rgb(${rgb.join(', ')})`;
    const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
    const text = brightness < 140 ? '#f8fbff' : '#04141f';
    return { background, text };
  }

  const span = max - min;
  const ratio = clamp((value - min) / span, 0, 1);
  const rgb = [
    blendChannel(low[0], high[0], ratio),
    blendChannel(low[1], high[1], ratio),
    blendChannel(low[2], high[2], ratio),
  ];
  const background = `rgb(${rgb.join(', ')})`;
  const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
  const text = brightness < 140 ? '#f8fbff' : '#04141f';
  return { background, text };
}

const defaultUniverse = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'NFLX'];
const DEFAULT_SORT = Object.freeze({ key: 'upside', direction: 'desc' });
const DEFAULT_FILTER_INPUTS = Object.freeze({
  minUpside: '5',
  maxUpside: '',
  marketCapMin: '',
  marketCapMax: '',
  sectors: '',
  batchCap: '6',
});

let currentResults = [];
let processedRows = [];
let currentSort = { ...DEFAULT_SORT };
let isScreening = false;
let visibleRows = [];
const intelCache = createAsyncCache({ ttlMs: 5 * 60 * 1000, maxSize: 256 });
const statusLogEntries = [];

const preferenceStore = createScreenPreferenceStore({
  defaults: {
    universe: defaultUniverse.join(', '),
    filters: { ...DEFAULT_FILTER_INPUTS },
    sort: DEFAULT_SORT,
  },
});

const runHistoryStore = createRunHistoryStore();
let latestMetrics = createEmptyAggregateMetrics();

const runtimeBridge = {
  getLatestMetrics: () => ({
    ...latestMetrics,
    bestUpside: latestMetrics.bestUpside ? { ...latestMetrics.bestUpside } : null,
    worstUpside: latestMetrics.worstUpside ? { ...latestMetrics.worstUpside } : null,
    bestMomentum: latestMetrics.bestMomentum ? { ...latestMetrics.bestMomentum } : null,
    sectorLeaders: latestMetrics.sectorLeaders.map((leader) => ({ ...leader })),
  }),
  getRunHistory: () => runHistoryStore.list(),
};

function publishRuntimeBridge() {
  if (typeof window === 'undefined') return;
  const namespace = window.netlifyTrading || (window.netlifyTrading = {});
  namespace.quantScreener = runtimeBridge;
}

publishRuntimeBridge();

async function fetchIntel(symbol) {
  return intelCache.get(symbol, async () => {
    const url = new URL('/api/aiAnalyst', window.location.origin);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('limit', 120);
    url.searchParams.set('priceLimit', 120);
    url.searchParams.set('timeframe', '3M');
    url.searchParams.set('newsLimit', 12);
    url.searchParams.set('documentLimit', 12);
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`Failed to analyse ${symbol}: ${response.status}`);
    }
    const body = await response.json();
    const warningHeader =
      response.headers.get('x-ai-analyst-warning')
      || response.headers.get('x-intel-warning')
      || '';
    return normalizeAiAnalystPayload(body, { warningHeader });
  });
}

function parseUniverse(raw) {
  if (!raw) return defaultUniverse;
  return raw
    .split(/[\s,]+/)
    .map((token) => token.trim().toUpperCase())
    .filter((token, index, arr) => token && arr.indexOf(token) === index);
}

function parseList(raw) {
  return (raw || '')
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readFilters() {
  const parseNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  let minUpside = parseNumber($('#upsideFilter')?.value);
  let maxUpside = parseNumber($('#upsideMaxFilter')?.value);
  let minCap = parseNumber($('#marketCapMin')?.value);
  let maxCap = parseNumber($('#marketCapMax')?.value);
  if (minUpside !== null && maxUpside !== null && maxUpside < minUpside) {
    [minUpside, maxUpside] = [maxUpside, minUpside];
  }
  if (minCap !== null && minCap < 0) minCap = 0;
  if (maxCap !== null && maxCap < 0) maxCap = 0;

  let batchCap = parseNumber($('#batchSize')?.value);
  if (!Number.isFinite(batchCap) || batchCap === null) batchCap = 6;
  batchCap = Math.max(1, Math.min(batchCap, 50));

  const sectors = parseList($('#sectorFilter')?.value).map((sector) => sector.toLowerCase());

  return {
    minUpside,
    maxUpside,
    marketCapMin: minCap !== null ? minCap * 1_000_000_000 : null,
    marketCapMax: maxCap !== null ? maxCap * 1_000_000_000 : null,
    sectors,
    batchCap,
  };
}

const readInputValue = (selector, fallback = '') => {
  const el = $(selector);
  if (!el) return fallback;
  return el.value ?? fallback;
};

const toInputString = (value) => {
  if (value === undefined || value === null) return '';
  return String(value);
};

function captureFormState() {
  return {
    universe: readInputValue('#universeInput'),
    filters: {
      minUpside: readInputValue('#upsideFilter'),
      maxUpside: readInputValue('#upsideMaxFilter'),
      marketCapMin: readInputValue('#marketCapMin'),
      marketCapMax: readInputValue('#marketCapMax'),
      sectors: readInputValue('#sectorFilter'),
      batchCap: readInputValue('#batchSize'),
    },
    sort: { ...currentSort },
  };
}

function persistPreferences(partial = {}) {
  const snapshot = captureFormState();
  const payload = {
    ...snapshot,
    ...partial,
    filters: { ...snapshot.filters, ...(partial.filters || {}) },
    sort: { ...snapshot.sort, ...(partial.sort || {}) },
  };
  preferenceStore.merge(payload);
}

function applySavedPreferences() {
  const saved = preferenceStore.load();
  const filters = saved.filters || {};
  const assign = (selector, value, fallback = '') => {
    const el = $(selector);
    if (!el) return;
    const resolved = value === undefined ? fallback : value;
    el.value = toInputString(resolved);
  };

  assign('#universeInput', saved.universe, defaultUniverse.join(', '));
  assign('#upsideFilter', filters.minUpside, DEFAULT_FILTER_INPUTS.minUpside);
  assign('#upsideMaxFilter', filters.maxUpside, DEFAULT_FILTER_INPUTS.maxUpside);
  assign('#marketCapMin', filters.marketCapMin, DEFAULT_FILTER_INPUTS.marketCapMin);
  assign('#marketCapMax', filters.marketCapMax, DEFAULT_FILTER_INPUTS.marketCapMax);
  assign('#sectorFilter', filters.sectors, DEFAULT_FILTER_INPUTS.sectors);
  assign('#batchSize', filters.batchCap, DEFAULT_FILTER_INPUTS.batchCap);

  const sort = saved.sort || {};
  if (sort.key) {
    currentSort = {
      key: sort.key,
      direction: sort.direction === 'asc' ? 'asc' : 'desc',
    };
  } else {
    currentSort = { ...DEFAULT_SORT };
  }

  return saved;
}

function renderHeatmap(rows) {
  const container = $('#heatmap');
  if (!container) return;

  container.classList.remove('is-empty');
  container.innerHTML = '';

  if (!rows.length) {
    container.classList.add('is-empty');
    container.textContent = 'Run the screener to populate aggregated intelligence.';
    return;
  }

  const numericUpsides = rows.map((row) => Number(row.upside)).filter((value) => Number.isFinite(value));
  if (!numericUpsides.length) {
    container.classList.add('is-empty');
    container.textContent = 'Upside estimates are unavailable for the current results.';
    return;
  }

  const minUpside = Math.min(...numericUpsides);
  const maxUpside = Math.max(...numericUpsides);
  const sorted = [...rows].sort((a, b) => (b.upside ?? -Infinity) - (a.upside ?? -Infinity));
  const limited = sorted.slice(0, HEATMAP_LIMIT);

  const grid = document.createElement('div');
  grid.className = 'market-radar-grid';

  limited.forEach((row, index) => {
    const cell = document.createElement('div');
    cell.className = 'market-radar-cell';
    const heat = computeHeatColor(Number(row.upside), minUpside, maxUpside);
    if (!heat) {
      cell.classList.add('is-neutral');
    } else {
      cell.style.setProperty('--heat-color', heat.background);
      cell.style.setProperty('--heat-text', heat.text);
    }
    const upsideLabel = fmtPercent(row.upside);
    const momentumLabel = fmtPercent(row.momentum);
    const rank = index + 1;
    const symbolLabel = sanitizeText(row.symbol || '—') || '—';
    const safeSymbol = escapeHtml(symbolLabel);
    const safeUpsideLabel = escapeHtml(upsideLabel);
    const safeMomentumLabel = escapeHtml(momentumLabel);
    const title = [
      symbolLabel,
      `Upside ${sanitizeText(upsideLabel)}`,
      `Momentum ${sanitizeText(momentumLabel)}`,
      `Rank ${rank}`,
    ]
      .filter(Boolean)
      .join(' · ');
    cell.setAttribute('title', sanitizeAttribute(title, { maxLength: 160 }));
    cell.innerHTML = `
      <span class="market-radar-symbol">${safeSymbol}</span>
      <span class="market-radar-metric">Upside ${safeUpsideLabel}</span>
      <span class="market-radar-details">Momentum ${safeMomentumLabel}</span>
    `;
    grid.appendChild(cell);
  });

  container.appendChild(grid);

  const legend = document.createElement('div');
  legend.className = 'market-radar-legend';
  legend.innerHTML = `
    <span class="legend-label">Low upside</span>
    <span class="legend-scale" aria-hidden="true"></span>
    <span class="legend-label">High upside</span>
  `;
  container.appendChild(legend);

  if (sorted.length > limited.length) {
    const footnote = document.createElement('div');
    footnote.className = 'market-radar-footnote';
    footnote.textContent = `Displaying top ${limited.length} of ${sorted.length} results by upside.`;
    container.appendChild(footnote);
  }
}

function renderTable(rows) {
  const tbody = $('#screenerTable tbody');
  tbody.innerHTML = '';
  visibleRows = Array.isArray(rows) ? [...rows] : [];
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const safeSymbol = escapeHtml(row.symbol || '—');
    const safeSector = escapeHtml(row.sector || '—');
    const safeMarketCap = escapeHtml(fmtCompactCurrency(row.marketCap));
    const safePrice = escapeHtml(fmtCurrency(row.price));
    const safeFairValue = escapeHtml(fmtCurrency(row.fairValue));
    const safeUpside = escapeHtml(fmtPercent(row.upside));
    const safeMomentum = escapeHtml(fmtPercent(row.momentum));
    const safeSummary = escapeHtml(row.summary || '—');
    tr.innerHTML = `
      <td>${safeSymbol}</td>
      <td>${safeSector}</td>
      <td>${safeMarketCap}</td>
      <td>${safePrice}</td>
      <td>${safeFairValue}</td>
      <td>${safeUpside}</td>
      <td>${safeMomentum}</td>
      <td class="summary-cell">${safeSummary}</td>
    `;
    tbody.appendChild(tr);
  });
  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="8" style="text-align:center; padding:1.5rem;">No tickers met the filter criteria.</td>';
    tbody.appendChild(tr);
  }
}

function renderExtrema(metrics) {
  const container = $('#insightExtrema [data-field="extrema"]');
  if (!container) return;

  container.innerHTML = '';

  if (!metrics || !metrics.count) {
    container.textContent = 'No data';
    return;
  }

  const items = [];
  if (metrics.bestUpside) {
    items.push({
      label: `${metrics.bestUpside.symbol} upside`,
      value: fmtPercent(metrics.bestUpside.value),
    });
  }
  if (metrics.worstUpside) {
    items.push({
      label: `${metrics.worstUpside.symbol} downside`,
      value: fmtPercent(metrics.worstUpside.value),
    });
  }
  if (metrics.bestMomentum) {
    items.push({
      label: `${metrics.bestMomentum.symbol} momentum`,
      value: fmtPercent(metrics.bestMomentum.value),
    });
  }

  if (!items.length) {
    container.textContent = 'No data';
    return;
  }

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'insight-extrema-row';
    const label = document.createElement('span');
    label.textContent = item.label;
    const value = document.createElement('span');
    value.textContent = item.value;
    row.append(label, value);
    container.appendChild(row);
  });
}

function renderSectorLeaders(metrics) {
  const wrapper = $('#sectorLeaders');
  const list = $('#sectorLeaderList');
  if (!wrapper || !list) return;

  list.innerHTML = '';

  if (!metrics || !metrics.count || !metrics.sectorLeaders?.length) {
    wrapper.classList.add('is-empty');
    const placeholder = document.createElement('li');
    placeholder.className = 'sector-leader-item sector-leader-placeholder';
    placeholder.textContent = 'Run the screener to discover sector trends.';
    list.appendChild(placeholder);
    return;
  }

  wrapper.classList.remove('is-empty');
  metrics.sectorLeaders.forEach((leader) => {
    const item = document.createElement('li');
    item.className = 'sector-leader-item';
    const name = document.createElement('strong');
    name.textContent = leader.name;
    const count = document.createElement('span');
    count.textContent = `${fmtCount(leader.count)} tickers`;
    const weight = document.createElement('span');
    weight.className = 'sector-leader-weight';
    weight.textContent = leader.weight
      ? `${(leader.weight * 100).toFixed(0)}%`
      : '—';
    const upside = document.createElement('span');
    upside.textContent = leader.averageUpside !== null
      ? `Avg ${fmtPercent(leader.averageUpside)}`
      : 'Avg —';
    item.append(name, count, upside, weight);
    list.appendChild(item);
  });
}

function renderInsights(metrics) {
  const meta = $('#insightsMeta');
  const grid = $('#insightGrid');
  if (!meta || !grid) return;

  if (!metrics || !metrics.count) {
    meta.textContent = 'Awaiting results';
  } else {
    meta.textContent = `${fmtCount(metrics.count)} tickers analysed`;
  }

  const avgUpsideEl = grid.querySelector('[data-field="avgUpside"]');
  const medianUpsideEl = grid.querySelector('[data-field="medianUpside"]');
  const avgMomentumEl = grid.querySelector('[data-field="momentumAverage"]');
  const medianMomentumEl = grid.querySelector('[data-field="momentumMedian"]');
  const averageCapEl = grid.querySelector('[data-field="averageMarketCap"]');
  const totalCapEl = grid.querySelector('[data-field="totalMarketCap"]');

  const avgUpside = Number.isFinite(metrics?.avgUpside) ? metrics.avgUpside : null;
  const medianUpside = Number.isFinite(metrics?.medianUpside) ? metrics.medianUpside : null;
  const avgMomentum = Number.isFinite(metrics?.momentumAverage) ? metrics.momentumAverage : null;
  const medianMomentum = Number.isFinite(metrics?.momentumMedian) ? metrics.momentumMedian : null;
  const averageCap = Number.isFinite(metrics?.averageMarketCap) ? metrics.averageMarketCap : null;
  const totalCap = Number.isFinite(metrics?.totalMarketCap) ? metrics.totalMarketCap : null;

  if (avgUpsideEl) avgUpsideEl.textContent = fmtPercent(avgUpside);
  if (medianUpsideEl) medianUpsideEl.textContent = `Median ${fmtPercent(medianUpside)}`;
  if (avgMomentumEl) avgMomentumEl.textContent = fmtPercent(avgMomentum);
  if (medianMomentumEl) medianMomentumEl.textContent = `Median ${fmtPercent(medianMomentum)}`;
  if (averageCapEl) averageCapEl.textContent = fmtCompactCurrency(averageCap);
  if (totalCapEl) totalCapEl.textContent = `Total ${fmtCompactCurrency(totalCap)}`;

  renderExtrema(metrics);
  renderSectorLeaders(metrics);
}

function formatDuration(durationMs) {
  const num = Number(durationMs);
  if (!Number.isFinite(num) || num < 0) return '—';
  if (num < 1_000) return `${Math.round(num)} ms`;
  if (num < 60_000) {
    const seconds = num / 1_000;
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  }
  const minutes = Math.floor(num / 60_000);
  const seconds = Math.round((num % 60_000) / 1_000);
  const paddedSeconds = String(seconds).padStart(2, '0');
  return `${minutes}m ${paddedSeconds}s`;
}

function formatTimestamp(timestamp) {
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  });
}

function renderRunHistory(entries) {
  const container = $('#runHistory');
  if (!container) return;

  container.innerHTML = '';
  container.classList.remove('is-empty');

  if (!entries.length) {
    container.classList.add('is-empty');
    const placeholder = document.createElement('p');
    placeholder.className = 'status-log-placeholder';
    placeholder.textContent = 'Run the screener to build history.';
    container.appendChild(placeholder);
    return;
  }

  const fragment = document.createDocumentFragment();
  entries.forEach((entry) => {
    const card = document.createElement('article');
    card.className = 'history-entry';
    card.dataset.timestamp = String(entry.timestamp);

    const header = document.createElement('div');
    header.className = 'history-entry-header';
    const title = document.createElement('div');
    title.className = 'history-entry-title';
    title.textContent = formatTimestamp(entry.timestamp);
    header.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'history-entry-actions';
    const applyButton = document.createElement('button');
    applyButton.type = 'button';
    applyButton.dataset.action = 'apply';
    applyButton.dataset.timestamp = String(entry.timestamp);
    applyButton.innerHTML = '<i class="fa-solid fa-arrow-rotate-right"></i> Apply filters';
    actions.appendChild(applyButton);
    header.appendChild(actions);
    card.appendChild(header);

    const meta = document.createElement('div');
    meta.className = 'history-entry-meta';
    const stats = [
      `${fmtCount(entry.universeCount)} in universe`,
      `${fmtCount(entry.matches)} matches`,
      `Duration ${formatDuration(entry.durationMs)}`,
    ];
    if (entry.reachedCap) {
      stats.push('Reached batch cap');
    }
    if (entry.errorCount) {
      stats.push(`${fmtCount(entry.errorCount)} errors`);
    }
    stats.forEach((label) => {
      const span = document.createElement('span');
      span.textContent = label;
      meta.appendChild(span);
    });
    card.appendChild(meta);

    if (entry.filters?.sectors?.length) {
      const sectorNote = document.createElement('div');
      sectorNote.className = 'history-entry-meta';
      const span = document.createElement('span');
      span.textContent = `Sectors: ${entry.filters.sectors.join(', ')}`;
      sectorNote.appendChild(span);
      card.appendChild(sectorNote);
    }

    fragment.appendChild(card);
  });

  container.appendChild(fragment);
}

function renderStatusLog() {
  const container = $('#statusLog');
  if (!container) return;

  container.innerHTML = '';
  container.classList.remove('is-empty');

  if (!statusLogEntries.length) {
    container.classList.add('is-empty');
    const placeholder = document.createElement('p');
    placeholder.className = 'status-log-placeholder';
    placeholder.textContent = 'Run the screener to start logging activity.';
    container.appendChild(placeholder);
    return;
  }

  const fragment = document.createDocumentFragment();
  statusLogEntries.forEach((entry) => {
    const row = document.createElement('div');
    row.className = `status-log-entry ${entry.tone}`;
    const time = document.createElement('time');
    time.dateTime = new Date(entry.timestamp).toISOString();
    time.textContent = new Date(entry.timestamp).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const message = document.createElement('span');
    message.textContent = entry.message;
    row.append(time, message);
    fragment.appendChild(row);
  });

  container.appendChild(fragment);
}

function recordStatus(message, tone) {
  statusLogEntries.unshift({
    message,
    tone,
    timestamp: Date.now(),
  });
  while (statusLogEntries.length > 40) {
    statusLogEntries.pop();
  }
  renderStatusLog();
}

function sortResults(rows, key, direction) {
  const sorted = [...rows].sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    if (Number.isFinite(va) && Number.isFinite(vb)) {
      return direction === 'asc' ? va - vb : vb - va;
    }
    return String(va || '').localeCompare(String(vb || '')) * (direction === 'asc' ? 1 : -1);
  });
  return sorted;
}

function applyFilters({ silent = false } = {}) {
  if (!processedRows.length) return;
  const filters = readFilters();
  const matches = [];
  for (const row of processedRows) {
    if (passesFilters(row, filters)) {
      matches.push(row);
      if (matches.length >= filters.batchCap) break;
    }
  }
  currentResults = matches;
  const sorted = sortResults(currentResults, currentSort.key, currentSort.direction);
  renderTable(sorted);
  updateSummary(sorted);
  renderHeatmap(sorted);
  if (!silent) {
    setStatus(`${sorted.length} matches after applying filters.`, sorted.length ? 'info' : 'error');
  }
}

function assignSummaryChipDataset(chip, metrics) {
  const assign = (key, value) => {
    if (value === null || value === undefined || Number.isNaN(value)) {
      delete chip.dataset[key];
      return;
    }
    chip.dataset[key] = typeof value === 'number' ? String(value) : String(value);
  };

  assign('count', metrics.count ?? 0);
  assign('avgUpside', metrics.avgUpside);
  assign('medianUpside', metrics.medianUpside);
  assign('positiveUpsideCount', metrics.positiveUpsideCount ?? 0);
  assign('negativeUpsideCount', metrics.negativeUpsideCount ?? 0);
  assign('zeroUpsideCount', metrics.zeroUpsideCount ?? 0);
  assign('totalMarketCap', metrics.totalMarketCap);
  assign('averageMarketCap', metrics.averageMarketCap);
  assign('momentumAverage', metrics.momentumAverage);
  assign('momentumMedian', metrics.momentumMedian);

  if (metrics.bestUpside) {
    assign('bestUpsideSymbol', metrics.bestUpside.symbol);
    assign('bestUpsideValue', metrics.bestUpside.value);
  } else {
    delete chip.dataset.bestUpsideSymbol;
    delete chip.dataset.bestUpsideValue;
  }

  if (metrics.worstUpside) {
    assign('worstUpsideSymbol', metrics.worstUpside.symbol);
    assign('worstUpsideValue', metrics.worstUpside.value);
  } else {
    delete chip.dataset.worstUpsideSymbol;
    delete chip.dataset.worstUpsideValue;
  }

  if (metrics.bestMomentum) {
    assign('bestMomentumSymbol', metrics.bestMomentum.symbol);
    assign('bestMomentumValue', metrics.bestMomentum.value);
  } else {
    delete chip.dataset.bestMomentumSymbol;
    delete chip.dataset.bestMomentumValue;
  }

  if (metrics.sectorLeaders && metrics.sectorLeaders.length) {
    assign(
      'topSectors',
      JSON.stringify(
        metrics.sectorLeaders.map((leader) => ({
          name: leader.name,
          count: leader.count,
          weight: leader.weight,
          averageUpside: leader.averageUpside,
        }))
      )
    );
  } else {
    delete chip.dataset.topSectors;
  }
}

function updateSummary(rows) {
  const chip = $('#summaryChip');
  if (!chip) return;

  latestMetrics = computeAggregateMetrics(rows);
  assignSummaryChipDataset(chip, latestMetrics);
  renderInsights(latestMetrics);

  if (!rows.length) {
    chip.textContent = '0 matches';
    publishRuntimeBridge();
    return;
  }

  const avgUpsideDisplay = Number.isFinite(latestMetrics.avgUpside) ? latestMetrics.avgUpside : 0;
  chip.textContent = `${rows.length} matches · Avg upside ${fmtPercent(avgUpsideDisplay)}`;
  publishRuntimeBridge();
}

function setStatus(message, tone = 'info') {
  const el = $('#screenStatus');
  if (!el) return;
  el.textContent = message;
  el.className = `status-message ${tone}`;
  recordStatus(message, tone);
}

async function runScreen() {
  if (isScreening) return;
  const raw = $('#universeInput').value.trim();
  const universe = parseUniverse(raw);
  const filters = readFilters();
  const batchCap = filters.batchCap;
  if (!universe.length) {
    setStatus('Universe is empty. Provide at least one ticker.', 'error');
    return;
  }

  isScreening = true;
  processedRows = [];
  currentResults = [];
  renderTable([]);
  renderHeatmap([]);
  updateSummary([]);
  setStatus(`Screening ${universe.length} tickers using ChatGPT‑5…`, 'info');

  persistPreferences();

  const concurrency = suggestConcurrency(universe.length);
  const startTime = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

  const { matches, processed, reachedCap, errors } = await screenUniverse(universe, {
    fetchIntel,
    computeRow,
    passesFilters: (row) => passesFilters(row, filters),
    filters,
    batchCap,
    concurrency,
    onItemComplete: ({
      symbol,
      row,
      passes,
      processedCount,
      total: totalSymbols,
      matchesCount,
      reachedCap: capReached,
    }) => {
      processedRows.push(row);
      if (!passes) {
        setStatus(`Processed ${processedCount}/${totalSymbols}. ${symbol} filtered out by criteria.`, 'info');
        return;
      }

      currentResults.push(row);
      const sorted = sortResults(currentResults, currentSort.key, currentSort.direction);
      renderTable(sorted);
      updateSummary(sorted);
      renderHeatmap(sorted);
      if (capReached) {
        setStatus(`Reached batch cap of ${batchCap} tickers.`, 'success');
      } else {
        setStatus(`Processed ${processedCount}/${totalSymbols}. ${matchesCount} matches so far.`, 'info');
      }
    },
    onError: ({ symbol, error, processedCount, total: totalSymbols }) => {
      console.error(error);
      const message = error?.message || 'Unknown error';
      setStatus(`Error processing ${symbol} (${processedCount}/${totalSymbols}): ${message}`, 'error');
    },
  });

  processedRows = processed;
  currentResults = matches;
  isScreening = false;

  applyFilters({ silent: true });
  const latestFilters = readFilters();

  const finishedTime = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
  const durationMs = finishedTime - startTime;
  const normalizedDuration = Number.isFinite(durationMs) ? Math.round(durationMs) : null;
  const runTimestamp = Date.now();
  persistPreferences({
    lastRun: {
      timestamp: runTimestamp,
      universeCount: universe.length,
      matchesCount: currentResults.length,
      reachedCap,
      durationMs: normalizedDuration,
    },
  });

  runHistoryStore.record({
    timestamp: runTimestamp,
    universeCount: universe.length,
    matches: currentResults.length,
    durationMs: normalizedDuration,
    reachedCap,
    errorCount: Array.isArray(errors) ? errors.length : 0,
    filters: latestFilters,
    sort: currentSort,
    universeSample: universe,
    metrics: latestMetrics,
  });
  renderRunHistory(runHistoryStore.list());
  publishRuntimeBridge();

  if (!currentResults.length) {
    renderHeatmap([]);
    updateSummary([]);
    setStatus('Screen complete. No tickers satisfied the filters.', 'error');
    return;
  }

  if (currentResults.length >= latestFilters.batchCap) {
    setStatus(`Reached batch cap of ${latestFilters.batchCap} tickers.`, 'success');
  } else {
    setStatus(`Screen complete. ${currentResults.length} matches within filters.`, 'success');
  }
}

function attachSortHandlers() {
  const headers = document.querySelectorAll('.screener-table th');
  headers.forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (!key) return;
      currentSort = {
        key,
        direction: currentSort.key === key && currentSort.direction === 'desc' ? 'asc' : 'desc',
      };
      const sorted = sortResults(currentResults, currentSort.key, currentSort.direction);
      renderTable(sorted);
      updateSummary(sorted);
      renderHeatmap(sorted);
      persistPreferences({ sort: currentSort });
    });
  });
}

function registerFilterControls() {
  const numericSelectors = ['#upsideFilter', '#upsideMaxFilter', '#marketCapMin', '#marketCapMax', '#batchSize'];
  numericSelectors.forEach((selector) => {
    const el = $(selector);
    if (!el) return;
    el.addEventListener('change', () => {
      persistPreferences();
      if (isScreening || !processedRows.length) return;
      applyFilters();
    });
  });

  const sectorInput = $('#sectorFilter');
  if (sectorInput) {
    sectorInput.addEventListener('change', () => {
      persistPreferences();
      if (isScreening || !processedRows.length) return;
      applyFilters();
    });
    sectorInput.addEventListener('input', () => {
      if (isScreening || !processedRows.length) return;
      applyFilters({ silent: true });
    });
  }
}

function toBillions(value) {
  if (!Number.isFinite(value)) return '';
  const billions = value / 1_000_000_000;
  if (Number.isInteger(billions)) return String(billions);
  if (Math.abs(billions) < 1) return billions.toFixed(2);
  return billions.toFixed(1);
}

function applyHistoryEntry(entry) {
  if (!entry) return;

  const filters = entry.filters || {};
  const assign = (selector, value) => {
    const el = $(selector);
    if (!el) return;
    el.value = value ?? '';
  };

  assign('#universeInput', entry.universeSample?.join(', ') || '');
  assign('#upsideFilter', filters.minUpside ?? '');
  assign('#upsideMaxFilter', filters.maxUpside ?? '');
  assign('#marketCapMin', filters.marketCapMin !== null ? toBillions(filters.marketCapMin) : '');
  assign('#marketCapMax', filters.marketCapMax !== null ? toBillions(filters.marketCapMax) : '');
  assign('#batchSize', filters.batchCap ?? '');
  assign('#sectorFilter', Array.isArray(filters.sectors) ? filters.sectors.join(', ') : '');

  currentSort = {
    key: entry.sort?.key || currentSort.key,
    direction: entry.sort?.direction === 'asc' ? 'asc' : 'desc',
  };

  persistPreferences({
    universe: $('#universeInput')?.value || '',
    filters: {
      minUpside: $('#upsideFilter')?.value || '',
      maxUpside: $('#upsideMaxFilter')?.value || '',
      marketCapMin: $('#marketCapMin')?.value || '',
      marketCapMax: $('#marketCapMax')?.value || '',
      sectors: $('#sectorFilter')?.value || '',
      batchCap: $('#batchSize')?.value || '',
    },
    sort: currentSort,
  });

  if (!isScreening && processedRows.length) {
    applyFilters();
  }

  setStatus(`Restored filters from ${formatTimestamp(entry.timestamp)}.`, 'info');
}

function downloadCsv() {
  const source = visibleRows.length ? visibleRows : currentResults;
  if (!source.length) {
    setStatus('No table data available to export yet.', 'error');
    return;
  }
  const header = ['Symbol', 'Sector', 'MarketCap', 'Price', 'FairValue', 'Upside', 'Momentum', 'Summary'];
  const lines = source.map((row) => [
    row.symbol,
    row.sector || '',
    Number.isFinite(row.marketCap) ? row.marketCap : '',
    row.price ?? '',
    row.fairValue ?? '',
    row.upside ?? '',
    row.momentum ?? '',
    (row.summary || '').replace(/"/g, "'"),
  ]);
  const csv = [header, ...lines].map((line) => line.map((item) => `"${item}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ai-quant-screener.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  setStatus(`CSV exported with ${source.length} row${source.length === 1 ? '' : 's'}.`, 'success');
}

function init() {
  applySavedPreferences();
  $('#runScreen').addEventListener('click', () => {
    runScreen();
  });
  $('#downloadCsv').addEventListener('click', () => downloadCsv());
  attachSortHandlers();
  registerFilterControls();
  const universeInput = $('#universeInput');
  if (universeInput) {
    universeInput.addEventListener('change', () => persistPreferences());
    universeInput.addEventListener('blur', () => persistPreferences());
  }
  renderHeatmap([]);
  updateSummary([]);
  persistPreferences();
  renderInsights(createEmptyAggregateMetrics());
  renderRunHistory(runHistoryStore.list());
  renderStatusLog();

  const historyContainer = $('#runHistory');
  if (historyContainer) {
    historyContainer.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action="apply"]');
      if (!button) return;
      const timestamp = Number(button.dataset.timestamp);
      if (!Number.isFinite(timestamp)) return;
      const entry = runHistoryStore.list().find((candidate) => candidate.timestamp === timestamp);
      if (!entry) return;
      applyHistoryEntry(entry);
    });
  }

  const clearHistoryButton = $('#clearRunHistory');
  if (clearHistoryButton) {
    clearHistoryButton.addEventListener('click', () => {
      runHistoryStore.clear();
      renderRunHistory([]);
      setStatus('Run history cleared.', 'warning');
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
