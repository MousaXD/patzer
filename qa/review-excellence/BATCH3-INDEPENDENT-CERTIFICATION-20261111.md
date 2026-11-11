# Patzer Batch 3 — Independent Release Certification (2026-11-11)

**Verdict: NO-GO.** An independent real-product Hono + disposable SQLite + bounded Stockfish check reproduces a new A→B→A stale-review resurrection. The PR #17 combined candidate also has five failing tests. No production changes, main merge, or deployment were performed.

## Immutable candidate manifest

| Role | SHA |
|---|---|
| Agent A | `fb6f39bc52f2952506b1393a1864c66ce460459a` |
| Agent B | `50ba0fe49787b8102db35e959b30a88d62256b0c` |
| Agent C | `c6f12c1f4bc4c592db5544eabc7e2ad0cc8f5680` |
| Agent D QA baseline | `9d4783df4da6e82be257028c732203236b8beca2` |
| PR #17 | `02bfe983c14bf521e05ec4f463f5e4c70ef3f7bd` |
| A+B+C+D disposable candidate | `f2f4020dfea7ff1147aed1d780168aaa11027c9b` |
| A+B+C+D+PR17 disposable candidate | `f23385d0e8d885d7e4b280800c129b83a8604d3d` |

## Actual checks performed

- A+B+C+D: Git merge clean; `npm run typecheck` PASS; `npm test -- --run` **896 passed, 12 skipped**, 101 test files passed, 2 skipped; `npm run build` PASS.
- A+B+C+D with `PATZER_TEST_STOCKFISH` set to QA's unpacked **Stockfish 16**: 4 focused source-integrity/route test files, **30 passed**. This includes real bounded Stockfish depth-8, authenticated Hono and synthetic SQLite, cache reuse, equal-ply source mutation, A→B→A engine race and model-call watchdog. These are owner-authored tests, not independent fixed-behavior proof.
- A+B+C+D+PR17: merge clean; `npm run typecheck` PASS; `npm run build` PASS; full `npm test -- --run` **896 passed, 5 failed, 12 skipped** (104 test files: 101 passed, 1 failed, 2 skipped). All five failures are in `server/test/review-source-hono.test.ts`. Four depend on hardcoded scoring v9 fixtures rejected as `analysis_scoring_stale` after PR17 upgrades the scoring model; the final hanging model test times out before the expected admitted generation. This is an integration/test compatibility blocker; these results alone do **not** prove a production defect from PR17.
- Original evidence preserved: historical checkpoint 32/33/34/35 negative-evidence validators run **71/71**, **92/92**, **100/100**, **109/109** deliberately forged packets rejected, respectively, from original QA evidence directory. These prove historical verifier sensitivity; they are NOT fresh candidate browser tests.
- New independent fixed-behavior assertion: `scripts/review-benchmark-batch3-aba.mjs` calls the merged **real** Hono games/review routes with a signed synthetic account, runs real local depth-8 Stockfish, saves a legitimate source-bound analysis and review in disposable SQLite, then changes game A→B→A. This exits **1** (genuine candidate failure), with evidence:
  `{"source_revision_before":0,"source_revision_after":2,"engine_analysis_stale":true,"report_stale":false,"report_resurrected":true,"report_status":200}`.

## Required fix: resurrected review after A→B→A

Agent A increments `games.source_revision` and marks stored analysis stale after the source returns to the original PGN. Agent B's GET review route `checkReviewAnalysisSource()` replays the current PGN and matches the saved move history, but does not check the analysis `source_revision` against the game's revision. Its cached `reviewSourceDigest()` also does not include the engine-source revision. As a result a report valid at revision 0 becomes readable at revision 2 even though `GET /api/games/:id` correctly flags `analysis_stale:true`.

**Expected fixed behavior:** GET `/api/games/:id/review` must fail closed while its analysis provenance does not match the current source revision, even if the PGN bytes return to the original content. POST review must reject the same obsolete source; a reanalysis should restore a fresh cache and valid review; unrelated bookmark/notes changes must retain cache. Test both A→B→A and same-length different PGNs. Keep the existing report-CAS and source provenance safeguards.

## Historical defects and current evidence

1. Checkpoint 32: old prose after PGN mutation — new owner-authored Hono tests pass; direct independent A→B→A reproduction **still fails**.
2. Checkpoint 33: stale mounted React report after refetch — owner unit tests pass; the exact historical Chrome experiment has **not** been rerun against combined candidate.
3. Checkpoint 34: obsolete model request after source change — new owner-authored Hono test passes; the exact Chrome+SSE experiment has **not** been rerun against combined candidate.
4. Checkpoint 35: report generated from mismatched admission analysis — owner-authored Hono/integrity tests pass; exact historical independent production runner has **not** been adapted/rerun against combined candidate.

## Unverified before any release

- Full real Chrome same-game report, late SSE done/error, browser abort and practice interactions on **combined** candidate.
- End-to-end migration/caches/backfill with PR17 and clean test fixtures; full integration re-run after repairing the proven stale-review defect.
- MCP regression suite, production-style deployment and database backup/rollback dry-run, concurrency/load/p95 and baseline performance comparison.
- Independent negative-control defect reinsertion on the new fixed-behavior tests. Historical controls remain untouched and checked.
- User/device screen-reader behavior, host-model costs and failure semantics at production scale.

## Comparative evaluation — DESIGNED, NOT EXECUTED

Target **50–100 completed games** for first honest Patzer vs Chess.com vs Lichess comparison, varied by rating bands, game lengths, results, opening families, time controls and technical chess endings. Obtain PGNs with clear license/consent; use only legitimately available reference analyses and voluntarily supplied Chess.com reviewed records. Record engine binary/build/hash/depth/nodes/threads/hash/MultiPV and seek comparable budgets without equating undocumented proprietary accuracy metrics. Use independent blind adjudicators for move legality, winner, grounding, engine claim support and usefulness; measure player comprehension and unseen same-theme follow-up puzzles with a randomized or counterbalanced teaching condition. Pre-register outcome metrics, stratification and exclusions; report per-game clustered uncertainty and participant count, reliability/p50/p95 latency, timeouts and missing data. Separate Patzer's scoring model from Chess.com proprietary scores and from Lichess centipawn-loss/accuracy measures. Do not claim superiority before evidence.

## Reproduction

```
PATZER_TEST_STOCKFISH=/home/mousa/projects/my-creations/game/.patzer-benchmark-agent-d-20261111/qa/review-excellence/results/engine/unpacked/usr/games/stockfish node --import tsx scripts/review-benchmark-batch3-aba.mjs /home/mousa/projects/my-creations/game/.patzer-cert-batch3-20261111
```

The path is local to this QA machine. The runner does not touch production data and is expected to exit 1 until the defect is fixed. Do not change the expected value to green it. Agent D's original checkpoint evidence and pinned proof files remain untouched.
