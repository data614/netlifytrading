const SYMBOL_NOT_FOUND_PATTERNS = [
  ['symbol', 'not', 'found'],
  ['ticker', 'not', 'found'],
  ['unknown', 'symbol'],
  ['unknown', 'ticker'],
  ['invalid', 'symbol'],
  ['invalid', 'ticker'],
  ['no', 'data', 'for'],
  ['no', 'records', 'for'],
  ['no', 'results', 'for'],
];

const AI_UNAVAILABLE_PATTERNS = [
  ['ai', 'analyst', 'unavailable'],
  ['ai', 'analyst', 'failed'],
  ['analysis', 'failed'],
  ['orchestrator', 'failed'],
  ['service', 'unavailable'],
  ['model', 'overloaded'],
  ['internal', 'server', 'error'],
  ['grok', 'request', 'failed'],
  ['codex', 'request', 'failed'],
  ['gemini', 'request', 'failed'],
];

const RATE_LIMIT_PATTERNS = [
  ['rate', 'limit'],
  ['too', 'many', 'requests'],
  ['quota', 'exceeded'],
  ['limit', 'exceeded'],
];

const NETWORK_PATTERNS = [
  ['failed', 'fetch'],
  ['networkerror'],
  ['network', 'error'],
  ['network', 'connection'],
  ['dns'],
  ['socket', 'hang', 'up'],
  ['network', 'request', 'failed'],
];

const AUTH_PATTERNS = [
  ['unauthorized'],
  ['forbidden'],
  ['api', 'key', 'invalid'],
  ['api', 'key', 'missing'],
  ['invalid', 'token'],
  ['missing', 'token'],
  ['authentication', 'failed'],
];

const TIMEOUT_PATTERNS = [
  ['timeout'],
  ['timed', 'out'],
  ['took', 'too', 'long'],
];

const SAMPLE_DATA_PATTERNS = [
  ['showing', 'sample', 'data'],
  ['sample', 'data'],
  ['using', 'mock', 'data'],
  ['fallback', 'data'],
  ['tiingo', 'request', 'failed'],
];

const TECHNICAL_TOKENS = [
  'tiingo',
  'netlify',
  'error',
  'exception',
  'stack',
  'http',
  'https',
  'fetch',
  'json',
  'promise',
  'function',
  'undefined',
  'status ',
  'response',
  'request failed',
  'typeerror',
  'referenceerror',
];

const SERVER_FAILURE_PATTERNS = [
  ['internal', 'server', 'error'],
  ['bad', 'gateway'],
  ['service', 'unavailable'],
  ['gateway', 'timeout'],
];

function normalize(value) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item)).filter(Boolean).join(' ');
  }
  if (typeof value === 'object') {
    if ('message' in value || 'error' in value || 'detail' in value) {
      return normalize(value.message ?? value.error ?? value.detail);
    }
    return '';
  }
  return String(value || '').trim();
}

function matchesAnyTokenSet(text, patterns) {
  if (!text) return false;
  const haystack = text.toLowerCase();
  return patterns.some((pattern) => {
    if (!pattern) return false;
    if (pattern instanceof RegExp) {
      return pattern.test(haystack);
    }
    if (Array.isArray(pattern)) {
      return pattern.every((token) => haystack.includes(String(token).toLowerCase()));
    }
    return haystack.includes(String(pattern).toLowerCase());
  });
}

