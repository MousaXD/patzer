# Agent D — Checkpoint 23: profile changes from another session during a real Chrome review

**Assigned branch:** `agent/review-benchmark-20261111`. **Previous pushed checkpoint:** `702bc4469e99b865990d576984a03464fcedb977`. **Frozen/read-only Agent B backend:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`. **Frozen/read-only Agent C frontend:** `d72eaced6972c8a2ec7d8581365c45788b15a29a`.

This is an independent **real-browser integration extension** of prior Checkpoints 12–14: those separately established a backend profile-change race and a mocked component's willingness to render an old-profile `done`. This checkpoint connects the browser, real authenticated Settings PATCH, actual Game Review SSE, SQLite cache, a fresh authenticated GET and manual recovery **within one bounded experiment**. It does not reimplement either owner's source or compete with PR #17.

## Actual experiment

All chess is a **self-authored four-ply Fool's Mate**. A synthetic user has **two different signed test sessions** with the same account in a *new disposable SQLite database*. The first session runs the real Agent C React `GameAnalyzer` and `GameReportPanel` in an **isolated Chrome 157** profile, with the original candidate's Vite settings and a localhost Hono API. The second session sends a valid **authenticated PATCH `/api/settings/profile`**, simulating a profile change from another tab or device without navigating the first tab. A single local loopback model serves only synthetic prompts and is held at the **final summary** to create a deterministic test window.

| Controlled sequence | Real application evidence |
| --- | --- |
| **No-op preference control** — English/beginner report running while second session saves the same profile | The React tab displays English, SQLite caches English/beginner, and a fresh authenticated GET returns the same report without a stale flag |
| **Cross-session profile change** — second signed session patches to Spanish/advanced while English/beginner summary is held | The in-flight **old English report still reaches Chrome and is cached** as English/beginner. A *new* authenticated GET correctly returns `{review:null,stale:true}`, but the `prose_json IS NULL` auto-regeneration queue reports **0**, so the stale report is **not scheduled** by that queue |
| **Manual recovery** — refresh the browser and explicitly regenerate | Original cached prose is not rendered after refresh; a new real report sends Spanish/advanced FACTS, saves the Spanish/advanced review and displays **“Las negras ganaron la partida.”**. A new GET returns that review without the stale flag |

The original tab **does not automatically synchronize its React profile store when a second signed session changes the account**. Therefore the observed old-English display is a *cross-session freshness* issue, not an incorrect classification of the chess winner or proof of unauthorized tenant access. The real GET has a valid mismatch guard; the **in-flight POST and legacy queue** remain unresolved parts of the same profile-provenance problem.

### Separate verified accessibility defect in Agent C

After the Spanish/advanced profile refresh, Chrome **visibly renders Spanish UI** (including navigation `Inicio`) and a Spanish report, but `document.documentElement.lang` is still **`en`**. The read-only frontend has `<html lang="en">` in `web/index.html` and no code found synchronizing the root `lang` attribute on `i18n.changeLanguage()`. This mismatch can cause assistive technologies to use inappropriate text pronunciation. **Report to Agent C/integrator**; do not change their source from this lane. This is a local browser/source observation, **not** a full screen-reader accessibility assessment or a measured deployed impact.

## Active negative controls and correctness of the QA itself

A separate deliberately faulty **QA-only** Hono middleware returns the cached English review to `GET /api/games/2/review` *after* the real second-session profile patch to Spanish. The active HTTP endpoint therefore falsely returns `200 {review: <old English prose>}` rather than the real backend's stale refusal. The browser experiment **exits 1** with `stale_profile_cache_served_over_real_HTTP`. The clean, known-defect reproduction **exits 0** with a clear **`product_gate_passed:false`**. These status codes mean the QA experiment observed the requested evidence, **not** that Patzer is release-ready. Each browser subprocess has a **fresh cryptographic UUID**, matched between stdout and ignored raw data, so previous green evidence cannot be substituted silently.

`scripts/review-benchmark-browser-profile-proof.mjs` independently checks the PGN's checkmate outcome, pinned candidates and engine/manifest hashes, **2** signed sessions, **3** distinct Chrome review POSTs, the real profile update and resulting cache/get/UI mismatch, **9/9** closed loopback model calls, actual Spanish/advanced recovery and root language mismatch. `scripts/review-benchmark-browser-profile-negatives.mjs` rejects **114/114 deliberately forged evidence packets**, including false release approval, changed source hashes, wrong HTTP results, a fake Spanish cache, false current-user provenance, missing model calls, stale UUIDs and a purportedly corrected root `<html lang>` without a source change.

The Chrome DevTools helper `scripts/review-benchmark-cdp.mjs` also received an independently reproduced **QA maintainability fix**: `until()` previously implemented `Promise.race(timeout, infinitePollingLoop)`. After timeout the rejected promise left the polling loop alive, causing a failed test subprocess to hang even after its error was written. It now has an **internal deadline**, and `scripts/review-benchmark-cdp-timeout-controls.mjs` confirms the polling count **stops after rejection** and a subsequent bounded check still passes. Earlier checkpoint source hashes remain frozen; this checkpoint records the new browser driver hash instead of silently rewriting history.

## Commands and exact provenance

With the two detached read-only QA candidate worktrees and the independently pinned Stockfish 16 executable:

```sh
node scripts/review-benchmark-browser-profile-boundary.mjs \
  --product-root="$(pwd)/qa/review-excellence/results/worktree-product-browser" \
  --backend-root="$(pwd)/qa/review-excellence/results/worktree-coach" \
  --engine="$(pwd)/qa/review-excellence/results/engine/unpacked/usr/games/stockfish"
