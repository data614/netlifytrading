// utils/secret-redactor.js
import { buildDefaultSecretPatterns } from './security-patterns.js';

const SECRET_KEY_HINTS = [
  'KEY',
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'API',
  'ACCESS',
  'PRIVATE',
  'CLIENT',
  'AUTH',
];

const DEFAULT_REPLACEMENT = '[redacted]';
const MIN_ENV_SECRET_LENGTH = 16;
const ENV_CACHE_TTL_MS = 60_000;

// Unified patterns:
// - sk|rk|pk prefixes with optional middle segment (covers both conflict variants)
// - long opaque base62-ish blobs
// - long hex strings
// - bearer tokens
const BASE_DEFAULT_PATTERNS = [
  /\b(?:sk|rk|pk)_(?:[a-z]+_)?[A-Za-z0-9]{16,}\b/gi,
  /\b[A-Za-z0-9]{40,}\b/g,
  /\b[0-9a-f]{32,}\b/gi,
  /bearer\s+[A-Za-z0-9\-._~+/=]{16,}/gi,
];

// Prefer patterns from security-patterns.js when available,
// but only keep valid RegExp objects. Fall back to the base set.
const fromBuilder = (() => {
  try {
    const maybe = typeof buildDefaultSecretPatterns === 'function'
      ? buildDefaultSecretPatterns()
      : null;
    return Array.isArray(maybe) ? maybe.filter((p) => p instanceof RegExp) : [];
  } catch {
    return [];
  }
})();

const DEFAULT_PATTERNS = (fromBuilder.length ? fromBuilder : BASE_DEFAULT_PATTERNS).map(
  (pattern) => new RegExp(pattern.source, pattern.flags),
);

let cachedEnvSecrets = null;
let cachedEnvFetchedAt = 0;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const looksLikeSecretKeyName = (key) => {
  const upperKey = key.toUpperCase();
  return SECRET_KEY_HINTS.some((hint) => upperKey.includes(hint));
};

const looksLikeSecretValue = (value) => {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < MIN_ENV_SECRET_LENGTH) return false;
  if (/^[0-9]+$/.test(trimmed)) return false; // pure digits are unlikely secrets
  if (/^[A-Za-z]+$/.test(trimmed) && trimmed.length < 24) return false; // short alpha-only
  return /[A-Za-z]/.test(trimmed) && /[0-9]/.test(trimmed);
};

const collectLikelyEnvSecrets = () => {
  const env = process.env || {};
  const secrets = new Set();

  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!looksLikeSecretValue(trimmed)) continue;

    if (!looksLikeSecretKeyName(key)) {
      // Keep non-hinted keys only if they match crypto-like patterns.
      const looksCrypto = DEFAULT_PATTERNS.some((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(trimmed);
      });
      if (!looksCrypto) continue;
    }

    secrets.add(trimmed);
    if (secrets.size >= 100) break;
  }

  return Array.from(secrets);
};

const getCachedEnvSecrets = () => {
  if (cachedEnvSecrets && Date.now() - cachedEnvFetchedAt < ENV_CACHE_TTL_MS) {
    return cachedEnvSecrets;
  }
  cachedEnvSecrets = collectLikelyEnvSecrets();
  cachedEnvFetchedAt = Date.now();
  return cachedEnvSecrets;
};

export const redactSecrets = (input, options = {}) => {
  if (input === null || input === undefined) return '';
  const value = typeof input === 'string' ? input : String(input);

  const replaceValue = options.replaceValue || DEFAULT_REPLACEMENT;
  const includeEnvSecrets = options.includeEnvSecrets !== false;

  const additionalPatterns = Array.isArray(options.additionalPatterns)
    ? options.additionalPatterns
        .filter((pattern) => pattern instanceof RegExp)
        .map((pattern) => new RegExp(pattern.source, pattern.flags))
    : [];

  let result = value;

  // Clone patterns to ensure clean lastIndex and flags.
  const patterns = [
    ...DEFAULT_PATTERNS.map((p) => new RegExp(p.source, p.flags)),
    ...additionalPatterns.map((p) => new RegExp(p.source, p.flags)),
  ];

  for (const pattern of patterns) {
    result = result.replace(pattern, replaceValue);
  }

  if (includeEnvSecrets) {
    const envSecrets = getCachedEnvSecrets();
    for (const secret of envSecrets) {
      if (!secret) continue;
      const escaped = escapeRegExp(secret);
      if (!escaped) continue;
      const envPattern = new RegExp(escaped, 'g');
      result = result.replace(envPattern, replaceValue);
    }
  }

  return result;
};

const coerceErrorMessage = (error) => {
  if (error === null || error === undefined) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    const message = error.message || '';
    const stack = typeof error.stack === 'string' ? error.stack : '';
    if (stack && stack.includes(message)) return stack;
    return [message, stack].filter(Boolean).join('\n');
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

export const sanitizeErrorDetail = (error, options = {}) => {
  const fallback = options.fallback || 'Unexpected error.';
  const maxLength = Number.isFinite(options.maxLength) && options.maxLength > 0 ? options.maxLength : null;
  const raw = coerceErrorMessage(error);
  if (!raw) return fallback;

  let sanitized = redactSecrets(raw, options).trim();
  if (!sanitized) return fallback;

  if (maxLength && sanitized.length > maxLength) {
    sanitized = `${sanitized.slice(0, maxLength - 1)}…`;
  }
  return sanitized;
};

export const logError = (labelOrError, maybeError, options = {}) => {
  if (maybeError === undefined) {
    return logError('', labelOrError, options);
  }
  const label = typeof labelOrError === 'string' ? labelOrError : '';
  const detail = sanitizeErrorDetail(maybeError, options);
  if (label) {
    console.error(label, detail);
  } else {
    console.error(detail);
  }
  return detail;
};

export const resetEnvSecretCache = () => {
  cachedEnvSecrets = null;
  cachedEnvFetchedAt = 0;
};

export default {
  redactSecrets,
  sanitizeErrorDetail,
  logError,
  resetEnvSecretCache,
};
