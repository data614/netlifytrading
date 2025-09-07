export default async (request) => {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';
  // If no Marketstack key, return mock
  if (!process.env.MARKETSTACK_KEY && !process.env.REACT_APP_MARKETSTACK_KEY) {
    const symbol = q.toUpperCase();
    const results = q.length >= 2 ? [{ symbol, name: "Mock Result" }] : [];
    return Response.json({ data: results });
  }
  try {
    const key = process.env.MARKETSTACK_KEY || process.env.REACT_APP_MARKETSTACK_KEY;
    const api = new URL("http://api.marketstack.com/v1/tickers");
    api.searchParams.set("access_key", key);
    api.searchParams.set("search", q);
    api.searchParams.set("limit", "10");
    const resp = await fetch(api);
    const body = await resp.json();
    const results = (body.data || []).map(x => ({ symbol: x.symbol, name: x.name }));
    return Response.json({ data: results }, { headers: { 'access-control-allow-origin': '*' } });
  } catch (e) {
    return Response.json({ error: 'search failed', detail: String(e) }, { status: 500 });
  }
};