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

## 2026-11-12: verify saved best-move arrows, coaching labels and PV before presentation

### Independent reproduction

- Resumed from the preceding `3389713` milestone and audited Game Review's cached advisory path. `verifiedBestAlternative` already protected the clickable preview, but the selected move header, the `MoveExplanation` prose/continuation, and the saved-game blue best arrow still rendered cached best UCI/SAN/PV without checking their exact position and move identity.
- Added an authenticated disposable Chromium interception of `/api/games/:id`: a valid saved `e4` score was given `best_move_uci=e2e4` with contradictory `best_move_san=Qh5`, invalid PV `Qh5 Qh4`; the next scored move was likewise assigned mismatched UCI/SAN. **Before correction the browser failed** because an unsupported blue best-arrow note appeared. The misleading coaching SAN was also on the original rendering path.

### Coherent correction

- Added `verifiedSavedBestMove` which compares the advisory move's `fen_before` to the exact displayed FEN, replays its UCI legally and compares the canonical SAN. `verifiedBestAlternative` now reuses that same evidence check.
- `bestMoveForDisplayedBoard` takes the displayed FEN and only exposes a live (already attested) line or a verified saved-game best suggestion; hypothetical variations cannot fall back to mainline arrows.
- The current-move summary, Key Moments alternative label, and `MoveExplanation` best-move panel now show a suggested move only when that source check passes.
- `verifiedSavedBestContinuation` replays every SAN from the matching source FEN, requires the first move to equal the verified best move and suppresses the entire invalid PV without hiding an otherwise legal best suggestion or throwing away valid saved scores.
- Updated the older static coaching-component test to use a real, legal black-to-move `e5`/`c5` alternative rather than relying on an empty FEN with a bare callback to imply verified advice. A new negative component assertion checks that fabricated suggestions remain absent even if a callback is supplied.

### Validation and evidence

- Focused `reviewPosition`, `storedReview` and `MoveExplanation.evidence` tests: PASS, including new wrong-SAN/wrong-FEN/illegal-PV cases.
- `npm run typecheck` and `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **979 passed / 12 skipped**, 107 passing test files. The first full run exposed the old invalid test fixture; corrected it and reran the complete suite to green.
- Full authenticated disposable Chromium browser matrix: **PASS (exit 0)** including the previously failing false best-arrow scenario and existing responsive, variation, PGN, keyboard, localized and legal-best-preview paths. Opened/inspected real `qa-artifacts/agent-a/best-move-after-20261112/stored-best-move-label-rejected-390.png`: scored Book e4 remains explainable, but Qh5 and the fabricated continuation do not appear. Original PGN bytes unchanged.
- All injected engine scores in browser checks remain **test-only**, not live Stockfish certifications. No production, merge or cross-agent changes.

### Next integrity audit

- The AI coach's `/api/coach/explain` request body still sends raw cached `best_move_san` and `best_pv` even when the visual presentation has suppressed those fields. Verify whether a contaminated best-move label can become fabricated LLM coaching context, then sanitize only Game Review's request facts using the same verified advice source. Do not change the shared coach interface or other agents' surfaces.

## 2026-11-12: send only verified best-move facts to the Game Review AI coach

### Browser-confirmed issue

- Resumed from clean `31bd199`, then audited the Game Review-only `/api/coach/explain` request. Although the visible best-move card now suppresses unsupported SAN/PV, the coach request still sent raw cached `best_move_san` and `best_pv` as authoritative LLM facts.
- Added a disposable authenticated Chromium fixture with an actually configured-looking CoachPanel and stub SSE reply (no external AI call). Intercepted the saved game, inserted `best_move_uci=e2e4` + impossible `best_move_san=Qh5` / PV `Qh5 Qh4`, then inspected the HTTP request body. Before the fix, the browser **failed** with `actual 'Qh5' !== expected null` for `best_san`.

### Correction and verification

- Only in `GameAnalyzer.tsx`'s `coachReq`, pass the already-verified current best SAN (or null) and a legally replayed PV from `verifiedSavedBestContinuation` (or empty array). The correct recorded move, classification, score, mover identity, game history and source remains untouched. No coach endpoint, model prompt, infrastructure or other agent's code changed.
- Focused position/coaching source tests: **20/20 passed**. `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **979 passed / 12 skipped**, 107 passing files.
- Authenticated disposable Chromium harness: **PASS (exit 0)**, including intercepted POST checking `best_san:null` and `pv_san:[]` while keeping `played_san:e4` and `classification:book`. The coaching UI still renders its synthetic test-only SSE message. Opened/inspected actual 390px screenshot `qa-artifacts/agent-a/coach-facts-after-20261112/coach-request-unsupported-best-filtered-390.png`. Full responsive, source, keyboard, locale and PGN checks also passed.
- No claim of live LLM or Stockfish accuracy certification; all intercepted outputs are disposable UI fixtures. No production SQLite change, merge or deployment.

### Next candidate

- Audit coach explanation lifecycle on a source-identical PGN **reanalyzed into a new authoritative analysis generation** while the selected ply remains the same. The `CoachPanel` currently auto-fetches by `triggerKey={move.ply}` and may retain older narration when `sourceKey` changes but ply does not. Reproduce with intercepted game-detail generations and a controlled SSE reply; fix only the Game Review source-specific lifecycle if verified.

## 2026-11-12: replace stale AI coaching when analysis generation changes

### Reproduction and scope

