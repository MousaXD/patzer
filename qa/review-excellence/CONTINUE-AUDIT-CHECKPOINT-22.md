# Agent D — Checkpoint 22: phase and key-moment cancel/retry, real Chrome

**QA branch:** `agent/review-benchmark-20261111`. **Previous pushed QA commit:** `9ac537f811346eb26842a2971e8e1e1739031a9f`. **Read-only product C:** `d72eaced6972c8a2ec7d8581365c45788b15a29a`. **Read-only backend B:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`.

Checkpoint 21 verified Cancel → immediate Retry only while the **final model summary** was held. This checkpoint closes the different cancellation gaps during **phase-generation** and **key-moment explanation**. It uses the real Agent C React `GameAnalyzer` + `GameReportPanel`, the real Agent B Game Review Hono route/cache, genuine localhost Chrome 157 DevTools-observed HTTP requests, disposable SQLite, one synthetic signed user and a loopback model. No other agent's source, active app, production database, credentials or personal browser profile is accessed or modified.

## Test schedule and observed outputs

One isolated Chrome instance is **reused for both stages**. The self-authored legal four-ply Fool's Mate is inserted under two fake game IDs (1 = `phase`, 2 = `moment`). The mock model holds the **first** generation's targeted early response. The test then clicks the actual **Cancel generation** and **Write AI report** buttons without waiting for the old server request to finish. It holds the replacement's final summary, examines the previous connection/cache, and releases controlled model responses.

| First generation held at | Unmodified Chrome / backend | QA-only abort suppression |
| --- | --- | --- |
| `phase` model call | Old model response closes; retry saves/displays **SECOND EARLY GENERATION**, no error | Old request continues into moment and summary, saves/displays **FIRST EARLY GENERATION**; retry receives `review_source_changed` |
| `moment` model call | Old model response closes; retry saves/displays **SECOND EARLY GENERATION**, no error | Old request continues into summary, saves/displays **FIRST EARLY GENERATION**; retry receives `review_source_changed` |

**Real-browser process results:** normal **exit 0**, deliberately faulty **exit 1**. Each run has **4 distinct Chrome POST IDs** (two for each game). Normal: **9 local mock model calls**, each closed. Faulty: **12 local mock model calls**, each closed. No external model is invoked. The two results were approximately **7.8 s and 7.0 s** including disposable Chrome/Vite/backend startup and controlled response holds; **not** production workload or Stockfish latency measurements. Chrome's `net::ERR_ABORTED` events independently corroborate normal request cancellation.

## Hostile audit: fixing an initially ineffective negative control

The initial adversarial attempt removed only the first `fetch`'s `AbortSignal`. **That was not sufficient** at an early stage: when the withheld progress response arrived, the React stream reader still observed its aborted flag, stopped reading and closed the backend stream before another model call. A stalled or setup-failing negative control is **not proof** that a test detects a bad application; its output was rejected, and it was not used for certification.

The corrected QA-only injection targets the actual **first Game Review `AbortController`**, identified by its signal on the first report POST, and makes that controller's `abort()` a no-op. All other controllers and report requests behave normally. The real Cancel button still changes UI state, but the old model continues through its remaining stages. Both Phase and Moment cases now produce an actual stale SQLite cache entry, a real stale report in React and a real `review_source_changed` rejection for the replacement. The verifier checks that the controller was actually intercepted and its abort call was swallowed **once per case**. This is a *test-only deliberately broken browser*, not an observed problem with unmodified Patzer.

The independent checker refuses to label either corrupted browser scenario as a pass, even if superficial QA status flags are forged. **116/116** additional deliberately falsified packets are rejected, including invalid source hashes, run IDs, synthetic game identity, omitted model calls, missing HTTP requests, fabricated cache/UI outcomes, incorrect language/audience, fake aborts and false release approval. Each real Chrome subprocess carries a distinct cryptographic run UUID matched against its freshly written ignored raw evidence; the old packet cannot silently certify a new run.

## Owned QA files and reproduction

`scripts/review-benchmark-browser-early-retry.mjs` performs both real-browser stages within a single test-only profile and writes ignored `qa/review-excellence/results/review-early-retry*.json`. `scripts/review-benchmark-browser-early-proof.mjs` independently validates PGN legality, SHA pins, both HTTP streams, early-stage model call sequences, cancellation, SQLite and React. `scripts/review-benchmark-browser-early-negatives.mjs` attacks recorded evidence. `scripts/review-benchmark-browser-early-boundary.mjs` launches a clean and deliberately broken browser subprocess and requires exits **0 / 1** for the **specific** application behavior (never a setup-failure green).

```sh
node scripts/review-benchmark-browser-early-boundary.mjs \
  --product-root="$(pwd)/qa/review-excellence/results/worktree-product-browser" \
  --backend-root="$(pwd)/qa/review-excellence/results/worktree-coach" \
  --engine="$(pwd)/qa/review-excellence/results/engine/unpacked/usr/games/stockfish"
node scripts/review-benchmark-browser-early-negatives.mjs
node scripts/review-benchmark-browser-early-proof.mjs
```

**Pinned data:** self-authored manifest v2 SHA256 `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`; Stockfish **16** SHA256 `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca`, depth **8**, **1 thread**, **16 MiB hash**. No sealed holdout is claimed.

**QA source SHA256 pins:**

- Real Chrome stage harness: `14ef8e287786538996e48c64da2078c82d16386e65c4f168f7d41e8a64bd5a95`
- Independent proof: pinned in `certification-summary-checkpoint22.json` (recomputed each invocation)
- Hostile test-only evidence corruption: `fdea630359b89653bc8981ad830311bf040a6fe05825233b1b1b7fabf2ba3d85`
- Fresh browser challenge: `26adafaf137324cf4d7f10098490e59ffd5058a9a927abeff48e1f75934984d2`

**Next audit:** re-execute open language/audience cache and unsupported coach-claim tests when Agent B publishes a correction; separately assess cancellation under upstream proxy disconnections and phase response timeouts. The sealed independent chess/coaching holdout, representative CPU/RAM/load measurements, deployment-equivalent Stockfish and full browser accessibility remain unfulfilled gates. **No integration or release approval; no merge to `main`.**
