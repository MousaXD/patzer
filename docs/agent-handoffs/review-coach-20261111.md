# Agent B — Review Coach truth and offline fallback (2026-11-11)

**Branch:** `agent/review-coach-20261111` (based on `main` at `51df1d852296e5f0644127a81b5ec31109c8e6c1`)

## Confirmed findings / reproductions

1. **Unknown evaluation fabricated as 50%:** `server/src/coach/review.ts` previously converted nullable before/after CP scores to `0`, causing unsupported `win_pct_before/after`, turning points and misleading narrative evidence. A synthetic seven-move example with both CP values set to null now asserts null win percentages and no invented turning point.
2. **Custom-FEN Black-first ownership:** the written summary used odd/even `ply` rather than the recorded `fen_before` side-to-move. A Black-to-move FEN with `ply: 1` was attributed to White. The evidence path now follows the FEN's turn (retaining parity fallback for malformed legacy data); phase selection and summary are consistent.
3. **Review blocked without an LLM:** `/api/:id/review` rejected `llm_not_configured` before reaching existing localized deterministic fallbacks. It now generates a review without contacting a model. An offline regression checks German prose, moment ownership and progress events.
4. **Fallback falsely asserted the game turned and used CP loss as pawn material:** all five localized key-moment fallbacks now avoid both unsupported statements. They provide the move verdict and a modest general next-step prompt instead.
5. **Critical mate claims accepted without local proof:** review prose had no gate for invented checkmates or exact mate-in-N. Key moments now reject explicitly quantified mate claims and unverified checkmate references, falling back to localized deterministic text. A legal short line ending in mate can justify the existence of mate in that line but not an assertion that it was forced. Adversarial tests include fabricated English, German and Russian claims, a genuine legal `Qxf7#`, and invalid mate-in-2 even when a real mate follows.

## Evidence and limits

- The guard is an **initial narrow negative control**, not a natural-language proof system. It does not establish that claims about forks, pins, threats, piece locations, win probability or forcedness are correct. Earlier `contradiction()` only checks verdict sentiment; it now also filters own-move key-moment prose, conservatively using fallback on contradiction.
- The best-PV mate check replays SAN legally (up to eight plies); it is not a forcedness proof or a complete chess engine search. Future versions should validate every claim against a versioned evidence contract (source FEN, actor, legal PV, eval POV, engine budget, mate score, confidence).
- No personal PGN was copied into source control, no external LLM generation was requested, no database migration or active SQLite access took place. All fixtures are synthetic.
- This wave does not rewrite scoring, frontend review interactions, LLM provider logic or protected runtime/deployment code. Agent A owns evaluation semantics and mate-depth metadata. Agent C owns how confidence and fallback provenance are displayed. Agent D should curate 20+ adjudicated claims and sealed holdout cases for independent certification.
- Prose cache version increased from `4` to `5` to avoid retaining pre-fix generated prose. This means prior reviews need regenerated prose on request; no bulk re-generation is authorized. A previous cache may remain in the database but is treated as stale by the API.

## Validation protocol

Run from the clean branch checkout with Node 22 and local built `better-sqlite3`:

```
npm ci --no-audit --no-fund
npm run typecheck
npx vitest run server/test/review-perspective.test.ts server/test/coach-coaching.test.ts server/test/coach-german.test.ts server/test/coach-russian.test.ts
npx vitest run
git diff --check
```

Exact results and commit SHA belong in the final handoff after last validation.

## Next targeted improvement

Introduce a structured `coach_claims_v1` DTO before attempting full-position fact verification: `claim_id`, `fen`, `actor`, `claim_type`, `evidence_pv_uci`, `score_pov`, `engine_budget`, `proof_status`, and `fallback_reason`. Add a strict evidence validator that fails closed on illegal PVs or unsupported forcing claims; let the model *phrase* confirmed claim templates, not invent tactical facts. Request approval of shared DTO changes from integrator and A/C first. Do not train prompts on sealed holdout answers.

## Batch 2 — implemented internal `coach_claims_v1`

