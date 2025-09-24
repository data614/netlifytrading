import { getTiingoToken } from './lib/env.js';

const corsHeaders = { 'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*' };
const API_BASE = 'https://api.tiingo.com/';

const FALLBACK_SAMPLE = {
  symbol: 'AAPL',
  asOf: '2024-03-31',
  valuations: {
    dcf: {
      fairValue: 210,
      low: 185,
      high: 235,
      discountRate: 0.082,
      terminalGrowth: 0.025,
      growthRate: 0.07,
      horizonYears: 5,
    },
    multiples: {
      fairValue: 205,
      low: 190,
      high: 220,
      notes: 'Blend of megacap tech peers (MSFT, GOOGL, NVDA).',
    },
    blended: {
      fairValue: 208,
      low: 190,
      high: 228,
      confidence: 0.68,
      qualityScore: 86,
      rationale: 'Strong FCF durability, net cash balance sheet, resilient demand cycle.',
    },
  },
  metrics: {
    marketCap: 3.1e12,
    enterpriseValue: 3.0e12,
    sharesOutstanding: 15.7e9,
    revenue: 3.83e11,
    revenueGrowth: 0.06,
    netIncome: 9.65e10,
    eps: 6.1,
    freeCashFlow: 9.8e10,
    freeCashFlowMargin: 0.26,
    dividendYield: 0.005,
    roe: 0.32,
    roic: 0.29,
    debtToEquity: 1.5,
  },
  table: [
    { metric: 'Revenue (TTM)', value: '$383.0B', trend: '3y CAGR 6%' },
    { metric: 'Net income (TTM)', value: '$96.5B', trend: 'Margin 25%' },
    { metric: 'Free cash flow', value: '$98.0B', trend: 'FCF margin 26%' },
    { metric: 'ROIC', value: '29%', trend: 'Top decile vs S&P500' },
    { metric: 'Net debt', value: '$60.0B', trend: 'Comfortable coverage' },
    { metric: 'Dividend yield', value: '0.5%', trend: '10y growth 7%' },
  ],
  assumptions: [
    'DCF uses 7% FCF CAGR for five years with 8.2% discount rate and 2.5% terminal growth.',
    'Peer multiples anchored to megacap software/hardware blend to reflect Apple mix.',
    'Quality score emphasises ROIC, FCF conversion, and leverage profile.',
  ],
  qualityNarrative: 'Balance sheet resilience and dominant ecosystem support a premium multiple.',
  fallback: true,
  warning: 'Tiingo API key missing — using illustrative fundamentals.',
};

const toNumber = (value) => {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const sortByDate = (rows = []) => [...rows].filter(Boolean).sort((a, b) => {
  const da = new Date(a?.date || a?.statementDate || 0).getTime();
  const db = new Date(b?.date || b?.statementDate || 0).getTime();
  return da - db;
});

const readNumber = (row, keys = []) => {
  for (const key of keys) {
    if (row && row[key] != null) {
      const num = toNumber(row[key]);
      if (num != null) return num;
    }
  }
  return null;
};

const computeCagr = (series = []) => {
  const cleaned = series.filter((item) => item && item.value != null && Number.isFinite(item.value));
  if (cleaned.length < 2) return null;
  const first = cleaned[0];
  const last = cleaned[cleaned.length - 1];
  const firstDate = new Date(first.date || first.statementDate || 0);
  const lastDate = new Date(last.date || last.statementDate || 0);
  const years = Math.max((lastDate - firstDate) / (365.25 * 24 * 60 * 60 * 1000), 0.5);
  if (!Number.isFinite(years) || years <= 0) return null;
  if (!first.value || !last.value) return null;
  return (last.value / first.value) ** (1 / years) - 1;
};

const formatCurrency = (value, currency = 'USD', digits = 1) => {
  if (value == null || !Number.isFinite(value)) return '—';
  const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: digits });
  return formatter.format(value);
};

const formatPercent = (value, digits = 1) => {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
};

async function fetchTiingo(path, params, token) {
  const url = new URL(path, API_BASE);
  url.searchParams.set('token', token);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, value);
  });
  const response = await fetch(url);
  const text = await response.text();
  let data = [];
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      if (!response.ok) throw new Error(`Tiingo ${response.status}: ${text.slice(0, 200)}`);
      throw error;
    }
  }
  if (!response.ok) {
    const detail = typeof data === 'object' && data !== null
      ? data.message || data.error || JSON.stringify(data)
      : text;
    throw new Error(`Tiingo ${response.status}: ${detail}`);
  }
  return data;
}

