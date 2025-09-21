const corsHeaders = { 'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*' };

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

  const token = process.env.TIINGO_KEY || process.env.REACT_APP_TIINGO_KEY;
  if (!token) {
    const symbol = q.toUpperCase();
    const results = q.length >= 2 ? [{ symbol, name: 'Mock Result', exchange: exchangeFilter, mic: exchangeFilter }] : [];
    return Response.json({ data: results }, { headers: corsHeaders });
  }

  try {
    const api = new URL('https://api.tiingo.com/tiingo/utilities/search');
    api.searchParams.set('query', q);
    api.searchParams.set('token', token);
    const resp = await fetch(api);
    const body = await resp.json();
    const items = Array.isArray(body) ? body : [];
    const all = items.map((x) => {
      const exchangeCode = (x.exchange || x.exchangeCode || '').toUpperCase();
      return {
        symbol: (x.ticker || x.permaTicker || '').toUpperCase(),
        name: x.name || '',
        exchange: exchangeCode || '',
        mic: mapExchangeCodeToMic(exchangeCode),
      };
    });
    const filtered = all.filter(
      (it) => !exchangeFilter || it.mic === exchangeFilter || it.exchange === exchangeFilter
    );
    return Response.json({ data: filtered }, { headers: corsHeaders });
  } catch (e) {
    return Response.json(
      { error: 'search failed', detail: String(e) },
      { status: 500, headers: corsHeaders }
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

function mapExchangeCodeToMic(code) {
  const up = (code || '').toUpperCase();
  const map = {
    NASDAQ: 'XNAS',
    NYSE: 'XNYS',
    ARCA: 'ARCX',
    BATS: 'BATS',
    AMEX: 'XASE',
    ASX: 'XASX',
    TSX: 'XTSE',
    LSE: 'XLON',
    HKEX: 'XHKG',
    TSE: 'XTKS',
    SGX: 'XSES',
    NSE: 'XNSE',
    BSE: 'XBOM',
  };
  if (up.startsWith('X') && up.length >= 3) return up;
  return map[up] || '';
}
