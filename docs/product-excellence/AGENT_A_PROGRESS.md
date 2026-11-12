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

## 2026-11-12: keyboard Retry focus continuity

### Reproduction and fix

- Resumed exactly from Agent A commit `7f50e42` with clean worktree and the pending browser focus audit.
- Updated the disposable Chromium source-mismatch/retry fixture to **focus Retry, activate Enter, await its repaired engine score, then inspect `document.activeElement`**. Before the fix, the test failed: `tag: BODY`, `onMoveSummary: false`.
- The selected-move summary is now a persistent programmatically focusable group with an explicit focus-visible outline; activating Retry uses a common handler and moves focus to that summary after the disappearing Retry button unmounts. It retains the current selected variation identity, score, engine-request cancellation and source gating.
- Browser fixture now checks keyboard focus, recovered source-matched classification, hidden mismatch warning and preserved saved PGN.

### Verification

- `npm run typecheck`: PASS.
- `npm test -- --testTimeout=20000`: **964 passed / 12 skipped** (107 passed test files, 2 skipped).
- `npm run build`: PASS.
- Disposable authenticated Chromium harness: **PASS (exit 0)**, including the new keyboard Enter/focus assertion, 320/390/1024px checks, locale matrix, stale engine responses, source mismatch and recovered scoring, and unchanged PGN. Captures: `qa-artifacts/agent-a/retry-focus-fixed-20261112/`.
- Browser fixtures include synthetic quality data, not independently certified Stockfish scores.

### Next

- Audit another source-accuracy boundary within Game Review: live engine-line payloads may carry a legal UCI but an inconsistent SAN/PV description. Verify whether mismatched move descriptions can reach the UI before patching. Any correction must preserve position/source identity and not manufacture analysis.

## 2026-11-12: source-safe live engine-line move names and continuations

### Baseline and diagnosis

- Audited `verifiedPositionEngineLines` in the Game Review presentation boundary. It previously accepted any legal `uci` from the requested FEN while trusting an unrelated `san` and arbitrary `pv_san` strings. This could label a clickable e2e4 as "d4" or display an illegal explanation line. The server normally derives SAN by replaying UCI, but a stale/corrupted/inconsistent HTTP payload must not be treated as verified coaching.
- Added a targeted failing unit test: `uci=e2e4`, `san=d4`, `pv_san=[d4]` was accepted despite a correct FEN. Baseline result **FAIL** with the mismatched line returned instead of `null`.
- Added real authenticated disposable Chromium interception for `/api/analyze/position` to return the same mismatched FEN-valid result. Baseline browser **FAIL** (the UI never showed the expected unavailable/retry recovery state), confirming the malformed response escaped the source guard.

### Minimal fix

- Check exact legal first-move UCI and canonical SAN, require a nonempty PV of at most the backend's 8 SAN plies, and replay each SAN move against the requested FEN with `chess.js`, validating canonical notation and the first move's UCI. Bad data rejects the entire response rather than inventing a corrected score or misleading move label.
- Added unit cases for mismatched SAN, mismatched first PV move, empty PV, illegal later continuation and unparseable SAN; preserved the valid legal PV path.
- In the Chromium regression, the bad line disappears and the panel shows its existing unavailable/Retry state. Retry returns a valid source-matched `e4 e5 Nf3` line; clicking the validated saved move advances original ply to 1 without altering the game's PGN.

### Verification

- `npx vitest run web/src/components/review/reviewPosition.test.ts --testTimeout=20000`: **7/7 passed** (baseline new test intentionally failed before fix).
- `npm run typecheck`: PASS; `npm run build`: PASS.
- `npm test -- --testTimeout=20000`: **965 passed / 12 skipped**, 107 passed files, 2 skipped.
- Full disposable authenticated Chromium harness: **PASS (exit 0)** with new malformed-line rejection/retry/forward/PGN assertions plus previous source, variation, focus, locale and viewport checks. Opened actual images `qa-artifacts/agent-a/line-sanity-fixed-20261112/engine-line-{wrong-san-rejected,matched-after-retry}-390.png`.
- The scores in these screenshots are synthetic intercepted HTTP test fixtures, not real Stockfish analysis certification; no backend scoring, persisted PGN or production SQLite changed.

### Next highest-impact visual issue

