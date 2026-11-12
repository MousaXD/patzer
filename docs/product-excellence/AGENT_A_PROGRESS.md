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
