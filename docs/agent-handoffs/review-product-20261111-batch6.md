# Agent C — Batch 6: accessible FEN-based position descriptions

Date: 2026-11-11 (Asia/Dubai) · Assigned branch: `agent/review-product-20261111`.

## Continuation and source

- Resumed from pushed Batch 5 commit `ae833cc1f1f6c8f1b5b6fd7796019e8ac9f048fe` and its handoff. Previous spoiler-free retry, accurate focus handling, locally verified Stockfish feedback and saved PGN immutability remain unchanged.
- The accessibility audit identified a real gap: the practice board is graphical, and although the legal piece/destination selector supports keyboard use, players using a screen reader cannot reconstruct the positions of the opponent's pieces from those choices. The previous generic chessboard div also carried an `aria-label` without an explicit semantic group role.

## Narrow frontend improvement

1. `describePracticePosition(fen)` builds a factual current-board summary using `chess.js` only. It reports side to move, check status and every piece with its board square grouped by White/Black; malformed FEN returns unavailable instead of crashing.
2. The practice view now has an opt-in native `details` section labelled **Read board position as text**. It is keyboard operable and available before as well as after making an attempt, where it describes the updated FEN and resulting piece placement. Semantic `role="group"` + accessible names are attached to the board and textual position grouping.
3. No PGN, engine, move-analysis, score, best move, PV or AI claim is consulted in the text summary. In the synthetic Fool's Mate setup, the reader can inspect that Black is to move and the Black queen is on d8; the future `Qh4#` is not disclosed until after choosing/submitting it. After the attempted move, the summary accurately reports White to move, in check, and queen on h4 — even if engine scoring is unavailable.
4. The optional disclosure avoids lengthy 32-piece text being read automatically on every move or cluttering the smaller board layout. The existing original-view, retry, cancellation and focus workflows remain intact.

## Verification and negative control

- Focused component/unit tests: **12/12 PASS** across `MistakePractice.test.tsx` and `mistakePractice.test.ts`. New tests cover FEN-based piece counts/positions, side to move, check, invalid FEN, absence of best-move/mate-SAN hints before an attempt and update after an attempt without claiming an engine score.
- Initial focused run: **11/12 PASS** because the new test's broad text selector matched a queen's location in both the position prose and legal piece options; changing the assertion to scope to the textual description fixed the test without changing production chess behavior. Full re-run 12/12 PASS.
- Permanent Chromium + local Stockfish + disposable SQLite practice suite: **12/12 PASS** including a new screen-reader-style expanded position description assertion before/after a mate attempt, exact original PGN equality, error recovery, cancellation, focus, touch, board bounds and light/dark themes. Evidence under ignored `qa-artifacts/batch6-readable-board/`.
- `npm run typecheck`: **PASS** for server, web and test TypeScript.
- `npm run build`: **PASS**, server compilation and production Vite bundle, after the final semantic group-role correction.
- `npx vitest run --maxWorkers=2`: **739/739 PASS across 92 test files**, original five-second per-test timeout unchanged; elapsed 24.92s. This does not conceal unrestricted high-concurrency CI flakiness described in Batch 2.
- Original `qa/agent07/frontend-overhaul-smoke.mjs` with real local Stockfish and disposable SQLite: **35/35 PASS**, including the original light/dark responsive, move legality, PGN integrity, security, focus and keyboard smoke assertions. Evidence: ignored `qa-artifacts/batch6-original-smoke/`.

## Boundaries and next dependencies

- No auth, API, scoring, coach, SQLite, deployment, global CSS, updater, package or shared DTO changes. No local application process/database outside the disposable browser QA was accessed, and no changes to `main`.
- A textual FEN summary is not equivalent to actual user testing with a screen reader, Braille device or hardware keyboard; no such certification is claimed. Real board movement with keyboard remains via labeled SAN/UCI input or safe origin/destination selectors.
- The server game-detail response still contains best-move data for authenticated clients. True network-level non-disclosure of best moves requires a reduced backend practice DTO approved by Agent A/the integrator.
- The new English position labels should eventually use the product's locale resources; this batch does not claim translated German/Russian parity or modify localizations.
- Other agents' review branches remain read-only. PR #17's `Review.tsx` accuracy-label overlap with the earlier Batch 2 practice entry remains an integrator conflict/compatibility check, not something this batch overwrote.

## Final test results and SHA

All targeted and broad verification passed locally. `git diff --check` and staged-file scope are checked before pushing. The commit's exact pushed SHA must be obtained with `git rev-parse HEAD`; this tracked handoff cannot contain its own future SHA. Local screenshots, synthetic databases and engine binaries are not staged or pushed. This branch is neither merged nor deployed and has not been cross-agent integration-certified.
