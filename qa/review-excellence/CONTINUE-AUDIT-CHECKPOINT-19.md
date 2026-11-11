# Agent D — Checkpoint 19: two-process session revocation and hostile HTTP admission control

**Agent D branch:** `agent/review-benchmark-20261111`. **Previous pushed checkpoint:** `d7712012cc26efee36ab07cc21ff90de2fe18730`. **Frozen Agent B code, read-only:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`.

Checkpoint 18 proved session revocation inside a single Node/Hono instance. This checkpoint tests the distinct **two-process** case: independent Node runtimes with separate SQLite connections and localhost HTTP ports, sharing only a **new disposable WAL SQLite database**. The review route runs on Worker A, the real logout route on Worker B. The same legal self-authored four-ply Fool's Mate, one synthetic user and test-only session, and pinned local Stockfish 16 are used. No live application, private history, authenticated third-party traffic, production database, credentials, remote LLM, other agent code or `main` was touched.

## Reproducible real HTTP schedule

1. The parent QA process creates a fresh synthetic account/game/analysis and signed session using the **actual candidate** database, analyzer and session modules. It starts **two independent Node child processes** with unique PIDs and distinct `127.0.0.1` ephemeral TCP listener ports; each imports the real Review and Auth routes from the detached Agent B worktree.
2. Both processes successfully GET the *uncached* Game Review with the original signed cookie (`200` on each). Server A admits a genuine HTTP `POST /api/games/1/review` and starts a real SSE stream.
3. The mock LLM completes phase and moment JSON, then **holds the final summary response** while the review's cache remains NULL. Server B receives the **real HTTP `POST /api/auth/logout`**. It expires the cookie, returns `200`, and deletes the session row from the shared disposable SQLite (`count = 0`).
4. The *old cookie* then attempts **GET and POST on both processes**: **all four requests return 401**, with no special request-middleware cache persisting a stale authenticated user. Two additional *tampered-signature* requests also return `401`.
5. The previously **admitted** SSE is released and completes with genuine `done`; the review is cached after logout. A newly created valid session for the same synthetic owner can GET the cached report from **both** processes (`200`/`200`, same Black-win report).

This cross-process experiment completed in about **1.1 seconds** with a localhost mock model. Three model calls were made and all three responses closed. The runtime is a local synthetic wall-time observation, **not** a production throughput/latency SLO. No CPU/RAM load distribution, browser logout, global CSRF middleware, external SSO provider or reverse proxy was exercised.

**Security interpretation:** New requests with a revoked cookie **are denied across processes**. An already-authenticated streaming request continues after logout; whether product policy requires immediate cancellation/no post-logout writes remains **unspecified**. Do not label that alone an authorization bypass.

## Genuine negative control at HTTP admission boundary

A separate QA-only switch, `--fault=grant-revoked`, makes **Worker A's test wrapper** issue a synthetic `200` to one specially marked request after logout, without editing any source route, database or auth implementation. The same external HTTP benchmark is rerun with the fault:

- Clean process-to-process revocation run: **exit 0**, independent SSE/source proof passes.
- Deliberately broken HTTP wrapper run: **exit 1**, with a concrete `revoked_cookie_accepted_by_worker` assertion and actual status array `[200,401,401,401]` instead of `[401,401,401,401]`.
- Positive/negative executions have **different cryptographic UUID run IDs**, verified against freshly written stdout and raw evidence. Reusing an old green result cannot be silently accepted as current.

The test-only bypass exists exclusively in `scripts/review-benchmark-revocation-worker.mjs` and only responds when the adversarial CLI switch **and** a special test-only request header are both present. It is **not** present in Patzer's application or anywhere under the candidate source worktree. This control proves that the test can fail on an actual incorrect HTTP status from a separate process, instead of merely rejecting an edited evidence JSON object.

## Independent evidence verification

- `scripts/review-benchmark-cross-process-logout.mjs`: creates disposable data, launches child processes with sanitized test-only environment, forces the precise held-summary schedule, sends real HTTP requests, verifies session deletion and caches, and cleans up both child servers and the disposable database.
- `scripts/review-benchmark-revocation-worker.mjs`: minimal **QA-only** Hono host for the real source routes; binds localhost only. It **omits global app middleware**, so this is not full CSRF/CORS stack certification.
- `scripts/review-benchmark-cross-process-proof.mjs`: independently replays the legal PGN, verifies the frozen source/engine/manifest identity, two distinct PIDs/ports, HTTP status arrays, actual SSE `done` JSON, chess ownership and final cached GET. Issues `certification-summary-checkpoint19.json` with `release_approved:false`.
- `scripts/review-benchmark-cross-process-negatives.mjs`: genuine scoped packet accepted; **34/34 deliberately forged packets rejected** across missing/duplicate processes, wrong source, fake auth statuses, stale report, invalid winner, model failures and fabricated policy approval.
- `scripts/review-benchmark-cross-process-boundary.mjs`: orchestrates the clean and test-only broken real-HTTP trials and records `certification-summary-checkpoint19-boundary.json` with distinct run IDs and expected positive/negative exits.

All raw request and response evidence remains under ignored `qa/review-excellence/results/`; only QA scripts, a reproducibility report and machine-readable checkpoint summaries are committed. No production SQLite was read or modified.

## Exact commands and SHA pins

With a detached candidate worktree and dependencies installed in the QA checkout:

```sh
APP="$(pwd)/qa/review-excellence/results/worktree-coach"
ENGINE="$(pwd)/qa/review-excellence/results/engine/unpacked/usr/games/stockfish"
PIN=00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca

