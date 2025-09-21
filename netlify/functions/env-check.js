const KEY_ALIASES = {
  EMAILJS_PRIVATE_KEY: ["EMAILJS_PRIVATE_KEY", "EMAILS_PRIVATE_KEY"],
  EMAILJS_SERVICE_ID: ["EMAILJS_SERVICE_ID", "EMAILS_SERVICE_ID"],
  EMAILJS_TEMPLATE_ID: ["EMAILJS_TEMPLATE_ID", "EMAILS_TEMPLATE_ID"],
};

export default async () => {
  const keys = [
    "TIINGO_KEY",
    "REACT_APP_TIINGO_KEY",
    "REACT_APP_API_KEY",
    ...new Set(Object.values(KEY_ALIASES).flat()),
  ];
  const present = {};

  for (const key of keys) {
    present[key] = !!process.env[key];
  }

  for (const [canonical, aliases] of Object.entries(KEY_ALIASES)) {
    if (present[canonical]) continue;
    present[canonical] = aliases.some((alias) => present[alias]);
  }

  return Response.json({ env: present });
};