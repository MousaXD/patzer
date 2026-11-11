# Agent D — Checkpoint 9: non-streaming LLM completion-status false green

**Scope:** Independent benchmark/QA infrastructure only. **Own branch:** `agent/review-benchmark-20261111`. **Prior checkpoint HEAD:** `2db0a31c1cb2a76d50f86c885cb66b4adb053525`. **App candidate frozen for this experiment:** Agent B `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`.

No modifications to the production AI coach, client, database, credentials, live service, deployment, `main` or other agents' branches. Test data: self-authored `SYN-GAME-FOOLS-MATE` and a disposable SQLite database. Provider: local `127.0.0.1` mock vLLM-compatible endpoint only.

## Confirmed independent defect

The provider's **non-streaming** JSON completion includes both text and a `finish_reason` reporting whether the response is complete, reached the configured token limit, or was filtered. Patzer's `chatJson()` currently parses the returned `choices[0].message.content` but does **not** verify `choices[0].finish_reason` before handing the text to the Game Review producer.

This matters because a response can contain **syntactically valid JSON while still being reported as truncated/filtered by the provider**. JSON parsing alone cannot certify completion.

The independent Agent D test invoked the **real `analyzePgn()` and `buildGameReview()` pipeline** with the real LLM JSON transport, but injected harmless truthful JSON content and varied only the provider's reported termination reason. It verified that the content passed into **both the game summary and its key-moment prose**:

| Provider `finish_reason` | Is complete? | Actual summary accepted? | Actual key moment accepted? |
| --- | --- | --- | --- |
| `stop` | Explicitly normal finish | **Yes** (positive control) | **Yes** |
| `length` | Token-limit termination; incomplete | **Yes** (unsafe) | **Yes** (unsafe) |
| `content_filter` | Content filter; not normal complete finish | **Yes** (unsafe) | **Yes** (unsafe) |

**Nine local model JSON requests** were exercised: one phase, one moment, one summary for each of three isolated runs. On the same audited Agent B commit, `server/test/llm-providers.test.ts` passes **44/44 unit tests**. Importantly, that existing suite does test that the **streaming** path rejects truncated output; it does **not** establish completion provenance for non-streaming JSON.

This is a missing protocol-completeness check, **not proof that any deployed model habitually returns partial JSON**, and not proof of a false chess analysis. The test deliberately provided fully parseable harmless output to isolate the missing finish-reason gate.

## Independent QA self-tests

- `scripts/review-benchmark-coach-completion-faults.mjs`: runs the real synthetic chess analyzer once, then the actual written-review/JSON client three times, using a local controlled provider. Requires a SHA-pinned Stockfish executable and a detached QA candidate checkout; creates and removes only a disposable SQLite. It writes uncommitted, ignored raw evidence under `qa/review-excellence/results/coach-completion-real-pipeline.json`.
- `scripts/review-benchmark-coach-completion-proof.mjs`: separately verifies pinned source, engine and fixture hashes, checkmate from legal PGN replay, exact JSON accepted, all three termination reasons, all nine requests and explicitly unapproved product/release status. Writes `certification-summary-checkpoint9.json`.
- `scripts/review-benchmark-coach-completion-negatives.mjs`: **11/11 deliberately corrupted evidence packets rejected**, plus one valid diagnostic packet accepted. Attacks include changed candidate/engine, missing requests, altered `finish_reason`, suppressed evidence, output drift and fake success/release claims.

An exit code 0 from the hostile **reproduction** indicates that the QA attack successfully found the gap. It is **not a green product certificate**.

## Reproduction with no live service

From Agent D's isolated checkout with dependencies installed, use a detached read-only Agent B worktree at the exact frozen SHA and an independently verified local Stockfish binary. The tested binary was Ubuntu Stockfish **16** (not asserted equivalent to Stockfish 17), one thread, 16 MiB hash, analysis depth 8.

```sh
ENGINE="/ABS/PATH/TO/VERIFIED/STOCKFISH"
PIN=00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca

node --import tsx scripts/review-benchmark-coach-completion-faults.mjs \
  --app-root="$(pwd)/qa/review-excellence/results/worktree-coach" \
  --engine="$ENGINE" --engine-sha256="$PIN"

# This is the *existing candidate's own* unit suite, run against a disposable DB.
APP="$(pwd)/qa/review-excellence/results/worktree-coach"
DB_PATH="$(pwd)/qa/review-excellence/results/completion-unit-disposable.db" \
  SESSION_SECRET='qa-disposable-only' ENGINE_BACKEND=local \
  STOCKFISH_PATH="$ENGINE" \
  "$APP/node_modules/.bin/vitest" run "$APP/server/test/llm-providers.test.ts" \
  --root "$APP" >qa/review-excellence/results/completion-upstream-unit.log 2>&1

node scripts/review-benchmark-coach-completion-negatives.mjs
node scripts/review-benchmark-coach-completion-proof.mjs
```

All sample chess game content is authored/licensed for this QA experiment. **Fixture manifest v2 SHA256:** `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`. **Pinned engine SHA256:** `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca`. Both unchanged. Source tool SHA256 values are recorded in the checked-in machine-readable report.

The prior checkpoints 1–8 remain historically unchanged. Do not conflate this source's `finish_reason` behavior with real-model accuracy, forbidden responses from a hosted provider, or released user impact.

## Cross-agent and integration decision

Agents A and C and the separate v10 accuracy branch were inspected read-only; this finding belongs to the **LLM JSON response/client contract**, primarily Agent B and the integrator. Agent D must not edit its implementation. The integrator should ensure a non-successful or missing/unknown `finish_reason` does not silently become accepted completed prose; how to handle different provider contracts and fallback behavior requires owner review. Confirm that no previously cached untrusted prose is silently served after tightening the validation policy (see Checkpoint 7 cache invalidation finding).

**Checkpoint 9 QA infrastructure is reviewable. Candidate written-review completion provenance is NOT certified.** Release approval remains false.

**Next safe audit:** Independently test cancellation during a non-streaming JSON response, trailing invalid JSON with retry, provider errors mid-generation and whether in-flight aborted reviews can still write stale prose. Verify the behavior against *actual* application source and disposable data, not a generic mock validator. The rest of the release gates—sealed independent holdout, multilingual human adjudication, learner outcomes, authenticated HTTP concurrency, and production-equivalent Stockfish—remain outstanding.