- Continued from clean Agent A commit `86b05f1`, auditing the mounted `MoveExplanation`/`CoachPanel` lifecycle rather than repeating earlier stale cached-prose investigations. CoachPanel auto-play used `triggerKey={move.ply}`; reanalysis can change engine scores and authoritative `analysis_generation` while the selected ply stays unchanged. Existing narration then remains visible and no new coached facts are requested.
- Added disposable authenticated Chromium scenario: intercept `/api/games/:id` with complete PGN/analysis evidence, first `analysis_generation=1`, then a bookmark-only refetch with generation 1, then an otherwise byte-identical source generation 2. Stub `/api/coach/status` and SSE outputs to label the source generation. **Before fix the browser failed** waiting for generation-2 narration while generation-1 text remained.

### Source-bound fix

- Key only the Game Review `MoveExplanation` presentation by the selected ply and the existing authoritative `reviewSourceKey` (game ID, source revision/hash, analysis generation, scoring version and engine evidence). For unverified/partial analyses, key by the available source, position and scored move facts. A new generation remounts CoachPanel, cancels its prior request and clears stale narration before fetching a new explanation; notes/bookmarks leave identity stable and avoid redundant requests. No global/shared CoachPanel or backend change.

### Independent verification

- Chromium regression: initial source-1 explanation arrived once; bookmark-only refetch kept one coach request; changed authoritative source generation triggered a new request and replaced the visible text with source-2 prose. Original generation-1 text absent. Actual 390px dark screenshot opened/inspected: `qa-artifacts/agent-a/coach-generation-verified-20261112/coach-new-generation-replaces-stale-prose-390.png`, where the source-2 explanation is visible alongside unchanged move and evaluation.
- `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **979 passed / 12 skipped** (107 passing files).
- Full disposable authenticated Chromium matrix: **PASS (exit 0)**, including source/language/variation/keyboard/PGN integrity and the new lifecycle regression. No external model or live engine accuracy was evaluated; the SSE text and analysis-generation switch were isolated test fixtures.
- No merge, deployment, production SQLite or changes to other agents' worktrees.

### Next highest-impact candidate

- Independently audit Game Review's asynchronous move-entry/variation loading and recovery when a user switches branches or returns to the saved game during a pending engine score. Some cancellation cases are already covered; focus on user-visible stale/loading indicators and keyboard focus without duplicating completed source checks. Document cross-agent dependencies rather than editing global shell or library/import surfaces.

## 2026-11-12: keyboard focus returns to the saved board after exiting a variation

### Reproduction

- Continued from clean `3d7684f` and inspected the existing Game Review variation rail. The `Return to game` button becomes disabled as soon as the unsaved branch is left, but the click handler only changed variation state. Keyboard focus did not reach a stable destination.
- Extended the authenticated 390px Chromium cross-branch scenario to focus Return and activate Enter, then assert that the saved game is restored and `.review-board-square` receives focus. **Baseline intentionally failed:** `Return to game must move keyboard focus back to the original chessboard`.

### Fix and verification

- The Game Review-only Return handler now calls the existing `jumpToBoard` in the next animation frame after `variations.restoreOriginalGame`. The board is a stable, navigable keyboard destination and on narrow viewports it is brought back into view. The branch and original PGN are not rewritten.
- `npm run typecheck`: PASS; `npm run build`: PASS.
- Complete `npm test -- --testTimeout=20000`: **979 passed / 12 skipped**, 107 passing test files.
- Full disposable authenticated Chromium matrix: **PASS (exit 0)** including the new Enter→Return→focused-board regression, all 320/390/1024px responsive checks, variation cancellation/cache isolation, locale, source verification, keyboard/coaching, and persisted PGN invariance. Matrix screenshots: `qa-artifacts/agent-a/return-focus-after-20261112/`. Browser engine scores remain synthetic fixtures, not live Stockfish certification.
- No merge, deployment, production SQLite or changes to other agents' worktrees.

### Next priority

- Audit branch-selection keyboard focus and screen-reader announcement at multiple variation buttons, including nested branches and the difference between the active branch's cursor and saved PGN position. Existing source cancellation and transport counters are certified; target only uncovered real interaction failures, especially when the chosen variation is shorter or has a different fork.

## 2026-11-12: reveal mobile chessboard when selecting exploratory branches

### Reproduced usability defect

- Continued from clean pushed Agent A commit `9d2c794` after the Return-to-game focus recovery was certified. On stacked mobile viewports, the variation selector lives *below* the chessboard. Selecting a different existing branch updated the position above the visible viewport, but left the keyboard user on the selector without seeing the new board.
- Extended the authenticated 390px Chromium two-branch scenario: select a previously created branch and require keyboard focus on `.review-board-square` with the board visible beneath the fixed 56px app header. **Baseline failed** with the focus timeout.

### Fix

- The variation button now selects its branch and, only when the viewport is narrower than 960px, calls the existing `jumpToBoard` in the next animation frame. It uses the established scroll and focus behavior without creating additional React state or changing move legality, source revisions, current branch cursor, or PGN.
- At desktop widths the selector retains focus for fast side-by-side review, avoiding unnecessary board scrolling.

### Verification

- `npm run typecheck`: PASS; `npm run build`: PASS.
- `npm test -- --testTimeout=20000`: **979 passed / 12 skipped**, 107 passing test files.
- Full authenticated disposable Chromium matrix: **PASS (exit 0)**, including mobile branch selection, Return-to-saved-board keyboard recovery, 320/390/1024px responsive checks, stale-variation source cancellation, localized controls, AI coach integrity and PGN invariance.
- Captured and independently inspected actual 390px dark screenshot `qa-artifacts/agent-a/mobile-branch-selection-after-20261112/mobile-branch-selection-reveals-board-390.png`: the `d4` position, board, `Variation d4` analysis state and correct `Var 1 / 1` counter are visible immediately after selecting the branch.
- No production SQLite changes, merges or deployments. All engine scores shown in browser fixtures are synthetic test UI values, not real Stockfish certification.

### Next lane task

- Audit nested variation-fork navigation on both 390px mobile and desktop: switching back to an ancestor or sibling branch should preserve the correct independent cursor, display the correct highlighted last move and never show the child's continuation as part of its parent. Existing legality/source checks are complete; investigate only uncovered visual or keyboard defects and add focused regression evidence before changing implementation.

## 2026-11-12: nested branch cursor identity and last-move rendering

### Exact resume and baseline

- Resumed from clean `4f3f711` and the previously recorded nested parent/child cursor audit, not from earlier source-integrity investigations. Work was confined to Agent A's worktree and Game Review code.
- `analysisVariations` retained only a *single* active leaf cursor. Choosing a saved parent/sibling branch always jumped to its final move, even after the player rewound that branch and left it to compare a different continuation. A new focused unit case intentionally **failed**: parent at `c5` (`1/2`) reopened at `2/2`. A disposable 390px Chromium branch-switch test intentionally **failed**: a rewound `Var 0 / 1` reopened as `Var 1 / 1`.

### Correction and integration audit

- Added ephemeral `variationCursors`, keyed by branch ID; snapshots the current cursor when exiting for a child, selecting another branch, returning to the saved game, choosing an original ply or undoing across the fork. Selection now restores each branch's last viewed cursor, clamped to its immutable move list. Explicit cursor selections still work for First, Last and undo/redo navigation.
- Self-audit found that the existing Last transport action relied on the old implicit jump-to-end behavior. Changed only that action to explicitly select the active branch's `moves.length`; the new browser regression catches a Last button that fails to reach the final move.
- The extended Chromium nested `e4 c5 Nf3` versus `e4 c5 d4` comparison checked actual chessground last-move squares. An initial immediate assertion observed the old highlight for one frame while the React counter already reflected the new cursor; this was a **test-timing issue**, not a persistent chessboard discrepancy. The final test waits for chessground's post-render highlight and asserts actual square transforms, making the regression deterministic without a false UI fix.

### Verified evidence

- Targeted variation controller/hook tests: **16 passed** (including the new nested cursor/FEN/PGN invariant).
- `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **980 passed / 12 skipped**, 107 passing files.
- Full authenticated disposable Chromium matrix: **PASS (exit 0)** with the nested 390px and 1024px branch comparison; parent resume at 1/2, child fork at 0/1, explicit Last, correct last-move highlights, original PGN invariance, and all earlier locale/source/keyboard/responsive checks. Opened/inspected `qa-artifacts/agent-a/nested-variation-render-20261112/nested-variation-cursors-390.png` and `nested-variation-cursors-1024.png`, showing visible child `d4` position and correct one-move branch counter. No horizontal overflow.
- Browser classifications/scores are injected UI fixtures, not real Stockfish accuracy certification. No merge, deployment or production SQLite changes.

