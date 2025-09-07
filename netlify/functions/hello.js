export default async (request, context) => {
  return Response.json({ ok: true, message: "Hello from Netlify Functions" });
};