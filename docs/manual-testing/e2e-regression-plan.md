# Manual End-to-End Regression Plan

This playbook enumerates the manual smoke and regression tests that should be
performed before shipping any changes to the Netlify Trading workspace. The
goal is to exercise every public surface area of the platform while keeping
the browser interface exactly as designed today.

## 1. Global Smoke Checks

1. Launch the development server (`npm start`) and confirm it compiles without
   warnings.
2. From the landing page (`/index.html`) validate that the navigation links
   open the following experiences in dedicated tabs:
   - AI Analyst (`/ai-analyst.html`)
   - AI Analyst Batch Table (`/ai-analyst-batch-table.html`)
   - Quant Screener (`/quant-screener.html`)
   - Valuation Lab (`/valuation-lab.html`)
   - Professional Desk (`/professional-desk.html`)
3. Resize the browser between 1366px and 1920px widths to ensure the
   responsive layout does not collapse or overlap navigation controls.

## 2. AI Analyst (`ai-analyst.html`)

1. Enter a liquid ticker (e.g. `AAPL`) and trigger the analysis flow.
2. Verify that:
   - The summary, valuation, and risk cards populate with data.
   - The timeline modules render analyst notes in chronological order.
   - The investment checklist badges reflect the underlying score state
     (bullish, neutral, cautious).
3. Trigger a second lookup with the same ticker to confirm cached data is
   reused without flashing the interface.
4. Request an illiquid ticker to ensure the UI surfaces the fallback error
   message from the Tiingo integration.
5. Use the document filter controls to confirm the news and filings tables
   react immediately without reloading the page.

## 3. AI Analyst Batch Table (`ai-analyst-batch-table.html`)

1. Paste a CSV with at least ten tickers and run the batch request.
2. Confirm the progress bar tracks the API requests and finalises at 100%.
3. Export the completed table to CSV and validate that the downloaded file
   includes the same columns and number formatting as the on-screen table.
4. Refresh the page and ensure the most recent batch remains available from
   local storage for continuity.

## 4. Quant Screener (`quant-screener.html`)

1. Load the default universe and start the screening process.
2. Observe the concurrency banner to verify it recommends the expected number
   of simultaneous API calls based on the universe size.
3. Sort by Upside, Downside, and Risk to confirm stable ordering behaviour and
   sticky headers.
4. Apply market cap, upside, and sector filters concurrently and ensure the
   result set updates instantly without layout shift.
5. Drill into a row to open the AI Analyst drawer and validate that repeated
   openings reuse cached research, avoiding redundant network requests.
6. Export the current screen to CSV and verify the file reflects the filtered
   dataset.

## 5. Valuation Lab (`valuation-lab.html`)

1. Enter sample financials and ensure the discounted cash flow and comparable
   valuation widgets recalculate immediately.
2. Toggle between bull, base, and bear scenarios and confirm the charts update
   without flicker.
3. Download the valuation workbook and check that the spreadsheet opens with
   all worksheets populated.

## 6. Professional Desk (`professional-desk.html`)

1. Authenticate with a professional account (staging credentials) and verify
   that entitlements gatekeep premium modules.
2. Exercise the order management blotter: submit a dummy order, move it to
   filled, and cancel it. Confirm audit logs update in real time.
3. Review the compliance tab to ensure the exception report renders with the
   latest data timestamp.

## 7. Regression Checklist

- Confirm all CSV exports open in Excel/Sheets with UTF-8 encoding.
- Validate accessibility: keyboard navigation, focus outlines, and ARIA
  attributes for each interactive control.
- Clear browser storage (local/session) and ensure the application gracefully
  rehydrates default state on reload.
- Capture screenshots of each primary view for release documentation.

Document every discrepancy, attach console/network logs, and assign follow-up
tickets before marking the run as complete.
