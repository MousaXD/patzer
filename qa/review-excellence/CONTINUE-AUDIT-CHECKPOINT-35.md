# Agent D — Checkpoint 35: a NEW report can be generated from the wrong game's old engine analysis

**Owner:** Independent Game Review QA, benchmark and release-adversarial tests. **Own branch:** `agent/review-benchmark-20261111`. **Previous pushed SHA:** `7e569cd2e93147e20e210fa9806d179e0344fed3`. **Read-only Agent B candidate:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`. Other Agent A/C, `main` and PR #17 were fetched read-only and did not move. **Only Agent D-owned QA scripts and evidence changed.** No running app, service, customer, production database, updater, owner branch, `main` or accuracy code was touched.

## Reproduced — a **source mismatch already present at admission** bypasses the existing write CAS

Checkpoints 32–34 found a stale cached **GET**, a mounted frontend stale report on same-game refetch, and an obsolete **in-flight** generation request. Checkpoint 34 also verified an important **backend safety guard**: `saveReviewIfFresh()` correctly rejects a report whose PGN/engine analysis changed **during** generation. This checkpoint addresses a different failure mode **before generation starts**.

The real authenticated `POST /api/analyze` handler in pinned Agent B `server/src/routes/analyze.ts` treats an analysis as fresh when its stored `depth >= requested depth` and `scoring_version >= SCORING_VERSION`. It **never binds that cache hit to the current `games.pgn`**. A PvP move can change the game PGN (the production equivalent SQL is in `server/src/ws/play.ts`) without changing the stored `analyses` row. A new `POST /api/games/:id/review` then takes **the current game PGN** but **the old cached analysis** and builds a logically inconsistent report. Since neither the game nor analysis changes *during the request*, the existing `saveReviewIfFresh` compare-and-swap **succeeds**. The SSE emits **`done`**, the contradictory report is persisted, and a subsequent authenticated GET returns it as fresh.

This is **not** a failure of the in-flight CAS. The CAS verifies the snapshot is unchanged **from admission to write**, not that `analysis.moves` correspond to `game.pgn` at admission. This source-provenance distinction must survive remediation.

## Actual Hono and SQLite reproduction (zero external LLM calls)

`scripts/review-benchmark-coach-admission-source.mjs` uses the real Agent B `routes/analyze.ts`, `routes/review.ts`, `routes/games.ts`, `analyzePgn`, `saveAnalysis`, auth/sessions and SQLite schema against a **fresh disposable database**. It creates two synthetic QA users (real owner session and isolated non-owner), three synthetic game rows and **two bounded Stockfish 16 depth-8 single-thread analyses**: Fool's Mate and Scholar's Mate. Both PGNs are self-authored and strictly legal:

| Source game | Actual legal ending | Source plies | Distinct key moment |
| --- | --- | ---: | --- |
| Fool's Mate | **Black checkmates** (`f3 e5 g4 Qh4#`) | **4** | White's `g4` at ply 3 |
| Scholar's Mate | **White checkmates** (`e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#`) | **7** | Black's `Nf6` at ply 6 |

**Positive controls:** Matching Fool's Mate source and analysis respond `cached:true` and generate their own four-ply report. Matching Scholar's Mate source and analysis respond `cached:true` and generate their own seven-ply report. All real owner `POST /review` streams emit `done`, a matching GET returns the stored report, and real auth blocks anonymous requests (`401`) and another user's requests (`404`).

**Source-admission attack:** A third game initially has Fool's Mate PGN and the genuine four-ply engine analysis. The test then updates **only `games.pgn`** to Scholar's Mate and `games.result` to win in **throwaway** SQLite, leaving the analysis row untouched, exactly the source/analysis mismatch that an incremental PvP update can create. The actual `POST /api/analyze` for the updated game responds `200 {cached:true}` with the **old four moves** and old evaluation, not the current seven-move game. The actual `POST /api/games/:id/review` now emits **successful `done`**, with an old-game `g4` key moment and a four-ply opening report; the current game has `Qh5` on its *third* ply and **no `g4` at all**. The backend saves and serves that newly generated but source-inconsistent report, with `prose_lang=en`, `prose_audience=beginner` and current `scoring_version=9`. The observed fallback accuracy was **31.8%** for the old game versus **100.0%** for the separately analyzed new game on this bounded test; these example scores are **not** a claim about a statistically meaningful accuracy distribution.

