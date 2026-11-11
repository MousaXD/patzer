# Patzer Batch 3 + PR #17 — single consolidated candidate

> Historical handoff, preserved as the recovery record. Its unexecuted-test
> status is superseded by [final certification](FINAL-INTEGRATION-CERTIFICATION-20261111.md)
> and [migration safety evidence](FINAL-MIGRATION-SAFETY-20261111.md).

**Release verdict: NO-GO until tests actually execute.** This is a local, uncommitted integration worktree. It is not a statement that the fixes pass.

## Candidate identity and locations

- Primary final-candidate checkout: `/home/mousa/projects/my-creations/game/.patzer-cert-pr17-20261111`
- Pre-edit A+B+C+D+PR17 candidate from Agent D's report: `f23385d0e8d885d7e4b280800c129b83a8604d3d`
- Underlying four heads: A `fb6f39b`, B `50ba0fe`, C `c6f12c1`, D `8fd64d2`, PR17 `02bfe98` at last audit. Re-fetch before deciding to merge.
- Historical negative reproduction: `scripts/review-benchmark-batch3-aba.mjs` on the independent Agent D QA branch correctly failed against old code; new code still requires a passing independent run.
- An earlier four-way *without* PR17 also has the same source-integrity edits at `.patzer-cert-batch3-20261111`; it is not the primary release candidate. Do not blindly merge both scratch branches.

## Changes staged in the consolidated candidate

### A -> B -> A source/prose integrity

- `server/src/coach/reviewSource.ts`: strict admission via Agent A's `analysisMatchesGame`, source hash, monotonic source revision and nonzero analysis generation. The coach's report digest uses v2 and includes those fields. Legacy/unverifiable reports fail closed.
- `server/src/routes/review.ts`: current game source metadata is atomically selected with its analysis for GET and POST.
- `server/src/coach/reviewCache.ts`: all in-flight watchdog and save compare-and-swap checks include the monotonic revision and analysis generation; legacy/unversioned inputs cannot be saved.
- `server/src/autoReview.ts`: automatic report admission is aligned with the same authoritative source contract.
- `server/test/review-cache-race.test.ts`: race guards, A -> B -> A and same-source reanalysis generation cases.
- `server/test/review-source-hono.test.ts`: signed-route tests use actual `SCORING_VERSION` and canonical fixture provenance, and require fresh reanalysis before an old source can generate new prose.
- `server/test/review-source-integrity.test.ts`: digest revision/generation negative cases.

### PR #17 scoring compatibility and regression evidence

- `server/src/chess/accuracyBackfill.ts`: the historical v9-to-v10 score migrator gates Elo and estimated performance on actual **eligible** scored moves, not raw book/forced move counts. Zero-evidence estimates remain `null` instead of fabricating a high Elo.
- `server/test/accuracy-aggregation-regression.test.ts`: all-book/forced, Black-first forced-only, and one-sided eligibility cases.
- `web/tests/review-practice.browser.mjs`: synthetic browser QA now seeds canonical analysis-source hashes/revisions/generations. It stamps *new* valid synthetic analysis after a changed PGN. Without this the stricter backend would correctly reject legacy QA fixtures and invalidate the intended frontend regressions.

### User-visible source freshness beyond the report endpoint

- `web/src/components/review/reviewSource.ts` and `web/src/pages/GameAnalyzer.tsx`: the already-open UI report key now includes authoritative `game.source_revision`, `analysis.source_revision`, `analysis.source_hash`, scoring version and monotonic `analysis_generation`. This prevents a byte-identical forced reanalysis from accidentally resurrecting old locally mounted prose. Frontend unit tests cover A -> B -> A and same-input reanalysis.
- `server/src/routes/games.ts`: paginated library analyzed flags/accuracy values and `analyzed=1/0` filters use the lightweight non-null source provenance + revision/generation + scoring gate rather than scoring version alone; detail routes still perform full replay for actual validity. The authenticated real-engine route regression now checks both stale and fresh library results.
- `server/src/routes/insights.ts`, `insightsV2.ts`, `stats.ts`, and `players.ts`: summaries and personal/public average accuracy also exclude legacy/unversioned or source-revision-mismatched cached analysis instead of misrepresenting it as fresh.
- `server/src/routes/analyze.ts` and the game-detail handler require a positive `analysis_generation` to treat provenance as cache-current; a legacy zero-generation row must be recalculated, not silently reused.
- QA fixtures in `insights-full-history.test.ts`, `insights-move-quality.test.ts`, `platform-backend.test.ts`, `platform-backend-scale.test.ts` explicitly carry *synthetic* non-null provenance for SQL aggregate tests. The real-engine Hono route test separately checks that a changed game's score vanishes from the library until reanalysis.
- Existing scale/Insights/browser synthetic fixtures were updated with explicitly synthetic revision/provenance tokens to preserve their intended *listing/aggregation* and UI semantics; these tokens are not independently verified engine evidence and are not admitted into real report-generation tests.

### Validation and migration tools (also unexecuted)

- `bash scripts/verify-review-integration.sh` — guards the checkout, checks TypeScript, focused and full Vitest, build, MCP, real Chromium, and the independent real Hono/SQLite/Stockfish A -> B -> A test. The script does not push/deploy or touch production data.
- `node scripts/rehearse-review-migration.mjs --source=/absolute/path/to/chess.db` — reads its source **read-only**, makes a private SQLite Online Backup snapshot, applies the additive provenance schema and v9-to-v10 score migration to the temporary copy, checks row counts and PGN/move digests, and verifies idempotence; deletes the temporary copy afterward. Source is never opened writable.

## Execution blocker

The connected terminal repeatedly refused `git status`, even with a one-line command, with `too many retained terminal sessions (limit 64)`. The unrelated Scriptator command connector also reported `UNAVAILABLE`. Source editing and static reading work. A static check verified that the new report-save SQL has **39 placeholders and 39 bound arguments**; this is not execution evidence. Consequently **none of the above new patches/scripts has been compiled, tested, committed, pushed, merged or deployed.** The previous Agent D combined results (896 tests passed without PR17; five failures with PR17) were collected **before** these fixes and are not evidence about this candidate.

## Non-negotiable remaining release gates

1. Recover shell execution, run the candidate scripts, inspect all failures and correct genuine issues. Do not update a test expectation merely to get green.
2. Run independent Agent D negative-control reinsertion and current-state browser/Hono/SSE tests against exact merged source. Historical reproducible *defect* proofs alone do not establish a fix.
3. Rehearse migrations against a disposable online SQLite snapshot, including the legacy `games.source` table rebuild and PR17 scoring. Confirm an unchanged production DB and reversible backup. Consider what happens to historical cached reviews: engine provenance for legacy analyses is NULL, so existing saved scores/prose will be treated as stale until on-demand reanalysis, even if the v10 score aggregation can be migrated without Stockfish. This is a user-visible release trade-off requiring explicit planning.
4. Ensure `git diff --check`, branch/PR merge correctness, full test suite, build, MCP, Chrome, bounded Stockfish, source race/ABA, concurrency and p95 budget all pass.
5. Only then commit/push the candidate to an isolated integration branch. Obtain exact-commit GitHub CI and review the live updater/deployment implications before merging `main`. Do not run a migration directly on the active SQLite database as part of this exercise.

**Until these gates pass: no merge and no claim of production readiness or Chess.com superiority.**
