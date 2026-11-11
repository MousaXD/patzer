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

## Follow-up after Agent D Batch 3 independent NO-GO (2026-11-11)

Agent D's `BATCH3-INDEPENDENT-CERTIFICATION-20261111.md` confirmed a real server-side
A -> B -> A stale-report resurrection at Agent A `fb6f39b`, Agent B `50ba0fe`,
Agent C `c6f12c1`. The game revision advanced from 0 to 2, while an analysis
valid at revision 0 became stale and an old report could still be read. **The
server-side failure is unresolved by frontend changes** and integration remains
**NO-GO**.

### New frontend hardening

- `GameAnalyzer` reads Agent A's `game.source_revision` and
  `analysis.source_revision`, `analysis.analysis_generation`,
  `analysis.source_hash` when the authoritative detail API supplies them.
- `reviewSourceKey` fails closed when an authoritative revision is missing,
  mismatched, malformed or the engine generation/hash is absent; a newly
  reanalyzed A with identical PGN and moves has a distinct key. Also includes
  `scoring_version` to prevent old score-model report reuse.
- Pre-A legacy standalone backends (which supply **none** of the source
  fields) retain the prior PGN/moves fallback for isolated local QA. This
  compatibility fallback is **not** independently sufficient for release;
  Agent A's authoritative fields and Agent B's server cache checks are
  required for the combined release.
- Added persistent unit A -> B -> A, same-evidence reanalysis, incomplete
  provenance and metadata tests, plus an actual Chromium browser case.
  Browser QA uses **QA-injected provenance fields** because Agent C's isolated
  backend predates Agent A's schema. It verifies React presentation only,
  not Agent A's SQLite triggers or Agent B's Hono behavior.

### Updated isolated validation

- `npm run typecheck` — PASS.
- `npm test -- --reporter=dot` — **755 PASS across 93 files**.
- `npm run build` — PASS.
- `node web/tests/review-practice.browser.mjs` — **22 PASS / 0 FAIL**
  in Playwright Chromium against disposable authenticated local data.
- No saved PGN mutation, main merge, production DB changes or deployment.

### Release blockers remain with their respective owners

1. **Agent B:** Cache GET and POST must bind to Agent A's authoritative
   `source_revision` **and** `analysis_generation`, not merely PGN/moves,
   and preserve the atomic `saveReviewIfFresh` guard. Expose an attested
   identity in both cached GET and SSE done responses so Agent C can accept
   a genuinely new valid cached report after a source change. Do not silently
   revive an old report on cold load.
2. **Agent A/B:** Confirm that A -> B -> A never reuses an obsolete analysis
   or report, and a new analysis generation permits a genuinely new report.
3. **Agent D:** Rerun all independent Chrome, Hono, concurrency and
   negative-control checks against fixed A+B+C, without changing frozen gold
   expectations just to make them pass.
4. **Integrator:** PR #17 still has five scoring-version fixture failures
   in `server/test/review-source-hono.test.ts` on the previous combined
   candidate. Reconcile fixtures, run the complete combined suite and
   independently verify the backup, migration, rollback and cache safety.

**This Agent C patch is not a release certification.** It cannot repair the
confirmed resurrected backend report or substitute for Agent D's independent
combined evidence. The integrator should not merge to main yet.
