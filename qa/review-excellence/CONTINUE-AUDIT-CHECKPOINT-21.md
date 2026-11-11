# Agent D — Checkpoint 21: cancel → immediate retry, same-game cache races

**Assigned QA branch:** `agent/review-benchmark-20261111`. **Previous pushed HEAD:** `26f6a486fb12e650af35f4806284cc2dc2937556`. **Frozen, read-only Agent C frontend:** `d72eaced6972c8a2ec7d8581365c45788b15a29a`. **Frozen, read-only Agent B backend:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`.

The unfinished Checkpoint 20 question was whether an **immediate second Game Review on the same game** can safely proceed while a canceled first generation is winding down. A disappearing progress indicator does not prove that the first server request cannot save an old report or interfere with the second request. This checkpoint deliberately forces both completion orders, measures the real SQLite result and actual React UI, and refuses to certify the deliberately broken browser despite a surviving cache in one order.

## Test scope and exact setup

The QA harness mounts the **real Agent C `GameAnalyzer`/`GameReportPanel`** through its original Vite configuration in an **isolated headless Chrome 157.0.8103.38** profile, the **real Agent B Hono Game Review and session route**, and one authenticated **synthetic** user with a disposable SQLite file. It uses one **self-authored Fool's Mate** PGN and an independently verified local Stockfish **16** binary, depth **8**, **1 thread**, **16 MiB hash**, with a local loopback JSON model. The provider deliberately holds the first and second requests' final summary responses; they contain independently distinguishable test-only text `FIRST GENERATION` and `SECOND GENERATION`. The benchmark observes **two different real Chrome POST requests** for the exact same owned game, not simulated callback invocations.

After the first model request reaches the final-summary hold, the real React **Cancel generation** button is clicked, followed **immediately** by the real **Write AI report** button. The benchmark **does not wait for the first server request to close before clicking Retry**. It verifies both distinct pending generation requests before releasing either provider response. The provider and browser run through separate ephemeral loopback TCP ports, the Vite test port is explicitly allocated rather than defaulting to an operator's usual port, and the whole Chrome profile, SQLite file and servers are removed at the end.

## Actual application results: three bounded real-browser runs

| Experiment | Old canceled provider when released | First report in cache? | Final SQLite summary | Real React report result | QA verdict |
| --- | --- | --- | --- | --- | --- |
| **Normal Cancel → immediate Retry** | **Already closed**; cannot deliver response | **No** | `SECOND GENERATION` | New report displayed, no error | **PASS (exit 0)** |
| **QA-only broken AbortSignal, OLD completes first** | Remains connected; intentionally delivered | **Yes**, before retry finishes | `FIRST GENERATION` | Retry reports `review_source_changed`; no new report displayed | **FAULT DETECTED (exit 1)** |
| **QA-only broken AbortSignal, OLD completes last** | Remains connected; intentionally delivered after new report | **No**; newer cache wins first | `SECOND GENERATION` remains | New report displayed, no error | **FAULT DETECTED (exit 1)** |

This identifies **two different properties**. Normal cancellation in the frozen frontend does prevent the canceled request from writing in this tested overlap. Agent B's `saveReviewIfFresh` compare-and-swap correctly stops a **late** old writer from overwriting a **newer** stored report. Conversely, if cancellation were incorrectly omitted and the **old** writer finished **first**, its original source snapshot is still fresh and the older report can win; the second writer's compare-and-swap then rejects it. CAS is not a substitute for canceling obsolete work. Neither QA fault is an observed existing production/browser defect: both are deliberately introduced through a **test-only** Chrome `fetch` wrapper that removes only the first POST's `AbortSignal`. No frontend/backend source or product data is changed.

Each trial makes **6** local fake model calls (phase, moment, summary, repeated twice), all closed, and records exactly **2** distinct Chrome report POST IDs, the exact reply order, SQLite snapshots, the final UI text/error and no uncaught browser exceptions. The three runs completed locally in about **3.6, 4.4 and 4.8 seconds**, inclusive of Chrome and Vite startup and held responses. They are synthetic timing observations, **not** production throughput or latency measurements. The two test-only browser faults are **expected to exit nonzero**, including the old-last schedule whose backend cache remains correct; a request-abort defect must not be treated as safe solely because CAS happened to protect this one completion order.

## Independent verification, hostile negative controls, and run identity

- `scripts/review-benchmark-browser-retry.mjs`: **real Chrome/React/HTTP/SQLite** harness; accepts only `--fault=skip-first-abort` (old first) and `--fault=skip-first-abort-old-last` as QA-only injected faults. Its normal case exits 0 only if canceled first response is undeliverable and the second report is persisted and displayed. Broken cases must exit nonzero with a **specific** reason, not a generic fixture/setup failure.
- `scripts/review-benchmark-browser-retry-proof.mjs`: independently reconstructs the legal PGN's Black checkmate, verifies source + binary + fixture provenance, two distinct Chrome HTTP POST request IDs, two model pipelines, final SQLite language/audience, different summary labels and UI state, and the exact expected difference between both fault schedules. Emits `certification-summary-checkpoint21.json` with three distinct UUIDs and **`release_approved:false`**.
- `scripts/review-benchmark-browser-retry-negatives.mjs`: accepts only the correctly scoped positive and **negative evidence**, and rejects **129/129 deliberately forged evidence packets**, including green QA status on faulty old-first/old-last runs, misattributed prompt stages, missing real browser requests, fake model closure, changed chess/source provenance, mislocalized cached profile and falsified UI/cache state.
- `scripts/review-benchmark-browser-retry-boundary.mjs`: runs all **three** real Chrome executions in separate subprocesses, checking **exit 0 / 1 / 1**, distinct cryptographic UUIDs matched between stdout and raw JSON, the exact tested corruption, and independent rejection of forged-green flags. No previous raw packet can substitute for the current subprocess.

The independent QA verifier is necessarily an auditor of **recorded actual Chrome/SQLite evidence**, not a tamper-proof attestation or a sealed human-adjudicated dataset. Raw synthetic data and Chrome events are stored only in ignored `qa/review-excellence/results/` files; no external telemetry or private traffic is collected. All previous checkpoints remain unchanged.

## Reproduce from the assigned Agent D branch

With dependencies present, the two *detached* candidate worktrees at the above frozen commits and a verified Stockfish executable:

```sh
node scripts/review-benchmark-browser-retry-boundary.mjs \
  --product-root="$(pwd)/qa/review-excellence/results/worktree-product-browser" \
  --backend-root="$(pwd)/qa/review-excellence/results/worktree-coach" \
  --engine="$(pwd)/qa/review-excellence/results/engine/unpacked/usr/games/stockfish"