- The real dark-mode engine-lines screenshots reveal visually weak secondary text in the error/Retry and active line row. Measure actual Chromium contrast of error guidance, move score, PV, and action text before adjusting only the review Engine Lines panel; avoid global theme changes owned by Agent B.

## 2026-11-12: Engine Lines dark-mode legibility and recovery touch targets

### Reproduction and visual audit

- Continued from `4006a3b` after inspecting the actual Chromium 390px Engine Lines screenshots. Added an explicit computed-style audit of the panel instead of relying only on visual impressions.
- Baseline dark error guidance measured **1.94:1 text contrast** against its computed background; Retry measured only **48×26px**. The browser regression intentionally failed. The projected SAN text and played marker also appeared faint in the original real screenshot.
- Scoped the change entirely to the Game Review Engine Lines panel: improved dark secondary text colors for loading, empty, error, PV, played and refreshing states; enlarged the Retry control and added a keyboard-visible focus ring. No shared theme, navigation or server code was changed.
- Added renderer-measured assertions for dark error text contrast, Retry target geometry, projected SAN contrast and played-label contrast.

### Verified results

- Actual dark Chromium: **error text 8.97:1**, **Retry 56×44px**, **PV 7.83:1**, **played marker 7.83:1**. Original error 1.94:1 / Retry 48×26px.
- `npm run typecheck`: PASS; `npm run build`: PASS.
- `npm test -- --testTimeout=20000`: **965 passed / 12 skipped**, 107 passing files.
- Disposable authenticated Chromium matrix: **PASS (exit 0)** with previous source-integrity, variation, keyboard, PGN, locale and viewport checks. Opened and inspected real `qa-artifacts/agent-a/line-readability-fixed-20261112/engine-line-wrong-san-rejected-390.png` and `engine-line-matched-after-retry-390.png` against earlier captures. No PGN/database mutation outside disposable test DB and no live Stockfish accuracy claim.

### Next issue

- Audit the Engine Lines interactive rows at 320/390px: labels remain English in translated review, and the live-line row has a small hit target. Reproduce in localized actual Chromium before deciding the smallest coherent fix. Other agents own the global design system.

## 2026-11-12: localized, touch-friendly Engine Lines actions

### Reproduced and fixed

- Continued from `7cf39b3` (clean). Audited a previously unlocalized part of the Game Review Engine Lines panel: loading and heading were translated, but engine-outage/busy/Retry messages and the interactive engine-move `aria-label`s remained hardcoded English. Interactive engine-line rows also lacked a 44px touch target.
- Added a disposable authenticated dark 390px German Chromium fixture with an intercepted 503 followed by a valid source-attested engine line. **Baseline intentionally failed** waiting for German recovery text. The fix translates `linesBusy`, `linesUnavailable`, `linesRetry`, `linesFollowMove`, and `linesTryMove` for English, German, Spanish, Russian and Bulgarian. SAN placeholders stay structurally consistent across all languages.
- Engine-line buttons now have a minimum 44px height and a visible keyboard focus outline, preserving their saved-move/try-alternative behavior and source/FEN safeguards. This change is local to Game Review; no global design or server changes.
- Expanded locale parity tests, including SAN interpolation checks. Browser asserts translated failure/retry and action names, 44px hitboxes and no horizontal overflow at both 390 and 320px. It checks the original saved PGN is unchanged.

### Verification and evidence

- `npx vitest run web/src/locales/locales.test.ts web/src/components/review/reviewPosition.test.ts --testTimeout=20000`: **53/53 passed**.
- `npm run typecheck`: PASS. `npm run build`: PASS.
- `npm test -- --testTimeout=20000`: **970 passed / 12 skipped** (107 passing test files).
- Full disposable Chromium harness: **PASS (exit 0)** with existing source-integrity, stale variation, retry-focus, locale and PGN checks. Inspected the new real German dark captures `qa-artifacts/agent-a/engine-line-localization-after-20261112/engine-lines-localized-{error-de-390,row-de-390,row-de-320}.png` (translated error/Retry, legible move labels, no overflow).
- Intercepted HTTP scores and errors are UI test fixtures, not real Stockfish certifications.

### Next candidate

- Verify that activating Engine Lines Retry with Enter preserves keyboard focus when the Retry button unmounts after a success or a pending request; the already-fixed variation scorer had a similar keyboard trap. Reproduce first in the isolated browser fixture, then fix only if confirmed.

