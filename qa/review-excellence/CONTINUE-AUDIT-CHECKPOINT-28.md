# Agent D — Checkpoint 28: FIDE claimable draws are not automatic draws

**Assigned QA branch:** `agent/review-benchmark-20261111`. **Previous pushed SHA:** `cde9b81030bf64367953b865f78bd251a2461571`. **Frozen read-only Agent B coach:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`. Fetched Agents A/C, PR #17 and `main` read-only; neither owner source nor product chess/scoring code changed.

## Independently reproduced factuality-verifier false rejections

Checkpoint 27 separated nonterminal results from chessboard-proven checkmate and drawn endings, but it used **`chess.js.isDraw()` as if it meant an automatically completed game**. The implementation of that library also returns `true` for a *claimable* draw: 3 occurrences of the same position or 50 moves by each player without a pawn move or capture.

This conflates **FIDE Article 9.2/9.3** with **FIDE Article 9.6**. Article 9.2 allows a player to **claim** a draw at threefold repetition, and Article 9.3 likewise allows a draw claim after 50 moves by each side without a capture or pawn move. Article 9.6 makes the game **automatically drawn** upon *fivefold* repetition or *75 moves by each side* without a pawn move/capture (except if the last move results in checkmate). Reference: [FIDE Handbook — Laws of Chess, effective January 1, 2023](https://handbook.fide.com/chapter/e012023), Articles 9.2, 9.3, 9.6.

Reproduced original incorrect verdicts (all synthetic, legally replayed):

| PGN source | Old independent verdict | Why it was wrong |
| --- | --- | --- |
| Eight knight-only halfmoves, original position occurring **three** times | `rejected`: purported terminal draw against `White won the game` | A draw could be claimed; an actual draw claim is **not** in the recorded move sequence |
| Twelve knight-only halfmoves, original position occurring **four** times | `rejected` for winner | Still **claimable**, not yet automatically drawn |
| Custom PGN FEN with `halfmove=99`, followed by a single reversible move (`halfmove=100`) | `rejected` for winner | The 50-move rule is **claimable**; and the imported FEN clock is not replayed evidence of the prior moves |
| Custom PGN FEN with `halfmove=149`, followed by a reversible move (`halfmove=150`) | `rejected` for winner | A **one-move PGN cannot independently verify the preceding 149 halfmoves**; the external FEN clock is only an assertion |

Those are real false accusations by **Agent D's limited QA verifier**, **not newly demonstrated product or engine defects**. Any PGN `1-0`, `0-1`, `1/2-1/2` or `*` with only a claimable draw position is insufficient to independently prove or contradict the final outcome; a game may continue absent a valid claim.

## Source-proven rule correction

`scripts/review-benchmark-coach-claim-adapter.mjs` retains source-PGN legal replay and replaces the direct `game.isDraw()` automatic verdict with independently qualified evidence:

1. **Automatic, board-terminal:** `game.isStalemate()` or `game.isInsufficientMaterial()`.
2. **Automatic, history-proven fivefold:** replay **all recorded before/after positions** from the source PGN. Compare piece placement, side to move, castling rights and legal en passant rights; ignore move number and halfmove clocks. Require at least five occurrences of the same legal position.
3. **Automatic, history-proven 75-move:** require at least **150 consecutively recorded reversible non-pawn/non-capture halfmoves**. The imported `FEN` halfmove counter alone is **not independent evidence** of previous moves; a fabricated FEN at 149 must never prove 75.
4. **Claimable only:** `isThreefoldRepetition()` or `isDrawByFiftyMoves()` may indicate draw *eligibility*, but absent an external claim record they are **not proven outcomes**. These cases get `claimable_draw_not_automatic_without_recorded_claim` and the existing `nonterminal_result_not_independently_verified` uncertainty. Checkmate continues to take precedence over any draw evidence.

The checker reports `automatic_draw_proven_from_source`, `draw_claimable_only`, `automatic_fivefold_replay`, `automatic_seventy_five_replay` and independently recorded maximum occurrence/halfmove counts. The previous `draw_proven_by_board` remains specific to a board-terminal stalemate/dead position; a repetition/history-proven automatic draw is **not falsely labeled a static board draw**. A declared decisive result against an automatically drawn game is still flagged, but an unspecified `*` tag is not a false declared winner. `full_factuality_certified` stays **false for every verdict**.

## Bounded adversarial certification of the QA itself

`scripts/review-benchmark-draw-claims-matrix.mjs` creates **17 hand-authored deterministic legal synthetic PGNs**, each with five player-perspective/result variants (**85 cases**), including 2/3/4/5 repetitions, imported FEN halfmove 99/100/149/150/151 and full recorded 99/100/149/150 reversible halfmove histories. It constructs an **original 150-ply legal knight/piece sequence** deterministically from the normal starting position, with **no pawn move, no capture, no checkmate, and fewer than five occurrences of any position**. The replay therefore reaches the 75-move rule **without being confounded by fivefold repetition**. The source PGN is fully available in the ignored test results.

| Scoped QA outcome | Count |
| --- | ---: |
| `not_evaluated` (claimable/unknown result, or no recognized claim) | **59** |
| `rejected` (actual automatically drawn source + contradictory winner or header) | **26** |
| **Total** | **85** |

`scripts/review-benchmark-draw-claims-proof.mjs` is a separate verifier that **does not import the tested claim adapter**. It legally replays every PGN with `chess.js`, independently computes source repetition counts, source reversible-move history and each scenario's result claims, checks **18 separately selected gold samples** and verifies frozen SHA256 identities of **all 85 ordered inputs, all 85 individual outcomes and the 17 source PGNs**. This closes the previously demonstrated weakness where adversarial swaps could preserve an aggregate pass count. `scripts/review-benchmark-draw-claims-negatives.mjs` rejects **54/54 intentionally forged evidence packets**, including a false accusation on threefold, a false proof of a FEN-only 150 clock, a hidden fivefold/75-move draw, a false metadata contradiction on a correctly drawn or unspecified source, and balanced swaps of two non-gold verdicts. `scripts/review-benchmark-draw-claims-boundary.mjs` starts a fresh source runner, matches cryptographically unique UUIDs in stdout and raw ignored JSON and independently rejects a QA-only false accusation on threefold repetition.

**Other regressions:** Checkpoint 27's 67-case legal result-metadata matrix and its 48 forged-evidence tests, earlier 18 literal-claim controls, 58 provenance controls and all broad browser/coach validation are retained without weakening. The real Agent B coach still accepts the two previously injected false model strings in the frozen source; these QA-only fixes cannot close the product factuality or profile-cache release blockers.

## Reproduce locally and next step

```sh
node scripts/review-benchmark-draw-claims-boundary.mjs
node scripts/review-benchmark-draw-claims-negatives.mjs
node scripts/review-benchmark-draw-claims-proof.mjs
node scripts/review-benchmark-result-evidence-boundary.mjs
node scripts/review-benchmark-result-evidence-negatives.mjs
node scripts/review-benchmark-coach-provenance-negatives.mjs
```

**Source identity:** fixed self-authored Fool's Mate fixture manifest v2 SHA256 `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`. Frozen Agent B at `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`. **0 external LLM calls, 0 Stockfish jobs, 0 real users or production DB calls** in the new 85-case controls. SHA256 commitments and fresh run UUID are recorded in `certification-summary-checkpoint28.json`; raw PGNs and per-scenario results remain in ignored QA `results/`.

**Remaining limits:** Independent FIDE adjudication from a move list cannot prove an external draw claim, clock-loss event, resignation or game-arbiter decision. A custom FEN may contain unproven historical metadata. The chess oracle is `chess.js`, independent of the product's coaching logic but not an entirely different chess rules implementation. We did not validate all exotic en passant/castling repetitions, live server rulesets, real player claims, actual hosted LLM error rates, or a sealed human-reviewed holdout. The QA checker evaluates only a narrow set of explicit English claims and deliberately abstains elsewhere.

**Next session:** fetch new Agent B/C work read-only, retest against new pinned snapshots if available. Otherwise investigate next demonstrable source-versus-claim false verdict without expanding this finite QA into an unsupported general factuality oracle. **Integration/release remain BLOCKED.**
