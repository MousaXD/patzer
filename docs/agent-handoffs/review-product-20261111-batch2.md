# Agent C — Batch 2 Game Review practice / accessibility handoff

Date: 2026-11-11 (Asia/Dubai) · Branch: `agent/review-product-20261111`
Previous verified HEAD: `326e8256c073072a4ca88716903310c0b67a5c01`
Baseline: `origin/main` `51df1d852296e5f0644127a81b5ec31109c8e6c1`

## Existing work respected / evidence sources

- Continued the previous `docs/agent-handoffs/review-product-20261111.md` implementation, no reinvention of the first practice flow.
- Re-read the planning worktree `docs/review-excellence/{MASTER_PLAN,BENCHMARK_SPEC,AGENT_BRIEFS}.md` and inspected the existing `Review.tsx`, `GameAnalyzer.tsx`, `ChessBoard`, `useAnalysisVariations`, variation scorer/route and prior browser harness.
- Other agent branches read-only: A `f47493a`, B `6fde1ea`, D `45445d3`; their changes do not overlap our frontend paths. PR #17 (`fix/accuracy-aggregation-bias-20261111`, `02bfe98`) remains separate and open. It edits a nearby accuracy-label line in `web/src/pages/Review.tsx`; the integrator must reconcile the UI in the combined tree. No branch merges, cherry-picks or scoring backend changes.

## Verified problems, changes and before/after behavior

1. **P1: existing practice could be spoiled before entry.** `GameAnalyzer.tsx` showed engine-best board arrows, graph, explanation, move SAN and AI report before the existing "try blind" button. The saved-game library now has a dedicated **Practice first** link for analyzed, completed games (`?practice=1`). This renders a spoiler-free picker with only practice moment order and actual mover/fullmove number. No played SAN, best SAN/UCI, graph, PV, evaluation, report or original-game board is mounted. Players explicitly choose "Open full game review (reveals answers)" to return to ordinary Review. The original in-review action is now honestly labeled as a **retry**, not a fresh unsullied attempt.
2. **P1/P2: unsafe or incomplete engine feedback.** The existing attempt endpoint stays unchanged, but the client now rejects a response unless it matches the exact before/after FEN, UCI, SAN, from/to, valid classifications/numeric fields, actual legal best move and legal SAN PV; inconsistent `is_best` and best UCI also fail closed. Score/best move is hidden during pending, error, 429, stale or aborted requests. The learning copy no longer treats a non-best UCI as a mistake when the engine labels it a sound alternative. Every score explicitly mentions bounded depth and avoids unique-only-move certainty.
3. **Keyboard / assistive input:** In addition to chessboard move input, the user may type SAN (`Nf3`, `d4`, promotion SAN) or UCI (`g1f3`), or expand a native labeled list of all legal moves. Chess.js supplies legal-only choices; no move is ordered or annotated by engine rank. Focus is restored on exit; the review keyboard shortcuts are disabled while the isolated picker/attempt is mounted; busy/error/status messages use accessible semantics.
4. **Race/data integrity:** Abort obsolete requests on reset/exit and ignore late responses; validate the current saved PGN timeline and classification before continuing a practice session. Key the component by game, ply and source FEN so an analysis-refresh position change cannot reuse an old attempt. Changing games never displays the former attempt. An invalidated source fails to a safe recovery screen rather than falling into answer-visible Review. Original PGN is never written by any practice action.
5. **Responsive handling:** Board content now has an explicit viewport-width max alongside its viewport-height cap, protecting against a board retaining an old desktop width during rapid viewport resizing. Browser assertions cover no horizontal overflow, actual board bounds, square proportions, themes and zoom-equivalent CSS viewports (not a physical browser zoom claim).
6. **Completed-game boundary:** The pre-spoiler entry is not offered for unfinished `*`/ongoing games; the practice selector also guards unfinished game results. Engine analysis, coach, auth, migrations, settings, scoring, updater and live services are untouched.

## Tests and reproducibility (observed)

