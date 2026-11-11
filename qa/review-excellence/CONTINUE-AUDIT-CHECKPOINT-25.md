# Agent D — Checkpoint 25: partial prose coverage, quotation/negation, and multilingual abstention

**QA branch:** `agent/review-benchmark-20261111`. **Previous pushed checkpoint:** `b8d50abc528a9b61ac243dfc4f351cfcc43a88bd`. **Frozen, read-only Agent B coach:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`. No scoring changes, PR #17 modification, production SQLite, remote LLM, browser account or merge into `main`.

## Two new independently reproduced false interpretations in Agent D's *own QA checker*

**1. An unrecognized false statement vanished when another literal was true.** In the synthetic Fool's Mate, the actual winner is Black and White's king is at e1. The former independent English checker returned `limited_claims_passed` with **`unassessed:[]`** for this report:

> Black won the game. The white monarch sits on e2.

The first literal statement was independently correct, but the second unsupported, deliberately false paraphrase was **not examined**. A similar false-green interpretation was possible for unrecognized pedagogical/tactical prose. The checker had explicitly declared that full prose was not certified, but its empty `unassessed` field obscured important coverage gaps.

**2. Negation/quotations triggered false contradictions.** The previous checker rejected **“It is false that White won the game. Black won the game.”** because it matched the embedded phrase “White won the game” without recognizing the explicit denial. It similarly rejected quoted warnings such as **“Do not write ‘White won the game.’”**. These are genuine **QA false rejections**, not demonstrated product hallucinations.

## Bounded, fail-closed corrections

`scripts/review-benchmark-coach-claim-adapter.mjs` remains a **small independent English-only lexical checker**. Its result is now:

| Verdict | Meaning |
| --- | --- |
| `limited_claims_passed` | Some narrow, directly recognized claims were independently proved; no unchecked *word span* was found among the supplied prose fields. **Not full model certification** |
| `partial_claims_verified` | At least one literal was proved, but additional prose spans or specific quotes/denials were **not evaluated**. This is an **explicitly partial, not green, result** |
| `not_evaluated` | No checkable statement could safely be proved, or the declared report language is unsupported. **No correctness inference** |
| `rejected` | A recognized literal conflicts with legal PGN/verified checkmate, or key-moment provenance is invalid. **A scoped contradiction, not blanket language understanding** |
| `invalid_input` | The structural input or source PGN cannot be independently validated |

The checker now removes only its **matched literal spans** before checking for remaining alphabetic/numeric prose. Any other words in the summary, instructional assessment, opening, phases or moments generate `unchecked_prose_remainder`, even if a separate literal claim is true. Quotes and **narrow, explicitly recognized** `It is false that`, `Do not say`, `Never claim`, and similar disavowals are marked `quoted_or_disavowed_*_not_assessed` rather than interpreted as product assertions. Straight closing quotation marks no longer incorrectly swallow the next sentence's independent claim. Leading emoji and other nonword ornamentation before a denial are recognized, and the matching algorithm now uses **UTF-16 code-unit offsets** for both regex matches and residual-text masking, so astral Unicode symbols cannot misalign evidence spans.

**Explicit limitation:** These are selected lexical contexts, **not** a grammar parser. Even a completely covered literal sentence only supports that narrow proposition; implications, tactical cause, pronouns, sarcasm, conditional claims, pedagogy and any claim outside the small supported grammar remain unproven. Unsupported languages are **abstained**, not automatically treated as false or accepted. `full_factuality_certified:false` is returned in every case, including malformed inputs.

## Measured independent negative controls

`scripts/review-benchmark-coach-scope-matrix.mjs` uses one pinned self-authored Fool's Mate, the independently replayed PGN board, and **reuses** previously recorded Agent B actual `buildGameReview` outputs injected by a localhost fake model in **five** languages: `en`, `es`, `de`, `bg`, `ru`. **No new provider/model requests** are made for the matrix.

| Bounded outcome | Samples |
| --- | ---: |
| Exact literal claims, limited verified | **6** |
| Explicit contradicted literals rejected | **11** |
| Partial facts with visible unchecked prose | **27** |
| Unsupported/ambiguous: intentionally not evaluated | **15** |
| **Total** | **59** |

The matrix includes direct true/false English winners and piece squares, user-perspective Black/White winner claims, false indirect metaphors, separate literal truth + unsupported false prose, clear denial versus an actual false claim, quoted claim boundaries, leading astral emoji, and previously recorded **five-language** model replies. For `es`, `de`, `bg`, and `ru`, the independent English checker must report **`not_evaluated`**, including when an English sentence appears inside a non-English-labeled review. For English-labeled mixed-language prose, recognizable English literals may be verified **only partially**, while the foreign sentences remain visible in the `unassessed` ledger.

`scripts/review-benchmark-coach-scope-proof.mjs` derives the legal game result and king square independently, revalidates the existing fixed five-language attack record, checks **30 independently named gold cases**, all 59 result rows and counts, and links the new scope packet to the earlier real-coach evidence. `scripts/review-benchmark-coach-scope-negatives.mjs` rejects **48/48 deliberately forged evidence packets** (missing language trials, altered SHA, falsely approved non-English claims, swallowed negations, missing unassessed spans and false release green). A fresh subprocess wrapper `scripts/review-benchmark-coach-scope-boundary.mjs` also binds its test to a unique UUID, matching stdout and ignored raw JSON to prevent replay of an earlier successful result.

The previous Checkpoint 24 real-owner pipeline and 58 provenance + 18 original literal tests still operate under the stricter `partial_claims_verified` reporting; earlier *historical* certificate JSON files are intentionally **left unchanged**. Agent B's actual snapshot still accepts the two QA-fabricated false model statements **“White won the game.”** and **“White's king is on e2.”**. A narrowed QA scope result is **not** a product-factuality fix or evidence of real hosted-model hallucination frequency. The previously recorded **27/27 passing Agent B coach unit tests** do not cover those escapes.

## Reproduction, provenance, next step

```sh
node scripts/review-benchmark-coach-scope-boundary.mjs
node scripts/review-benchmark-coach-scope-negatives.mjs
node scripts/review-benchmark-coach-scope-proof.mjs
node scripts/review-benchmark-coach-provenance-negatives.mjs
node scripts/review-benchmark-coach-claim-negative-controls.mjs
```

Candidate B `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`. Manifest v2 SHA256 `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`. Actual game result `0-1`, White king `e1`. The historical real-coach attack used **Stockfish 16** with SHA256 `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca`, **depth 8**, 1 thread and 16 MiB hash. The **new scope test does not run Stockfish**; it independently replays the four-ply synthetic PGN in `chess.js`. No private games, production DB or external model are used. A fresh synthetic run UUID, sampled statuses, source SHA256 pins, hard-coded limited gold controls and release refusal are stored in `certification-summary-checkpoint25.json`.

**Owner coordination:** Agent B's coach-output factuality and profile provenance findings (Checkpoints 6, 23) remain unresolved on its frozen commit. Agent C's root `<html lang>` still does not follow Spanish UI on the frozen product commit. No owner source was touched in this QA lane. The validated metrics describe **QA capability and abstention**, not human coaching reliability, native-language correctness, field error rates, live model quality or a held-out release score.

**Next safe work:** When Agent B/C publish new source SHA(s), pin isolated read-only worktrees and rerun the original hostile coach/cache/profile and root-language tests, looking for regression in positive controls; otherwise extend QA to **meaningful actual human-labeled holdouts** before claiming lesson quality. No automatic PR #17 merge, no `main` push, no live migrations or integrations. **Product/release certification stays blocked.**