### Next highest-impact issue

- On mobile and desktop, the branch picker shows only `Variation 1 · 2 moves` and `Variation 2 · 1 moves` without revealing the chess moves or ancestry. In nested scenarios a learner cannot tell which branch they are reopening without selecting it. Reproduce the discoverability issue, then show a concise legal SAN preview and fork relationship with translated accessible labels, keeping the UI compact and Game Review-only.

## 2026-11-12: identifiable variation choices with legal move previews

### Resumed exact unfinished work

- Continued from pushed `186f003`, the clean nested-cursor milestone. The next recorded issue was branch discoverability: variation pills showed only a number and count; a player could not tell sibling continuations or ancestry without opening them. Preserved the existing variation controller and branch identity.
- Added `analysisVariationPreview` using already-validated, immutable branch and ancestor SAN moves. The compact, newest-four-moves display differentiates sibling forks (`c5 Nf3` vs `c5 d4`) and shows ellipsis when the common opening exceeds four plies; it never invents a move or engine evaluation.
- Branch buttons now display a concise SAN preview and, for nested branches, a visible parent cue (`Fork of variation 1`). Their existing accessible button names remain stable; `aria-describedby` connects the SAN and ancestry text to assistive technology. The self-contained Game Review change preserves keyboard, click, source and PGN semantics.
- Added localized parent-fork strings for English, German, Spanish, Russian and Bulgarian, including exact `{{number}}` placeholder-parity checks.

### Verification

- New preview/unit regression intentionally failed before the helper was implemented; focused variation/localization tests **66 passed** after correction.
- `npm run typecheck`: PASS. `npm run build`: PASS.
- `npm test -- --testTimeout=20000`: **981 passed / 12 skipped**, 107 passed test files.
- Full authenticated disposable Chromium matrix: **PASS (exit 0)**, including a live nested branch test asserting rendered SAN labels, accessible description/parent relationship, independent cursors, correct highlighted squares, previous variation, source, keyboard, locale and PGN invariance.
- Opened/inspected `qa-artifacts/agent-a/variation-preview-20261112/nested-variation-cursors-390.png` and `nested-variation-cursors-1024.png`: the branch choices are distinct, legible and fit both phone and side-by-side desktop widths without horizontal overflow.
- All engine figures in browser fixtures are test-only; no Stockfish correctness certification is claimed. No merge, deployment, production SQLite or cross-agent edits.

### Next priority

