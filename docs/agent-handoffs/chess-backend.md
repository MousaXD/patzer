# Chess Backend Agent Handoff — 2026-11-10

## 2026-11-11 follow-up: forced-move phase aggregation consistency

**Status: locally verified, pending exact-HEAD GitHub workflow conclusions at this commit.** This continuation builds on the previously fully green `3abff5c7b448a360e9086e230dc6122d19c55353` and does not rerun the completed Stockfish/cancellation/phase-boundary audit.

- **Reproduced defect:** Full-game scoring intentionally excludes both `book` and `forced` classifications from accuracy and ACPL. `computePhaseSplit()` excluded only `book`, so opening/middlegame/endgame accuracy and ACPL could penalize unavoidable forced replies. A real, legal six-ply FEN-started rook endgame with two forced Black king responses reproduced endgame Black ACPL **153 (incorrect) versus 160 (expected)** with a failing test before the fix.
- **Fix:** In `server/src/routes/analyze.ts`, phase aggregation now applies the identical `book || forced` exclusion for both its accuracy points and ACPL contributions. The existing phase and game response shapes are unchanged. `server/test/analysis-agent-pgn-lifecycle.test.ts` adds the failing-before/passing-after endgame regression.
- **Local validation:** `npm test -- --run server/test/analysis-agent-pgn-lifecycle.test.ts server/test/classifier.test.ts server/test/variation-scoring.test.ts` **57/57 PASS (3 files)**; `npm run typecheck` **PASS**; `npm test` **598/598 PASS (63 files)**; `npm run build` **PASS**; `git diff --check` **PASS**. Node `v22.23.2` and the isolated backend-polish checkout were used. No production data, merges, or deployments.
- **Cross-lane check:** Read-only fetch and changed-file comparison of the other three agent branches found no overlap with this branch's changes at inspection time. No files on those branches were modified.
- **Cache caveat / coordinator action:** Existing stored analyses with the same `SCORING_VERSION` will not be silently reanalyzed by this fix; affected saved games require an explicit `force: true` reanalysis to update their stored phase metrics. Do **not** assume historical phase statistics were backfilled. Any wider scoring-version/migration decision belongs to Agent 00 to coordinate.
- **Remaining gate:** Keep PR #12 draft; exact-final-head Node 20/22, regression/browser and Docker GitHub workflows must be read before marking this follow-up certified. Prior green Actions apply to `3abff5c...`, not the new revision.


## Final continuation: custom-FEN phase scoring regressions (2026-11-10)

**Scope:** Continued only the chess-backend lane from the previously green exact-head revision `1a16d848f120ce29e1b8a52bbf8eccaf19fa8927`. This is not a repeat of the engine lifecycle/CI audit. The three other agent branches were fetched for read-only changed-path comparison; none overlapped `server/src/routes/analyze.ts`, the analysis-agent tests, or this handoff at inspection time. No merge, deployment, real database or production service was involved.

**Two defects reproduced with initially failing regression tests and fixed:**

1. **Incorrect player attribution in Black-first FEN games.** `computePhaseSplit()` inferred White/Black from `m.ply % 2`, although saved PGNs can start with Black to move. The main move scorer already had the correct side. Phase accuracy and ACPL now use the actual turn encoded in each analyzed move's `fen_before`. A five-ply off-book FEN-started game regression compares per-color phase ACPL with the scores attributed to actual movers.
2. **Overlapping phases for endgame-started games.** The fallback first-12-plies opening boundary could overlap an endgame already present in a custom starting FEN, assigning the same moves to opening and endgame. The effective opening boundary now ends before `endgameFrom`, so the phases partition the move sequence. A six-ply rook endgame PGN regression verifies `opening: null`, `middlegame: null`, and `endgame: 1–6`.

**Modified:** `server/src/routes/analyze.ts` and `server/test/analysis-agent-pgn-lifecycle.test.ts`; handoff documentation only otherwise. No response fields, saved schema, service options, engine scheduling, game database queries or frontend components changed.

