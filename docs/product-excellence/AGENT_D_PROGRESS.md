# Agent D — Play, Learning, Insights & Engagement

## Scope and isolation

- Branch: `agent/patzer-play-learning-insights-20261112`
- Worktree: `/game/patzer-agent-play-20261112`
- Baseline: `5b5fe22` (`origin/feat/review-polish-product-excellence-20261111`)
- No changes to Review internals, Game Library/import pages, shared layout/design tokens, production database or main.

## First pass — 2026-11-12

### Existing functionality confirmed

- Play supports bot games, friend/PvP games, time controls, game resumption and move browsing.
- Train contains personal game-derived puzzles and separate general/daily Lichess-based tactics.
- Learn contains interactive lessons, server-stored progress and a resume path.
- Insights consumes the authenticated `/api/insights/v2` aggregation and achievements endpoint.
- Plan has generated improvement goals with links back to Play, Review and Train.

### Fixed and improved

1. **Personal training failure clarity** — `/api/train/next` errors previously looked indistinguishable from a truly empty puzzle queue. Failures now show a clear error with Retry. Failed practice-stat loads are also distinguishable from zero progress.
2. **Private-data cache isolation** — Train, Tactics, and Plan query keys now contain the authenticated user ID. Personal puzzles remount per user. Daily training keys include the date; errors expose Retry rather than an empty-state disguise.
3. **Plan reliability** — failed GET does not claim there are no goals; regeneration errors are visible and dismissible without pretending success.
4. **Insights action path** — a top-level next-step card distinguishes the most frequent *observed* taxonomy category from incomplete evidence, explains overlapping categories, and links to relevant existing practice, review and lessons. No synthetic evaluation or progress claim is made.
5. **Missing accuracy samples** — the Insights API returns per-phase sample counts. The UI renders unmeasured phases as `—`, not misleading `0.0%`, and explains the denominator.
6. **Activity calendar correctness** — the 53-column heatmap is aligned to real Sunday–Saturday weeks. It uses the same UTC dates and last-365-days boundary as the backend; cells outside the reporting window are transparent, not false zeros.
7. **Play keyboard accessibility** — move-browsing shortcuts no longer intercept modified keystrokes or arrow keys on interactive controls/contenteditable inputs.

### Verification performed

- `npm ci --no-audit --no-fund`: passed.
- `npm run typecheck`: passed after all edits.
- `npm run build`: passed after all edits.
- Focused Vitest suite, including personal account switches, recovery after API errors, phase missingness and calendar boundaries: 22/22 passed (includes unrelated Review library suite rerun).
- Broad Vitest initial pass: 967 passed, 2 failed, 12 skipped; one was the new test's translation-mock expectation, the other an intermittent 5s Review Library timeout. After fixing the assertion, all affected tests passed 22/22 in isolation, including the entire Review Library suite (13/13).
- **Final full Vitest suite**, `npx vitest run --maxWorkers=4`: **969 passed, 12 skipped, 0 failed** across 110 files. Bounded concurrency eliminated the incidental timeout under multi-agent CPU load.
- Actual Chrome/Playwright smoke run on local Vite with explicitly mocked authenticated API fixtures: Insights, Train and Plan at desktop 1440px and mobile 390px, in light and dark UI. All nine visits rendered and showed no page-level overflow or uncaught browser errors. These are fixture-backed UI checks, **not** live authenticated end-to-end or external-source certification.
- Visual inspection of desktop/light Insights, mobile/dark Insights, and mobile/light personal-training empty state completed.

### Integration boundaries and follow-up

- Agents B/C own global navigation and Review/library. If navigation labels or routes change upstream, recheck `Insights` links to `/train`, `/review`, and `/learn` after integration.
- API consumers that assumed `phase_accuracy.* === 0` meant bad performance should use `phase_samples` to distinguish missing data. The API change is additive.
- Remaining in-lane opportunities: test a genuine live PvP/bot game with a locally provisioned account; verify screen-reader spoken chart summaries; inspect touch play board and timers; review large-history chart rendering and very long localized labels; add account-switch tests for general tactics using real fixture-based puzzle state.
- Never merge, deploy, restart production or touch production SQLite from this branch.