- `npm run typecheck`: **PASS**, exit 0, server + web + test TypeScript checks on final source.
- `npm run build`: **PASS**, exit 0, server TypeScript + Vite production build on final source.
- `npx vitest run --maxWorkers=2` with default 5-second timeout: **PASS 92/92 files, 733/733 tests**, exit 0, on final source. New tests validate practice candidates, Black-first fullmove metadata, stale responses, SAN, keyboard option choices, cancellation and retry.
- **Timeout investigation:** Unmodified `npm test` under higher parallelism observed 730 PASS / 1 FAIL, timed-out Settings navigation. Previous batch saw a different unrelated 5s timeout in Review-library pagination. Isolated `Settings.persistence.test.tsx` + `Review.library.test.tsx` both PASS 22/22 with normal timeout; capping workers to 2 (without lengthening timeout) gave 733/733 PASS. This strongly suggests worker/CPU scheduling contention but does not prove a specific host-level root cause. We did **not** raise test timeouts globally, alter the test runner config, or mark unrestricted concurrency certified. Suggest integrator run on resource-representative CI and consider bounded worker policy if repeated.
- Permanent `web/tests/review-practice.browser.mjs` starts its own server on loopback with a new temporary SQLite database and synthetic test user/games; uses Chromium, local Stockfish, deep links, real result validation, invalid/429/stale HTTP controls, cancellation/retry, keyboard SAN, native legal-move selector, a real touch-board move, switching games, source PGN equality and light/dark viewport assertions. **No production DB, credentials, server process, upstream API or private game data accessed.**
- Browser-run findings (not obscured): the first run had 6/7 passing because test selected an arbitrary identical-named synthetic game and expected the other game's practice count; fixed the selector to exact game ID. The next run had 7/8 passing; on a fast desktop-to-phone resize, the assertion briefly saw the old 560px board width at 390px even though document overflow was zero. Added an explicit CSS viewport cap and bounded DOM stabilization assertion. Final browser outcome recorded below.
- Screenshots generated (untracked; not pushed): `qa-artifacts/batch2-practice-final-node/practice-{light,dark}-{1920,768,390}.png` with companion `results.json`. The browser QA also exercises 1440, 1366, 1152, 720px widths, and a mobile touch context.

## Remaining limits and change requests

- An already-read original explanation cannot be "unseen"; the independent first attempt is entered from the game library. Existing Review still reveals hints by design.
- The current `/api/analyze/variation-move` contract offers classification, a best move/PV, numerical loss and depth but not a proof of forcedness, equivalent-best set, engine uncertainty or structured teacher claim. We deliberately do not add unsupported UI grading logic or claim other moves incorrect. **Requested for Agent A:** a versioned candidate/equivalence + confidence/depth/evidence-status DTO when proved/tested; **for Agent B:** concise explanation driven by an evidence-validated causal/alternative contract, no speculative AI text. Integrator must approve shared contract changes.
- Native legal-move select helps keyboard/screen-reader users but is not a fully tested screen-reader chessboard. No physical assistive-tech, Firefox, hardware touch or controlled learning-gain study is claimed.
- Existing review reports may reflect cached earlier scoring versions; the integrator must coordinate PR #17's new score/prose interpretation and this `Review.tsx` addition. No data backfill authorized.
- Existing e2e requires a real local Stockfish binary and Playwright Chromium installed in the test environment. The locally ignored QA evidence was not staged.
- Branch is a draft candidate, not merged or deployed. Hosted exact-head CI and full cross-agent integrated verification are separate release gates.

## Final certification and release status

- Original independent Chromium smoke `qa/agent07/frontend-overhaul-smoke.mjs`: **PASS 35/35**, zero failures on final build, local Stockfish and disposable SQLite. Artifacts: `qa-artifacts/batch2-original-smoke`.
- Permanent focused Chromium smoke `web/tests/review-practice.browser.mjs`: **PASS 8/8**, zero failures on final build, including actual mobile touchscreen board move and PGN integrity, real Stockfish, 429/mismatch/retry and late-response cancellation, keyboard SAN and legal selector, responsive light/dark and focus restoration. Artifacts: `qa-artifacts/batch2-practice-final-node`.
- `git diff --check`: PASS. Only Agent C frontend source/tests, adjacent permanent UI browser test and this handoff are staged. Local bin symlink, Chromium evidence, fixture DB and settings are excluded from commit.
- No claim of Firefox or screen-reader device coverage, hosted CI status, production deployment or cross-agent combined-tree certification.
- Final remote SHA: see the branch HEAD after push (`git rev-parse HEAD`); this tracked handoff cannot include its own resulting commit SHA.
