# Patzer Platform Backend — Agent Handoff (2026-11-10)

## Scope and isolation

- Repository: `MousaXD/patzer`
- Branch: `agent/platform-backend-20261110`
- Starting commit: `c8d9e1e00609c30779a3e86542f25f9454e1e911`
- Changes are restricted to the assigned API, history-import, MCP, platform-specific helper/test files and this handoff.
- **Unchanged:** `server/src/autoImport.ts` (latest 20 Chess.com games every 15 minutes), `analyze.ts`, `stockfish.ts`, database schema/migrations, authentication, frontend and package configurations.
- No live service, private database, key, session secret, MCP credential or local private config was accessed. No historical import was executed. No analysis jobs were enqueued.
- Repository was unavailable at the supplied local filesystem path. Implementation was committed directly to the isolated GitHub branch through the connected GitHub API; no mainline merge, rebase or deployment was performed.

## Audit findings

1. **Unsafe page limit (high):** `GET /api/games?limit=-1` reached SQLite `LIMIT -1`, allowing an uncapped response; NaN and fractional limits could cause server errors. The endpoint had no offset-based pagination.
2. **Limited listing controls (medium):** Only `q` and `bookmarked` filters existed. No server filters for time class, source, result or current-version analysis; sort could not be changed. Search treated `%` and `_` as SQL wildcards.
3. **Invalid game IDs (medium):** Non-numeric or unsafe IDs were passed to prepared statements, potentially producing 500s rather than predictable 400s.
4. **Insights coverage ambiguity (medium):** The v2 Insights endpoint reported all-game totals and average analyzed accuracy together without an analyzed sample count for each grouping. It also lacked an explicit count of position-eligible games.
5. **Malformed analysis caches (medium):** A single corrupt `moves_json` or `phase_split_json` could make an entire Insights endpoint fail or poison aggregates with non-finite results.
6. **Historical archive trust (medium):** Imported archive URLs were host- and path-shape-checked but not tied to the requested Chess.com username or valid month. Duplicate archive URLs could cause redundant fetches. An out-of-range timestamp could abort a whole monthly transaction.
7. **MCP operational robustness (low/medium):** Repeated local test clicks could spawn concurrent MCP processes; subprocess stderr was not drained, and the `exit` event could race the last stdout chunk. Status queried service properties sequentially and did not recognize the bracketed IPv6 loopback form.
8. **Index constraints:** The existing `idx_games_user(user_id, end_time DESC)` supports user-scoped listing but SQLite can still need a temporary sort for the `id` tie-breaker. The schema must not be changed by this agent.

## Implemented changes

### Game list and ownership

Files: `server/src/routes/games.ts`, `server/src/routes/platformQueries.ts`.

- Added strict integer input parsing: `limit` defaults to 50 and caps at 200; `offset` defaults to 0 and caps at 1,000,000. Negative, zero, fractional and non-numeric limits return `400 { "error": "invalid_input" }`; unsupported filters are rejected.
- Added `offset`, `sort=newest|oldest`, `source=chesscom|lichess|played|imported|pvp`, `time_class=bullet|blitz|rapid|daily`, `result=win|draw|loss` and `analyzed=0|1` filters. `analyzed` follows the **current** scoring version, including stale-analysis detection.
- Preserved `games` and `total` response fields. Added `limit`, `offset` and `has_more`, all additive.
- Replaced wildcard substring search with literal `instr(LOWER(...), ?)` predicates for the user-scoped scan. Search length is capped at 120 code units. SQL values remain bound; ORDER BY is selected from two fixed SQL constants.
- Kept stable `end_time, id` ordering and `NULLS LAST` behavior. The unfiltered count now uses the existing user index without joining analyses; analyzed-filtered counts join only when needed.
- Game get/delete/bookmark/notes routes now validate positive safe integer IDs, returning `400 invalid_input` rather than SQL binder failures. Existing per-user owner checks are preserved.

### Insights

Files: `server/src/routes/insights.ts`, `insightsV2.ts`, `analysisData.ts`.

- Added a defensive decoder for cached analyzed moves and phase splits. Malformed legacy JSON no longer crashes the endpoint; invalid moves are ignored for move-quality statistics.
- Added `games_eligible` to v2: all owned games excluding those played from a starting FEN.
- Added `analyzed_games` to each `time_class_stats` grouping and each `opening_repertoire` entry. This is the current-scoring-version analysis sample size, distinct from all-game `games` / `played`. `avg_accuracy` remains null when not measurable.
- Retained existing uncapped all-game aggregates, current-version analysis rules, the last-50-point accuracy trend, and the 10 brilliant-move display cap.

### Chess.com history

File: `server/src/chess/chesscomHistory.ts`.

- Validates each archive's HTTPS origin, expected username, year/month structure, month range, and absence of user-info, query and fragment components. Invalid URLs fail *before* fetching any month.
- Deduplicates repeated month URLs while preserving first-seen order.
- Skips corrupt PGNs, non-string player names and invalid/out-of-range timestamps rather than failing other valid games in the month.
- Recognizes additional transient 408/425, abort/timeout and DNS/network failures using the existing bounded exponential retry policy. Existing checkpoint callback and transaction-per-month semantics are preserved.
- No full-history run or production import was performed.

### MCP

Files: `server/src/mcp/tunnel.ts`, `server/src/routes/mcp.ts`.