Changes remain on this **same Agent B branch**; no scoring, frontend, database migration, or other agent's worktree was edited. The new internal `server/src/coach/claims.ts` contract is **not yet a shared backend/UI API**:

- `CoachClaimV1`: stable `claim_id`, `source_fen`, `actor`, `played_san`, `evidence_type`, optional variation SAN / target squares and piece/color/snapshot.
- `CheckedCoachClaimV1`: `contract_version: 1`, `proof_status` (`verified`, `contradicted`, `insufficient_evidence`), method, exact validated line and machine-readable reason.
- Legal played move, full legal PV, check, checkmate, capture, possible immediate opponent mate/capture, geometric fork and *absolute* king pin have independent `chess.js` checks. A legal PV **never** proves that it is the best or a *forced* response. `hanging_piece`, `material_win`, `threat`, and `forced_line` deliberately return insufficient evidence.
- In generated **key-moment** text, known high-risk tactical claims must match locally proven evidence. Fork/pin claims must name the moved attacker and each verified target **with their actual piece and square**; vague or mismatched claims fall back. Known overclaims are screened in all five languages. General phase/summary text has no single FEN, so generated tactical assertions are rejected rather than blessed by fluent JSON.
- Model JSON is checked for string fields and non-empty explanation. Partial, malformed, contradictory, or disproven responses trigger localized fallback. Aborted Game Review requests stop at step boundaries and may not reach the cache write; a disconnected SSE stream can abort the generation. The direct `/coach/explain` path now also screens critical claims, retries once and falls back without requiring an LLM.
- Opening fallback no longer asserts it was a “solid choice” just because an ECO name exists; one-game skill fallback no longer presents estimated Elo as an established rating. `REVIEW_PROSE_VERSION` advanced **5 → 6**, invalidating old cached prose on-demand rather than bulk regenerating.

### Before/after — synthetic Scholar's Mate trap

**FEN before Black's 3...Nf6??:** after `1.e4 e5 2.Qh5 Nc6 3.Bc4`.

| Input/old behavior | Batch-2 behavior | What is actually proved |
| --- | --- | --- |
| “The bishop on a3 pins the queen.” Previously a valid JSON string could be accepted in a written review. | Rejected as ungrounded; player receives recorded verdict plus proven mate reply and optional legal alternative. | No bishop on a3; piece-square mismatches fail. |
| “3...Nf6 forces mate in 2.” A legal PV previously looked like evidence. | Rejected: `forced_line` lacks proof; exactly quantified mate claims remain blocked. | White **can** play `4.Qxf7#` legally, and that move checkmates. It does not prove every continuation is forced. |
| “Your knight forks the queen and rook.” | Rejected unless the moved attacker and all claimed targets match the actual verified squares and piece types. | Geometry can show two attacks, but not a net material win. |
| “King's Pawn Game — a solid choice.” | “The opening was recorded as King's Pawn Game; its name alone does not establish how well it was played.” | ECO/opening identity is not move-quality evidence. |
| “This game was 2,500 Elo.” | “One game cannot establish your playing strength; focus on the decisions you can improve.” | Numeric game-performance estimates are not skill certification. |
| Malformed JSON containing `prose: 123` could produce empty key-moment prose. | Empty/wrong-type result is rejected with localized fallback. | Parser success is not a factuality guarantee. |

### Twenty candidate adversarial claim labels for Agent D

All positions are synthetic; these are **candidate** rule-level labels, not a sealed human-adjudicated gold dataset. `S` means the Scholar's Mate FEN above; `F` means the synthetic `1.e4 e5 2.Nf3 Nc6 3.Nc3 Nf6` position with `4.Nd5`; `P` means `4k3/4n3/8/8/8/8/8/4R1K1 w - - 0 1` with `Re2`.

