# Agent D — Checkpoint 36: integrated source provenance and generation CAS certification

**Decision: NO-GO.** No owner branch has moved since the prior failure report. All findings below were independently obtained against the real merged implementation, using signed synthetic accounts, Hono routes, bounded local Stockfish 16 depth 8, and disposable SQLite. Agent D made **zero product-source modifications** and did not merge, deploy, access production data, or change PR #17.

## Frozen candidate SHAs

| Role | Exact SHA |
| --- | --- |
| A engine | `fb6f39bc52f2952506b1393a1864c66ce460459a` |
| B coach | `50ba0fe49787b8102db35e959b30a88d62256b0c` |
| C frontend | `c6f12c1f4bc4c592db5544eabc7e2ad0cc8f5680` |
| D previous QA checkpoint | `8fd64d20a2f7a718f2e64212feca24605cb4fec8` |
| PR #17 | `02bfe983c14bf521e05ec4f463f5e4c70ef3f7bd` |
| A+B+C+D integrated candidate | `f2f4020dfea7ff1147aed1d780168aaa11027c9b` |
| Integrated candidate with PR #17 | `f23385d0e8d885d7e4b280800c129b83a8604d3d` |

## New independent fixed-behavior runner

`scripts/review-benchmark-batch3-fixed-behavior.mjs` constructs **new** corrected-behavior assertions rather than editing Checkpoints 32–35 or changing their pinned source hashes. It imports **actual** Hono game, analysis and report routes, actual SQLite database and persistence, actual fallback review builder, and actual `saveReviewIfFresh` CAS. The Stockfish path is explicitly opt-in. Two fixture pairs include a **different PGN with exactly the same byte length and ply count**, not merely equal plies. All game content is self-authored and legal. No hosted language model or third-party games are used.

Run from Agent D's QA worktree with the candidate at the recorded SHA:

```sh
PATZER_TEST_STOCKFISH=/path/to/stockfish node --import tsx scripts/review-benchmark-batch3-fixed-behavior.mjs /path/to/isolated-combined-candidate
```

The runner **intentionally exits nonzero** when real fixes are absent. It does not flip expectations to make a failed implementation green.

### Results against both exact candidates

| Independent case | A+B+C+D | With PR #17 |
| --- | --- | --- |
| Normal source-matched cached report and analysis | PASS | PASS |
| Harmless notes/bookmark retain cache | PASS | PASS |
| No-auth/other-user read/write isolation | PASS | PASS |
| PGN A→B invalidates engine, report GET and report POST | PASS | PASS |
| Engine source_revision detects A→B→A | PASS | PASS |
| **Report GET refuses A→B→A old prose** | **FAIL** | **FAIL** |
| **Review POST refuses A→B→A old analysis** | **FAIL** | **FAIL** |
| **Game library no longer labels stale analysis as analyzed** | **FAIL** | **FAIL** |
| Reanalysis refreshes source revision/generation and clears old prose | PASS | PASS |
| Report regeneration after reanalysis succeeds | PASS | PASS |
| Legacy unmarked prose fails closed | PASS | PASS |
| Same-byte-length alternate PGN forces real new analysis | PASS | PASS |
| **Old-generation CAS/GET fail after same-PGN reanalysis** | **FAIL** | **FAIL** |

**9 passed, 4 failed, on each candidate.** Both produce independent exit code 1. Stockfish binary SHA256: `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca`. Raw JSON evidence is intentionally ignored under `qa/review-excellence/results/`:

- `checkpoint36-abc-evidence.json`, SHA256 `f2831a851e5d02d73d76863a05b08aa3767b89a7697d7370fd7ec110581c7e06`.
- `checkpoint36-pr17-evidence.json`, SHA256 `687fd9c23baa80e4f9b0fc107600494c7acc09a9324f3516019df3fb14aaae16`.

These evidence packets contain only synthetic test outcomes; no session cookies or credentials.

## Four concrete correctness gaps