- Local MCP connection test is single-flight per process and drains subprocess stderr without logging it.
- Subprocess completion now waits for stdio close, avoiding false failures when stdout arrives after process exit.
- MCP status runs independent systemd property queries concurrently; IPv6 loopback availability matches the route allowlist.
- MCP status and local-test endpoints return sanitized, stable responses for unexpected failures. Admin-only and localhost-only route checks remain enforced. Tunnel key handling was not changed.

## API compatibility and behavior

| Endpoint | Change |
| --- | --- |
| `GET /api/games` | Additive pagination metadata and structured filters; invalid query fields now produce HTTP 400. Large positive `limit` is capped at 200. |
| `GET /api/games/:id` and `PATCH/DELETE` game endpoints | Invalid/non-integer IDs now return HTTP 400; other users' IDs remain 404. |
| `GET /api/insights/v2` | Additive `games_eligible`, `time_class_stats.*.analyzed_games` and `opening_repertoire[].analyzed_games`. |
| `GET /api/insights` | Existing response contract retained; malformed move caches are ignored instead of causing 500. |
| `GET /api/admin/mcp/status` | Unexpected controller failure returns sanitized HTTP 503 `mcp_status_unavailable`. |
| `POST /api/admin/mcp/test-local` | Unexpected error returns a generic `{ ok:false, message }`; the existing response shape is retained. |

Clients currently consuming `games` and `total` require no changes. For actual page traversal, pass `offset` and check `has_more`. Percent/underscore characters in `q` now match literally rather than using wildcard semantics.

## Test evidence

### Automated tests added (not executed in this runtime)

- `server/test/platform-backend.test.ts`: **1,200** synthetic owned games plus **55** games for a second user in an isolated temporary test database. Covers first, last, empty and oldest-sorted pages, 200-row cap, invalid and non-finite query values, structured filters, stale-vs-current analysis, literal percent search, 401/404 ownership boundaries, and Insights coverage.
- `server/test/chesscom-history.test.ts`: added cross-account/query/invalid-month archive rejection, archive deduplication, invalid date isolation, and transient HTTP/timeout retry cases.
- New pure decoder test cases verify invalid cached move JSON and phase JSON are handled without throwing.

**Environment limitation:** The named local checkout and npm dependencies were not present, and container Git/network access was unavailable. Therefore `npm run typecheck`, Vitest, build and end-to-end API checks were **not run**. These test cases are committed but **not yet CI-verified**. GitHub CI is configured on pushes to `main` and pull requests targeting `main`, not ordinary pushes to this isolated branch; no workflow or PR was created under the branch restrictions. Do not mark this branch release-certified until the tests and CI pass.

### Executed isolated SQL fixture checks (2026-11-10)

Using Python's local `sqlite3` and an **in-memory** schema-shaped fixture, not Patzer's production DB, populated **10,000** synthetic games for user A, **500** for user B, with mixed current/stale/missing analyses and the existing `idx_games_user(user_id, end_time DESC)` pattern:

- Verified user scoping: 10,000 vs 500; filtered current-analysis count: 833; stale/missing analysis count: 7,500; literal percent note search count: 1.
- Measured 20 query repetitions, medians on this container only:
  - 50-game first page: **0.043 ms**.
  - Offset 1,000: **0.361 ms**.
  - Offset 9,000: **2.888 ms**.
  - Total count with an unnecessary analyses join: **1.771 ms**.
  - Same total count without the join: **0.259 ms** (about **6.8×** faster in this synthetic fixture).
- `EXPLAIN QUERY PLAN` showed an indexed `user_id` lookup and a temporary B-tree for the final order tie-breaker. These are **SQL microbenchmarks only**, not API latencies or Patzer production performance numbers.

## Security and operational considerations

- No direct SQL interpolation of untrusted filter or sort values.
- All returned and mutated game data remains user-scoped. MCP credentials, runtime keys and passwords never enter probe/status responses or logs.
- URL validation is applied before monthly archive fetches, and imports preserve existing unique keys and transaction boundaries.
- The MCP connection test remains restricted to the existing admin/localhost control plane; new single-flight behavior does not add remote control endpoints.

## Outstanding work and release gate

1. Run `npm ci`, `npm run typecheck`, `npm test -- --run server/test/platform-backend.test.ts server/test/chesscom-history.test.ts server/test/insights-full-history.test.ts server/test/mcp-connection.test.ts`, and `npm run build` in a permitted isolated checkout or CI. Do not run import jobs or touch production.
2. Independently verify full-server API behavior and response timing with ≥10,000 test games; this was not possible here because npm dependencies and a checkout were unavailable.
3. Evaluate a covering `(user_id, end_time DESC, id DESC)` index in a separate schema-authorized change if deep paging grows slow. Do not add it silently.
4. The Insights v2 taxonomy still parses every valid analyzed game's move JSON per request. An aggregate cache/snapshot could help at very high analysis counts, but requires a separately owned design.
5. The historical importer has a caller-managed `alreadyCompleted` checkpoint and `onMonth` hook. Reconstructing a durable checkpoint or resuming a running import was intentionally not performed because that would require schema or external workflow changes.
6. MCP live-health behavior is deliberately untested against the real local systemd/tunnel installation; verify with a dedicated isolated integration harness. Never point regression tests at the live Patzer installation.

**Certification: implementation committed and pushed to the isolated branch; full TypeScript, Vitest and CI verification pending.**
