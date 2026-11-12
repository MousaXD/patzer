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

## 2026-11-12: replay saved PGNs without Stockfish and localize zero-move recovery

### Reproduced product defect

- Continued from clean, pushed `a5c461d` and the recorded empty-history localization audit. Inspection showed a more consequential related problem: `GameAnalyzer` mounted the entire saved `MoveList` only inside `analysis && (...)`. If Stockfish was not run, had failed, or its cached analysis was unusable, the legal PGN could still be stepped through on the board but its actual SAN move history disappeared from Game Review. This prevented direct learning/navigation without an engine.
- Added disposable authenticated Spanish Chromium interception preserving the saved game but returning `analysis:null` on `/api/games/:id`, plus a separate legal zero-move PGN (`*`). **Before the fix**, the real browser failed waiting for the `Jugadas` history region. Focused empty-state/localization tests also deliberately failed for missing translation keys and hardcoded English.

### Narrow correction and independent audit

- Mounted a small, explicit Game Review-only PGN history panel when full engine analysis is unavailable. It reuses `buildSavedReviewTimeline(positions, analysis?.moves)`, the same legal replay move list, existing pointer/keyboard controls and starting FEN; no classifications, imaginary 0.00 evaluation, AI advice, or source-inconsistent scores are introduced. Run Engine remains available as before.
- Replaced `No recorded moves.` with translated `review.noRecordedMoves` (announced as status), and added a short localized explanation that saved legal moves are replayable before engine analysis is ready. Added matching natural strings for English, German, Spanish, Russian and Bulgarian and explicit locale parity tests.
- Fixed a new accessibility integration issue caught by the first post-fix Chromium run: the outer `<section aria-labelledby>` and inner MoveList both exposed duplicate named `Jugadas` regions. Removed the outer named region while retaining its visible heading; MoveList is now the single accessible history region.
- Added unit evidence that an empty but legal PGN replays to one starting position, never to an invalid/blank review.

### Verified evidence

- Focused MoveList/PGN-replay/locales tests: **59 passed**. `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **985 passed / 12 skipped**, 107 passing files.
- Full authenticated disposable Chromium matrix: **PASS (exit 0)**, including both new Spanish no-engine states, complete saved PGN navigation via `e5` (ply 2/24), no fabricated evaluated equality, correct Spanish starting position and zero-move text, and unchanged persisted PGN. All prior responsive, source, retry, variation, keyboard and AI coach checks also passed.
- Independently opened `qa-artifacts/agent-a/saved-history-no-engine-verified-20261112/saved-pgn-without-engine-{unscored,empty}-es-390.png`: the game is navigable in Spanish without an engine; zero-move games render their real initial board, `0 / 0`, and `Esta partida no tiene jugadas registradas.` The green engine action stays available for appropriate games.
- All browser engine scores remain synthetic fixtures, not Stockfish scoring certification. No merge/deploy, production SQLite mutation or other agents' edits.

### Next priority

- The partial-analysis Moves tab contains the hardcoded English status `This move is saved in the game but has no engine evaluation yet.` and an action labeled `Reanalyze the full game` which only opens engine-depth settings. Investigate in a real partial-score saved PGN whether this call-to-action actually exposes the intended recovery path, localize the status in all five languages, and ensure the retry is discoverable, labeled truthfully and keyboard recoverable. Avoid changing backend scoring/source semantics.

## 2026-11-12: recover source-valid partial engine evaluations with truthful localized direct retry

### Exact resume and baseline

- Continued from clean pushed `3d69c98` and its recorded next Game Review-specific defect: a valid saved PGN with a source-consistent cached prefix score could reach an unscored move, but the warning was raw English and its "Reanalyze the full game" control only called `setShowDepthControl(true)` below the fold, **without starting Stockfish**.
- The current backend rejects newly created prefix-only authoritative results. To audit the defensive legacy frontend path without producing impossible permanent data, a disposable authenticated Chromium route changed **only the delivered HTTP analysis response** to the first 23 source-matched moves of a valid 24-ply saved game, with no key moments or phase in the partial fixture. Persisted SQLite and PGN were not touched. The old rendered build's 390px Spanish check **failed** looking for the intended Spanish warning; the English-only message was present instead.

### Scoped correction

- Render a translated `review.partialMoveUnavailable` message (English/German/Spanish/Russian/Bulgarian). Replace the misleading depth-settings-only link with a 44px+ `review.partialReanalyze` button that calls `analyze(requestedDepth, true)` directly to force a fresh full-game engine result. Keep depth controls separately available in their existing location.
- The native `disabled={analyzing}` continues preventing duplicate requests. Extended existing focus restoration to the currently mounted missing-move retry action after a failure **only if focus has fallen to BODY**. Preserve the established no-analysis recovery focus and never steal focus from a player who moved to another control during engine activity.

### Verification

- Focused locale/MoveList/stored-source tests: **65 passed**; `npm run typecheck` PASS; `npm run build` PASS.
- Full `npm test -- --testTimeout=20000`: **985 passed / 12 skipped**, 107 passing files.
- Full authenticated, disposable Chromium matrix: **PASS (exit 0)** including historical-source-matched partial-score Spanish warning at saved `24 / 24`, direct keyboard Enter full reanalysis with `force:true`, synthetic 503 engine error translation, focus restoration and second Enter sending a second forced request; accessible 44px retry target and saved PGN invariance. Existing 390px/1024px variations, source-identity, keyboard, browser, retries and responsive checks stayed green.
- Independently inspected `qa-artifacts/agent-a/partial-reanalysis-after-20261112/partial-score-recovery-{before,after}-es-390.png`: warning/action rendered in Spanish, focus ring on retry button after the engine failure, board/evaluation layout unchanged.
- Engine 503 and prefix are **HTTP QA fixtures**, not proof that the current backend generates truncated analysis or live Stockfish accuracy. No merge, deploy, production SQLite or other-agent changes.

### Next highest-value issue

- The review's 24-ply move list can display many classifications but lacks a localized, concise explanation of what its classification icons mean to a new player; every icon has tooltip/accessibility text, but color/icon recognition is not obvious. Investigate whether existing classification legend/help is visible within the Game Review lane, especially at 320px. Do not duplicate an existing legend or change other agents' global navigation; if discoverability is already good, instead audit scoring-error banner focus on a saved (non-partial) move when the reanalysis settings are open.

## 2026-11-12: contextual classification-symbol guide for move-by-move learning

### Problem and implementation

- Continued from pushed, clean `4153e7a` and the recorded next classification-discoverability audit. Actual 320/390px Review screenshots showed the saved SAN history covered in colored glyphs without an adjacent visual key. The separate, lengthy Game Report classification-count table includes icon/label pairs, but sits much farther down the rail and does not help while reading the current move history.
- Added a Game Review-only **collapsed native `<details>` guide** immediately before the saved SAN move list. A single 44px+ `What do the move symbols mean?` disclosure maps the actual source-backed classifications in this specific saved game to Patzer's existing classification SVGs and localized names, ordered by existing `CLASS_STYLE` classification rank. Missing classifications are never invented or listed, and PGNs without engine-classified moves show no guide at all. No new scoring semantics or custom color palette.
- Added natural guide text in English, German, Spanish, Russian and Bulgarian, plus parity checks. Built focused rendering tests for class deduplication, order, icon pairing and the absence of a misleading guide when scores are missing.

### Browser self-audit and verification

- The first Chromium expansion test correctly left focus on the native summary, then an unrelated preexisting tab-navigation test failed because it assumed focus had remained on the Moves tab. This was **test-state contamination**, not a UI failure. Restored focus to the Moves tab before that independent Arrow-key assertion rather than changing the native accessible disclosure behavior.
- Focused new guide/Game Report/localization tests: **56 passed**. `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **987 passed / 12 skipped**, 108 passing files.
- Full disposable authenticated Chromium matrix: **PASS (exit 0)** including keyboard Enter to open/close the guide at 320px, 390px and 1024px, exactly matching SVG and label counts, present Brilliant/Blunder/Forced categories, no duplicates, 44px touch targets, zero horizontal overflow and correct keyboard Moves-tab navigation afterward. Valid PGNs without engine data show no fictitious classification guide, and prior nested/retry/source/PGN/mobile checks remain green.
- Independently inspected `qa-artifacts/agent-a/move-symbol-guide-verified-20261112/review-move-symbol-guide-{320,390,1024}.png`: translated label/action is immediately above the saved SAN history, icon/name pairs remain readable in narrow rails, and desktop shows a compact two-column key without covering the board. Scores remain synthetic browser fixtures, not Stockfish accuracy certification.
- No merge, deployment, production SQLite mutation or changes to other agents' owned areas.

