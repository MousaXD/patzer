# Agent D — Checkpoint 34: same-game source changed **during** report generation

**Scope:** Independent QA and benchmark adversarial lane only. **Branch:** `agent/review-benchmark-20261111`. **Previous pushed checkpoint:** `a59edb0d1f2ecf645ea01151ad1f5850e2e13482`. **Frozen read-only product:** Agent C `d72eaced6972c8a2ec7d8581365c45788b15a29a`. **Frozen read-only backend:** Agent B `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`. Others A, `main`, PR #17 were fetched read-only and did not change. **No modifications to any candidate/owner product source, `main`, accuracy correction, live service, user game or production SQLite database.**

## Newly reproduced in-flight lifecycle gap with a working backend safety boundary

Checkpoint 33 found that an **already completed** cached AI report persists in React state after the same game's PGN and engine analysis change, even when a refetch shows the new game and the backend cached review is NULL. This checkpoint tests a **different lifecycle phase**: the user clicks **Write AI report**, the backend has begun producing content, and the original game's **final model summary call is held** when the game source and analysis change.

**Real Chrome 157 + actual Agent C React / Agent B Hono/SSE behavior:** After saving a different legal PGN and new independent Stockfish analysis into the same **disposable** game row, the browser refetches the game. Its move counter changes **0 / 4 → 0 / 7** while the original report remains **“Writing AI report…”**. The old model HTTP request remains **open**, and neither the GameAnalyzer parent nor GameReportPanel cancels it. The fake model's old summary can then finish and reach the backend, but the **real `saveReviewIfFresh` atomic compare-and-swap correctly refuses its write** because the captured PGN/analysis no longer match. The real SSE stream emits an **`error`** rather than `done` event. The browser shows the untranslated internal identifier `review_source_changed`, stops the spinner and does **not** render old prose. The authenticated backend GET remains `{review:null}`.

This is **not** a claim that an unsafe write succeeded; it explicitly confirms that Agent B's in-flight source guard **works** in the pinned branch. The remaining **Agent C lifecycle/product gap** is continuing an obsolete LLM call unnecessarily after known game-source changes and surfacing a raw technical error to the user instead of promptly invalidating that generation. In a real model integration, work may be billed or consume GPU resources; **this test uses only a fake local model**, so it does not measure production cost or frequency.

## Authentic product positive control

The same browser first runs an unchanged-game scenario on synthetic game #1, holding and releasing the final model response without a source change. Agent B saves the report normally; a genuine authenticated `GET /api/games/1/review` returns the model's test text and Agent C displays it. This proves that the mocked local model and report pipeline can succeed when the source is still valid; a global error state would fail the experiment.

The source-change scenario on synthetic game #2 uses self-authored Fool's Mate (four plies, **Black checkmates**) versus a separate legal White checkmate (seven plies, `e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#`). The harness performs **two bounded real Stockfish 16 depth-8 single-thread searches**, the first before generation and the second for the changed game. It stores the changed game and analysis on throwaway SQLite and triggers the **real Star/bookmark button**, which causes a React Query `GET /api/games/2` refetch without navigating or remounting the report. The independent verifier replays both PGNs, verifies the fetched JSON analysis UCI moves **actually correspond to the new PGN**, and requires **two distinct Chrome GET IDs** and **two distinct POST IDs**.

## Negative control, proof, and mutation resistance

`scripts/review-benchmark-browser-inflight-source.mjs` is the isolated real integration runner. It starts a local Hono app with Agent B's actual auth/session, game, review and coach routes; Agent C's real React bundle through Vite; a fresh Chrome/CDP profile; a disposable SQLite DB; and a fake local OpenAI-compatible model endpoint. It captures real model request phases (one phase, one key moment and one final summary per run), holds the model's **summary** for the source-changing game, and makes a direct controlled DB update while the browser is still mounted. **No hosted LLM call** is performed.