1. **Cached GET resurrection after A→B→A** (prior Checkpoint 36 precursor already identified in Checkpoint 35 follow-up): Agent A correctly increments `games.source_revision` to 2 and its game detail reports stale engine analysis, but Agent B's cached GET sees a PGN and move history identical to those originally analyzed and returns a report with no stale flag. Real HTTP 200. `reviewSourceDigest()` does not include the authoritative source revision.
2. **New review POST accepts A→B→A obsolete analysis**: after source revision advances and returns to the same PGN, the actual review POST emits **`done`** on old evidence. Expected HTTP 409 / reanalyze. Its `checkReviewAnalysisSource()` checks replayed move history and scoring version without `source_revision` consistency.
3. **Library mislabels stale analyses**: `GET /api/games` continues to advertise game `analyzed:1` with old accuracy `31.8` while the authenticated `GET /api/games/:id` for the same record correctly says `analysis_stale:true` and `analysis:null`. Current list filters and projections use scoring version alone rather than source provenance. This can mislead library users and analyzed/un-analyzed filters.
4. **Old-generation in-flight CAS accepted after reanalysis of unchanged PGN**: A real `saveAnalysis()` increases `analysis_generation` from 3 to 4 with the same source revision, PGN, engine moves and scoring outputs. With the timestamp still in the same second, `saveReviewIfFresh()` accepts a report captured at generation 3 and the authenticated GET renders it as fresh for generation 4. The real CAS compares `created_at` (second granularity) and data bytes but neither `analysis_generation` nor `source_revision`. This is a staged, deterministic write-order test of the actual product CAS, not a claim that a hosted model call occurred.

### Required implementation contracts (not implemented by Agent D)

**Agent B:** At review GET, POST admission, SSE watchdog and final SQLite CAS, verify the authoritative `games.source_revision` versus `analyses.source_revision`, a valid `source_hash`, and captured `analysis_generation`. Include appropriate source/generation identity in persisted prose attestations, and reject legacy unmarked entries. Preserve owner authorization and harmless metadata cache hits. On a generation change, an older report must be rejected even when all visible move JSON, PGN, score and second-resolution timestamp match.

**Agent A:** Make library `analyzed` flags, accuracy projections, analyzed filters and counts coherent with `GET /games/:id` source-freshness semantics. Enforce safe index/SQL logic rather than computing superficial scoring-version matches. Preserve A→B→A engine revision and successful reanalysis.

**Agent D:** Rerun this independent runner, prior Checkpoints 32–35 as historical evidence, and new fixed-behavior Chrome/stream/cancellation controls on exact corrected source hashes; add a deliberate defect-reintroduction negative control to ensure the new assertions would fail. **No corrected A/B commits are available yet**, so no release certificate for corrected code is possible.

**Integrator:** PR #17 merges without Git conflicts and typechecks/builds, but the existing combined test suite has **five failures** in `server/test/review-source-hono.test.ts` because its fixture hardcodes scoring v9 while PR #17 changes the expected scoring version to v10. Validate new v10 normal flow AND negative v9 stale flow; rerun all tests and verify actual migration/backup/rollback before production. Do not weaken provenance checks or alter scoring behavior just to green fixtures.

## Tests not repeated / still unverified

The unchanged A+B+C candidate's earlier full test run passed **896** with **12 skipped**, TypeScript and production build passed; the PR #17 combination's earlier run had **896 passed, five failed, 12 skipped**, with TypeScript/build passes. The earlier four focused Hono/Stockfish source test files passed **30**. Historical independent negative packets remain preserved: 71/71 + 92/92 + 100/100 + 109/109 rejected (372 total). **These older results were not misrepresented as a rerun of the corrected candidate.**

New **combined-candidate real Chrome** (same-game React refetch and late SSE `done`/`error`) and cross-process concurrency, MCP regression, performance comparison, migration rehearsal, account/DB production-scale audit and real head-to-head Chess.com/Lichess evaluation remain unverified. The comparative 50–100 game plan in `BENCHMARK_SPEC.md` is a proposal, not a finished evaluation.

**Final verdict: NO-GO**, pending corrected A/B heads and independent replay. Only Agent D QA-owned evidence and runner are changed by this checkpoint. Nothing was merged to main or deployed.