### Next high-impact candidate

- The Game Review move list renders opening/middlegame/endgame boundaries as plain styled `div` labels. The report offers phase breakdowns, but keyboard/screen-reader players cannot jump between phase headings inside the move history itself. Audit DOM semantics and actual marker positions for black-to-move/FEN-start games before adding any in-list heading semantics. Avoid changing phase calculations or redundant global navigation.

## 2026-11-12: zero-move Game Review never launches empty full-game engine jobs

### Reproduction and narrow correction

- Continued from clean pushed `df29155`. The existing 390px Spanish browser screenshot for a valid PGN `*` showed `0 / 0` and `No recorded moves` but also offered a green `Run engine analysis` action. Source inspection confirmed the current backend still launches an initial Stockfish evaluation for this zero-ply PGN despite having no played move to classify or learn from; it was a misleading, wasteful full-game action. No backend mutation was needed.
- Only in Game Review, hide the full-game engine button when the authoritative replay has <=1 position (zero played moves), and guard `analyze()` against a zero-move call, including an automatic stale-refetch path. Keep the actual chessboard and legal starting-position exploration functional; keep the recorded PGN untouched.
- Reused the existing PGN-only history and its localized `No recorded moves` state. Added five-language `review.noMovesToAnalyze` guidance explaining that there are no played moves to score and the initial position is still explorable. A nonempty saved game retains the normal analysis action and explanation.

### Verification

- Focused locale, MoveList and legal zero-PGN replay tests: **59 passed**. Typecheck PASS; production build PASS.
- Full `npm test -- --testTimeout=20000`: **987 passed / 12 skipped** over 108 passing files.
- Full authenticated disposable Chromium matrix **PASS (exit 0)**. For a 24-ply Spanish PGN without engine evidence, verified the normal run-analysis action and playable SANs remain. For a legal zero-ply Spanish PGN, verified the localized no-moves guidance, absence of the Run Engine button, `0 / 0` progress, correct selected Starting Position and no English fallback. Previous 320/390/1024 responsive/source/variation/error/keyboard tests remained green; no persisted PGN changed.
- Opened `qa-artifacts/agent-a/zero-move-engine-guard-20261112/saved-pgn-without-engine-{unscored,empty}-es-390.png`: no misleading analysis action for the zero-move game, board still readable and initial position offered, and the normal game keeps its green analysis action.
- All engine evaluations in browser tests are fixtures, not live Stockfish accuracy certification. No merge, deployment, production SQLite change or edits outside Agent A's worktree.

### Next scoped issue

- Inspect MoveList's phase boundaries for a start ply on Black's half of a paired row, or for a SetUp/FEN game starting with Black to move: the phase banner currently snaps to the whole row, which can place the label before a White move that belongs to the prior phase. First reproduce with synthetic `phaseSplit` source coordinates and actual rendered DOM, then fix only if the boundary is demonstrably misplaced. Preserve the two-column history, semantic headings and PGN identity.

## 2026-11-12: show phase transitions at the exact saved move, including Black replies

### Reproduction

- Continued from clean, pushed `24ff442` and the recorded phase placement audit. Game Review's two-column `MoveList` previously reduced `phase_split.{middlegame,endgame}.from_ply` to the *pair* containing that ply and rendered its banner above the entire pair. When a phase began with Black's reply, its banner appeared **before the prior White move**; this incorrectly assigned the White move to the next game phase.
- Added two static HTML regressions with exact saved ply boundaries, including a game starting Black to move from a SetUp/FEN fullmove 12. Both intentionally **failed before the correction** because their phase headings preceded the preceding White SAN.

### Minimal correction

- Replaced pair-index-based phase placement with an exact `from_ply` map. At a normal start-of-pair transition, keep the existing row/banner layout. If a phase begins at Black's half of a pair, render White's half-row, the phase banner, then Black's half-row; hide the repeated visual move number on the second row without changing its saved SAN/accessible move number. Keep two columns and the existing MoveRow navigation, classifications, scoring, focus and click handlers.
- Use native `<h3>` phase headings, so keyboard/screen-reader users can navigate actual section headings. No new phase computation, synthetic scoring policy, or PGN/source changes.

### Verification and visual evidence

- Focused MoveList, MoveRow, and pairing-model tests: **13 passed** including two new exact-boundary/FEN regressions.
- `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **989 passed / 12 skipped**, 108 passed test files.
- Full authenticated disposable Chromium matrix **PASS (exit 0)**. Injected a test-only `phase_split_json` with an Endgame starting at saved Black ply 22 of the same source-aligned 24-ply PGN. At 320px, 390px, and 1024px, asserted DOM order `White ply 21 → Endgame heading → Black ply 22`, all three navigable phase headings, continued selected Black SAN, and unchanged saved PGN. Existing source, variation, keyboard, retry, review and responsive checks stayed green.
- The first browser run passed the new DOM/visual assertions but hit a **test variable scope error** in the final PGN invariance check; corrected the fixture to capture its own original PGN, then reran the entire browser matrix successfully.
- Opened/inspected `qa-artifacts/agent-a/phase-boundary-verified-20261112/phase-boundary-black-{390,1024}.png` and the initial 320px reproduction screenshot. The phase section appears clearly between `11.Nf1` and `11...Qd7`, and the latter remains highlighted; no overlapping symbols or horizontal overflow.
- Phase scores in HTTP fixtures are illustrative test metadata only, **not** Stockfish scoring certification. No merge, deployment, production SQLite mutation or cross-agent edits.

### Next candidate

- Recheck Game Review's short-keyboard workflow around a split phase row: From Black's selected phase-start SAN, ArrowLeft should move to the preceding White SAN, and ArrowRight should restore Black's selected position and keyboard focus. Existing keyboard tests cover ordinary rows; add a focused test with a phase boundary and repair only if the split changed keyboard behavior. Then investigate source-safe move detail labels if no focus defect is found.

## 2026-11-12: keep global chess shortcuts out of focused move-symbol disclosure

### Reproduction and correction

- Continued from clean pushed `f7cc6a2`. The new classification-symbol guide is a native `<details>/<summary>` element. The Game Review window-level Home/End/Arrow keyboard listener excluded fields, sliders and tablists, but **not** a focused summary. As a result, using Home while reading the guide silently rewound the saved board.
- Extended the existing authenticated 320/390/1024px guide test to focus the summary after toggling it and assert Home and ArrowRight cannot change the current saved ply. The **baseline Chromium run failed** with exact evidence: `22 / 24` became `0 / 24` after Home on the focused summary.
- Added `summary` to the Game Review-only set of interactive elements exempt from global chess navigation shortcuts. This avoids hijacking the disclosure's keyboard context while preserving arrow/Home/End shortcuts in non-interactive review areas, the independent MoveList handler, and the evaluation graph's native slider.

### Verification

- `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **989 passed / 12 skipped**, 108 passing files.
- Full authenticated disposable Chromium matrix **PASS (exit 0)**. The new guide-focused Home and ArrowRight checks passed at 320px, 390px and 1024px, with unchanged saved ply. Previous native disclosure toggling, return to Moves tab, board shortcuts, nested variations, source-integrity, responsive checks and saved PGN invariance remained green.
- Browser fixture evaluations remain synthetic, not live Stockfish accuracy certification. No merge, deployment, production SQLite mutation or edits outside Agent A.