export function getFriendlyErrorMessage({
  context = 'default',
  status,
  message,
  detail,
  fallback,
} = {}) {
  const normalizedFallback = normalize(fallback)
    || (context === 'ai-analyst'
      ? 'AI Analyst is currently unavailable. Please try again shortly.'
      : 'Unable to complete the request. Please try again shortly.');

  const primary = normalize(message);
  const detailText = normalize(detail);
  const combined = [primary, detailText]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (Number(status) === 404 || matchesAnyTokenSet(combined, SYMBOL_NOT_FOUND_PATTERNS)) {
    return 'Symbol not found. Check the ticker and try again.';
  }

  if (Number(status) === 429 || matchesAnyTokenSet(combined, RATE_LIMIT_PATTERNS)) {
    return 'Request limit reached. Please wait a moment before retrying.';
  }

  if ([401, 403].includes(Number(status)) || matchesAnyTokenSet(combined, AUTH_PATTERNS)) {
    return 'Authentication error. Update your API credentials and try again.';
  }

  if (matchesAnyTokenSet(combined, NETWORK_PATTERNS)) {
    return 'Network error detected. Check your connection and retry.';
  }

  if (matchesAnyTokenSet(combined, TIMEOUT_PATTERNS)) {
    return context === 'ai-analyst'
      ? 'AI Analyst request timed out. Please try again shortly.'
      : 'The request timed out. Please try again.';
  }

  if (matchesAnyTokenSet(combined, SAMPLE_DATA_PATTERNS)) {
    return 'Live market data is temporarily unavailable. Displaying sample data.';
  }

  if (context === 'ai-analyst' && (Number(status) >= 500 || matchesAnyTokenSet(combined, AI_UNAVAILABLE_PATTERNS))) {
    return 'AI Analyst is currently unavailable. Please try again shortly.';
  }

  if (Number(status) >= 500 || matchesAnyTokenSet(combined, SERVER_FAILURE_PATTERNS)) {
    return normalizedFallback;
  }

  if (primary) {
    const sanitizedPrimary = primary.replace(/\s+/g, ' ').trim();
    const lowerPrimary = sanitizedPrimary.toLowerCase();
    const looksTechnical = TECHNICAL_TOKENS.some((token) => lowerPrimary.includes(token));
    if (sanitizedPrimary && !looksTechnical && sanitizedPrimary.length <= 160) {
      return sanitizedPrimary;
    }
  }

  if (detailText) {
    const sanitizedDetail = detailText.replace(/\s+/g, ' ').trim();
    const lowerDetail = sanitizedDetail.toLowerCase();
    const looksTechnical = TECHNICAL_TOKENS.some((token) => lowerDetail.includes(token));
    if (sanitizedDetail && !looksTechnical && sanitizedDetail.length <= 160) {
      return sanitizedDetail;
    }
  }

  return normalizedFallback;
}

export function enrichError(error, {
  context = 'default',
  fallback,
  status,
  detail,
  rawMessage,
} = {}) {
  const baseFallback = normalize(fallback)
    || (context === 'ai-analyst'
      ? 'AI Analyst is currently unavailable. Please try again shortly.'
      : 'Unable to complete the request. Please try again shortly.');

  const err = error instanceof Error ? error : new Error(normalize(error) || baseFallback);

  const resolvedStatus = status
    ?? err.status
    ?? err.statusCode
    ?? (typeof err?.response?.status === 'number' ? err.response.status : undefined);

  const resolvedDetail = normalize(
    detail
      ?? err.detail
      ?? err?.response?.detail
      ?? err?.response?.error
      ?? err?.response?.message
      ?? err?.responseText,
  );

  const resolvedRaw = normalize(rawMessage ?? err.originalMessage ?? err.message);

  const friendly = getFriendlyErrorMessage({
    context,
    status: resolvedStatus,
    message: resolvedRaw,
    detail: resolvedDetail,
    fallback: baseFallback,
  });

  if (resolvedStatus !== undefined) {
    err.status = resolvedStatus;
  }

  if (resolvedDetail) {
    err.detail = resolvedDetail;
  }

  if (resolvedRaw) {
    err.originalMessage = resolvedRaw;
  }

  err.userMessage = friendly;
  err.friendlyMessage = friendly;

  if (friendly) {
    err.message = friendly;
  } else if (!err.message) {
    err.message = baseFallback;
  }

  return err;
}

export { normalize };
