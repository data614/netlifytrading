export default async (request) => {
  const url = new URL(request.url);
  let q = url.searchParams.get('q') || '';
  let exchangeFilter = url.searchParams.get('exchange') || '';

  // Basic parsing to support queries like "ASX:WOW" or "WOW.AX"
  const colon = q.match(/^([A-Za-z]{2,5})\s*:\s*([A-Za-z0-9.\-]+)$/);
  if (colon) {
    exchangeFilter = exchangeFilter || mapPrefix(colon[1]);
    q = colon[2];
  } else {
    const dot = q.match(/^([A-Za-z0-9\-]+)\.([A-Za-z]{1,4})$/);
    if (dot) {
      q = dot[1];
      exchangeFilter = exchangeFilter || mapSuffix(dot[2]);
    }
  }

  // If no Marketstack key, return mock
  if (!process.env.MARKETSTACK_KEY && !process.env.REACT_APP_MARKETSTACK_KEY) {
    const symbol = q.toUpperCase();
    const results = q.length >= 2 ? [{ symbol, name: 'Mock Result', exchange: exchangeFilter, mic: exchangeFilter }] : [];
    return Response.json({ data: results });
  }

  try {
    const key = process.env.MARKETSTACK_KEY || process.env.REACT_APP_MARKETSTACK_KEY;
    const api = new URL('http://api.marketstack.com/v1/tickers');
    api.searchParams.set('access_key', key);
    api.searchParams.set('search', q);
    api.searchParams.set('limit', '10');
    const resp = await fetch(api);
    const body = await resp.json();
    const all = (body.data || []).map((x) => ({
      symbol: x.symbol,
      name: x.name,
      exchange: x.stock_exchange?.acronym || '',
      mic: x.stock_exchange?.mic || '',
    }));
    const filtered = all.filter(
      (it) => !exchangeFilter || it.mic === exchangeFilter || it.exchange === exchangeFilter
    );
    return Response.json(
      { data: filtered },
      { headers: { 'access-control-allow-origin': '*' } }
    );
  } catch (e) {
    return Response.json(
      { error: 'search failed', detail: String(e) },
      { status: 500 }
    );
  }
};

// Helpers for exchange alias mapping
function mapPrefix(prefix) {
  const up = prefix.toUpperCase();
  const aliases = {
    ASX: 'XASX',
    LSE: 'XLON',
    HKEX: 'XHKG',
    TSE: 'XTSE',
    TSEJP: 'XTKS',
    NYSE: 'XNYS',
    NASDAQ: 'XNAS',
  };
  if (up.startsWith('X')) return up;
  return aliases[up] || up;
}

function mapSuffix(suffix) {
  const up = suffix.toUpperCase();
  const map = {
    AX: 'XASX',
    ASX: 'XASX',
    AU: 'XASX',
    L: 'XLON',
    LSE: 'XLON',
    HK: 'XHKG',
    TO: 'XTSE',
    T: 'XTKS',
    DE: 'XETR',
    NS: 'XNSE',
    BO: 'XBOM',
    SW: 'XSWX',
  };
  return map[up] || '';
}