import { TIINGO_TOKEN_ENV_KEYS, isEnvPresent, getTiingoToken } from './lib/env.js';

const KEY_ALIASES = {
  EMAILJS_PRIVATE_KEY: ["EMAILJS_PRIVATE_KEY", "EMAILS_PRIVATE_KEY"],
  EMAILJS_SERVICE_ID: ["EMAILJS_SERVICE_ID", "EMAILS_SERVICE_ID"],
  EMAILJS_TEMPLATE_ID: ["EMAILJS_TEMPLATE_ID", "EMAILS_TEMPLATE_ID"],
};

export default async () => {
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
  const tokenPreview = token ? `${token.slice(0,4)}...${token.slice(-4)}` : '';
  const tiingoCandidates = Object.fromEntries(TIINGO_TOKEN_ENV_KEYS.map((k) => [k, isEnvPresent(k)]));

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

  return Response.json({
    env: present,
    meta: {
      tiingo: { chosenKey, tokenPreview, hasToken: !!token, candidates: tiingoCandidates, order: TIINGO_TOKEN_ENV_KEYS },
      aliases: aliasDetails,
    }
  });
};