### Next highest-value investigation

- Mate-in-N source presentation: `EvalBar` already supports an explicit `mate` prop, but GameAnalyzer currently passes only a centipawn value and prints `fmtCp` in the move summary even if its verified saved/variation analysis includes `mate_after`. Reproduce this with exact source-backed mate fields in a browser fixture, verify White/Black score sign and orientation, and show mate labels without fabricating checkmates. Avoid modifying scoring algorithms or source identity.

## 2026-11-12: preserve exact source-bound mate distance in Game Review board scores

### Recovered task and source audit

- Continued from clean pushed `a05cc23`; no previous investigations repeated. The authoritative analysis and variation scorers store signed, White-perspective `mate_after` alongside normalized `eval_after_cp`, but GameAnalyzer fed only cp to an `EvalBar` that already accepted a mate field. The board and current move summary thereby collapsed exact `M3` / `−M2` into generic `#` / `−#` even when a consistent mate count existed. The original build **failed** authenticated Chromium waiting for `Mate in 3 for White` at source-aligned saved `1.e4`.
- Traced both `server/src/routes/analyze.ts` and `server/src/chess/variationScoring.ts`: nonzero mate values use White-perspective sign, and `mate_after=0` can denote a terminal checkmated side-to-move without containing the winner's sign. A blind `mate<=0 => Black wins` interpretation would be false.

### Correction and source-integrity self-audit

- Added Game Review-only `reviewMateScore.ts` to interpret finite, signed, nonzero integer mate counts; the existing normalized cp score remains fallback for an ambiguous terminal zero. Source-consistent mate counts show exact `M3` / `−M2` in the current-move summary and are passed through the EvalBar's existing mate interface, which exposes accessible `Mate in 3 for White` / `Mate in 2 for Black` labels.
- Independent audit found another potential false-positive path: a cached `mate_after` can disagree with its own white-perspective `eval_after_cp` despite passing finite-value decoding. The final helper refuses **precise** mate counts unless they match the server's normalized `±(10000−10*N)` cp proxy when cp evidence is present; a contradictory cache falls back to the existing generic cp label instead of stating an unsupported mating side/count. A valid isolated mate without a numeric cp proxy is still supported.
- The mate test fixture modifies only a disposable HTTP response with all 24 unchanged, source-matched saved plies; White `mate=3/cp=9970`, Black `mate=-2/cp=-9980`, terminal `mate=0/cp=10000`, and intentionally contradictory `mate=3/cp=-9970`. No real Stockfish mate was claimed or written to SQLite.

### Verification

- Focused mate/bar/stored-source tests: **17 passed**, including invalid/zero/inconsistent annotations. `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **993 passed / 12 skipped**, 109 passing test files.
- Full disposable authenticated Chromium matrix **PASS (exit 0)**. Verified exact board `M3` and White mating-side accessibility, `−M2` and Black mating-side accessibility, no invented `Mate in 0`, and the contradictory cache's non-precise `−#` fallback. Previous source/keyboard/variation/recovery/phase/mobile checks stayed green; saved PGN remained unchanged.
- Opened/inspected `qa-artifacts/agent-a/mate-score-consistency-verified-20261112/review-mate-{white,black,contradictory}-390.png`: scores match the selected move and the evaluation bar, readable at 390px, without board clipping. All scores are **synthetic browser test annotations**, not Stockfish accuracy certification.
- No merge, deployment, production SQLite mutation, or other-agent area modified.

### Next highest-value Game Review issue

- The evaluation timeline graph receives only normalized cp values; mate count is available in authoritative saved move evidence but the graph's screen-reader slider text still treats mate as a cp proxy. Audit actual `aria-valuetext` for source-consistent M3/−M2 in the same authenticated browser fixture, and distinguish precise valid mate counts from contradictory cached fields. Keep the graph's current bar/plot geometry and original-game timeline semantics unchanged; use the same source-safe mate helper.

## 2026-11-12: source-safe mate announcements on the original-game evaluation timeline

### Reproduction and fix

- Continued from clean pushed `f9d289e`; the board already used precise source-consistent `mate_after` values, but `EvalGraph`'s `fmtCp` inferred `M3` / `-M2` from large cp values alone. That advertised an exact mating distance even if the authoritative move had no mate evidence or its cached mate field contradicted the normalized cp. The saved review timeline also dropped mate provenance before giving rows to the graph.
- Added two focused **failing** regressions: the slider must distinguish genuine White/Black mate evidence from inconsistent/no-mate cp proxies; the timeline may copy `mate_after` only when the analyzed ply and UCI match the saved PGN position. Previously `aria-valuetext` was derived from cp alone, and the timeline contained no mate data.
- Added optional mate provenance to `EvalSample`; `buildSavedReviewTimeline` forwards it only for matching scored PGN moves. The graph now uses the same `displayableMate` / `formatReviewMate` guard as the board for its slider, hover tooltip, and current-position chip. Valid consistent mate fields display `M3` / `−M2`; contradictory or absent mates retain generic high-score `#` / `-#` notation rather than inventing a distance. Ply-zero, unselected variation rail, unknown score gaps and SVG graph geometry remain unchanged.

### Verification

- Focused EvalGraph/timeline/geometry tests: **11 passed**; `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **995 passed / 12 skipped**, 109 passing test files.
- Full disposable authenticated Chromium matrix: **PASS (exit 0)**. Extended the existing 24-ply saved PGN fixture to verify slider `aria-valuetext=M3` for genuine White mate, `−M2` for genuine Black mate, `#` for ambiguous terminal mate zero, `-#` for contradicted mate/cp evidence, and `#` for a high cp with no mate field. No false exact mate distance, previously confirmed board source behaviors, keyboard, retry and variation checks remain green.
- Opened/inspected `qa-artifacts/agent-a/mate-graph-verified-20261112/review-mate-unproven-graph-390.png`: at saved ply 5/24 the bar, summary and graph show a non-precise `#` fallback, while graph markers, current cursor and 390px layout remain intact. Scores are **test-only synthetic HTTP annotations**, not actual Stockfish certification. Original PGN remained unchanged.
- No merge, deployment, production SQLite mutation, or edits outside Agent A scope.

### Next issue

- Review the evaluation bar's localized accessible name. It currently hardcodes `Evaluation unavailable`, `Mate in 3 for White`, and similar strings in English; unlike the score summary and graph, this is announced in English even on a Spanish/Game Review screen. The EvalBar is currently used only by GameAnalyzer, so improve translation there without impacting other agents, and add Spanish Chromium/locale tests that verify the mating side and unknown state. Keep visual scores/geometry unchanged.

## 2026-11-12: localize evaluation-bar screen-reader descriptions across five review languages

### Reproduced gap and limited correction

