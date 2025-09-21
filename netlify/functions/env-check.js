export default async () => {
  const keys = [
    "TIINGO_KEY",
    "REACT_APP_TIINGO_KEY",
    "REACT_APP_API_KEY",
    "EMAILJS_PRIVATE_KEY",
    "EMAILJS_SERVICE_ID",
    "EMAILJS_TEMPLATE_ID",
  ];
  const present = {};
  for (const k of keys) present[k] = !!process.env[k];
  return Response.json({ env: present });
};