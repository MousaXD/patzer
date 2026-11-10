# Agent A — chess engine correctness audit and narrow fix (2026-11-11)

## Scope and provenance

- Base: `origin/main` at `51df1d852296e5f0644127a81b5ec31109c8e6c1`.
- Worktree/branch: `agent/review-engine-20261111`, independent of already integrated `agent/chess-backend-20261110`.
- Read the three `docs/review-excellence/` specifications from current main; inspected `origin/pr-17-review` at `02bfe983c14bf521e05ec4f463f5e4c70ef3f7bd` without applying it.
- PR #17 touches `accuracy.ts`, `classifier.ts`, `routes/analyze.ts`, reporting UI and migration utilities. No overlap with this patch. It introduces a scoring model/backfill decision requiring separate owner approval; **not merged, executed or benchmark-certified here**.
- No private games, production SQLite, live service, auto-sync or secrets inspected or modified.

## Confirmed findings and reproductions

| Severity | Location | Evidence | Resolution |
| --- | --- | --- | --- |
| P1 chess correctness (optional remote backend) | `server/src/chess/engine.ts` `strictFen` / `ChessApiEngine.evaluateMulti` | Legal FEN `4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1` allows `e5d6` en passant, but hosted request removed `d6`; search could no longer select a legal move. Symmetric Black case exists. | Detect an **actually legal** en-passant capture and use local Stockfish for the game instead of submitting an altered position. When local engine is unavailable, fail explicitly; never invent a remotely scored answer. |
| P1 incorrect chess line (untrusted hosted response) | `parseChessApiResponse` | Previously accepted well-formed UCI `e2e5` at initial position, and all syntactically valid continuation UCI strings, without board legality checks. | Validate best move against FEN with `chess.js`, reject it if illegal; replay each continuation and stop at first invalid or illegal ply; cap continuation length at 64. Caller will retry/fall back when hosted response is invalid. |
| P1 incomplete/misleading UCI MultiPV evidence | `server/src/chess/stockfish.ts` `evaluateMulti` | Fake UCI responses first reproduced three failures: final `bestmove` disagreeing with rank-one PV still exposed candidate gaps; an illegal rank-two first move still entered the candidate set; a broken PV continuation was returned as if legal. A fourth regression exposed a rank-three score being mistaken for the next valid alternative after missing rank two. | Preserve numeric root score, but accept only legal replay prefixes and contiguous, distinct, completed same-depth ranks whose rank-one first move agrees with `bestmove`. Suppress all candidate comparisons on inconsistent top line. Keep bestmove available for normal scoring; do not silently alter scoring coefficients. |
| P1 false hosted score on a mathematically drawn position | `server/src/chess/engine.ts` `terminalEval` | K-vs-K FEN `4k3/8/8/8/8/8/8/4K3 w - - 0 1` still has legal king moves, so previous code forwarded it to a mocked hosted engine that returned +300cp. | For `chess.js`-verified insufficient material, return deterministic 0cp/no-bestmove without contacting the provider; no search or misleading nonzero score. |

### New focused regression cases

`server/test/hosted-engine-legality.test.ts`: illegal initial first moves; legal continuation truncated before impossible king move; underpromotion and missing promotion piece; both colors' legal en passant; irrelevant EP target; no hosted request for EP; White-to-Black sign conversion; castling allowed versus castling through attacked square. These are deterministic, sanitized chess positions, not imported user games.

`server/test/analysis-agent-stockfish.test.ts`: fake-UCI negative controls with mismatched `bestmove`, invalid rank two, non-contiguous rank one/three, and invalid PV continuation; all failed before their narrow correction and passed afterward.

`server/test/stockfish-real-legal-pv.test.ts`: optional, CPU-bounded Stockfish 17 integration test (`PATZER_TEST_STOCKFISH`), one thread, Hash 16MiB, depth 8; eight synthetic/legal scenarios including Black-first, castling, pinned en passant, underpromotion, checkmate, and stalemate. The test legally replays candidate PV moves and checks sequential ranks, mate-zero semantics and White/Black normalization.

### Perspective and engine observations

