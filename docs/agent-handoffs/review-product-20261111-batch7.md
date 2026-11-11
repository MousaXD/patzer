# Agent C — Batch 7: stale-refetch race during an active practice retry

Date: 2026-11-11 (Asia/Dubai) · Branch: `agent/review-product-20261111`.

## Resumed checkpoint

- Continued from committed/pushed `2a72364436ac0a90828b7306839e7199f1432f83`, after reading the Batch 6 handoff and the existing Game Review effects, React Query setup, bookmark mutation and permanent Chromium QA.
- Checked other review branches **read-only**: Agent A `7178e26`, Agent B `4f7a2b1`, benchmark agent `1962bf0`, and independent accuracy PR #17 `02bfe98`. No new overlap on Agent C practice files; the earlier `Review.tsx` practice-link and PR #17 accuracy-label edits still require integrator reconciliation.
- Did not cherry-pick, merge, change backend contracts, scoring or coach logic, modify SQLite schemas, touch production or change `main`.

## Verified defect / root cause

**Before:** In `GameAnalyzer.tsx`, cached-analysis hydration and an automatic stale-analysis side effect shared the same `useEffect`. The stale guard checked `!practicePicker` but **not `practicePly === null`**. After an ordinary bookmarked-game mutation invalidated React Query's `['game', gameId]` key, a delayed game-detail refetch could return `analysis_stale: true` after the player had entered an in-review mistake retry. The UI correctly showed a safe “Practice position unavailable” state, but it secretly fired `POST /api/analyze` for an expensive full-game Stockfish job while no full review was visible.

This was **reproduced using a real bookmark button and its natural query invalidation**, not by editing private React internals. The permanent browser negative control intercepts only the disposable game's refetched `GET /api/games/{id}` response, intentionally delays it and supplies a stale flag. It observes/counts attempted analysis POSTs and replies with HTTP 503 to avoid starting real background full-game analysis in the negative control. On the old code: **12/13 practice-browser checks passed; this new test failed because the hidden POST count was 1 instead of 0**. The original PGN remained unchanged.

## Frontend-only fix

- Keep analysis hydration in an effect keyed to actual `data`, decoded cached review and game identity, rather than redoing that work on every practice-open/close transition.
- Move automatic stale reanalysis into a narrowly scoped effect. Only start it when `data.analysis_stale`, full Review is visible, the engine is not already analyzing, **neither the direct picker nor in-review retry is active**, and the data/entry state changes.
- Recheck when the player explicitly returns to full Review so a stale result can be refreshed there. Deliberately do **not** use `analyzing` as an effect dependency; an HTTP failure should not become an unbounded automatic reanalysis loop on the same stale snapshot.
- Keep the existing cancellation and error behavior from Batch 4, visible safe recovery from Batch 2, and original PGN immutability.

After the correction, the permanent browser test shows **0 hidden full-game POSTs** while an in-review retry is active, then **exactly 1 explicit full-Review stale reanalysis attempt** after returning; that request is intentionally made to fail in QA to prove no automatic retry loop. No PGN write occurs.

## Local validation

- `npm run typecheck`: **PASS**, server, frontend and test TypeScript.
- `npm run build`: **PASS**, server + production frontend.
- Permanent `web/tests/review-practice.browser.mjs`, real Chromium + local Stockfish + isolated synthetic SQLite: **13/13 PASS**. Contains the new actual-bookmark/refetch/active-retry race, stale picker isolation, engine cancellation, corrupt/error/429 feedback handling, mate-spoiler protection, SAN/UCI and legal-move keyboard input, tactile mobile, 7 viewport widths, light/dark, focus and unmodified PGN. Artifacts ignored at `qa-artifacts/batch7-stale-race-fixed/`.
- `npx vitest run --maxWorkers=2`: **92/92 test files and 739/739 tests PASS**, default five-second per-test timeout unchanged, 26.46s total. Earlier unrestricted worker contention is documented in Batch 2; this is not a claim about unrestricted-concurrency CI.
- Existing `qa/agent07/frontend-overhaul-smoke.mjs`: **35/35 PASS**, real Chromium/Stockfish with disposable SQLite, including responsive, keyboard, focus, security and chess legality checks. Artifacts ignored at `qa-artifacts/batch7-existing-smoke/`.
- Diff and staged file scopes must be verified before commit. This report intentionally records the **initial failing negative control** as well as the fixed result; it does not erase the failed baseline.

## Remaining dependencies and next safe investigation

1. The existing authenticated full game-detail API still sends engine best-move data to the browser even in blind mode. Strong network-level non-disclosure would require an approved reduced practice DTO, owned by Agent A/the integrator; don't silently change that backend contract here.
2. Real screen-reader hardware, Firefox/Safari, cross-agent integrated exact-head CI and equivalent-best evidence validation are not certified. The FEN text option is a useful accessibility fallback, not a WCAG certification.
3. The earlier `web/src/pages/Review.tsx` practice-entry change may conflict with PR #17 accuracy copy; integrator reconciliation is still required.
4. Further investigation should prioritize a reproducible, high-impact frontend finding instead of speculative rewrites, especially failed-HTTP user journeys, exact-head combined-tree behavior and accessibility on real assistive technology.

## Checkpoint

After committing and pushing, retrieve the **exact** SHA with `git rev-parse HEAD` and verify it against `git ls-remote --heads origin agent/review-product-20261111`. This tracked document cannot record its own future commit SHA. Do not stage `qa-artifacts/`, local engine binaries or test databases. Do not merge into `main` or deploy.