- Review usability of **longer variations**: a short SAN preview is useful, but after exploring several moves, the branch timeline still presents a single truncated text string. Audit whether a player can navigate individual moves in the exploratory line without repeatedly pressing transport controls. Reproduce in Chromium and prioritize a compact, keyboard-accessible clickable variation move trail within Agent A's rail.

## 2026-11-12: clickable, source-backed variation move trail

### Reproduction and design

- Continued from clean pushed `1e82d39`. The next recorded issue was a long, plain-text variation trace: there was no direct way to return to the specific SAN move a learner wanted to compare without repeated Previous/Next presses. Added a failing unit test for legal SAN positions in a nested `c5 Nf3` / `c5 d4` branch; the helper did not exist beforehand.
- `analysisVariationTrail` derives clickable immutable move/FEN targets from the already verified branch move records and each ancestor prefix through its actual fork cursor. It never adds undone ancestor moves or synthetic evaluations. Each target identifies the correct branch ID and local cursor, keeping PGN identity and existing per-branch cursor memory intact.
- Replaced the static Game Review trace with a compact horizontal, scrollable navigation of accessible 44px+ SAN move buttons and the branch-fork position. `aria-current="step"` highlights the selected local cursor. An ancestral SAN goes to its source parent branch/cursor; a child SAN returns to the child branch; narrow viewports reveal the board after selection while desktop keeps the rail accessible.
- Added localized trail, fork-jump and SAN jump labels across English, German, Spanish, Russian and Bulgarian, with placeholder parity tests.

### Self-audit, Chromium and test evidence