- Continued from clean pushed `98f83c1`. The board score and timeline were localized, but `EvalBar`'s `role="img"` name was hard-coded to English, including `Evaluation unavailable` and `Mate in N for White/Black`, even with Spanish selected in the existing authenticated Game Review.
- Added a focused static-render regression requiring an explicit Spanish accessible name. **Before fix it failed**, retaining `aria-label="Evaluation unavailable"` despite the supplied Spanish name.
- Added an optional `ariaLabel` override to the Game Review-only EvalBar without altering legacy default labels or any score/share/geometry behavior. GameAnalyzer now supplies localized source-aware descriptions: a Spanish/other-language unknown state, exact White/Black mate count only when the existing mate provenance guard succeeds, or a White-perspective evaluated cp score. Added natural accessible strings for English, German, Spanish, Russian and Bulgarian and parity checks. No changes to the global shell or other agents' components.

### Verification and evidence

- Focused bar/locales/mate-source tests **59 passed**; `npm run typecheck` PASS; `npm run build` PASS.
- Full `npm test -- --testTimeout=20000`: **996 passed / 12 skipped**, 109 passing test files.
- Full disposable authenticated Chromium matrix **PASS (exit 0)**. The existing Spanish no-engine scenarios verify `role=img` has translated `review.variationEvalUnavailable` instead of English. A fresh test-only source-matched mate fixture verifies the exact Spanish labels `Mate en 3 a favor de las blancas` and `Mate en 2 a favor de las negras`; the second case explicitly excludes the English `Mate in 2 for Black` name. Original game PGN unchanged; previous keyboard, partial recovery, mate graph/source and responsive checks remained green.
- Opened/inspected `qa-artifacts/agent-a/evalbar-localized-20261112/review-evalbar-localized-mate-es-390.png`: selected Black e5, high-confidence `−M2`/Black bar visuals and Spanish review labels remain legible. Mate sources are **synthetic HTTP test-only annotations**, not live Stockfish scoring certification.
- No merge, deployment, production SQLite mutation or other-agent changes.

### Next source-integrity candidate

- In GameAnalyzer's engine-lines rail, `fmtCp(null)` currently returns `0.00`. The EngineLine contract permits `cp:null` and `mate:null`, so an incomplete engine line could be displayed as a false drawn/equal position. Inspect the on-demand engine-line fetch/validation path and add a regression with missing score evidence. If reproducible, show a truthful localized unavailable label without hiding a still-useful legal PV; preserve engine source and pagination.

## 2026-11-12: localize Game Review detail tablist name with preserved keyboard navigation

### Exact resume and scope audit

- Resumed from clean pushed `832d13f` without repeating its mate/translation investigations. Checked the recorded engine-line-null candidate against `verifiedPositionEngineLines` and the `/api/analyze/position` contract: the frontend rejects a legal line when **both** `cp` and `mate` are null, so there is no reachable invented `0.00` line through the verified API path. Left that correct source-integrity protection alone.
- Inspected another Review-only accessible control and found the detailed tablist still declared hardcoded English `aria-label="Review detail sections"`, even while its individual Moves, AI Report and Key Moments tabs were correctly translated. Five-language locale regression tests deliberately **failed** because `review.detailSections` did not exist anywhere.

### Minimal fix and independent browser verification

- Added `review.detailSections` to English, German, Spanish, Russian and Bulgarian, and bound the existing GameAnalyzer-only tablist accessible name to the currently selected locale. No global shell, tab contents, scoring, source identity or layout semantics changed.
- Extended the existing five-language 390px/320px authenticated Chromium review-tab matrix to require the localized tablist name and, at 390px, verify ArrowRight selects and focuses the Report tab, then Home restores the Moves tab and DOM focus. Focus assertions await the native requestAnimationFrame to avoid misleading asynchronous test failures.
- Focused locale suite: **51 passed**. `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **996 passed / 12 skipped**, 109 passing test files.
- Full authenticated disposable Chromium matrix: **PASS (exit 0)**. Spanish, German, Russian, Bulgarian and English detail tablists exposed the correct localized accessible name at 320/390px. Selected tab and keyboard focus remained aligned after ArrowRight and Home, with existing responsive/layout/engine-source/mate/variation/PGN checks passing. Inspected `qa-artifacts/agent-a/tablist-localized-20261112/review-tabs-{es,de}-390.png`: no clipped review labels or altered tab rail appearance.
- No deployment, merge, production SQLite mutation or other agents' code changes.

### Next high-value review issue

- The Engine Lines rail uses `fmtCp(null)` returning `0.00`, but its verified backend response rejects entirely unscored lines. Rather than changing correct behavior, audit the **terminal mate-zero** engine line: its present formatter converts `mate=0` to `-#0` (Black), even though the sign of a terminal mate zero is undefined, unlike a true signed nonzero mate. Confirm actual source semantics and, if reproduced, replace the false winner with an unknown-side terminal marker while preserving legal PV, matched FEN, and exact other mate counts.

## 2026-11-12: avoid fictitious Black mate-in-zero in live engine lines

### Recovery and reproduced source-contract gap

- Continued directly from clean pushed `604e27a`. Previous candidate `fmtCp(null) => 0.00` was confirmed **unreachable for verified lines without any score**: `verifiedPositionEngineLines` rejects `(cp=null,mate=null)`, and the ad-hoc position endpoint validates the result's score. No unnecessary change to that existing source guard.
- However, the same verified live-line contract permits `mate=0` with a legal, matching FEN/SAN/PV and cp=0. Server-side source comments explicitly identify mate zero as an unsigned **terminal** marker, not as Black winning. The live Engine Lines row rendered all `mate<=0` as Black mates, incorrectly producing `-#0` for this accepted input. The issue is limited to score presentation; the still-valid move continuation must remain clickable.

### Correction and verification

- Introduced a small Game Review-only pure `formatReviewEngineLineScore` helper, with regression tests for White/Black nonzero mate counts, White-perspective centipawns, high cp bands, invalid fractional scores, missing scores and unsigned `mate=0`. The latter now displays neutral `—` instead of inventing a mating side or an engine-validated equality. Preserved nonzero `#N`/`-#N` and ordinary cp formatting.
- Reused the existing authenticated disposable source-integrity Chromium scenario: after rejecting a position-matched line mislabeled `d4` for `e4`, the retry now returns its valid scored `e4` plus a second legal `d4` continuation with test-only `(mate=0,cp=0)`. Verified `d4` visibly displays `—`, remains enabled, and the ordinary `e4` line still displays `+0.45` and keeps keyboard focus. Saved PGN remains unchanged.
- Focused score/position-source tests: **11 passed**. `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **999 passed / 12 skipped**, 110 passing test files.
- Full authenticated disposable Chromium browser matrix: **PASS (exit 0)**. Independently inspected `qa-artifacts/agent-a/engine-line-zero-safe-20261112/engine-line-matched-after-retry-390.png`: the two scored/uncertain engine lines are readable at 390px without clipped move labels, with the uncertain legal `d4` row shown but not misclassified as a Black mating win. Earlier review/variation/source/recovery/keyboard/multilingual checks remain green.
- Mate-zero test annotations are **synthetic HTTP fixtures**, not real Stockfish certification. No production SQLite mutation, merge, deploy or cross-agent modifications.

### Next issue to investigate

- The live `verifiedPositionEngineLines` contract checks cp and mate *individually* for finite values but does not guard incompatible signs when a nonzero mate and an extreme cp are both present. Audit whether the live engine contract can legitimately output conflicting signs; if not, withhold a precise mating-side claim from contradictory cached/HTTP line evidence while keeping a legal PV navigable. Do not impose saved-report `±(10000-10*N)` normalization on live Stockfish scores without source evidence.

## 2026-11-12: normalize live MultiPV scores to White perspective on Black's turn

### Source audit and reproduced inconsistency

- Continued from clean pushed `6743f33` and its live-score semantics audit. Inspected both concrete engine implementations: `server/src/chess/stockfish.ts` documents candidate `cp`/`mate` as **side-to-move** scores, and `server/src/chess/engine.ts` converts the hosted chess-api.com's response to that same side-to-move convention. The server position route forwards those candidate scores without normalization. In contrast, the Game Review board, saved move report, and graph display **White-perspective** evaluations. Previously, Black-to-move live `cp:+75` appeared as `+0.75` even though it meant Black favored, contradicting the board convention.
- Added focused source-convention regression expecting Black-to-move `+75` → `−0.75`, `−80` → `+0.80`, Black mate in 2 → `-#2`, and White mate in 1 → `#1`. **Before fix the test failed** with `+0.75` instead of `−0.75`. Did not incorrectly apply the stored full-game mate cp proxy formula to raw live engine scores.

