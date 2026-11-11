# Agent D — Checkpoint 12: profile change, reanalysis and cancellation at final model response

**Own branch:** `agent/review-benchmark-20261111`. **Parent checkpoint:** `22c2b175a7233e99ed909f0bead9c8e6c8023fb9`. **Read-only source under test:** Agent B `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`.

This work changes only independent QA scripts and documentation. The exercise uses the licensed/self-authored four-ply synthetic `SYN-GAME-FOOLS-MATE`, a verified local Stockfish **16** binary at depth 8, a loopback-only fake JSON provider, and three test-only games in a newly created **disposable SQLite** file. It imports the actual authenticated Game Review route, analyzer, profile/session middleware and cache writer without editing any of them. It neither accesses production data nor requests external model inference.

## New defect: profile changes while generation is in flight

In the test, a real English-language Game Review request reaches the **final model summary** and stops while the local provider holds its JSON response. The synthetic user's `profiles.language` is then changed from **English (`en`) to Spanish (`es`)** inside the disposable DB before the provider releases the final response.

**Observed on the frozen candidate:** The route emits a successful `done` SSE containing the **old English** review and saves that old-language prose under `prose_lang=en`. A subsequent authenticated GET, which correctly uses the now-current Spanish preference, returns `review:null, stale:true`. Nevertheless, because `analyses.prose_json` is non-NULL, the automatic post-game review sweep **does not select the row for regeneration** (count 0).

This is a real **profile/cache provenance race**, not evidence about how frequently a user changes language mid-generation. The cache's atomic compare-and-swap correctly compares original analysis/game evidence and cached-prose state, but **does not compare the profile language/audience that existed when generation started against the currently stored profile**. The GET safeguards prevent the stale review from being served on later reads; the in-progress POST still emits it, and the auto-retry queue remains empty.

## Two protective controls using the same final-response boundary

| Synthetic scenario | Expected source behavior | Observed outcome |
| --- | --- | --- |
| Source reanalysis before final model reply | Reject stale source; no cache write | **Pass:** error `review_source_changed`, no `done`, cache NULL, reanalysis queued |
| Profile language changes `en` → `es` before final model reply | Old-language review should not be committed as fresh for new profile | **Defect:** old English `done`, cache kept `en`, GET stale, auto queue empty |
| Client cancels while final model reply is still pending | Close SSE without completion and do not persist | **Pass:** no `done`, cache NULL, auto regeneration eligible |

The source-change mutation modifies White's synthetic accuracy from **31.8% to 11.8%** using the real `saveAnalysis()` upsert. This is **test-only fabricated reanalysis evidence**, not a claim that the Stockfish result naturally changed that much. The source freshness checker correctly rejects its late review. Cancellation occurs **during the final provider request**, not at the synchronous, non-awaiting SQLite write instruction; the latter timing window is **not proven** by this test.

All three runs use the actual written-review route and stop the fake provider at the **summary** stage after earlier phase/moment stages have been handled. The local observation contains nine model POSTs, each with a closed response. Raw SSE frames are stored only in ignored disposable results; the independent evidence verifier re-reads their `progress`, `error` and `done` event markers rather than relying solely on the runner's boolean summaries.

## Reproduction and independent QA challenge

The benchmark scripts are `scripts/review-benchmark-final-summary-races.mjs`, `scripts/review-benchmark-final-summary-proof.mjs` and `scripts/review-benchmark-final-summary-negatives.mjs`. The negative controls deliberately alter source identity, SSE events, profile language, persisted state, provider counts, post-cancel cache and release claims. **21/21 deliberately corrupted evidence packets were rejected**, while the legitimate scoped observation passed. A passing **attack-reproduction** reports the profile defect while refusing full product certification. It is **not** proof that Patzer is safe for release.

From a detached Agent D checkout with dependencies installed and the read-only Agent B worktree pinned at the exact tested commit:

```sh
QA="$(pwd)/qa/review-excellence/results"
APP="$QA/worktree-coach"
PIN=00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca

# Set ENGINE to the independently verified absolute binary location.
node --import tsx scripts/review-benchmark-final-summary-races.mjs \
  --app-root="$APP" --engine="$ENGINE" --engine-sha256="$PIN"

node scripts/review-benchmark-final-summary-negatives.mjs
node scripts/review-benchmark-final-summary-proof.mjs
```

The fixture manifest v2 is SHA256 `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`, unchanged. The Stockfish 16 executable is SHA256 `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca` (1 thread, 16 MiB hash, depth 8). No Stockfish 17 parity is asserted. The exact candidate SHA is `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`. Raw local evidence is not committed; the checked-in summary is `certification-summary-checkpoint12.json` after the QA proof completes.

## Cross-agent ownership, integration risk and next checkpoint

This finding belongs to **Agent B's profile/prose cache contract**, and should be coordinated through the integrator with any cache invalidation/backfill work from Agents A and PR #17. Agent D must not silently implement their source fixes. A remediation should reject outdated in-flight language/audience output **without weakening** the already-verified atomic source CAS, cancellation cleanup, cross-user authorization or successful cache recovery. It should also ensure stale cached rows become eligible for refresh without uncontrolled repeated LLM generation.

**Outstanding release gates:** prior confirmed post-reanalysis stale cache (Checkpoint 7), free-form unsupported coaching claims across all supported languages (Checkpoint 8), ignored non-streaming provider completion status (Checkpoint 9), and measured duplicate generation under same-game concurrency (Checkpoint 11). Also required: sealed independent human-adjudicated holdout, real browser/accessibility tasks, authenticated server load, realistic performance distributions and engine-version parity.

**Next continuation:** Retest this exact held-final-summary scenario after an owner/integrator cache fix, with a new pinned candidate SHA; add bounded profile audience changes and rapid game switches only if they exhibit distinct verified failure modes. Never label a green QA attack-reproduction process as product/release certification.
