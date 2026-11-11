# Agent D — Checkpoint 20: actual Chrome Game Report cancellation and adversarial abort bypass

**Assigned branch:** `agent/review-benchmark-20261111`. **Parent checkpoint:** `7cb32dc50b860467bab361f3728c65dad91ed881`. **Backend candidate B (read-only):** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`. **Product candidate C (read-only):** `d72eaced6972c8a2ec7d8581365c45788b15a29a`.

The unfinished Checkpoint 19 handoff was **browser-level cancellation**: it was not enough to infer behavior from a React `AbortController` cleanup effect, or from the previously demonstrated already-admitted HTTP request that remains connected after logout. This checkpoint uses a **real isolated headless Google Chrome 157.0.8103.38 session**, actual Agent C React `GameAnalyzer`, `GameReportPanel`, `Layout` and logout navigation, plus Agent B's real Hono review/auth/game endpoints, authenticated session management and real model-transport route. Its UI loads through the candidate product's original Vite/Tailwind configuration, using a local Vite-to-Hono development proxy, rather than a fake component or a full production deployment.

The benchmark owns a fresh disposable SQLite file, a synthetic account with a signed test cookie and four isolated game rows containing only the **self-authored legal Fool's Mate PGN**. It pins Stockfish 16, depth 8, one thread and 16 MiB hash. The LLM is a loopback JSON mock whose **final summary response is held** until after the browser action. The only browser profile is under an automatically deleted QA results subfolder; it does not open, reuse or modify the operator's existing Chrome or Brave profile. All servers and Chrome debugging listen on ephemeral `127.0.0.1` ports and are shut down, and the disposable SQLite and profile directory are deleted at the end.

## Real Chrome experiments

| Browser interaction | Provider state when released | SQLite after the action | Result |
| --- | --- | --- | --- |
| Start Game Report on game 1, then click the real `Review` navigation link | **Closed** before release; provider cannot send the summary | **NULL**; no report persisted | **PASS** |
| Start Game Report on game 4, click actual `Cancel generation` | **Closed** before release; UI shows a cancellation message | **NULL**; no report persisted | **PASS** |
| Start Game Report on game 2, click actual navigation-shell `Log out` | **Closed** before release; user redirected to `/login` and SQLite session row removed | **NULL**; no report persisted | **PASS** |
| **QA-only adversarial control**: browser intercepts the game-3 POST and omits only its fetch `AbortSignal`, then navigates away | **Still open**; fake model response was delivered after navigation | **Non-NULL**; actual Game Review backend cached the result after UI unmount | **CORRUPTION DETECTED** |

The adverse fourth experiment proves why a disappearing report component is not enough to certify server cancellation. The deliberately broken fetch remains connected even though the actual React component unmounts; its output reaches the **real** backend cache. Crucially, the browser injection is only in the isolated QA page's runtime (installed through Chrome DevTools); it does **not** modify Agent B/C source or the production bundle. It is not an observed production privacy incident or a cross-user authentication bypass.

The browser's own CDP `Network.requestWillBeSent` records confirm four distinct POSTs to the four game review URLs. In the latest repeated run, **three genuine Chrome `Network.loadingFailed` records** reported `net::ERR_ABORTED`. There were **12** real local mock-model calls (phase → moment → summary for each case), **12/12 provider responses closed**, and **zero uncaught browser exceptions**. The local end-to-end wall time was ~**8.4 seconds**, including starting Chrome, Vite, Hono, engine work and the deliberately held responses. This is **not** a Stockfish or deployed inference performance benchmark.

## Independent QA and hostile self-certification challenge

The following files are owned exclusively by Agent D's QA lane:

- `scripts/review-benchmark-cdp.mjs`: minimal bounded Chrome DevTools Protocol driver using the existing `ws` dependency and ephemeral isolated browser profile. Debugging is bound to loopback without disabling Chrome's sandbox or using a wildcard remote-debugging origin grant. Fails cleanly and disposes spawned processes.
- `scripts/review-benchmark-browser-abort.mjs`: real App/Hono/Vite/Chrome run. It **fails nonzero** if any normal action leaves the model live/caches a report or if the injected abort failure does not actually reach the cache; it also rejects missing browser requests and runtime exceptions. Only raw synthetic events are persisted locally in ignored `qa/review-excellence/results/review-browser-abort.json`.
- `scripts/review-benchmark-browser-proof.mjs`: an independent verifier checks original source SHAs and PGN/checkmate truth, Chrome identity, four real review POSTs, canceled network records, the actual provider/socket/cache evidence, no UI exceptions, and distinct normal/adversarial outcomes. It produces the checked-in `certification-summary-checkpoint20.json` with **`release_approved:false`**.
- `scripts/review-benchmark-browser-negatives.mjs`: a valid bounded packet is accepted; **42/42 deliberately falsified evidence packets rejected**. Mutations cover source/fixture identity, stale run IDs, missing/duplicated browser requests, uncanceled model generation, incorrect cache after logout/navigation/cancel, ineffective adversarial injection, missing provider work, fake browser success and unsupported release approval.
- `scripts/review-benchmark-browser-boundary.mjs`: a second independent **real-Chrome challenge** runs a genuine and a deliberately broken browser session in **separate subprocesses**, binding each to a fresh cryptographic UUID. Its QA-only `--fault=disable-navigation-abort` removes the first game review's fetch signal even during the *normal* navigation test. The real model response is delivered and cached after navigation; the benchmark returns **exit 1**, naming `real_internal_navigation: the real model request stayed active`. The independent verifier rejects the broken packet **even after its `qa_verdict` is forged to `pass` and fault flags are removed**. The clean subprocess exits 0 and passes. Results are recorded in `certification-summary-checkpoint20-boundary.json`.

After the boundary run, the independent evidence mutation suite rejects **42/42 forged packets** (increased from the initial 39). Both clean and deliberately broken runs have different `benchmark_run_id` values checked against the actual subprocess stdout and ignored raw JSON; an old green Chrome report cannot be silently reused for a new execution. This addresses a separate false-green risk from the earlier checkpoints.

The checked-in `certification-summary-checkpoint20.json` also includes its own `qa_run_id`, independently checked for equality with the `clean_browser_run_id` in `certification-summary-checkpoint20-boundary.json`. A final hostile consistency check caught and corrected that missing link before committing the checkpoint.

Success means **the benchmark proves these four browser behaviors**, not that all browser UI or all Game Reviews are correct. Earlier Checkpoints 12–14 demonstrate distinct **profile-provenance/cache** failures, and Checkpoint 17 demonstrates that mislocalized LLM text can reach the real cache when deliberately supplied by a bad model. Those remain unresolved and do not become green because cancellation works.

## Reproduce in disposable conditions

With two detached read-only candidate worktrees (Agent B and Agent C) at the above exact commits, root dependencies installed, and the verified local Stockfish binary:

```sh
node scripts/review-benchmark-browser-boundary.mjs \
  --backend-root="$(pwd)/qa/review-excellence/results/worktree-coach" \
  --product-root="$(pwd)/qa/review-excellence/results/worktree-product-browser" \
  --engine="$(pwd)/qa/review-excellence/results/engine/unpacked/usr/games/stockfish"
