# Production Deployment & Project Retrospective

This document captures the operational playbook for promoting Netlify Trading releases to production, along with a retrospective summary from the most recent release cycle. It is designed to keep delivery practices consistent across teams, document institutional knowledge, and minimize merge or release conflicts in future iterations.

## Deployment Overview

- **Primary target**: Netlify Production workspace (`trading.netlify.app`).
- **Secondary target**: Netlify staging workspace (`trading-stage.netlify.app`) for pre-production burn-in.
- **Release cadence**: Bi-weekly (Tuesdays, 15:00 UTC) or ad-hoc for critical hotfixes.
- **Change scope**: AI Analyst, Quant Screener, Valuation Lab, and Professional Desk surfaces, including shared Netlify functions, static assets in `build/`, and infrastructure configuration under `netlify.toml`.
- **Deployment owner**: Release captain of the sprint (rotates per iteration), supported by site reliability engineering (SRE) liaison and QA signatory.
- **Escalation contacts**: PagerDuty rotation `netlify-trading-release` (primary) and Engineering Manager on-call (secondary).

## Environment Readiness Checklist

1. **Branch hygiene**
   - Confirm `main` is green in CI, and `origin/main` is merged into the release branch within the last 12 hours.
   - Validate that branch protection requirements are satisfied (status checks, code review, lint/test gates).
   - Ensure release branch contains a signed-off change log summarizing deltas by surface area.
2. **Dependency verification**
   - Run `npm install` using the locked versions in `package-lock.json` to ensure deterministic builds.
   - Execute `npm test` to validate unit coverage and mock contract tests.
   - Capture the test summary artifact and attach it to the release ticket.
3. **Configuration sync**
   - Compare environment variables between `netlify/.env.production` and Netlify dashboard secrets; reconcile deviations before release.
   - Confirm feature flags in `data/feature-flags.json` are updated with default fallbacks.
   - Validate analytics tokens, API keys, and OAuth redirects against compliance checklist.
4. **Database & API contracts**
   - Smoke test Tiingo, Polygon, and internal quote service integrations using `node tests/test-tiingo.js`.
   - Review API quota dashboards for headroom (≥25% daily quota remaining).
   - Re-run schema snapshot diff for internal APIs; flag backward-incompatible changes to SRE.
5. **Operational readiness**
   - Confirm observability dashboards are healthy and alerting destinations are on-call ready.
   - Schedule release war room invite with product, engineering, SRE, and support representatives.

### Go/No-Go Requirements

- **Green CI** (unit, integration, lint) recorded in release ticket.
- **Uptime** ≥ 99.5% in previous 7 days per Datadog.
- **Pending incidents**: none with severity ≥ 2 open longer than 12 hours.
- **Stakeholder approvals**: product, design, SRE, QA sign-offs recorded using Jira checklist template.

## Deployment Procedure

1. **Build artifacts**
   - `npm run build`
   - Inspect `build/` output for hashed assets and ensure Netlify functions include updated dependencies.
   - Publish build manifest summary (commit SHA, artifact size, checksum) to release ticket for traceability.
2. **Package validation**
   - Upload `build/` to the staging workspace (`trading-stage.netlify.app`) via `netlify deploy --dir=build --message="<release-tag>" --alias=stage`.
   - Perform smoke tests using the regression plan in [`docs/manual-testing/e2e-regression-plan.md`](manual-testing/e2e-regression-plan.md).
   - Record staging validation evidence (screenshots, logs) in the release ticket.
3. **Change approval**
   - Capture approvals from product, QA, and SRE in the release ticket. Document all sign-offs in the `Release Checklist` section of the ticket template.
   - Conduct a 15-minute Go/No-Go call to confirm readiness and designate the real-time commander.
   - Tag the release commit: `git tag -a release-YYYYMMDD -m "Release YYYY-MM-DD" && git push origin --tags`.
4. **Production promotion**
   - Promote staging build: `netlify deploy --prod --dir=build --message="Release YYYY-MM-DD"`.
   - Confirm the production URL returns HTTP 200, assets load from CDN, and serverless functions respond with 2xx.
   - Update status page with release window and completion notice.
5. **Post-deploy confirmation**
   - Monitor logs via Netlify Analytics and Datadog dashboards for 30 minutes.
   - Run canary scenarios in production (AI Analyst summary generation, Quant Screener filter, Valuation Lab spreadsheet export).
   - Capture metrics snapshot (Core Web Vitals, API error rate) and attach to release ticket within 2 hours.

### Cutover Timeline (UTC)

| Time | Activity | Owner |
|------|----------|-------|
| 14:30 | War room opens, verify on-call presence | Release captain |
| 14:40 | Deploy to staging, execute smoke tests | QA lead |
| 14:55 | Go/No-Go checkpoint, confirm approvals | Product & SRE |
| 15:00 | Promote to production, monitor deploy | Release captain |
| 15:10 | Execute production canaries | QA lead |
| 15:30 | Post-release sign-off, update status page | Release captain |

## Rollback Strategy

- **Immediate rollback**
  - Re-deploy the last known-good tag: `netlify deploy --prod --dir=build --message="Rollback to release-YYYYMMDD" --prod-branch release-YYYYMMDD`.
  - Restore feature flag overrides in the Netlify dashboard to previous values.
  - Annotate Datadog deployment markers to flag the rollback window for analytics correlation.