**Negative control:** The QA-only switch `--fault=correct-source-analysis-before-review` calls **the owner's real `saveAnalysis()`** with the already computed seven-ply analysis immediately before creating the review. With the identical current game PGN, the new report now correctly draws its key moment from `Nf6` rather than `g4`, and the source-mismatch benchmark exits **1**, as it must when the defect is removed. No owner code or candidate data is modified by the fault; it is a controlled change to the *disposable test database*.

## Independent evidence and adversarial controls

`scripts/review-benchmark-coach-admission-proof.mjs` does **not** import the product analyzer, review-builder, router or CAS. It separately checks pinned Agent B source-file SHA256 and Stockfish SHA256, replays both self-authored PGNs using `chess.js`, independently verifies checkmates, SAN, UCI and per-ply FEN **before/after** positions, and checks real HTTP status codes, source/cache analysis contents, and the **original raw SSE bytes** (SHA256 integrity, independent event framing, `progress` and `done` payloads), persisted prose JSON and owner isolation. The checker requires that the old `g4` evidence is **valid only for the four-ply PGN** and invalid for the seven-ply current game. The corrected-source control is required to produce the new game's actual seven-ply analysis and matching review, not merely flip an assertion flag.

`scripts/review-benchmark-coach-admission-negatives.mjs` independently rejects **109/109** forged result packets: false current PGNs, altered source hashes, swapped move SAN/UCIs/FENs, pretending the cached analysis was current, unauthorized cross-user access, concealing an SSE error, inventing a `done` event, **omitting/substituting raw SSE response bytes or their checksums**, fabricating a legitimate seven-ply report, changing the persisted cache row, hiding the incorrect `g4` moment, falsifying the corrected-source control, and claiming release approval.

`scripts/review-benchmark-coach-admission-boundary.mjs` runs the two scenarios in **separate fresh Node processes** with unique run UUIDs matched to stdout and ignored raw Hono/SQLite packets. The actual defective route run exits **0**, the QA-corrected-source negative control exits **1**. Both are evaluated against independent chess history and real route evidence. Four bounded depth-8 searches total; **0** external model requests. The `certification-summary-checkpoint35.json` records exact run IDs, owner source digests and the `release_approved:false` conclusion.

```sh
node scripts/review-benchmark-coach-admission-boundary.mjs
node scripts/review-benchmark-coach-admission-negatives.mjs
node scripts/review-benchmark-coach-admission-proof.mjs
```

## Owner remediation contract — **not implemented by Agent D**

**Agent B (backend) and Agent A / PR #17 (scoring coordination):** Bind a stored analysis to the **PGN/game-source identity and relevant scoring context** that produced it. `POST /api/analyze` must treat an analysis as cached only if the source identity matches the current game, in addition to depth/scoring-version checks. Ensure both `GET /api/games/:id` and `POST /api/games/:id/review` cannot use source-inconsistent analysis. Protect analysis creation/persistence from the **same game being updated during engine computation**, using an atomic source snapshot/CAS; then make report cache and GET freshness checks match that source. Preserve correct per-user auth and the existing `saveReviewIfFresh` in-flight CAS. Source/score schema and migration design belong to owners; Agent D will not independently implement PR #17's accuracy correction or create competing migrations.

**Agent C (frontend):** The UI's existing check for the current move UCI sequence should continue to prevent rendering incompatible move classifications. However, prevent a new report POST when its analysis is stale or explicitly show “analysis needs updating,” and integrate Checkpoints 32–34 so cached prose, mounted report state and active SSE requests are invalidated appropriately.

**Boundaries:** This proves a concrete **source-admission mismatch when a PGN changes without synchronous reanalysis**; it does **not** prove every production PvP game reaches this state at review time, nor that the local model generated a semantic fabrication (the deterministic fallback is actual product code). Tests use only synthetic PGNs, bounded Stockfish, real signed Hono responses and disposable SQLite. **Full product integration and release certification remain BLOCKED.**

**Next continuation:** Re-fetch owner branches and PR #17 read-only. If Agent B/A changes source provenance, rerun checkpoints 32–35 and challenge the new analysis cache key with a **same-length, different PGN** (ply count alone is not a sufficient source identifier). If unchanged, audit source/analysis persistence races **during** engine execution and document only reproducible effects. Never overwrite other agents or push `main`.
