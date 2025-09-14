const corsHeaders = { 'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*' };

// simple mock generator used when no API key is supplied or the upstream
// service fails. Accepts a number of points to create so charts render the
// expected amount of data for different timeframes.
function generateMockData(points = 30) {
  const today = new Date();
  return Array.from({ length: points }).map((_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const open = 150 + Math.sin(i / 3) * 5 + (i % 7) - 3;
    const close = open + (Math.random() - 0.5) * 4;
    const high = Math.max(open, close) + Math.random() * 2;
    const low = Math.min(open, close) - Math.random() * 2;
    return {
      date: d.toISOString(),
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
      volume: Math.floor(1e7 + Math.random() * 5e6),
      symbol: 'MOCK',
      currency: 'USD',
    };
  });
}

export default async (request) => {
  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol') || 'AAPL';
  const kind = url.searchParams.get('kind') || 'eod';
  const interval = url.searchParams.get('interval') || '';
  const limit = url.searchParams.get('limit') || '30';
  const exchange = url.searchParams.get('exchange') || '';
  const afterHours = url.searchParams.get('after_hours') || '';

  const sendMock = (extra = {}) =>
    Response.json(
      { symbol, data: generateMockData(+limit || 30), ...extra },
      { headers: corsHeaders }
    );

  // return mock if no key
  if (!process.env.MARKETSTACK_KEY && !process.env.REACT_APP_MARKETSTACK_KEY) {
    return sendMock();
  }
  try {
    const key = process.env.MARKETSTACK_KEY || process.env.REACT_APP_MARKETSTACK_KEY;
    const base =
      kind === 'intraday_latest'
        ? 'intraday/latest'
        : kind === 'eod_latest'
        ? 'eod/latest'
        : kind === 'intraday'
        ? 'intraday'
        : 'eod';
    // use API v2 endpoints
    const api = new URL(`https://api.marketstack.com/v2/${base}`);
    api.searchParams.set('access_key', key);
    const symbolsParam = symbol
      .split(',')
      .map((s) => s.trim().replace(/\./g, '-'))
      .join(',');
    api.searchParams.set('symbols', symbolsParam);
    if (interval) api.searchParams.set('interval', interval);
    if (limit) api.searchParams.set('limit', limit);
    if (exchange) api.searchParams.set('exchange', exchange);
    if (afterHours) api.searchParams.set('after_hours', afterHours);
    const resp = await fetch(api);
    const body = await resp.json();
    if (!resp.ok || body.error || !Array.isArray(body.data) || body.data.length === 0) {
      return sendMock({ warning: 'marketstack unavailable' });
    }
    // gather unique currencies from the response so we can convert them to USD
    const currencies = [...new Set(body.data.map((r) => r.currency).filter((c) => c && c !== 'USD'))];
    const rates = {};
    for (const cur of currencies) {
      try {
        const r = await fetch(`https://api.exchangerate.host/latest?base=${cur}&symbols=USD`);
        const j = await r.json();
        rates[cur] = j?.rates?.USD || 1;
      } catch (_) {
        rates[cur] = 1; // fallback
      }
    }
    const rows = body.data.map((r) => {
      const rate = rates[r.currency] || 1;
      return {
        symbol: r.symbol.replace(/-/g, '.'),
        date: r.date,
        exchange: r.exchange,
        open: r.open != null ? r.open * rate : null,
        high: r.high != null ? r.high * rate : null,
        low: r.low != null ? r.low * rate : null,
        close: r.close != null ? r.close * rate : r.last != null ? r.last * rate : r.price != null ? r.price * rate : null,
        volume: r.volume,
        currency: 'USD',
      };
    });
    return Response.json({ symbol, data: rows }, { headers: corsHeaders });
  } catch (e) {
    return Response.json(
      { symbol, data: generateMockData(+limit || 30), error: 'marketstack failed', detail: String(e) },
      { headers: corsHeaders, status: 500 }
    );
  }
};