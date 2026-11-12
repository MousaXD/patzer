# Agent A — Game Review & Chess Coaching Excellence

## 2026-11-12: recovered source-safe variation scoring

**Ownership:** Game Review only. **Isolation:** `agent/patzer-review-coach-excellence-20261112` worktree `patzer-agent-review-coach-20261112`. Baseline `5b5fe22` from `origin/feat/review-polish-product-excellence-20261111`.

### Recovery and findings

- Inspected branch history and verified that the unfinished `qualityMatchesVariationMove` change was not already committed in fetched history.
- Copied the three modified tracked files as an exact Git diff and the one new unit test from the original dirty worktree, then applied them only to Agent A's worktree. Never stashed, reset, committed or edited the source worktree.
- Confirmed a previously vulnerable case: an engine result can carry the requested destination FEN while identifying a different source FEN and move, making a false Brilliant/evaluation appear if validated solely by destination FEN.
- `qualityMatchesVariationMove` requires `source=variation`, matching source/destination FEN, UCI, SAN, from/to, recognized classification, and finite key evaluation/quality numbers. Both cache read and asynchronous response acceptance now use the same identity guard. Source mismatch yields the existing retry UI instead of a fabricated classification.
- Browser tests additionally cover late obsolete variation requests after returning to the saved game and reopening the branch; the PGN download test verifies exact saved source bytes and expected filename.

### Verification evidence

- `npm ci --ignore-scripts` initially omitted SQLite's native binding. First full-suite and browser attempts failed from dependency setup; `npm rebuild better-sqlite3 --foreground-scripts` corrected the isolated environment. No application fix was made for that setup error.
- `npm run typecheck`: PASS.
- `npx vitest run web/src/lib/classificationSource.test.ts --testTimeout=20000`: **2/2 PASS**.
- `npm test -- --testTimeout=20000`: **964 passed / 12 skipped**, 107 passed test files, 2 skipped.
- `npm run build`: PASS.
- `PATZER_PLAYWRIGHT_MODULE=.../playwright/index.mjs PATZER_POLISH_PORT=8929 PATZER_POLISH_OUTPUT=qa-artifacts/agent-a/source-integrity-20261112 node scripts/review-polish-capture.mjs`: **PASS (exit 0)** with disposable isolated SQLite and browser fixtures. Captures include `mismatched-variation-score-rejected-390.png`, `matched-variation-score-after-retry-390.png`, `abandoned-variation-scoring-390.png`, `dark-390x844-details.png`, `dark-1024x768-viewport.png` and responsive/light/dark screen matrix.
- All fake classifications and evaluations in browser fixtures are test-only; no live Stockfish evaluation accuracy is certified by this run.

### Scope and next task

- No merges, deployments or production SQLite changes. No other agent's worktree touched.
- Next: independently inspect usability of the *actual rendered* Game Review branch navigation and coaching panel in narrow viewport screens, identify a genuine high-impact issue and reproduce it before changing UI. If the global shell or library must change, request integration instead of editing another agent's ownership.
- Source-integrity follow-up: audit whether malformed server classification payloads (especially valid-looking but inconsistent SAN/UCI combinations) are rejected by shared API validation as well as this frontend boundary.

## 2026-11-12: per-branch error recovery and visible move-scoring feedback

### Real reproduction and correction

- Inspected the rendered 390px Chromium variation workspace. An engine failure was reported only inside the rail, below the visible first-screen board/transport. The board displayed an unavailable score, but users could not see why or retry without scrolling.
- Introduced a disposable two-branch test: d4 gets a simulated 503; c4 receives a valid, source-matched synthetic score; revisiting d4 gets another 503; revisiting cached c4 must not show d4's error. **Baseline failed with `1 !== 0`**, proving a global error string contaminated a valid cached branch. Before screenshot: `qa-artifacts/agent-a/branch-error-baseline-20261112/variation-cross-branch-error-390.png`.
- Scoped `qualityFailure` to the exact `reviewVariationScoringKey` (game ID + FEN + UCI). Pending and cancelled requests keep their existing abort/anti-stale behavior, cached scored branches remain cache hits, and Retry clears the current failure before launching a fresh request.
- Moved the one actionable error/status panel from deep in the rail to **directly below the board's selected-move/evaluation summary**. It now explains a missing score and exposes an accessible 44px+ Retry button above the fold on 390px mobile, without duplicating the error or claiming an evaluation. The branch selector and stored PGN are unchanged.
- Added browser assertions for cross-branch error isolation, cache-hit request count, immediate visible scoring feedback, Retry hitbox and PGN immutability.

### Independent verification

- Focused typecheck: PASS.
- Targeted variation/source tests: **7/7 passed** (`classificationSource`, `useAnalysisVariations`, `reviewAnalysisRequest`).
- Full suite: **964 passed / 12 skipped**, 107 passing files, 2 skipped files (`npm test -- --testTimeout=20000`).
- Production build: PASS.
- Disposable authenticated Chromium harness: **PASS (exit 0)** after the fix; all previous locale/viewport/source/PGN assertions still pass. New evidence: `qa-artifacts/agent-a/branch-error-inline-20261112/variation-scoring-failure-visible-390.png` and `variation-cross-branch-error-390.png`. Opened/inspected the visible mobile failure screenshot; status and Retry are positioned under `Variation d4` and above transport, without horizontal overflow.
- These injected 503 and engine-score values are disposable UI fixtures, **not** Stockfish scoring certification.

### Next investigation

- Verify keyboard/screen-reader focus after activating Retry: the feedback unmounts during a retry; if the focused action disappears, focus may jump to the document and force a keyboard user to navigate from the top. Reproduce in Chromium, then repair if confirmed. Other agents' shell/library/Play areas remain out of scope.
