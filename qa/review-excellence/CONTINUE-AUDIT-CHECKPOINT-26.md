# Agent D — Checkpoint 26: explicit conditional and hypothetical claims must abstain

**QA branch:** `agent/review-benchmark-20261111`. **Previous pushed HEAD:** `d75a77c1377b482b39e80b3329fb826ef5938aed`. **Read-only Agent B coach:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`. **Read-only Agent A:** `7178e262`; **Agent C:** `d72eaced`; **PR #17:** `02bfe983`; **main:** `51df1d85`. Changes in this checkpoint are confined to Agent D's independent QA checker, runner, verifier, hostile controls, and documentation.

## Reproduced independent-QA failure

The source PGN is self-authored four-ply Fool's Mate: **Black won by checkmate**, and White's king remains at **e1**. Before this change, the English-only claim verifier incorrectly **rejected** these explicitly imagined propositions as though they were incorrect factual statements about the played game:

> If White won the game, the result would be different.

> Suppose White's king is on e2.

It also positively **verified** `If Black won the game, ...` on the grounds that Black did win, even though an `if` antecedent is not an asserted account of what happened. Equivalent problems arose with `suppose`, `imagine`, `assume`, `pretend`, `perhaps`, `maybe`, questions, trailing `if`/`unless`, and explicitly conditional references to a chessboard square. These were failures of **Agent D's own finite QA language checker**, **not independently observed new defects in Patzer's model outputs**. No product source was modified in response.

## Verified correction and strict boundaries

The independent checker `scripts/review-benchmark-coach-claim-adapter.mjs` now identifies only a bounded family of explicit lexical contexts: `if`, `what if`, `suppose`, `imagine`, `assume`, `assuming`, `pretend`, `hypothetically`, `provided`, `consider`, `perhaps`, `maybe`, `possibly`, `allegedly`, `were it true that`, sentence-final questions, and selected trailing `if`/`unless`/`provided that` conditions. In that context it refuses to treat an embedded winner/loser or owner-piece-square statement as a direct game assertion, recording either:

- `hypothetical_or_conditional_result_not_assessed`
- `hypothetical_or_conditional_piece_not_assessed`

The verdict for **only** an imagined statement is `not_evaluated`; a direct, true claim followed by an imagined one is `partial_claims_verified`; and a direct contradiction that appears in a **different, independently bounded sentence** is still `rejected`. Both a true hypothetical and a false hypothetical are unassessed—the checker **does not** use the actual result to reclassify an antecedent as fact. Prior protections remain in place: moment ply/side/SAN/FEN must match independent source PGN replay; explicit before/after board references are scoped to the correct recorded move; quoted or denied claims abstain; unsupported prose and non-English text never receive full factuality certification.

This remains **lexical scope control, not general natural-language interpretation**. Sarcasm, nesting, arbitrary counterfactual constructions, implications, ambiguous antecedents, untranslated language, causal chess teaching and player-quality judgments remain **unassessed**. All results have `full_factuality_certified:false`, including a successful `limited_claims_passed` for an isolated literal.

## Hostile verification and regression evidence

`scripts/review-benchmark-coach-conditional-matrix.mjs` creates **68 hand-authored finite cases** against the exact legal PGN, using no external model, no Stockfish execution and no real users. `scripts/review-benchmark-coach-conditional-proof.mjs` checks **44 separately enumerated gold cases**, the independent checkmate/king coordinates, all 68 rows and explicit abstention evidence. `scripts/review-benchmark-coach-conditional-negatives.mjs` rejects **48/48** intentionally forged evidence packets, including fabricated certification, treating an `if` antecedent as a contradiction, silently upgrading a true hypothetical to a proved statement, removing the result of a separate direct false assertion, and hiding conditionals across user perspectives. `scripts/review-benchmark-coach-conditional-boundary.mjs` executes the real checker in a **fresh subprocess**, binds stdout to the ignored raw JSON with a matching unique UUID, and independently rejects a deliberately forged negative outcome.

**Verifier self-audit:** the first proof implementation independently checked 44 named cases and the aggregate counts, but a deliberate **swap of two unselected case verdicts** (one hypothetical wrongly promoted to partially verified, another demoted) could still pass because the totals stayed constant. This was reproduced before commit. The proof now SHA256-pins **the ordered inputs and the individual outcomes of all 68 synthetic cases**, in addition to the 44 independently adjudicated gold references. The same forged swap now fails (`a changed or swapped result escaped the aggregate counts`). The **two additional negative controls** also reject replacing the text of an unselected case. The fixed digests are commitments to this small hand-authored fixture, not semantic proof of unrestricted English language.

| QA-only verdict | Cases | Significance |
| --- | ---: | --- |
| `not_evaluated` | **51** | Hypothetical/speculative/questioned claims abstained, with no false contradiction or proof |
| `partial_claims_verified` | **7** | Separate direct truths proved but imaginary clauses explicitly unassessed |
| `rejected` | **6** | Standalone/direct false winner or piece-square assertions still rejected |
| `limited_claims_passed` | **4** | Narrow, standalone, correct literal claims positively verified |
| **Total** | **68** | Every new bounded QA sample checked |

**Broader regression:** the original **18** claim controls, **58** source/provenance controls, **59** scope/abstention matrix and its **48** forged-evidence controls, **38** real-coach evidence controls and existing five-language evidence checks all remain green. Application contract **1,077 assertions** and the self-authored fixture manifest **25/25** checks remain green. A separate **fresh pinned real Agent B** `analyzePgn()` + `buildGameReview()` test still demonstrates the **two deliberately injected false model strings** reaching the product output (wrong winner and wrong king square) in **6 local fake-vLLM requests**. The independent QA checker continues rejecting those direct lies. None of those local synthetic checks establish actual deployed-model error rates or release readiness.

## Reproduction

From the Agent D QA checkout, using its installed dependencies and existing pinned, read-only worktrees:

```sh
node scripts/review-benchmark-coach-conditional-boundary.mjs
node scripts/review-benchmark-coach-conditional-negatives.mjs
node scripts/review-benchmark-coach-conditional-proof.mjs
node scripts/review-benchmark-coach-provenance-negatives.mjs
node scripts/review-benchmark-coach-claim-negative-controls.mjs
node scripts/review-benchmark-coach-scope-boundary.mjs
```

**Provenance:** synthetic manifest v2 SHA256 `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`, recorded PGN `SYN-GAME-FOOLS-MATE`. Frozen Agent B SHA `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`. Prior real pipeline's pinned Stockfish **16** SHA256 `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca`, depth **8**, 1 thread, 16 MiB hash. **New modal matrix:** zero model calls, zero engine calls, only the independently replayed four-ply PGN. The full QA source SHA256 list, fresh matrix UUID, ordered input/outcome SHA256 commitments, independent control counts and `release_approved:false` appear in `certification-summary-checkpoint26.json`.

## Ownership, unresolved blockers and exact next step

The origin refs for A, B, C, `main`, and PR #17 remain unchanged; detached candidate worktrees are read-only. Agent B still has the independently reproduced false-coaching-output issue and a cross-session language/audience cache race. Agent C still has Spanish content with root HTML `lang="en"` in the pinned source. These product issues are **not fixed by better QA abstention**, and there is no sealed independently judged human coaching holdout or production-equivalent engine/load/accessibility certification.

**Next session:** check new owner SHAs first; if Agent B or C has changed, pin a new detached read-only candidate and rerun the applicable real pipeline/browser regressions. Otherwise continue a source-anchored targeted audit of **unassessed conditional/temporal references**, testing any newly discovered QA limitation with positive and hostile negative controls. Never extend the checker into an invented general semantic oracle merely to make it appear comprehensive. **No release approval, `main` merge, migrations or ownership crossover.**