### Scoped fix

- Extended Agent A's pure `formatReviewEngineLineScore` helper to accept the analyzed FEN's side to move, defaulting to White for existing callers/tests. In `LinesPanel`, invert signed cp and nonzero mate only when the verified displayed/requested `currentFen` says Black to move. Board flipping does not affect sign. Existing `mate=0 → —` and legal PV availability remain unchanged.
- Added a short localized explanation that positive scores favor White and negative scores favor Black, only when Engine Lines have content. Natural strings and locale-parity regression cover English, German, Spanish, Russian and Bulgarian. Does not touch global navigation, board evaluation storage, or engine adapters.

### Verification

- Focused engine-score/source/locales tests: **63 passed**; `npm run typecheck` PASS; `npm run build` PASS.
- Full `npm test -- --testTimeout=20000`: **1000 passed / 12 skipped**, 110 passing test files.
- Full authenticated disposable Chromium matrix **PASS (exit 0)**. New isolated saved Black-to-move FEN after `1.e4` with 3 *test-only* live candidate responses verified exact rendered White-perspective score trio `−0.75`, `-#2`, `#1`, the explanation, all legal line buttons enabled, and no change to saved PGN. Also verified German explanation in the preexisting localized engine-retry matrix. Earlier source, navigation, variation, mate, and responsive checks remained green.
- Independently inspected `qa-artifacts/agent-a/engine-line-white-perspective-20261112/engine-lines-black-turn-white-perspective-390.png`: score signs, PV/move labels and explanation are legible in a 390px two-column rail without horizontal overflow. Browser scores were deliberately injected for UI QA, **not** Stockfish accuracy certification.
- No merge, deploy, production SQLite mutation, or edits outside Agent A's worktree.

### Next higher-value accessibility issue

- In `LinesPanel`, each live engine line is a button whose explicit `aria-label` says only "Try engine move e5" or "Follow played move e5". That label can suppress descendant score and PV in the accessible name, making the newly corrected score and preview invisible to screen-reader users. Audit the actual DOM/accessibility relationship and add a source-safe description of each line's signed score and legal PV via `aria-describedby` without changing the established button action name or keyboard navigation. Keep explanations localized and avoid announcing fabricated mate winners.

## 2026-11-12: expose live engine-line score and legal PV to screen readers

### Reproduction and scoped fix

- Continued from clean pushed `86add34` and the recorded next accessibility task. The live Engine Lines buttons had an explicit action-only `aria-label` ("Follow played move e4" / "Try engine move c5") which suppresses their descendant score and PV from the accessible name. Players using a screen reader could activate a legal move but miss the just-corrected, source-matched evaluation and continuation.
- Added stable per-rendered-row IDs to the **already visible** engine score and legal-PV spans, and paired them with the action button through `aria-describedby`. The accessible **name remains the existing translated action**, while its description now includes that row's verified White-perspective score and legal SAN continuation. The IDs use the row index instead of the engine rank, avoiding accidental collision if malformed multiPV data repeats a rank. No new data, explanations, colors, keyboard shortcuts or backend policy; scoring and PV still come from the existing FEN-matched verification path.

### Verification

- Focused engine-score/source tests: **12 passed**. `npm run typecheck` PASS; `npm run build` PASS.
- Full `npm test -- --testTimeout=20000`: **1000 passed / 12 skipped**, 110 passing test files.
- Full authenticated disposable Chromium matrix: **PASS (exit 0)**. In the original saved starting-position, a focusable "Follow played move e4" button exposes description IDs resolving to `+0.45` and `e4 e5 Nf3`; keyboard Retry/Tab still reaches it. For a Black-to-move saved position, all three live lines exposed description pairs `−0.75 / e5 Nf3`, `-#2 / c5 Nf3`, and `#1 / d5 exd5`, retaining their existing legal action names and clickability. Full previous source, multilingual, variation, and responsive tests green; saved PGN unchanged.
- Browser scores are deliberately injected QA fixtures, not live Stockfish certification. The visual design and original screenshot baseline remain unchanged; `qa-artifacts/agent-a/engine-line-accessible-20261112/engine-line-matched-after-retry-390.png` and `engine-lines-black-turn-white-perspective-390.png` were generated for regression reference.
- No deployment, merge, production SQLite mutation, or other-agent modifications.

### Next higher-impact issue

- The FEN/legality validator for live MultiPV `verifiedPositionEngineLines` validates each line individually but does not enforce distinct `multipv` rank or first UCI across the response. If a malformed provider returns repeated rank 1 or the same move under multiple ranks, the review may render multiple misleading "best" rows with conflicting scores and duplicate React keys. Inspect backend rank policy and add isolated adversarial tests before deciding whether to reject or safely deduplicate malformed lines, without ever inventing a replacement best move.

## 2026-11-12: reject malformed live MultiPV ranks and duplicate best moves

### Reproduction and source contract

- Continued from clean pushed `7f5c614`. Review's `verifiedPositionEngineLines` already ensured each candidate matches the exact requested FEN, a legal first UCI, matching SAN and a replayable continuation. It did **not** enforce unique/consecutive MultiPV ranks or first moves across the response. An otherwise legal HTTP payload could claim *two different rank-one best moves*, repeat the same move at two ranks, or skip the actual best rank, creating contradictory recommendations.
- Inspected engine source: the local Stockfish adapter emits candidates with ascending, contiguous ranks and unique first moves; the hosted adapter emits only rank one. Added adversarial source-specific unit tests for duplicate ranks, duplicate UCI across ranks, a missing rank one, gaps (1 then 3), and reordered ranks. **Before fix the rank-one duplicate test failed**: the malformed response was accepted.

### Narrow fail-safe change and verification

