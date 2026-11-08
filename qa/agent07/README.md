# Agent 07 — Independent Frontend QA

Only QA automation and reporting live in this directory. No production source or existing tests are altered.

## Reproduce independently

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run setup
npm install --prefix /tmp/patzer-qa-pw --no-audit --no-fund playwright
ln -sfn /tmp/patzer-qa-pw/node_modules/playwright node_modules/playwright
/tmp/patzer-qa-pw/node_modules/.bin/playwright install chromium
node qa/agent07/frontend-overhaul-smoke.mjs
```

The script boots the real built server against a disposable SQLite database on port 8894, creates an admin account, seeds PGNs, uses a real Chromium browser, exercises the five requested viewport sizes in both themes, and saves screenshots and JSON results under `qa-artifacts/frontend-overhaul` (override with `PATZER_QA_ARTIFACTS`). It separately requests a real Stockfish analysis. All checks are fail-closed: any failed case causes a nonzero exit status.

**Warning:** This branch was based on pre-overhaul `main`; expected acceptance tests will fail on the baseline, and do not represent regressions in unavailable agent work. A passing QA-branch run cannot certify `feat/patzer-frontend-overhaul`. Certification requires the merged integration SHA, full existing regression CI, independent browser evidence, reviewed screenshots, and human listening for the sound quality.

The additional security browser case checks authentication/authorization, cross-user game isolation, CSRF protection and CSP/X-Frame headers in the disposable test server. QA branch pushes are validated by the open QA PR (without a redundant duplicate push run); integration pushes trigger the same workflow independently.

Existing `npm run test:ui`, `npm run test:resume-ui`, SSO, protocol, Docker and unit suites remain required. Chromium does not certify Firefox, Safari/WebKit, or actual audio perception. Visual screenshots require a human review; saving screenshots is not a pixel-diff test.

See `docs/audits/frontend-overhaul-qa.md` for release gates, ownership and unresolved work. Do not merge this QA branch into `main` merely because the intended integration target is absent.