const buildFundamentalTable = (latest, metrics, history, currency = 'USD') => {
  const revenueRow = {
    metric: 'Revenue (TTM)',
    value: formatCurrency(metrics.revenue, currency, 0),
    trend: metrics.revenueGrowth != null ? `${formatPercent(metrics.revenueGrowth, 1)} CAGR` : '—',
  };
  const netIncomeRow = {
    metric: 'Net income (TTM)',
    value: formatCurrency(metrics.netIncome, currency, 0),
    trend: metrics.netMargin != null ? `Margin ${formatPercent(metrics.netMargin, 1)}` : '—',
  };
  const fcfRow = {
    metric: 'Free cash flow',
    value: formatCurrency(metrics.freeCashFlow, currency, 0),
    trend: metrics.freeCashFlowMargin != null ? `FCF margin ${formatPercent(metrics.freeCashFlowMargin, 1)}` : '—',
  };
  const roeRow = {
    metric: 'Return on equity',
    value: metrics.roe != null ? formatPercent(metrics.roe, 1) : '—',
    trend: metrics.roic != null ? `ROIC ${formatPercent(metrics.roic, 1)}` : '—',
  };
  const leverageRow = {
    metric: 'Leverage',
    value: metrics.debtToEquity != null ? `${metrics.debtToEquity.toFixed(2)}× D/E` : '—',
    trend: metrics.netDebt != null ? `${formatCurrency(metrics.netDebt, currency, 0)} net debt` : '—',
  };
  const dividendRow = {
    metric: 'Capital returns',
    value: metrics.dividendYield != null ? `Yield ${formatPercent(metrics.dividendYield, 2)}` : '—',
    trend: metrics.buybackYield != null ? `Buyback ${formatPercent(metrics.buybackYield, 2)}` : '—',
  };
  return [revenueRow, netIncomeRow, fcfRow, roeRow, leverageRow, dividendRow];
};

const computeDcf = (latest, history) => {
  const fcfSeries = history.map((row) => ({ date: row.date, value: readNumber(row, ['freeCashFlow', 'freeCashflow', 'freeCashFlowTtm', 'freeCashFlowTTM']) || null }));
  const growth = computeCagr(fcfSeries.filter((row) => row.value != null)) ?? 0.05;
  const shares = readNumber(latest, ['sharesOutstanding', 'sharesOut', 'shares']);
  const baseFcf = readNumber(latest, ['freeCashFlow', 'freeCashflow', 'freeCashFlowTtm', 'freeCashFlowTTM']);
  const discountRate = readNumber(latest, ['wacc', 'costOfCapital', 'discountRate']) ?? 0.085;
  const terminalGrowth = readNumber(latest, ['terminalGrowth', 'longTermGrowth']) ?? 0.025;
  const debt = readNumber(latest, ['totalDebt', 'totalLiabilitiesNetMinorityInterest', 'ltDebt']) ?? 0;
  const cash = readNumber(latest, ['cashAndCashEquivalents', 'cashAndShortTermInvestments']) ?? 0;

  if (baseFcf == null || shares == null || shares <= 0) return null;

  const horizon = 5;
  const rate = Math.max(discountRate, terminalGrowth + 0.01);
  const flows = [];
  let runningFcf = baseFcf;
  for (let year = 1; year <= horizon; year += 1) {
    runningFcf *= (1 + growth);
    flows.push(runningFcf);
  }

  const presentFlows = flows.reduce((acc, flow, idx) => acc + flow / ((1 + rate) ** (idx + 1)), 0);
  const terminal = flows[flows.length - 1] * (1 + terminalGrowth) / (rate - terminalGrowth);
  const presentTerminal = terminal / ((1 + rate) ** horizon);
  const enterpriseValue = presentFlows + presentTerminal;
  const equityValue = enterpriseValue - (debt - cash);
  const perShare = equityValue / shares;

  const spread = Math.max(0.15, Math.abs(growth - terminalGrowth) * 2);
  const low = perShare * (1 - spread / 2);
  const high = perShare * (1 + spread / 2);

  return {
    fairValue: perShare,
    low,
    high,
    discountRate: rate,
    terminalGrowth,
    growthRate: growth,
    horizonYears: horizon,
  };
};

