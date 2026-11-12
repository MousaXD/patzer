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
