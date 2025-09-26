# Staging Deployment & Final QA Checklist

Use this checklist to coordinate staging releases without disrupting the existing interface. The steps are designed for enterprise-grade rigor and can be followed by any release manager or engineer.

## 1. Pre-flight Validation

1. Run automated test suites:
   - `npm test`
   - `npm run qa:conflicts`
2. Confirm the working branch is rebased on the latest `main` and free of merge commits.
3. Verify environment variables required by Netlify Functions are present in the staging workspace.

## 2. Build Verification

1. Execute `npm run build` to produce the deployable artifact.
2. Inspect the generated `build/` directory to ensure the following assets exist:
   - `index.html`
   - `app.js`
   - `app.css`
   - `netlify/functions/*`
3. Run the local Netlify dev server (`npm start`) and spot-check the major surfaces:
   - AI Analyst
   - Quant Screener
   - Valuation Lab
   - Professional Desk

## 3. Staging Deployment

1. Deploy the build to the staging environment using the Netlify dashboard or CLI.
2. Confirm deployment metadata (commit SHA, branch name, and timestamp) is documented in the release tracker.
3. Share the staging URL with QA and stakeholders.

## 4. Final QA Pass

1. Execute the manual regression plan documented in [`docs/manual-testing/e2e-regression-plan.md`](./e2e-regression-plan.md).
2. Capture screenshots or recordings of critical workflows, noting any anomalies.
3. Log defects in the issue tracker with reproduction steps and environment details.

## 5. Release Sign-off

1. Ensure all open defects are triaged and resolved or explicitly waived by stakeholders.
2. Re-run `npm run qa:conflicts` and `npm test` after fixes are applied.
3. Obtain sign-off from engineering, QA, and product before promoting the build to production.
4. Archive the checklist in the release documentation repository for auditability.
