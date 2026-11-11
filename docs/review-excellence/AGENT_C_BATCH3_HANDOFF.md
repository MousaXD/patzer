# Agent C — Batch 3 Game Review source lifecycle handoff

**Branch:** `agent/review-product-20261111` (isolated worktree). **Baseline:** `d72eace`.
**Scope:** frontend Game Review, locale strings, tests only. No backend, scoring, production SQLite, deployment or main edits.

## Defects addressed

- Mounted cached report: `GameAnalyzer` now associates locally retained prose with a source identity consisting of the exact saved PGN and selected saved engine analysis fields. An unchanged bookmark or notes refetch preserves it; a same-game source change immediately stops rendering it, including in Opening and Key Moments and when switching tabs.
- Active generation: `GameReportPanel` is remounted with the new source key on change. Its cleanup aborts the old SSE request and its stream handler additionally ignores events from an aborted or superseded controller. Transient progress disappears with the replaced panel. The parent callback refuses report results that do not belong to the current source.
- Stale evidence: full-game AI reports require an engine analysis whose move count, UCI (via the existing stored-analysis decoder) and before/after FEN all match the saved PGN replay. Incomplete, missing, corrupt or scoring-stale evidence disables new generation; the user sees an explanation instead of a fabricated report.
- Errors: backend identifiers such as `review_source_changed` and untrusted SSE error strings are never rendered raw. Localized explanatory/cancel/failure copy is in English, German, Spanish, Bulgarian and Russian. Blind practice, saved PGN, existing legal move checks and focus behavior are not intentionally modified.

## Verification evidence

- `npm run typecheck` — PASS.
- `npm test -- --reporter=dot` — **93 files, 752 tests passed**, no failures.
- `npm run build` — PASS.
- `node web/tests/review-practice.browser.mjs` — **21 PASS / 0 FAIL**, full actual Playwright Chromium UI against a separately initialized local API and disposable SQLite DB. QA evidence remains ignored under `qa-artifacts/review-practice-browser/results.json`.
- Added browser cases: cached report survives a bookmark-only refetch but not a same-game new PGN and new analysis; new same-length PGN during live SSE followed by a deliberately late `done` never displays old prose or an obsolete spinner. Existing browser suite covers blind practice, keyboard/focus, saved PGN immutability, browser Back, busy/error states, dark/light responsive layouts, and five locales.
- Added deterministic source-key unit tests for unchanged metadata, same-ply PGN swap, analysis revision, missing/stale evidence, and game ID separation.
- Self-audit found and fixed initial `null -> first verified source` transition being incorrectly flagged as a mutation; Chrome first run correctly exposed the regression (20 PASS/1 FAIL), and the subsequent full clean run passed (21/21).

## Integration contract / blockers (Agents A/B, integrator and PR #17)

1. **The current backend cached GET cannot attest source provenance.** On an already-mounted same-game change, frontend ignores the obsolete GET result, but on a cold page load an old server report could still arrive. Agent B must return a stable server-computed source identity on **both** `GET /api/games/:id/review` and POST SSE `done`; bind persisted prose to that identity (exact PGN source plus relevant analysis revision/scoring/version and audience/language). Agent C must compare it with `GET /api/games/:id` before displaying or accepting any report, including cold loads and new valid reports after updates. Until then release certification is **blocked**; the local string identity is a conservative temporary guard, not a backend trust boundary.
2. Agent B's existing atomic `saveReviewIfFresh` is essential. Keep its compare-and-swap; do not loosen it to make an aborted generation finish. Frontend cancellation does not guarantee a model stops server-side instantly.
3. Agent A should provide a single canonical PGN/analysis source contract that is stable across harmless metadata edits, distinguishes same-ply changes and engine recomputation, and changes for scoring-version revisions. Do not compare timestamps alone.
4. **PR #17 touches `Review.tsx`**. No edits to `Review.tsx` in this batch; preserve PR #17 scoring UI changes while integrating the new frontend checks and audit cached prose compatibility with the selected accuracy version. No scoring migrations have been run.
5. Current browser regression uses synthetic local games and intercepted cached GET / SSE payloads for deliberate late events, not a real hosted LLM or a production incidence estimate. A/B's combined native backend source-token integration and independent Agent D Checkpoints 32–35 must be re-run before merge/release. Long-running Chrome/real accessibility device testing remains independent QA work.

**No merge or deployment authorized by this handoff.** Obtain integrator review, source-contract alignment and separate release certification.