- Focused variation/locale suite: **67 passed**. First localization run exposed a test expectation with unsorted placeholder order; corrected that test to match the existing canonical sorting helper, without changing translations.
- `npm run typecheck`: PASS; `npm run build`: PASS.
- `npm test -- --testTimeout=20000`: **982 passed / 12 skipped**, 107 passed test files.
- Full authenticated disposable Chromium matrix: **PASS (exit 0)**, including clickable c5 ancestor jump, child d4 return, rendered SAN buttons and 44px+ touch targets, nested cursor and chessground last-move position checks, responsive/keyboard, engine-source and saved PGN invariants. The first pass caught a snapshot timing issue (React counter ahead of chessground's last-move styles); the final test waits for actual rendered highlight change instead of changing correct product state.
- Opened actual 390px and 1024px dark screenshots `qa-artifacts/agent-a/variation-move-trail-fixed-20261112/nested-variation-cursors-{390,1024}.png`: the trail clearly shows `Branch point`, `c5`, `d4`, with active `d4`, no horizontal overflow, alongside the source-safe board and evaluation state.
- All browser scoring values are disposable synthetic UI fixtures; this is no real Stockfish accuracy certification. No merge, deployment, production SQLite or other-agent changes.

### Next high-value audit

- In a longer variation the active SAN trail move can be *outside the initial horizontal scroll viewport*. Confirm whether selecting a later move via transport or a variation branch keeps its active SAN button visible without a horizontal hunt, then add minimal reduced-motion/accessibility-friendly auto-reveal if reproduced. Do not invent artificial scores or alter the other agents' shell.

## 2026-11-12: keep active SAN visible in long variation move trails

### Reproduction

- Continued from pushed, clean `952abe6` and the recorded next issue. The new move trail horizontally overflows once a learner explores enough moves, but advancing through chessboard moves leaves the selected SAN outside the visible horizontal strip.
- Extended the existing disposable authenticated nested Chromium scenario at **390px and 1024px** using a real legal sequence `e4 c5 d4 e6 Nf3 d5 Nc3 Nc6 Be2 Nf6 a3` (chess.js move legality independently checked). After the ninth move, the horizontal move strip overflowed its container and Chromium **timed out** waiting for the active SAN to be visible, confirming the defect without synthetic engine scores.

### Focused correction

- Added a Game Review-only `variationTrailRef` and an effect tied to the active branch identity, cursor and actual trail length. It reads the rendered active `[aria-current="step"]` bounds and adjusts only the trail's own `scrollLeft` toward the nearest edge, leaving the document vertically stationary and avoiding `scrollIntoView`'s document jump. The same logic returns toward the left when navigating to a previous move/fork. No saved PGN, move legality, scoring, game revision or other agent-owned layout changes.

### Verification

- Focused variation/locale suite **67 passed**; `npm run typecheck` PASS; `npm run build` PASS.
- Full `npm test -- --testTimeout=20000`: **982 passed / 12 skipped**, 107 passing test files.
- Full authenticated disposable Chromium matrix: **PASS (exit 0)** including 9-move long-line visibility checks on 390px and 1024px, previous nested branch jumps, real last-move highlighting, responsive, source, keyboard, localization and saved PGN integrity.
- Opened actual `qa-artifacts/agent-a/long-trail-after-20261112/long-variation-active-trail-390.png`: `a3` is visibly highlighted at the right edge of the trail below `Var 9 / 9`, without page or horizontal document overflow. Real chess positions, but browser scoring values are test-only and not live Stockfish certification.
- No merge, deployment or production SQLite changes. Agent A worktree only.

### Next target

- Audit review analysis state and board feedback during a slow/in-flight exploratory move engine score, particularly when several legal moves are entered quickly. Check that the UI distinguishes *still scoring* from *failed/unavailable*, and that a late result cannot replace the latest move's label; existing stale-response checks cover some cases. Reproduce with a controlled delayed Chromium request before changing state or copy.

## 2026-11-12: truthful accessible scoring feedback under delayed engine requests

### Chromium reproduction

- Continued from clean, pushed `969c622` and the recorded asynchronous scoring feedback audit. Added a deliberately delayed authenticated Chromium `/api/analyze/variation-move` request for a real legal `d2d4`, then a newer `d7d5` scored response with source-matched synthetic quality, and finally released the obsolete first response. No real engine or persistent game was modified.
- With the first result pending, sighted players saw **`Analyzing…`** while the evaluation area's screen-reader `aria-label` incorrectly said **`Position evaluation unavailable`**. The new browser assertion intentionally **failed** with that exact difference. This incorrectly implies engine failure during a legitimate in-flight request, especially when Stockfish is slow.

### Minimal correction

- Derived the visible and accessible evaluation status from the same explicit pending/failed/source-validated state. Pending exploratory move announces `variationAnalyzing` in the current locale, completed scoring announces the actual evaluated centipawn value, and unavailable/failed states announce `variationEvalUnavailable`. Preserved the existing retry button, AbortController cancellation, quality cache and exact FEN/UCI/source revision guard without introducing new engine heuristics or fabricated scores.

### Verification and evidence

- Targeted classification/variation tests: **18 passed**. `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **982 passed / 12 skipped**, 107 passing test files.
- Full disposable authenticated Chromium matrix: **PASS (exit 0)** including pending/failed/completed accessible-name assertions, delayed obsolete source response never reviving a false Brilliant, mobile navigation, all prior source/locale/keyboard and saved PGN checks. Opened and visually inspected `qa-artifacts/agent-a/rapid-score-after-20261112/rapid-variation-scoring-status-390.png`: validated `Variation d5`, `Best`, `+0.24` are visible together with accurate board position; the prior false Brilliant never appears.
- Browser scores are injected UI fixtures, **not** Stockfish scoring certification. No merge, deploy, production SQLite mutation or other agent changes.

### Next highest-impact investigation

- Game Review's loading/empty analysis contexts for source-stale cached games: independently test that refreshing a valid saved game without engine data never describes scores as drawn (0.00), and its reanalysis action gives a useful, keyboard-recoverable result on transient engine failures. Existing imported-game and first-use work belongs to other agents; limit changes to Game Review presentation and source identity.

## 2026-11-12: localized evaluation graph slider for unscored saved moves

### Scope and evidence

- Continued from clean `cf88d99` and the no-analysis recovery audit. Existing Spanish browser checks already covered an invalid cached engine report and the reanalysis failure/retry action, so did not repeat that investigation.
- Found an uncovered Game Review-specific accessibility defect: `EvalGraph`'s `aria-valuetext` was hardcoded `Evaluation unavailable` when a move had no scored `eval_after_cp`, despite fully localized page/board/graph labels. A new static render test **failed** with the raw English announcement. A new disposable authenticated Chromium test injected `eval_after_cp:null` for the first saved `e4` move, without changing its PGN identity; **baseline failed** because the actual Spanish slider announced English rather than `Evaluación de la posición no disponible`.
- Reused the existing localized `review.variationEvalUnavailable` message for the graph's unavailable `aria-valuetext`. No graph coordinate/score/shape behavior, move legality, database, scoring or engine computation changed. The original graph already leaves unknown evaluations unscored instead of falsely presenting a 0.00 draw.
- The first focused test correction caught an overly broad `not.toContain('0.00')` assertion that matched an SVG path coordinate `100.00`; narrowed it to exclude only a fabricated `aria-valuetext="0.00"`. This was a test fixture adjustment, not a product regression.

### Verification

- Focused `EvalGraph.render` and `evalGraphModel` tests: **5/5 passed** after the correction.
- `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **983 passed / 12 skipped**, 107 passing test files.
- Full disposable authenticated Chromium matrix: **PASS (exit 0)**, including the negative Spanish unscored-evaluation case, cached-source and retry checks, previous responsive/variation/coach/keyboard regressions. The saved game PGN remained unchanged. Opened/inspected `qa-artifacts/agent-a/unscored-graph-after-20261112/unscored-eval-graph-localized-es-390.png`: Spanish review, saved first move `e4`, visibly unavailable score (`—`), graph remains navigable; slider announces the localized unavailable message.
- Test-only missing-score interception; no real Stockfish scoring certification, merge, deployment or production SQLite modification. Agent A branch/worktree only.

### Next issue

- The existing Spanish reanalysis failure test clicks Run engine with the mouse and checks the failure banner, but does not assert keyboard focus or meaningful retry after the enabled button is disabled during an in-flight request. Audit actual Chromium Enter→engine failure→retry focus and repeated request behavior. Correct only genuine Game Review interaction failures; do not change shared API error semantics or other agents' areas.

## 2026-11-12: retain keyboard retry access after failed full-game reanalysis

### Reproduction and correction

- Continued from clean `25f1a5c` and the recorded next accessibility audit. The existing Spanish Chromium fixture covered corrupt cached analysis and an engine failure after a mouse click, but did not verify keyboard Retry usability.
- Extended the **same** authenticated disposable browser fixture: focus Run engine analysis, press Enter, await actual backend POST `/api/analyze` 503 and translated recovery banner, assert focus remains on the enabled action, press Enter again, and verify a second real POST and a retryable failure. **Before fix Chromium failed**: disabling the focused native button during engine work moved focus away, and it did not return after the engine error.
- Added a stable button ref and small Game Review-only effect: after an analysis error clears the in-progress disabled state, restore focus to the enabled analysis action **only when `document.activeElement` is BODY**. This preserves native disabled semantics and avoids stealing focus from users who navigated elsewhere during the request. No shared error contract, engine behavior, source provenance, or cross-agent code changed.

### Verified evidence

- Focused analysis-error/stored-source tests: **14 passed**. `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **983 passed / 12 skipped**, 107 passing test files.
- Full disposable authenticated Chromium matrix: **PASS (exit 0)** including two sequential keyboard Enter POST requests on engine-unavailable recovery, actual Spanish error text, restored focus, a re-enabled retry action, unchanged PGN and previous responsive/source/variation/coaching cases.
- Opened and inspected `qa-artifacts/agent-a/reanalysis-focus-after-20261112/engine-retry-unavailable-es-after.png`: the Spanish error banner and focused green engine-analysis action remain accessible beneath the selected saved move.
- No merge, deployment, production SQLite mutation or other-agent edits. Browser scores/fixture annotations are not Stockfish accuracy certification.

### Next candidate

- Audit Game Review's evaluation graph keyboard slider while an exploratory variation is active. Its `current` prop becomes `undefined` to avoid a misleading saved-game marker, but the graph currently maps that undefined selection to `aria-valuenow=0` and a "Starting position" label. Verify the announced timeline position in actual Chromium and avoid presenting a false saved-game position, while preserving click-to-return functionality and localized instructions.

## 2026-11-12: truthful saved-timeline accessibility in variation mode

### Reproduction

- Continued from clean `3c3a668` and its recorded next review-semantic audit. While the player explores a hypothetical branch, `GameAnalyzer` deliberately hides the saved-game EvalGraph's current marker by passing `current={undefined}`, but the graph's screen-reader slider continued announcing an **unavailable position evaluation**. This was misleading: no original-game move was selected, and the control was a different timeline, not the current variation's evaluation.
- Added a focused static-render regression requiring the existing translated `review.variationTimelineHint` instead of `review.variationEvalUnavailable` for an unselected original graph. **Before fix the test failed**. Added an actual 390/1024px Chromium check in the nested `e4 c5 d4` variation that **failed** with `Position evaluation unavailable` vs `Original game timeline · select a move to return to the saved line.`

### Minimal fix

- In Game Review's only EvalGraph component, distinguish `current===undefined` (original timeline has no active selection during exploratory play) from a specific saved ply with missing evaluation. The former now announces the already translated original-timeline instruction; the latter continues announcing the localized unavailable score. Preserved keyboard Arrow/Home/End navigation, `aria-valuenow` keyboard-origin behavior, graph rendering and source/PGN semantics.

### Verification and evidence

- Focused EvalGraph rendering/graph-model tests: **6 passed**.
- `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **984 passed / 12 skipped**, 107 passing test files.
- Full disposable authenticated Chromium matrix: **PASS (exit 0)** including the new original timeline accessibility check on 390 and 1024px nested branches, Spanish missing-evaluation behavior, previous engine errors/retry, source, keyboard, responsive and PGN integrity. Opened/inspected actual `qa-artifacts/agent-a/variation-timeline-after-20261112/nested-variation-cursors-1024.png`: original graph remains a separate, usable saved-game rail surface with a clear explanatory heading; active exploratory branch stays independently visible.
- Browser scoring values are injected fixtures, not real Stockfish scoring certification. No production SQLite, merge, deploy or cross-agent edits.

### Next issue

- Verify that choosing a saved move from the original evaluation graph while the player is in a nested variation exits exploration cleanly and focuses the correct saved board/move details (especially keyboard slider navigation). Reproduce focus, ply and PGN behavior in Chromium before touching the existing graph or controller.

## 2026-11-12: reveal saved chessboard after evaluation-graph taps without breaking keyboard scrubbing

### Exact recovery and reproduced failure

- Resumed from clean pushed `27b4de0` and recovered an **already-uncommitted** Chromium regression for selecting the original evaluation graph while an exploratory branch is active. Preserved the existing test work rather than restarting the earlier timeline/aria-label investigations.
- The regression created a legal nested `e4 c5 d4` branch, extended it to nine child moves, and tapped the original-game evaluation graph at 390px. Baseline **failed**: saved-game progress updated, but focus/scroll stayed on the graph below the chessboard (`waitForFunction` timed out expecting `.review-board-square` focus). This was an interaction defect, not a scoring or PGN defect.

### Fix and self-audit

- Made Game Review's `EvalGraph` report whether a selection comes from a pointer click or keyboard slider navigation. On mobile, a graph tap now selects the saved original ply and uses the existing focus/scroll-to-board behavior; at desktop widths, the side-by-side layout stays stationary. Keyboard End/Arrow navigation deliberately **keeps focus on the graph**, so a learner can scrub multiple saved moves without focus being stolen after the first arrow.
- The expanded authenticated Chromium test verifies the clicked saved move's SAN and exact FEN via the existing Copy FEN action against a legal replay of the untouched saved PGN, not merely a changed counter. It then resumes the nine-move exploratory branch, presses End and ArrowLeft on the graph, and checks exact ply counts, `aria-valuenow`, slider focus, and unchanged saved PGN on both 390px and 1024px viewports.

### Verification

- Focused EvalGraph/model/variation tests: **22 passed**. `npm run typecheck`: PASS. `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **984 passed / 12 skipped**, 107 passing test files.
- Full disposable authenticated Chromium matrix: **PASS (exit 0)** including graph pointer/keyboard controls, FEN/PGN identity, nested branches, mobile/desktop screenshots, error recovery, source, scoring and accessibility cases. Independently opened actual `qa-artifacts/agent-a/graph-return-after-20261112/variation-graph-return-board-{390,1024}.png` and `variation-graph-keyboard-scrub-{390,1024}.png`: the phone view reveals a saved `c3` position (7/24), desktop remains side-by-side, and keyboard focus outlines the graph at saved 23/24.
- All browser engine scores remain **synthetic fixture values**, not Stockfish accuracy certification. No merge, deployment, production SQLite mutation or modifications outside Agent A.

### Next high-impact issue

- `MoveList` in the Game Review right rail still uses `onSelect={setPly}`. On 390px mobile, choosing a saved SAN from that list likely changes the offscreen board without revealing it, just as the evaluation graph did before this fix. Audit the actual nested-branch-to-saved-MoveList workflow in Chromium, with keyboard focus preserved for list navigation if appropriate. Correct only if reproducible; keep desktop side-by-side and original PGN intact.

## 2026-11-12: mobile SAN move-list navigation without breaking keyboard review

### Reproduction and fix

- Continued directly from clean pushed `b6414da` into the recorded move-list navigation gap. From a legal nine-move nested exploratory branch, a 390px phone tap on the original saved SAN `1.e4` updated the selected ply but left the board out of view. An authenticated Chromium baseline **failed** waiting for `.review-board-square` focus after the tap. This was distinct from the already fixed original evaluation graph input, and was not previously investigated.
- `MoveList`/`MoveRow` now preserve the input origin for a SAN selection (native click `detail===0` for keyboard/assistive activation, otherwise pointer). Reused a single Game Review-only `selectSavedFromRail` handler for the evaluation graph and move list. A mobile **pointer** tap restores focus/scroll to the saved chessboard; keyboard Enter leaves focus on the selected move button so learners can continue selecting adjacent moves. Starting-position selection uses the same input-origin handling. Desktop side-by-side scroll remains stationary. Move, score, branch, PGN, and source semantics are unchanged.

### Verification

- Focused MoveList/MoveRow/EvalGraph tests: **10 passed**. `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **984 passed / 12 skipped**, 107 passing test files.
- Full authenticated disposable Chromium matrix: **PASS (exit 0)**, including 390/1024px pointer selection of saved `1.e4` while leaving a nine-move child branch, saved move highlight, correct ply count, mobile board focus/reveal, desktop stationary scroll, keyboard Enter on `1.e4` then `1...e5` keeping focus on each list button, and original PGN invariance. All previous branch/graph/keyboard/source/coach/responsive checks remain green.
- Opened/inspected actual `qa-artifacts/agent-a/movelist-return-after-20261112/variation-movelist-return-board-{390,1024}.png` and `variation-movelist-keyboard-{390,1024}.png`: phone tap displays saved `e4` board above the fold; keyboard focus visibly remains on selected `e5` within the original history; desktop shows board and selected SAN side by side without layout overflow.
- Browser scores are synthetic fixture values, not Stockfish certification. No merge, deploy, production SQLite mutation or other-agent edits.

### Next scope-specific issue

- Audit review move-list tactile and accessible targets: SAN cells currently use `min-h-10` (40px), unlike the 44px+ high-value navigation controls, and the list's `Starting position` row is even shorter. Verify actual 320/390px Chromium hitboxes and whether SAN buttons clip long localized or check/checkmate text. If a genuine reachability issue is confirmed, fix it in Game Review's MoveList/MoveRow without touching Agent B's global design system.

## 2026-11-12: accessible 44px Game Review move-history touch targets

### Exact recovery, reproduction, and narrow fix

- Resumed from clean pushed `9481f09` and the unfinished Chromium measurement of the Game Review Starting Position and SAN move-list buttons, without repeating previous navigation/source investigations. Recovered one dirty browser test addition. Its first attempt was blocked only by an incorrect capitalized locator; the English UI intentionally labels the action `starting position` (lowercase), so corrected the test selector without changing the product.
- The corrected **320px real Chromium hitbox regression intentionally failed**: Starting Position was **268 x 32px**; White e4 and Black e5 SAN buttons were each **116 x 40px**. This was a real small touch-target defect compared with surrounding 44px filter/transport controls.
- Raised only `MoveList` Starting Position and `MoveRow` SAN buttons to Tailwind `min-h-11` (44px), retaining move positions, classification icons, two-column layout, keyboard semantics, and source handling. Updated existing static move-list/row tests to assert the new minimum sizing.

### Verification

- Focused MoveList/MoveRow unit tests: **7 passed**. `npm run typecheck`: PASS. `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **984 passed / 12 skipped** across 107 passing test files.
- Full authenticated disposable Chromium browser matrix: **PASS (exit 0)**, covering the new measured targets on both phone widths, classification filter navigation, nested variations, scoring source, coaching, keyboard and saved PGN integrity.
- Actual measured rendered hitboxes **after** the fix:
  - 320px: Starting Position **268 x 44px**; White e4 and Black e5 **116 x 44px** each.
  - 390px: Starting Position **338 x 44px**; both SAN buttons **151 x 44px**.
  - 1024px: Starting Position **312 x 44px**; both SAN buttons **138 x 44px**.
- Opened/inspected `qa-artifacts/agent-a/move-targets-after-20261112/review-move-list-targets-320.png` and `review-move-list-targets-390.png`: selected Qd7 and accompanying move classifications remain legible, with aligned SAN columns and no horizontal overflow. Screenshot fixtures use synthetic chess evaluations, not live Stockfish certification.
- No merge, deploy, production SQLite change or other-agent worktree modifications.

### Next high-impact interaction candidate

- The Game Review global Left/Right keyboard shortcuts remain active when a SAN move button holds focus. They advance the saved ply, but the DOM focus may remain on the *previous* SAN, causing assistive technology to announce the wrong highlighted move. Reproduce the focus/selection discrepancy using a real Chromium keyboard sequence, then scope any fix to MoveList and preserve global shortcuts elsewhere, including the board and original evaluation slider.

## 2026-11-12: synchronize move-history keyboard focus with saved SAN navigation

### Reproduction and correction

- Continued from pushed, clean `cd0b5e9`; investigated the recorded next move-history keyboard defect without redoing the successful touch-target audit.
- In the authenticated 390px/1024px move-history browser scenario, focus `1…e5`, press ArrowRight, and verify both selected ply and DOM focus. **Baseline failed:** the global Review shortcut advanced to ply 3 (`Nf3`) and highlighted the correct SAN but **left keyboard focus on the previous `e5` button**. Assistive technology therefore continued announcing an out-of-date move while the board showed the next one.
- Added stable, Game Review-only `data-review-ply` attributes to Starting Position and each saved move. Within `MoveList`'s region, ArrowLeft/ArrowRight/Home/End now navigate from the focused SAN, stop propagation to the unrelated global handler, update the current saved ply as a keyboard action, and move DOM focus to the newly selected SAN in the next animation frame. Existing pointer-to-board behavior and all shortcuts outside the move-list region are preserved. Source identity, legal moves, variations, scoring and persisted PGN were not changed.
- Kept the implementation local to `MoveList`/`MoveRow`; no global keyboard or design-system edits. Added static tests verifying the stable ply attributes.

### Verification and evidence

- Focused MoveList/MoveRow/saved-timeline tests: **10 passed**; `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **984 passed / 12 skipped**, 107 passing test files.
- Full authenticated disposable Chromium matrix: **PASS (exit 0)** including real keyboard Enter on successive SANs, ArrowRight e5→Nf3 with matching focused and selected move, Home focusing Starting Position, End focusing final `12…Rad8`, 390/1024px visual checks, saved PGN unchanged, previous responsive/source/coach/variation and translation checks.
- Opened and inspected actual `qa-artifacts/agent-a/movelist-keyboard-after-20261112/variation-movelist-keyboard-{390,1024}.png`: visible focus outline and current-move highlight agree on `Rad8`; 390px rail scrolls to show the selected 12th Black move without vertical page hijack.
- Browser evaluations remain synthetic QA fixtures, not Stockfish scoring certification. No merge, deployment, production SQLite mutation or edits to other agent worktrees.

### Next candidate

- Audit the static MoveList empty state and phase separators for screen-reader discoverability. The empty message is currently hard-coded `No recorded moves.` in English, while every other Game Review state is localized, and phase dividers are plain text instead of navigable section labels. Confirm a genuine user-facing localization/accessibility defect in a five-language rendered test and fix narrowly in MoveList rather than touching the global shell.

## 2026-11-12: same-side Up/Down keyboard navigation in saved move history

### Exact unfinished resume and browser reproduction

- Continued from clean pushed `02ee331` and the uncommitted next keyboard check. In the two-column move list, Left/Right/Home/End already kept focus aligned with the selected SAN; ArrowDown on Black `1…e5` did nothing instead of navigating vertically to Black `2…Nc6`. A new authenticated Chromium assertion **failed** waiting for the actual saved ply `4 / 24` after ArrowDown.
- Added MoveList-scoped ArrowDown/ArrowUp behavior: move two plies to the same side's next/previous row, clamp at the actual saved-game final ply, and return to Starting Position when moving above the first row. The existing left/right one-ply navigation and Home/End behavior remain. Stopped propagation to the global Review keyboard handler only for focused saved move buttons. No changes to board, saved PGN, analysis sources, or other agents' key handlers.
- The first post-fix browser run passed selection/progress but raced the animation-frame focus adjustment when returning from `Nc6` to `e5`. **Not a persistent product focus failure**; the corrected browser regression waits for the actual focused `data-review-ply` after React updates and the next animation frame. All subsequent focus checks use this observed DOM condition rather than an immediate assertion.

### Verification

- Focused MoveList/MoveRow/saved-timeline tests: **10 passed**, typecheck PASS, production build PASS.
- Full `npm test -- --testTimeout=20000`: **984 passed / 12 skipped**, 107 passing test files.
- Full authenticated disposable Chromium matrix **PASS (exit 0)**. On both 390px and 1024px, test covered Black's `e5 → Nc6 → e5` with Up/Down and focus synchronized, Left/Right/Home/End, Down at final `12…Rad8` staying on the same valid move, Up to `11…Qd7`, and Down back to `12…Rad8`. Previous nested-variation, loading, source-integrity, mobile, and PGN invariance tests also passed.
- Independently opened `qa-artifacts/agent-a/movelist-vertical-verified-20261112/variation-movelist-keyboard-{390,1024}.png`: actual browser highlight, focus outline and last saved move all agree. No horizontal overflow or mobile navigation regression. Browser classifications/score values remain QA fixtures, not live Stockfish certification.
- Did not merge, deploy or touch production SQLite. Work confined to Agent A's dedicated worktree.

### Next scope issue

- The MoveList empty message `No recorded moves.` is hard-coded English while Game Review's other empty states support all five locales. Verify in a component render for an analysis-less/empty saved game and improve only this Review-specific text. Investigate whether phase banners and starting-position announcements stay sensible for a valid zero-move PGN, without changing PGN or analysis source requirements.