| ID | Claim at S/F/P | Expected validation |
| --- | --- | --- |
| B01 | S: Black to play Nf6 | Verified actor |
| B02 | S: White to play Nf6 | Contradicted actor |
| B03 | S: Nf6 is a legal move | Verified replay |
| B04 | S: Qxf7# is Black's legal move | Contradicted |
| B05 | S: legal line Nf6 Qxf7# | Verified **line only** |
| B06 | S: legal line g6 Qxf7# | Contradicted illegal PV |
| B07 | S: Nf6 directly checkmates | Contradicted |
| B08 | S: Qxf7# is a legal opponent mate reply | Verified *possible reply* |
| B09 | S: Nf6 forces mate in 2 | Insufficient forcedness proof |
| B10 | S: bishop on a3 | Contradicted board-square |
| B11 | S: knight forks queen and rook | Contradicted targets |
| B12 | S: bishop pins a knight | Insufficient/contradicted geometry |
| B13 | S: the queen is hanging | Insufficient exchange proof |
| B14 | S: the move wins a rook | Insufficient material proof |
| B15 | S: there is an unstoppable threat | Insufficient defense search |
| B16 | `1.e4 d5 2.exd5`: pawn captures pawn | Verified capture, **not** net material |
| B17 | S: Nf6 captures a piece | Contradicted |
| B18 | P: Re2 pins e7 knight to e8 king | Verified absolute-pin geometry |
| B19 | P: Re2 pins e6 piece | Contradicted |
| B20 | F: Nd5 attacks c7 pawn and f6 knight | Verified attack geometry, **not** a won fork |
| B21 | S: play Nf6 Qxf7# a6 | Contradicted: game is over |
| B22 | Missing before/after CP: infer 50% win probability | Contradicted; value remains unknown |

### PR #17 / cache compatibility — confirmed and partially guarded

`scripts/recalculate-accuracy.mjs` in the separate PR #17 **retains** existing `prose_json` while migrating scoring version 9 to 10; it stamps `accuracy_model_version: 9` on the retained prose, intentionally deferring any paid re-generation. The existing Review GET only compared prose version, language and audience. That would silently allow an old numeric narrative alongside new scores if the prose version otherwise matched.

Batch 2 adds a read-only guard to `routes/review.ts`: if cached prose has `accuracy_model_version` and that marker differs from the row's `scoring_version`, GET returns `{review:null,stale:true}`. It does **not** delete or rewrite data. Absence of the marker remains ambiguous, including possible future scoring-version changes; v6 itself is not a robust scoring-aware provenance key.

**Proposed shared-contract request (not implemented):** `COACH-CACHE-001` — bind future report cache provenance to `scoring_version`, `review_prose_version`, `language` and `audience`, ideally with an additive internal persistence field or versioned metadata in `prose_json` reviewed by integrator and Agent A/C. Specify behavior for historical unmarked caches and PR #17 backfill before changing database columns or shared UI types. Never run bulk AI regeneration without explicit owner authorization.

### Residual risks / dependencies

- Factual screening is a conservative multilingual lexicon, **not** complete semantic proof. Implicit false strategic claims, unrecognized synonyms, mismatched time references, subjective intentions, multiple legal alternatives, and all possible false actor pronouns still need independent adversarial review and a stronger typed-claim renderer.
- A fork/pin proof checks geometry in a single position; it does not prove a tactic succeeds, an opponent has no defense, or that material is won. Board-square text can still be semantically misleading about *when* a piece occupied the square. Do not present `verified` as engine-verified forcedness.
- The streaming **hint** route still forwards model chunks before whole-answer factual verification. It needs a separately agreed buffering/fallback behavior (and accompanying frontend loading semantics) before being called trustworthy.
- No shared API fields were added. Before agent C can display provenance/confidence badges or agent A can publish engine certainty, agree on a versioned additive contract. Agent D owns human adjudication, holdout independence, and broader validation.
- No live database, accounts, credentials, remote paid model, service deployment, auto-updater or historical user games were accessed or modified.

**Verification:** run `npm run typecheck` and `npx vitest run` from the isolated branch. Record exact final totals/SHA in the terminal handoff; the test fixtures exercise all five languages, wrong actor, illegal SAN/PV, mate claims, false motifs, misleading fallbacks, malformed model JSON, no-LLM response and aborted build.

## Batch 3 — spoiler-safe hints, stream completeness and deterministic claim IDs

This continuation found and reproduced two distinct flaws that remained after `47b571c`:

