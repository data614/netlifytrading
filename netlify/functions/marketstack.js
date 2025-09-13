const corsHeaders = { 'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*' };

function generateMockData(days = 30) {
  const today = new Date();
  return Array.from({ length: days }).map((_, i) => {
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

  const sendMock = (extra = {}) =>
    Response.json({ symbol, data: generateMockData(), ...extra }, { headers: corsHeaders });

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
    const api = new URL(`https://api.marketstack.com/v1/${base}`);
    api.searchParams.set('access_key', key);
    api.searchParams.set('symbols', symbol);
    if (interval) api.searchParams.set('interval', interval);
    if (limit) api.searchParams.set('limit', limit);
    if (exchange) api.searchParams.set('exchange', exchange);
    const resp = await fetch(api);
    const body = await resp.json();
    if (!resp.ok || body.error || !Array.isArray(body.data) || body.data.length === 0) {
      return sendMock({ warning: 'marketstack unavailable' });
    }
    const rows = body.data.map((r) => ({
      date: r.date,
      exchange: r.exchange,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close ?? r.last ?? r.price,
      volume: r.volume,
    }));
    return Response.json({ symbol, data: rows }, { headers: corsHeaders });
  } catch (e) {
    return Response.json({ symbol, data: generateMockData(), error: 'marketstack failed', detail: String(e) }, { headers: corsHeaders, status: 500 });
  }
};