import {
  getRegisteredRedactionPatterns,
  getRegisteredSecretKeyHints,
} from './security-registry.js';

const DEFAULT_REPLACEMENT = '[redacted]';
const MIN_ENV_SECRET_LENGTH = 16;
const ENV_CACHE_TTL_MS = 60_000;
const SECRET_HINT_CACHE_TTL_MS = 60_000;

let cachedEnvSecrets = null;
let cachedEnvFetchedAt = 0;
let cachedSecretKeyHints = null;
let cachedSecretKeyHintsFetchedAt = 0;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getCachedSecretKeyHints = () => {
  if (cachedSecretKeyHints && Date.now() - cachedSecretKeyHintsFetchedAt < SECRET_HINT_CACHE_TTL_MS) {
    return cachedSecretKeyHints;
  }
  cachedSecretKeyHints = getRegisteredSecretKeyHints()
    .map((hint) => String(hint || '').trim().toUpperCase())
    .filter(Boolean);
  cachedSecretKeyHintsFetchedAt = Date.now();
  return cachedSecretKeyHints;
};

const looksLikeSecretKeyName = (key) => {
  const upperKey = key.toUpperCase();
  const hints = getCachedSecretKeyHints();
  return hints.some((hint) => upperKey.includes(hint));
};

const looksLikeSecretValue = (value) => {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < MIN_ENV_SECRET_LENGTH) return false;
  if (/^[0-9]+$/.test(trimmed)) return false;
  if (/^[A-Za-z]+$/.test(trimmed) && trimmed.length < 24) return false;
  return /[A-Za-z]/.test(trimmed) && /[0-9]/.test(trimmed);
};

const collectLikelyEnvSecrets = () => {
  const env = process.env || {};
  const secrets = new Set();
  const defaultPatterns = getRegisteredRedactionPatterns();
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!looksLikeSecretValue(trimmed)) continue;
    if (!looksLikeSecretKeyName(key)) {
      // Only keep non-hinted keys if they look like cryptographic material.
      if (!defaultPatterns.some((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(trimmed);
      })) {
        continue;
      }
    }
    secrets.add(trimmed);
  }
  return Array.from(secrets).slice(0, 100);
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

  const patterns = [...getRegisteredRedactionPatterns(), ...additionalPatterns];
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
    if (stack && stack.includes(message)) {
      return stack;
    }
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
  cachedSecretKeyHints = null;
  cachedSecretKeyHintsFetchedAt = 0;
};

export default {
  redactSecrets,
  sanitizeErrorDetail,
  logError,
  resetEnvSecretCache,
};
