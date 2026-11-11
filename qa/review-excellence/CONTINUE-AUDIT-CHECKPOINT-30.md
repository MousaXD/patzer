# Agent D — Checkpoint 30: stop at the **first** automatic chess-game ending

**Branch:** `agent/review-benchmark-20261111`. **Previous pushed SHA:** `1c9b07a334b1d9deda86473569f97e8d824ce66e`. **Read-only frozen Agent B:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`. Remotes `agent/review-engine-20261111`, `agent/review-product-20261111`, `main` and PR #17 were fetched read-only and had not moved. Edits are limited to **Agent D's independent test/checker source**, not Patzer's chess engine, model, game import, browser or database.

## Reproduced: false source-derived win after a game already ended

The earlier QA checker looked at the final `chess.js` board to decide whether a game was checkmate or automatically drawn. This overlooked **chronology**: `chess.js.loadPgn({strict:true})` and `Chess.move()` can replay further SAN moves even when FIDE standard chess would already have terminated the game on **fivefold repetition**, **75 moves by each side without a pawn move/capture**, or a **dead position**.

One synthetic, strict-loadable PGN deliberately repeats `Nf3 Nf6 Ng1 Ng8` **four cycles**. The starting board appears for the **fifth time at ply 16**. Under FIDE Article 9.6.1, the game automatically ends as a draw at ply 16; the following four legal-looking SAN moves `f3 e5 g4 Qh4#` can still be appended by the chess library. The old QA checker **positively verified** the later literal *“Black won the game”* as `limited_claims_passed` because the **final** board was checkmate. That is a **false QA positive**: a game already automatically drawn at ply 16 could not subsequently end with a legal winner at ply 20. Continuing after **threefold or fourfold** (claimable) and subsequently mating is different and remains valid **unless a draw claim occurred**, which is not derivable from the PGN alone.

