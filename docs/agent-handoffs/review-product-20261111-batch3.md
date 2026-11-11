# Agent C — Batch 3: blind-move accessibility spoiler audit

Date: 2026-11-11 (Asia/Dubai) · Branch: `agent/review-product-20261111`

## Resumed checkpoint

- Began at already-pushed commit `366bb0d3b863a87736480db0c15f411d915d0d75`.
- Previous full certification: 733/733 unit tests, 35/35 broad Chromium checks, 8/8 permanent practice Chromium checks; see `review-product-20261111-batch2.md`.
- No changes to the live worktree or database, updater, auth, engine algorithms, AI coaching, score formulas, package manifests or `main`. Original saved PGNs remain immutable.

## Independently verified P1 blind-mode leak

The accessibility alternative in `web/src/components/review/MistakePractice.tsx` offered every legal SAN via `legalPracticeChoices`. SAN itself carries `+` (check) and `#` (checkmate), independently of engine rankings.

Reproduction (standard rules, synthetic position):

1. Start from the normal initial FEN, play `f3`, `e5`, `g4`.
2. At Black's turn, `chess.moves({ verbose: true })` contains `Qh4#` from `d8` to `h4`.
3. Before the player tried a move, the accessible select displayed `Qh4# (d8h4)`, disclosing the mate in one.

This falsifies the earlier blanket assertion that exposing the legal SAN list was spoiler-free. The defect was reproduced in a pure chess.js fixture before the fix; it is not an inferred design preference.

### Changed behavior

- The existing `Practice first` library entry, blind picker and Stockfish scoring are preserved. No second practice engine or new API.
- The expanded keyboard alternative now uses **piece/start-square → destination-square → explicit promotion type (when necessary)**, with choices derived exclusively from legal chess.js moves.
- The selector does not expose SAN, score, engine preferences, captures, check, mate or tactical labels. SAN is displayed **after** the player makes an attempt.
- Each destination is filtered by the chosen legal origin; changing the origin clears the destination/promotion, and changing the destination clears promotion. Submitting without a required promotion choice is disabled, preserving underpromotion support.
- The existing SAN/UCI text entry and board input remain available; they preserve normal chess legality. No move evaluation is shown unless the authenticated scoring endpoint returns a matching, validated result.

## Evidence

- `npm run typecheck`: PASS, no type errors.
- `npm run build`: PASS (server TypeScript + web/Vite build).
- `npx vitest run web/src/components/review/MistakePractice.test.tsx web/src/components/review/mistakePractice.test.ts`: **10/10 PASS**. New tests assert no `Qh4#` leakage before submission, verify Black-to-move position, four promotion choices, explicit underpromotion and proper disabled state; existing cancellation/engine/error cases retained.
- `npx vitest run --maxWorkers=2` (normal 5-second per-test timeout): **737/737 PASS across 92 files**. This is the resource-bounded runner configuration used to avoid an independently observed parallel scheduler contention; no timeout increase or global Vitest config change.
- Permanent real Chromium + local Stockfish + disposable SQLite `web/tests/review-practice.browser.mjs`: **9/9 PASS**. The added adversarial browser fixture confirms that neither document text nor the native options show `Qh4#` before choosing `d8 → h4`; it appears only *after* committing the move. The engine endpoint is intentionally forced unavailable in this negative control and the UI never fabricates a grade. All eight prior browser checks (real scored attempt, PGN immutability, cancellation, error recovery, mobile touch, light/dark responsive viewports/focus) remained green.
- Original independent Chromium smoke `qa/agent07/frontend-overhaul-smoke.mjs`: **35/35 PASS**, real Stockfish, disposable SQLite, light/dark and 5 viewport sizes; zero browser-check failures on this final build.
- Screenshot and JSON evidence stays under ignored `qa-artifacts/batch3-mate-negative-control/` and `qa-artifacts/batch3-existing-smoke/`, never committed.

## Coordination and remaining limitations

- Read-only latest remote branch check: Agent A `edc1b2e` (engine/scoring and route work), Agent B `47b571c` (verified coach claims) and Agent D `4f2b275` (benchmark). No direct modifications of Agent C's practice files detected. PR #17 `02bfe98` touches `web/src/pages/Review.tsx` from Batch 2; the integrator must reconcile the accuracy-label text with the `Practice first` link in a separate combined-tree review. Nothing was merged or cherry-picked.
- Legal destinations themselves reveal mobility (and that a move is legal), as required by a keyboard-friendly move interface; they intentionally carry no ranking or tactical conclusion. Do not claim a fully unsighted chess-learning solution or exhaustive screen-reader certification.
- No hardware screen-reader, physical mobile device, Safari or Firefox validation was performed. Synthetic Chessground touch testing remains a Chromium emulation, not real-device evidence.
- No claim of complete checkmate-tactic verification, multiple equivalent-best adjudication, calibrated confidence, or measurable learning gain. Agent A/B versioned evidence contracts are required for richer educational verdicts.
- Next useful improvement: test visual keyboard focus with a real assistive reader; coordinate engine evidence/alternatives with A/B, and let the integrator verify the combined branch and PR #17 conflict before releasing.

The exact resulting SHA is given in `git rev-parse HEAD` and the remote push output after this report is committed; this handoff cannot contain its own future commit SHA.