## Second pass — 2026-11-12 (continued from `ee6b012`)

### Real browser findings and changes

1. **Disconnected games accepted phantom local actions.** Play became interactive before `game_started` / `pvp_hello`, and could continue presenting a locally moved piece when a socket closed before the server acknowledged the move. Added a separate authoritative game-ready gate. A WebSocket opening is not enough: buttons, board moves, premoves, hints and clock ticks wait for the server's game snapshot. On socket loss, clear optimistic move state, unsent premoves and pending hint/preview state; after reconnect keep controls inactive until the replayed snapshot arrives. Failed sends revert rather than leaving the board hanging.
2. **Mobile board width collapsed.** Actual Chrome at 390px showed a roughly 125px board and clock bar because the page's auto-margin root was a shrink-to-fit flex child. Added `w-full min-w-0` to Play setup/connecting/game roots. The browser now measures **364px of 390px** for the board, with no page-level horizontal overflow.
3. **Desktop board was unnecessarily small.** At 1440×900, the 26rem height reserve held the board around 480px. A more accurate 22rem reserve yields **544px** while clocks, navigation and primary buttons remain visible in the 900px screenshot.
4. **Misleading clock states.** Untimed play displayed `0:00` as if a timed game had expired. The label now says `Untimed`; a new game awaiting the server displays `—` rather than the previous game's clocks. Turn highlighting stops during disconnection and after game over.
5. **Regression coverage.** Added `Play.connection.test.tsx` for early/late socket readiness, optimistic-board rollback and restored play. Extended scratch-database PvP browser test with desktop/mobile board-size and overflow assertions so a future layout regression is visible.

### Verification

- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npx vitest run --maxWorkers=4`: **970 passed, 12 skipped, 0 failures** across 111 test files.
- Real Chrome browser PvP E2E, local scratch server **on throwaway `/tmp` SQLite only**: all assertions passed. Verified two authenticated players, legal move exchange, draw/decline, takeback/accept, replay, draw agreement, rematch, phone moves sheet and both board-width regressions. The temporary browser-run shim only pointed Playwright at installed local Chrome and was removed; canonical E2E test retains its usual invocation.
- `qa/agent-d-browser/real-pvp/` contains screenshots from the real E2E of desktop, mobile, game over, rematch, and negotiation states.
- Pixel inspection of final mobile and desktop screenshots confirmed square board, aligned clocks and visible primary controls.
- No production SQLite, deployment, original product-excellence checkout or another agent's branch was modified.

### Next in-lane investigation

- Evaluate accidental resignation risk: game controls currently resign immediately on a single tap, with no confirm/recovery path.
- Check remaining keyboard/touch focus and reduced-motion behavior on Play overlays.
- Validate bot-game reconnection with a locally provisioned Stockfish engine when available; the current environment lacks a Stockfish executable, so PvP was the live-server/browser coverage.

## Third pass — 2026-11-12 (continued from `83d0212`)

### One-tap irreversible resignation fixed

- **Problem:** Play sent `resign` immediately from a single tap or click (desktop or phone), allowing accidental forfeiture.
- **Solution:** Dedicated accessible `alertdialog` on the Play page with explicit **Keep playing** and **Confirm resignation** actions, Escape cancellation, focus containment and focus return. Reduced-motion preference disables entry/exit motion; the modal is dismissed on socket loss or game over. Confirmation checks the active connection before sending.
- **Tests:** `Play.connection.test.tsx` now covers first-tap non-submission, cancellation with the button, Escape cancellation and exactly one confirmed resignation send. The real-Chrome PvP E2E checks that an actual server stores the resulting loss and the browser shows the final outcome. Existing desktop/mobile PvP operations remain covered.
- **Final validation:** `npm run typecheck` and `npm run build` passed. `npx vitest run --maxWorkers=4` passed with **971 tests, 12 skipped, zero failures**. The latest real-Chrome scratch-database PvP E2E finished **ALL OK**, including the confirmation flow, both views of game termination, and the earlier board-width, rematch and negotiation checks. Captured settled dialog/result screenshots (`qa/agent-d-browser/real-pvp/pvp-resign-{confirmation,result}.png`).
- **E2E investigation:** A concurrent mobile page for the **same player** took over the server's single active player socket, so an earlier test correctly recorded a loss on the server but did not receive the finish event on the original desktop page. The canonical browser test now closes the extra phone tab and reconnects the desktop tab before asserting the result. This is an **existing multi-tab synchronization limitation**, not part of the resignation behavior; inspect it separately before claiming multi-tab support.
- **Environment note:** Scratch-server PvP resign triggers the optional post-game Stockfish auto-analysis, which reports an unavailable executable in this environment. Game saving and resignation correctness pass independently; this is not a production test or a new engine failure.

### Next in-lane candidates

- Learn lesson recommendation currently includes saved `step > 0` records even for lessons with `completed_at`, possibly suggesting an already-completed lesson ahead of an unfinished course. Verify with a minimal regression fixture before changing.
- Account-wide simultaneous-tab PvP state ownership/notification; requires careful client/server protocol audit and isolation from another agent's backend work.

## Fourth pass — 2026-11-12 (continued from `b3ebfad`)

### Learn loading failures are recoverable

- **Problem:** When `/api/learn` failed, Learn showed an error without a retry action. When a lazily imported curriculum or language chunk failed, the module-level promise was cached as a permanently rejected promise, so switching back to Learn could not re-request the file in the same app session. The translated error incorrectly instructed players to reload even when a local recovery was possible.
- **Fix:** A single accessible Retry action recovers from failed API and/or content requests. The curriculum and lesson-text caches now discard failed promises while retaining successful ones; the `useLearnContent` hook ignores stale asynchronous completions, exposes a controlled retry and respects language changes. The error's localized copy (English, German and Russian) is consistent with the actual Retry action and avoids claiming progress has already been safely retrieved.
- **Tests:** Extended `Learn.account.test.tsx` with independent API failure, curriculum chunk failure and lesson-language chunk failure/retry cases. The prior account-scoped progress tests still pass. Mocked motion in these state tests to avoid happy-dom cancel-animation rejections unrelated to lesson state.
- **Real browser:** Actual local Chrome at 390px with controlled temporary API and curriculum asset failures: `/api/learn` failed twice, then succeeded on the retry click (3 total requests); a curriculum asset request was aborted, then fetched again on Retry (2 requests). Both recovered to the genuine 69-lesson overview without a page reload and without uncaught JS page errors. Evidence screenshots are in `qa/agent-d-browser/learn/{api,chunk}-{error,recovered}.png`. These are fixture/network-fault browser checks, not production connectivity certification.
- **Final validation:** `npm run typecheck` passed, `npm run build` passed, and `npx vitest run --maxWorkers=4` completed with **974 passing tests, 12 skipped, 0 failures** across 111 files. Chrome fault-injection rerun also passed after the copy update; both cases displayed the complete learning overview after Retry.
- **Remaining:** Saved step mutation failures in `LessonPlayer` are swallowed, which can make a lesson look locally complete although its next-step progress was not persisted. Investigate sequencing and honest feedback in a later pass without changing server content or fabricating progress.

## Fifth pass — 2026-11-12 (continued from `43ef451`)

### Lesson save reliability, ordered writes and visible recovery

- **Problem reproduced:** `LessonPlayer` fired independent asynchronous POSTs for each step and for finishing, so an older request could arrive after the next and roll saved progress backward. Failures were silently swallowed; users could leave believing their latest work or earned stars were saved.
- **Implementation:** Introduced `LessonProgressQueue` scoped to one mounted player and lesson. Writes are sent **sequentially** in original order. A rejected write stays queued, prevents later writes from overtaking it, and exposes an explicit Retry control. Once the connection recovers, the failed write is replayed before any later steps or result. Leaving the lesson disposes the queue so it cannot send subsequent requests under another player's session; the banner warns players to retry **before leaving**, because outstanding browser-local writes cannot be guaranteed after unmount.
- **User feedback:** On failure, a prominent accessible `role=alert` card says the latest progress is not saved and offers **Retry saving**. A finished lesson shows a transient saving status before server acknowledgment. Added English, German and Russian localized copy. Existing chess rules, scoring and server-side progress rows are unchanged.
- **Independent audit:** Initial real-browser test found that a `useMemo` queue instance disposed by React development Strict Mode's effect cleanup never became active again; the lesson advanced without sending a POST. Fixed by constructing and disposing the queue inside an effect, allowing Strict Mode's cleanup/setup cycle to recreate a working queue. Added a real mounted `LessonPlayer` **under StrictMode** test to prevent recurrence.
- **Targeted tests:** Pure queue tests cover in-order writes, error blocking/retry order, and no queued requests after unmount; the Strict Mode integration test covers a real lesson finish failure and successful retry.
- **Actual browser:** Chrome at 390×844 dark/reduced-motion using the real `board` lesson and injected POST failure. After Continue, one POST failed, the failure banner was visible, Retry sent the same authoritative `{step:1, flawed:0}` payload, the server fixture stored step 1, and the warning cleared. No uncaught page errors or horizontal overflow. Screenshots at `qa/agent-d-browser/learn/save-{error,recovered}.png`. API was mocked for fault injection; not live production persistence certification.
- **Final verification:** `npm run typecheck` and production `npm run build` passed. Full `npx vitest run --maxWorkers=4`: **978 passed, 12 skipped, 0 failed** across 113 files. Focused Strict Mode component and queue tests passed, and actual-browser save-failure/retry verification passed.
- **Limitation to audit next:** Save operations are browser-local until acknowledged. Navigating away while a save is still pending can discard later queued requests; error copy warns to retry before leaving. A deliberate leave-while-pending flow or account-safe persisted queue deserves a separate reliability design rather than claiming background persistence.

## Sixth pass — 2026-11-12 (continued from `ffabeae`)

### PvP multi-tab ownership and explicit game control handoff

- **Problem reproduced:** Opening the same live PvP game on the same account in another browser tab replaced that player's active server WebSocket without informing the older tab. The older tab retained a playable-looking board, sent actions that no longer received updates, and could race authoritative server state. When its socket closed, it could also falsely notify the opponent that the player went offline even though the replacement tab remained connected.
- **Server fix:** For a new active tab, send `session_replaced` to the old socket and close it. Every incoming PvP message now checks that it belongs to the currently active per-player socket; obsolete tabs cannot move, offer, resign or negotiate after replacement. The obsolete socket's close event does **not** mark the player offline or send false opponent-status notifications.
- **Play UX:** On `session_replaced`, explicitly stop automatic reconnect, freeze local clocks and game interaction, discard optimistic/premove state, and show an accessible paused-tab notice with **Take control here**. A deliberate takeover establishes a new socket; actions stay disabled until the authoritative `pvp_hello` replays the current game. The previous tab is then paused. Added English/German/Russian copy.
- **Regression:** Added a component test of displaced-tab pause, disabled moves, explicit takeover, socket reopening and replay gating. Extended scratch-instance real Chrome PvP E2E with a desktop and an authenticated iPhone-sized tab using the same user: verifies both takeover directions, disallowing irreversible actions in the old tab, the opponent remaining online, and resumption of the normal resignation flow without a manual page refresh.
- **Browser QA:** Full real-Chrome scratch SQLite E2E completed **ALL OK**, including legal moves, draw offer/decline, takeback, draw agreement, rematch, mobile board width, two-way tab ownership changes, and confirmed resignation. Captured `qa/agent-d-browser/real-pvp/pvp-{desktop,phone}-paused.png` and checked them visually. One initial browser assertion observed an expected brief wait for the reconnect snapshot; it was corrected to wait for actual controls to be enabled, then the final full browser run passed.
- **Final verification:** `npm run typecheck`, `npm run build` and `npx vitest run --maxWorkers=4` passed: **979 tests passed, 12 skipped, 0 failed** across 113 files. No deployment, main merge, production SQLite or another agent's worktree was touched.

### Next scoped audit

- Improve learning guidance where an already-completed lesson is replayed and has an in-progress step: do not recommend that completed lesson ahead of a genuinely unfinished one.
- Evaluate honest progress indicators and navigation when lesson saves are still pending; preserve account privacy and avoid promising persistence before acknowledgment.
- Bot-game resume after a device sleeps still needs a live local engine check when Stockfish becomes available; currently browser-backed PvP and mocked bot state are verified.

## Seventh pass — 2026-11-12 (continued from `306d53a`)

### Suggest genuinely unfinished lessons ahead of already-completed replays

- **Problem:** The site-wide `suggestedLesson` chose the most recently updated `step > 0` even when that record had `completed_at`. Replaying a completed lesson and leaving halfway would wrongly make it the top suggestion on both Learn and Home, overriding a genuinely unfinished lesson. If course content changed and a saved step was beyond the new step count, Home could incorrectly offer a resume action that the lesson player would actually restart.
- **Fix:** The shared Learn suggestion requires `completed_at === null` and a step inside the current lesson. Otherwise it chooses the first unfinished lesson in curriculum order. Extracted `canResumeLesson` so Learn's own resume state, its overview button, course lesson labels, and the Home learning tile agree about whether a saved step is actually resumable. Completed lessons can still be deliberately replayed or resumed from their course; they no longer displace the user's recommended unfinished lesson.
- **Tests:** Added three focused regression cases covering completed replays versus unfinished progress, stale/out-of-range resume indices, and a fully completed curriculum while one finished lesson is being replayed.
- **Actual browser:** Local Chrome at 390px using authenticated API fixtures: a newer completed-board replay (`step 2`) and older unfinished rook (`step 1`) correctly showed **Continue: The rook** on Learn and **Continue where you left off** on Home. A stale rook index beyond its present lesson steps instead showed **Next lesson: The rook** on Learn and **Your next lesson** on Home. No uncaught browser errors or page-level overflow. Captured settled screenshots in `qa/agent-d-browser/learn/next-lesson-{overview,home}.png`.
- **Scope:** The only Home change is the shared learning-resume predicate; global navigation and design-system code remain untouched.
- **Final verification:** `npm run typecheck`, `npm run build`, and `npx vitest run --maxWorkers=4` passed: **982 tests passed, 12 skipped, 0 failures** across 113 files. Both Chrome fixture scenarios passed and screenshots were inspected after transition animations settled.

## Eighth pass — 2026-11-12 (continued from `e285a3d`)

### Guard all lesson navigation while progress is unacknowledged

- **Problem:** Lesson saves are queued and retryable but leaving through the in-lesson Back, Next lesson, Course overview or opening-trainer actions disposed the queue before later writes were acknowledged. There was no explicit choice between waiting and leaving unsaved.
- **Implementation:** The initial in-lesson control guard worked, then a source audit confirmed Patzer already uses `createBrowserRouter` in `web/src/main.tsx`. Upgraded to its supported `useBlocker` so **all SPA navigation** (the shared Home/Play sidebar, command palette, browser Back, Next lesson, Back to course and opening trainer) is suspended while writes are unacknowledged. When a save is pending or fails, an accessible `alertdialog` explains the risk. Players can stay, retry, or explicitly **Leave without saving**. Once the queue acknowledges all writes, blocked navigation proceeds automatically. Authentication redirect routes are exempt from the block; native tab close/reload uses `beforeunload` warnings. English, German and Russian messages were added.
- **Tests:** Expanded the real mounted `LessonPlayer` Strict Mode suite using an actual `createMemoryRouter`: pending final results block Next until server acknowledgment; failed saves support retry, Escape and deliberate unsaved leave; global Home-link navigation also blocks and resumes only after save succeeds. Kept queue ordering regression tests.
- **Browser QA:** Actual Chrome at 390px dark/reduced-motion, with a temporarily failed lesson-step POST: Back to course opened the warning, **Stay here** retained the lesson, and **Retry saving** resent the same `{step:1, flawed:0}` payload before the course opened. At 1440px dark/reduced-motion, clicking the *global Home sidebar link* while a lesson save failed likewise kept the route on the lesson; retry persisted the step and only then navigated Home. Screenshots in `qa/agent-d-browser/learn/{leave-warning,leave-recovered,global-exit-blocked,global-exit-recovered}.png`. Both runs had no uncaught JS errors or page-level overflow. Network failure and auth were exercised with isolated browser fixtures, not production data.
- **Boundaries:** Browser `beforeunload` dialogs are browser-controlled and cannot guarantee server persistence if the tab is forcibly killed. Authentication/account switches are not blocked; the Learn parent already remounts `LessonPlayer` under a key containing the user ID, discarding the previous account's queue. A new-tab Ctrl-click cannot be blocked in the original tab, but the tab remains open and continues saving its own queue.
- **Final verification:** `npm run typecheck` and `npm run build` passed, and the complete `npx vitest run --maxWorkers=4` suite passed with **986 passing tests, 12 skipped, 0 failures** across 113 files. The real Chrome mobile in-lesson navigation and desktop global-sidebar navigation browser checks both passed on the same updated code.

## Ninth pass — 2026-11-12 (continued from `de26f6b`)

### Make real rating histories understandable without inventing improvement

- **Problem:** The Insights rating chart drew up to four colored lines without date labels or numerical start/latest comparisons. A player could not tell which months the plot covered or whether a recorded rating was actually higher. One rating update produced a tiny dot on an unlabeled graph that looked like a meaningful trend.
- **Change:** Introduced `ratingHistorySeries` to validate and chronologically order **recorded** ratings from the existing `rating_trajectory` endpoint. The chart now exposes start/end dates and per-time-class summaries with latest recorded rating, entry count, and exact first-to-last difference; a single entry explicitly states there is no trend to compare. A lone data point is centered and visually legible. The explanation distinguishes saved ratings from modeled estimates. The visualization still draws actual recorded values without interpolation or fabricated history. Added English/German/Russian copy.
- **Tests:** Pure helper tests cover chronological ordering, first-to-last difference, one-point behavior, invalid dates and non-finite ratings. An Insights component test confirms the visible `+48` example, recorded entry counts, and the non-trend single-entry state.
- **Actual browser:** Chrome at 390px dark/reduced-motion and 1440px light/reduced-motion with authenticated, explicitly mocked Insights data. Three real-looking time-class series were supplied as fixture records: Rapid 1250 → 1298 (+48), Blitz single 1050, Bullet 840 → 801 (−39). Both views displayed grounded summaries and time-axis labels, with no uncaught browser errors or page overflow. Screenshots `qa/agent-d-browser/insights-rating-{phone,desktop}.png` visually inspected. The fixtures do **not** certify live account rating-history data.
- **Final verification:** `npm run typecheck` and production `npm run build` passed. Full `npx vitest run --maxWorkers=4` passed with **990 tests passed, 12 skipped, zero failures** across 114 test files.
- **Next:** Consider high-volume rating-history rendering: the endpoint currently returns every rating record and the chart creates one SVG circle per point, which can become expensive for very large collections. Any downsampling must preserve actual endpoints and extrema without hiding moves or claiming a different trend.

## Tenth pass — 2026-11-12 (continued from `78ee862`)

### Bound rating-chart rendering while preserving meaningful history

- **Reproduction:** A real Chrome fixture with 6,000 historical Rapid rating updates rendered all **6,000 SVG circles** in one chart. This is a scaling risk for accounts with large rating histories; elapsed end-to-end page loads vary with browser/fixture overhead, so avoid claiming a demonstrated speedup from that one timing.
- **Fix:** `condenseRatingHistory` limits plotted points to **320 per time class**, keeping the chronological first/last values and both the recorded minimum and maximum in each time bucket. All original history remains available to compute Y-axis extremes, date range, entry count and first-to-last difference. The UI explicitly says when a long graph has been condensed; a small history still renders every point. Replaced potentially unsafe `Math.min(...veryLargeArray)` / `Math.max(...veryLargeArray)` with incremental bounds calculations. English/German/Russian explanatory copy added.
- **Tests:** Synthetic 6,000-point unit fixture preserves exact endpoints and global extrema, chronological order and source integrity; tiny series remain unchanged. Ratings-helper and Insights state tests passed.
- **Actual browser:** Replayed the identical 6,000-point rating fixture in Chrome at 390px. After the change, the page rendered **320 circles** instead of 6,000, with no errors or horizontal overflow. The graph retained the large peak and trough, the correct first-to-last +260 summary and the full 6,000-entry count. `qa/agent-d-browser/insights-rating-long-history.png` was visually checked.
- **Scope:** This is only a client rendering cap, not server-side truncation or deletion of rating history. Do not claim exact timing improvements without a controlled benchmark.
- **Final verification:** `npm run typecheck` and production `npm run build` passed; the full `npx vitest run --maxWorkers=4` suite passed with **992 tests, 12 skipped and zero failures** across 114 files. The 6,000-point Chrome fixture still showed correct recorded summaries after condensation.

## Eleventh pass — 2026-11-12 (continued from `814010b`)

### Explain the accuracy sample and avoid a false one-game trend

- **Problem:** The accuracy history chart showed a line and unlabeled horizontal span, with no visible coverage dates, sample count, or clarification of the averaging denominator. A lone analyzed game could appear as a trend even though one score cannot describe improvement.
- **Fix:** Expose the recorded start and end dates, the analyzed-game count displayed, win/loss/draw-or-unknown dot legend, and the fact that the average covers only the plotted games, not all saved games. For exactly one analyzed game, center its recorded point, omit the connecting line and average reference line, and explicitly state that a trend cannot be inferred. Added English/German/Russian messages, with grammatical singular/plural cases.
- **Tests:** Expanded `Insights.states.test.tsx` with 3-game sample/date/average/legend coverage and a one-game regression asserting one circle and no trend path. Focused component suite passed after correcting a test's expected accessible chart label to the actual translated accessible name.
- **Real browser:** Chrome with authenticated API fixtures, 390px dark/reduced-motion for one analyzed game and 1440px light/reduced-motion for three games. Both scenarios displayed the expected labels and SVG points (1 circle/no connecting path; 3 circles/1 path), with no console errors or page overflow. Saved and visually inspected `qa/agent-d-browser/insights-accuracy-{phone,desktop}.png`.
- **Final verification:** `npm run typecheck`, production `npm run build` and complete `npx vitest run --maxWorkers=4` passed: **994 passed, 12 skipped, 0 failed** across 114 test files. The browser observations use mock data, not production user statistics.

## Twelfth pass — 2026-11-12 (continued from `d875d6f`)

### Prevent misleading time-control results and accuracy coverage

- **Reproduction:** The original Insights time-control bar painted the entire remainder after wins and draws as losses. A Chrome fixture with ten Rapid games (4 wins, 2 draws, 3 losses, **1 other result**) falsely made 40% of its bar red rather than 30%. The adjacent unlabeled `76.4%` gave no indication of the sample size, and an `other` time class from the same API was not displayed at all.
- **Frontend fix:** The bar now uses only the authoritative loss count, with unclassified results left neutral and explicitly counted. The card shows which outcome categories contribute, makes the measured player-side average explicit, distinguishes absent accuracy from 0%, and renders unknown or unclassified time-control categories rather than silently dropping them. English, German and Russian strings were added.
- **Backend fix:** The existing Insights endpoint now returns `accuracy_games`, the number of current-version analyses with actual measured accuracy for the player's known color. `analyzed_games` can be larger; the measured average's denominator is no longer misstated. The SQL groups both NULL and literal `other` time controls under the same key *before* aggregation so one group cannot overwrite the other. These are read-only aggregate changes; no game sources, analysis or production data were modified.
- **Regression tests:** A new throwaway-SQLite endpoint test covers one measured game among three analyzed, unknown player color, unrelated-user isolation, an unclassified result, and combining null/`other` time-class labels. Existing complete-history tests remain green. A mounted Insights component test asserts the 40/20/30% W/D/L segments, measured accuracy text, neutral other-outcome explanation and extra time-control row.
- **Chrome QA:** With authenticated API fixtures, checked 390px dark/reduced-motion and 1440px light/reduced-motion: a card that previously displayed 40% losses now correctly displays 30%, `Accuracy 76.4% · 1 measured game`, `1 other result`, and `Other / unspecified`. No uncaught browser errors or page-level overflow. Screenshots `qa/agent-d-browser/insights-timeclass-{phone,desktop}.png` saved and visually reviewed.
- **Final verification:** `npm run typecheck`, production `npm run build`, and complete `npx vitest run --maxWorkers=4` all passed: **996 tests passed, 12 skipped, zero failures** across 115 test files. Both new server accuracy-denominator and rendered segment tests pass; no changes outside the Insights lane.

## Thirteenth pass — 2026-11-12 (continued from `6179eca`)

### Do not silently lose personalized puzzle attempts on a failed save

- **Reproduction:** A real Chrome personal-practice fixture caused `POST /api/train/attempt` to fail. Once the sample solution finished animating, **Next puzzle** became enabled even though the first attempt was not recorded. There was no visible save failure or retry; the UI also claimed the puzzle would return tomorrow although no attempt was saved.
- **Fix:** A private puzzle's first attempt is captured once and held as the authoritative retry payload. The page exposes pending, acknowledged, and failed save states, with a retry preserving the exact first outcome (a hint/wrong move cannot be rewritten as a clean solve). **Next puzzle** remains disabled while the attempt is unacknowledged; after an error, **Continue without saving (this puzzle may repeat)** explicitly describes the cost. Only server-acknowledged attempts display the learned/comes-back retention claims. SPA navigation uses Patzer's existing data-router blocker and an accessible choice to stay, retry, or leave unsaved; native unloads receive a browser warning. Auth redirects are exempt. Added English, German and Russian copy.
- **Tests:** New `Train.saving.test.tsx` with the real data router and Strict Mode checks failed-first-attempt retry equality, saving-pending navigation blocking and delayed retention claims, and explicit unsaved exit / Escape. The existing private practice and plan data-state tests remain green.
- **Browser:** Chrome 390px dark/reduced-motion and 1440px light/reduced-motion with authenticated fixture game positions. A 503 first attempt displayed a save warning and disabled Next. The retry resent exactly the same `{game_id:101, ply:1, solved:false, today:'2026-11-12'}`; after acknowledgment, mobile advanced to the empty queue and desktop's blocked Home navigation resumed. No page errors or horizontal overflow. Captured and inspected `qa/agent-d-browser/train-save-{phone-warning,phone-recovered,desktop-blocked,desktop-recovered}.png`. The training positions were intentionally mocked and do not represent analysis of a live user's games.
- **Next scoped finding:** The desktop personalized training board appears smaller than available space, due to the width of a nested `FromYourGames` layout wrapper. Reproduce and address separately after this save-relability checkpoint is committed.
- **Final verification:** `npm run typecheck`, production `npm run build`, and full `npx vitest run --maxWorkers=4` passed with **999 tests passed, 12 skipped, 0 failed** across 116 files. The explicit Chrome first-attempt retry and global-navigation recovery scenarios passed and were visually reviewed.