Additional controlled cases reproduce the same error when a 150th recorded reversible halfmove produces a 75-move **automatic draw** but the PGN contains a 151st/152nd move, or when a custom initial position is already **dead material** but the PGN records a king move. FIDE Articles 5.1–5.2 and 9.6 define the automatic termination cases; [FIDE Laws of Chess (2023)](https://handbook.fide.com/chapter/e012023). A checkmate occurring on the *same* 150th halfmove takes priority, as Article 9.6.2 expressly states; the new checker evaluates checkmate before the automatic 75-move condition at each ply.

These are defects in **Agent D's independent QA verifier and earlier synthetic test sources**, **not** newly demonstrated production bugs or deployed Stockfish results. The candidate product source is read-only.

## Source chronology correction

`scripts/review-benchmark-coach-claim-adapter.mjs` now scans **every recorded before/after position** of a legal source PGN in order, starting with **ply zero** for custom FENs. It finds the earliest automatically terminal position from source chess state and replayed history:

- **Checkmate, stalemate, or insufficient-material dead position**
- **Fifth occurrence** of the same legal position, with compatible castling/en-passant rights
- **150 actually recorded consecutive non-pawn, non-capture halfmoves**, not an imported FEN move-clock assertion

If **any later moves** follow that first terminal state, the *entire submitted PGN is refused* as `invalid_input`, with `{reason:'source_continues_after_automatic_game_end', first_ending_ply, ending_kind, later_moves}`. The checker issues **no chess fact proofs**, including for a later checkmate or apparently correct piece-square statement. A terminal position **at the exact final recorded ply**, or an **initial terminal custom FEN with zero moves**, is still accepted as source evidence. Claimable threefold/fourfold and the 50-move rule are **not** automatically terminal, and do not block later legal continuations.

## Self-audit corrected two previously misleading QA fixtures

Independent replay revealed that two earlier QA fixtures had begun with **bare kings** and then played an additional legal SAN king move. The move is accepted by `chess.js`, but under the game's automatic dead-position rule it should **never be considered a completed game with a later move**.

1. The Checkpoint 27 result-evidence matrix's original `1... Kh2` in an already dead K–K FEN was **replaced** with `1... Kxh2` in a legal position containing White K+B versus Black K+N. The capture of White's bishop is the **first actual dead position, at the final recorded ply**. All **67** result cases retain their original expected verdicts; their **source/input SHA256 fingerprints were updated** and the independent proof rerun. The historical `certification-summary-checkpoint27.json` preserves its at-the-time snapshot and is explicitly **superseded for these insufficient-material source identities** by the Checkpoint 30 controls; the v2 manifest and original Fool's Mate fixture remain unchanged.
2. The Checkpoint 24 provenance test's custom Black-to-move `1... Kh2` on bare kings was **replaced** with the same real `1... Kxh2` capture. Its positive before/after king-square and black-first source-mover assertions still pass, but no longer treat moves after a dead position as legal game history. The complete **58-case** earlier provenance control suite passes.

This correction is evidence of **finding and fixing mistakes in the benchmark fixtures themselves**, not an attempt to weaken the more restrictive source check.

## Independent proof and negative-control coverage

`scripts/review-benchmark-game-end-chronology-matrix.mjs` produces **22 original synthetic PGN sources** and **88** finite claim assertions. Four sources end in a legal checkmate, two are genuinely unfinished, eight end legally in a terminal draw, and **eight are intentionally invalid continuations after an earlier automatic terminal state**. All 22 sources are accepted at the PGN/SAN syntax level; the newly invalid ones must be rejected by the independent QA fact verifier.

| Bounded QA verdict | Cases | Interpretation |
| --- | ---: | --- |
| `invalid_input` | **32** | Eight intentionally post-terminal PGNs × four claim variants, all refused |
| `rejected` | **28** | Genuine direct false winner assertions on valid terminal sources |
| `limited_claims_passed` | **8** | Precisely verified Black-win literals in legal checkmate sources |
| `not_evaluated` | **20** | No claim or nonterminal, inconclusive result |
| **Total** | **88** | All conditions checked against source SAN replay |

`scripts/review-benchmark-game-end-chronology-proof.mjs` independently reconstructs the game from each PGN's initial FEN/standard start and **replays SAN one move at a time**, rather than importing the tested adapter's final-board logic. It checks **all 22 independently hand-adjudicated source end plies and kinds** (including ply 0), all **88** claim verdicts, and fixed SHA256 fingerprints binding **every ordered input, outcome and source identity**. This prevents aggregate-preserving result swaps from appearing green.

`scripts/review-benchmark-game-end-chronology-negatives.mjs` rejects **51/51** deliberately tampered packets, including certifying an illegal later mate, treating claimable threefold/fourfold as automatic, concealing 151st/152nd moves, shifting the first terminal ply, mislabeling an already-dead FEN as a legitimate extended game, and switching two outcomes while preserving aggregate counts. `scripts/review-benchmark-game-end-chronology-boundary.mjs` starts a **fresh separate runner**, matches the unique cryptographic run UUID between stdout and ignored raw PGN evidence, and independently rejects a forged later-mate-positive result.

Existing **67-case result**, **85-case draw**, **99-case starting FEN**, **68-case hypothetical**, **59-case scope**, **58-case provenance**, and the original literal-claim matrix remain in the regression suite with their own independently checked negative controls. Real-browser cancellation/profile checks and the existing 1,077 application-contract assertions are retained. **No new external LLM or Stockfish job** is performed by these synthetic chronology tests.

## Reproduce and limits

From Agent D's isolated QA checkout:

```sh
node scripts/review-benchmark-game-end-chronology-boundary.mjs
node scripts/review-benchmark-game-end-chronology-negatives.mjs
node scripts/review-benchmark-game-end-chronology-proof.mjs
node scripts/review-benchmark-result-evidence-boundary.mjs
node scripts/review-benchmark-result-evidence-negatives.mjs
node scripts/review-benchmark-coach-provenance-negatives.mjs
node scripts/review-benchmark-draw-claims-boundary.mjs
node scripts/review-benchmark-start-fen-boundary.mjs
```

**Provenance:** self-authored `SYN-GAME-FOOLS-MATE` and fixture manifest v2 SHA256 `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`. Pinned Agent B source `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`; no candidate source writes. The local model used by previous Coach-factuality attacks is **mocked**; the new chronology tests do **not** call a real model, engine, production DB, updater, connected game account or deployed service. `certification-summary-checkpoint30.json` records fresh UUIDs, audited source hashes, source/claim verdict counts and explicit `release_approved:false`.

**Limitations:** The independent evidence still uses `chess.js` as its board-rule oracle; this is not full formal chess legality or retrograde reachability proof. FIDE draw claims, resignations and timeout/arbiter events require external adjudication records. The tests are deterministic synthetic games, **not a sealed human-labeled holdout** or deployed-model factuality measurement. No general semantic/textual coaching claims or multilingual statements are certified.

**Next continuation:** fetch Agents A/B/C, `main` and PR #17 read-only and rerun corrected coach/cache/browser controls if source changed. Otherwise continue source-anchored, adversarial QA of missing game-event evidence or reliability and run independent negative controls before any new checkpoint. **Full Patzer release/integration certification is still BLOCKED.**