node --import tsx scripts/review-benchmark-cross-process-logout.mjs \
  --app-root="$APP" --engine="$ENGINE" --engine-sha256="$PIN"
node scripts/review-benchmark-cross-process-negatives.mjs
node scripts/review-benchmark-cross-process-proof.mjs
node scripts/review-benchmark-cross-process-boundary.mjs \
  --app-root="$APP" --engine="$ENGINE"
```

**Frozen provenance:**

- Agent B code: `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`
- Stockfish **16** executable SHA256: `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca` (depth 8, 1 thread, 16 MiB hash)
- Self-authored manifest v2 SHA256: `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44` (unchanged, **no sealed holdout**)
- Child-process QA host SHA256: `bd32fefbbfe006099a07fb67e461a92be733d82390ec84b070fe49592212c633`
- Real two-process HTTP harness SHA256: `7f682f9955d9181ea7a4f5eb5a3e6f67ec32bc17cc0ad9a10db5d79db5806a39`
- Independent verifier SHA256: `efb7988f4493b7d646de4d3b0d51b58d49ea480d089ae204f6f7131ff8376579`
- Forged-evidence tests SHA256: `6aae91063889259032b3e6c990e1b27bc55701c5365ac4d9e9ee588b081a2bf2`
- Real-HTTP bypass challenge SHA256: `f9ba72db6d712478bcd6cf74e300690f95d9a9d21ba69f220e605e954a634931`

## Cross-agent status, unresolved certification, next audit

The fetched Agent B backend remains at `19c359ec`; Agent A scoring at `7178e262`, Agent C Product at `d72eaced`, `main` at `51df1d85`, and PR #17's proposed scoring branch `fix/accuracy-aggregation-bias-20261111` at `02bfe983`. No source edits or integration merges occurred. Agent C continues working on practice/UI; this cross-process result does not change any of its source contracts.

Outstanding product risks remain: the independently reproduced same-game cache/profile races, mislocalized/unsupported LLM prose that can reach real SSE and cache, and incomplete model-completion screening; the sealed human-adjudicated holdout, full-browser logout/cancellation, production-equivalent reference Stockfish run, distributed reverse-proxy behavior and representative load measurements remain untested.

**Next highest-value evidence:** a real browser-level logout/navigation and review abort test (in a disposable browser profile), or evaluate a corrected backend commit if Agent B publishes one. The distinction between browser SSE cancellation and a previously admitted server request is essential: the former may terminate the latter before final write, but must be observed, not assumed. No release approval or broad security certification is granted by this scoped experiment.

**Decision:** The cross-process revocation and the negative control are independently verified; integration and release remain **unapproved**.