- Hosted result `centipawns` / `mate` is normalized to side-to-move by multiplying the White-view value by `+1` for White or `-1` for Black. A Black-to-move regression asserts this conversion. This does **not** independently verify the remote provider's undocumented score semantics or mate-distance meaning.
- The hosted free service returns one candidate despite requesting MultiPV; missing alternatives are **not proof of uniqueness**. `engine.ts` comments document that `Great`/`Brilliant` gates degrade without candidate #2. No heuristic coefficients changed.
- `strictFen` still removes en-passant metadata for hosted calls where there is no legal en-passant capture; that preserves immediate legal moves but does not establish equivalent repetition/history or evaluation in every edge case. Future work should prefer a provider that accepts canonical FEN or attach explicit evidence status.
- Search depth alone does not establish stability or confidence. A fixed Stockfish binary hash, node/depth budgets, alternative candidate comparisons and adversarial held-out fixtures are still needed before any scoring migration.

## Remaining risk and recommended next action

1. **Benchmark blocker:** no frozen, approved holdout/reference manifest yet; therefore no accuracy, calibration, depth-stability or latency improvement is claimed. Agent D/integrator should freeze fixtures and engine parameters. Avoid PR #17 backfill until separate approval.
2. **Future edge suite:** pinned en-passant, insufficient material, repetition-aware FEN histories, mate score sign transitions, already-lost positions, forced moves, equal alternatives, and concurrent cancellation under bounded Stockfish workloads. Existing tests cover some of these but do not amount to proof for all positions.
3. **Architecture:** hosted adapter's `strictFen` workaround is a known fidelity limitation. A long-term decision is whether to disallow hosted evaluation for any en-passant target or change providers. This patch takes the smallest correctness-preserving action for legal captures.
4. **Cross-agent contract:** B/C should not assert that a single hosted PV proves a forced continuation; expose source/budget/number of alternatives if a versioned DTO is proposed. No shared schema changed in this wave.
5. **Verified numeric-scoring issue, intentionally not fixed in this branch:** `analyzePgnFull` estimates Elo whenever a player has recorded moves (`whitePoints.length`/`blackPoints.length`) even if all their moves are book or forced and excluded from the denominator; the current `estimateElo(0, 0)` equals **2880** despite no eligible evidence. PR #17's proposed `accuracyBackfill.ts` repeats the same condition and would re-save that misleading estimate. Fixing current/recalculated rows must be coordinated with the v10 scorer owner and a historical cache/migration decision, not a unilateral edit to PR #17 files.
6. **Verified phase/full-game ACPL inconsistency, intentionally not fixed without versioning:** `computePhaseSplit` averages raw `m.centipawn_loss` (which comes from `cpLossForPly`, capped at 1000), while full-game `analyzePgnFull` averages `cpLossForAcpl` (capped at 300). A mate sign flip shows `1000` vs `300` for one identical move. The proposed v10 backfill phase recalculation uses the 300-cp reducer, so coordinating a consistent migration is essential. No existing cached metrics were changed here.
7. **Known backend fidelity limit:** The hosted API adapter can switch to local Stockfish after a failed query. An already evaluated portion of one PGN may then contain evaluations from both engines. This patch doesn't silently change API/provider policy or overwrite history; a future versioned provenance contract should explicitly record source per position and prohibit unmarked mixed-engine comparisons.

## Validation and claims

Validation on this checkout: after all source and test changes, `npm test` **736/736 passed, 1 intentionally skipped** (90 passed files, 1 optional test file skipped when the binary path is not supplied); the four relevant chess test files **66/66 passed**; `PATZER_TEST_STOCKFISH=.../bin/stockfish npm test -- --run server/test/stockfish-real-legal-pv.test.ts` **1/1 passed** using Stockfish 17 (eight bounded chess positions); `npm run typecheck` **passed**; `npm run build` (server TypeScript + Vite production build) **passed**; and `git diff --check` **passed**. The targeted fake-UCI tests had actual initial failures and later passed. MCP/browser integration and benchmark holdout were not run because their contracts were not modified and benchmark fixtures are not frozen.

This patch modifies no scoring formula, classification threshold, score version, history or migration path, so benchmark score comparisons are **not applicable**. Deterministic legality regression coverage increases, but engine quality, runtime and sample-level calibration remain unmeasured.
