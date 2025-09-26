# Netlify Staging Deployment Guide

This guide documents how to deploy the Netlify Trading workspace to the staging environment using the automated script introduced in this repository.

## Prerequisites

1. **Netlify CLI authentication token**
   - Generate a personal access token from the Netlify user settings page with the `sites` scope.
   - Store the token securely (for example in a password manager or the CI secret store) and expose it as the `NETLIFY_AUTH_TOKEN` environment variable when running the deployment script.
2. **Staging site identifier**
   - From the staging site dashboard in Netlify, copy the **Site ID** value (UUID).
   - Provide it to the deployment process through the `NETLIFY_STAGING_SITE_ID` environment variable.
3. **Local environment file (optional)**
   - Copy `.env.example` to `.env` and populate the token and site identifier fields for local usage.

## One-time setup

1. Install dependencies: `npm install`
2. Log into Netlify CLI (optional if using tokens only): `npx netlify login`
3. Confirm the staging site exists and is configured with the appropriate build settings specified in `netlify.toml`.

## Deployment workflow

Run the following command from the repository root:

```bash
NETLIFY_AUTH_TOKEN=... NETLIFY_STAGING_SITE_ID=... npm run deploy:staging
```

The script performs these steps:

1. Builds the production bundle via `npm run build` (skip with `NETLIFY_SKIP_BUILD=true`).
2. Invokes the Netlify CLI to deploy the build artifacts to the staging alias (defaults to `staging`).
3. Prints the staging deployment URL upon success.

### Optional environment overrides

| Variable | Description | Default |
| --- | --- | --- |
| `NETLIFY_DEPLOY_ALIAS` | Alias used for the staging deploy. | `staging` |
| `NETLIFY_DEPLOY_MESSAGE` | Message shown in the Netlify deploy history. | `Staging deploy <timestamp>` |
| `NETLIFY_DEPLOY_DIR` | Directory containing the build artifacts. | `build` |
| `NETLIFY_SKIP_BUILD` | Set to `true` to reuse an existing build directory. | `false` |

## CI/CD integration

To integrate with CI, add the required environment variables as protected secrets and run `npm run deploy:staging` in the pipeline after tests pass. The command exits with a non-zero status when prerequisites are missing or the Netlify CLI reports a failure, making it safe for automated workflows.

## Troubleshooting

- **Missing credentials**: Ensure both `NETLIFY_AUTH_TOKEN` and `NETLIFY_STAGING_SITE_ID` are exported before invoking the script.
- **Build directory missing**: When skipping the build step, confirm the path provided in `NETLIFY_DEPLOY_DIR` exists.
- **Alias conflicts**: If another deploy is occupying the alias, set `NETLIFY_DEPLOY_ALIAS` to a unique value for the run.

For additional CLI options, review the [Netlify CLI deployment documentation](https://docs.netlify.com/cli/get-started/#manual-deploys). 
