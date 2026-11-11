# Agent D — Checkpoint 11: overlapping reviews, atomic freshness, duplicate model work

**Agent D branch:** `agent/review-benchmark-20261111`. **Previous HEAD:** `2ca55efe3635deb4dc66590d201cc6c0be85bba7`. **Frozen Agent B implementation tested read-only:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`.

**Objective:** Verify the actual authenticated Game Review route and cache compare-and-swap under two simultaneous reviews of the **same synthetic game**. The older request must not overwrite a newer review that completed first. At the same time, record whether the application performs duplicate model work.

No production scorer, coach, UI, game database, credentials, updater, `main`, or other agents’ branches were modified. All user/session rows were fabricated inside a fresh disposable SQLite database. The game is the licensed/self-authored four-ply `SYN-GAME-FOOLS-MATE`; Stockfish was run at depth 8 with a pinned local binary, and all LLM requests went to a controlled **loopback-only** vLLM-compatible endpoint.

## Verified real-application race

Using the actual `analyzePgn()` and `saveAnalysis()` source, the benchmark first persists a valid analysis and leaves `prose_json` NULL. It then creates **two real authenticated** `POST /api/games/:id/review` SSE requests with the same owner cookie, deliberately holding the first JSON model response from each.

The newer request **B** is released first. It finishes the phase, key-moment and summary requests and writes its Game Review. Only after B is cached does the benchmark release the original request **A**, letting A finish all of its older model work. Both requests observed the same original uncached analysis row.

| Integrity / resource observation | Verified outcome |
| --- | --- |
| B finishes, emits `done` and caches summary | **Pass** |
| A completes later but cannot overwrite B | **Pass** |
| A emits error `review_source_changed` instead of `done` | **Pass** |
| Subsequent authenticated GET returns B’s exact text | **Pass** |
| Unauthenticated POST blocked | **401** |
| Cross-user POST and GET blocked | **404** |
| All JSON provider replies use correct phase → moment → summary stages | **6/6** |
| Loopback provider responses closed | **6/6** |
| Unnecessary duplicate model generation avoided | **No** — both requests perform all 3 stages |

The two requests caused **6 provider requests rather than 3** for one persistent report. That is a measured **2× model-call factor in this controlled overlap**, **not** a production concurrency throughput statistic or cost forecast. A single-flight/same-game coalescing enhancement may be warranted, but must not weaken the cache's correct atomic source verification, authorization or cancellation semantics.

The scoped real-route experiment completed in roughly one second in the local synthetic environment. This is **not** an LLM latency SLO, real-world proxy disconnect or large-library benchmark.

## Hostile audit: benchmark deadlock discovered and repaired

The initial Agent D concurrency runner mistakenly returned a bare pending `Promise<string>` from an `async` helper. JavaScript automatically adopts that promise, so awaiting the helper unintentionally waited for the first SSE stream to finish **before starting** the second. The resulting test timeout was a **benchmark-scheduling defect**, not a Patzer concurrency failure.

The fixed harness returns the pending response-body promise **inside a non-thenable object** and starts both SSE streams before releasing either model response. It bounds each SSE body read **after** releasing its assigned provider; it never fabricates success when a stream remains pending. The real application then passed the expected write-order and ownership assertions, including **two additional repeat runs** under the same bounded fixture and engine settings.

## Adversarial evidence proof

- `scripts/review-benchmark-concurrent-review.mjs` — actual application analyzer/save, real source review route and real cache writer, deterministic out-of-order fake-model response, two test-only users and disposable DB.
- `scripts/review-benchmark-concurrent-proof.mjs` — separately verifies the chess fixture and its checkmate, the pinned candidate/Stockfish/manifest hashes, exact completion order, model stages, absence of stale write and access-control outcomes.
- `scripts/review-benchmark-concurrent-negatives.mjs` — accepts one genuine limited QA packet and rejects **18/18 deliberately corrupted evidence packets**, including fake release approval, wrong source identity, wrong winner, hidden stale overwrite, missing stage, response leak and false deduplication.
- Agent B’s existing `review-cache-race.test.ts` and `review-perspective.test.ts` suites passed **32/32** on the frozen candidate. These are supplemental unit checks, not substitutes for the real-route race.

## Exact bounded reproduction

In the isolated Agent D checkout with dependencies installed, use a detached **read-only** Agent B worktree under `qa/review-excellence/results/worktree-coach` at the frozen SHA. Set `ENGINE` to an independently verified absolute path to local Stockfish 16:

```sh
QA="$(pwd)/qa/review-excellence/results"
APP="$QA/worktree-coach"
PIN=00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca

node --import tsx scripts/review-benchmark-concurrent-review.mjs \
  --app-root="$APP" --engine="$ENGINE" --engine-sha256="$PIN"

node scripts/review-benchmark-concurrent-negatives.mjs
node scripts/review-benchmark-concurrent-proof.mjs
```

**Provenance:** Candidate `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`. Stockfish **16** binary SHA256 `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca`; 1 thread, 16 MiB hash, depth 8 (no parity claim with Stockfish 17). Unchanged self-authored fixture-manifest v2 SHA256 `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`. Raw experiment JSON is in ignored local `qa/review-excellence/results/review-concurrent-real-route.json`; committed summary is `certification-summary-checkpoint11.json`.

## Cross-agent recommendation and next continuation

**Confirmed strength:** Agent B’s conditional, atomic `saveReviewIfFresh()` preserves the newer review when the older async writer loses the race. Keep this safety behavior through future scoring/cache fixes and version migrations. **Measured inefficiency:** concurrent same-game manual reviews currently perform redundant three-stage model generation even though only one may be cached. Coordinate any same-game single-flight/deduplication change with Agent B and the integrator; Agent D must not modify their source. None of these findings remove the **open, separately verified defects** involving stale prose after a completed reanalysis (Checkpoint 7), fabricated prose accepted in five languages (Checkpoint 8), and JSON responses accepted despite incomplete `finish_reason` (Checkpoint 9).

**Next independent audit:** Test cancellation after the summary model call but just before the cached write; source-change and user-profile-change races; rapid game switches; and two users under load with deterministic synthetic fixtures. Enforce hard caps on engine work and mock-model requests. Human-adjudicated sealed holdout, actual language-learning efficacy, browser accessibility, authentic reverse-proxy behavior and Stockfish 17 reference parity remain outstanding.

**Verdict:** The single examined stale-write race is **correctly protected**. The same bounded workload demonstrates avoidable duplicate generation. Complete product, throughput, security and release certification remain **unapproved**.