- **Hotfix flow**
  - Branch from the offending release tag, apply fixes, and open a `hotfix/<issue>` branch with expedited code review.
  - Follow the standard deployment procedure with additional validation on impacted modules.
  - Document root cause and mitigation in the incident ticket before closing the hotfix.
- **Incident communication**
  - Page on-call via PagerDuty and update the status page. Maintain updates every 30 minutes until resolution.
  - Notify stakeholders in `#trading-release` Slack channel with customer impact summary and next checkpoint.

### Rollback Decision Matrix

| Severity | Trigger | Action | Owner |
|----------|---------|--------|-------|
| Sev-1 | Production outage or P0 alert | Immediate rollback, initiate incident bridge | Release captain |
| Sev-2 | Core workflows degraded (p95 latency > 5s) | Evaluate hotfix vs rollback within 10 minutes | SRE liaison |
| Sev-3 | Non-blocking bug with workaround | Schedule hotfix within 24 hours, no rollback | Product owner |

## Observability & Quality Gates

- **Metrics**: track Core Web Vitals (LCP, FID, CLS), API success rate, and function cold start latency.
- **Alerts**: Netlify function error rate >2% over 5 minutes, SPA load time >3s on p95, Tiingo quota usage >85% daily.
- **Logging**: centralize logs via Netlify Log Drains to Datadog with structured JSON fields for traceability.
- **Security**: confirm Dependabot alerts resolved before release; rerun `npm audit --omit=dev` for runtime dependencies.
- **Data governance**: confirm analytics sampling adheres to privacy policy; update audit trail with deploy metadata.

### Automated Gates

- GitHub Actions pipeline enforces lint, unit, and contract test success.
- Netlify build plugin verifies environment variable presence before deploy.
- Datadog synthetic monitors must pass within 15 minutes of staging deploy before production promotion.

## Retrospective Summary (Release 2024-03-12)

### What Went Well

- ✅ Successful rollout with zero downtime and green health checks across all observability dashboards.
- ✅ Automated smoke suite in staging caught regression in Valuation Lab CSV export, preventing production incident.
- ✅ Coordinated release walkthrough ensured design, product, and SRE alignment prior to promotion.

### What Was Challenging

- ⚠️ Manual feature flag toggles introduced risk; lack of automation required late-night coordination across time zones.
- ⚠️ API quota monitoring lacked predictive alerts, leading to reactive scaling discussions.
- ⚠️ Inconsistent Git branching prefixes created confusion during cherry-pick of the hotfix request.
- ⚠️ Release runbook updates were scattered across Confluence spaces, making it harder for new engineers to onboard quickly.

### Action Items

| Priority | Owner | Action | Target Date |
|----------|-------|--------|-------------|
| High | Platform Engineering | Automate feature flag toggles via Netlify API script integrated into release pipeline. | 2024-03-26 |
| High | SRE | Implement Datadog monitors for Tiingo and Polygon quota thresholds with Slack notifications. | 2024-03-20 |
| Medium | Developer Experience | Enforce branch naming via pre-commit hook and update contributing guidelines. | 2024-03-22 |
| Medium | QA | Expand staging smoke suite to cover Professional Desk reconciliation workflow. | 2024-03-29 |
| Medium | Documentation Guild | Consolidate runbook updates into single Docs site with versioning. | 2024-03-28 |
| Low | Product Ops | Publish release calendar and sign-off checklist in Confluence. | 2024-03-31 |

### Lessons Learned

- Invest in automation for release toggles and branching conventions to reduce cognitive load and avoid merge conflicts.
- Maintain proactive capacity planning for external APIs to prevent near-misses during market volatility.
- Continue cross-functional release rehearsals; they improved confidence and surfaced integration gaps early.
- Consolidated documentation lowers onboarding friction; single source of truth should be enforced through doc reviews.

### Next Steps

1. Track action items in the shared Jira board with linked owners and due dates.
2. Schedule a mid-sprint checkpoint to review automation progress.
3. Prepare the next release candidate with feature flags defaulting to safe states, aligning with the "stay consistent with current interface" directive.
4. Draft quarterly release health report summarizing SLA adherence, rollback frequency, and outstanding action items.

## Compliance & Audit Readiness

- Store deployment manifests, approvals, and post-release validations in the centralized compliance folder for quarterly audits.
- Ensure SOC 2 evidence collection includes release ticket IDs and linked monitoring dashboards.
- Retain deploy logs for 13 months to satisfy enterprise retention requirements.

## Appendices

### Release Ticket Template

1. Summary of changes grouped by product surface.
2. Linked PRs with reviewer acknowledgements.
3. Checklists for readiness, validation, and post-deploy tasks (auto-generated via Jira Automation).
4. Evidence attachments (test results, screenshots, monitoring exports).

### Stakeholder Communication Matrix

| Audience | Channel | Frequency | Owner |
|----------|---------|-----------|-------|
| Customer Support | `#trading-support` Slack | Pre/post release | Product Ops |
| Executive Sponsors | Email digest | Post release (same day) | Engineering Manager |
| Broader Org | Changelog in Notion | Weekly | Product Marketing |

---

_For any updates to this playbook, submit a PR referencing the release ticket and ensure reviewers from Engineering and SRE sign off to keep institutional knowledge current._
