# Quant Screener — Technical Notes

## Overview
This document captures the engineering-focused additions shipped with the enterprise-grade analytics refresh. The UI contract remains unchanged; all new capabilities are additive, programmatic layers.

## Aggregate Metrics Engine
- **Module:** `utils/quant-screener-analytics.js`
- **Purpose:** Compute resilient summary statistics (upside distribution, momentum, sector weights, market-cap aggregates) for any array of screener rows.
- **Key behaviours:**
  - Ignores malformed rows and gracefully handles missing numeric inputs.
  - Tracks extrema for upside and momentum, plus median/average values.
  - Produces sector leader insights limited to the top five segments.
  - Returns deterministic plain objects safe for persistence.

The module exports `computeAggregateMetrics(rows)` and `createEmptyAggregateMetrics()`. The former powers the summary chip datasets and run-history records; the latter initialises runtime state.

## Run History Store
- **Module:** `utils/screen-run-history.js`
- **Storage key:** `netlifytrading.quantScreener.runHistory.v1`
- **Retention:** Up to 20 runs (configurable).
- **Data shape:**
  - `timestamp`, `universeCount`, `matches`, `durationMs`, `reachedCap`, `errorCount`.
  - Sanitised filters, sort snapshot, and a 30-ticker universe sample.
  - Embedded aggregate metrics (mirroring the analytics engine output).

Implementation highlights:
- Falls back to an in-memory store when local storage is unavailable (e.g., Safari ITP, privacy mode, or unit tests).
- Sanitises all incoming payloads (numbers, strings, arrays) and deduplicates by timestamp.
- Provides immutable snapshots via `list()` and `latest()` to prevent accidental mutation by consumers.

## Runtime Bridge
`quant-screener.js` publishes a stable API to `window.netlifyTrading.quantScreener`:
- `getLatestMetrics()` — Returns a clone of the current aggregate metrics (kept in sync with every table render).
- `getRunHistory()` — Returns the full sanitised run history array.

This bridge enables integrations, observability dashboards, and QA tooling without touching the DOM. The bridge is initialised on module load and refreshed whenever analytics change.

## Summary Chip Instrumentation
The summary chip retains its original text content while exposing analytics via `data-*` attributes. Keys include:
- `data-count`, `data-avg-upside`, `data-median-upside`
- `data-positive-upside-count`, `data-negative-upside-count`, `data-zero-upside-count`
- `data-total-market-cap`, `data-average-market-cap`
- `data-best-upside-symbol/value`, `data-worst-upside-symbol/value`, `data-best-momentum-symbol/value`
- `data-top-sectors` (JSON payload of top sector leaders)

These attributes allow dashboards or browser extensions to ingest metrics without DOM parsing or additional requests.

## Workflow Integration
`runScreen()` now persists both the legacy preference snapshot and a richer run-history entry in a single flow, ensuring data consistency. The flow order is:
1. Run screener with concurrency autoscaling.
2. Apply filters and update render metrics.
3. Persist preferences (including last-run metadata).
4. Record sanitised run history with the latest metrics and filters.

## Testing
- Unit tests for analytics and run-history sanitisation live under `tests/utils/`.
- Existing Vitest configuration picks up the new specs automatically.
- Tests verify numeric coercion, sector aggregation, storage capacity handling, and snapshot immutability.

## Operational Considerations
- Storage errors (quota exceeded, JSON corruption) are caught and logged with friendly console warnings.
- History retention can be tuned by passing `maxEntries` into `createRunHistoryStore` if product requirements evolve.

For further enhancements (e.g., syncing history to a backend), reuse the sanitised payload returned by `createRunHistoryStore().record()`.
