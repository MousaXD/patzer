# Agent D — Checkpoint 6: real AI-coach factuality escape

**Date:** November 11, 2026. **Own branch:** `agent/review-benchmark-20261111`. **Prior verified Agent D checkpoint:** `1962bf0eda14d48c073ad669df85bc29ef3db858`. This checkpoint modifies only Agent D's independent QA scripts and reports. Agent B, game scoring, production SQLite, application routes, credential handling, release configuration and `main` were not modified.

## New evidence: two real Game Review output escapes

Agent B's coaching branch includes structured chess claims and a prose screen, but the actual `buildGameReview()` pipeline can still accept fabricated model text. This was independently reproduced against **two frozen commits**: earlier `4f7a2b1039661874eee82bd5bcc1333abbaedb26` and the newer branch HEAD **`19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`**. The intervening commits changed coach evaluation/input handling, but not the checked prose screen in `claims.ts` or `review.ts`.

We reproduced this **through the real application analyzer, real written-review builder and real LLM transport client** with one approved self-authored synthetic Fool's Mate PGN (four plies; result **0-1**, Black checkmates). The network endpoint was a **local, disposable, deliberately adversarial mock vLLM** bound to `127.0.0.1`. No hosted model or private game data was used.

| Surface | Deliberately false local model response | Independent chess proof | Agent B written review | Agent D checker |
| --- | --- | --- | --- | --- |
| `summary` | “White won the game.” | PGN legal replay ends in Black checkmate | **Published false statement** | **Rejected**, `contradicted_game_winner` |
| `key_moments[0].prose` | “White's king is on e2.” | Actual White king is on **e1** before and after `g4`; e2 has a White pawn | **Published false statement** | **Rejected**, `contradicted_piece_location` |

