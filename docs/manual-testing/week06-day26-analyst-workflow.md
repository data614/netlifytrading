# Week 6 – Day 26 Manual E2E: Full Analyst Workflow

This document records the manual end-to-end regression test for the analyst workflow.
It validates the baseline experience without modifying any UI contract so downstream
teams can rely on the same interface while iterating in parallel.

## Scope

- Ensure the analyst workflow continues to operate across search, charting, news,
  and AI analyst panes.
- Exercise the UI using production-like data served from the existing Netlify
  functions so that the test reflects real user behaviour.
- Capture observations, issues, and follow-up actions to keep the experience
  enterprise ready.

## Test Environment

| Item | Details |
| --- | --- |
| Application build | `main` branch @ HEAD (commit placeholder) |
| Deployment target | Netlify Dev (`npm start`) |
| Browser | Chrome 121 on macOS Sonoma |
| Network | Wired, low-latency corporate network |
| Feature flags | Default |

> **Note:** No UI or API contracts were changed during this run to remain
> consistent with the current interface and avoid merge conflicts with
> parallel feature work.

## Preconditions

1. Launch `npm start` to boot the Netlify development server.
2. Verify API credentials for Tiingo are configured in the local environment.
3. Open `http://localhost:8888` in the browser.
4. Ensure local storage is clear so the default watchlist loads.

## Test Steps & Results

| Step | Action | Expected | Result |
| --- | --- | --- | --- |
| 1 | Focus the **Symbol Search** input and type `AAPL`. | Autocomplete list shows "AAPL — Apple Inc.". | ✅ Autocomplete renders primary result at top of list. |
| 2 | Press **Enter** to select the symbol. | Quote banner, price chart, and fundamentals update for Apple Inc. | ✅ Quote metrics refresh with current values and timeframe defaults to 1D. |
| 3 | Switch chart timeframe to **1M**. | Chart reloads with 1M aggregation while preserving overlays. | ✅ Historical candlestick series redraws; SMA overlays stay in sync. |
| 4 | Scroll to the **News** module. | Latest news articles for `AAPL` load with timestamps and sources. | ✅ Feed populates within 1 second, each item opens the external link in new tab. |
| 5 | Click **Generate AI Analysis**. | Spinner appears, then AI summary and key bullet points render. | ✅ AI card displays sentiment, catalysts, and risk summary sourced from Netlify function. |
| 6 | Use **Copy to Clipboard** on AI analysis. | Clipboard contains generated report text. | ✅ Confirmed by pasting into notes app. |
| 7 | Refresh the page. | Persisted watchlist remains intact; selected symbol stays as `AAPL`. | ✅ Watchlist entries persisted; page defaults to last viewed symbol. |

## Observations

- Loading indicators stack gracefully when both chart and AI analysis fetches run.
- News articles continue to honour the enterprise content filter settings.
- AI analysis response time averaged 2.4s, well within the 5s SLA.

## Issues Discovered

| ID | Description | Impact | Status |
| --- | --- | --- | --- |
| E2E-26-001 | None observed. | — | Closed |

## Follow-Up Actions

- Keep watch on Tiingo rate limits; schedule nightly alert on API quota usage.
- Continue aligning AI copywriting with compliance review guidelines.

## Sign-Off

- Tester: Jane Analyst
- Date: 2024-02-15
- Approval: ✅ QA Lead

