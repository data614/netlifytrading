# Serverless Function Architecture and API Contracts

This document summarizes the Netlify serverless functions that power the application. It captures runtime conventions, shared utilities, and the request/response contracts for each publicly exposed function so feature teams can extend the platform without breaking existing integrations.

## Runtime conventions

- **Deployment target** – All functions live under `netlify/functions` and are deployed as Netlify Functions. Each file exports a Fetch-style handler and a default export so the same logic can run locally and on Netlify. The wrapper converts Netlify's event payload into a standard `Request` object before invoking the handler.【F:netlify/functions/tiingo-data.js†L1088-L1113】【F:netlify/functions/ai-analyst.js†L568-L602】【F:netlify/functions/aiAnalystBatch.js†L180-L214】
- **CORS policy** – Every function sets permissive CORS headers that default to `process.env.ALLOWED_ORIGIN` or `*`, ensuring the browser clients continue to work unchanged. POST-capable handlers also reply to `OPTIONS` pre-flight requests with `204` responses.【F:netlify/functions/ai-analyst.js†L27-L43】【F:netlify/functions/aiAnalystBatch.js†L4-L33】【F:netlify/functions/news.js†L5-L79】
- **Caching** – Functions use the shared in-memory cache helper (`createCache`) to deduplicate expensive upstream requests within a warm function instance. Cached responses advertise their state via custom headers such as `x-ai-analyst-cache` or `X-Tiingo-Source` so clients can detect fallbacks.【F:netlify/functions/lib/cache.js†L1-L92】【F:netlify/functions/tiingo-data.js†L64-L119】【F:netlify/functions/ai-analyst.js†L42-L81】【F:netlify/functions/ai-analyst.js†L541-L567】
- **Secrets hygiene** – The `lib/env` and `lib/security` helpers locate API keys across multiple environment-variable aliases, redact secrets from logs, and surface safe error messages. All functions rely on these utilities when interacting with third-party APIs.【F:netlify/functions/lib/env.js†L1-L38】【F:netlify/functions/lib/security.js†L1-L105】

## Function catalog

| Function file | Netlify endpoint | Methods | Purpose |
| --- | --- | --- | --- |
| `tiingo.js` | `/.netlify/functions/tiingo` | `GET` | Unified gateway to Tiingo market data with rich fallbacks when live data is unavailable. |
| `ai-analyst.js` | `/.netlify/functions/ai-analyst` | `GET`, `POST`, `OPTIONS` | Orchestrates Tiingo datasets and optional AI providers to produce an equity research brief. |
| `aiAnalystBatch.js` | `/.netlify/functions/aiAnalystBatch` | `GET`, `POST`, `OPTIONS` | Runs `gatherSymbolIntel` concurrently for multiple tickers to power portfolio dashboards. |
| `search.js` | `/.netlify/functions/search` | `GET` | Symbol autocomplete backed by local metadata and Tiingo's search API. |
| `news.js` | `/.netlify/functions/news` | `GET` | Curates market headlines from NewsAPI with resilient fallbacks per source. |
| `sendEmail.js` | `/.netlify/functions/sendEmail` | `POST` | Server-side wrapper around EmailJS REST API for transactional messages. |
| `env-check.js` | `/.netlify/functions/env-check` | `GET` | Diagnostics endpoint that reports which critical environment variables are populated. |
| `hello.js` | `/.netlify/functions/hello` | `GET` | Health-check endpoint returning a static payload. |

## API reference

### `/tiingo` – market data bridge

**Query parameters**

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `symbol` | string | `AAPL` | Case-insensitive ticker symbol. |
| `kind` | string | `eod` | Data domain: `eod`, `intraday`, `intraday_latest`, `news`, `documents`, `filings`, `fundamentals`, `actions`, `overview`, `statements`, or `valuation`. |
| `limit` | number | 30 (varies by kind) | Maximum records returned; trimmed to sensible bounds per dataset. |
| `interval` | string | `5min` | Intraday sampling interval when `kind=intraday`. |

**Response**

```
{
  "symbol": "AAPL",
  "data": [...],
  "warning": "optional context",
  "meta": {
    "source": "live | eod-fallback | mock",
    "mockSource": "present when mock data is served",
    "kind": "requested kind",
    ...
  }
}
```

