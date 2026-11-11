# Agent C — Batch 5: accessible entry/exit focus on blind practice

Date: 2026-11-11 (Asia/Dubai) · Assigned branch: `agent/review-product-20261111`.

## Checkpoint recovered

- Resumed from the verified, pushed Batch 4 commit `8e4947608ce5cd3e80e8d629a810927d0dfeaf0f`; no previous work repeated or reset.
- Read existing Batch 2–4 Agent C handoffs and inspected the Review Excellence plan ownership, Game Analyzer, practice picker and permanent disposable Chromium test.
- Read-only remote branch comparison at the start: Agent A `7178e26`, Agent B `4c27a6c`, Agent D `7e53145` and the separate accuracy PR #17 `02bfe98`. No new overlapping Agent C practice-file changes on the other review branches. Accuracy PR #17 still changes `web/src/pages/Review.tsx`, which Batch 2 also edited; integrator remains responsible for combined-tree reconciliation. This batch changes neither file.

## Reproduced accessibility defect (before / after)

**Before:** When a keyboard or assistive-technology user clicked **Practice first** in the saved-games library, React Router replaced the library with the blind-practice picker without transferring focus. Actual Chromium DOM assertion: `document.activeElement.tagName === 'BODY'` with the whole old navigation text; **11/12 browser assertions passed, 1 failed**, the focus check. The existing attempt panel already focused its heading, but the new picker did not. The same handoff was missing when explicitly revealing the full Game Review.

**After:** On first successful mount of the blind picker, focus moves to its programmatically focusable `h1` (“Practice without spoilers”). A guarded ref ensures background data/query refetches do not steal focus from controls; returning from a move attempt retains the existing precise focus restoration to the previously chosen practice-moment button. The **Open full game review (reveals answers)** action now focuses a new `sr-only`, localized `h1` identifying the revealed Game Review and its players. This heading is accessible without adding visible layout chrome, disabling keyboard behavior or changing the board/PGN.

## Evidence / test gates

- `npm run typecheck`: **PASS**.
- `npm run build`: **PASS**, server TypeScript and production Vite.
- The permanent `web/tests/review-practice.browser.mjs` Chromium suite on real local Stockfish, loopback and disposable SQLite: **12/12 PASS** after the fix. Adds checks for focus on first library → picker navigation and picker → revealed full Review transition; existing retry → picker focus, PGN immutability, stale/429/corrupt response control, cancellation, mate-symbol secrecy, mobile touch, light/dark and seven viewport widths remained passing. Artifacts: `qa-artifacts/batch5-focus-fix/` (ignored/untracked).
- `npx vitest run --maxWorkers=2`: **737/737 PASS across 92 files**, with the default five-second test timeout (24.80 seconds overall). Earlier unrestricted-concurrency timeouts are a separately documented host scheduling concern, not proof of a specific root cause.
- Original `qa/agent07/frontend-overhaul-smoke.mjs` with disposable SQLite and local Stockfish: **35/35 PASS**, including ten light/dark responsive screenshots, keyboard traversal, focus, game isolation and PGN invariants. Evidence: ignored `qa-artifacts/batch5-original-smoke/`.

## Scope and remaining risks

- Changed only `web/src/pages/GameAnalyzer.tsx`, the permanent focused Chromium test, and this handoff. Did not touch engine scores, AI claims, auth, database, backend endpoint contracts, updater, deployment, live games, production processes, scripts or `main`.
- **Known remaining risk, not silently fixed:** The automatic `analysis_stale` guard in `GameAnalyzer.tsx` excludes the `?practice=1` picker but not a currently active in-review retry (`practicePly !== null`). A hypothetical game-query data refresh during a retry could still trigger background full analysis. The actual app query client sets `refetchOnWindowFocus: false`, so ordinary focus events do not reproduce that path; a reliable refetch trigger/negative control is needed before claiming it was fixed. This batch deliberately did not implement an unverified fix merely to show activity.
- The game detail API still returns best-move data in the HTTP payload. The DOM-level spoiler-safe picker is **not** a network-secrecy feature; a reduced backend practice DTO is an Agent A/integrator contract dependency.
- Screen reader device testing, Firefox/Safari, hardware touch, real browser zoom, integrated exact-head cross-agent release and learning outcomes remain uncertified.

## Final result

All new and existing validation gates passed locally: typecheck, production build, full unit suite, 12/12 practice Chromium checks and 35/35 original smoke checks. `git diff --check` passed. Only Agent C Game Analyzer UI, the permanent practice-browser assertion and this handoff will be staged; screenshots, test databases and engine binaries remain untracked.

After commit, use `git rev-parse HEAD` and compare it to the pushed remote; this tracked handoff cannot include its own future SHA. No claim of merged `main`, production rollout, combined-tree CI or hardware accessibility certification.
