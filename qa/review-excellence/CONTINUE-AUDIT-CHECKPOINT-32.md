# Agent D — Checkpoint 32: cached reports outlive the game PGN they describe

**Assigned lane:** Independent Game Review QA and adversarial benchmarks. **QA-only branch:** `agent/review-benchmark-20261111`. **Previous verified HEAD:** `5566180bd6196880a64f6a3cc71938b13769f7d7`. **Read-only Agent B candidate:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`. Other agents A/C, `main`, and PR #17 were fetched read-only and had not moved. There are **no product source edits**, migrations, deployed routes, production database calls or credentials in this checkpoint.

## Confirmed backend product defect — cached Game Review GET does not bind its source PGN

This is **separate from the previously established reanalysis/scoring-version stale cache**. Agent B's production `server/src/coach/reviewCache.ts` uses an SQLite compare-and-swap for a **new asynchronous write**, including `game.pgn IS ?` and `game.user_color IS ?`. That correctly prevents an *in-flight generator* from writing to a game whose PGN or perspective changed. However the authenticated `GET /api/games/:id/review` handler in `server/src/routes/review.ts` selects only `user_color` for access checking and `prose_json`, `prose_version`, `prose_lang`, `prose_audience`, `scoring_version` from `analyses`. It cannot compare cached prose with the game's actual current PGN, even though `server/src/ws/play.ts` persists PGN updates using `UPDATE games SET white_time_ms = ?, black_time_ms = ?, last_move_at = ?, pgn = ? WHERE external_id = ?` during PvP play.

### Actual product route reproduced in an isolated SQLite database

`scripts/review-benchmark-coach-pgn-read-race.mjs` imports **Agent B's real** `db.ts`, `auth/sessions.ts`, `buildGameReview`, `saveReviewIfFresh`, `routes/review.ts` and `routes/games.ts`. It creates two isolated synthetic accounts, signs throwaway sessions, and writes one synthetic PvP game to a unique throwaway SQLite database. It creates an authentic fallback (no-model) `buildGameReview` report on the self-authored **Fool's Mate**, where **Black wins**, and stores that report using the production compare-and-swap. The owner initially receives the correct cached prose; unauthenticated and another user's requests are correctly rejected (`401`/`404`).

It then executes the **exact production-equivalent PvP PGN persistence SQL**, but only against the disposable source, replacing Black's checkmate with a *different*, fully legally replayed synthetic **White checkmate** (`e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#`). After this source change:

| Endpoint / condition | Observed pinned product response | Safe behavior needed |
| --- | --- | --- |
| Owner `GET /api/games/1` | Returns **changed game PGN** but the **old analysis** (16% White accuracy) | Source-vs-analysis invalidation, or explicit stale flag and reanalysis |
| Owner `GET /api/games/1/review` | `200` returns the **original report** with **no `stale` flag** | Cached prose must not be presented as current without matching game-source identity |
| Same GET with matching `accuracy_model_version` marker added to original report | **Still returns the old marked report** | A scoring marker alone cannot establish PGN or perspective freshness |
| Same GET after a **controlled** `user_color` flip | **Still returns the old marked report** | Written report perspective should match the current game record; this mutation is a test, not a claim an endpoint flips color |
| An attempted old-source `saveReviewIfFresh` **after** PGN or perspective changed | Correctly **rejected** | Existing race CAS must remain intact |
| Owner changed only notes and bookmark | Cache **correctly retained** | Avoid false invalidation on unrelated metadata |
| Profile language, audience or scoring-version marker mismatch | Cache **correctly rejected** with `stale:true` | Preserve existing invalidation checks |
| Original PGN restored, matching marker present | Original report **correctly readable** | Allow matching source, do not invalidate every review unconditionally |
| `prose_json` cleared | No review returned | Preserve null-cache safety |

The old fallback report describes the old analysis data, and the new game is provably not the same game. **This test does not claim every live game is analyzed before its next move:** it establishes the real read-path source-freshness failure for a valid game-source mutation with a cached report present. Notes/marking and color changes are deliberately controlled to separate read invalidation from harmless updates and speculative product use cases.

## Verifier and fail-closed negative controls

`scripts/review-benchmark-coach-pgn-read-proof.mjs` independently reads the pinned product source digests, replays **both PGNs with `chess.js`**, verifies their **opposite checkmate winners**, and checks the actual **HTTP status and JSON response bodies** (including complete cached review objects) rather than trusting only flags printed by the runner. It also checks that owner isolation, score-marker, language, audience, null-cache and CAS positive controls remain valid. It never imports the owner route or a QA source adapter.

`scripts/review-benchmark-coach-pgn-read-negatives.mjs` rejects **71/71** deliberate evidence forgeries, including faking a source-invalidating `stale:true` response, hiding the old report, substituting same-game PGN, suppressing the matching score marker, pretending the game detail has changed analysis, inventing a cross-user read, denying a legitimate metadata cache hit, and declaring `release_approved:true`. A balanced false-green mutation that swaps the invalidation outcome and scoring-marker control also fails.

`scripts/review-benchmark-coach-pgn-read-boundary.mjs` runs the actual route experiment in a **fresh Node process**, binds its cryptographically unique run UUID to both the runner's stdout and the ignored raw per-request HTTP evidence, and tests a forged repaired GET response that must **not** pass the independent proof. The full output and source snapshots are recorded in `certification-summary-checkpoint32.json`; raw HTTP JSON is ignored under `qa/review-excellence/results/` and contains **only synthetic content** (never auth cookie tokens).

```sh
node scripts/review-benchmark-coach-pgn-read-boundary.mjs
node scripts/review-benchmark-coach-pgn-read-negatives.mjs
node scripts/review-benchmark-coach-pgn-read-proof.mjs
```

## Owner recommendations (NOT implemented by Agent D)

1. Agent B: explicitly bind each stored `analyses` row to the game PGN identity (and its `user_color` when user-facing scoring/perspective changes matter), invalidating or reanalyzing on source changes. A version marker inside the **prose** alone is insufficient if the underlying analysis remains incorrectly attached to a changed game.
2. Agent B: persist the generated prose's **source identity** (hash or equivalent atomic source snapshot), and require it to match **at read time** in addition to the existing language/audience/scoring checks. For legacy unmarked entries, fail closed or implement an approved migration/backfill; do not silently label them fresh.
3. Agent C: ensure the frontend does not retain an already mounted report after receiving a game/analysis-source change or a `stale:true` server response. The client has an existing source/score freshness contract which should be tested against the new server semantics.
4. Agent A / PR #17: coordinate scoring-version transitions so new source hashes and accuracy-model markers are updated atomically with game analysis and reports. **Do not implement a competing accuracy correction.**

**Scope:** One self-authored Fool's Mate and one self-authored alternate White checkmate, two throwaway users, SQLite WAL in an ignored and deleted scratch directory, production-equivalent PvP SQL but **no live websocket session**, no real third-party games, no hosted model, no new Stockfish jobs, no production users/credentials, no deployment. A clean result is **evidence of the product defect**, not a release pass. **Product cache correctness, full integration and release certification remain BLOCKED.**

**Exact next session action:** Fetch Agent A/B/C/PR17 heads read-only. If an owner branch has moved, pin a fresh detached candidate and rerun the real authenticated PGN-source read experiment and browser cache controls; do not update source SHA expectations without reviewing source changes. Otherwise audit another genuine read/write mismatch in report/analysis user-visible state, with fresh independent controls and bounded scope. **Never merge or push to main.**
