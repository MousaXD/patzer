# Agent D — Checkpoint 10: authenticated Game Review cancellation and recovery

**Agent D branch:** `agent/review-benchmark-20261111` | **Previous verified HEAD:** `8a8a7489c6410da9412d9de0c61234da25ad1198` | **Frozen read-only Agent B candidate:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`.

**Purpose:** Verify that an actual, authenticated `POST /api/games/:id/review` SSE request interrupted while the provider is awaiting a non-streaming JSON reply cannot publish or cache a finished report, and that the same user can subsequently complete a normal review. This is an **independent positive reliability result for this narrow path**, not a product-wide certificate.

Only Agent D QA files were edited. The test uses the approved self-authored `SYN-GAME-FOOLS-MATE` PGN; two synthetic users/sessions in a **fresh disposable SQLite** database; an embedded Hono route with the real source module, analyzer, session/auth middleware and review cache; pinned local Stockfish; and a deliberately stalled loopback-only vLLM-compatible JSON provider. **No live Patzer process, real account, real credentials, production database, third-party LLM, HTTP tunnel, deployment, or other agent source modification.**

## Result of the real consumer test

The test first authenticates an owner and confirms that no cookie returns HTTP **401**, and another synthetic user's valid cookie returns **404** for the game. It then stores the real synthetic game's analyzed evidence and issues a real, in-process authenticated POST to the Game Review route with an `AbortController`.

The mock provider intentionally receives the first model request but **does not reply**. The benchmark aborts the client, **requires the actual SSE response body to close within a bounded deadline**, and then checks the persisted analysis row:

| Evidence | Actual result |
| --- | --- |
| Model JSON POST arrived before abort | **Yes; exactly one request** |
| Model replied before abort | **No** |
| Aborted SSE actually closed | **Yes** |
| Aborted SSE emitted `event: done` | **No** |
| Aborted report stored in `analyses.prose_json` | **No** |
| Subsequent ordinary review completed | **Yes, with `event: done`** |
| Subsequent completed review saved | **Yes** |
| Authenticated GET returned saved review | **Yes** |
| Local provider responses closed | **4/4** |

Four total fake-model POST requests were handled: one stalled/aborted request followed by three successful generation requests. The observed **bounded single-machine experiment** completed in approximately one second (not an LLM performance claim).

### Benchmark self-audit: a false-green response-body timeout was removed

An early version of the independent QA script swallowed a timeout while reading the canceled SSE body and substituted an empty string. That could falsely certify an aborted request whose stream never actually closed, simply because an empty fabricated body contained no `done` event.

The script now **fails closed unless the real SSE response closes** within its explicit deadline and a nonempty stream body is observed. It also checks the DB **after** response closure and a short bounded settle period, before issuing the successful control. This bench weakness was fixed in Agent D only.

- `scripts/review-benchmark-coach-cancellation.mjs` exercises the real source route, cancellation, persistence and recovery. A successful exit proves only this scoped synthetic scenario.
- `scripts/review-benchmark-coach-cancellation-proof.mjs` independently validates the pinned source, engine and manifest hashes, legal checkmate, eight relevant lifecycle facts, complete model request count, successful follow-up and no false certification claims. It writes `certification-summary-checkpoint10.json`.
- `scripts/review-benchmark-coach-cancellation-negatives.mjs` accepts one valid scope-limited result and rejects **14/14 deliberately corrupted QA evidence packets** (wrong candidate/engine, missing completion closure, stale write, unexpected `done`, false certification, broken recovery, leaked mock responses, etc.).
- The Agent B targeted `review-perspective.test.ts` suite also passed **10/10** tests on the frozen source; the new route-level proof does not rely on those tests for its verdict.

## Reproduction

From the detached Agent D checkout with local dependencies installed, use the exact pinned read-only Agent B worktree under `qa/review-excellence/results/worktree-coach`. Set `ENGINE` to an absolute local path of the **verified** Stockfish 16 executable.

```sh
PIN=00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca
APP="$(pwd)/qa/review-excellence/results/worktree-coach"
QA="$(pwd)/qa/review-excellence/results"

node --import tsx scripts/review-benchmark-coach-cancellation.mjs \
  --app-root="$APP" --engine="$ENGINE" --engine-sha256="$PIN"

DB_PATH="$QA/cancel-upstream-disposable.db" SESSION_SECRET='qa-not-live' \
  ENGINE_BACKEND=local STOCKFISH_PATH="$ENGINE" \
  "$APP/node_modules/.bin/vitest" run "$APP/server/test/review-perspective.test.ts" \
  --root "$APP" > "$QA/coach-cancellation-upstream-unit.log" 2>&1

node scripts/review-benchmark-coach-cancellation-negatives.mjs
node scripts/review-benchmark-coach-cancellation-proof.mjs
```

**Reproducibility:**
- Candidate SHA: `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`
- Engine SHA256: `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca` (Stockfish **16**, one thread, 16 MiB hash, depth 8; *not* Stockfish 17 parity).
- Fixture manifest SHA256: `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44` (unchanged).
- Local raw evidence: `qa/review-excellence/results/coach-cancellation-real-route.json`, ignored and **not** committed.
- Machine-readable summary: `qa/review-excellence/certification-summary-checkpoint10.json`, checked in.

## Cross-agent and integration recommendation

The verified narrow cancellation path is **positive evidence**, distinct from the **actual failures** in Checkpoints 7 (stale prose after reanalysis), 8 (false claims in every supported language), and 9 (non-streaming provider termination statuses ignored). It would be misleading to mark the whole Game Review system green based on this cancellation smoke.

Agent B, the integrator and the independent v10 scoring/backfill owner should preserve this cancellation behavior when fixing the other defects. The benchmark includes an explicit positive control for normal recovery after cancellation. Agent D does not alter their source files.

**Next continuation:** Test termination during the last provider response, cancellation between model completion and cache persistence, simultaneous same-game review requests and HTTP reverse-proxy disconnects in controlled conditions. Full release gates also require a sealed independent human-adjudicated holdout, actual LLM truth checks, UI accessibility and performance distributions, tenant isolation under load and production-equivalent Stockfish reference.

**Decision:** Agent D's QA-only checkpoint is reviewable; **this one cancellation scenario passes**. Overall correctness, cache safety, AI explanation truth and full integration/release certification remain **unapproved**.