## 2026-11-12: keyboard recovery after Engine Lines Retry

### Reproduction

- Continued from `100f845` and audited the existing Engine Lines 503→valid-response fixture with actual keyboard navigation. Focusing Retry and pressing Enter caused the button to disappear as analysis restarted and left `document.activeElement` on `BODY` after the score returned.
- A deliberately failing Chromium assertion recorded **`{tag:BODY,id:''}`** instead of keeping the user in the Engine Lines workspace.

### Fix and verification

- Added a persistent, programmatically focusable `role="region"` for the expanded Engine Lines content, labeled with the current locale's Engine Lines title; the Retry action focuses that region in the next frame after triggering the existing request. The region remains mounted across loading/error/success states.
- Keyboard regression confirms Enter→Retry→valid engine result leaves focus in `#review-engine-lines-content` and Tab reaches the first playable engine move; the saved PGN remains unchanged. Opened the real 390px dark Chromium screenshot at `qa-artifacts/agent-a/engine-line-retry-focus-after-20261112/engine-line-matched-after-retry-390.png` and inspected the visible focus ring on the playable move.
- `npm run typecheck`: PASS; `npm run build`: PASS; `npm test -- --testTimeout=20000`: **970 passed / 12 skipped** (107 passing test files).
- Disposable authenticated Chromium full matrix: **PASS (exit 0)**, covering Engine Lines keyboard focus, German localization, 320/390px touch targets, stale requests, variation source matching, and PGN immutability. Synthetic HTTP fixture scores are not Stockfish certification.
- No merge, deployment, production SQLite or unrelated-agent files changed.

### Next priority

- Inspect the actual mobile variation transport. Existing screenshots show `1 · var / 24`: the denominator is the saved mainline's length even when the transport buttons are navigating a short unsaved branch. Reproduce whether this counter miscommunicates the active branch length and whether it remains untranslated in the five supported locales before deciding a focused fix.

## 2026-11-12: truthful variation-local move progress and accessible navigation

### Baseline reproduction

- Resumed exactly from clean pushed commit `75d96fb` and the unfinished branch-counter Chromium regression.
- A one-move exploratory branch showed **`1 · var / 24`**: an ephemeral branch cursor was being compared with the **saved PGN's 24 half-moves**, even though the branch transport had only one move. The new disposable authenticated Chromium assertion intentionally **failed** with `actual '1 · var / 24'` vs `expected 'Var 1 / 1'`.
- `analysisVariations` owns the active branch's cursor and `moves.length` and supports nested variations; these are the correct local navigation limits. No new branch/PGN state is needed.

### Small scope-limited fix

- Game Review transport now renders the active variation cursor against that **active branch's own number of moves** (`Var 1 / 1`, `Var 0 / 1` at its branch point). Saved game transport remains `ply / last PGN ply`. Next/Last disabled states reuse the same active branch instead of separately looking it up.
- Added short translated progress labels and a distinct variation-navigation accessible name across English, German, Spanish, Russian and Bulgarian; the progress counter announces changes through its existing status surface, and the original-game navigation label is restored on Return to game.
- Browser assertions cover starting branch, First/Last round trip, switching between scored and unscored branches, German/Spanish localized progress, Return to game, and unchanged saved PGN.

### Validation

- Focused locale and variation controller suite: **64 passed**.
- `npm run typecheck`: PASS; `npm run build`: PASS.
- Full authenticated, disposable Chromium matrix: **PASS (exit 0)**, including existing mobile/desktop, localization, source-integrity, stale-request cancellation, keyboard focus and PGN checks. Opened/inspected real captures `qa-artifacts/agent-a/variation-counter-after-20261112/{variation-cross-branch-error-390,review-variation-active-de-390,review-variation-active-es-390}.png`: branch-local progress is readable with no horizontal overflow.
- Concurrent full suite initially had one intermittent `Settings.persistence` navigation timeout outside Agent A's code; reran that file in isolation **9/9 passed**, then reran the **entire suite alone: 975 passed / 12 skipped**, 107 passing files. Did not change Settings or other agent-owned files for the transient failure.
- Browser scores remain injected synthetic UI fixtures, not Stockfish accuracy certification. No merge, deployment or production SQLite change.