1. **Hint disclosure before verification.** `/coach/hint` streamed LLM tokens directly to the user. A reply ending with a move such as `g6`, an invented threat, or a false mate could leak an answer irreversibly. `coachHint()` now buffers the complete response, applies a strict no-SAN/no-square/no-unproved-tactic screen and sends only a validated complete hint. It uses short localized question-based fallback text on invalid, oversized, unavailable or interrupted generation. With the LLM disabled it skips the unnecessary coaching engine/memory work altogether. The SSE wire format remains unchanged, but Agent C should expect one chunk rather than gradual token streaming; this may affect loading UX and requires their approval to change UI.
2. **Incomplete streams treated as success.** The coach's LLM transport previously returned successfully when a local fake provider closed after text tokens but before `[DONE]` or `done:true`. Malformed frames were silently skipped, and exceptions raised by a consumer callback were also swallowed. `chatStream()` now requires a terminal completion marker (or an explicit stop reason), rejects a `length` truncation and malformed frames, propagates callback exceptions, and refuses already-aborted calls before resolving a model or opening a connection. The same pre-abort guard is applied to non-streaming `chatJson()`. Local HTTP negative controls cover vLLM, Ollama, DeepSeek, malformed frames and truncated generations.
3. **Non-unique evidence identifiers.** `momentEvidence()` used the same `claim_id` for multiple captures from one position. This violated its own evidence traceability contract. New IDs are deterministic SHA-256 digests of FEN, actor, move, claim type and all claim-specific parameters. Synthetic multiple-capture fixtures prove IDs are unique and stable. These identifiers are INTERNAL and not a newly published UI/API contract.
4. **Disconnected clients.** The `/coach/explain` and `/coach/hint` SSE handlers now relay request/stream abort to generation and avoid sending success/error/done events after known cancellation. This does not mean the existing independent Stockfish engine run can always stop immediately; Agent A owns engine cancellation and cross-service admission.

The existing `COACH-CACHE-001` request remains unresolved. PR #17's scoring migration preserves old prose with a scoring marker; new unmarked review-cache blobs from historical versions remain ambiguous. No shared schema, scoring formula, PR #17 code, user data, auto-review schedule, deployment or frontend was modified in Batch 3.

**Safety boundaries and remaining work:** A lexical hint screen cannot detect every natural-language spoiler (e.g. a move fully spelled out in words); proof statuses for tactics are not guarantees of an inevitable outcome. The safer fallback is used when evidence is insufficient, but its generic nature should be evaluated with learners. A complete claim-typed renderer and scoring-aware cache provenance require interface agreement with Agents A/C and integrator. Agent D should run independent holdout/adjudicated negative controls rather than relying on these developer fixtures.

**Validation checkpoint:** targeted tests and TypeScript/full-suite results must be recorded at the final commit SHA, not inferred from older green runs. Continue from this section; do not re-run old investigations without new contradictory evidence.

### Batch 3 local verification and integration note

- `npm run typecheck`: **passed**, including server, web and test typings.
- `npx vitest run server/test/llm-providers.test.ts server/test/coach-coaching.test.ts server/test/coach-claims.test.ts server/test/review-claims-pipeline.test.ts server/test/review-perspective.test.ts`: **102/102 passed** before the final added pre-abort/overlong-hint cases; the complete suite includes those additions.
- `npx vitest run` with the default 5-second test timeout: **764 passed, 1 failed**, an unrelated Review library UI test timed out at exactly 5 seconds during concurrent load. Running that file alone immediately afterward: **12/12 passed**. Do not claim the default-configuration run was green or modify C's code to mask a resource-sensitive test.
- `npx vitest run --testTimeout=15000`: **765/765 passed across 91 test files** on the final sources, with no tests skipped in that run. This is a local verification with an explicit 15-second per-test timeout, not GitHub CI certification.
- `git diff --check`: passed. No live database, model spending, or deployment was involved.
- Read-only `origin` inspection: Agent A `839fcc5`, Agent C `8d1674e`, Agent D `4f2b275`; no overlapping tracked source paths with B's changed files at the inspected remote heads. These heads can move and must be rechecked at integration.

