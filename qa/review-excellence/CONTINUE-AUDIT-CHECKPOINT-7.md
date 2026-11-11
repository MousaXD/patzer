# Agent D — Checkpoint 7: real-route stale AI review cache and false-green certification

**Own branch:** `agent/review-benchmark-20261111` | **Previous verified HEAD:** `d86a9f9fc4649c7c14a9de220fb5b58f59d3d238` | **Candidate B tested:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`.

**Scope:** Independent benchmark QA only. No source changes in Agent B, Agents A/C, PR #17, `main`, production SQLite, live sessions, secrets, updater or release settings. An approved four-ply Fool's Mate PGN was used in a fresh disposable SQLite file; fake user/session records existed **only** in the isolated benchmark DB. The test used the actual `saveAnalysis()`, `buildGameReview()`, `saveReviewIfFresh()` and authenticated GET Game Review endpoint, not a reimplementation of the cache route.

## Independent confirmed bug: old AI prose survives reanalysis

1. Using the real analyzer on `SYN-GAME-FOOLS-MATE`, White's reported game accuracy was **31.8%**. The real `buildGameReview({llmEnabled:false})` generated a version-9 cached report, **without `accuracy_model_version`**.
2. The actual `saveReviewIfFresh()` wrote it under the real `analyses.prose_json` cache. The authenticated GET returned it, as expected.
3. Reanalyzing the same game through **the real `saveAnalysis()` upsert**, with new test-only accuracy evidence of **6.8%**, updated the stored analysis but **did not clear `prose_json`**.
4. The authenticated GET continued to return **the old report**, with no `stale` indication, despite changed source evidence. The automatic reviewer selects only `WHERE a.prose_json IS NULL`; the stale entry was not queued for regeneration (**pending = 0**).
5. A separate, clearly labeled **controlled scoring-version-only mutation** from v9 to v10 also left the unmarked cached prose visible. This simulates migration/backfill behavior; it is **not** evidence that PR #17 has performed such a migration in production.

This is a documented **source/read cache provenance defect**. It must not be concealed by the existing atomic compare-and-swap: that protects **in-flight writes**, but not **reads of already-stale prose**.

The existing Agent B `server/test/review-cache-race.test.ts` suite passed **22/22 tests** on the pinned branch. That suite verifies compare-and-swap safeguards, not the later real analyzer-upsert → authenticated-cache-read lifecycle. All 22 pass while the new end-to-end stale-prose case fails. Passing prior tests therefore does not resolve this finding.

### Hostile controls that already work

The same disposable integration run independently verified **8/8 positive controls**:

| Control | Actual result |
| --- | --- |
| No session | HTTP 401 |
| Authenticated other user | HTTP 404 |
| Initial authentic review | Returned |
| Review with `accuracy_model_version=9`, current analysis v10 | Rejected as stale |
| Review with matching marker v10 | Returned |
| Profile language changed from English | Rejected as stale |
| Null cache | No review returned |
| Async report completes against changed analysis | `saveReviewIfFresh()` rejects write |

The benchmark's **hostile certification control** runs this same broken candidate with `--expect=fixed` and **must exit nonzero**. That negative test did exit **1**, while `--expect=reproduce` exited **0** after successfully proving the defect. This is a green **attack reproduction**, not a green **Patzer certification**.

### Cross-branch read-only inspection

At the inspected remote heads, `main`, Agent A, Agent B, Agent C, and the unmerged accuracy v10 branch all retain an `ON CONFLICT(game_id) DO UPDATE SET` block in `saveAnalysis()` that updates analysis evidence without resetting `prose_json`. Agent B's own read helper permits missing `accuracy_model_version` markers. This demonstrates a **shared integration risk**, not proof that every branch was independently rerun through this specific HTTP/cache fixture.

**Integrator recommendation:** Agree on the scoring/prose cache provenance contract with Agents A/B and the PR #17 owner. A review may need a validated source scoring version/analysis fingerprint and automatic invalidation whenever relevant evidence changes; preserve the existing atomic compare-and-swap guarantees and avoid triggering an uncontrolled rebuild. No scorer, prose cache, schema migration or release code should be changed by Agent D.

## Reproduction

Use the detached QA Agent B checkout at the pinned commit and verified local Stockfish 16 binary, one thread, 16 MiB hash, depth 8. Node dependencies must already be installed. Set `ENGINE` to its **absolute** path:

```sh
QA="$(pwd)/qa/review-excellence/results"
APP="$QA/worktree-coach"
PIN=00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca

# Expected to FAIL: the broken candidate may not receive a safe-cache verdict.
node --import tsx scripts/review-benchmark-coach-cache-race.mjs \
  --app-root="$APP" --engine="$ENGINE" --engine-sha256="$PIN" \
  --expect=fixed --out="$QA/coach-cache-negative-fixed.json" \
  > "$QA/cache-negative-fixed.log" 2>&1
# Confirm nonzero exit above; this is intentional.

# Expected to PASS as an attack reproduction, NOT product certification.
node --import tsx scripts/review-benchmark-coach-cache-race.mjs \
  --app-root="$APP" --engine="$ENGINE" --engine-sha256="$PIN" \
  --expect=reproduce > "$QA/coach-cache-real-route.log"

node scripts/review-benchmark-coach-cache-proof.mjs
```

The proof compiler also checks that the pinned Agent B `review-cache-race.test.ts` suite ran and passed 22/22 tests. To reproduce the input log, run it with the disposable Agent B checkout's local Vitest executable and write the console output to `$QA/cache-race-unit.log`. It never uses the active Patzer SQLite database.

The evidence compiler refuses to publish a passing packet unless both known flaws recur, the eight protective controls pass, the missing score marker is independently demonstrated, the auto-review queue skips the stale cached item, and the `--expect=fixed` hostile control demonstrably rejected the candidate.

- **Candidate SHA:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`.
- **Engine SHA256:** `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca` (Stockfish **16**, not deployed Stockfish 17 parity).
- **Manifest v2 SHA256:** `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44` (unchanged self-authored fixtures).
- **Independent verdict:** `product_cache_certified:false`, `integration_approved:false`, `release_approved:false`.
- Machine-readable report: `certification-summary-checkpoint7.json`; local actual-route trace and negative logs remain in ignored `qa/review-excellence/results/`.

## Next continuation and unresolved evidence

1. Independently re-run the cache test after any integrator/Agent B fix. Use `--expect=fixed` and verify it **exits 0** without sacrificing the 8 existing protections. Freeze a *new* candidate SHA and regenerate the provenance packet rather than rewriting this historical result.
2. Resume unfinished multilingual/implicit-language claim evaluation and cross-game stale-output tests with synthetic data only; a narrow English lexical checker cannot certify complete AI truth.
3. Determine whether `saveAnalysis()` changes leave a stale display in other client surfaces with separate caches; coordinate rather than editing other agents' lane.
4. Full accuracy and learner certification still require sealed holdout, human review, Stockfish 17 parity, authentic browser accessibility flows and bounded multi-user performance. No production database inspection or remote model requests were performed.

**Decision:** QA harness-only changes are safe for independent review. The frozen candidate fails the cache-consistency gate; **do not merge/integrate on the basis of green preexisting tests alone**. The program integrator controls ownership, fixes, backfills, merges and releases.
