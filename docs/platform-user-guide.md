# Netlify Trading Platform — Usage Guide

## Overview
The Netlify Trading workspace is a research terminal that aggregates watchlists,
market movers, detailed price charts, multi-source news, and corporate event
feeds into a single interface. The workstation is split across multiple views
(Trading Desk, Professional Desk, Quant Screener, Valuation Lab, and AI Analyst)
so that different personas can collaborate on the same data foundation.

The Trading Desk experience is the default landing page and is optimised for
real-time price discovery, corporate actions triage, and investor updates. This
document explains how to run the platform locally and how to use each major
module inside the Trading Desk.

## Getting started

### Prerequisites
- Node.js 18 or later (the repository uses ECMAScript modules and optional
  chaining extensively).
- npm 8 or later.

Install dependencies:

```bash
npm install
```

### Local development server
Run the Netlify development server. It provides both the static front-end and
local emulations of the serverless functions under the `/api` namespace.

```bash
npm start
```

The default Netlify dev server listens on <http://localhost:8888>. The
application relies on the redirects declared in `_redirects` so that requests to
`/api/*` are proxied to the Netlify functions in `netlify/functions`.

### Production build
To create a deployable artefact in `build/` use:

```bash
npm run build
```

The build copies all static assets as well as the serverless functions. Deploy
`build/` to Netlify or any static host that can forward `/api/*` to the Netlify
functions runtime.

## Key features on the Trading Desk

### Watchlist management
- The watchlist shows persisted tickers from local storage. First-time users see
  a seeded list with Apple (AAPL), Microsoft (MSFT), and Tesla (TSLA).
- Add new instruments by searching for a ticker, company name, or exchange-
  qualified symbol (for example, `ASX:WOW` or `WOW.AX`). Click **Add** to store a
  symbol or **Load** to immediately load it in the main view.
- Remove an instrument from the watchlist using the × button next to a row. The
  watchlist persists across sessions under the `tiingo.watchlist` key in
  `localStorage`.
- Prices refresh automatically every 60 seconds. A manual refresh happens when a
  new symbol is loaded.

### Symbol search and filtering
- Use the watchlist sidebar search box to query the Tiingo symbol universe. The
  dropdown above the search field filters results by exchange (NASDAQ, NYSE,
  ASX, etc.).
- Search results display high-level metadata (exchange, instrument type,
  country). Choose **Load** to update the main quote and price chart without
  adding the symbol to your watchlist.

### Market movers table
- The market movers card summarises the top percentage movers drawn from the
  currently tracked watchlist universe. The table automatically re-renders when
  background quote refreshes finish or when the watchlist changes.

### Price chart and indicators
- The price chart supports intraday and end-of-day time frames (1D, 1W, 1M, 3M,
  6M, 1Y). Moving averages (SMA 20/50 and EMA 12/26) and event markers for
  earnings, filings, dividends, and splits are overlaid automatically.
- Selecting a different timeframe immediately requests fresh data. The UI keeps
  the most recent request active and discards earlier responses to guard against
  flicker when multiple timeframe switches happen quickly.

### Corporate event feed
- The event feed unifies Tiingo news, SEC documents, and corporate actions. Each
  item includes a badge that indicates the event type and its source. Events are
  deduplicated and sorted newest-first.
- Loading a new symbol cancels any in-flight event feed requests for the
  previous symbol. When data is unavailable the badge and feed show a friendly
  diagnostic message.

### News aggregation
- The news card aggregates content from All, Bloomberg, Reuters, or Yahoo
  Finance. Select a source to trigger a refresh. The UI gracefully reuses cached
  articles for five minutes, and just like the chart and event feed, only the
  newest request is allowed to update the DOM.
- Use the status message inside the card to identify when the backing API key is
  missing (the badge will display `API: demo/mock`).

### Profile and email digests
- The **My Profile** card stores a name and email address locally so individual
  analysts can personalise the experience. Data is stored under the `userProfile`
  key in `localStorage`.
- After saving profile details, the **Send watchlist summary** button sends an
  email using the `/api/sendEmail` Netlify function. The payload lists each
  symbol currently in the watchlist alongside the latest cached quote.

### Exchange clocks
A multi-zone digital clock shows trading hours for New York, London, Tokyo, and
Sydney, making it easy to time market opens and closes.

## Data services and reliability
- Every API request routes through `/api/tiingo` or `/api/news`. The front-end
  includes a layered caching strategy. Responses are memoised for short periods
  to reduce redundant network calls during fast navigation.
- `utils/task-guards.js` provides enterprise-grade request coordination. It
  ensures that when multiple requests race (for instance, switching timeframes
  quickly) only the latest response is applied. Older responses are ignored
  without surfacing stale UI states.
- The API badge in the Market Movers card displays whether data originated from
  Tiingo live feeds, end-of-day fallbacks, or the offline sample set.

## Troubleshooting
- **No data returned:** The chart status bar explains whether a Tiingo fallback
  was used. Re-run the request or verify API credentials if the badge reports a
  mock source.
- **News unavailable:** The news card shows a descriptive message when the
  Netlify function or third-party API is unreachable. Try switching sources or
  refreshing after a few minutes.
- **Email summary failed:** Confirm that the profile card has a valid email
  address and re-run the action. Server-side logs are available through
  `netlify dev` for deeper inspection.

## Next steps
- Explore the Professional Desk, Quant Screener, Valuation Lab, and AI Analyst
  experiences for specialised workflows. Each page pulls from the same data
  services, so watchlist changes and cached quotes remain consistent as users
  navigate between tabs.
- Review the manual regression plan in
  [`docs/manual-testing/e2e-regression-plan.md`](manual-testing/e2e-regression-plan.md)
  for QA coverage recommendations before a release.