**Local validation (Node `v22.23.2`):** `npm test -- --run server/test/analysis-agent-pgn-lifecycle.test.ts server/test/classifier.test.ts` **PASS 41/41**; the broader scoped targeted run including variation scoring **PASS 56/56** before the final test mock typing correction; `npm run typecheck` **PASS** on the final changes; `npm test` **PASS 597/597** across 63 test files; `npm run build` **PASS** for both web/server. The earlier certified real-browser, Docker, and e2e suites were not repeated on the source changes here; obtain exact-head GitHub workflow conclusions for those checks. No throughput benchmark was performed.

**Coordinator:** Keep PR #12 draft and unmerged. The source is locally validated; check the new exact-head CI and independent Chromium QA after this handoff commit. Agent 00 owns integrating the other agents' improvements and any cross-lane API behavior. No other branches were written to.


## 2026-11-10 exact-HEAD GitHub CI follow-up — source `88c364007901c5dba6c274f2e9ee5db2eb625eb8`

**Continuing the completed improvement sprint without reopening its audit.** GitHub runners resumed and executed the source+handoff revision `1c8bc127549e9a803edb9f1268b291f3f740fd64`. [CI #42883721861](https://github.com/MousaXD/patzer/actions/runs/42883721861) failed the **Node 20 and Node 22 typecheck jobs**; the E2E/browser regression and Docker image build/boot jobs **passed**. [Independent Chromium QA #42883722075](https://github.com/MousaXD/patzer/actions/runs/42883722075) failed at the same preliminary TypeScript gate. None of these failures demonstrated a runtime regression.

- **Proven failure:** `server/test/analysis-agent-pgn-lifecycle.test.ts:108`, `TS2493: Tuple type '[]' of length '0' has no element at index '0'`. A fake engine's `vi.fn(async () => ...)` incorrectly inferred zero parameters, but the FEN-start regression inspects `evaluateMulti.mock.calls[0]?.[0]`. The original local `npm run typecheck` ran before that last regression was added, so the original evidence was insufficient to certify that source revision.
- **Owned-only minimal correction:** The fake `evaluateMulti` mock now explicitly declares its real `(fen: string, depth: number, n: number)` parameters. This changes only test typings and does not change runtime code, game behavior, API contracts, or cross-agent files.
- **Corrected local certification on Node `v22.23.2`:** `npm run typecheck` **PASS**; the targeted Stockfish+PGN lifecycle regressions **18/18 PASS**; `npm test` **595/595 PASS** across **63 files**; `npm run build` (server + web) **PASS**; `git diff --check` PASS. The full real-server/browser and Docker suites had already passed on the identical production source `d6f788d...`, and both relevant GitHub-hosted regression/Docker jobs also passed on `1c8bc12...`. Repeating those successful runtime checks was unnecessary for a test-type-only correction.
- **Gate:** Keep [draft PR #12](https://github.com/MousaXD/patzer/pull/12) unmerged and undeployed. Require exact-new-head CI/QA conclusions or a coordinator-approved exception. Earlier runner queueing is no longer a categorical blocker: the previous runs executed. No throughput benchmark was run.


## 2026-11-10 independent improvement sprint — locally certified source `d6f788dadbae371cdc10e0e1a117203e819f13db`

**Verdict: READY FOR COORDINATOR REVIEW on local evidence; GitHub-hosted checks are still a separate outstanding gate.** This is a targeted follow-up on the already completed backend work, not a redesign. No source/API success contract was removed. PR #12 must remain draft and unmerged until Agent 00 decides integration/release gates.

### Proven defects and limited fixes

1. **Concurrent control commands / UCI searches** (`server/src/chess/stockfish.ts`): A `newGame()` or `setOption()` call could start an asynchronous UCI write, yield, and then allow a new `evaluate()` or `bestMove()` to acquire the search guard before the control handshake completed. A regression first reproduced this command interleaving. Control operations (`newGame`, `setOption`, `name`) now acquire their own synchronous exclusive guard, checked alongside the existing search guard, and release it in `finally`. Sequential work is unaffected. A fake-UCI test verifies that concurrent calls fail fast with `engine_busy` and that the engine can subsequently evaluate successfully.
2. **Malformed optional UCI PV aborting an otherwise valid game review** (`server/src/routes/analyze.ts`): `chess.js` throws for an illegal best-move/PV entry. The previous unguarded full-game SAN conversion could reject the entire analysis even with a valid engine score. The route now drops an illegal best move to `null` and stops PV SAN replay at the first invalid continuation, without hiding a scoring or engine failure. A regression first failed with `Invalid move` and now passes.
3. **Late request cancellation after scoring but during engine teardown** (`server/src/routes/analyze.ts`): The request could abort while awaiting `engine.quit()` in the function's `finally`, after the final ply cancellation check, and the score could still resolve to the HTTP route for persistence. A regression reproduced this. The finalizer now rejects `analysis_cancelled` if the signal is aborted when shutdown completes. Previous cancellation behavior is preserved.
4. **Cross-agent Game Review dependency checked:** An additional regression verifies a `[SetUp "1"]` / FEN-start PGN where Black plays the first recorded move, including use of the true starting FEN. No source fix was necessary for this case.

**Changed files (source revision):** `server/src/chess/stockfish.ts`, `server/src/routes/analyze.ts`, `server/test/analysis-agent-stockfish.test.ts`, `server/test/analysis-agent-pgn-lifecycle.test.ts`. Only this handoff file is changed in the subsequent documentation commit. No frontend, gameplay, platform API, database, authentication, engine-provider or other agents' files were modified.

### Exact local verification (Node v22.23.2, npm 11.18.0)

- `npm ci --no-audit --no-fund`: PASS; locked dependencies installed in a separate fresh checkout, not another agent's assigned worktree.
- `npm run typecheck`: PASS.
- `npm test -- --run server/test/analysis-agent-work.test.ts server/test/analysis-agent-stockfish.test.ts server/test/analysis-agent-pgn-lifecycle.test.ts server/test/variation-scoring.test.ts server/test/classifier.test.ts`: PASS, **70/70** across five test files.
- `npm test`: PASS, **595/595** across 63 test files (run after all new tests).
- `npm run build`: PASS, server and web.
- Five repeated runs of the three analysis-agent work/Stockfish/PGN regression files: **25/25 PASS each time** (125 repeated assertions; no observed hangs or unhandled rejections).
- `npm run setup`: PASS; local Stockfish 17 installed in the disposable checkout. Playwright installed in an external prefix, Chromium available.
- `npm run test:e2e`, `npm run test:resume`, `npm run test:oidc`, `npm run test:ui`, `npm run test:resume-ui`: **all PASS**, run sequentially against scratch SQLite databases/local test ports.
- `PATZER_QA_ARTIFACTS=.local-validation/frontend-overhaul-exact-code GITHUB_SHA=d6f788dadbae371cdc10e0e1a117203e819f13db node qa/agent07/frontend-overhaul-smoke.mjs`: PASS, **35/35 checks, zero browser errors**, results tagged with the exact source commit.
- `docker build -t patzer-chess-backend-polish:20261110 .`: PASS; a temporary image was started only on `127.0.0.1:18900`, `/api/meta` returned OK and `/` returned HTTP 200; temporary test container removed. No image was published or deployed.

**Validation boundary:** GitHub Actions has been heavily queued across the four agent branches; local runs above are **not** GitHub-hosted green checks, and Node 20 parity was not independently run here. The previous baseline was `5a465051708683f4ec72d6b258f0de55cab43f7b`. This sprint's tests and browser QA certify source revision `d6f788d...`; the later handoff-only commit cannot alter its runtime behavior. No throughput or performance speedup was benchmarked.

### Coordination / ownership

- Compared paths changed from the shared `c8d9e1e` baseline across `agent/platform-backend-20261110`, `agent/product-ui-20261110`, and `agent/review-experience-20261110`. At the time of review, there were **no overlapping changed files** with this backend lane. The other branches were inspected read-only and never merged, checked out, modified or pushed.
- Product UI/review agents still own client cancellation, stale position navigation, and retry UX for `429 engine_busy`. Agent 00 must coordinate review cache-repair/`force: true` and SSE end-to-end integration, which were not added to this scoped unit regression set.
- Platform/backend owner still owns cross-workload CPU scheduling and cancellation/retry behavior in remote `ChessApiEngine`. No out-of-lane API or provider files were changed.
- No production databases, Patzer services, live tunnels, secrets, other agents' worktrees or deployed code were accessed. All test evidence lives under an untracked `.local-validation/` in the disposable checkout and was not committed.


## Local CI recovery and certification — 2026-11-10 (Node 22)

**Verdict: BLOCKED on GitHub-hosted exact-head CI, despite passing local verification.** The backend source revision verified locally was `40262d8e08a4598b21df58a31de53e600eae9286` (the source-code fix is `bf84272c7d61371ac61045ebf55a79d32921bbb0`; the subsequent commit only changed this handoff). This section is the only new change; no runtime sources, tests, API contracts, or other agent files were modified.

- **Environment and isolation:** The dedicated `/home/mousa/projects/my-creations/chess/patzer-agent-chess-backend` directory was visible on the machine but outside this session's permitted command roots, so its contents and local status were not modified or asserted. Used a separate freshly cloned checkout under `/home/mousa/projects/my-creations/game/.patzer-chess-backend-verification-20261110`, checked branch `agent/chess-backend-20261110`, clean baseline and exact remote SHA. This is independent of the dedicated agent worktree. All real-server test scripts used disposable SQLite databases and localhost; the Docker smoke bound only `127.0.0.1:18800`. No production service/database, existing worktree, merge or deployment was touched.
- **Dependencies:** `npm ci --no-audit --no-fund` PASS; Node `v22.23.2`, npm `11.18.0`. `npm run setup` PASS (Stockfish 17 installed in disposable checkout); Playwright was installed under a separate `/tmp` prefix and Chromium installed without changing project dependency manifests.
- **Typecheck:** `npm run typecheck` PASS (exit 0).
- **Targeted regression:** `npm test -- --run server/test/analysis-agent-work.test.ts server/test/analysis-agent-stockfish.test.ts server/test/analysis-agent-pgn-lifecycle.test.ts server/test/variation-scoring.test.ts server/test/classifier.test.ts` PASS; **5 files, 66 tests**.
- **Cancellation/subprocess repeatability:** The three analysis-agent work/Stockfish/PGN test files were rerun **five additional times**; all **21/21 tests passed on each repetition** (105/105 repeated assertions in aggregate). No observed hang or unhandled rejection in these runs.
- **Complete unit suite:** `npm test` PASS; **63 files, 591 tests**.
- **Production build:** `npm run build` PASS (server and web).
- **Local real-server regressions:** `npm run test:e2e`, `npm run test:resume`, `npm run test:oidc`, `npm run test:ui`, and `npm run test:resume-ui` each PASS (exit 0). These used scratch DBs and isolated browser processes.
- **Independent Chromium QA:** `PATZER_QA_ARTIFACTS=.verification-logs/frontend-overhaul GITHUB_SHA=40262d8e08a4598b21df58a31de53e600eae9286 node qa/agent07/frontend-overhaul-smoke.mjs` PASS; **35 checks passed, 0 failed, 0 browser errors**.
- **Docker image and boot smoke:** `docker build -t patzer-chess-backend-verification:20261110 .` PASS; temporary local-only container on `127.0.0.1:18800` responded to `/api/meta` and `/` with HTTP 200; container removed afterward. No image was pushed.
- **GitHub Actions status at final check:** [CI run #42864894730](https://github.com/MousaXD/patzer/actions/runs/42864894730) and [independent QA #42864894676](https://github.com/MousaXD/patzer/actions/runs/42864894676) were both **queued**, all five jobs without conclusions, at exact SHA `40262d8...`. No GitHub Actions success is claimed, and the cause of GitHub-hosted queueing is not established. Local Node 20 parity has not been separately run; CI still must certify it.
- **Release gate and dependencies:** Keep PR #12 in draft, unmerged and undeployed. Agent 00 must obtain exact-source GitHub Actions conclusions or explicitly accept the still-pending infrastructure exception before integration. Frontend ownership: stale-navigation cancellation and `429 engine_busy` retry UX. Platform/backend ownership: cross-workload scheduler and remote `ChessApiEngine` cancellation. No Stockfish throughput benchmark was taken.


**Owner:** Staff Backend / Analysis Agent  
**Branch:** `agent/chess-backend-20261110`  
**Baseline:** `c8d9e1e`  
**Status:** Continued implementation committed to the assigned branch; exact-head CI has not yet completed. **Keep draft; do not merge or deploy until exact-head checks pass and coordinator approves.**

## 2026-11-10 final CI follow-up — current code SHA `bf84272c7d61371ac61045ebf55a79d32921bbb0`

- Inspected the completed exact-head workflows on `c7bd46947d91a82acc1a4080dd8f91f36ea3b909`: [CI #42854314420](https://github.com/MousaXD/patzer/actions/runs/42854314420) and [Frontend Overhaul QA #42854314439](https://github.com/MousaXD/patzer/actions/runs/42854314439). Both **failed** on a shared TypeScript diagnostic at `server/src/routes/analyze.ts:285`: assigning a `() => void` abort cleanup callback to a variable incorrectly inferred as `() => undefined`. All affected workflow jobs were blocked at typecheck/build, not by a demonstrated runtime regression.
- Fixed the exact type mismatch in the owned route with explicit `let removeAbort: () => void = () => {};`, committed/pushed as `bf84272c7d61371ac61045ebf55a79d32921bbb0`; no other code or API changes in this commit.
- Exact code-commit verification runs: [CI #42863554257](https://github.com/MousaXD/patzer/actions/runs/42863554257) and [Frontend Overhaul QA #42863554271](https://github.com/MousaXD/patzer/actions/runs/42863554271). **Both still queued at last inspection. No latest-code CI success is claimed.**
- The last fully green branch state was `7b99cc97868894848aa45aee5f715080fcc389ff`, with [CI #42850910996](https://github.com/MousaXD/patzer/actions/runs/42850910996) and [QA #42850911140](https://github.com/MousaXD/patzer/actions/runs/42850911140) succeeding. The new variation abort feature and its associated tests came afterward, so they are not covered by those earlier passes.
- **Release gate:** Keep [draft PR #12](https://github.com/MousaXD/patzer/pull/12) unmerged and undeployed until at least the latest-code commit `bf84272...` has green Node 20/22 typecheck, tests/build, Docker smoke, browser regression, and independent QA, followed by Agent 00 integration review. A subsequent handoff-document-only commit does not change the code test target.
- Only original remote branch used; no local worktree present, production services, live database, other agents' files, main-branch writes, merges or deployments. Integration dependency remains frontend handling for `429 engine_busy`/stale requests and backend ownership of remote engine cancellation.

## Continuation — final implementation commit `bb93dbd93266d0dc8acdc4c27940dd700f32aa57`

**Working directory verification:** This session's shell was at `/`, not a Git repository; the assigned path `/home/mousa/projects/my-creations/chess/patzer-agent-chess-backend` did not exist in the container. The original GitHub branch `agent/chess-backend-20261110` was verified through the authenticated connector; changes were made **only on that exact remote branch**. No substitute checkout, reset, merge, rebase, cherry-pick or deployment was performed.

**Additional implemented work:**
- Stockfish `evaluate`, `evaluateMulti`, and `bestMove` now acquire one exclusive per-process UCI search guard *before* asynchronous writes. Other searches, `setOption`, `newGame`, and `name` fail fast with `engine_busy` while a search is active. This prevents the same `bestmove` response being consumed by multiple callers or score lines being attributed to the wrong position; the guard releases in `finally`.
- Starting a search on an unstarted/terminated Stockfish instance now rejects `engine_not_ready`. Delayed output from a previously stopped child is discarded when another child is running.
- Failed UCI handshake writes now tear down the session instead of leaving an orphaned readiness waiter.
- Added `server/test/analysis-agent-stockfish.test.ts` regressions for simultaneous `evaluate`/`evaluateMulti`/`bestMove`, option/new-game rejection during a search, subsequent clean sequential reuse, and post-quit searches. All use a disposable fake UCI executable.
- Added `server/test/analysis-agent-pgn-lifecycle.test.ts` to check oversized/invalid PGN rejection before engine creation, shutdown after startup/search failures, and pre-aborted requests. Database and config modules are mocked to avoid live data and secret files.

**API contract:** No new HTTP request fields, result fields or success-response changes. The `StockfishEngine` direct-call contract intentionally raises `engine_busy` instead of allowing concurrent use of the same process; callers must sequence searches or create separate admitted engines.

**Verification status (distinguish earlier from current):** CI run [#42846349912](https://github.com/MousaXD/patzer/actions/runs/42846349912) and independent QA run [#42846349945](https://github.com/MousaXD/patzer/actions/runs/42846349945) **passed** at the previous implementation SHA `098648d54c18c982207061b4a868766929368741`. The continuation's new source and test changes **were not included** in those checks. At handoff update, GitHub Actions had queued PR CI for the new commits; do not present the added concurrency/PGN tests as passed until the latest exact-HEAD run completes.

**Follow-up before integration:** Confirm latest `npm run typecheck`, `npm test`, `npm run build`, Docker smoke, and real-browser regressions in CI. Another agent owns the frontend and should handle stale navigation cancellation and `429 engine_busy` retry UX. Another backend agent owns gameplay/WebSocket scheduling and remote `ChessApiEngine` cancellation; coordinate those changes instead of editing out-of-scope files. All other ownership boundaries remain intact.

## Latest continuation — implementation commit `c2ab3b512c2c04a99bd32e4c5420620c9fdf8403`

- **Cancel abandoned exploratory moves:** `server/src/routes/analyze.ts` attaches the HTTP request signal to the engine created for variation scoring, shuts the engine down on abort, and removes the listener in `finally`. The variation scorer retains its existing normal `quit` and 30-second timeout. The existing `variationScoring.ts` was **not edited**, respecting the file boundary.
- **Prevent stale results:** avoid adding abandoned position/variation results to the 60-second cache. Full-PGN scoring checks for cancellation before opening/phase summaries and before returning, preventing late-aborted analyses from reaching the route's database save.
- **Cancellation helper:** `stopEngineOnAbort` provides idempotent abort-listener cleanup and safe handling for already-aborted requests and shutdown failures. Added three unit tests in `analysis-agent-work.test.ts`.
- **Additional PGN lifecycle regression:** proves that an abort triggered during the last ply still rejects `analyzePgnFull`, rather than returning a storable result.
- **API compatibility:** all successful payloads remain unchanged. Already-aborted variation requests return `503 { "error": "analysis_cancelled" }` and do not launch new Stockfish processes. Ordinary browser disconnects can interrupt local engine work sooner. The remote `ChessApiEngine` HTTP fetch still has its independent timeout because `engine.ts` is outside assigned ownership.
- **No production side effects:** all edits were GitHub contents commits directly to the existing remote branch. No local worktree was available, no Patzer service was touched, no live SQLite database was opened, no dependencies were installed, and no bulk analysis was started.
- **Verification evidence:** the historical full CI run on implementation `098648d54...` passed. The later UCI serialization, PGN-lifecycle, and cancellation changes through `c2ab3b512c2c04a99bd32e4c5420620c9fdf8403` **have no passing exact-head CI evidence yet**. GitHub Actions is queuing branch PR checks (including CI and independent frontend QA); these changes are **not certified**, and no benchmarks or test passes are claimed for them. Required: Node 20/22 typechecks, all Vitest tests, Docker smoke, browser regressions and source tests at the current implementation commit or an unchanged-doc-only descendant.

## Scope and changes

### UCI / Stockfish lifecycle (`server/src/chess/stockfish.ts`)

- Child exit, spawn error and broken stdin now reject startup, readiness, and in-flight search waits promptly rather than leaving hung promises.
- Subscribe to UCI reply handlers *before* sending commands to prevent fast replies from being lost.
- A search has a finite 120-second deadline; UCI handshakes and `isready` have 10-second deadlines. Timeouts stop/quit the child and terminate it after a bounded 500 ms grace period.
- `quit()` rejects outstanding waits immediately, is idempotent, and drains child stderr. Unterminated stdout is capped at 64 KiB, without killing healthy batches of short lines.
- `MultiPV` is reset after searches including failures when the engine remains usable. Rank-2+ scores are used for comparisons only if they come from the same completed depth as rank 1, avoiding false Great/Brilliant gaps.
- Reject newline-bearing option strings at the process boundary and discard malformed non-finite UCI scores.

### Ad-hoc positions, variations, and game analysis (`server/src/routes/analyze.ts`)

- A shared **two-engine** fail-fast admission budget limits simultaneous HTTP game/position/variation analysis jobs process-wide; there is no unbounded queue of stale board navigation requests.
- Retain existing one-in-flight-per-user rules, and return `429 { "error": "engine_busy" }` when the shared budget is exhausted. Clients should retry only the latest *still relevant* position, with a short backoff.
- Bounded **128-entry, 60-second** LRU caches for successful positions and exploratory variation scores. Cache keys include authenticated user, chosen backend, depth, MultiPV count or move/ply, and FEN. Failures are never cached; no SQLite records are written by the caches.
- Cancel HTTP full-game and position searches on request abort; release admission slots in a `finally` block.
- Engine shutdown now runs in `finally` even when PGN analysis, option configuration, evaluation or scoring fails.
- Reject PGNs exceeding 256,000 characters or 2,048 half-moves before launching Stockfish; reject malformed PGNs with `invalid_pgn`.
- Reject missing or non-finite evaluation scores for nonterminal positions rather than silently treating them as 0. Persist actual median completed search depth (capped by requested depth), not an assumed local-engine depth.
- Cap ad-hoc FEN input at 128 chars; defensively handle illegal/truncated engine PV move sequences; avoid exposing local process diagnostics to HTTP clients.

### Helper and regression tests

- `server/src/chess/analysisAgentWork.ts` — dependency-free admission and TTL/LRU logic.
- `server/test/analysis-agent-work.test.ts` — saturation, idempotent release, bounded cache, eviction, TTL semantics.
- `server/test/analysis-agent-stockfish.test.ts` — disposable executable fake UCI children; checks successful startup, score parsing, MultiPV depth filtering, crash on startup, crash in-flight, force-quit during stuck search, and UCI newline rejection. Both DB and config are mocked to avoid opening SQLite or writing Patzer's session-secret.

## API compatibility and frontend integration

**Success response shapes are unchanged** for `POST /api/analyze`, `POST /api/analyze/position`, and `POST /api/analyze/variation-move`. Existing function exports `analyzePgn` and `analyzePgnFull` are preserved; the latter adds an optional fourth `AbortSignal` argument.

Potentially observable differences:
- **New:** `429 engine_busy` under cross-user/system saturation; existing `429 already_analyzing` remains for per-user overlap.
- **New:** full game failures are controlled `503 analysis_failed`; too-large PGNs return `413 pgn_too_large`; invalid PGN returns `400 invalid_pgn`.
- **Changed:** position engine failures return generic `503 engine_error` without the previous diagnostic `detail` field.
- **Changed:** positions report the engine's actual completed depth, including depth 0 for terminal positions; stored analysis depth is conservative.
- No new required frontend request fields. To improve rapid navigation, cancel outdated fetches with `AbortController` and back off on 429 instead of retrying every queued FEN.

## Verification / performance

The supplied working-tree path `/home/mousa/projects/my-creations/chess/patzer-agent-chess-backend` is **not mounted** in the tool environment, and that environment cannot resolve github.com to clone. No local dependencies were installed, no existing Patzer service was touched, and no live database was opened. Source inspection and modifications were performed through the GitHub repository connector.

**GitHub Actions verification on code commit `098648d54c18c982207061b4a868766929368741`:** [CI run #42846349912](https://github.com/MousaXD/patzer/actions/runs/42846349912) reported successful Node 20 and Node 22 typechecks, complete unit suites, and production builds. The Node 22 log confirms **62 passing test files**, including all **6 fake-UCI lifecycle** and **4 engine-admission/cache** regression tests; the existing classifier and variation-scoring tests also passed. The CI Docker image build/boot smoke test passed. [Independent frontend QA run #42846349945](https://github.com/MousaXD/patzer/actions/runs/42846349945) passed. The primary CI workflow **finished successfully**, including PvP protocol, reconnect/resume, SSO integration, two-browser PvP, and browser resume acceptance; all four CI jobs passed. A handoff-document-only commit follows the verified code commit and does not change runtime or tests.

**Static claims, not measurements:** HTTP-triggered analysis has a hard bound of two simultaneous admitted jobs; successful ephemeral-result cache has a hard bound of 128 entries and a 60-second lifetime. This reduces worst-case engine work and repeated exact-FEN requests, but **no benchmark throughput or speedup is claimed**. Timing and memory benchmarks need a disposable CI or development environment.

Verification commands for CI/reviewer:
```sh
npm run typecheck
npm test -- --run server/test/analysis-agent-work.test.ts server/test/analysis-agent-stockfish.test.ts server/test/variation-scoring.test.ts server/test/classifier.test.ts
npm test
npm run build
```

## Remaining risks / follow-up

1. The system-wide admission budget applies to **HTTP analysis routes**, not bots, gameplay WebSocket requests or unrelated engines, which are outside this agent's file ownership. A cross-workstream scheduler would be required for a system-wide CPU guarantee.
2. The variation route now interrupts **local** Stockfish on HTTP abort using an engine-factory hook. `variationScoring.ts` still has its separate 30-second timeout, and remote chess-api fetches may hold a slot until their HTTP timeout; upstream abort support inside `engine.ts` remains a coordinated follow-up outside our ownership.
3. `ChessApiEngine` in `engine.ts` still performs one fixed 1-second retry before falling back, and its remote fetch is not connected to the HTTP abort signal. Scope is reserved for another owner or approved follow-up.
4. No persistent position cache or cross-process scheduler was added: ephemeral entries vanish on restart, and separate server worker processes have independent admission budgets.
5. Large imported annotated PGNs above the safety caps now return explicit errors, rather than initiating potentially unbounded analysis. Limits may need a user-facing explanation or tested streaming PGN import path.
6. Measured Stockfish depth-16/22 throughput, high-traffic fairness, and Windows fake-process test parity remain to be verified in CI/on a controlled test machine.
