# Chess Backend Agent Handoff — 2026-11-10

**Owner:** Staff Backend / Analysis Agent  
**Branch:** `agent/chess-backend-20261110`  
**Baseline:** `c8d9e1e`  
**Status:** Implemented on GitHub; CI evidence is recorded below as available. **Do not merge until the required checks pass.**

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

**GitHub Actions verification on code commit `098648d54c18c982207061b4a868766929368741`:** [CI run #42846349912](https://github.com/MousaXD/patzer/actions/runs/42846349912) reported successful Node 20 and Node 22 typechecks, complete unit suites, and production builds. The Node 22 log confirms **62 passing test files**, including all **6 fake-UCI lifecycle** and **4 engine-admission/cache** regression tests; the existing classifier and variation-scoring tests also passed. The CI Docker image build/boot smoke test passed. [Independent frontend QA run #42846349945](https://github.com/MousaXD/patzer/actions/runs/42846349945) passed. The long browser reconnect/resume job in the primary CI workflow was still running when this evidence snapshot was recorded. A handoff-document-only commit follows the verified code commit and does not change runtime or tests.

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
2. `variationScoring.ts` already has a 30-second timeout and cleanup, but does not receive the HTTP abort signal. This can hold a slot until its bounded scoring timeout after a browser navigation; expanding its signature would require ownership coordination.
3. `ChessApiEngine` in `engine.ts` still performs one fixed 1-second retry before falling back, and its remote fetch is not connected to the HTTP abort signal. Scope is reserved for another owner or approved follow-up.
4. No persistent position cache or cross-process scheduler was added: ephemeral entries vanish on restart, and separate server worker processes have independent admission budgets.
5. Large imported annotated PGNs above the safety caps now return explicit errors, rather than initiating potentially unbounded analysis. Limits may need a user-facing explanation or tested streaming PGN import path.
6. Measured Stockfish depth-16/22 throughput, high-traffic fairness, and Windows fake-process test parity remain to be verified in CI/on a controlled test machine.
