# Good Hope Markets — Professional Desk Extensions

This repository now includes a set of advanced standalone pages and Netlify Functions that extend the original Trading Desk experience without modifying the primary `index.html` workspace.

## New Professional Workspaces

| Page | Purpose |
| --- | --- |
| `professional-desk.html` | Real-time multi-panel trading desk featuring intelligent search, charting controls, automated insights, event radar, risk metrics, and ChatGPT 5 valuation integration. |
| `valuation-lab.html` | Dedicated AI valuation lab that focuses on fair value discovery, scenario planning, and document review for equity research deep dives. |

Both pages load the new `professional-desk.js` module and `professional-desk.css` stylesheet while leaving the existing site untouched.

## Serverless Intelligence

Two Netlify Functions support the new experience:

* `netlify/functions/research.js` aggregates Tiingo pricing, news, and filings into a structured research payload with synthetic fallbacks when live data is unavailable.
* `netlify/functions/intelligence.js` powers the ChatGPT 5 valuation engine with deterministic heuristics when an `OPENAI_API_KEY` is not configured.

## Quality Safeguards

Comprehensive Node-based tests can be executed via:

```bash
npm test
```

The suite verifies Tiingo integration fallbacks, research aggregation, and AI response handling to ensure consistent chart data and valuation output across intraday and end-of-day timeframes.

## Building / Deploying

The build script has been updated to copy both new HTML workspaces, supporting assets, and Netlify functions into the final Netlify bundle:

```bash
npm run build
```

Deploying via Netlify CLI continues to work without additional configuration.