node scripts/review-benchmark-browser-negatives.mjs
node scripts/review-benchmark-browser-proof.mjs
```

### Exact provenance pins (SHA256)

| Input | SHA256 |
| --- | --- |
| Self-authored v2 fixture manifest | `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44` |
| Local Stockfish 16 executable | `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca` |
| Agent C `GameReportPanel.tsx` | `c3c033be05df83ef230b85542c906ae6321d88fa5169705cd00e8eaeceb49ddb` |
| Agent C `GameAnalyzer.tsx` | `17ffb273f13c97444f44141aaa2ca79bf236cfebe4bf09bfc0edf4dbecb1440c` |
| Agent C `Layout.tsx` | `f0915830b573e76f42905dbf2e2d85863e019bbbb854551a515109ed4a4c6e69` |
| Agent B `server/src/routes/review.ts` | `21e0a25f00418d7c1749b6089ed6d685ad1cb4f752e28bf5af16f9fa752442d0` |
| QA Chrome CDP driver | `d76161eb294315cadf1a49f73f9d56650b8780d8faaa347cbc51608d342d0650` |
| QA actual browser test | `a9aac0168d680485d2f0a9b0c1b882c2d60e53cc667d053678278af047c458c8` |
| QA independent browser verifier | `ca259043197f6d0ec80b766af68f3c24cd2fa5766c09726e54834b428dc39822` |
| QA 42 hostile evidence mutations | `4bddb3b6872fb3f2d5a5af65158d88b9fbcd2bc36b63a620f119726438565e1c` |
| QA real-Chrome positive/negative boundary driver | `9d67e444834f3b04e59674a6e33bbedcde65f081c04fddef2b89dcffd58cdd73` |

## Certification boundary and next continuation

The existing frontend **correctly aborts generation on navigation, explicit Cancel and logout** in the tested real Chrome/Vite/Hono environment, and the benchmark catches a deliberately broken fetch abortion. This makes a valuable previously unverified component behavior independently testable. The test uses programmatically triggered DOM click handlers in real Chrome, not a physical-pointer/accessibility test. It does not include a built production bundle, real reverse proxy, external identity provider, production database, real hosted LLM, large games, browser password manager or personal browser profile. It does not determine a policy for stopping requests that remain server-connected after logout; that was separated carefully in Checkpoints 18–19.

**Next high-value independent work:** retest previous cache/provenance and LLM-content failures against any newly corrected Agent B/C commits; then test browser cancellation under a production-like reverse proxy and build if approved. The sealed, independent holdout and full engine/model workload certification remain separate gates. No release/integration approval and no merge to `main`.