node scripts/review-benchmark-browser-profile-negatives.mjs
node scripts/review-benchmark-browser-profile-proof.mjs
node scripts/review-benchmark-cdp-timeout-controls.mjs
```

**Fixed identities:** Agent B `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`; Agent C `d72eaced6972c8a2ec7d8581365c45788b15a29a`; self-authored fixture manifest SHA256 `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`; Stockfish **16** SHA256 `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca`, depth 8, 1 thread, 16 MiB hash; Chrome `157.0.8103.38`.

**QA source SHA256:**

- Chrome CDP driver, fixed bounded polling: `64de770ed9c51fb80f8d56f0f2a75e87bd0986bfc11e94ec5bd95bccbab06f18`
- Real browser/profile-change harness: `690afebc8311f9c9ebfa7a0637e1080d41f47bfcd3717f8594d2393ac31d6918`
- Independent proof: `fedc74a2d3e0c85f8563bc04d59a90bbd444f155e452e13c59b81cddab1267c4`
- 114 corrupt-evidence controls: `1e6511d1fea7f922937e9d23b08340f67d6f9b96d974ba06f9ddf9ea84b7e263`
- Fresh clean/broken real-HTTP Chrome wrapper: `52cb01811109b573ed8f88cfe391a91bda5844e916dc3564308e08843d507cdf`
- Bounded-CDP-poll timeout regression: `a364da031ab84c662996727e95af0cf4171171cdcfaae0a44d52cba885946d00`
- Read-only Agent C `web/index.html`: `e86171bcc055818f4deb334b9468b9a413c794db10fc0a0c94cbfa64a14d0796`
- Read-only Agent C `web/src/i18n.ts`: `b820222c07e07b4e8419f650f3fb9ce5328eed9a8717837ea8d1c2890ebda321`

Raw Chrome events, model responses, synthetic sessions and SQLite are only in **ignored QA results**. The test cleans up Chrome, local API, Vite, model and the entire disposable database/profile directory. The QA-owned runner and documentation are the only tracked file changes.

## Coordination, blockers, continuation

Owner branches were fetched and inspected **read-only**. Agent B's backend remains at `19c359ec`, Agent C's product at `d72eaced`, Agent A's scoring at `7178e262`, PR #17 at `02bfe983` and `main` at `51df1d85`. No corrections to these outstanding profile-provenance issues were available in those frozen commits.

**Dependencies:** Agent B/integrator should define source-profile provenance for an in-flight report and the criteria for auto-regenerating a cached report whose language/audience no longer matches. Agent C should update the root HTML `lang` when the UI language changes; consider a content/profile provenance guard as defense in depth. Do not turn a QA-observed bug into release approval. Neither source owner was modified in this lane.

**Next independent audit:** continue with unsupported model factual claims and one truly external, human-sealed holdout; or retest profile and coach behavior against a new **pinned** owner SHA when available. The local loopback model cannot establish deployed model reliability, and no full production reverse-proxy, screen-reader, throughput or held-out human-judged certification was attempted.

**Verdict: two real application gaps reproduced and independently checked (cross-session stale profile and root HTML language), plus a test-harness timeout leak fixed. Full product integration/release certification remains BLOCKED.**
