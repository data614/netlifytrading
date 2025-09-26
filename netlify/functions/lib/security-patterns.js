/**
 * Centralised library of secret redaction patterns.
 *
 * The goal is to keep the pattern catalogue in a dedicated module so it can be
 * expanded safely without creating merge conflicts in the redaction logic.
 * These patterns intentionally cover common SaaS/API providers that regularly
 * appear in incident reports and bug bounty write-ups.  All patterns should be
 * case-insensitive unless noted otherwise.
 */

const STRIPE_KEY_PREFIXES = ['sk', 'rk', 'pk'];
const STRIPE_KEY_VARIANTS = ['live', 'test', 'secret', 'sandbox'];

const STRIPE_KEY_PATTERN = new RegExp(
  `\\b(?:${STRIPE_KEY_PREFIXES.join('|')})_(?:${STRIPE_KEY_VARIANTS.join('|')})_[A-Za-z0-9]{16,}\\b`,
  'gi',
);
const STRIPE_SHORT_KEY_PATTERN = /\b(?:sk|rk|pk)_[A-Za-z0-9]{16,}\b/gi;

const GITHUB_TOKEN_PATTERN = /\bgh[pousr]_[A-Za-z0-9]{32,}\b/gi;
const SLACK_TOKEN_PATTERN = /\bxox[a-z]-[A-Za-z0-9-]{10,48}\b/gi;
const GOOGLE_OAUTH_TOKEN_PATTERN = /\bya29\.[0-9A-Za-z\-_]{30,}\b/g;
const AWS_ACCESS_KEY_PATTERN = /\bAKIA[0-9A-Z]{16}\b/g;
const AWS_SESSION_KEY_PATTERN = /\bASIA[0-9A-Z]{16}\b/g;
const PRIVATE_KEY_FOOTER_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g;
const GENERIC_BEARER_PATTERN = /bearer\s+[A-Za-z0-9\-._~+/=]{16,}/gi;
const HEX_TOKEN_PATTERN = /\b[0-9a-f]{32,}\b/gi;
const ALPHANUMERIC_TOKEN_PATTERN = /\b[A-Za-z0-9]{40,}\b/g;

export const buildDefaultSecretPatterns = () => [
  STRIPE_KEY_PATTERN,
  STRIPE_SHORT_KEY_PATTERN,
  GITHUB_TOKEN_PATTERN,
  SLACK_TOKEN_PATTERN,
  GOOGLE_OAUTH_TOKEN_PATTERN,
  AWS_ACCESS_KEY_PATTERN,
  AWS_SESSION_KEY_PATTERN,
  PRIVATE_KEY_FOOTER_PATTERN,
  GENERIC_BEARER_PATTERN,
  HEX_TOKEN_PATTERN,
  ALPHANUMERIC_TOKEN_PATTERN,
];

export default buildDefaultSecretPatterns;