const computeMultiples = (latest, metrics) => {
  const shares = metrics.sharesOutstanding;
  if (!shares || shares <= 0) return null;
  const eps = readNumber(latest, ['eps', 'earningsPerShare', 'basicEPS', 'dilutedEPS'])
    ?? (metrics.netIncome != null ? metrics.netIncome / shares : null);
  const revenuePerShare = metrics.revenue != null ? metrics.revenue / shares : null;
  const bookValuePerShare = readNumber(latest, ['bookValuePerShare', 'bookValue'])
    ?? (metrics.shareholderEquity != null ? metrics.shareholderEquity / shares : null);
  const pe = readNumber(latest, ['peRatio', 'pe']) ?? 20;
  const ps = readNumber(latest, ['psRatio', 'ps']) ?? 5;
  const pb = readNumber(latest, ['pbRatio', 'pb']) ?? 8;

  const values = [];
  const contributions = {};
  if (eps != null) {
    const value = eps * Math.max(pe, 8);
    contributions.pe = value;
    values.push(value);
  }
  if (revenuePerShare != null) {
    const value = revenuePerShare * Math.max(ps, 2.5);
    contributions.ps = value;
    values.push(value);
  }
  if (bookValuePerShare != null) {
    const value = bookValuePerShare * Math.max(pb, 2);
    contributions.pb = value;
    values.push(value);
  }

  if (!values.length) return null;
  const fairValue = values.reduce((acc, value) => acc + value, 0) / values.length;
  const low = Math.min(...values);
  const high = Math.max(...values);
  return {
    fairValue,
    low,
    high,
    notes: `PE ${pe?.toFixed?.(1) ?? 'n/a'}, PS ${ps?.toFixed?.(1) ?? 'n/a'}, PB ${pb?.toFixed?.(1) ?? 'n/a'}`,
    contributions,
  };
};

const computeQualityScore = (metrics, growth) => {
  const growthScore = Math.max(0, Math.min(40, ((growth ?? 0.05) / 0.2) * 40));
  const profitabilityScore = Math.max(0, Math.min(35, ((metrics.roe ?? 0.18) / 0.25) * 35));
  const riskScore = Math.max(0, Math.min(25, (1 - Math.min(metrics.debtToEquity ?? 0.8, 2) / 2) * 25));
  return growthScore + profitabilityScore + riskScore;
};

const computeBlended = (dcf, multiples, metrics, growth) => {
  if (!dcf && !multiples) return null;
  const weights = { dcf: dcf ? 0.6 : 0, multiples: multiples ? 0.4 : 0 };
  const totalWeight = weights.dcf + weights.multiples;
  const fairValue = (
    (dcf?.fairValue ?? 0) * (weights.dcf / totalWeight || 0)
    + (multiples?.fairValue ?? 0) * (weights.multiples / totalWeight || 0)
  );
  const low = Math.min(dcf?.low ?? fairValue, multiples?.low ?? fairValue);
  const high = Math.max(dcf?.high ?? fairValue, multiples?.high ?? fairValue);
  const qualityScore = computeQualityScore(metrics, growth);
  const confidence = Math.min(0.9, 0.4 + (dcf ? 0.3 : 0) + (multiples ? 0.2 : 0));
  return {
    fairValue,
    low,
    high,
    confidence,
    qualityScore,
    rationale: 'Confidence driven by multi-model agreement and balance sheet resilience.',
  };
};

