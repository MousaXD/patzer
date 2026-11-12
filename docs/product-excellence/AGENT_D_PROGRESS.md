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
