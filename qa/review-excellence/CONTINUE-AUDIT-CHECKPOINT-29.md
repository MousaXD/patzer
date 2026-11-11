# Agent D — Checkpoint 29: syntax-valid PGN/FEN is not necessarily a legal source position

**Agent D QA branch:** `agent/review-benchmark-20261111`. **Previous pushed checkpoint:** `8175071497ae695c4d876f02079a2c16ff7187f8`. **Frozen read-only Agent B candidate:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`. Remotes for A, C, PR #17, and `main` were fetched read-only and remain unchanged. This checkpoint updates **only Agent D-owned QA code, reports and reproducible tests**.

## Reproduced false QA evidence

The independent claim checker had relied on `new Chess().loadPgn(pgn, {strict:true})` to accept its source chess positions. That checks PGN syntax and possible subsequent moves, but **does not prove the initial FEN is a reachable standard-chess position**. In particular, all these source examples are accepted by `chess.js` strict PGN loading even though they violate necessary chess invariants:

- **Adjacent kings** (both kings attack one another)
- A **non-moving king in check**, including a game containing a subsequently accepted legal SAN move from that impossible starting state
- A `K`, `Q`, `k`, or `q` castling right with its home rook/king absent
- **Nine pawns** or **17 total chess units** of one side
- An en-passant square whose alleged pawn double-move is impossible because the pawn, target square or departure square is inconsistent

The strongest false-confidence reproduction was a position with **adjacent kings**. `chess.js` reported `isDraw() === true` by insufficient material, so the old independent checker returned **`rejected`** for *“White won the game.”* on the grounds of a supposedly **proved draw**. In fact the source position itself was impossible, so **neither a win nor a draw should be certified** from it.

These are **independent QA verifier defects**, **not** newly demonstrated production-game corruption or an owner-branch bug.

## Minimal fail-closed source check

`scripts/review-benchmark-coach-claim-adapter.mjs` adds a bounded source-invariant check after strict PGN parsing **and before any factuality verdict or moment proof**. A violated necessary invariant returns `invalid_input` with `source_start_position_impossible` and a specific source reason, and always `full_factuality_certified:false`.

The check independently requires (a) no side to have more than 16 pieces or eight pawns; (b) if castling rights appear, the indicated home king and rook must occupy the corresponding squares; (c) a raw FEN en-passant square must be consistent with a possible immediately preceding pawn double-step, while *not* requiring an en-passant capture to be available; and (d) the king of the player **not** to move cannot be under attack. The last check flips the side to move in a temporary board and clears the ep target before asking the chess library whether that opposing king is attacked.

**Important positive controls:** a king **of the player to move** may legally be in check. Castling rights remain possible even when a knight currently blocks a castling path. FEN may include an uncapturable or pinned en-passant target after a legitimate double-step. Eight pawns are legal, and additional promoted queens with missing original pawns are not automatically forbidden. These are accepted, and winner claims remain **unassessed** rather than being incorrectly disproved.

**Limits:** This is a collection of **necessary** conditions, **not sufficient conditions for full retrograde reachability**. A setup which passes them is not certified historically possible, and the checker makes no claims about all promotions or all possible starting position histories. `chess.js` remains the chess-board and attack oracle; the new verifier uses a second, separate `isAttacked(square, color)` path to cross-check non-moving king attacks. The standard chess scope excludes Chess960 and variants.

## Independent evidence and malicious mutations

The self-authored `scripts/review-benchmark-start-fen-matrix.mjs` constructs **33** distinct synthetic PGN source records, all of which **pass the baseline strict `chess.js` loader**:

| Source category | PGNs | Three summary variants each | Outcome |
| --- | ---: | ---: | --- |
| Violating necessary FEN legality | **20** | **60** | `invalid_input` with specific source reason |
| Passing the necessary source invariants | **13** | **39** | `not_evaluated` (no independently proven decisive winner) |
| **Total** | **33** | **99** | 99/99 bounded controls |

`scripts/review-benchmark-start-fen-proof.mjs` independently checks **all 33 hand-labeled source categories**, legally parses all 99 PGNs, verifies the source inventory, uses `isAttacked` instead of importing the QA adapter's flipped-turn attack helper, and SHA256-binds the **ordered input cases, every individual verdict and the 33 source PGN identities**. It also links the fresh evidence to the existing controlled real Agent B factuality output and explicitly denies release certification.

`scripts/review-benchmark-start-fen-negatives.mjs` rejects **41/41 deliberately falsified evidence packets**: wrong source SHA, spoofed candidate, fake product approval, impossible initial kings presented as a valid draw, real check wrongly described as an illegal non-moving king, invented pawn/castling/EP legality, swapped source files and balanced swapped test verdicts. A local QA self-audit initially supplied a **no-op mutation** that swapped two identical variants of the *same* PGN. The mutation was corrected to swap **different sources**, and the independent verifier rejected it. This was a test-quality correction, not a loophole demonstrated against the verifier.

`scripts/review-benchmark-start-fen-boundary.mjs` starts a **fresh separate process** and checks that its UUID matches stdout and the ignored raw evidence, then deliberately tries to certify a known adjacent-kings position as a factual draw. The fake green is rejected.

## Reproduce and interpret

```sh
node scripts/review-benchmark-start-fen-boundary.mjs
node scripts/review-benchmark-start-fen-negatives.mjs
node scripts/review-benchmark-start-fen-proof.mjs
node scripts/review-benchmark-result-evidence-boundary.mjs
node scripts/review-benchmark-draw-claims-boundary.mjs
node scripts/review-benchmark-coach-provenance-negatives.mjs
```

The source fixture manifest remains **v2 SHA256 `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`**. Each QA example is self-authored; no real user PGN, production database, online model, Stockfish run or unapproved engine process is required by the 99 cases. Raw JSON is ignored under `qa/review-excellence/results/`; the frozen source hashes, independent verdicts, UUID, limitations and `release_approved:false` are in `certification-summary-checkpoint29.json`.

## Owner dependencies and next exact action

The pinned Agent B coach still lets the previous local fake-model's **wrong winner** and **wrong king square** reach `buildGameReview` output; the profile/language cache freshness issue is also unresolved. The pinned Agent C browser still exhibits the previously recorded Spanish content vs root `<html lang="en">` mismatch. QA-only source validation does not resolve those **product** findings.

**Next execution:** Fetch remote owner branches again. If changed, pin a clean detached candidate and rerun the real coach/browser/cache controls; if unchanged, investigate one new independent failure in the completed review/benchmark flow, not speculative general retrograde proofs. Preserve private data, no merge/push to `main`, no PR #17 accuracy modification. **Release certification remains blocked.**
