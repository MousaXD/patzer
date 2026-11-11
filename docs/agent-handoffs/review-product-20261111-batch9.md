# Agent C — Batch 9: blind-practice browser history, return, and interrupted scoring

Date: 2026-11-11 (Asia/Dubai) · Branch: `agent/review-product-20261111`.

## Resume checkpoint

- Started from the already-pushed Batch 8 commit `92b6171b45075933ad40cba0ad9d1c8c7821a9f9`; the worktree had no tracked changes (only untracked, isolated `qa-artifacts/`).
- Reviewed the prior Agent C handoff and the existing React Router `GameAnalyzer` practice state, focus effects, saved-game replay, and permanent Chromium QA. No redesign of the previously delivered spoiler-free learning experience.
- Read-only latest fetched remote heads: review-engine Agent A `7178e26`, coach Agent B `19c359e`, benchmark Agent D `2ca55ef`, and independent accuracy PR #17 `02bfe98`. Their changed-file lists have **no overlap with the current Batch 9 practice UI/test files**. PR #17 still edits `web/src/pages/Review.tsx`, which Batch 2 also touched; the integrator must review that shared file in the combined tree. No cherry-picks or merges.

## Verified before-state defects

1. **Browser Back skipped the picker.** Direct library entry navigated to `?practice=1` but selecting a mistake updated only React component state. Browser Back from the active blind attempt therefore returned to the game library, unexpectedly abandoning the practice flow. A permanent real-Chromium regression test reproduced the failure (**13 passed, one failed** on its initial run).
2. **Explicit return duplicated the picker history entry.** A first attempt to correct the behavior pushed a practice-moment URL and replaced it with a second picker URL on explicit return. Browser Back then landed on a second, visually identical picker instead of the library. This was reproduced as a second failing assertion (**13/14 passes** before the correction).
3. **Two focus effects competed after a direct-link exit.** A direct `?practice=1&practicePly=5` entry has not mounted the picker first. On exit, the picker-initial-focus effect could override the more specific selected-moment focus, which the new regression test reproduced (**15/16 passes** before the focus sequencing correction).

## Scoped implementation

- Blind practice entered from the saved-games library uses a distinct, validated `?practicePly=N` URL parameter while preserving `?practice=1`. This stores only a move number, not played SAN, Stockfish best UCI, PV or engine scoring. The app still verifies the selected candidate against the saved PGN before mounting the isolated exercise.
- React Router Back restores the spoiler-free picker; Forward recreates a fresh, **unattempted** practice board. The original PGN, score cache and persisted game are not changed.
- An explicit return uses `navigate(-1)` **only** for practice entries whose router state confirms they came from the picker, preventing duplicate picker history entries. A directly opened/bookmarked exercise URL without known picker history safely removes `practicePly` with `replace: true`, rather than navigating to an unrelated previous page.
- Restore the prior keyboard-focus behavior: browser Back focuses the picker heading, explicit return focuses the selected moment, and entering the exercise focuses its heading. Coordinated these effects so a direct URL entry does not create competing focus requests.
- The normal in-review retry remains transient and independent; global chess shortcuts, cancellation of in-flight requests, stale result rejection, and existing safe recovery states remain intact.

## Adversarial tests and evidence

- Permanent `web/tests/review-practice.browser.mjs` now includes browser Back/Forward, explicit-return history correctness, direct exercise URLs, invalid/unavailable practice plies, and Back while an engine scoring request is pending. That request is intercepted and made deliberately late to ensure its response cannot reappear when Forward opens a fresh retry; the stored PGN must be byte-for-byte unchanged.
- **Final permanent Chromium browser QA: 16/16 PASS** (local Stockfish, disposable SQLite account/games, loopback, light/dark, seven viewport widths, mobile touch, focus, PGN integrity and previous negative controls). Artifacts remain ignored at `qa-artifacts/batch9c-history-controls/`.
- `npm run typecheck`: PASS.
- `npm run build`: PASS (server TypeScript + production frontend).
- `npx vitest run --maxWorkers=2`: **739/739 PASS across 92 test files**, original 5-second per-test timeout, 24.94 seconds total. Historical unrestricted worker scheduling flakiness remains separately documented; this is not a claim of unrestricted CI.
- Original `qa/agent07/frontend-overhaul-smoke.mjs` with disposable SQLite and local Stockfish: **35/35 PASS** across chess move legality, game isolation, keyboard/focus, responsive light/dark, touch simulation and saved PGN invariants. Evidence at ignored `qa-artifacts/batch9-original-smoke/`.
- `git diff --check`: PASS. Only `GameAnalyzer.tsx`, the permanent disposable browser test, and this handoff are staged for the checkpoint. Untracked local `qa-artifacts/` remains excluded.

## Boundaries and integration dependencies

- The entire change is frontend route/UI behavior, the permanent disposable-browser QA, and this handoff. No modified scoring, coach claims, auth, SQLite migration, game API, CI/deployment/updater, production app, credentials, or `main`.
- The full game-detail API still returns saved engine suggestions to authenticated clients; strong **network-level** blind-mode secrecy would require a reduced practice-response DTO approved by Agent A/the integrator. UI spoiler protections remain verified only at the browser presentation layer.
- Agent A/B evidence contracts, PR #17 accuracy copy adjacent to Batch 2's `Review.tsx` link, hardware accessibility and combined-tree exact-head validation remain integrator or specialist responsibilities.
- Forward intentionally starts an unattempted ephemeral exercise; it does not resume an old graded attempt or mutate the original saved game.

## Final checkpoint

Before committing, verify `git diff --check`, full unit/browser results, staged file scope and the latest agent branch heads. Push only `agent/review-product-20261111`. Obtain the commit SHA from `git rev-parse HEAD` and compare it to `git ls-remote --heads origin agent/review-product-20261111`. This handoff cannot include its own future SHA. Never stage the generated `qa-artifacts/` directory or other local test data.
