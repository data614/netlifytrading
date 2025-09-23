import { TIINGO_TOKEN_ENV_KEYS, isEnvPresent } from './lib/env.js';

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
  keys.forEach((key) => {
    present[key] = isEnvPresent(key);
  });

  for (const [canonical, aliases] of Object.entries(KEY_ALIASES)) {
    if (present[canonical]) continue;
    present[canonical] = aliases.some((alias) => present[alias]);
  }

  return Response.json({ env: present });
};