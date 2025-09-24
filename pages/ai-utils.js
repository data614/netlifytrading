const NETLIFY_BASE = '/.netlify/functions';

export const endpoints = {
  search: `${NETLIFY_BASE}/search`,
  tiingo: `${NETLIFY_BASE}/tiingo`,
  fundamentals: `${NETLIFY_BASE}/tiingo-fundamentals`,
  aiAnalyst: `${NETLIFY_BASE}/ai-analyst`,
};

export function debounce(fn, wait = 220) {
  let timeout = 0;
  return (...args) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

export const formatCurrency = (value, currency = 'USD', options = {}) => {
  if (value == null || Number.isNaN(value)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: options.maximumFractionDigits ?? 2,
      minimumFractionDigits: options.minimumFractionDigits ?? 0,
    }).format(value);
  } catch (err) {
    return `${currency} ${value.toFixed(options.maximumFractionDigits ?? 2)}`;
  }
};

export const formatNumber = (value, options = {}) => {
  if (value == null || Number.isNaN(value)) return '—';
  const formatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
    notation: options.notation,
  });
  return formatter.format(value);
};

export const formatPercent = (value, digits = 2) => {
  if (value == null || Number.isNaN(value)) return '—';
  const percent = value * 100;
  const formatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: Math.min(2, digits),
  });
  return `${percent >= 0 ? '+' : ''}${formatter.format(percent)}%`;
};

export async function fetchJson(input, init) {
  const response = await fetch(input, init);
  const text = await response.text();
  if (!text) {
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Malformed JSON response: ${text.slice(0, 160)}`);
  }
  if (!response.ok) {
    const message = parsed?.error || parsed?.message || response.statusText;
    throw new Error(message);
  }
  return parsed;
}

export async function searchSymbols(query, { exchange = '', limit = 15 } = {}) {
  const cleaned = (query || '').trim();
  if (!cleaned) return [];
  const url = new URL(endpoints.search, window.location.origin);
  url.searchParams.set('q', cleaned);
  if (exchange) url.searchParams.set('exchange', exchange);
  url.searchParams.set('limit', String(limit));
  try {
    const result = await fetchJson(url);
    return Array.isArray(result?.data) ? result.data : [];
  } catch (error) {
    console.warn('Symbol search failed', error);
    return [];
  }
}

export async function loadSeries(symbol, { kind = 'intraday', interval = '5min', limit = 78, exchange = '' } = {}) {
  const url = new URL(endpoints.tiingo, window.location.origin);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('kind', kind);
  if (interval) url.searchParams.set('interval', interval);
  if (limit) url.searchParams.set('limit', String(limit));
  if (exchange) url.searchParams.set('exchange', exchange);
  return fetchJson(url);
}

export async function loadFundamentals(symbols, { exchange = '' } = {}) {
  const list = Array.isArray(symbols) ? symbols : String(symbols || '').split(',');
  const cleaned = list.map((s) => (s || '').trim()).filter(Boolean);
  if (!cleaned.length) return { data: [] };
  const url = new URL(endpoints.fundamentals, window.location.origin);
  url.searchParams.set('symbols', cleaned.join(','));
  if (exchange) url.searchParams.set('exchange', exchange);
  return fetchJson(url);
}

export async function runAiAnalyst(payload) {
  try {
    const response = await fetch(endpoints.aiAnalyst, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!text) return { content: 'No response from AI analyst.' };
    const data = JSON.parse(text);
    return data;
  } catch (error) {
    console.warn('AI analyst call failed', error);
    return {
      content: 'AI analyst is offline. Configure OPENAI_API_KEY to enable live commentary.',
      error: String(error),
    };
  }
}

export const signalClass = (value) => {
  if (typeof value !== 'number') return '';
  if (value > 0.4) return 'ai-status ok';
  if (value < -0.2) return 'ai-status error';
  return 'ai-status';
};

export const scoreToLabel = (score) => {
  if (score == null) return '—';
  if (score >= 80) return 'Institutional grade';
  if (score >= 65) return 'High quality';
  if (score >= 50) return 'Neutral';
  if (score >= 35) return 'Watch risk';
  return 'Distressed';
};

export const momentumToLabel = (score) => {
  if (score == null) return '—';
  if (score >= 70) return 'Strong positive';
  if (score >= 55) return 'Positive drift';
  if (score >= 45) return 'Sideways';
  if (score >= 30) return 'Losing momentum';
  return 'Negative trend';
};

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function renderSearchResults(container, items, onSelect) {
  container.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'ai-status';
    empty.textContent = 'No matches';
    container.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'ai-search-result';
    const info = document.createElement('div');
    info.innerHTML = `<strong>${item.symbol}</strong><div class="ai-muted">${item.name || ''}</div>`;
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = 'Select';
    addBtn.addEventListener('click', () => onSelect(item));
    row.append(info, addBtn);
    fragment.appendChild(row);
  });
  container.appendChild(fragment);
}

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const formatDate = (input) => {
  if (!input) return '—';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export const uniqSymbols = (list) => {
  const seen = new Set();
  const out = [];
  list.forEach((item) => {
    const sym = (item.symbol || item).toUpperCase();
    if (!sym || seen.has(sym)) return;
    seen.add(sym);
    out.push(sym);
  });
  return out;
};

export const computePortfolioStats = (rows = []) => {
  if (!rows.length) return [];
  const totalWeight = rows.length;
  const avg = (key, fallback = 0) => rows.reduce((acc, row) => acc + (Number(row[key]) || fallback), 0) / totalWeight;
  const metrics = [
    {
      label: 'Average upside',
      value: formatPercent(avg('upside', 0), 1),
    },
    {
      label: 'Average quality score',
      value: formatNumber(avg('qualityScore', 0), { maximumFractionDigits: 1 }),
    },
    {
      label: 'Average momentum score',
      value: formatNumber(avg('momentumScore', 0), { maximumFractionDigits: 1 }),
    },
    {
      label: 'Median dividend yield',
      value: formatPercent(rows.map((row) => row.dividendYield || 0).sort((a, b) => a - b)[Math.floor(rows.length / 2)] || 0, 2),
    },
  ];
  return metrics;
};

export function renderPortfolioStats(container, stats) {
  container.innerHTML = '';
  if (!stats.length) {
    const empty = document.createElement('div');
    empty.className = 'ai-status';
    empty.textContent = 'No portfolio metrics calculated yet.';
    container.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  stats.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'ai-list-item';
    const label = document.createElement('div');
    label.className = 'ai-muted';
    label.textContent = item.label;
    const value = document.createElement('div');
    value.className = 'ai-metric';
    value.textContent = item.value;
    card.append(label, value);
    fragment.appendChild(card);
  });
  container.appendChild(fragment);
}