- Within Agent A's existing Review position validator, require each candidate's `multipv` to equal its 1-based array position and its validated first UCI to be unique. The existing legality, FEN, SAN, PV and score checks remain mandatory. Reject the entire inconsistent response and use the existing localized Engine Lines unavailable/Retry UI rather than choosing an arbitrary winning move or modifying scores. Zero-line responses remain valid as before.
- Focused position/source-score tests: **13 passed**. `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **1001 passed / 12 skipped**, 110 passing test files.
- Full authenticated disposable Chromium matrix: **PASS (exit 0)**. New intercepted HTTP result contained legal, source-matched `e4` and `d4`, each marked `multipv:1`. The Review correctly displayed the safe unavailable state with an enabled Retry instead of either false best move button; persisted PGN remained unchanged. All existing real-browser move navigation, source integrity, score, variation, localization, responsive and error/retry cases passed.
- Independently opened `qa-artifacts/agent-a/multipv-ranks-safe-20261112/engine-lines-duplicate-rank-rejected-390.png`: the 390px Engine Lines rail shows clear error/Retry and no misleading recommendations while preserving the board, move history and report layout.
- Adversarial MultiPV scores are browser fixtures, not actual Stockfish certification. No merge, deployment, production SQLite change, or other-agent edits.

### Next Game Review interaction audit

- Engine-line mouse hover calls `onHover` to preview a live candidate on the board, but the same focusable line button does not call `onHover` on keyboard focus or clear it on blur. Investigate the real board-preview arrow/line reaction with keyboard Tab/Shift+Tab on a source-valid live line. If confirmed, make keyboard focus preview equivalent to pointer hover without changing selection, PGN or accessible description.

## 2026-11-12: keyboard-focus engine-line board previews bound to current FEN

### Exact recovery and actual interaction issue

- Continued from clean pushed `f00ebc9` with two already-uncommitted changes scoped only to Game Review's Engine Lines interaction and its Chromium regression. The saved button's `onMouseEnter/onMouseLeave` previewed a pale-green move arrow, but keyboard focus/Tab did not call the same handler. A further source problem existed: raw `linesHover?.uci` could outlive an updated FEN when a focused/hovered button unmounted without a corresponding `mouseleave`, leaving a stale arrow on an unrelated saved or exploratory position.
- A line-focused preview is now triggered by `onFocus` and cleared by `onBlur` (mouse behavior preserved). Hover state stores the exact verified FEN and first UCI, not the full arbitrary response. It becomes active only when Engine Lines is enabled, not loading/in error, the displayed FEN exactly matches the originating FEN, and that UCI still appears in `freshLines` after the independent FEN validation. Other board/explorer arrow behavior is unchanged.
- Exposed a small noninteractive `data-review-live-preview-uci` diagnostic on the saved board container for real Chromium assertion; it reflects only the actual, position-safe preview arrow. No saved PGN or scoring source was modified.

### Verification and self-audit

- Focused existing review source and live-score tests: **13 passed**. `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000`: **1001 passed / 12 skipped**, 110 passing test files.
- The original full authenticated disposable Chromium matrix **PASS (exit 0)**, then a second full matrix **PASS (exit 0)** after adding visual board inspection. Tab from the prior Retry region focused the source-verified `e4` engine button and displayed its `e2e4` preview; focusing the other legal `d4` button switched the preview to `d2d4`; focusing the board cleared it without playing any move. After returning focus to `e4`, selecting the saved move advanced the actual board to 1/24 while the old first-position preview was removed, proving no stale FEN carryover. The full previous source, PGN, scoring, keyboard, translation, responsive and variation scenarios remained green.
- Independently opened `qa-artifacts/agent-a/engine-lines-keyboard-preview-board-20261112/engine-line-keyboard-board-arrow-390.png` and observed the pale-green `e2→e4` arrow drawn from the original starting board when the row had keyboard focus, with no board move or score changes. `engine-line-keyboard-preview-390.png` shows the focused accessible row on mobile. All engine evaluations remain disposable browser fixtures, **not** Stockfish scoring certification.
- No merge, deploy, production SQLite mutation or cross-agent file edits.

### Next priority

- Audit window-level Game Review Arrow/Home/End shortcuts while a live engine-line button has keyboard focus. Those shortcuts currently exclude native inputs/sliders/tablists but may silently navigate the saved chessboard from a focused engine suggestion, leaving its accessible action context and preview inconsistent. Reproduce a focused engine row and ArrowRight in Chromium before changing the handler. If genuine, exempt only Engine Lines focused buttons and preserve global board shortcuts and MoveList's dedicated arrow navigation.

## 2026-11-12: focused engine suggestions retain keyboard context

### Recovered unfinished fix and scoped interaction

- Continued on Agent A's own worktree at clean pushed `e1bb11a`, recovering two pre-existing uncommitted files (`GameAnalyzer.tsx`, `review-polish-capture.mjs`). The global Game Review keydown listener operated on ArrowLeft/ArrowRight/Home/End unless focus was in a tablist, slider or editable control; engine suggestions are ordinary buttons, so those keys could move the saved PGN while the user's focused suggestion and board preview still represented the prior position.
- Engine Lines' existing region now intercepts unmodified navigation keys **only when an enabled engine-line button is focused**, stopping those global shortcuts from changing saved moves. Up/Down focus adjacent verified suggestions, Home/End focus the first/last, and Left/Right leave the current suggestion in place. Focus transitions use the existing FEN-safe preview behavior. Inputs, tabs, board-level shortcuts, mouse actions, and saved-game navigation elsewhere remain unchanged.
- The authenticated disposable Chromium fixture now checks that Right and Home/End never change the saved move counter under focused suggestions, that ArrowDown/Up change focus and switch the preview arrow `e2e4` to `d2d4` and back, and that the original PGN remains intact. A real dark 390px screenshot of the focused alternative is `qa-artifacts/agent-a/engine-lines-keyboard-shortcuts-20261112/engine-line-keyboard-arrowdown-preview-390.png`; the companion board-arrow capture was also visually inspected.

### Verification and isolation

- `git diff --check`: PASS; `npm run typecheck`: PASS; `npm run build`: PASS.
- Focused source/score tests: **13 passed**; full `npm test -- --testTimeout=20000 --maxWorkers=4`: **1001 passed / 12 skipped**, 110 passing test files.
- Complete authenticated disposable Chromium responsive, locale, source-integrity, keyboard and saved-PGN matrix: **PASS (exit 0)** with isolated SQLite and port 8941. All test evaluations are synthetic presentation fixtures, not real Stockfish certification.
- No merge, deployment, production DB, service or other-agent edits.

### Next independent audit candidate

- Inspect whether losing focus on the Engine Lines Retry button during a request (or collapsing its panel from within) creates a keyboard-focus trap or drops focus to the document body. Reproduce with real Chromium before making a UX change; preserve correct engine source guards.

## 2026-11-12: retain keyboard focus after applying an engine line

### Exact recovery, narrowed focus audit, and failing browser reproduction

- Resumed from clean pushed `716b842` on Agent A's own isolated worktree, with no unfinished files. The existing Retry handler already returns focus to the durable `#review-engine-lines-content` region when its Retry button unmounts; verified that no new change is needed there. Added a real Chromium keyboard collapse/reopen assertion: `aria-expanded` updates and focus remains on the disclosure header rather than becoming hidden or stranded.
- The more consequential failure was activating a **valid saved-game engine line** while its button was focused. Following `e4` advanced the PGN replay to ply 1 and removed all first-FEN engine buttons, leaving keyboard focus off the actual board. A new browser assertion for focused board recovery **failed against the preceding implementation** (`AssertionError: Applying a focused engine suggestion must focus the updated board`).

### Scoped correction and self-audit

- Both `Follow played move` and `Try engine move` now reuse one Game Review-only post-action focus helper. At stacked/mobile widths it uses the existing reduced-motion-aware `jumpToBoard` (focus + board reveal); on desktop it focuses the board without scrolling the side-by-side workspace. The original saved PGN, FEN verifier, variation creation, legal move validation, score, and engine request handling remain unchanged.
- The same authenticated Chromium scenario now confirms focused `e4` advances the saved board to ply 1 and leaves focus on the updated board. A **separate Black-to-move** source-matched suggestion activated with Enter now opens a legal unsaved `c5` variation, focuses/reveals the new board, and leaves the saved PGN intact. Actual 390px dark mobile capture `qa-artifacts/agent-a/engine-line-action-focus-final-20261112/engine-line-applied-alternative-board-390.png` was visually inspected: resulting board, variation state and controls are visible.
- Explicit close/reopen exercises the current on-demand fetch contract; the browser assertion now expects **three** requests: initial invalid line, explicit Retry, and reopening the panel. This is test fixture accounting, not an application request-policy change.

