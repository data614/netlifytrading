# Quant Screener — User Guide

## Overview
The Quant Screener helps research analysts triage equity universes using AI-enriched intelligence. The workflow below mirrors the production interface exactly—no additional buttons or layout changes were introduced in this update.

## Running a Screen
1. Paste or type the tickers you want to evaluate into the **Universe** text area (comma or newline separated).
2. Adjust optional filters:
   - Minimum and maximum upside percentages.
   - Market capitalisation bounds (in billions of USD).
   - Sector keywords (comma separated).
   - Maximum number of tickers to keep per batch.
3. Click **Screen universe**. Progress updates appear in the existing status banner and the results stream into the table as intelligence is gathered.

## Working with Results
- The results table supports column sorting (click any column header).
- The **Export CSV** action downloads the current, filtered table contents.
- The **Market Radar** heatmap surfaces up to 18 symbols ranked by upside.
- The summary chip above the table displays the total matches and average upside using the familiar format (`N matches · Avg upside ±X.X%`).

## Persisted Preferences
The screener automatically remembers:
- The last ticker universe you entered.
- Filter values and sorting preferences.
- Metadata about the last completed run (ticker count, matches, duration, and whether the batch cap was reached).

Preferences are stored in the browser’s local storage namespace `netlifytrading.quantScreener.preferences.v1`. They are scoped per browser profile and can be reset by clearing site data.

## Run History (New)
Each completed run is now archived (up to 20 entries) in local storage under `netlifytrading.quantScreener.runHistory.v1`. The history is background-only to preserve the current UI, but it unlocks advanced workflows:
- Inspect run analytics in the developer console via `window.netlifyTrading.quantScreener.getRunHistory()`.
- Retrieve the latest aggregate metrics (counts, upside distribution, sector leaders, and more) with `window.netlifyTrading.quantScreener.getLatestMetrics()`.
- Review which universe tickers were sampled in each run without exporting data.

## Summary Chip Data Attributes (New)
To support enterprise integrations without altering the interface, the summary chip now publishes structured metrics as `data-*` attributes. Example:

```html
<span id="summaryChip"
      data-count="12"
      data-avg-upside="8.42"
      data-median-upside="7.95"
      data-positive-upside-count="9"
      data-negative-upside-count="2"
      data-zero-upside-count="1"
      data-total-market-cap="4200000000000"
      data-average-market-cap="1400000000000"
      data-best-upside-symbol="AAPL"
      data-best-upside-value="15.3"
      data-top-sectors='[{"name":"Technology","count":9,"weight":0.75}]'>
  12 matches · Avg upside +8.4%
</span>
```

Third-party dashboards can read these attributes without DOM changes or additional network calls.

## Troubleshooting
- **Local storage disabled:** The screener falls back to an in-memory store for the active session. Preferences and run history will not persist across refreshes.
- **Clearing data:** Use the browser’s dev tools to remove the `netlifytrading.quantScreener.*` keys or call `window.netlifyTrading.quantScreener.getRunHistory()` to inspect before clearing.

## Support
For workflow or data issues raise a ticket with the Research Engineering team, referencing “Quant Screener” in the subject line.
