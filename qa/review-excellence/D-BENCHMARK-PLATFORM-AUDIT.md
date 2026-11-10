# Agent D — independent benchmark implementation and hostile-audit handoff

> **Historical Batch 1 snapshot.** The follow-up real-system benchmark and updated release gate are in [BATCH-2-CERTIFICATION.md](BATCH-2-CERTIFICATION.md) and [certification-summary-batch2.json](certification-summary-batch2.json). The original 14-fixture findings below remain as first-wave evidence; their open issues were reassessed in Batch 2.


Date: 2026-11-11. Baseline SHA: `51df1d852296e5f0644127a81b5ec31109c8e6c1` (`main` at initial clone). Scoring: v9. No production database accessed.

## Verified execution

| Check | Result |
| --- | --- |
| Manifest SHA256 | `79300b25e5602a72c6781bc0106bd43da73db1c4cfb1d119c8950d9649ac454b` |
| Synthetic origin/license | 14 self-authored, redistributable; no imported game/user records |
| Dataset | 6 completed games, 8 positions; 9 dev, 5 stress, 0 sealed holdout |
| Replay scope | 42 game plies; checks castling, en passant, repetition, pawn underpromotion, Fool's Mate, Scholar's Mate, stalemate, black-to-move |
| Benchmark result | 14 / 14 fixtures; 0 reported failures |
| Corrupt controls | 7 / 7 correctly rejected; 1 correct control accepted |
| App scoring invariant assertions | 1,077 / 1,077 on main v9 |
| Elapsed for 14 fixtures | 48 ms observed once (not a representative latency distribution) |
| Peak RSS for fixture run | 64,585,728 bytes |
| Process CPU for fixture run | user 163,260 µs; system 32,652 µs; includes process work (not engine costs) |

Baseline results are local-generated only and not committed to prevent mistaking mutable machine measurements for locked reference results. Generated JSON carries repo SHA, manifest hash, environment, resource usage and skip/error details.

## Negative control evidence

- `illegal_pv` for a nonexistent pawn leap
- `eval_perspective_mismatch` for black to move with the sign kept positive
- `unsupported_mate_claim` for a fabricated mate after two opening moves
- `stale_analysis_request` for a response with a different request identifier
- `classification_evidence_mismatch` for declaring a large win-probability loss best
- `wrong_actor` for switching whose turn it is
- `false_piece_claim` for an invented queen on e4

Hostile review found a **real flaw in the first draft**: the validator mutated the FEN board while checking the best move, causing spurious sign/piece failures. Fixed by validating that move on a fresh board. Positive and corrupt controls both rerun after the fix.

## Cross-agent read-only scope

Remote historical branches inspected by name/diff against initial main: `agent/chess-backend-20261110`, `agent/review-experience-20261110`, `agent/product-ui-20261110`, `agent/platform-backend-20261110`. These branches have broad overlapping UI/file changes relative to this main snapshot and must **not** be blindly combined or treated as the new four-agent batch. At inspection, the new 2026-11-11 Agent A/B/C branches were not fetched/visible. No edits were made to other branches.

## Risk and blocked certification

**P0 — Green benchmark may conceal broken product integration.** The deterministic validator consumes synthetic evidence objects; the application currently does not emit a benchmark-specific evidence contract in this harness. It is possible for a broken runtime DTO to pass these fixtures. Before shipping scoring/coach changes, instrument an independent adapter, replay public fixtures through the real analyze endpoint in a **disposable** environment, and compare structured evidence without weakening labels.

**P0 — No holdout.** Do not call this a sealed holdout test. Curate at least 50 independent games and 25 positions as a separate integrator-controlled release gate, preserving provenance and source non-overlap. No repeated tuning on that set.

**P1 — Unpinned Stockfish reference and no search-budget experiment.** Need binary hash, UCI configuration, deterministic node budget, separate depth/MultiPV lanes, mate and evaluation-variance reports. Avoid confusing a valid alternative move with an engine error.

**P1 — Missing review latency and lifecycle tests.** Need isolated review workloads for long PGNs, synthetic 2k/10k catalogs, parallel engines, stalled engine, process cancellation, OOM budget and stale response races. Current 48 ms measures only this Node fixture checker.

**P1 — Coach truth gap.** Current typed claim checker covers three finite fact types; it does not prove all natural-language causal statements or the educational value of a lesson. Unsupported claims must be marked unevaluated, not silently scored correct.

**P1 — Baseline version choice.** The v9 scorer is verified on the original main SHA; independent PR #17 proposes v10. If PR #17 is merged, freeze a new baseline and migration verification before any comparison. Do not mix v9/v10 reports without version labels.

**P2 — Fixture representativeness.** Current 14 fixtures are convenient small examples, and no realistic game-length/rating/time-control strata exist. Expand curated data and adjudication, including Chess960 only if separately supported. The public fixture manifest is not a substitute for independent reviewer labels.

**P2 — Coverage gaps.** No end-to-end UI interaction, security/auth/CSRF/cross-user isolation, WASM performance, engine failover, hidden PGN injection, concurrency or external provider comparisons.

## Merge recommendation

Safe to review as an **initial QA infrastructure increment** after code review and independent reproduction. **Do not approve game-review correctness, model/scorer parity, or release readiness from these green results.** Main, live SQLite, credentials, updater, and release configuration were not modified.

Next batch: independent DTO-to-fixture adapter + isolated analyzer invocation + failing mutation controls at that integration boundary; pinned Stockfish experiment; integrator-owned sealed holdout. The next audit should actively attempt to make incorrect candidate output pass.
