# Netlify Trading Dashboard

Netlify Trading is a client-side dashboard backed by serverless functions that aggregates market data, news headlines, search suggestions, and transactional email capabilities. The single-page app renders price charts, symbol lookups, and curated news while gracefully falling back to mock data when third-party APIs are unavailable.

## Project structure

- **index.html** – root HTML document that loads the dashboard shell and boots the JavaScript app.
- **app.js** – main front-end script responsible for fetching market data, rendering charts, and wiring UI interactions.
- **app.css** – styling for the dashboard layout, typography, and responsive components.
- **netlify/functions/** – serverless functions deployed with the site:
  - `hello.js` – sample health-check endpoint.
  - `env-check.js` – exposes the environment configuration to help verify deployed variables.
  - `search.js` – provides symbol autocomplete and mock responses for quick lookups.
  - `marketstack.js` – proxies Marketstack API requests and fabricates mock price series when a key is absent.
  - `news.js` – fetches market headlines from NewsAPI.org with cached fallbacks.
  - `sendEmail.js` – submits transactional emails through the EmailJS REST API using secure server-side credentials.

Additional assets include `_redirects` for proxying `/api/*` paths to Netlify functions and `netlify.toml` for site configuration.

## Getting started

### Prerequisites

- Node.js 18 or later
- npm
- Netlify CLI (`npm install -g netlify-cli`) for local emulation of Netlify functions

### Install dependencies

From the project root run:

```bash
npm install
```

(There are no runtime dependencies today, but this step ensures the npm scripts are available.)

### Local development

Build the static assets and launch the Netlify dev server to emulate the production environment locally:

```bash
npm run build && netlify dev
```

The command copies the front-end assets into `build/`, spins up Netlify Dev on `http://localhost:8888`, and mounts the functions under `/api/*`. Refresh the page after each code change or re-run the build command to include new assets.

## Environment variables

Configure the following variables for local `.env` files or within the Netlify dashboard:

| Variable | Required | Purpose |
| --- | --- | --- |
| `MARKETSTACK_KEY` | Optional | Enables live price, intraday, and historical data from Marketstack. Without it, `marketstack.js` serves generated mock data. |
| `NEWS_API_KEY` | Optional | Allows `news.js` to retrieve current market headlines from NewsAPI.org; otherwise cached fallback stories are returned. |
| `EMAILJS_PRIVATE_KEY` | Required for email | Server-side EmailJS private key used by `sendEmail.js` to authenticate requests. |
| `EMAILJS_SERVICE_ID` | Required for email | Default EmailJS service identifier applied when no override is supplied in the request body. |
| `EMAILJS_TEMPLATE_ID` | Required for email | Default EmailJS template identifier used for outgoing messages. |

Add any other environment variables (for example `ALLOWED_ORIGIN`) as needed by your deployment.

## Deployment

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. In Netlify, create a new site from the repository and set the build settings:
   - **Build command:** `npm run build`
   - **Publish directory:** `build`
3. Supply the environment variables listed above under **Site settings → Build & deploy → Environment**.
4. Trigger a deployment. Netlify will run the build script, publish the static assets in `build/`, and bundle the serverless functions in `netlify/functions/` as API endpoints accessible under `/.netlify/functions/*` and proxied via `/api/*` thanks to `_redirects`.
5. To verify, load the deployed site and test key endpoints such as `/api/hello`, `/api/search?query=AAPL`, and the contact email flow.

For manual deployments, you can run `npm run build` locally followed by `netlify deploy --prod`, ensuring the same environment variables are configured in the CLI context.

## Troubleshooting

- Use `netlify env:list` to confirm environment variables are available in your local Netlify dev session.
- The dashboard falls back to mock responses when third-party APIs are unreachable; check your console logs for warnings if live data does not appear.
- Review the Netlify deploy logs for build output and function bundling details when diagnosing production issues.
