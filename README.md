# Netlify Trading — Fixed

This is a minimal, working rebuild of your project with:
- Clean `index.html`, `app.js`, `style.css`
- V2 Netlify Functions (`hello`, `env-check`, `search`, `marketstack`)
- Redirects wired so `/api/*` proxies to `/.netlify/functions/:splat`

## Local development
1. Install Netlify CLI (one-time):
   ```bash
   npm i -g netlify-cli
   ```
2. From this folder, run:
   ```bash
   npm run build && netlify dev
   ```
   - Open the printed URL and try:
     - **Ping:** `GET /api/hello`
     - **EOD:** click **Fetch EOD** (defaults to AAPL)
     - **Search:** type at least 2 letters to see suggestions

## Deploy to Netlify
- Connect the repo/folder and set:
  - **Build command:** `npm run build`
  - **Publish directory:** `build`
- (Optional) Add an environment variable **MARKETSTACK_KEY** to use live data.
  Without a key, the app returns mock data so the UI still works.

## Endpoints
- `/api/hello` — simple healthcheck
- `/api/env-check` — shows which env vars are present
- `/api/search?q=AAPL` — search tickers (Marketstack or mock)
- `/api/marketstack?symbol=AAPL` — last 30 days EOD (Marketstack or mock)

## Notes
- Functions use the new v2 signature (`export default async (request, context) => { ... }`).
- We intentionally avoid external client secrets in the frontend.
- If you already have a working UI, you can drop it in and keep these functions.


## EmailJS Integration (Serverless)

A Netlify Function `sendEmail.js` is included to send emails via EmailJS using the **private key**.

### Endpoint
`POST /api/sendEmail`

**Body JSON**
```json
{
  "template_params": {
    "user_name": "Anthony",
    "user_email": "anthony@example.com",
    "message": "Hello"
  }
}
```



You can also override `service_id` and `template_id` by passing them in the request body.
