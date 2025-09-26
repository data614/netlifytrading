// utils/secret-redactor.js
// Merged: registry-driven hints/patterns + builder fallback + resilient defaults.

import {
  getRegisteredRedactionPatterns,
  getRegisteredSecretKeyHints,
} from './security-registry.js';

import { buildDefaultSecretPatterns } from './security-patterns.js';

const DEFAULT_REPLACEMENT = '[redacted]';
const MIN_ENV_SECRET_LENGTH = 16;
const ENV_CACHE_TTL_MS = 60_000;
const SECRET_HINT_CACHE_TTL_MS = 60_000;

// Fallback key-name hints if registry provides none
const FALLBACK_SECRET_KEY_HINTS = [
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

// Strong base regexes (cover common API key/token shapes)
const BASE_DEFAULT_PATTERNS = [
  /\b(?:sk|rk|pk)_(?:[a-z]+_)?[A-Za-z0-9]{16,}\b/gi, // e.g., sk_live_xxx / pk_test_xxx
  /\b[A-Za-z0-9]{40,}\b/g,                           // long base62-ish blobs
  /\b[0-9a-f]{32,}\b/gi,                             // long hex tokens
  /bearer\s+[A-Za-z0-9\-._~+/=]{16,}/gi,             // bearer <jwt-ish>
];

// --- Utilities ---------------------------------------------------------------

const asRegExpArray = (arr) =>
  Array.isArray(arr) ? arr.filter((p) => p instanceof RegExp) : [];

const cloneRegex = (rx) => new RegExp(rx.source, rx.flags || '');
const uniqRegexes = (list) => {
  const seen = new Set();
  const out = [];
  for (const rx of list) {
    const key = `${rx.source}::${rx.flags || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cloneRegex(rx));
    }
  }
  return out;
};

// Build-time / static fallback patterns: prefer builder, else base.
const BUILDER_PATTERNS = (() => {
  try {
    const maybe = typeof buildDefaultSecretPatterns === 'function'
      ? buildDefaultSecretPatterns()
      : null;
    return asRegExpArray(maybe);
  } catch {
    return [];
  }
})();

const STATIC_FALLBACK_PATTERNS = BUILDER_PATTERNS.length
  ? BUILDER_PATTERNS
  : BASE_DEFAULT_PATTERNS;

// Cached hints from registry (with fallback and TTL)
let cachedSecretKeyHints = null;
let cachedSecretKeyHintsFetchedAt = 0;

const getCachedSecretKeyHints = () => {
  const now = Date.now();
  if (
    cachedSecretKeyHints &&
    now - cachedSecretKeyHintsFetchedAt < SECRET_HINT_CACHE_TTL_MS
  ) {
    return cachedSecretKeyHints;
  }

  let hints = [];
  try {
    if (typeof getRegisteredSecretKeyHints === 'function') {
      hints = (getRegisteredSecretKeyHints() || [])
        .map((h) => String(h || '').trim())
        .filter(Boolean);
    }
  } catch {
    // ignore
  }

  if (!hints.length) hints = FALLBACK_SECRET_KEY_HINTS;

  cachedSecretKeyHints = hints.map((h) => h.toUpperCase());
  cachedSecretKeyHintsFetchedAt = now;
  return cachedSecretKeyHints;
};

// Effective pattern set = union(registry, static fallback) [+ additional]
const getEffectiveRedactionPatterns = (additional = []) => {
  let registry = [];
  try {
    if (typeof getRegisteredRedactionPatterns === 'function') {
      registry = asRegExpArray(getRegisteredRedactionPatterns());
    }
  } catch {
    // ignore registry errors
  }

  const add = asRegExpArray(additional);
  return uniqRegexes([
    ...registry,
    ...STATIC_FALLBACK_PATTERNS,
    ...add,
  ]).map(cloneRegex); // ensure clean lastIndex/flags
};

// --- Env scanning + redaction ----------------------------------------------

let cachedEnvSecrets = null;
let cachedEnvFetchedAt = 0;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const looksLikeSecretKeyName = (key) => {
  const upperKey = String(key || '').toUpperCase();
  return getCachedSecretKeyHints().some((hint) => upperKey.includes(hint));
};

const looksLikeSecretValue = (value) => {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < MIN_ENV_SECRET_LENGTH) return false;
  if (/^[0-9]+$/.test(trimmed)) return false; // pure digits unlikely secrets
  if (/^[A-Za-z]+$/.test(trimmed) && trimmed.length < 24) return false; // short alpha-only
  return /[A-Za-z]/.test(trimmed) && /[0-9]/.test(trimmed);
};

const collectLikelyEnvSecrets = () => {
  const env = process.env || {};
  const secrets = new Set();
  const cryptoLike = getEffectiveRedactionPatterns(); // use union for scanning

  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!looksLikeSecretValue(trimmed)) continue;

    if (!looksLikeSecretKeyName(key)) {
      let looksCrypto = false;
      for (const pattern of cryptoLike) {
        pattern.lastIndex = 0;
        if (pattern.test(trimmed)) {
          looksCrypto = true;
          break;
        }
      }
      if (!looksCrypto) continue;
    }

    secrets.add(trimmed);
    if (secrets.size >= 100) break;
  }

  return Array.from(secrets);
};

const getCachedEnvSecrets = () => {
  const now = Date.now();
  if (cachedEnvSecrets && now - cachedEnvFetchedAt < ENV_CACHE_TTL_MS) {
    return cachedEnvSecrets;
  }
  cachedEnvSecrets = collectLikelyEnvSecrets();
  cachedEnvFetchedAt = now;
  return cachedEnvSecrets;
};

// Public API -----------------------------------------------------------------

export const redactSecrets = (input, options = {}) => {
  if (input === null || input === undefined) return '';
  const value = typeof input === 'string' ? input : String(input);

  const replaceValue = options.replaceValue || DEFAULT_REPLACEMENT;
  const includeEnvSecrets = options.includeEnvSecrets !== false;

  const additionalPatterns = Array.isArray(options.additionalPatterns)
    ? options.additionalPatterns
    : [];

  let result = value;

  const patterns = getEffectiveRedactionPatterns(additionalPatterns);
  for (const pattern of patterns) {
    result = result.replace(pattern, replaceValue);
  }

  if (includeEnvSecrets) {
    const envSecrets = getCachedEnvSecrets();
    for (const secret of envSecrets) {
      if (!secret) continue;
      const envPattern = new RegExp(escapeRegExp(secret), 'g');
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
  const maxLength =
    Number.isFinite(options.maxLength) && options.maxLength > 0
      ? options.maxLength
      : null;

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
  cachedSecretKeyHints = null;
  cachedSecretKeyHintsFetchedAt = 0;
};

export default {
  redactSecrets,
  sanitizeErrorDetail,
  logError,
  resetEnvSecretCache,
};
