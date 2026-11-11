# Agent D — Checkpoint 33: mounted React Game Report survives a newer PGN and analysis

**QA branch:** `agent/review-benchmark-20261111`. **Previous pushed checkpoint:** `29af85a72963824ba3a9308dd50afed13302a71b`. **Read-only pinned Agent C product:** `d72eaced6972c8a2ec7d8581365c45788b15a29a`. **Read-only pinned Agent B backend:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`. Other Agent A, `main`, and PR #17 were fetched read-only and had not moved. **All changed files belong to Agent D QA; zero product, frontend, backend, production-DB, migration, updater or deployment edits.**

## Confirmed frontend product defect in REAL Chrome/React, independent of a backend cache

Checkpoint 32 reproduced a backend cache-read defect: after a game's PGN changed, the authenticated GET report route still served the old cached prose. This checkpoint isolates a **distinct frontend state-retention defect**: **even after an updated engine analysis is persisted and the server's cached report is explicitly cleared to `{review:null}`, the mounted Game Review continues to display the old report after a same-game React Query refetch**.

**Root cause in pinned source:** `web/src/pages/GameAnalyzer.tsx` owns `const [reviewProse, setReviewProse] = useState<GameReviewProse | null>(null)`. Its effect fetching or clearing that state has dependencies **`[gameId, practicePicker]`** only; it does not react to a changed `data.game.pgn`, updated `data.analysis`, or a query refetch of the same game. The actual UI binds `GameReportPanel key={gameId} initial={reviewProse} onGenerated={setReviewProse}`. Thus a same-game query refresh changes the board/analysis but does **not** invalidate the old `reviewProse`; switching between Moves and Report also preserves the old parent-owned value. A *full page navigation* remounts the component and clears it, which is why a manual reload can temporarily appear to fix the issue.

The frontend **does** independently validate that cached engine move UCI tracks the saved PGN, and it avoids displaying incompatible move classifications. That protection should be preserved. The new finding is that **the separately stored written report is not bound to that same source-identity check**.

## Reproduction against the actual product sources

`scripts/review-benchmark-browser-source-refresh.mjs` launches **real Google Chrome 157**, the unmodified Agent C React app through a disposable **Vite proxy**, and unmodified Agent B Hono/game/review routes with **signed synthetic authentication and SQLite WAL**. It uses a self-authored PGN fixture, a second self-authored PGN with the **opposite checkmate winner**, and **two bounded local Stockfish 16 depth-8 analyses** per run (one thread, 16 MiB hash). No third-party games, live LLM, production credentials or network deployment.

1. It analyzes **Fool's Mate**, four plies, **Black checkmates White**, using the actual backend `analyzePgn`/`saveAnalysis`. It generates a genuine no-LLM `buildGameReview` object, then intentionally prefixes its summary with the unique synthetic marker `QA_OLD_BLACK_WINNER_PROSE_STAYS`. The marker is **QA-authored**, not a claim about language-model generated text. The report is cached through the real production `saveReviewIfFresh` compare-and-swap.
2. It signs in to the real React app, opens `/review/1`, chooses Report, and observes the actual cached marker. The board shows **0 / 4**. Clicking the real Star/bookmark button triggers a React Query refetch (independently verified in Chrome CDP), **correctly preserving** the old report for harmless metadata changes.
3. In the **disposable DB**, it updates the game's PGN to a legal **White checkmate** `e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#` (**seven plies**). It runs and **persists a new, valid Stockfish analysis** for the new PGN (the comparison is *not* based on stale engine data). It **clears `analyses.prose_json` to NULL** and confirms the real authenticated `GET /api/games/1/review` now responds `200 {"review":null}`.
4. It clicks Star again in the *already-open* React app, causing a new `GET /api/games/1` via the actual React Query mutation/invalidation path. The board updates **0 / 4 → 0 / 7**, and opening the real Moves tab confirms the new SAN `Qxf7#`. Returning to the Report tab still displays **`QA_OLD_BLACK_WINNER_PROSE_STAYS`**. The browser had performed **three unique game-detail GET requests** (initial, metadata refetch, changed-game refetch); this is not a no-op or a stale browser network fixture.
5. On a **full navigation** to the same `/review/1` URL, the stale report disappears; the app displays the **Write AI report** button with the same new **0 / 7** game. That is a positive control for a correctly reset client state and the actual null backend report.