const normaliseFundamentals = (symbol, rows) => {
  const sorted = sortByDate(rows);
  const latest = sorted[sorted.length - 1];
  if (!latest) throw new Error('No fundamentals returned.');
  const currency = latest.currency || latest.currencyCode || 'USD';
  const metrics = {
    marketCap: readNumber(latest, ['marketCap', 'marketCapitalization']),
    enterpriseValue: readNumber(latest, ['enterpriseValue']),
    sharesOutstanding: readNumber(latest, ['sharesOutstanding', 'sharesOut', 'shares']),
    revenue: readNumber(latest, ['revenue', 'totalRevenue', 'revenues']),
    netIncome: readNumber(latest, ['netIncome', 'netIncomeCommon']),
    shareholderEquity: readNumber(latest, ['shareholderEquity', 'totalEquity']),
    freeCashFlow: readNumber(latest, ['freeCashFlow', 'freeCashflow', 'freeCashFlowTtm', 'freeCashFlowTTM']),
    dividendYield: readNumber(latest, ['dividendYield', 'dividendYieldPercent']),
    buybackYield: readNumber(latest, ['buybackYield']),
    roe: readNumber(latest, ['returnOnEquity', 'roe']),
    roic: readNumber(latest, ['returnOnInvestedCapital', 'roic']),
    debtToEquity: readNumber(latest, ['debtToEquity', 'totalDebtToEquity']) ?? null,
    totalDebt: readNumber(latest, ['totalDebt', 'ltDebt']),
    cash: readNumber(latest, ['cashAndCashEquivalents', 'cashAndShortTermInvestments']),
  };
  metrics.netMargin = metrics.netIncome != null && metrics.revenue ? metrics.netIncome / metrics.revenue : null;
  metrics.freeCashFlowMargin = metrics.freeCashFlow != null && metrics.revenue ? metrics.freeCashFlow / metrics.revenue : null;
  metrics.netDebt = metrics.totalDebt != null && metrics.cash != null ? metrics.totalDebt - metrics.cash : metrics.totalDebt ?? null;
  metrics.eps = readNumber(latest, ['eps', 'earningsPerShare', 'basicEPS', 'dilutedEPS']);

  const revenueSeries = sorted.map((row) => ({ date: row.date, value: readNumber(row, ['revenue', 'totalRevenue', 'revenues']) }));
  const fcfSeries = sorted.map((row) => ({ date: row.date, value: readNumber(row, ['freeCashFlow', 'freeCashflow', 'freeCashFlowTtm', 'freeCashFlowTTM']) }));
  const epsSeries = sorted.map((row) => ({ date: row.date, value: readNumber(row, ['eps', 'earningsPerShare', 'basicEPS', 'dilutedEPS']) }));

  metrics.revenueGrowth = computeCagr(revenueSeries);
  metrics.freeCashFlowGrowth = computeCagr(fcfSeries);
  metrics.epsGrowth = computeCagr(epsSeries);

  const dcf = computeDcf(latest, sorted);
  const multiples = computeMultiples(latest, metrics);
  const blended = computeBlended(dcf, multiples, metrics, metrics.freeCashFlowGrowth ?? metrics.revenueGrowth);

  const table = buildFundamentalTable(latest, metrics, sorted, currency);
  const assumptions = [];
  if (dcf) {
    assumptions.push(`DCF: ${formatPercent(dcf.growthRate ?? 0.05, 1)} FCF CAGR, discount ${formatPercent(dcf.discountRate ?? 0.085, 1)}, terminal ${formatPercent(dcf.terminalGrowth ?? 0.025, 1)}.`);
  }
  if (multiples) {
    assumptions.push(`Multiples: Weighted blend ${multiples.notes}.`);
  }
  if (metrics.dividendYield != null) {
    assumptions.push(`Capital returns: dividend yield ${formatPercent(metrics.dividendYield, 2)}${metrics.buybackYield ? `, buyback ${formatPercent(metrics.buybackYield, 2)}` : ''}.`);
  }

  return {
    symbol,
    asOf: latest.date || latest.statementDate || new Date().toISOString(),
    valuations: { dcf, multiples, blended },
    metrics,
    table,
    assumptions,
    qualityNarrative: 'Quality blend computed from growth durability, profitability, and leverage.',
    fallback: false,
    warning: '',
  };
};

async function handle(request) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') || 'AAPL').toUpperCase();
  const token = getTiingoToken();
  if (!token) {
    const clone = { ...FALLBACK_SAMPLE, symbol };
    return Response.json(clone, { headers: corsHeaders });
  }
  try {
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 6);
    const raw = await fetchTiingo(`/tiingo/fundamentals/${encodeURIComponent(symbol)}/daily`, { startDate: startDate.toISOString().slice(0, 10) }, token);
    const rows = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
    const result = normaliseFundamentals(symbol, rows);
    return Response.json(result, { headers: corsHeaders });
  } catch (error) {
    console.error('tiingo-fundamentals error', error);
    const clone = { ...FALLBACK_SAMPLE, symbol, warning: 'Tiingo fundamentals unavailable — showing illustrative sample.', error: String(error) };
    return Response.json(clone, { headers: corsHeaders, status: 200 });
  }
}

export default handle;

export const handler = async (event) => {
  const rawQuery = event?.rawQuery ?? event?.rawQueryString ?? '';
  const path = event?.path || '/api/tiingo-fundamentals';
  const host = event?.headers?.host || 'example.org';
  const url = event?.rawUrl || `https://${host}${path}${rawQuery ? `?${rawQuery}` : ''}`;
  const method = event?.httpMethod || 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : event?.body;
  const request = new Request(url, { method, headers: event?.headers || {}, body });
  const response = await handle(request);
  const headers = {}; response.headers.forEach((value, key) => { headers[key] = value; });
  return { statusCode: response.status, headers, body: await response.text() };
};
