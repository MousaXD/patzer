# Agent D — Checkpoint 27: result-metadata epistemics (resignation vs checkmate vs terminal draw)

**Assigned QA branch:** `agent/review-benchmark-20261111`. **Previously pushed QA SHA:** `6537ed5180fa9f5df289013d1ced29e60719d04d`. **Frozen, read-only Agent B backend:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`. The fetched source refs for Agents A/C, PR #17 and `main` have not changed; only Agent D's QA source is modified.

## Independently reproduced false verdicts in our checker

The English-only evaluator correctly replayed a PGN's final board to prove checkmate, but it previously emitted **`rejected`** for *any* literal winning/losing statement on a noncheckmate PGN, even when the PGN itself declared `1-0`. The reported reason was `result_claim_without_terminal_proof`: **absence of independently verifiable resignation/clock-loss evidence had been mislabeled as a factual contradiction**. The same false rejection affected both White/Black perspectives, invented opposing-result claims, unfinished games (`*`) and agreed draws **whose final board does not independently prove an automatic chess draw**.

An additional independently reproduced case involved a fully checkmated board whose PGN Result was `*`: **Black's winning move was legally recorded, yet the checker treated missing Result metadata as a false winning header** (`pgn_result_conflicts_with_mate`). Conversely, a **stalemate** or **insufficient-material** terminal board *does* independently prove a draw, so `White won the game` or `Black won the game` is a genuine contradiction even when PGN Result is absent. The older checker labeled those cases as `result_claim_without_terminal_proof`, confusing board-proven draws with unfinished decisive games.

These are demonstrable **Agent D QA-verdict defects**, **not** evidence that the product falsely classified any real resignation or draw. The test corpus is synthetic, self-authored legal chess and there is no human arbitration or clock history in a PGN's move list.

## Fix: independent board proof, never declared result as the oracle

`scripts/review-benchmark-coach-claim-adapter.mjs` now applies a finite three-way result policy:

| Independently replayed game | Literal `White/Black/You/Opponent won/lost` | Why |
| --- | --- | --- |
| Legal **checkmate** | Prove or reject the statement against the chessboard | The mating move and side to move independently establish the winner |
| Legally forced **draw**, e.g. stalemate/insufficient material | Reject an asserted winner with `contradicted_terminal_draw_winner` | No winner is possible under the rules in that terminal position |
| **Nonterminal** board with `1-0`, `0-1`, `1/2-1/2` or `*` result | **Abstain**, `winner_not_independently_proven_from_nonterminal_pgn` | Result header can report a genuine external event, but cannot be proved or disproved from moves alone |

The checker still reports a PGN source-integrity contradiction if its **explicitly decisive or draw** header conflicts with an independently established mating/drawn board. A missing or `*` Result is **not** a contradiction, including for custom-FEN games that are already drawn by insufficient material. On nonterminal boards, **piece occupancy remains independently verifiable** from the actual move history even though the winner remains unverified; this can legitimately produce `partial_claims_verified`, never full factuality certification.

**Important limit:** This QA checker does **not** prove a real resignation, timeout or agreed-draw outcome, even if an imported PGN explicitly says it happened. That would require independent event or signed platform evidence. The correct verdict is uncertainty, not an invented win or an invented lie.

## Verified fixtures and hostile controls

`scripts/review-benchmark-result-evidence-matrix.mjs` constructs **15** small, independent, legally valid synthetic PGNs and runs **67** finite claim cases against the fixed source. They include:

- Self-authored Fool's Mate with correct, omitted or deliberately wrong Result tags
- The same opening stopped after a nonmating **fourth legal ply**, with all four Result variants, White/Black/user/opponent literal claims and correct/incorrect piece locations
- An independently legal **`Qb6` stalemating move** from a custom chess position, under actual draw, unknown, false White-win and false Black-win tags
- A custom **Black-to-move** `Kh2` king-only game, with insufficient material and valid, unknown or falsely decisive Result tags

The **QA-only** cases produce:

| Independent scoped verdict | Cases |
| --- | ---: |
| `not_evaluated` | **37** |
| `partial_claims_verified` | **4** |
| `rejected` | **24** |
| `limited_claims_passed` | **2** |
| **Total** | **67** |

`scripts/review-benchmark-result-evidence-proof.mjs` independently replays every one of the 67 source PGNs with `chess.js`, binds move FEN/SAN/side and terminal state, checks **32 separately enumerated gold cases**, and verifies **three frozen SHA256 commitments**: all ordered input strings, all per-case verdicts, and the complete list of 15 source PGN identities. That avoids the earlier regression where swapping unselected test outcomes could preserve aggregate counts and falsely appear green. No model or Stockfish call is made in the new 67-case matrix.

`scripts/review-benchmark-result-evidence-negatives.mjs` rejects **48/48** deliberately forged JSON packets, including inventing resignations as board proof, silently denying an opposing winner on an unproven PGN, changing a PGN or FEN while reusing its hash, hiding a terminal draw, falsifying missing Result metadata into a PGN contradiction, and swapping two non-gold results while preserving aggregate counts. `scripts/review-benchmark-result-evidence-boundary.mjs` executes the 67 cases in a fresh process, correlates the unique UUID in stdout and ignored raw JSON, verifies the source-bound result and ensures a deliberately false nonterminal-winner rejection fails certification.

### A previously hidden test-fixture failure found during regression

The older original literal controls used a **2-ply unfinished PGN** with a moment labeled **ply 3 (`g4`)**. The checker correctly rejected that *invalid moment* even after fixing the winner-result policy; the previous test had attributed the rejection to the winner policy. The test now preserves the exact first three Fool's Mate plies and substitutes a **legal nonmating fourth move `Nc6`**, so moment ply/SAN/FEN remain valid and the targeted nonterminal-result claim can correctly abstain. The original controls still report **18/18** passing. This was a real **test quality** issue; source provenance checking was not weakened to silence it.

## Run the checkpoint

```sh
node scripts/review-benchmark-result-evidence-boundary.mjs
node scripts/review-benchmark-result-evidence-negatives.mjs
node scripts/review-benchmark-result-evidence-proof.mjs
node scripts/review-benchmark-coach-claim-negative-controls.mjs
node scripts/review-benchmark-coach-provenance-negatives.mjs
node scripts/review-benchmark-coach-conditional-boundary.mjs
node scripts/review-benchmark-coach-scope-boundary.mjs
```

**Provenance:** fixed source fixture `SYN-GAME-FOOLS-MATE` in manifest v2 SHA256 `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`; frozen Agent B source `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`. The new work uses `chess.js` replay exclusively: **0** model calls, **0** Stockfish jobs, **0** live or production databases. Earlier real-coach experiments used pinned Stockfish 16 (SHA256 `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca`) in a disposable environment. The exact new SHA256 controls, new run UUID and *explicitly blocked* product release status are in `certification-summary-checkpoint27.json`.

## Release blockers and exact next step

Agent B still accepts the two deliberately false source-coach strings from the previously pinned, local mock-model run, and still has unresolved cross-session profile freshness/automatic regeneration. Agent C still has the documented root HTML `lang="en"` mismatch when the interface displays Spanish. QA-only fixes do **not** resolve those product defects. Full human-sealed coaching evaluation, production-like load/stockfish parity, and end-to-end accessibility certification remain unfulfilled.

**Next session:** fetch owner branches read-only. If changed, pin a new detached worktree and rerun genuine coach, cache, cancellation and browser language controls, preserving the old evidence. If not changed, investigate any next independently reproducible validation false-green/false-rejection that materially affects release decisions rather than adding speculative regex coverage. Do not merge to `main`, modify other agents' work, operate on production or claim full certification.

**Product integration and release remain BLOCKED.**