### Verification

- `git diff --check`: PASS; `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000 --maxWorkers=4`: **1001 passed / 12 skipped**, 110 passing test files.
- Full authenticated disposable Chromium responsive/locale/source/variation/mate/keyboard/PGN browser matrix: **PASS (exit 0)** with isolated SQLite and port 8944. The synthetic line results verify presentation and interaction, not Stockfish scoring accuracy.
- No merge, deployment, user database, active service, or other-agent branch modifications.

### Next high-value Game Review truthfulness audit

- `formatReviewEngineLineScore` displays a bare `#` or `-#` from **centipawn-only** scores above magnitude 9000, even when the verified engine candidate has `mate:null`. The source adapters emit raw centipawns (not saved-report mate proxies). Reproduce with extreme-cp/no-mate evidence, then remove unsupported mate notation while keeping explicit, integer mate distances exact and preserving White-perspective scoring.

## 2026-11-12: do not fabricate checkmate from raw extreme cp scores

### Real source-convention review and failing regression

- Resumed from clean pushed `26d79a3` without revisiting prior keyboard or source-rank investigations. Inspected the local Stockfish UCI adapter (`score cp` or `score mate`) and the hosted engine adapter (`cp` cleared when a mate score is present). Both return **raw side-to-move centipawns** in live position candidates, distinct from stored full-game synthetic mate-cp proxies.
- `formatReviewEngineLineScore` nevertheless turned any `cp >= 9000` into a bare `#` and `cp <= -9000` into `-#` even when `mate:null`. This falsely asserted a proved mating outcome from a high numeric advantage. A new focused regression for `cp:9500,mate:null` **failed before the change**, receiving `#` instead of `+95.00`.

### Minimal correction and actual browser evidence

- Removed only the two raw-cp-to-mate thresholds from the Game Review live-line score formatter. Numeric cp, including extreme positive/negative scores, stays numeric and is normalized to White perspective; a verified, nonzero integer mate value still takes precedence and displays exact `#N` or `-#N`. Other pending/unscored and mate-zero guards remain intact. No engine adapter, score computation, saved analysis or backend source contract changed.
- Reused the authenticated malformed-rank browser fixture: first response still rejects contradictory duplicate-best MultiPV ranks; Retry returns source-matched legal `e4` and `d4` lines with **synthetic** `(cp:+9500,mate:null)` and `(cp:-9500,mate:null)`. Chromium verifies the exact `+95.00` / `−95.00` display, linked accessible score description, retry action and unchanged source PGN. Independently inspected `qa-artifacts/agent-a/engine-line-extreme-cp-20261112/engine-line-extreme-cp-no-mate-390.png`: both live scores legible without checkmate claims at 390px dark mode.

### Verification

- `git diff --check`: PASS; focused position/score unit tests: **14 passed**; `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000 --maxWorkers=4`: **1002 passed / 12 skipped**, 110 passing test files.
- Complete disposable authenticated Chromium viewport/theme, five-language, source-identity, variation, keyboard and saved-PGN matrix: **PASS (exit 0)** on port 8945. Injected extreme scores are UI adversarial fixtures, not claims about real Stockfish accuracy.
- No merge, deploy, production database/service, or edits outside Agent A's worktree.

### Next independent review audit

- The position-line verifier accepts a response where **both** `cp` and nonzero `mate` are supplied on the same candidate, even if their winning-side signs contradict each other. The supported adapters emit a single authoritative score type. Audit whether this can result in a materially false visible mate claim; if reproducible, reject inconsistent score evidence without inventing another best move. Preserve verified legal continuations whenever safe.

## 2026-11-12: reject contradictory raw cp and signed mate evidence

### Source-contract and failing regression

- Continued from clean pushed `c0659c9`. Inspected both live-engine adapters: the Stockfish parser extracts the score for a single UCI line; the hosted adapter explicitly clears centipawns when a valid nonzero mate score exists. Both use one score type at a time for each legal MultiPV candidate.
- The Game Review verified position-line contract nonetheless accepted `cp:-200,mate:2` (or the opposite signs) with matching FEN and a legally replayable e4/e5 PV. The presenter prioritized the `mate:2`, potentially making a false definite mating claim contradicted by the other score. An adversarial source-verification unit test **failed before the correction**.

### Scoped fail-closed validation

- Reject a live candidate when `mate` is nonzero and `cp` is also present. The existing `mate=0` neutral terminal marker remains supported, as does each properly scored cp-only or mate-only legal PV. No arbitrary replacement best move is invented; the existing localized unavailable/Retry UI is used for a malformed response. Engine adapter behavior, scoring, stored analysis and PGN remain untouched.
- Extended the authenticated disposable Chromium engine-line scenario: initial duplicate rank rejected, Retry accepts two high-cp numeric lines, subsequent disclosure reopening triggers another on-demand FEN-matched response containing contradictory `cp:-200,mate:2`. Browser asserts no actionable fake best row and a visible Retry state, while source PGN remains unchanged. Inspected `qa-artifacts/agent-a/engine-line-contradiction-20261112/engine-line-contradictory-mate-rejected-390.png`: clear error and 44px Retry in dark 390px display.

### Verification

- `git diff --check`: PASS; **15** focused source/score tests PASS; `npm run typecheck`: PASS; `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000 --maxWorkers=4`: **1003 passed / 12 skipped**, 110 passing test files.
- Complete authenticated disposable Chromium screen/theme, locale, keyboard, source, variation and PGN matrix: **PASS (exit 0)** on port 8946. Malformed source and checkmate signals are synthetic test responses; this does not benchmark real engine scoring accuracy.
- No merge, production database, live service, deployment or other agent branch changes.

### Next Game Review audit candidate

- Live `verifiedPositionEngineLines` presently accepts finite **fractional** mating distances (e.g. `mate:1.5,cp:null`), although Stockfish and hosted engines define an integer number of moves to mate. Check if this can misleadingly rank/preview a recommendation without authoritative mate evidence; validate via adversarial tests and preserve the existing neutral rendering until it is proven meaningful.

## 2026-11-12: reject fractional and unrenderable live mate distances

### Narrow engine-contract finding and reproduction

