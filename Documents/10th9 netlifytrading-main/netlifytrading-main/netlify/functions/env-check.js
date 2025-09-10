export default async () => {
  const keys = ["MARKETSTACK_KEY", "REACT_APP_MARKETSTACK_KEY", "REACT_APP_API_KEY"];
  const present = {};
  for (const k of keys) present[k] = !!process.env[k];
  return Response.json({ env: present });
};