The runner also has a **QA-only `--fault=abort-after-source-change`** switch. Immediately after the game refresh, it clicks the *actual* React **Cancel generation** button. The old model HTTP connection then **closes** and the UI shows a cancellation message. This removes the original “model remained alive and later failed CAS” condition. The original benchmark **must fail with exit 1**, not report a false positive, because the old completion cannot be sent. That failure is the intended sensitivity test and does not modify product code or inject a fake Hono handler.

`scripts/review-benchmark-browser-inflight-proof.mjs` independently checks pinned Agent C and Agent B source-file SHA256 values, real Stockfish executable SHA256, game PGN/analysis replay, unique Chrome request IDs, old model connection state before/after source refetch, successful unchanged-game report control, null backend report and raw `review_source_changed` UI, and the deliberately failed manual-cancel control. It does **not** import the tested React component or its backend CAS function.

`scripts/review-benchmark-browser-inflight-negatives.mjs` rejects **100/100** tampered clean/fault evidence packets, including claims that a source change did not occur, that cached old prose survived, that the old model was automatically canceled, that the new analysis contained the old UCI moves, that the backend accepted an obsolete report, and that the manual-cancel control had passed as the clean scenario.

`scripts/review-benchmark-browser-inflight-boundary.mjs` launches **two fresh, independent Node processes** (clean exit **0**, manual-cancel fault exit **1**) each with its own Chrome, Hono, Vite, model mock and throwaway database. It binds stdout UUID to raw JSON evidence UUID per run, challenges all assertions with independent proof, and exercises **four bounded depth-8 Stockfish searches total** across the pair. Only the synthetic run JSON is kept in the ignored `qa/review-excellence/results/` folder; all temp databases, Chrome profiles and servers are cleaned up. `certification-summary-checkpoint34.json` binds source hashes and exact run IDs, and explicitly says `release_approved:false`.

## Owner-facing fix contract (not implemented by Agent D)

**Agent C frontend:** Associate every in-progress generation with the **game PGN/source and analysis generation** captured at admission, not only `gameId`. When the mounted same-game detail refetch produces a different source, abort its active SSE `AbortController`, clear transient progress and disallow any late `done`/error for the obsolete source from overwriting a new report. Keep ordinary notes/bookmark-only updates from interrupting a correct generation, and preserve explicit Cancel functionality. When source updates are detected, present a localized **“Game changed; the report needs to be regenerated”** state, rather than `review_source_changed`. The fix should be tested for in-flight phase, moment and final-summary steps, before/after the backend CAS.

**Agent B backend:** Retain the existing atomic **`saveReviewIfFresh`** source/analysis guard. Checkpoint 32 still requires the separate cached **GET** read-source invalidation fix; do not weaken compare-and-swap to make a previously started report succeed. Coordinate generation/freshness semantics with Agent C and the separate PR #17 scoring migration without implementing another accuracy algorithm.

**Reproduce from Agent D's isolated branch:**

```sh
node scripts/review-benchmark-browser-inflight-boundary.mjs
node scripts/review-benchmark-browser-inflight-negatives.mjs
node scripts/review-benchmark-browser-inflight-proof.mjs
```

**Limitations:** The model is mocked locally, with no real LLM charges. Game/analysis changes are injected into disposable SQLite (not a live PvP websocket), though the React refresh is triggered through the real bookmark UI and actual authenticated GET. Two very small synthetic PGNs and bounded engine searches cannot establish production incidence, benchmark stability across deployments, sealed chess-ground-truth or final release readiness. The verified backend CAS protection must not be described as a failing safety guarantee. **Integration and release certification remain BLOCKED.**

**Next session:** Fetch A/B/C/PR17 read-only. If any owner source changed, pin a new detached candidate and rerun Checkpoints **32 backend GET**, **33 mounted completed-report refresh**, and **34 in-flight generation** before changing expectations. Otherwise inspect whether profile/perspective changes during a mounted same-game report leave stale SSE or localized UI, using fresh source-grounded controls. **Never push or merge to main.**
