# Agent D — Checkpoint 31: promoted pieces require missing pawns

**Owner:** Independent adversarial QA, Game Review Excellence and benchmark validation. **Branch:** `agent/review-benchmark-20261111`. **Prior pushed commit:** `f88519629491f709030caf9f595666e431e457af`. **Frozen read-only Agent B candidate:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`. Other remote branches (A, C, `main` and the separate PR #17 correction) were fetched read-only; none changed. Edits are limited to Agent D’s finite QA verifier, synthetic tests and evidence.

## Confirmed benchmark false-confidence gap

Checkpoint 29 added necessary starting-FEN legality constraints: no more than 16 pieces or 8 pawns per player, consistent castling/EP squares and no check on the non-moving king. It did **not** account for material *provenance* via promotion. A syntactically valid custom FEN with **all eight White pawns and three White rooks** passed strict `chess.js` PGN loading and our independent checker (`not_evaluated`, not invalid). That is an impossible standard-chess history: White starts with two rooks, a third can arise only by **promoting at least one pawn**, and none of White’s eight pawns is absent. Equivalent false acceptance occurred for extra queens, knights, bishops and Black’s inventory. This is a **QA source-validity defect**, not evidence of a product game-import or engine bug.

There is also a less obvious bishop case: two bishops on the **same color** of square require a promotion even though the total bishop count remains two. Each side starts with one bishop on light squares and one on dark squares, and an unpromoted bishop cannot switch square color. If all eight pawns remain, having two bishops on the same color is impossible. This is independent of whether the pieces might otherwise threaten a king.

The legal basis is standard-chess initial setup and pawn promotion: [FIDE Laws of Chess](https://handbook.fide.com/chapter/e012023), Articles 2.2 and 3.7.3.3–3.7.3.5. **A positive inventory check is necessary, never sufficient to prove retrograde historical reachability.** The finite QA checker does *not* label a game as historically legitimate solely because there are enough missing pawns.

## Bounded source-verifier correction

`scripts/review-benchmark-coach-claim-adapter.mjs` now counts, **for each player independently**, the minimum promotions needed to explain surviving pieces:

```text
required_promotions = max(0, queens - 1)
                    + max(0, rooks - 2)
                    + max(0, knights - 2)
                    + max(0, light_square_bishops - 1)
                    + max(0, dark_square_bishops - 1)

possible_promotions <= 8 - current_pawns
```

If `required_promotions` exceeds the number of missing pawns, the PGN is `invalid_input` with `source_start_position_impossible` / `missing_pawn_promotion_budget`. No winner, draw or piece-location claim is positively certified from that contradictory source. This is applied **before** any result or moment prose adjudication; all existing `more_than_eight_pawns_per_side`, `more_than_sixteen_pieces_per_side`, castling, EP and opposing-king checks remain active.

**Positive controls:** three rooks with seven pawns, four rooks with six pawns, two queens with seven pawns, three queens with six pawns, three knights with seven pawns, two same-color bishops with seven pawns, two opposite-color bishops with eight pawns, and mixed rooks/queens consuming two or three missing pawns. These **abstain** (`not_evaluated`) rather than falsely rejecting a position whose necessary inventory budget is satisfied. They are not claimed to be proven legally reachable from the standard initial board; some intentionally leave other retrograde details unconstrained.

## Independent adversarial evidence

`scripts/review-benchmark-promotion-budget-matrix.mjs` creates **36 self-authored synthetic setup-FEN PGNs** and tests White/Black winner prose plus the no-claim control (**108 total assertions**). All 36 source PGNs pass `chess.js` strict loading and contain zero recorded moves, avoiding unrelated move legality and chronology issues.

| Scoping result | Sources | Claim variants | Verdict |
| --- | ---: | ---: | --- |
| Promotion inventory impossible | **17** | **51** | `invalid_input` |
| Sufficient missing-pawn budget (not full reachability) | **19** | **57** | `not_evaluated` |
| **Total** | **36** | **108** | Correct within stated scope |

`scripts/review-benchmark-promotion-budget-proof.mjs` is a separate verifier which **does not import the tested claim adapter**. It uses board-square indices (not the adapter’s piece-square string method) for bishop-color counts, a separate **36-source hand-adjudicated gold table**, strict replay of every submitted PGN and frozen SHA256 commitments for all ordered inputs, all individual outcomes and the 36 source identities. The 108 decisions cannot silently swap while aggregate counts remain unchanged.

`scripts/review-benchmark-promotion-budget-negatives.mjs` rejects **50/50 deliberately tampered evidence packets**, including: inventing an extra rook without a missing pawn, labeling a legal inventory as impossible, hiding same-color bishop surplus, undercounting combined queen/rook promotions, confusing White and Black inventories, swapping different PGN sources, changing source FEN/digest, and balanced result swaps. `scripts/review-benchmark-promotion-budget-boundary.mjs` starts an independent fresh runner with a unique UUID matched across subprocess stdout and ignored raw source evidence, then injects the original three-rook/eight-pawn false green and verifies rejection.

Each positive row remains **`full_factuality_certified:false`**; every packet and the committed independent summary explicitly say **`release_approved:false`**. The pinned fixture manifest v2 SHA256 is `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`. The new source inventory tests use **0** external LLM calls, **0** Stockfish jobs, **0** live users, and **0** production databases.

## Verification and continuation

```sh
node scripts/review-benchmark-promotion-budget-boundary.mjs
node scripts/review-benchmark-promotion-budget-negatives.mjs
node scripts/review-benchmark-promotion-budget-proof.mjs
node scripts/review-benchmark-start-fen-boundary.mjs
node scripts/review-benchmark-game-end-chronology-boundary.mjs
node scripts/review-benchmark-result-evidence-boundary.mjs
node scripts/review-benchmark-draw-claims-boundary.mjs
```

The earlier **99 source-FEN**, **88 game-end chronology**, **67 result**, **85 draw**, **58 coach-provenance**, scope/hypothetical and browser negative-control suites are unchanged and remain green on the stricter checker. Application-contract **1,077** assertions and **25** self-authored benchmark fixtures also remain green. A fresh real Agent B coach test still needs to be distinguished from source-only QA; its two previously reproduced false *local mock-model* strings remain unresolved product-blocking findings, as do the profile-cache and screen-reader language issues.

**Exact next action:** Fetch owner branches read-only. If Agent B/C has shipped corrective commits, retest their pinned source across real coach/browser/cache controls. Otherwise investigate another demonstrable QA source/evidence false green with a meaningful downstream decision; avoid pretending to have a complete retrograde chess oracle. **No merge to main, no PR #17 accuracy implementation, no production changes, and no release certification.**