Two otherwise harmless, truthful control sentences (“White lost the game.” and “White's king is on e1.”) **both passed** through the same actual source pipeline and were independently verified. The six requests made by the two reviews went solely to the local fake vLLM server, never to an external model. The recorded bounded run took approximately 0.4–0.7 seconds; that is **not an LLM latency measurement or performance SLO**.

The existing Agent B tests `server/test/coach-claims.test.ts` and `server/test/review-claims-pipeline.test.ts` independently ran **27/27 passing**. Their success is not sufficient evidence that hostile model prose can never cross into Game Review.

**Important interpretation:** We have proved **possible false output accepted from a deliberately bad source**, *not* that a legitimate LLM routinely makes either false statement or that a particular model was used. The benchmark's finite truth checks are independent of Agent B's validation code; both use the audited `chess.js` library for legal board replay rather than a newly implemented chess engine.

## Independent consumer and hostile controls

Added three Agent D-owned scripts:

- `scripts/review-benchmark-real-coach-faults.mjs` — launches no live Patzer server. Pins the candidate worktree and Stockfish 16 executable, creates disposable SQLite and localhost fake provider, calls the real `analyzePgn()` followed by two real `buildGameReview()` executions, and records the accepted false claims without reporting the product certified.
- `scripts/review-benchmark-coach-claim-adapter.mjs` — independent, **English-only, deliberately narrow** checker for explicitly attributed win/loss claims and explicit owner/piece/square claims attached to verifiable key moments. It confirms checkmate from the legal PGN outcome and piece occupancy in the verified FEN before and after the move.
- `scripts/review-benchmark-coach-claim-negative-controls.mjs` — **18 checks** including truthful claims, reversed winner, reversed owner, wrong king/pawn/queen squares, false user-perspective claims, insufficient terminal-result evidence, unsupported languages, invalid output and unrecognized equivalent paraphrases. False inputs must be rejected or marked *not evaluated*; no unrecognized prose is silently labeled verified.

The checker explicitly reports `full_factuality_certified:false` **even when every recognized fact passes**. It cannot prove arbitrary natural-language truth, tactic causality, all translations, implicit pronouns, or human educational value. For example, “The white monarch sits on e2” is an intentionally documented unrecognized paraphrase: it **must not** be treated as a checked fact. Nonterminal PGNs without independently provable results do not authorize hard winner claims.

Machine-readable proof, exact source hashes, fixture provenance and known coverage gaps are in `qa/review-excellence/certification-summary-checkpoint6.json`; generated local fake-model logs remain only under ignored `qa/review-excellence/results/`. The proof separately preserves the initial frozen result as `results/real-coach-faults-4f7a2b1.json` and compares it to the latest candidate replay before reporting the finding.

## Reproduce without touching a live account

From the Agent D isolated checkout, with Node dependencies installed, set `ENGINE` to an independently obtained local Stockfish binary. The proof compiler checks **two** frozen application SHAs. Create/read two detached disposable worktrees at the verified commits; neither should be modified or merged. If those QA worktrees do not already exist, create them as follows (the reusable `node_modules` links below affect only disposable QA worktree locations):

```sh
QA="$(pwd)/qa/review-excellence/results"
git worktree add --detach "$QA/worktree-coach-prior" 4f7a2b1039661874eee82bd5bcc1333abbaedb26
git worktree add --detach "$QA/worktree-coach" 19c359ec3feb8e3c10c33415c403eaf5ab3d6c87
ln -s "$(pwd)/node_modules" "$QA/worktree-coach-prior/node_modules"
ln -s "$(pwd)/node_modules" "$QA/worktree-coach/node_modules"
```

If the worktrees already exist at the exact commits, reuse them and **do not** rerun `git worktree add`. Check the SHA with `git -C PATH rev-parse HEAD` first. Then run each synthetic fault experiment and retain the earlier evidence locally:

```sh
node scripts/review-benchmark-coach-claim-negative-controls.mjs

node --import tsx scripts/review-benchmark-real-coach-faults.mjs \
  --app-root="$(pwd)/qa/review-excellence/results/worktree-coach-prior" \
  --engine="$ENGINE" \
  --engine-sha256=00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca

cp qa/review-excellence/results/real-coach-faults.json \
   qa/review-excellence/results/real-coach-faults-4f7a2b1.json

node --import tsx scripts/review-benchmark-real-coach-faults.mjs \
  --app-root="$(pwd)/qa/review-excellence/results/worktree-coach" \
  --engine="$ENGINE" \
  --engine-sha256=00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca

node scripts/review-benchmark-coach-proof.mjs
```

Local executable for this proof was Ubuntu's **Stockfish 16** with SHA256 `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca` (one thread, 16 MiB hash, analysis depth 8). **No Stockfish 17 parity** is implied. Fixture manifest v2 was unchanged at SHA256 `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`; no new chess games or holdout labels were introduced.

The proof command returns success only when the **QA detection experiment** is valid: the controlled false text escaped **both verified candidate snapshots** but the independent checker caught it. `product_factuality_certified:false`, `release_approved:false`, and the explicit blocked-integration fields remain **false**. A green harness exit is not a green product verdict.

## Cross-agent implications and next work

**Agent B — attention required, no source edits by Agent D.** Generated game-summary winner claims must be anchored to the independently verified result, and key-moment board-state assertions need grounding beyond specific regex phrasings. Avoid falsely certifying all free-form text as safe. If the coach's output contract or screening changes, coordinate a prose/cache version bump and re-run the original and new negative controls.

**Agents A and C and PR #17 — do not conflate responsibilities.** Their independent development and v9/v10 scorer comparisons are not explained away by this coach finding. Agent D does not reimplement their fixes or merge their branches.

**Integration recommendation:** The benchmark infrastructure is reviewable, but **the real coach factuality gate fails on both recorded Agent B SHAs, including the latest tested HEAD**. Do not call its explanation generator fully certified or an improvement in learner trust without resolving the demonstrated escapes and repeating independent tests.

**Next audit:** challenge linguistic paraphrases (especially implicit piece references and non-English), cross-game stale coach output, cache provenance and fallback output using disposable synthetic fixtures. Longer-term release gates remain sealed human-reviewed holdout, verified tactical consequence proofs, browser/keyboard learning journey, authentication/tenant isolation, and Stockfish 17 equivalent measurements.