- Headers always include `X-Tiingo-Source`, `x-tiingo-chosen-key`, `x-tiingo-token-preview`, standard CORS headers, and cache-control hints.【F:netlify/functions/tiingo-data.js†L121-L153】【F:netlify/functions/tiingo-data.js†L828-L872】
- When Tiingo credentials are missing or an upstream call fails, the function emits deterministic mock data pulled from `data/tiingo-mock` or generated procedurally. The warning string and `meta.reason` explain why the fallback triggered.【F:netlify/functions/tiingo-data.js†L936-L1015】【F:netlify/functions/tiingo-data.js†L1016-L1097】
- Live requests cache Tiingo responses for 10–60 minutes depending on dataset and degrade gracefully to recent EOD snapshots before resorting to mock data.【F:netlify/functions/tiingo-data.js†L432-L525】【F:netlify/functions/tiingo-data.js†L978-L1037】

**Environment variables**

Any of the `TIINGO_TOKEN_ENV_KEYS` (`TIINGO_KEY`, `TIINGO_API_KEY`, etc.) must be present. The handler advertises which key was selected via the response headers to simplify troubleshooting.【F:netlify/functions/lib/env.js†L1-L31】【F:netlify/functions/tiingo-data.js†L150-L172】

### `/ai-analyst` – single-symbol research brief

**Methods**: `GET` query parameters or `POST` JSON body.

| Field | Location | Type | Default | Description |
| --- | --- | --- | --- | --- |
| `symbol` | query/body | string | `AAPL` | Target ticker, uppercased server-side. |
| `newsLimit` | query/body | number | 6 | Count of recent articles to fetch. |
| `documentLimit` | query/body | number | 4 | Count of SEC filings / documents. |
| `priceLimit` | query/body | number | 120 | Number of EOD price points for performance summary. |

**Processing pipeline**

1. Calls the `/tiingo` function for valuation, news, filings, corporate actions, and price history. Responses are cached for two minutes to avoid duplicate upstream calls.【F:netlify/functions/ai-analyst.js†L286-L363】
2. Derives quantitative ratios (P/E, P/S, FCF yield, leverage, ROE) from the Tiingo payload using shared math utilities.【F:netlify/functions/ai-analyst.js†L200-L261】
3. Builds a research prompt combining valuation, fundamentals, news summaries, filings, actions, and price performance.【F:netlify/functions/ai-analyst.js†L262-L316】
4. Optionally invokes external LLM providers (Codex, Grok, Gemini) when their API keys are configured, falling back to Tiingo narratives when generation fails.【F:netlify/functions/ai-analyst.js†L364-L529】

**Response shape**

```
{
  "symbol": "AAPL",
  "generatedAt": "2024-01-01T00:00:00.000Z",
  "tiingo": {
    "data": { valuation, fundamentals, news, documents, actions, priceHistory, quantMetrics },
    "warnings": [...],
    "responses": {
      "valuation": { status, warning, meta, source },
      ...
    },
    "cache": { hit, fetchedAt, ttlMs, key }
  },
  "quant": { priceToEarnings, priceToSales, ... },
  "prompt": { system, user },
  "narrative": {
    "text": "Analyst summary",
    "source": "codex | grok | gemini | fallback",
    "codex": { model, hasText? },
    "grok": { model, hasText? },
    "gemini": { model, hasText? },
    "errors": { codex?, grok?, gemini? }
  },
  "warnings": [...],
  "codex": { model, keyHint },
  "grok": { model, keyHint },
  "gemini": { model, keyHint }
}
```

`OPTIONS` requests return `204` for CORS preflight. Any fatal error yields `500` with `{ error: 'AI analyst orchestrator failed.' }` while preserving CORS headers.【F:netlify/functions/ai-analyst.js†L317-L605】

**Environment variables**

- Tiingo token (see `/tiingo`).
- Optional AI providers: `GEMINI_API_KEY`, `GEMINI_MODEL`, `XAI_API_KEY` (via `lib/grok`), and `CODEX_API_KEY` with their documented aliases. The handler exposes which key alias was detected via `keyHint` fields in the response.【F:netlify/functions/lib/gemini.js†L1-L56】【F:netlify/functions/ai-analyst.js†L515-L553】

### `/aiAnalystBatch` – multi-symbol summaries

**Methods**: `GET`/`POST` plus `OPTIONS` preflight.

