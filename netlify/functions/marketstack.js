export default async (request) => {
  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol') || 'AAPL';
  // return mock if no key
  if (!process.env.MARKETSTACK_KEY && !process.env.REACT_APP_MARKETSTACK_KEY) {
    const today = new Date();
    const data = Array.from({ length: 30 }).map((_, i) => {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const open = 150 + Math.sin(i / 3) * 5 + (i % 7) - 3;
      const close = open + (Math.random() - 0.5) * 4;
      const high = Math.max(open, close) + Math.random() * 2;
      const low = Math.min(open, close) - Math.random() * 2;
      return { date: d.toISOString(), open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +close.toFixed(2), volume: Math.floor(1e7 + Math.random() * 5e6) };
    });
    return Response.json({ symbol, data });
  }
  try {
    const key = process.env.MARKETSTACK_KEY || process.env.REACT_APP_MARKETSTACK_KEY;
    const api = new URL("http://api.marketstack.com/v1/eod");
    api.searchParams.set("access_key", key);
    api.searchParams.set("symbols", symbol);
    api.searchParams.set("limit", "30");
    const resp = await fetch(api);
    const body = await resp.json();
    const rows = (body.data || []).map(r => ({
      date: r.date,
      open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume
    }));
    return Response.json({ symbol, data: rows }, { headers: { 'access-control-allow-origin': '*' } });
  } catch (e) {
    return Response.json({ error: 'marketstack failed', detail: String(e) }, { status: 500 });
  }
};