The first QA draft incorrectly expected `Qxf7` to be in the Report tab; that is not where the real component renders notation. The assertion was corrected to inspect **Moves** and return to **Report**. The first run was red for a **QA assertion mistake**; the second clean run and all subsequent fresh-process proof runs reproduced the intended defect. This correction strengthens the test and did not alter any owner code.

## Independent proof and deliberately hostile controls

`scripts/review-benchmark-browser-source-proof.mjs` does **not** import the actual GameAnalyzer or GameReportPanel React component. It verifies the **pinned SHA256 of both owner files and the backend read/analysis routes**, replays both original synthetic PGNs (including opposite checkmate winners), and validates the **real Chrome UI records, authenticated server GET response bodies, Chrome CDP game-detail network request IDs, source-analysis fingerprints, deterministic QA marker, and full-navigation recovery**. It checks both the clean experiment and the deliberately failing browser experiment, with distinct UUIDs and no release-positive claims.

`scripts/review-benchmark-browser-source-boundary.mjs` launches **two separate fresh Node processes**, each with its own disposable Chrome profile, Vite, Hono API and SQLite database. Clean must exit **0**. The **QA-only `--fault=remount-client`** branch forces a full component remount after the changed-game refetch; because the backend cache is null, the old marker disappears and the benchmark's *old text remains* assertion **correctly fails with exit 1**. This is a genuine **negative control for benchmark sensitivity**, not a product fix. Each run uses only two bounded depth-8 engine analyses (four total across the full clean+fault boundary).

`scripts/review-benchmark-browser-source-negatives.mjs` rejects **92/92 deliberately modified JSON evidence packets**, including false source hashes, fake product-version references, a missing network refetch, stale board counters, absent new SAN, a backend report that was not null, falsely reported disappearance of the stale UI, an incorrectly retained report after navigation, omitted Chrome errors, bogus run flags, and forged negative-control results. All raw run packets are stored under **ignored** `qa/review-excellence/results/`. The machine-readable `certification-summary-checkpoint33.json` has the clean and fault run UUIDs, pinned source hashes, explicit limitations, and `release_approved:false`.

## Owner fix contract (NOT implemented here)

**Agent C — frontend:** Bind `reviewProse` to the **same current game/analysis identity** as the rendered board and engine evaluations. A same-game PGN/source or relevant analysis generation change must clear the previously displayed prose, invalidate its cached source dependency, and abort or disregard any in-flight old-source SSE `done`. Do **not** invalidate on benign notes/bookmark mutations; preserve the existing game-ID and practice-mode boundaries. Maintain correct behavior for a null/stale server GET, and for a newer valid matching report delivered later. Tests should cover both already mounted and unmounted report panels, parent `onGenerated` callbacks, and rapid same-game refreshes.

**Agent B — backend:** Checkpoint 32's separate stale **server-side** GET cache source defect remains. The frontend correction alone cannot guarantee safety: a hard page reload can still receive outdated cached prose until backend source-identity checks are fixed. Coordinate `analyses`/`games` PGN source revisions and review cache invalidation with Agent B, Agent A and PR #17, without independently reimplementing the accuracy correction.

**Reproduce:**

```sh
node scripts/review-benchmark-browser-source-boundary.mjs
node scripts/review-benchmark-browser-source-negatives.mjs
node scripts/review-benchmark-browser-source-proof.mjs
```

**Limits:** One small synthetic PGN pair and two bounded local Stockfish analyses per run, not a production game-incidence measurement. Source mutation and explicit backend cache clearing are controlled QA operations on disposable SQLite. Browser refetch is triggered by the real bookmark mutation, not a claim that the product pushes updates to every open game automatically. A production fix is still needed, sealed holdout and full load/deployment validation remain missing, and **product integration/release certification remains BLOCKED**.

**Next exact action:** Fetch Agent A/B/C, `main` and PR #17 read-only. When Agent C or B has changed, pin their updated detached source and rerun both **Checkpoint 32 backend GET** and **Checkpoint 33 already-mounted Chrome frontend** regressions. Otherwise independently audit same-game in-flight `onGenerated`/report SSE events against a refreshed PGN without duplicating previous cancel/retry coverage. Always remain inside Agent D's QA branch; never push `main` or modify another agent's source.