### Next target

- Audit Game Review's branch navigation and source-authority feedback when an engine result arrives for an obsolete branch after rapid switching or navigation. Existing browser tests cover stale classification and cache isolation, so inspect uncovered user-visible behavior (loading feedback, focus and remote denial) rather than repeating completed investigations.

## 2026-11-12: stored engine classification bound to exact PGN FEN/SAN

### Reproduction and impact

- Continued from clean commit `9034eca` and independently audited the cached Game Review move evidence boundary. `decodeStoredReviewJson` previously compared cached move UCI against replay UCI but **not** cached `fen_before`, `fen_after`, or SAN. Identical UCI can occur from unrelated legal positions with very different centipawn evaluations; a cached classification for one position could be shown as a false Brilliant in the saved game.
- Reproduced using real `chess.js` positions: initial `e4` versus `Nf3 d5 e4`, both legal `e2e4` but different FENs. A new unit assertion intentionally **failed** because the mismatched cached Brilliant/700cp was accepted.
- Added an authenticated, disposable Chromium test that intercepts the genuine `/api/games/:id` response and changes only the cached first move's starting/ending FEN and evaluation to that different position. Before fix, the UI **failed** to show expected stale/unreadable analysis recovery, confirming the misbound score could reach Game Review.

### Correction

- When saved-game replay positions are supplied, cached analysis must match **every analyzed ply's exact UCI, canonical SAN, FEN before and FEN after**. The decoder continues to permit valid prefix-only partial analyses, null evaluations and historical standalone decoding where no replay source is available.
- On mismatch, Game Review keeps the immutable PGN board playable, suppresses the falsely classified move and unsupported evaluation, and exposes the existing reanalysis recovery message. This is presentation source verification, not a change to server scoring semantics or provenance revision/generation rules.
- Existing decoder fixtures now provide complete replay positions; regression tests check both FEN mismatch directions, SAN mismatch and valid source-matched move acceptance.

### Validation

- Focused `storedReview` and `reviewSource` tests: **17 passed**; red test recorded prior to correction.
- `npm run typecheck`: PASS. `npm run build`: PASS.
- Complete `npm test -- --testTimeout=20000`: **976 passed / 12 skipped**, 107 passing files, 2 skipped.
- Full authenticated Chromium matrix: **PASS (exit 0)** after source check, including negative contaminated cached payload, variation identity, keyboard/locale/mobile, and persisted PGN invariance. Inspected actual 390px dark screenshot `qa-artifacts/agent-a/stored-fen-after-20261112/stored-fen-mismatch-rejected-390.png`: normal board and `W: e4` remain, score reads `—`, and clear recovery message is visible below the board. No production database changes or real-Stockfish accuracy claim (negative engine scores were simulated UI fixtures).

### Next high-impact source-integrity audit

- Key Moments summaries have their own cached `san`, `fen_before`, `classification`, `best_san`, and prose and are currently structurally checked but not bound to the corresponding analyzed ply. Confirm whether a mismatched cached moment can display a false Brilliant/mistake for another move; reproduce first, then fail closed if verified. Do not change AI prose generation contracts or server semantics without need.

## 2026-11-12: Key Moments source binding with historical FEN-game compatibility

### Baseline, defect and user impact

- Resumed from clean pushed commit `130c123` and audited the independently serialized cached `key_moments_json`. The decoder previously checked shapes but not whether a moment's SAN, source FEN, classification, centipawn loss or preferred continuation agreed with `moves_json` for that ply.
- A new unit test intentionally failed when the same scored `Book e4` was repackaged as a `Brilliant` Key Moment. Added disposable authenticated Chromium interception of `/api/games/:id`, injecting a false Brilliant moment for ply 1 without touching the scored move or the persistent PGN. Before fix, the browser failed to show the expected corrupt-analysis recovery state.
- The decoder now binds each Key Moment's classification, SAN, FEN before, centipawn loss, best SAN and best PV to its authoritative analyzed move. It rejects duplicate moment plies and out-of-range win-percentage deltas, instead of presenting conflicting coaching. Legitimate partial analyses, null evaluations and non-contradictory moments continue to work.

### Independent regression review and correction

