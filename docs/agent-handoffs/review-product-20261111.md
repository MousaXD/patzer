# Agent C — Game Review practice vertical slice

Date: 2026-11-11 · Lane: Review Product & Accessibility

## Baseline and ownership

- Isolated clone started from `origin/main` `51df1d852296e5f0644127a81b5ec31109c8e6c1`; branch `agent/review-product-20261111`.
- Historical `agent/review-experience-20261110` (`d0c14a7`) was already integrated into this main baseline. Reviewed its handoff; did not replay previous fixes.
- Read `docs/review-excellence/{MASTER_PLAN,BENCHMARK_SPEC,AGENT_BRIEFS}.md` from the read-only planning worktree. Planning docs remain coordinator-owned and were not changed.
- Compared other historical agent branches: no overlapping Game Review modifications at the comparison point. PR #17 (`fix/accuracy-aggregation-bias-20261111`) remains separate, open and unmerged. No backend, auth, SQLite, global CSS, updater, scoring or shared DTO edits.

## Reproduced gap and before/after

**Before:** Game Review highlighted mistakes and allowed free legal variations with Stockfish scoring, but there was no isolated answer-hidden retry. A player had to explore while the original engine-best arrow, mistake explanation, PGN and evaluation graph could disclose the solution.

**After:** For analyzed blunders, mistakes, inaccuracies and misses, the Moves tab offers **Learn from this mistake — try blind**. This replaces the normal Review workspace with an isolated panel showing only the saved position *before* the error. The engine move, original move, graph, coach prose, evaluated report and saved move list are not mounted. The user can drag a legal move on the board or enter a UCI move as a keyboard/text-input alternative. One local move is submitted; the authenticated existing `/api/analyze/variation-move` endpoint evaluates it on the exact FEN. While checking, the UI says so; on engine failure it offers retry, without suggesting a verdict. Only a structurally verified matching result reveals classification, win-chance loss, best candidate and short variation. A return action restores the saved game/selected ply without writing or replacing the PGN.

If a background analysis refresh invalidates the selected mistake, practice displays a safe unavailable state instead of silently returning to spoiler-containing review. The global review keyboard shortcuts deliberately yield to practice. Entering practice aborts any in-flight live engine-lines request; a pending attempt request aborts on reset/exit. The control receives focus again on return. A legal but engine-unscored move is **not graded**. The UI does not claim a unique best move or educational mastery.

## Verification evidence

- `npm ci --no-audit --no-fund`: completed in the isolated clone; no lock changes.
- `npm run typecheck`: PASS before final late UX cancellation tweak. Focused `npx tsc -b web --noEmit` rerun afterward.
- `npx vitest run ...MistakePractice.test.tsx ...mistakePractice.test.ts`: 4/4 PASS after strict response validation; local legal/illegal FEN, stale response, no pre-attempt answer, typed alternative, retry.
- `npm test`: first run 727 passed, **one 5-second timeout** in existing `Review.library.test.tsx` under parallel suite load; isolated rerun: **12/12 PASS**. Final full-suite rerun with `npx vitest run --testTimeout 15000`: **91/91 files, 728/728 tests PASS**. The increased timeout was explicitly applied to avoid flakiness under CPU contention; the original failure was not concealed.
- `npm run build`: PASS (server TypeScript + Vite bundle) after practice cancellation changes. Final guarded recovery state also passed `npx tsc -b web --noEmit`.
- Existing `qa/agent07/frontend-overhaul-smoke.mjs`: **35/35 PASS** real Chromium + local Stockfish using disposable SQLite, five viewport sizes × light/dark, including 1920×1080, 1440×900, 1366×768, 768×1024 and 390×844. Test artifacts live under `qa-artifacts/agentc-review-product/` (untracked).
- Targeted temporary Chromium acceptance inserted into a disposable copy of that QA script: **36/36 PASS**, including blind-mode answer-hidden assertion, illegal keyboard attempt, one legal real-Stockfish scoring attempt, 1920/768/390 px horizontal overflow checks, return to saved game and exact PGN equality. Temporary script removed afterward; evidence at `qa-artifacts/agentc-practice-validation/` (untracked).

## Limitations and integration dependencies

1. This is **one-attempt local practice**, not persistent streak tracking, motif detection, equivalence-class adjudication, hint progression or spaced repetition. Accuracy, coach facts and other future evidence fields remain owned by Agents A/B.
2. Board drag itself is not fully screen-reader-operable; the labeled UCI text input provides a keyboard alternative. No physical screen reader test was performed. Do not claim complete WCAG compliance.
3. The full Review shell still shows best moves outside practice. The practice view hides them after entry, but users who have already inspected the original explanation have not had an independent blind attempt. A truly pre-spoiler entry point from a mistake summary is a future UX improvement.
4. The existing backend scores alternatives at a bounded depth; it cannot prove a unique chess move. No new backend contract is required for this slice, but richer teaching feedback should use Agent B's validated evidence contract when agreed.
5. The isolated Chromium QA verifies a successful local Stockfish evaluation and PGN integrity, not a configured LLM, live data, Firefox, physical touch devices, 200% browser zoom or screen-reader use.
6. This branch is not merged/deployed. The integrator must check combined-tree conflicts and exact SHA CI before deciding on release.

No production instance, credentials, live database, service, updater or `main` was changed.