**Continuation target:** The scoring-version provenance of historical unmarked report caches needs an integrator-approved contract before modifying shared DTO/database formats. The current validator only proves a limited set of legal and geometric facts; true tactical necessity, complete semantic correctness, and all-language paraphrase verification remain open. Agent C should independently assess whether one complete validated hint chunk needs a loading-state adjustment; Agent D should independently run claim-negative controls and evaluate learner usefulness.

## Batch 4 — exact named SAN and implied hint spoilers

Adversarial fixture: the synthetic Scholar's Mate trap, after `1.e4 e5 2.Qh5 Nc6 3.Bc4` with Black's recorded `Nf6`, for which White **could** play `Qxf7#`.

1. **A verified mate did not constrain the named mating move.** The checker previously accepted “White could mate with `Qh4#`” simply because a *different* valid mating reply (`Qxf7#`) existed. It now checks explicit SAN references against the recorded move, legal recorded alternative and independently verified local continuations. The fabricated `Qh4#` is rejected across all five prose languages, while “White could reply with `Qxf7#`, checkmate” remains allowed.
2. **Actor and ownership false positives.** The checker previously accepted “White played `Nf6`” when Black moved, and “Black's queen on h5” when White owned that queen. Explicit English move-agent and piece-owner statements are now checked against the source board. A line indicating “White **played** `Qxf7#`” still falls back even if that move was *possible*: a legal reply is not proof the player **actually made** it. Actual subsequent game-play evidence needs a future structured input; do not claim one exists here.
3. **Moves disguised as a hint.** “Move your pawn forward on the kingside” was accepted because it had no SAN or square. A conservative direct piece-move imperative screen now rejects equivalent phrases in English, Bulgarian, Spanish, German, and Russian. It does **not** prove that every indirect natural-language spoiler can be found; a question like “What checks and captures do you see?” remains acceptable.
4. **Cache invalidation.** Raised `REVIEW_PROSE_VERSION` **6 → 7**. Previously cached v6 prose did not pass these new screens at creation and must not remain silently reusable. Review regeneration remains **on-demand**, with no bulk model jobs or live data edits. This does not solve the separate scoring-model provenance contract (`COACH-CACHE-001`).

**Tests and audit:** Added targeted negative controls and adversarial full-pipeline cases, including false named mating SAN, wrong actor, wrong piece owner, possible-vs-played reply, and five-language implied hint spoilers. All 771 tests across 91 files passed locally with `--testTimeout=15000` before the final cache version constant change; the version change has its own cache-key regression. Run focused and full verification again before final push. No other agents' code, production app, deployed database or API costs touched.

**Next evidence-backed issue to investigate:** Manual `/review` generation and the automatic review worker both cache results using an unconditional `UPDATE analyses ... WHERE game_id=?` **after asynchronous generation**. If scoring or analysis changes during that period, an old report can overwrite the new analysis's cache. Reproduce with a disposable SQLite snapshot, then implement a conditional single-statement cache write that fails closed when any source evidence changes; avoid shared DB schema changes and coordinate integration with Agent A's scoring work.

## Batch 5 — prevent stale asynchronous report writes

The predicted source race was confirmed directly in both persistence paths: `server/src/routes/review.ts` and `server/src/autoReview.ts` previously used `UPDATE analyses ... WHERE game_id = ?` after awaiting the complete report. A concurrent analysis, PR #17 score reaggregation or a second review could change the row between the initial SELECT and the unconditional UPDATE.

Added `server/src/coach/reviewCache.ts` with an **atomic single-statement SQLite compare-and-swap** shared by manual Review and the automatic review worker. The report is written only if its original scoring version, depth, full moves JSON, key moments, phase split, both accuracy scores, both Elo estimates, performance scores, opening metadata, and existing prose all still match. It also verifies original game owner, user colour and PGN. The equality checks use SQLite `IS` for nullable fields; no schema migration, process-global lock, or multistatement TOCTOU check was introduced.

