import { TIINGO_TOKEN_ENV_KEYS, isEnvPresent, getTiingoToken, getTiingoTokenDetail } from './lib/env.js';

const KEY_ALIASES = {
  EMAILJS_PRIVATE_KEY: ["EMAILJS_PRIVATE_KEY", "EMAILS_PRIVATE_KEY"],
  EMAILJS_SERVICE_ID: ["EMAILJS_SERVICE_ID", "EMAILS_SERVICE_ID"],
  EMAILJS_TEMPLATE_ID: ["EMAILJS_TEMPLATE_ID", "EMAILS_TEMPLATE_ID"],
};

const API_BASE = 'https://api.tiingo.com';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const corsHeaders = {
  'access-control-allow-origin': ALLOWED_ORIGIN,
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization',
};

async function checkTiingoConnectivity() {
  const { token, key, reason } = getTiingoTokenDetail();
  if (!token) {
    return {
      ok: false,
      status: 0,
      key: key || '',
      reason: reason || 'not found',
      message: 'Tiingo API key not found',
      authMethod: 'none',
    };
  }

  try {
    const url = new URL('/iex', API_BASE);
    url.searchParams.set('tickers', 'AAPL');
    const resp = await fetch(url, {
      headers: { Authorization: `Token ${token}` },
    });
    const text = await resp.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch {}

    if (!resp.ok) {
      const msg = (parsed && (parsed.message || parsed.error || parsed.detail)) || text || resp.statusText;
      return {
        ok: false,
        status: resp.status,
        key,
        reason: 'request_failed',
        message: String(msg).slice(0, 300),
        authMethod: 'Authorization header',
      };
    }

    const response = parsed || [];
    return {
      ok: true,
      status: resp.status,
      key,
      message: `Successful connection with ${response.length || 0} entries`,
      data: response.slice(0, 1), // Include first entry for verification
      authMethod: 'Authorization header', 
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      key,
      reason: 'exception',
      message: (err && err.message) ? err.message.slice(0, 300) : 'unknown error',
    };
  }
}

export default async (request) => {
  if (request && request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const keys = new Set([
    ...TIINGO_TOKEN_ENV_KEYS,
    ...Object.keys(KEY_ALIASES),
  ]);
  Object.values(KEY_ALIASES).forEach((aliases) => {
    aliases.forEach((alias) => keys.add(alias));
  });

  const present = {};
  keys.forEach((key) => { present[key] = isEnvPresent(key); });

  for (const [canonical, aliases] of Object.entries(KEY_ALIASES)) {
    if (!present[canonical]) present[canonical] = aliases.some((alias) => present[alias]);
  }

  // TIINGO details
  const chosenKey = TIINGO_TOKEN_ENV_KEYS.find((k) => isEnvPresent(k));
  const token = getTiingoToken();
  const tokenDetail = getTiingoTokenDetail();
  const tokenPreview = token ? `${token.slice(0,4)}...${token.slice(-4)}` : '';
  const tiingoCandidates = Object.fromEntries(TIINGO_TOKEN_ENV_KEYS.map((k) => [k, isEnvPresent(k)]));

  const connectivity = await checkTiingoConnectivity();

  // Alias details for other groups
  const aliasDetails = {};
  for (const [canonical, aliases] of Object.entries(KEY_ALIASES)) {
    const candidates = [canonical, ...aliases];
    const activeKey = candidates.find((k) => isEnvPresent(k)) || '';
    aliasDetails[canonical] = {
      activeKey,
      keys: Object.fromEntries(candidates.map((k) => [k, isEnvPresent(k)])),
    };
  }

  const body = {
    env: present,
    meta: {
      tiingo: {
        chosenKey,
        tokenPreview,
        hasToken: !!token,
        candidates: tiingoCandidates,
        order: TIINGO_TOKEN_ENV_KEYS,
        tokenDetail: {
          key: tokenDetail.key,
          reason: tokenDetail.reason
        },
        connectivity,
        docs: {
          connecting: 'https://www.tiingo.com/documentation/general/connecting',
          base: API_BASE,
          authMethods: {
            preferred: 'Authorization: Token <API_TOKEN>',
            alternative: '?token=<API_TOKEN> (URL parameter)',
            implementation: 'Using Authorization header for security best practices'
          }
        }
      },
      aliases: aliasDetails,
    }
  };

  return Response.json(body, { headers: corsHeaders });
};