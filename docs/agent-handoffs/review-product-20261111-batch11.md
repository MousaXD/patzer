# Agent C — Batch 11: accessible attempted-move handoff and contradictory engine evidence

Date: 2026-11-11 (Asia/Dubai) · Branch: `agent/review-product-20261111`.

## Resume and ownership

- Continued from committed/pushed Batch 10 `ee4b61168ce61ac615e8efa77bc5ae56698ac5cf`; recovered the clean tracked tree and previous handoff instead of restarting the audit.
- Latest read-only remote heads at investigation: Agent A `7178e26`, Agent B `19c359e`, Agent D `132b462`, accuracy PR #17 `02bfe98`. None changes the two current practice component files or the permanent practice-browser test. PR #17 still touches earlier Agent C `Review.tsx` changes and needs integration reconciliation.
- Read Agent D's independent checkpoint-12 findings: a **profile-language change during in-flight AI review generation** can commit old-language AI prose and leave it ineligible for auto-regeneration. This is a separate **Agent B/integrator backend caching dependency**, not the localized, user-initiated blind-practice input flow. Do not overwrite or silently repair another owner's cache logic.

## Reproduced issues, with negative controls

1. **Keyboard focus lost after submitting a move.** The blind retry's typed-move form unmounted once a legal move was submitted. Browser focus fell to the document body instead of the newly displayed attempt/result. Real disposable Chromium first reproduced this defect: **17/18 checks passed, the new keyboard focus check failed**. It could leave keyboard and screen-reader users without an announcement of what they played or how to retry.
2. **Contradictory scored-move evidence accepted.** `verifiedPracticeQuality` rejected `is_best: true` when the reported top UCI was different, but accepted `is_best: false` when that top UCI was exactly the submitted move. A fabricated but otherwise coherent mock response would display a verified-looking assessment and tell the player another move was preferred **even though the alleged top candidate was the player's move**. This was reproduced as **2 failing focused tests out of 15** against the previous verifier (unit rejection and React error-state assertion).

## Narrow frontend corrections

- Add a focusable `h2#practice-attempt-heading` for the submitted SAN. On the transition from pre-attempt to committed attempt, move focus to the new result heading **once**; the existing `role=status` live region continues reporting pending/successful engine scoring without stealing later user focus. When **Try another move** or **Cancel check and try another move** resets the exercise, restore focus to the newly mounted legal-move input, not a removed form or the introductory heading. Preserve original per-game PGN, chess legality and request cancellation.
- Require bidirectional consistency between `quality.is_best` and `quality.best_move_uci === attempt.uci`. Do **not** infer best-move status or rewrite engine scoring; reject a contradictory backend response as *unverified*, with the existing honest error and retry control. Confirmed that the server's existing variation-scoring producer computes `isBest = pre.bestMoveUci === request.move_uci`, so this is enforcement of its published semantics, not a competing accuracy implementation.
- Permanent `web/tests/review-practice.browser.mjs` now asserts focus after keyboard form submission and after an interrupted evaluation/reset. An existing three-failure-response test now includes an authentic-shaped, self-contradictory score (top UCI equals attempted UCI, `is_best=false`), then confirms no fabricated result is shown and subsequent real Stockfish retry still works.

## Verification and evidence

- Focused `MistakePractice.test.tsx` and `mistakePractice.test.ts`: **15/15 PASS** after correction, including focus restored after cancel and the contradictory-response failure control.
- `npm run typecheck`: **PASS**; server, web, test TypeScript.
- `npm run build`: **PASS**, server compilation and Vite production build.
- Real Chromium + local Stockfish + disposable SQLite `web/tests/review-practice.browser.mjs`: **18/18 PASS** after the correction, including the new keyboard focus regression, contradictory score rejection, and all prior blind secrecy/cancellation/history/locale/touch/responsive tests. Evidence is ignored at `qa-artifacts/batch11-final-negative/`. No live database or running app was touched.
- `npx vitest run --maxWorkers=2`: **746/746 PASS across 92 test files**, default five-second per-test timeout unchanged; 23.23s overall. This does not certify unrestricted worker concurrency or remote CI.
- Original `qa/agent07/frontend-overhaul-smoke.mjs` with disposable SQLite and local Stockfish: **35/35 PASS**, including game isolation, chess legality, keyboard interaction, focus, theme/responsive behavior and PGN immutability. Ignored evidence: `qa-artifacts/batch11-original-smoke/`.
- `git diff --check` and exact staged file scope are validated before the push; local screenshot/test artifacts and engine binaries remain untracked.

## Boundaries, dependencies and next work

- Changed only Agent C frontend practice code, adjacent component tests, the permanent browser QA script and this handoff. No backend, shared DTO, migration, score algorithm, coach, user data, updater, CI/deployment or `main` changes.
- Network-level spoiler secrecy remains unverified because `GET /api/games/{id}` exposes cached engine hints. The integrator/Agent A must authorize a reduced practice DTO before that can be promised.
- Agent D's profile-language AI-prose cache race remains owned by Agent B/integrator. The browser's translation/localization of practice errors does not remediate it. PR #17's `Review.tsx` conflict and combined-tree QA remain integrator work.
- Real hardware screen readers, physical touch/zoom, Safari/Firefox, combined-branch release certification and measured learning outcomes remain untested; passing Chromium assertions are not a WCAG certificate.
- Next safe focus: independently reproduce remaining keyboard/dialog/failure-state issues or perform exact-head integrated UX QA **after** the integrator provides a combined candidate. Avoid speculative changes and uncontrolled engine/LLM jobs.

## Final checkpoint

After broad tests, review `git diff --check` and staged file scope; commit and push only `agent/review-product-20261111`. Record SHA from `git rev-parse HEAD` and verify against `git ls-remote --heads origin agent/review-product-20261111`. Do not stage `qa-artifacts/`, binaries or test databases. This tracked handoff cannot contain its own future commit SHA.
