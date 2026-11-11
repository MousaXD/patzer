# Agent D — Checkpoint 17: injected model-response contamination and false-green resistance

**Agent D assigned branch:** `agent/review-benchmark-20261111`. **Previous verified commit:** `f1e6755f743391430c7ab073305b2093eec59311`. **Frozen, read-only Agent B candidate:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`.

This checkpoint continues the two-owner real-application experiment from Checkpoint 16 and challenges its **application-to-benchmark adapter boundary**. The aim is to discover whether the benchmark can falsely certify the real Game Review route after it accepts incorrect model output, **not** to mutate a completed QA packet and call that an application test. Only Agent D-owned scripts and documentation were changed. All accounts are fake, all game data are self-authored synthetic, the SQLite database is disposable, and the LLM is a loopback-only fake provider. No production data, third-party authenticated game traffic, real API credentials, other agents' code or `main` were touched.

## Fault introduced before the actual application consumer

Added an opt-in **test-only** `--fault=swap-model-output` to the existing authentic two-user Hono SSE Game Review runner. It preserves both real owner sessions, their own synthetic games, their real model prompts, the original legal PGN, the pinned engine and separate language/audience metadata. The local fake LLM instead supplies **the other test profile's prose and summary** for each user. Patzer's real generation and persistence code then consumes the response.

| Recipient | Correct profile and generated FACTS | Corrupt model summary **actually emitted and cached** |
| --- | --- | --- |
| User 1: `en` beginner, White loses | English `you lost` | Spanish: **“Las negras ganaron la partida.”** |
| User 2: `es` advanced, Black wins | Spanish `ganaste` | English: **“Black won the game.”** |

The core chess fact that Black won remains true in both sentences; the corruption is **wrong-language generated prose**, not an invented game result. The mock strings contain no actual customer information. This is **not** a demonstrated cross-tenant authorization breach; cross-user GET/POST requests still receive `404`, and the unauthenticated POST receives `401` under the same test schedule. It does demonstrate that syntactically valid but mislocalized model text can reach Patzer's real `done` SSE response, be stored in the actual disposable SQLite review cache, and be returned by the authenticated GET endpoint with apparently correct profile metadata.

## True positive and application-level negative controls

The bounded tester runs **both** actual application variants as separate subprocesses in newly created test-only databases:

| Controlled experiment | Exit | Grounded result |
| --- | ---: | --- |
| Clean same-source two-user concurrency | `0` | Both language/owner summaries, model facts and cached GETs correctly match the user; independently verified |
| Swapped model response **before** application consumption | `1` | **Both** incorrect summaries were nonetheless emitted and cached; benchmark refuses a green result |

The two app runs each process **6 model requests**, in order per recipient (phase, moment, summary), with **6/6 mock responses closed**. They use the same frozen Agent B candidate and Stockfish 16 build but **distinct, randomly generated run identifiers**. The outer verifier checks that the `benchmark_run_id` in the actual raw evidence matches the subprocess invocation, preventing a previous raw run from accidentally being reused as the current test.

Critically, the independent evidence verifier now checks actual SSE and persisted content **before** trusting any self-reported success flags. Three hostile falsification attempts were explicitly rejected:

1. **Forge all green flags** despite swapped real SSE content. The proof rejects the incorrect recipient-specific SSE summary.
2. **Forge correct cache/GET values** while retaining the actual wrong SSE. The proof rejects the real SSE mismatch.
3. **Forge correct SSE values** while retaining the wrong cached report and GET. The proof rejects the persisted cross-user-summary mismatch.

These **three** boundary-specific forgeries complement the **23/23** existing Checkpoint 16 corrupted evidence packets, which still fail under the hardened verifier. Repeated bounded runs reproduced the same expected clean/negative outcomes; no real-provider cost, production load, browser session or external endpoint was involved.

## Reproduce without modifying owner source

From the standalone Agent D checkout, with dependencies installed, a detached *read-only* Agent B worktree at the exact candidate SHA and the locally verified engine binary:

```sh
APP="$(pwd)/qa/review-excellence/results/worktree-coach"
ENGINE="$(pwd)/qa/review-excellence/results/engine/unpacked/usr/games/stockfish"

node scripts/review-benchmark-tenant-boundary-controls.mjs \
  --app-root="$APP" --engine="$ENGINE"
node scripts/review-benchmark-tenant-proof.mjs
node scripts/review-benchmark-tenant-negatives.mjs
```

`tenant-boundary-controls.mjs` invokes the real route harness twice with the independently pinned SHA256; it **expects** the second subprocess to exit nonzero and checks the source of the rejection. The raw SSE, cache and GET evidence remains in ignored local `qa/review-excellence/results/` files. The checkpoint report `certification-summary-checkpoint17.json` includes source identity, result counts, two unique run IDs and explicit **`product_release_approved:false`**. Historical Checkpoint 16 findings remain frozen rather than being overwritten by a repeat test.

**Exact identity:**

- Candidate: `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`
- QA-owned Stockfish **16** executable SHA256: `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca` (depth 8, 1 thread, 16 MiB hash)
- Self-authored manifest v2 SHA256: `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44` (unchanged; no opened holdout)
- Test runner SHA256: `dffb45d2872bd09d6f4d91c3041667359861714662fb5921c74af699c5e1b62e`
- Independent verifier SHA256: `c892d17da162e330ba542982e2c75e67e7e317f1c75fe05ad79fcb30013372f8`
- Model-boundary adversarial controls SHA256: `95e9045f7b75d4b5777ea56715ece17efbb6097d8a9085e21d9132cf7e11c93c`

## Interpretation and cross-agent implications

**Passing property:** the QA system no longer falsely certifies this deliberately broken model-response scenario even when the application itself emits `done` and saves the wrong-language prose. **Remaining application concern:** the coach's non-streaming content validation does not establish that the model complied with the user's language; a model can provide the other test user's wording and still be cached under the original profile. Coordinate with Agent B/integrator for model-response validation strategy and with Agent C if the frontend adds another provenance guard. Do **not** alter their owned source from Agent D.

This does **not** establish natural language-switch rates for a deployed model, any actual leakage of user-private model context, genuine teaching utility, a real browser/proxy behavior, a sealed gold holdout, Stockfish 17 parity or broad multi-tenant security certification. The earlier independently reproduced cache/profile and unsourced factuality bugs remain blocking.

**Next continuation:** Verify account/session revocation **mid-review**, with separate pre- and post-revocation requests in disposable SQLite. Report clearly whether a request authenticated **before** revocation is expected to finish (policy issue) instead of treating that automatically as a security flaw; include an independent negative control that prevents a misleading success verdict. Do not assume source fixes until the owner updates and pins a new SHA.

**Verdict:** Independent QA catches the deliberately corrupted **real application output**. The frozen backend still accepts that mislocalized output; full product integration and release certification remain **unapproved**.