- The first strict implementation inadvertently rejected a pre-existing **black-to-move custom FEN fixture**. Its legacy Key Moment `side` metadata used historical ply-parity convention, while the actual UI correctly derives the mover from FEN. Removed that redundant side check; kept classification/FEN/move/continuation source binding. Added a unit regression preserving legacy side metadata.
- The same fixture had an inconsistent synthetic `best_pv` (`[]` in scored move versus `['c5']` in Key Moment). Corrected the disposable test's scored move to contain the matching legal `['c5']` line; no real engine result or production database was altered. The full Chromium test then passed the black-first Key Moment, move details, and alternate-move flows.

### Verification and evidence

- `npx vitest run web/src/components/review/storedReview.test.ts` PASS (9 tests); new source-identity test failed before fix.
- `npm run typecheck`: PASS. `npm run build`: PASS.
- Complete `npm test -- --testTimeout=20000`: **977 passed / 12 skipped**, 107 passing files.
- Full disposable authenticated Chromium matrix: **PASS (exit 0)** including new negative Key Moment source test, legitimate black-first FEN Key Moment, mobile/desktop, variations, focus, locale and PGN invariance.
- Inspected real 390px screenshots `qa-artifacts/agent-a/key-moment-compatible-20261112/stored-key-moment-mismatch-rejected-390.png` (false Brilliant suppressed; saved board and recovery intact) and `black-first-key-moments.png` (correct `#12... e5` and `Opponent's move`). Browser engine responses and scored fixtures are synthetic, not real Stockfish accuracy certification.
- No merges, deployments, production SQLite modifications or cross-agent edits.

### Next source-integrity candidate

- The Key Moment `win_pct_delta` is currently range-checked but not verified against its source move's before/after engine evaluations; the black-first QA fixture shows a historical 9wp while the displayed complete -100 to +100 scores imply a different swing. Audit actual presentation and source calculation, preserve the explicit missing-evaluation fallback, and reproduce before adding a targeted check. Avoid altering server scoring semantics.

## 2026-11-12: reject impossible Key Moment win-chance swings

### Resumed unfinished task

- Recovered the exact dirty Agent A worktree at `c6ef245` with three unfinished files (`storedReview.ts`, decoder test and Chromium capture script). The prior run had already produced a complete browser matrix and negative screenshot; continued that work rather than restarting it. Original product-excellence worktree and other agent branches were not touched.
- A Key Moment `win_pct_delta` was previously only range-checked. Unit regression showed a cached moment claiming **90wp** was accepted even when two authoritative scored evaluations imply approximately 18wp. The focused regression intentionally failed before the fix.
- The stored-review decoder now checks the cached moment's absolute win-chance swing against the same Lichess centipawn-to-win-probability formula used by the server `extractKeyMoments`. Allows 0.55 percentage-point tolerance for historical whole-number rounding. Missing before/after scores keep the original replayable report path, while `KeyMomentsList` continues suppressing unsupported win-percentage labels.
- Updated the disposable black-to-move QA fixture's previously inconsistent hardcoded 9wp to the value calculated from its own scores; preserved missing-score fixture and its no-wp display check. No scoring version or server classification semantics changed.

### Validation evidence

- Focused stored review unit tests: **10 passed**, including known-evidence rejection and missing-evidence compatibility.
- `npm run typecheck`: PASS; `npm run build`: PASS.
- `npm test -- --testTimeout=20000`: **978 passed / 12 skipped**, 107 passing test files.
- Full disposable authenticated Chromium matrix: completed without assertion errors, covering the new intercepted 90wp negative test, the historical Black-first FEN case, five locales, variation/keyboard/source integrity, 320/390/1024px and saved PGN immutability. Real capture: `qa-artifacts/agent-a/key-moment-win-20261112/stored-key-moment-inflated-odds-rejected-390.png`; full matrix contains 96 screenshots. Browser scores and odds in the injected test are synthetic fixtures, not Stockfish accuracy certification.
- Never touched production SQLite, did not merge or deploy.

### Next Game Review issue

- Review the cached best-move/continuation display for unsupported or impossible coaching lines. `verifiedBestAlternative` protects its clickable preview, but `MoveExplanation` and the move header still show stored best SAN/PV as prose without proving the whole line matches the saved starting position. First reproduce a genuinely conflicting best-move label or illegal PV, then make the narrowest correction without changing real engine scoring.
