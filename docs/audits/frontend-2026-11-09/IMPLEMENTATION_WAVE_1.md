# Patzer frontend audit consolidation and first implementation wave

**Date:** 2026-11-09 UAE. **Branch:** `fix/review-ux-audit-20261109`. **Owner:** single implementer. **Source:** reports 01–04 in this directory. Agent 1's expected report was **not present** in the repository, so 01 is clearly labeled an owner-collected fallback rather than an independent agent result; report 03 was partly saved by Agent 3 before its failure and supplemented by independent browser evidence. Reports 02 and 04 are owner-collected replacements.

## What changed

| Priority | Finding(s) | Implemented |
| --- | --- | --- |
| P1 | L01/L02/L03/F02 | Game Review no longer clamps the board to `100vh - 24rem` or fixes the rail at 380px. Balanced adaptive grid at desktop widths, stacked on compact screens; full normal document scroll instead of clipped workspace/independent rail scrollbar |
| P1 | L04/A10 | Removed persistent footer and all visible GitHub star promotions from the app shell/changelog; kept version/changelog trigger in navigation and mobile drawer |
| P1 | L05 | Desktop nav rail explicitly clips horizontal overflow; transport isn't text-selectable |
| P1 | C01/C02/C16/F07 | Review consumes arrow/Home/End browser defaults, defers to inputs, modals, sliders and tablists, avoids listener churn and honors global command-navigation precedence |
| P1 | C03/F04 | Original game timeline identified when exploring a branch; its move highlight is suppressed; branch share copies a working Lab link containing the exact displayed FEN rather than a misleading original-game URL |
| P1 | C04 | Unknown/unsuccessful hypothetical engine scores show pending/unavailable, **not** fabricated `0.00` or a fake reliable threat estimate |
| P1 | C05/F05 | Visible error and retry affordance for full-game Stockfish failures, no unhandled rejected analysis promise |
| P1 | C06 | Avoid two move sounds when a board move advances the saved PGN |
| P1 | C08/L09 | Disabled boundary actions for mainline, immediate move-list scrolling and reduced-motion-aware stat-to-move jumps |
| P1 | F01 | React.lazy for 16 authenticated routes with in-shell Suspense fallback, avoiding eager loading of heavy analysis/PvP pages |
| P1 | F06/C13 | Bookmark and notes mutations invalidate game/list caches; note-save failures retain the draft and offer Retry |
| P2 | A03/C12 | Keyboard-operable evaluation SVG with proper slider state/value semantics |
| P2 | A04 | Review tabs get tablist/tabpanel, selected state, roving focus, Arrow/Home/End navigation |
| P2 | A06 | Changelog modal has a label, proper dialog role, Escape, focus trap and trigger focus restoration |
| P2 | A08 | Analysis depth range has an associated programmatic label |
| P2 | C09/F17 | Clicking a Stockfish MultiPV recommendation creates a legal ephemeral branch; old inert faux buttons removed |
| P2 | F15/L14 | Geometric and interaction browser QA assertions added beyond screenshot existence |

### Measured improvements

An isolated QA Chromium session at **1704×857**, same game and theme:

| Dimension | Before | After |
| --- | ---: | ---: |
| Chessboard width | **472px** | **608px** (+28.8%) |
| Board area | ~223,000px² | ~370,000px² (+65.9%) |
| Right analysis rail width | **380px** | **620px** (+63.2%) |
| Wasted right margin (before columns balanced) | ~424px | ~153px, balanced by equal left margin |
| Right rail scroll | 1530px scroll content within 681px internal scroller | Full content on natural document scroll, no secondary rail scrollbar |
| Persistent footer | Version + GitHub star | None; version in navigation |

The built **entry** JavaScript chunk decreased from approximately **1,935 KB to 709 KB minified** (about 63% smaller), and approximately 495 KB to 240 KB gzip. Other route chunks and an icon chunk are loaded as needed, so this is **not** a claim that total transferred JavaScript fell by 63%. Actual user-device startup time remains to be benchmarked.

### Verification evidence

- `npm run typecheck`: PASS.
- `npm test`: **561 / 561**, 58 test files.
- `node --test integrations/mcp/test.mjs`: **7 / 7**.
- Production server/frontend build: PASS in `/tmp/patzer-ux-preview-20261109` (never rebuilding the deployed live app during validation).
- Chromium QA `qa/agent07/frontend-overhaul-smoke.mjs`: **35/35** PASS, expanded from 27 with geometry, keyboard default-action, tab, modal, evaluation, share-FEN and Stockfish-branch cases.
- All five legacy suites on disposable code/database: `test:e2e`, `test:resume`, `test:oidc`, `test:ui`, `test:resume-ui` **PASS**.
- QA renders light/dark at 1920x1080, 1440x900, 1366x768, 768x1024, 390x844; also tests desktop 1704x857 geometry, special chess moves, mobile touch, original PGN immutability and auth constraints.
- The owner's live service/database were not mutated by tests; the prior site continues serving its previous release until deployment.

## Open findings and deliberate nonclaims

1. **Gray horizontal overlay in the owner's exact screenshot:** not reproducible in disposable Chromium; `cg-board` had no overflow and there were no visible range inputs in the corresponding test state. Exact browser/device/extension element must be inspected before calling it solved. We did fix several genuine scroll containers and the footer; the specific bar is still **unverified**.
2. **C07/F03:** Engine MultiPV, threat and exploratory scoring still share a single-user backend semaphore and can 429; implement a FEN-aware query coordinator with priorities, cancellation and deduplication.
3. **A05/A09:** Admin Users modal and System configuration still need full accessible Dialog/Field primitives, focus/label audit.
4. **F08/F09/F18:** React performance profiling, abortable API signal contract, consistent query caching for all review side panels.
5. **F10/F11:** Full named variation-tree sharing/persistence, Review page server pagination and debounced search. Branch FEN can be shared in Lab now, but not the complete variation history.
6. **C10/C14:** External same-route `?ply` updates and keyboard-managed promotion picker still need dedicated tests/remediation.
7. **L07:** Review and PvP Play workspace size policies still differ. Preserve current tested PvP arrangement while a shared layout abstraction is designed.
8. **Actual screen-reader, sound-listening, full WCAG contrast audit:** not performed. Browser checks cover semantics/keyboard but don't establish exhaustive accessibility.

## Next implementation sequence

1. Run manual device/session diagnosis of the gray overlay, and visually inspect all rendered screenshot captures with the owner (especially very wide and short desktops).
2. Add engine request coordination and better request cancellation, prioritizing board move response over passive analysis panels.
3. Improve admin and promotion dialog keyboard access, route error boundaries, and centralized action feedback.
4. Add move search/pagination, true branch tree management, Stockfish comparisons and a Review→Train practice loop. These are separate product increments that should not ship as untested, speculative code in the visual bug-fix release.

No database migrations, credentials, tunnel configuration or MCP authorization behavior were intentionally changed by this wave.
