# Agent C — Batch 12: preserve focus during engine scoring retries

Date: 2026-11-11 (Asia/Dubai) · Branch: `agent/review-product-20261111`.

## Recovered checkpoint and scope

- Resumed from committed/pushed Batch 11 `a3c3a0413d787092e404e9c82b7233902ae8eb83` with a clean tracked worktree. Read the previous handoff and existing frontend retry state, unit tests and permanent disposable Chromium practice QA.
- Read-only fetched remote branches: Agent A `7178e26`, Agent B `19c359e`, Agent D `389b9b5`, and PR #17 `02bfe98`. Their changes do not overlap this batch's current practice component or test files. PR #17 still edits `Review.tsx`, which earlier Agent C batches also touched; reconciliation is an integrator responsibility.

## Reproduced focus defect

**Before:** After Stockfish returned a busy/unavailable or mismatched result, a keyboard user could press **Retry scoring**. The request effect then cleared the error message, unmounting its Retry button. As the second request remained pending, the browser's active element became `BODY`. Keyboard users lost their place in the practice flow and had to find controls again.

**Negative-control evidence:** The first draft of the permanent browser test passed too early, while the old error button was still mounted in the optimistic `pending` render. The test was adversarially corrected to wait until the previous error had *actually disappeared*. On unchanged production code, this stronger test failed: **18/19 browser checks passed**, but the new check showed `document.activeElement` was `BODY`, not the retry action. This distinguishes a verified bug from a timing-dependent false pass.

## Narrow fix

- Add a ref to the **persistent** Cancel check / Try another move button. When the Retry button is activated, synchronously focus that stable control **before** clearing the old error and starting another scoring request.
- Guard the retry handler while a request is pending or no legal attempt exists. The existing cancel/try-another button continues to act as a real action throughout both pending and final states. Its accessible name updates to **Cancel check and try another move** while checking, then **Try another move** when complete.
- Do not replace the existing live `role=status` pending/verified-feedback announcements or `role=alert` failure feedback. Do not auto-focus after the async engine response (which could interrupt someone navigating the panel).
- No backend scoring behavior, cached analysis, chess legality, game PGN, network request contract or retry limit changed.

## Tests and actual outcomes

- New focused React test reproduces two attempted engine requests with a deferred second failure; asserts that the Retry error button disappears while focus stays on the persistent Cancel button, then stays on Try another when failure returns. Focused unit suite: **16/16 PASS** across the two practice test files.
- Permanent `web/tests/review-practice.browser.mjs` tests failed-first-then-retried HTTP 503 with delayed response. Stronger browser negative control: **18/19 PASS before**, **19/19 PASS after**. Another existing real Stockfish retry test now asserts focus also remains on Try another after **successful** engine feedback, not only on failure.
- `npm run typecheck`: **PASS**; server/web/test TypeScript.
- `npm run build`: **PASS**; server and Vite production bundle.
- `npx vitest run --maxWorkers=2`: **747/747 PASS across 92 test files**, original five-second per-test timeout; 23.72 seconds overall. No claim of unrestricted CI worker stability.
- Original `qa/agent07/frontend-overhaul-smoke.mjs` with isolated Chromium, Stockfish and disposable SQLite: **35/35 PASS**, including keyboard/focus, game isolation, PGN immutability and responsive themes.
- Chromium tests use only disposable account/game data. Local evidence is ignored under `qa-artifacts/batch12-retry-complete/` and `qa-artifacts/batch12-original-smoke/`; no screenshot, test database or engine binary is staged.

## Boundaries, residual risks and next continuation

- Changes are limited to `MistakePractice.tsx`, its React test, permanent practice browser QA and this handoff. No SQL, auth, shared DTO, engine formula, LLM, updater, release/deployment config, remote `main` or running application modifications.
- Real screen-reader hardware testing and Safari/Firefox remain unperformed; Chromium focus assertions improve evidence but are not a WCAG certificate.
- The full game-detail response still exposes cached engine suggestions at the network layer; a reduced practice DTO requires Agent A/integrator approval.
- PR #17's `Review.tsx` overlap and Agent D's independently demonstrated backend AI-prose language/provenance defect remain integration responsibilities, not fixes made in this lane.
- Next justified work: audit the **verified-result learning content** and keyboard read order with accessible announcements, or help integrator verify combined branches after a candidate exists. Avoid speculative changes, duplicate scoring implementations or uncontrolled engine/LLM jobs.

## Checkpoint

After verifying the staged scope and `git diff --check`, commit and push only `agent/review-product-20261111`. Compare `git rev-parse HEAD` to `git ls-remote --heads origin agent/review-product-20261111` and report the exact pushed SHA. The tracked report cannot contain its own future commit SHA. Do not merge into `main` or deploy.
