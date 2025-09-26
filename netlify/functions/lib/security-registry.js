const DEFAULT_SECRET_KEY_HINTS = [
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

const DEFAULT_REDACTION_PATTERNS = [
  /\b(?:sk|rk|pk)_(?:live|test|prod|stage|sandbox)?_[A-Za-z0-9]{16,}\b/gi,
  /\b[A-Za-z0-9][A-Za-z0-9._-]{38,}\b/g,
  /\b[0-9a-f]{32,}\b/gi,
  /bearer\s+[A-Za-z0-9\-._~+/=]{16,}/gi,
];

let registeredSecretKeyHints = new Set(DEFAULT_SECRET_KEY_HINTS.map((hint) => hint.toUpperCase()));
let registeredPatterns = DEFAULT_REDACTION_PATTERNS.map((pattern) => new RegExp(pattern.source, pattern.flags));

const clonePattern = (pattern) => new RegExp(pattern.source, pattern.flags);

export const getRegisteredSecretKeyHints = () => Array.from(registeredSecretKeyHints);

export const registerSecretKeyHints = (hints) => {
  if (!Array.isArray(hints)) return;
  for (const hint of hints) {
    if (!hint && hint !== 0) continue;
    const normalized = String(hint).trim().toUpperCase();
    if (!normalized) continue;
    registeredSecretKeyHints.add(normalized);
  }
};

export const getRegisteredRedactionPatterns = () => registeredPatterns.map(clonePattern);

export const registerRedactionPatterns = (patterns) => {
  if (!Array.isArray(patterns)) return;
  for (const pattern of patterns) {
    if (pattern instanceof RegExp) {
      registeredPatterns.push(clonePattern(pattern));
    }
  }
};

export const resetSecurityRegistry = () => {
  registeredSecretKeyHints = new Set(DEFAULT_SECRET_KEY_HINTS.map((hint) => hint.toUpperCase()));
  registeredPatterns = DEFAULT_REDACTION_PATTERNS.map((pattern) => new RegExp(pattern.source, pattern.flags));
};

export const getDefaultSecretKeyHints = () => DEFAULT_SECRET_KEY_HINTS.map((hint) => hint.toUpperCase());

export const getDefaultRedactionPatterns = () => DEFAULT_REDACTION_PATTERNS.map(clonePattern);

export default {
  getRegisteredSecretKeyHints,
  registerSecretKeyHints,
  getRegisteredRedactionPatterns,
  registerRedactionPatterns,
  resetSecurityRegistry,
  getDefaultSecretKeyHints,
  getDefaultRedactionPatterns,
};
