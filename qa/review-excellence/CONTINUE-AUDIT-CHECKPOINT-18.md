# Agent D — Checkpoint 18: logout during an already-admitted Game Review

**Assigned branch:** `agent/review-benchmark-20261111`. **Previous verified pushed HEAD:** `122b1fae66840a1d46940be81c4e004ac63a4beb`. **Read-only Agent B candidate:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`.

This independently exercises the **real authenticated logout route** and **real Game Review SSE route** while a synthetic game review is awaiting the **final JSON model response**. The intent is to establish exactly which admissions are revoked by logout and whether a preexisting review finishes. It is not a claim that the product must cancel every request on logout: **the expected treatment of already-admitted asynchronous work has not been specified as a security policy**.

## Controlled procedure and results

All records are test-only: one synthetic user and their profile, one legal self-authored four-ply Fool's Mate, a newly created disposable SQLite DB, pinned Stockfish 16, one local loopback fake vLLM model and a synthetic session. No live app, production database, credentials or other agents' files are touched.

1. Through the **actual** application session helper, create a signed test cookie for the synthetic user. One valid session row exists. Open the real authenticated `POST /api/games/1/review` route; it admits the request (`200`).
2. Hold the provider **final summary** response while earlier phases and key-moment generation have completed. Before logout, the benchmark verifies that the last provider response is pending and `analyses.prose_json` is **NULL**.
3. Call the real `POST /api/auth/logout` with that cookie: it returns **200**, marks `ok: true`, expires the cookie via `Set-Cookie` rather than merely mentioning its name, and removes the matching SQLite session row (count **1 → 0**).
4. Immediately attempt another authenticated GET and POST for the same synthetic game using the revoked cookie. Both return **401 Unauthorized**, proving new admissions fail after logout.
5. Release the response for the **previously admitted** review. It completes with a single genuine SSE `done`, without `error`, and persists the review in the disposable cache **after logout**. This follows the current route's request-admission model and is not inherently evidence of an authentication bypass.
6. Create a fresh signed test session for the same synthetic owner. A GET with the **new** cookie returns **200** and the stored valid report. The old cookie remains revoked; the benchmark never reuses it to recover the review.

The bounded flow made **three** loopback model calls (phase → moment → summary), with **3/3** responses closed. No remote inference, external account or private game was involved. The observations were verified by an independent source/evidence checker that replays the source chess result, inspects the actual SSE `done`, checks logout/session state, the revoked HTTP statuses and subsequent new-session readback.

## Hostile QA checks

- `scripts/review-benchmark-logout-inflight.mjs` — real route and model timing harness; writes only ignored local raw evidence under `qa/review-excellence/results/review-logout-inflight.json`.
- `scripts/review-benchmark-logout-proof.mjs` — independent provenance, chess, SSE, session-count, HTTP-authorization and model-work verifier. Writes the checked-in `certification-summary-checkpoint18.json` with `release_approved:false`.
- `scripts/review-benchmark-logout-negatives.mjs` — **24/24 corrupted evidence packets rejected**, including forged logout success, unexpired cookie, live old session, GET/POST authorized after revocation, fake SSE completion, premature cache, wrong result, model-stage omission, inaccurate timing claims and invented policy/release approval. One genuine bounded evidence packet is accepted.

All negative-control corruption is test-only, never applied to product code or private data. Test exit 0 means **this QA observation has been verified**, not that the entire product is secure or released.

## Reproduce safely

With the detached candidate worktree at the frozen Agent B SHA and the independently verified Stockfish executable:

```sh
APP="$(pwd)/qa/review-excellence/results/worktree-coach"
ENGINE="$(pwd)/qa/review-excellence/results/engine/unpacked/usr/games/stockfish"
PIN=00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca

node --import tsx scripts/review-benchmark-logout-inflight.mjs \
  --app-root="$APP" --engine="$ENGINE" --engine-sha256="$PIN"
node scripts/review-benchmark-logout-negatives.mjs
node scripts/review-benchmark-logout-proof.mjs
```

**Exact fixed provenance:** Agent B candidate `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`; Stockfish **16** SHA256 `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca`, 1 thread, 16 MiB hash, depth 8; the unchanged self-authored fixture manifest v2 SHA256 `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`. No sealed holdout, real-browser logout, hosted model, production data, reverse proxy or Stockfish 17 reference was used.

**QA source hashes:**

- Real-route logout runner: `1cbfbba78ca824cb3af8f240a22acd74f5d2f4d29d121348a18e204ff70eba88`
- Independent verification: `93833fc664fbf5b833c25ae8e28bc2c185499a641c4d733dbb0f59750e2f004c`
- Deliberately forged evidence controls: `f9452e56221e98414ddacb938c4ba72fab5f79feb54117acdc4259401bcc16f5`

## Interpretation and next independent question

**Confirmed property:** new requests using a revoked cookie are denied. **Observed lifecycle behavior:** the already-admitted request continues to completion and stores its report. The code's owner authorization was checked at route admission, before model generation. Whether logout must also trigger cancellation/revocation of already-running work is a **product/session policy question** for the integrator and security owner; no unsupported P0/P1 claim is made.

If the desired policy is *immediate cancellation and no writes after logout*, Agent B and the integrator should define it, then implement and independently test enforcement without impacting normal cancellation, cache CAS, or session isolation. Agent D must **not** silently modify their source. A future full browser/proxy test is needed to see whether navigation/logout already aborts the browser's SSE; this in-process test does not show that UI behavior.

**Next meaningful audit:** bounded cross-process revocation timing or the new owner fix, if available; otherwise continue separately toward the sealed holdout and actual engine reference parity. Earlier real model-language/profile cache/coach claim defects remain open, so **full integration and release certification are unapproved**.
