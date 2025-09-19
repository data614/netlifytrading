# Netlify Trading — Fixed

This is a minimal, working rebuild of your project with:
- Clean `index.html`, `app.js`, `app.css` (with `style.css` kept as a backup alias)
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
- (Optional) Add an environment variable **NEWS_API_KEY** (NewsAPI.org) so `/api/news`
  can retrieve live headlines for the dashboard. Without it, cached mock
  articles are returned.

## Endpoints
