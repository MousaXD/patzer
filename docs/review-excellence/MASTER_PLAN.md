# Patzer Review Excellence — master product, engineering and research plan

**Status:** APPROVED FOR PLANNING ONLY; no implementation, migrations, automatic agent execution or production deployment authorized by this document.
**Owner/decision maker:** Patzer repository owner. **Coordinator:** integration/review lead. **Execution:** four independently scoped agents, described in [AGENT_BRIEFS.md](AGENT_BRIEFS.md).
**Baseline:** `MousaXD/patzer` `main` at `60162725626fbc53e8760c6027b91bf6d8805fd1`, inspected **2026-11-11 (Asia/Dubai)**.
**Companion contract:** [BENCHMARK_SPEC.md](BENCHMARK_SPEC.md). **Project entrypoint:** [README.md](README.md).

> **Mission:** Make Patzer a *more dependable and effective chess-learning experience*, not a visual copy of Chess.com or a simulator of its proprietary CAPS2 percentage. The ultimate results are chess correctness, explanations that are both true and understandable, a player able to repair mistakes, and a reliable, fast product. No accuracy metric is an objective measure of human strength on its own.

## 1. Executive decisions (read this before accepting an agent PR)

1. **Trust chess rules and verified engine evidence over elo-looking scores.** A beautiful review that hallucinates a tactic fails. A correct engine answer without a teaching path is incomplete.
2. **Benchmark first, optimize second.** Freeze a reproducible baseline, dataset provenance and evaluation protocol before modifying heuristics or teaching prompts. No using held-out labels to tune thresholds.
3. **Do not treat Chess.com as ground truth.** Its CAPS2 is proprietary and designed for a particular grading distribution. Lichess publishes a transparent win-chance model, but itself says no universally accepted accuracy percentage exists. Compare both when permission and data allow; neither is the referee of chess truth.
4. **Use an independent, versioned Patzer score.** Show the model's name, engine, depth/nodes and limitations. Never silently change historical scores or compare v9/v10 values on a trend chart as if identical.
5. **Separate the three systems:** (a) chess facts/engine, (b) teaching claims/AI and (c) UX/practice. Let deterministic evidence constrain LLM text. Do not allow an LLM to invent best moves or board states.
6. **Prefer the smallest safe, measurable improvement.** Work in isolated feature worktrees. Preserve public contracts; no rewrite merely for aesthetic elegance.
7. **Four agents, four owners, one integrator.** Per-file ownership, explicit API contracts, no agent cherry-picks another agent's pending branch, no uncontrolled CI or mass reanalysis.
8. **Do not risk user data for a benchmark.** Use sanitized, licensed/synthetic data in the repository; private games are tested locally using disposable SQLite snapshots. Absolutely no copying the active SQLite file while WAL writers are running.
9. **Never provide engine help for an ongoing competitive online game.** Review completed games and clearly labeled offline practice only. Check licenses and site rules before collecting external data.
10. **No automatic merge of the existing accuracy fix.** As of this audit, [PR #17](https://github.com/MousaXD/patzer/pull/17) is open, all six PR checks green, and contains an independent **v9→v10** scoring change/backfill. It needs its own release decision and migration. This roadmap does NOT merge it, authorize backfill or imply it is live.
11. **No premature claim of perfection or production certification.** Each result must state its reference implementation, tested population, hardware/configuration, uncertainty, failures and remaining limitations.

## 2. What "better than Chess.com" actually means

This is a proposed product target, **not an established conclusion or marketing claim**. The user should finish a review able to say: *what I overlooked, why the better move works, what the opponent could have done, and what to practice next.*

| User need | Expected behavior | Objective test | Anti-goal |
| --- | --- | --- | --- |
| Correct chess | Only legal continuations; correct turn, side, mate and draw semantics | Deterministic `chess.js` validation and reference-engine suites | Plausible but impossible lines |
| Honest evaluation | Difference between best move, good alternative and genuine error is explainable; report confidence | Blind curated set and score stability by engine budget | Fabricating a 0.00 score when engine unavailable |
| Useful explanation | Evidence-grounded cause → consequence → alternative, suitable for rating level | Human annotation rubric and automatic fact checks | Generic "develop pieces" or hallucinatory threats |
| Practical learning | Retries hide answer initially, then verify legal response and explain | Usability tasks and delayed practice assessment | Spoiling the best move before the attempt |
| Trustworthy statistics | Versioned accuracy, context, trend and meaningful uncertainty | Held-out tests, calibration error, empty-data correctness | Ranking skill by one game or imitating CAPS2 |
| Smooth experience | Fast, accessible, responsive, undoable, recoverable | Browser performance, keyboard/touch/a11y smoke | Scroll traps, stuck spinners, selection artifacts |
| Personal/offline control | Runs locally, protects data, degrades without an LLM | Offline/failure tests and security checks | External transmission of PGNs without consent |

**Primary outcome:** verified learning after review. **Guardrails:** factual error rate, illegal-variation rate, data loss, undue resource use and regression in existing chess/PvP workflows. **Secondary outcomes:** engagement/return-to-review rate and latency; engagement is not the purpose by itself.

## 3. Verified starting state and evidence limits

### 3.1 Existing capabilities (inspect before rewriting)

- **Engine/review:** `server/src/chess/stockfish.ts`, `engine.ts`, `classifier.ts`, `accuracy.ts`, `analysisAgentWork.ts`, `variationScoring.ts`, `keyMoments.ts`, `phases.ts`; main orchestrator and cache in `server/src/routes/analyze.ts`.
- **Opening/facts:** `server/src/chess/openings.ts`, `startFen.ts`; `server/src/coach/facts.ts`, `facts-utils.ts`, `coaching.ts`, `tactics.ts`, `moves.ts` already generate board-grounded facts and sometimes fall back when an AI contradicts move verdicts.
- **AI reviews:** `server/src/coach/review.ts`, `explain.ts`, `llm.ts`, `server/src/routes/review.ts`, `autoReview.ts`. AI prose is versioned/cached; streaming and cancellation paths exist, but consistency and hallucination rates are **not yet established**.
- **Game Review UX:** `web/src/pages/GameAnalyzer.tsx`, `Review.tsx`, `web/src/components/{GameReportCard,GameReportPanel,EvalGraph,MoveList,MoveExplanation,KeyMomentsList,ChessBoard}.tsx` and `web/src/components/review/*`; existing moves, analysis graph, interactive legal variations, pending/error states and responsive changes.
- **Practice and stats:** `web/src/pages/{Train,Learn,Insights}.tsx`, `server/src/chess/{gamePuzzles,tactics,openingTrainer}.ts`, `server/src/coach/memory.ts`, `server/src/routes/{train,tactics,insightsV2}.ts`. Existing practice is a base to improve, **not** grounds to claim spaced repetition or proven learning transfer.
- **Backend/data:** `server/src/db.ts`, `dbMigrations.ts`, `routes/{games,platformQueries,analysisData}.ts`, `server/src/auth/middleware.ts`, `integrations/mcp/`. Pagination and large-library navigation shipped in the four-agent integration.
- **QA:** `qa/agent07/frontend-overhaul-smoke.mjs` (browser/Stockfish/disposable DB), `qa/product-ui/settings-navigation-smoke.mjs`, `server/test/`, `web/src/**/*test*`, `web/tests/`, five npm E2E scripts, MCP protocol tests.
- **Infra:** Linux local `patzer.service`, optional GitHub `main` updater with **12-hour** schedule and manual Admin → System check/install; the user's live SQLite and credentials live outside source control. Do not edit these while executing this plan.

### 3.2 Baseline observations (not evergreen facts)

| Observation on 2026-11-11 | Status | What it does **not** prove |
| --- | --- | --- |
| Deployed Git source at planning time: `6016272` on `main` | Inspected locally; clean checkout; healthy service | Not a permanent version pin |
| Installed local engine advertises **Stockfish 17** | Verified via UCI `uci` command | Not necessarily current upstream Stockfish or identical to Chess.com's server |
| Current `main` uses `SCORING_VERSION = 9` | Verified in `classifier.ts` | Not a claim v9 is calibrated or correct |
| Live instance had **1,826 games, 343 analyses**, all scoring v9 | Read-only SQLite count; mutable during auto-sync | Not public benchmark fixtures, not a statistically representative dataset |
| PR #17 scoring correction has six green checks but remains unmerged | GitHub status inspected | Not part of main, not approved to deploy |
| Prior four-agent integrated release passed 715 unit tests and 35 browser QA checks | `docs/agent-handoffs/integration-20261111.md` | Not an assessment of coaching truth or actual student learning |

Counts, engine version and PR state **must be rechecked by the implementer**; do not use these snapshots as runtime assertions. Baselines for review latency, illegal-claim frequency, learning gains, reference accuracy error and energy/CPU load **have not yet been measured**. Do not invent them. The local Chess.com score examples from the user's screenshots are **four observations**, not a calibration dataset.

### 3.3 Existing technical debt to protect against

- Previous frontend audit (`docs/audits/frontend-2026-11-09/IMPLEMENTATION_WAVE_1.md`) recorded a gray overlay that could **not** be reproduced in isolated Chromium; don't claim its root cause fixed without observing the same device/session.
- Review/position/coach calls share limited engine capacity; admission, cancellation and FEN freshness matter. Prior multiple agent changes improved this but have not proven arbitrary concurrent workload performance.
- Some historical cached AI prose may mention accuracy values from the previous scoring version. Editing numeric summaries without managing prose/version invariants yields contradictory UI.
- One imported game can contain **two players** and two accuracy scores, but that is not two statistically independent games; preserve clustering in metrics.
- Game Rating / estimated Elo is an estimate, not a real FIDE/Chess.com rating or evidence of cheating. Avoid making it more prominent than actual tactical learning.

## 4. Explicit assumptions, non-assumptions and unknowns

### Allowed working assumptions, subject to verification

- **Standard chess only for v1 excellence scope**, with PGNs that can start from custom legal FEN. The repository roadmap explicitly excludes chess variants; do not silently expand to Chess960/KOTH/three-check.
- **Stockfish is available locally** in the user's environment, and `chess.js` supplies legal move validation; exact binary/version, depth, threads and runtime budgets must be recorded per test.
- **Offline-first/private by default**. A configured LLM is optional; deterministic explanation/fallback must remain useful when absent or down.
- **Self-hosted personal/family scale** is the primary deployment model, not a cloud multi-tenant redesign. Optimize within observed hardware/budget.
- **The owner will approve experiments/merges/migrations**. Agents have no mandate to perform live operations.
- We can create/curate **openly usable PGNs, positions and puzzles** and generate legal synthetic fixtures. Consent and license must be tracked per item.

### Do NOT assume

- Chess.com/CAPS2 accuracy is the mathematically correct or universally preferred score; its formula is not public. Do not reproduce undocumented endpoints or bypass subscriptions.
- An engine's **first short PV** is the only right line. Multiple sound moves, quiet defenses and long forced sequences exist; evaluate at declared budget.
- Deep analysis is always better for user value, speed or energy. `MultiPV > 1` can trade off search depth; compare fixed budgets and engine configurations.
- Higher accuracy equals greater Elo, cheating, tactical ability or learning. A lost/won position may produce inflated accuracy simply because many moves don't change winning chances.
- The current data contain high-quality **human annotations**, CAPS2 labels or enough variety for statistical validity; imported games are not human ground truth.
- A legal PV proves a natural-language claim about a *threat* or *forced* outcome. Legality and tactical counterfactual must both be verified.
- An LLM explanation is correct because its text sounds confident; checking a verdict label is only a first filter, not a proof of piece/square or variation accuracy.
- Existing UI tests establish real-world screen-reader usability, mobile physical-device behavior or every race condition.
- Passing unit tests means it is safe to migrate the active SQLite database, refresh 300+ AI reports or auto-deploy.
- Auto-synced imported games can be safely published as fixtures, even if their PGNs appear on a public platform. Keep private datasets separate.
- Agents may edit the live worktree, service, `.env`, MCP tokens, account data, sync schedules or other agents' branches.

### Questions that must be resolved with experiments, not guesses

| Question | Decision-making evidence | Owner |
| --- | --- | --- |
| Does v10 scoring beat v9 on held-out, independent references? | Model comparison with confidence intervals and representative game-length buckets | Benchmark + chess backend |
| How often is a classification unstable at low depth? | Same FEN compared across fixed engine settings/budgets and repeated runs | Chess backend |
| Which error type dominates explanations? | Blind human label rubric: legality, actor, square, tactic, causality, helpfulness | Coach/pedagogy |
| Which teaching intervention improves retention? | Controlled attempt-first vs explanation-first study, delayed puzzles | Product + pedagogy |
| How fast is a typical review on actual hardware? | p50/p95 per depth, positions/second, CPU/RAM, concurrent job limits | Platform/benchmark |
| Can we access legitimate Chess.com reference scores at scale? | Already-reviewed user-provided scores and permission checks | Benchmark; owner approval |
| Are visual regressions reproducible in Firefox and physical phones? | Same resolution, zoom, theme, screenshot, DOM evidence | Product UX |
| Is any future DB migration reversible and safe in WAL mode? | Verified online backup, dry-run, transaction and rollback rehearsal | Integrator |

## 5. North-star outcome and measurement plan

### 5.1 Proposed scorecard

| Dimension | Measurement | Hard gate / initial target | Notes |
| --- | --- | --- | --- |
| Rules correctness | Illegal suggested first moves / broken board states on curated test set | **0** | Any violation is a release blocker |
| Saved-game integrity | Unexpected PGN/moves/analysis changes after review, branch play or failed job | **0** | Test exact hashes and SQLite counts |
| Side/perspective | Wrong actor, evaluation sign, winner, SAN/UCI or mate/draw verdict | **0 on deterministic gold cases** | Failure blocks factual launch |
| Evidence-based text | Unsupported concrete chess claims among reviewed utterances | **Target 0 critical; measure all severities** | Human adjudication mandatory; do not claim 100% globally |
| Mistake identification | Precision/recall and confusion matrix by motif, rating, depth | Improve against frozen baseline; threshold after baseline | Reference engine + adjudicated cases |
| Calibration | MAE, median error, p90 error and bias versus human/transparent external references | Improve vs frozen baseline on blind holdout, not four screenshots | Report by position state/length/rating |
| Educational value | Correctly solve same-theme *unseen* task after coaching (delayed) | Demonstrable improvement, with uncertainty | Primary success metric |
| Usability | Complete a review/redo workflow without assistance | Improve task success vs baseline | Participants and tasks recorded |
| Latency/efficiency | p50/p95 wall time, engine CPU, peak RSS, LLM tokens | No unapproved regression; budget after measurements | Same hardware, engine version/depth |
| Resilience | Correct recovery from engine busy/timeout, LLM down, DB unavailable, cancelled request | No stuck/spurious successful UI states | Include auth/CSRF and offline |

A **proposed** go/no-go rule for each non-critical outcome: avoid regression on the locked holdout, show both absolute and relative change, include uncertainty/confidence bounds, and explain trade-offs. Never invent a single target (e.g. 95% match to CAPS2 or 200 Elo improvement) before observing a baseline and assessing sample size.

### 5.2 Learning outcome measurement (not "clicks" as a proxy)

- Give the learner a previously unseen tactical or positional example before review; record first-attempt legal move and success **without hints**.
- After Patzer teaching, test analogous but **unseen** positions from the same motifs; conduct delayed follow-up if volunteers agree. Record whether players can state the reason for the best move.
- Compare to a baseline experience (engine line + evaluation), ideally randomized at user/task level; anonymize and avoid leaking puzzle solutions between conditions.
- Track wrong-answer retries and hint usage separately from first-try correctness. A successful click after three hints is not the same as independent learning.
- Account for practice effects, differing player ratings, session length and repeated attempts. Report participant count, effect size, uncertainty and limitations; voluntary feedback is qualitative evidence, not proof.

## 6. Chess-analysis correctness contract

1. **Canonical context:** `game_id` (if saved), immutable original PGN hash, starting FEN, current FEN, ply, side-to-move, castling/EP state, user perspective, engine version/config and selected source line.
2. **Replay must be legal:** Reconstruct the game from the proper starting FEN; validate every SAN/UCI move via chess.js before scoring or rendering. Handle promotion, castling, en passant, underpromotion, stalemate, repetition, draw claims and mate.
3. **Separate evaluation viewpoints:** Engine UCI scores are often relative to side-to-move. Normalize to White once at a documented boundary; convert to player's color only for presentation/scoring. Store mate in addition to centipawns; don't conflate them.
4. **Correct comparison:** For a played move, score `fen_before` and the *actual* `fen_after` at a comparable search budget. Identify the best move from the **before** position. A legal alternative on a separate branch must never mutate the original timeline.
5. **Budget reproducibility:** Record engine binary hash/version, options (Threads, Hash, Skill, MultiPV, tablebases), requested and reached depth, nodes/time, FEN, PV, score, termination reason and analysis model version.
6. **Not every alternative is inferior:** Multiple winning/drawing alternatives may be valid. Distinguish best engine line, equivalent candidates, forced replies and genuinely unique defenses. Only say "only move" if refuted alternatives were checked sufficiently.
7. **Evaluation stability:** Benchmark critical positions at increasing budgets; mark unstable/horizon-sensitive cases with reduced confidence. Do not blindly promote shallow candidate gaps to "Brilliant" or precise mate claims.
8. **Cache rigor:** Cache key includes normalized FEN **and** engine/settings/version/budget when the score depends on them; cancellations invalidate stale requests. Do not reuse a stale score across changed positions or user accounts.
9. **Bounded workloads:** Existing request concurrency limits, cancellation/timeout, maximum PGN size, engine process cleanup and offline behavior stay intact. Deeper/multiPV jobs must be opt-in or resource-budgeted, not automatically run across full history.
10. **Failure truthfulness:** Show pending/unavailable/partial states instead of fake 0.00, 100%, best move, mate or status. Include a retry and clarify whether a partial result is persisted.

Detailed benchmark inputs and adversarial positions: [BENCHMARK_SPEC.md](BENCHMARK_SPEC.md).

## 7. Accuracy, classification, ratings and metrics policy

**Important dependency:** `main` currently has game-accuracy scoring v9. Independent [PR #17](https://github.com/MousaXD/patzer/pull/17) proposes v10, a deterministic `moves_json` backfill and an old-prose warning. It is **not yet in the baseline main**. Do not stack an unreviewed new accuracy formula on top. The integrator must decide whether to merge/deploy v10 first and verify its online backup and idempotent migration.

- Publish **Patzer accuracy**, not "Chess.com Accuracy". Explain per-move win-chance loss, aggregation, excluded book/forced plies and limitations in human-readable language. Link sources to the published math. Never assert exact CAPS2 equivalence.
- Expose **score_model_version** with each saved score and preserve historic scores if old/new aren't directly comparable. In aggregate trends either rescore consistently, show version breaks or explicitly label mixed-version series.
- Classifications (best/excellent/good/inaccuracy/mistake/blunder/miss/great/brilliant/forced/book) need **documented tests and proof conditions**, especially best move uniqueness, mate transitions, only-good-move, forced recapture, book exit, win-chance drop and custom FEN.
- Benchmark game-level scores across `0/1/2+` blunders, short games, blowouts, high/low complexity, endgame conversions, positions already lost, and mating lines. A score of 99% can be legitimate in trivial winning play—do not infer suspicious behavior.
- Measure correlation with reference scores, **systematic bias**, MAE and outlier tail by bucket. Treat comparisons with CAPS2, Lichess and human annotations as **separate columns**; none alone is a gold standard. Keep held-out games and entire players independent.
- **Do not tune with the test set** or subtract an arbitrary number of points to make a handful of screenshots agree. Each model change needs preregistered hypothesis and versioned comparison results.
- Separate **Estimated Elo/Game Rating** from accuracy and actual rating. A single-game prediction is highly noisy. Don't display high-certainty claims or imply fair-play/anti-cheat conclusions.
- Existing cached AI prose can become stale when metrics change. Manage versioned prose and allow *selective* regeneration with LLM cost controls; never silently erase old reports or run hundreds of LLM calls.
- All migration scripts must accept an explicit target database, support `--dry-run`, create a **verified online SQLite backup**, be transactional/idempotent where possible, and verify row counts, move hashes, v9/v10 distribution and service health.

## 8. Explain-why architecture (grounded coach, not fluent guesswork)

### 8.1 Proposed pipeline

`PGN / FEN` → legal-replay validator → engine scored evidence → tactical/positional feature extraction → structured claim candidates → independent claim validation → appropriate player-level explanation → legal interactive follow-up → score + feedback/learning record.

The LLM is **a narrator of verified chess evidence**, not a calculator of the position.

### 8.2 Facts that must be structured before prose

- Actor / perspective; `fen_before` and `fen_after`, ply and legal SAN/UCI.
- Played move vs recommended move(s); score before and after; uncertainty/depth.
- Checked motifs when actually proved: loose/hanging piece, undefended square, fork, skewer, pin, discovered attack, opening of a line, overload, zugzwang, checkmate threats, pawn break, endgame rule.
- **Concrete counterfactual:** legal line showing how the opponent punishes the played move and why the recommended move avoids it. If not verified, phrase it as an idea/possible plan—not forced or guaranteed.
- Difference between tactical refutation, strategic weakness and simply missing a stronger alternative.
- Player level, current theme, prior error pattern; **do not** invent the player's emotional state, elo, intentions or motives.

### 8.3 Output contract and rejection rules

- The explanation should typically answer **What happened? Why does it matter? What should I have considered?** in a concise natural voice. More depth is a user-requested layer, not default verbosity.
- The coach must not claim a piece exists on a square unless it is in the corresponding verified FEN; must not use impossible moves or reverse White/Black; must not claim forcing sequences without legal verification.
- Give evidence links to a displayed move/position and PV. For critical claims include `claim_id`, type, supporting FEN/ply and validation result internally; this is a *proposed future schema*, not implemented today.
- If evidence is insufficient, use a deterministic qualified explanation, label uncertainty, or say that deeper analysis is needed. Never make up a tactical story.
- Existing `coachExplain` contradiction retry/fallback is valuable but **not sufficient**: it detects some verdict contradictions, not all board/causality hallucinations. Extend verification using fixtures and independent validators.
- When the LLM is unconfigured, slow, rate-limited or returns invalid JSON, do not hang. Retain an honest facts-only report and let the user regenerate a single report later.
- Keep audience/language support aligned with repo's existing locales; don't silently ship English-only prose into another configured locale. UI translations and AI prose have separate fallbacks.

## 9. The learning loop (the product differentiator)

1. **Review summary:** show one priority weakness (with verified evidence) instead of an overwhelming wall of statistics; offer next meaningful action.
2. **Try again without spoilers:** reset board to `fen_before`, hide the best move, allow any legal user move. No engine hints or suggestions from the completed-game review until the attempt/hint action. Prevent leaking the answer in aria labels, visible PV, move list, evaluation graph or keyboard shortcuts when in blind practice mode.
3. **Grade against real chess:** evaluate the attempted move on that exact FEN. Accept genuinely equivalent legal alternatives, not only one expected UCI. Handle draw/mate/legal but unscored cases as distinct outcomes.
4. **Explain and reveal:** after attempt, show consequence/variation and compare player choice with engine-vetted alternatives. Optionally allow increasingly revealing hints and a replayable refutation line.
5. **Remember the weakness:** store a scoped, opt-in review/practice outcome (theme, FEN or stable position ID, timestamp, hint count, first-attempt success, difficulty/confidence, engine version). No claim of "mastery" from one correct attempt.
6. **Practice later:** schedule or suggest similar, *unseen* positions and measure first-attempt performance. Offer reset/delete/retention controls and avoid cross-account leakage.
7. **Close the loop:** connect Insights to actual learning evidence: recurrent missed motifs, before/after puzzle success, and whether mistakes recur in subsequent completed games. Never confuse practice activity with skill gains.

Do not build a grand spaced-repetition platform before the attempt/reveal/verify cycle is reliable and measured in one small vertical slice. Existing `/train` and `gamePuzzles.ts` should be evaluated for reuse.

## 10. Review UX, accessibility and performance bar

- **Continuity:** saved game timeline and exploratory branch are visibly different; branch analysis cannot alter PGN. Switching games, logout, cancel, retries, back/forward and fast clicks must not leak stale data from another game/account.
- **Controls:** ArrowLeft/Right, Home/End, move-list clicks, graph scrubbing and promotions work without browser text selection or accidental page scrolling. Shortcuts yield to text fields, sliders, dialogs and assistive technologies.
- **Visual:** responsive board/rail at 1920×1080, 1440×900, 1366×768, 768×1024, 390×844; dark/light; zoom 125% and 200%; stable layout and readable copy. No fake controls or hidden overflow traps.
- **Accessibility:** keyboard-only walkthrough, focus restoration, disabled/busy/expanded semantics, screen-reader announcements for analysis states, accessible graphs, touch target comfort, reduced-motion support, visible focus and contrast. Test with an actual screen reader before claiming complete compliance.
- **States:** loading, stale, queue/busy, throttled, partial, cancelled, failed engine, LLM unavailable, no data, corrupted analysis and analysis-version mismatch each need an honest status/action.
- **Evidence:** annotated screenshots and videos are useful, but browser assertions must inspect behavior/DOM and verify legal FENs; screenshot-only acceptance is insufficient.
- **Performance:** measure app startup, game-list pagination at 2k and 10k synthetic games, full review with long PGN, memory/CPU during Stockfish, tab navigation and mobile interaction. Protect current user-experience budget until a baseline is recorded; no repeated Linux CI jobs without purpose.
- **Security:** keep auth, CSRF, data ownership checks and MCP isolation. An imported PGN/comment or model response is untrusted content; don't render untrusted HTML or execute instructions embedded in external notation.

## 11. Benchmark-first research program

The proposed starter benchmark should be intentionally **small enough to run routinely, wide enough to reveal failures**, and fully documented. See [BENCHMARK_SPEC.md](BENCHMARK_SPEC.md) for schema, data governance and scoring protocol.

| Proposed dataset | Initial target | Why | Evidence status |
| --- | ---: | --- | --- |
| Real completed standard games across rating/time/length buckets | 200 | End-to-end review and score distribution | **Target only**; not yet curated |
| Adversarial tactical/positional positions | 100 | mate, forced, horizon, unusual FEN and multiple sound moves | **Target only** |
| Expert/human-scored explanation cases | 50 | Truth and pedagogical clarity | **Target only**; requires annotation |
| Locked holdout games/positions | At least 50 games + 25 positions | Detect model and prompt overfit | **Target only**; non-overlapping by source/position/player where feasible |
| Long/strange/error cases | 30 | 250+ plies, timeouts, promotions, cancellations and corrupted inputs | **Target only** |

Overlapping categories are allowed **within development sets**; held-out sets must remain independent. Targets do not imply access to 200 consenting participants or 200 CAPS2 scores. Build stage 0 from licensed/synthetic sources and permitted local test copies; request owner approval before incorporating any private dataset into wider work.

### Correct experiment order

1. Freeze a `benchmark_manifest`, fixture hashes, stratified development set and holdout split.
2. Run **existing main** unchanged and preserve `baseline.json`, failure list, elapsed time, engine/version/config and environment.
3. Document a hypothesis for each fix, including how it might fail; implement behind a flag or contract-preserving change.
4. Run fast unit/fixture tests; compare on development data; only then run the **sealed holdout** at the predefined milestone.
5. Report aggregate and bucket metrics, worst failures, confidence intervals, regression analysis and runtime cost.
6. Accept/reject according to the gate; if rejected, keep the benchmark and a reproducible negative result without deploying the change.

## 12. Four-agent program: roles, contracts and order of work

**Each agent has a separate worktree, branch, owned file set and formal deliverables.** Detailed copy-and-send briefs, interface freezes and blocked files: [AGENT_BRIEFS.md](AGENT_BRIEFS.md).

| Agent | Mission | Primary ownership | Must not own |
| --- | --- | --- | --- |
| **A — Chess Engine & Scoring** | Trustworthy evaluation, classification, model-version discipline | `server/src/chess/*`, `server/src/routes/analyze.ts`, chess engine/classifier tests | AI prose, UI, benchmark truth labels, deployment |
| **B — Coach & Learning Science** | Grounded explanations, user learning claims, coaching failure modes | `server/src/coach/*`, `server/src/routes/review.ts`, coach tests | Engine scoring, GameAnalyzer UI, SQLite migration |
| **C — Review Product & Accessibility** | Clean review/retry flow and full UX/a11y correctness | `web/src/pages/GameAnalyzer.tsx`, `Review.tsx`, `Train.tsx`, review components/tests | Engine/scoring internals, coach text generator, DB core |
| **D — Platform, Data & Benchmark Certification** | Benchmark harness, dataset provenance, reproducible QA, load/security checks | `qa/review-excellence/*`, `scripts/review-benchmark*`, benchmark fixtures/reports, platform test files | Modifying scoring formula, live SQLite, app release jobs |
| **Integrator (me)** | Scope, contract arbitration, baseline/holdout locks, conflict check, independent final certification | Integration branch only, PR/CI coordination, release handoff | Secret changes, unsolicited live data writes, silent scope expansion |

**Collision rule:** Agent D must not modify A's algorithms to "make tests pass"; A cannot edit D's gold labels; B produces a structured coach API contract for C rather than editing C's React components; C cannot silently change backend DTOs. Shared files require a documented change request with downstream approval.

**Order:** D establishes benchmark contract → A and B investigate (independently) → C prototypes a single evidence-backed Review→Retry workflow using stable mocks → integrator approves common API → implementation milestones ship one at a time. Do not push all four as a surprise mega-merge.

## 13. Phased implementation and exit criteria

### Phase 0 — Baseline and release safety (blocker for all formula/UX claims)

**Deliverables:** frozen main commit and model version; public/synthetic fixture manifest and human-label protocol; engine configuration; baseline machine, p50/p95 and resource readings; private-data boundaries; PR #17 dependency decision; risk log. **Exit:** reproduction script works on a clean checkout and every baseline limitation is disclosed. **Owners:** D + integrator; A consults.

### Phase 1 — Chess correctness and fair accuracy

**Deliverables:** reference FEN/mate/draw tests; depth-stability analyses; proven classifications and per-move loss; versioned scorer comparisons and no unsupported CAPS2 parity claim. If PR #17 is chosen, first migrate/verify its cached summaries separately and establish v10 as baseline, not a fresh v11 in the same release. **Exit:** no chess-rule violations on gold fixtures, held-out nonregression in classifications, audited scoring distributions. **Owners:** A + D; integrator gate.

### Phase 2 — Facts-first explanations

**Deliverables:** structured evidence schema, claim validator and facts-only fallback, annotation rubric, truthfully qualified threats, tests for contradictory language/perspective. **Exit:** critical unsupported concrete claims = 0 on initial human-reviewed gold set, report remaining low-confidence/human disagreements. **Owners:** B + D; A supplies engine contract.

### Phase 3 — One excellent Review→Retry vertical slice

**Deliverables:** choose one important mistake, optional hidden-answer practice mode, legal alternative scoring, reveal/refutation, keyboard/touch/a11y, first-attempt metrics and safe recovery. **Exit:** real user can complete path unaided; no original PGN mutation, no answer leak, engine/LLM failure behaves honestly. **Owners:** C + B + A via frozen contract; D certifies.

### Phase 4 — Pattern memory and personalized practice

**Deliverables:** recurrence detection by evidence-backed motifs, prior-mistake tracking, opt-in retention controls, new unseen practice positions, Insights showing calibrated improvements; small delayed practice pilot. **Exit:** measured learning benefit or clearly documented inconclusive result; no claims based on clicks alone. **Owners:** B + C + D; integrator approves data model.

### Phase 5 — Performance, reliability and product polish

**Deliverables:** profiler-driven fixes, bounded concurrent engine jobs, cache/invalidation proof, thousands-of-games test, browser and accessibility audit, degraded/offline UX, crash/restart backup rehearsals. **Exit:** no severity-0/1 regressions, stable CPU/memory/latency on fixed machine, green exact-head CI and real-user check. **Owners:** D + A + C.

Do not give delivery dates, claim completion, or start background workers just because these phases are written down. Each phase requires a separately approved implementation task.

## 14. Release and integration gate (non-negotiable)

1. **Never edit live `main` or production data in parallel with a working agent.** Use feature worktrees from a verified base and attach exact SHA to every report.
2. **One meaningful PR per increment** with scope, files owned, risk, tests, fixtures, before/after results and out-of-scope declarations. Include counterexamples and unresolved failures, not only passing numbers.
3. **Check remote branches, not stale local agent checkouts.** Fetch `origin` and inspect all candidate heads and changed-file overlaps; no force-push to main, no accidental merge of unrelated branches.
4. **Local validation while runners are queued:** `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `node --test integrations/mcp/test.mjs`, QA browser and targeted E2E. Use disposable database/accounts and a bounded Stockfish budget; never run mass analysis on live games.
5. **GitHub gate:** wait for all required exact-commit checks to pass on integration PR. A green result from a source branch does not certify a combined tree. Never claim a queued test passed.
6. **Architecture/review gate:** security, rate limits, UCI/PGN input validation, data ownership, accessibility, model version, migration, cancellation, performance and AI truth all reviewed by integrator.
7. **Database changes require owner approval.** First dry-run on a disposable online snapshot; produce integrity-checked backup, count/hash checks, an idempotency plan and rollback rehearsal. Preserve PGNs, move histories, AI reports and the Chess.com auto-sync cadence.
8. **Deployment is separate from merge.** On an approved release only, run the existing verified local update service (or approved equivalent), then check `/api/health`, authenticated review, stored games, counts, analysis model version, MCP read-only operations, user session and rollback state. **Do not restart the service for report-only planning.**
9. **Failure policy:** stop rather than conceal P0 data loss/chess-rule violations, auth leaks, ungrounded forced-mate claims or misleading missing-engine states. Roll back compatible code and keep data backup, with a documented forward-fix if schema changes are not reversible.
10. **Monitoring:** track post-deploy error/timeout counts, engine admission, analysis depth and stale cache, LLM fallback, game counts, median/p95 analysis time and user's manually reported UI issues. Respect privacy; aggregate diagnostics instead of logging sensitive PGNs or credentials.

### Minimal acceptance packet for each PR

- `baseline_sha`, `head_sha`, PR URL, owned files, dependencies, any migration version, deployment impact.
- Problem reproduced with a minimal fixture; expected versus observed behavior; links to exact logs or tests.
- Tests executed with their real results; explanation of *not* run checks; exact-head GitHub status.
- Metrics **before and after** on identical fixtures/settings; regressions, edge cases and limitations.
- Security/privacy/licensing review; rollback plan and whether live data or app were touched (normally **NO**).
- Explicit sign-off request for cross-lane contract changes. The owner/integrator alone chooses when to merge/deploy.

## 15. Risk register and mitigation

| Risk | Severity | Mitigation / stop signal |
| --- | --- | --- |
| Engine depth variability changes "best" move and verdict | High | Pin version, nodes/depth; test stability; label uncertain positions |
| Accuracy formula looks like CAPS2 but overfits few games | High | Frozen holdout and separate reference columns; compare error per bucket |
| Mate/turn sign bug leads to wrong teaching | Critical | Side-normalization invariant and mate-specific gold tests |
| LLM confidently hallucinates material/forcing line | Critical | Structured facts, legal PV proof, claim validator, fallback and human review |
| Review practice leaks the best move before attempt | High | Blind-mode UI/ARIA inspection and interaction tests |
| SQLite score migration corrupts games, invalidates AI prose | Critical | Snapshot/backfill dry-run, one transaction, hashes, versioned prose, rollback |
| Too many parallel Stockfish jobs kill laptop responsiveness | High | Admission/timeout/cancellation, CPU/RAM budgets, priority scheduling |
| Invalid PGN/custom FEN or long game crashes review | High | Validation, bounded limits, fuzz tests and user-facing error |
| Social/site terms or licensing breached while collecting labels | High | Consent, published APIs only, rate limits, data provenance and license audit |
| Cross-agent conflicts or stale branches silently overwrite fixes | High | File fences, frozen contracts, remote-head diff and sequential integration |
| Client API changes break old/partially updated releases | Medium | Additive versioned response, migration compat tests and synchronized rollout |
| Success measured by engagement instead of learning | High | Delayed unseen practice outcomes, blind human annotation and report uncertainty |
| Existing auto-updater deploys an unreviewed change | High | Only CI-gated `main`, migration sign-off, no new auto-merge automation |

## 16. Owner approval ledger (decisions, not assumptions)

| Decision ID | Current recommendation | State |
| --- | --- | --- |
| D-01 | Objective is learning + chess truth, not copying CAPS2 | **Proposed by plan** |
| D-02 | Use four scoped agents plus single integrator | **Proposed by plan** |
| D-03 | Build/freeze benchmark before formulas | **Proposed by plan** |
| D-04 | Treat PR #17 as a separate migration-gated decision | **Open; PR green but unmerged at audit** |
| D-05 | Standard chess and custom starting FEN for initial scope | **Assumed from current product; confirm** |
| D-06 | External Chess.com score collection is optional, consent-based and quota-respecting | **Proposed; no collector authorized** |
| D-07 | Human pilot participants, time, privacy policy and success thresholds | **Not yet approved/defined** |
| D-08 | Local Stockfish version upgrade / new LLM model | **Not approved; benchmark first** |
| D-09 | Data migrations, production deployment and user-data export | **Not approved by this document** |
| D-10 | Versioned release cadence and prioritized next phase | **Owner decision after Phase 0 evidence** |

A coordinator must update this ledger with **decision, date, owner, evidence and superseding link**; do not edit history to make proposals appear previously authorized.

## 17. First actions once execution is separately requested

1. **Integrator:** re-fetch `main` and PR #17; record exact remote heads, required CI checks and compatibility decision. Do not merge #17 just because it is green.
2. **Agent D:** create the benchmark manifest/fixtures and self-contained runner plan, with publicly redistributable data only; measure baseline on immutable `main`.
3. **Agent A:** write a no-edit error taxonomy on 100 adversarial positions and assess engine/config, scorer version and benchmark coverage. Propose priority fixes, not guesses.
4. **Agent B:** audit 50 representative explanation claims using structured truth rubric; identify repeated hallucination types and missing evidence fields.
5. **Agent C:** test current Review→Retry journeys with keyboard/mobile and annotated empty/error states; storyboard one low-friction learning slice; no API rewrite until contract freeze.
6. **Integrator:** publish consolidated baseline and one-page go/no-go decision; then assign a *single* vertical-slice implementation milestone and explicit owning branches.

## 18. Primary sources and repository references

### Independent public technical references

- [Lichess: Accuracy metric, exact published formula and explicit limitations](https://lichess.org/page/accuracy). No universal accuracy scale; volatility-weighted and harmonic aggregation described publicly.
- [Chess.com: CAPS2 and score distribution](https://support.chess.com/en/articles/8708970-how-is-accuracy-in-analysis-determined). Explains why their grading distribution intentionally differs, without publishing full model parameters.
- [Chess.com: Game Review vs Self Analysis](https://support.chess.com/en/articles/8584089-how-does-game-review-work). Product reference, **not** independent chess truth.
- [Chess.com: Analysis depth / server-vs-client](https://support.chess.com/en/articles/8708936-what-is-analysis-depth-what-does-it-mean). Analysis configurations are not directly comparable by default.
- [Official Stockfish FAQ](https://official-stockfish.github.io/docs/stockfish-wiki/Stockfish-FAQ.html). Version, Threads, Hash and runtime considerations.
- [Lichess usage and licensing terms](https://lichess.org/terms-of-service) and [public puzzle database](https://database.lichess.org/#puzzles). Follow actual asset licenses and platform rules.

### Repository evidence

- `docs/agent-handoffs/integration-20261111.md`: four-agent ancestry, combined validation, contract notes and limitations.
- `docs/audits/frontend-2026-11-09/IMPLEMENTATION_WAVE_1.md`: verified frontend changes, outstanding issues and nonclaims.
- `docs/design-system.md`, `docs/contracts/`, `docs/ONE_TIME_CHESSCOM_HISTORY.md`, `docs/LOCAL_GITHUB_UPDATES.md`: existing UI/data/deployment architecture.
- [PR #17](https://github.com/MousaXD/patzer/pull/17): separate scoring correction and migration **not merged at snapshot**. Recheck its state before any implementation.
- `THIRD_PARTY_NOTICES.md`: GPL constraints of Stockfish/chessground and CC0 origin of Lichess puzzle material; re-audit if assets/engines change.

**Last note:** a plan is not a tested implementation. Every milestone must replace assumptions with measured evidence and leave the user's data safer than before. The owner controls when the agents start and when anything reaches production.
