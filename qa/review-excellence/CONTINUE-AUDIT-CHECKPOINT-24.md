# Agent D — Checkpoint 24: provenance and time anchors in independent coach-claim verification

**Assigned QA branch:** `agent/review-benchmark-20261111`. **Previous verified HEAD:** `f52f3ff3a1f1882984ef35458b90a34fa8a9dcc0`. **Frozen read-only Agent B coach:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`. The other branch heads (A, C, `main`, PR #17) were fetched and inspected by reference, with **no edits**. This checkpoint changes only **Agent D-owned QA scripts, report and docs**, not a product engine, coach, frontend, database, deployment or accuracy correction.

## New independently reproduced QA **false green**

The previously introduced independent English factuality checker, `scripts/review-benchmark-coach-claim-adapter.mjs`, replayed the source PGN to prove the winner. However, when it checked a **key-moment piece location**, it trusted the report's own `moment.fen_before`, `moment.san` and implicitly its association with the game. An internally legal but unrelated FEN could therefore be inserted into a written `GameReview` and make an incorrect statement appear verified.

For the self-authored Fool's Mate (`0-1`; **White's king at e1**), the adversarial input claimed ply 3, SAN `g4` and **“White's king is on e2.”**. Its `fen_before` was replaced with the legal alternate position after **`1.e4 e5 2.Ke2 Nc6`**, in which the White king really sits on e2 and `g4` remains a legal next move. The **old** checker actually returned `limited_claims_passed`, recorded both the correct winner and the **false piece square as verified**, with zero findings. This was a defect in the independent **QA verifier**, **not** proof that an LLM generated a falsified moment FEN. The product normally obtains its moment board metadata from analysis, not the language model.

**Fix:** the independent checker now replays the **entire source PGN** via `chess.js`, obtains the recorded move at the claimed 1-based ply, checks **ply, mover's side, SAN and exact `fen_before`**, and uses only the move's **source-derived before/after positions** as evidence. An invalid, out-of-range, missing or source-conflicting moment returns a **rejected** result and **cannot** contribute a positively verified piece-location claim. Source code checks did not borrow Agent B's screens, prompt interpretation or coach-claim utilities. A null moment is safely rejected rather than raising an uncontrolled exception.

## A second QA false green: explicitly false time-relative board claims

The previous checker accepted a named piece/square if it existed **either before or after** a move. On a genuine recorded position, it therefore incorrectly verified **both** of these opposite statements:

- **“Before the move, White's pawn is on g4.”** (false: the pawn was at g2 before `g4`)
- **“After the move, White's pawn is on g2.”** (false: the pawn moved to g4)

The updated checker binds **only the narrow literal** `Before/After the|this|that [played] move:` or comma form to the appropriate source PGN board, rejects those two false claims as `contradicted_temporal_piece_location`, and positively verifies their true counterparts. More complex temporal descriptions such as **“Before 2.g4”** are now specifically **unassessed**, not silently accepted as positive proof from either board. This is not a general-purpose natural-language understanding system; unsupported paraphrases, tactical causality and all non-English prose still cannot be certified.

## Independent hostile coverage

1. `scripts/review-benchmark-coach-provenance-negatives.mjs` — **58/58** scoped tests spanning false legal FEN swaps, altered move clock, wrong/absent SAN/ply/side, null moments, result contradictions, true and false before/after statements, unknown temporal grammar, unsupported language, **fail-closed invalid input** and **custom PGN start-FEN with Black moving at ply 1**. The latter guards against accidentally treating every odd ply as White.
2. `scripts/review-benchmark-coach-claim-negative-controls.mjs` — the original **18/18** literal claim controls pass after upgrading their synthetic moment to include its explicit source mover `side`. Old checkpoint artifacts are intentionally **not rewritten**; their source hashes describe their historical snapshots.
3. `scripts/review-benchmark-real-coach-faults.mjs` — re-runs the actual Agent B `analyzePgn()` + `buildGameReview()` + `llm.ts` against a fresh **disposable SQLite** and **loopback-only fake vLLM**, pinned Stockfish 16 depth **8**, 1 thread, 16 MiB hash. The original synthetic attacks still reach the real product output: **“White won the game.”** and **“White's king is on e2.”**. Both false outputs are independently rejected; two true text controls still pass. Exactly **6** local model requests were made, with no external provider.
4. `scripts/review-benchmark-coach-provenance-boundary.mjs` — starts a **fresh subprocess** with a unique cryptographic run UUID, then demands a matching UUID in stdout **and** its ignored raw evidence. It checks the exact pinned Agent B commit, Stockfish binary SHA and 2 real-product false outputs. No previous green diagnostic can be silently substituted for a fresh result.
5. `scripts/review-benchmark-coach-provenance-proof.mjs` and `...-proof-negatives.mjs` — independently reconstruct the legal checkmate, source-board occupancy and old checker bypass before accepting an evidence packet. **38/38** deliberately forged product/QA evidence packets are rejected, including forged results, source identities, missing real false prose, fake positive proofs and changed output metadata.
6. Agent B's existing targeted suites `coach-claims.test.ts` and `review-claims-pipeline.test.ts` still pass **27/27** on the pinned source. They are useful regression tests but **do not** establish the missing protections against deliberately false model prose.

**Result:** Agent D's previously demonstrated QA false green is **closed** under the new source-provenance and limited temporal controls. Agent B's **separate, older coach-output factuality gap remains unresolved** on the frozen SHA. Green reproduction of a synthetic model attack is **not** a passing product/release gate. All evaluator results retain `full_factuality_certified:false` even when recognized claims pass.

## Reproduction (no live games, production DB or model requests)

Using the detached, read-only Agent B worktree and the approved Stockfish executable:

```sh
ENGINE="$(pwd)/qa/review-excellence/results/engine/unpacked/usr/games/stockfish"
node scripts/review-benchmark-coach-provenance-boundary.mjs \
  --app-root="$(pwd)/qa/review-excellence/results/worktree-coach" \
  --engine="$ENGINE"
node scripts/review-benchmark-coach-provenance-negatives.mjs
node scripts/review-benchmark-coach-claim-negative-controls.mjs
node scripts/review-benchmark-coach-provenance-proof-negatives.mjs
node scripts/review-benchmark-coach-provenance-proof.mjs
```

**Static identities:** Agent B SHA `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`, engine SHA256 `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca`, self-authored fixture manifest v2 SHA256 `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`. Exact QA script hashes, the new unique synthetic run ID, 58+18 check counts, the latest 27 upstream tests and explicit **`release_approved:false`** are in `certification-summary-checkpoint24.json`. Generated local JSON/logs remain ignored under `qa/review-excellence/results/`.

## Still unproven and the next meaningful audit

Do not upgrade a finite English regex-lexical scorer into general coach factuality certification. Unchecked areas include **Spanish/Bulgarian/German/Russian** generated prose, implicit references, variant chess positions with subtle temporal meaning, natural-language tactical claims, user-facing trust/human teaching value, and any hosted LLM hallucination rate. There is **no sealed independent human-labeled holdout** or deployed Stockfish 17 parity. The chess-law oracle is `chess.js`, independent of Agent B coach-claim screens but not an unrelated chess-rules implementation.

**Next:** In Agent D's own QA lane, independently challenge unsupported multilingual/implicit piece and winner statements with measured **abstention**, not fabricated confidence; or retest Agent B when a new pinned correction SHA appears. Reconcile cross-session profile-race and root `<html lang>` reports from Checkpoint 23 with the respective owners. **No merge to `main`, integration approval or product release approval.**