- Continued from clean pushed `c754e23`. The live `verifiedPositionEngineLines` verifier checked only that `mate` was finite. It accepted a position-matched legal PV and `mate:1.5,cp:null`, even though engine mate distances are signed **whole moves**, and the Game Review renderer deliberately cannot show a fractional checkmate (`—`). The result could still be ranked/previewed as a real scored best line. New focused adversarial test **failed before fix**.
- Added a score-contract gate requiring a non-null mate value to be a safe integer of magnitude at most 999 (the renderer's exact distance range). A zero-distance unsigned terminal marker is still accepted and rendered neutrally. Both positive/negative bounded integer mate values and numeric centipawn-only lines remain valid. No algorithm, engine process, ranking formula, original PGN or source hash changed.

### Verification and visual evidence

- Added a **fourth** HTTP challenge to the existing authenticated disposable Chromium engine-line sequence: duplicate ranks rejected → valid extreme numeric cp accepted → contradictory cp/mate rejected → fractional mate rejected after keyboard-recoverable Retry. All four use the same FEN, preserved saved PGN and existing localized error/Retry controls. Inspected `qa-artifacts/agent-a/engine-line-mate-distance-20261112/engine-line-fractional-mate-rejected-390.png` showing accessible error recovery at 390px dark mode.
- `git diff --check`: PASS, `node --check scripts/review-polish-capture.mjs`: PASS, **16 focused review source/score tests** PASS, `npm run typecheck`: PASS, `npm run build`: PASS.
- Full `npm test -- --testTimeout=20000 --maxWorkers=4`: **1004 passed / 12 skipped**, 110 passing test files.
- Complete authenticated disposable Chromium responsive/theme/locale/review-source/keyboard/variation/PGN suite: **PASS (exit 0)** on port 8947. Test scores are synthetic browser presentation fixtures, not Stockfish certification.
- No merge, deployment, production service, active SQLite, or edits to other agent worktrees.

### Next independent review investigation

- Audit on-demand Engine Lines when its disclosure is closed/reopened rapidly while an HTTP request is in flight. The effect aborts old requests and checks request-local cancellation, but the browser matrix has not explicitly proven a delayed stale success cannot replace the new FEN's valid suggestions. Exercise genuine delayed intercepted responses, focus, visible loading/error state, and original PGN integrity before changing code.

## 2026-11-12: delayed abandoned engine-line response cannot replace reopened source

### Recovered unfinished browser test

- Resumed from clean pushed `6a89a3e`, with **one uncommitted browser test only** in `scripts/review-polish-capture.mjs`; no unfinished product code. Preserved the already-running isolated Chromium process rather than restarting completed work or launching competing QA on the shared machine.
- The fixture uses two independent intercepted HTTP results for the *same* real starting FEN: a deliberately delayed first `d4` line, and a fresh `e4` line on reopening Engine Lines. It waits until the first request begins, collapses and reopens the disclosure, verifies the newer `e4` recommendation appears, then releases the old response and checks that it cannot overwrite the new data. Both legal move labels, score evidence and saved PGN remain source-matched; no fake alternative or stale result appears.

### Verification and decision

- The full authenticated, disposable SQLite + Chromium matrix ran to completion on port **8948** with no error/assertion in the captured log. New stale-response checks PASS: two requests, the fresh `e4` button remains enabled after the old response settles, and delayed `d4` never appears. Examined `qa-artifacts/agent-a/engine-lines-aborted-request-20261112/engine-lines-reopened-stale-response-390.png` in dark 390px; the fresh recommendation is visible and legible.
- `git diff --check` and `node --check scripts/review-polish-capture.mjs`: PASS. Application code unchanged, so existing source cancellation guard is confirmed rather than rewritten. Previous implementation checkpoint `6a89a3e` had **1004 passed / 12 skipped**, typecheck and build green.
- No changes to production data, running service, deployments, or other agent branches.

### Next scoped Game Review audit

- Inspect the **empty live Engine Lines** state on terminal saved positions and source-valid nonterminal positions that return no candidate PV. The current rail renders only an em dash in both cases. Establish whether that leaves players unable to tell a completed checkmate/stalemate from a temporary engine-result gap, then provide truthful localized guidance if confirmed, without inventing a score or engine move.

## 2026-11-12: independently certify cancelled/reopened engine-line requests

### Recovered checkpoint and real asynchronous audit

- Continued from clean pushed `6a89a3e` without changing already-correct engine cancellation code. The existing GameAnalyzer effect uses request-local `cancelled`, `AbortController`, and a cleanup on `linesEnabled`, FEN or Retry changes. The previously untested race was an old delayed success for the **same FEN** arriving after the user closed and reopened the panel and got a newer, different suggestion.
- Extended only the isolated Chromium capture script with an intercepted request gate: first on-demand request for the original position deliberately waits with a legal d4 response; user closes panel, reopens it, and receives a newer legal e4 response; test then releases the abandoned d4 response and waits for the old route to settle. This exercises an actual in-browser request lifecycle rather than a pure mock of React state.
- Assertions prove **two requests total**, newer e4 still focusable/visible, stale d4 absent, correct board FEN, and byte-for-byte identical saved PGN. Viewed `qa-artifacts/agent-a/engine-lines-aborted-request-20261112/engine-lines-reopened-stale-response-390.png`: e4 +0.40 remains the only recommendation in the dark 390px interface. Original engine effect was already safe; no unnecessary product fix was introduced.

### Verification and next lane task

- `node --check scripts/review-polish-capture.mjs`: PASS; `git diff --check`: PASS.
- Full authenticated disposable Chromium source, viewport/theme, locale, scoring, keyboard, variation and PGN matrix: **PASS (exit 0)** on port 8948, including the new deterministic delayed-result challenge. Previous production-code checkpoint had **1004 unit tests passed / 12 skipped**, typecheck/build PASS; this change is QA harness only.
- No merge, deploy, active database/service, or modifications outside Agent A's worktree.
- **Next investigation:** At a terminal checkmate/stalemate board FEN, Engine Lines' source-valid zero-line response currently appears as a bare `—`. Verify in the real browser if Review can distinguish a legitimately finished position from a provider failure, and if a localized terminal-state explanation is more useful than an unexplained empty panel. Do not invent a legal move or numerical evaluation.

## 2026-11-12: explain zero-line engine results without inventing chess moves

### Reproduction and scoped change

- Continued from verified stale-request cancellation. Empty live results previously displayed only `—`, making terminal checkmate and stalemate indistinguishable from an engine with no suggestions. A real-browser fixture for Fool's Mate first **failed** on the old UI. Its first version had no cached analysis, so the optional Engine Lines panel was unmounted; corrected the fixture to use an independently source-attested **synthetic analyzed saved PGN** and repeated the browser test, where the old bare-dash UI failed its new visible-message assertion.
- Added a pure, FEN-derived `reviewTerminalPosition` helper that checks chess.js `isCheckmate` / `isStalemate` only, never assumes repetition/other history from FEN, and returns null for a playable or invalid position. Engine Lines now uses distinct localized, readable `role=status` text for checkmate, stalemate and no returned continuations in English, German, Spanish, Russian and Bulgarian. The raw score/line FEN guards, source PGN, engine request policy, and mate presentation remain unchanged.

### Verification

- Focused 63/63 Review-source and locale tests PASS, including checkmate, stalemate, playable and invalid-FEN cases. Typecheck and production build PASS.
- Full `npm test -- --testTimeout=20000 --maxWorkers=4`: **1005 passed / 12 skipped**, 110 passing test files.
- Full authenticated disposable Chromium responsive/theme/locale/source/variation/keyboard matrix: **PASS (exit 0)** on ports 8951 and 8949, with no saved PGN mutation. The new checkmate fixture uses real Fool's Mate PGN/FEN, test-only scored metadata and an intercepted engine response `{lines:[]}`. Inspected `qa-artifacts/agent-a/empty-lines-terminal-final-20261112/engine-lines-terminal-checkmate-390.png` and `qa-artifacts/agent-a/engine-lines-terminal-20261112/engine-lines-empty-nonterminal-390.png`: the checkmate and playable-position empty-result messages are distinct and legible at 390px, with no fabricated legal move or unsupported mate claim.
- No merge, deployment, production SQLite/service or other-agent worktree changes.

### Next audited issue

- When a **nonterminal** position's engine request succeeds with `lines:[]`, the new truthful text tells the user no continuations were returned, but the rail still provides no Retry action; only collapsing and reopening triggers a fresh request. Reproduce a playable zero-line HTTP result and test whether a direct, keyboard-accessible retry recovers verified legal suggestions without rerunning the full game or changing its PGN.