| Field | Location | Type | Default | Description |
| --- | --- | --- | --- | --- |
| `symbols` | query/body | array or delimited string | required | Up to 20 tickers; duplicates trimmed and uppercased. |
| `limit` | query/body | number | inherited | Optional price history limit (max 500). |
| `timeframe` | query/body | string | `3M` | Rolling horizon label forwarded to `gatherSymbolIntel`. |
| `concurrency` | query/body | number | 3 | Worker pool size (max 6) to balance throughput vs. API quotas. |

For each symbol the function calls `gatherSymbolIntel` (shared with `/ai-analyst`) and collapses the result into a lightweight summary: last price, AI upside %, base growth CAGR, margin of safety, and metadata timestamp.【F:netlify/functions/aiAnalystBatch.js†L1-L146】

**Response**

```
{
  "requestedSymbols": ["AAPL", "MSFT"],
  "results": [ { symbol, price, currency, aiUpsidePct, metrics: [...], generatedAt }, ... ],
  "warnings": [ { symbol, message } ],
  "errors": [ { symbol, message } ],
  "meta": { count, generatedAt, limit, timeframe }
}
```

Errors from individual symbols are logged, sanitized, and returned per entry without aborting the entire batch.【F:netlify/functions/aiAnalystBatch.js†L74-L172】

### `/search` – symbol autocomplete

- **Method**: `GET` only; `OPTIONS` is not required because the endpoint is read-only and CORS headers are attached to the response.
- **Query parameters**: `q` (partial ticker/name), optional `exchange` MIC filter, optional `limit` (max 100). The handler also parses prefixes like `ASX:WOW` or suffixes like `WOW.AX` to infer the exchange automatically.【F:netlify/functions/search.js†L1-L49】
- **Behavior**: Always returns `{ data: [...] }` with combined local and remote matches. If the Tiingo API token is absent, the response falls back to local matches only. Remote lookups are cached for five minutes per query to protect the Tiingo search API.【F:netlify/functions/search.js†L10-L83】【F:netlify/functions/search.js†L84-L135】
- **Error handling**: Upstream failures log sanitized errors and return a `200` response containing `warning` and `detail` fields so clients can degrade gracefully without breaking autocomplete flows.【F:netlify/functions/search.js†L36-L83】

### `/news` – curated market headlines

- **Method**: `GET` only.
- **Query parameters**: `source` accepts `All`, `Bloomberg`, `Reuters`, or `Yahoo`; unknown values default to `All`.
- **Response**: `{ source, articles, fromCache?, fetchedAt?, warning?, error?, detail? }` with a shared cache TTL of five minutes. Articles include `title`, `url`, `source`, `publishedAt`, and `description` fields.【F:netlify/functions/news.js†L1-L118】
- **Fallbacks**: If `NEWS_API_KEY` is missing or NewsAPI fails, the endpoint serves curated sample content grouped by source. The previous successful payload is reused whenever possible before dropping to static seed data.【F:netlify/functions/news.js†L7-L72】【F:netlify/functions/news.js†L119-L182】

### `/sendEmail` – EmailJS relay

- **Method**: `POST` only. Other verbs return `405`.
- **Body**: JSON `{ template_params: object, service_id?, template_id? }`. Missing or malformed JSON yields `500` with an explanatory message.【F:netlify/functions/sendEmail.js†L1-L69】
- **Environment variables**: Accepts `EMAILJS_PRIVATE_KEY`, `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID` (with `EMAILS_` aliases). Body parameters override environment defaults for service/template IDs. Requests authenticate with EmailJS via Bearer token and pass through the upstream status code and error text when the call fails.【F:netlify/functions/sendEmail.js†L18-L62】

### `/env-check` – configuration introspection

Returns `{ env, meta }` describing which environment variables are populated, which alias (if any) is active for EmailJS, and which Tiingo token key was selected. Useful for deployment smoke tests.【F:netlify/functions/env-check.js†L1-L40】

### `/hello` – service health

Always returns `{ ok: true, message: "Hello from Netlify Functions" }` and is safe to use for uptime probes.【F:netlify/functions/hello.js†L1-L3】

## Extending the platform

- Reuse `createCache` for any new upstream integrations so throttling and coalescing behave consistently across functions.
- Prefer the helpers in `lib/env` to source API keys; they already scan for common aliases and emit preview headers when appropriate.【F:netlify/functions/lib/env.js†L1-L38】
- Wrap external errors with `logError` so responses never leak credentials and the logs remain actionable.【F:netlify/functions/lib/security.js†L67-L105】

Adhering to these conventions keeps the serverless layer enterprise-grade while maintaining backwards compatibility with the current client interfaces.