On concurrent changes the manual Review emits `review_source_changed` instead of returning/caching a report against different evidence. The automatic worker logs and discards the stale result rather than overwriting a newer cache. It does **not** automatically spend more model tokens retrying discarded work. This conditional write prevents stale storage; it does not guarantee an in-flight LLM request is canceled when scoring changes, or make legacy unmarked caches score-aware for future scoring versions. `COACH-CACHE-001` remains an integration dependency.

The new `server/test/review-cache-race.test.ts` uses an **in-memory SQLite database** (not user records). Its 19 negative-control fixtures cover each protected analysis field, scoring migration, a newer concurrent prose value, changed game PGN/colour/owner, and null-value comparisons. A valid unmodified report is saved with the current prose version and language/audience. `npm run typecheck`, the 19 test cases and `git diff --check` passed before final full-suite/build certification.

**Final local certification, Batch 5:** `npm run build` succeeded (server and web). `npx vitest run --testTimeout=15000` passed **790/790 tests across 92 files** with the explicit 15-second per-test timeout, including the 19 disposable database tests. `npm run typecheck` and `git diff --check` also passed. The current Agent B branch was compared read-only to newer remote Agent A `7178e26`, C `8e49476`, D `7e53145`, and PR #17 `02bfe98`—no overlapping source paths from those review agents were found. This is local certification, **not** a claim that hosted CI ran.

**Safe re-entry after this checkpoint:** inspect latest Agent A and PR #17 branches read-only, then consider whether additively versioned scoring provenance can be agreed with integrator and Agent C. Without that agreement, prioritize independent adversarial coach text and performance checks instead of mutating shared API or persistence formats. Keep the stale-write tests, and never silently relax the compare-and-swap predicate to optimize away validation.

## Batch 6 — explicit mover attribution in all supported prose languages

The prior Batch 4 guard could correctly reject the English “White played `Nf6`” in a position where **Black** played `Nf6`, but silently accepted the equivalent assertion in Bulgarian, Spanish, German, and Russian. This was independently reproduced with the synthetic Scholar's Mate fixture and fixed with narrow, language-specific named-actor + past-tense verb + SAN patterns in the internal claim screen. In each locale, the true Black-mover statement still passes, while wrong-actor and unproved *actually played* reply assertions fail closed. No engine scoring or UI localization code changed.

**Cache safety:** `REVIEW_PROSE_VERSION` **7 → 8** so previously accepted prose from weaker locale rules is marked stale on GET and may be regenerated on demand. This is a prompt/prose interpretation change, **not** a shared API or database schema change; it does not alter scoring-model provenance (`COACH-CACHE-001`).

**Limits and next target:** A multilingual lexical actor matcher only verifies a finite set of direct statements. Indirect phrasing, unstated subjects, translated piece-ownership assertions, forcedness and all variant SAN phrasing still need independent human/chess review or typed evidence-to-text generation. Do not claim complete language-level semantic reliability on these tests alone. Run the full local suite and build at this branch head, then commit and push only Agent B. This remains a private test-only worktree; no live game records, production services, or remote model spending.

**Batch 6 final validation:** `npm run typecheck` passed and `npx vitest run --testTimeout=15000` passed **791/791 tests across 92 files** after prose-cache version 8, including the new four-locale actor regression. The immediately previous Batch 5 checkpoint's production build succeeded; this Batch 6 change is TypeScript-only and was not rebuilt separately. `git diff --check` passed in the same validation command. No hosted CI or actual paid LLM generation was run.

**Next continuation action:** first inspect the current branch and newest remote Agent A/C/D commits read-only; do not re-run the completed Batch 4/5/6 investigations without new contrary evidence. Agent D's independent coach truth benchmark and `COACH-CACHE-001` integrator contract are still the main trust gaps. A legal line, a geometric pin or a multilingual keyword check remains weaker than a proven causal explanation.

## Batch 7 — cache metadata concurrency negative controls

Follow-up to the verified Batch 5 compare-and-swap: the atomic SQL checked `prose_json` but not `prose_version`, `prose_lang`, or `prose_audience`. A concurrent request could change any of those three metadata fields *without* changing `prose_json`, then have its metadata silently overwritten by the older pending report. A new three-case negative-control test reproduced the bug: all three were accepted by the old save.