node scripts/review-benchmark-browser-retry-negatives.mjs
node scripts/review-benchmark-browser-retry-proof.mjs
```

### Exact frozen provenance and QA source SHA256

| Input | SHA256 |
| --- | --- |
| Self-authored v2 fixture manifest, **no sealed holdout** | `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44` |
| Stockfish **16** executable | `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca` |
| Real Chrome Cancel/retry runner | `72032f2afe25478c497f331573ec78434b643ce28e62f0659592c32072bacf76` |
| Independent retry proof | `4e20f9b4a1f61c115af6a00d5fadb4fdbbe3aaba1ae4c393da44edc47e9afa0b` |
| 129 hostile evidence controls | `537aac4a704f3c71d3d2763c1cacf3ef8ddfd1b2d8a5f8414e1cc99689963e03` |
| Three real-browser subprocess orchestrator | `348887d0342ad23fdd734059fb27a75d53d474195f3d54345c66dfeb8ecf0072` |

## Cross-agent read-only status and remaining risks

The fetched source refs remain pinned to **Agent A** `7178e262`, **Agent B** `19c359ec`, **Agent C** `d72eaced`, **main** `51df1d85`, and PR #17's independent accuracy work `fix/accuracy-aggregation-bias-20261111` `02bfe983`. No owner code, real database, actual logged-in browser or release configuration was touched. All source changes are under **Agent D's QA files**. The backend's early-old-wins behavior was demonstrated only after deliberately disabling cancellation in a temporary QA Chrome profile; refer it to Agent B/integrator as a concurrency policy consideration, not as a proven default UX bug.

**Next meaningful audit:** verify retry after cancellation when the first request is interrupted during phase or move-explanation generation (not just final summary), or retest on new owner commits. The still-open independent profile/cache race, unverified coaching content, production-equivalent Stockfish reference, resource benchmarks, sealed holdout and real reverse proxy remain separate gates.

**Decision:** Normal Cancel → immediate Retry and backend late-writer CAS pass under the bounded schedules. The independent benchmark detects both deliberately broken browser schedules. **No full-product certification, integration approval or merge to `main`.**