`ReviewCacheSource` now captures all three fields. The single-statement SQL includes exact, null-safe comparisons of `prose_lang` and `prose_audience` and exact comparison of `prose_version`; the automatic worker's initial SELECT includes those fields. The manual Review source SELECT already included them. Both flows continue to fail closed on stale input without retrying or spending extra model tokens.

**Certification at this checkpoint:** `npx vitest run server/test/review-cache-race.test.ts` **22/22 passed** after the fix; `npm run typecheck` passed. `npm run build` passed both server and web, and `npx vitest run --testTimeout=15000` passed **794/794 across 92 files**. No migrations, user records, deployed servers, or paid models touched. Run `git diff --check` before committing. Cross-agent contracts are unchanged; the remaining risk is *ABA*: another producer can alter evidence and change it back to byte-for-byte identical values before the CAS. Eliminating that requires a separately agreed monotonic analysis-generation token, not a guessed schema change in Agent B.

**Next evidence-backed audit:** `screenCoachProse()` checks named piece moves and captures, but its `quotedSan` regex does not enumerate quiet pawn SAN such as `g5`. Verify whether an LLM can fabricate a quiet pawn recommendation while another different move is the only engine-backed alternative. Fix with a narrow, position-aware rule and negative controls without interpreting board-square descriptions as asserted moves. Preserve all five supported languages.

## Batch 8 — quiet pawn SAN claims versus square locations

Confirmed with a synthetic Black-to-move `Nf6` mistake that the model statement “Play `g5` instead of `Nf6`” was accepted even though the recorded legal alternative was `g6`, not `g5`. The previous `quotedSan` screen recognized named-piece SAN and captures, but **not** quiet pawn SAN (the same token could also name a board square).

Added a narrow language-specific verb/recommendation screen for explicitly advised quiet pawn moves (English, Bulgarian, Spanish, German and Russian) and checked each claimed SAN against the position-grounded evidence allowlist. A verified suggestion such as “Play `g6` instead of `Nf6`” remains allowed; unrelated invented advice such as “Play `g5`” and “The best move is `g5`” is rejected. Ordinary positional notation such as “the pawn on `g5`” is **not** treated as a recommended move by this screen; any claim that a piece occupies that square remains subject to the separate board-piece check.

Added adversarial negative controls both to `coach-claims.test.ts` and the model-to-Game-Review pipeline test (wrong `g5` prose falls back). Updated `REVIEW_PROSE_VERSION` **8 → 9** so cached explanations created under the weaker acceptance rules are marked stale without bulk regeneration. There are no shared contract changes, model calls, scoring edits or production data edits.

**Verification checkpoint before final full suite:** `npm run typecheck` passed, focused test run `npx vitest run server/test/coach-claims.test.ts server/test/review-claims-pipeline.test.ts server/test/review-perspective.test.ts server/test/review-cache-race.test.ts` passed **59/59 across 4 files**, and `git diff --check` passed. Full local suite and build results must be recorded before pushing. Caveat: the lexical screen does not understand indirect multilingual advice such as “the pawn wants to advance two squares” and does not prove engine-defined positional superiority. Keep this gap visible to Agent D's independent benchmark; do not call a legal move a winning tactic merely because it is allowed by the SAN screen.

**Batch 8 full local certification:** `npm run build` succeeded for the server and frontend. `npx vitest run --testTimeout=15000` passed **797/797 tests across 92 files**. `npm run typecheck` and `git diff --check` passed. The latest read-only inspection of Agent A `7178e26`, C `2a72364`, D `bb10992` and the separate accuracy PR branch `02bfe98` found no source path overlap for this Batch 8 coach work. These are local tests, not hosted CI or human pedagogy certification. No model calls, user-data modifications, or deployment performed.

**Next independent audit:** Recheck whether prose with a legal recommended SAN incorrectly claims the recommendation *was played* or *forces* an outcome despite the legal SAN filter. More generally, a typed claim validator cannot establish arbitrary semantic meaning from free-form prose; coordinate with Agent D/integrator for strict evidence-bound phrasing rather than claiming the lexical filter is comprehensive. Do not reimplement Agent A's engine scoring or Agent C's Review UI.
