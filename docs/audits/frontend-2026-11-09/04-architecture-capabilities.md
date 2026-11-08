# Patzer — Frontend architecture, performance, reliability and capability audit

**Owner-conducted audit replacing failed Agent 4, 2026-11-09.** Baseline `main` at `c3ed65b`. This is analysis and a proposed roadmap, **not an implementation**. No production code, database or Git state was modified.

## Executive findings

The current application contains functional chess analysis, game review, real-time PvP, learning and an MCP connection wizard. These are real capabilities, not placeholders. But there are measurable architectural gaps that make the UI less responsive and less reliable than its underlying features deserve: **all major routes are eagerly imported into a 1.93 MB production JavaScript entry chunk**; Game Review uses **several independent state/position systems**; expensive Stockfish requests are **coordinated only by HTTP 429 and retries**; data-mutation cache synchronization is inconsistent; and existing screenshot QA has **no minimum board-utilization assertion**. Many of the user's apparent visual complaints derive from cross-component layout policy, not the graphic theme.

**Observed data:** `web/dist/assets/index-D6CdRn_x.js` is approximately **1.93 MB minified**, reported gzip ~**493 KB** in the successful Vite build; `web/src/App.tsx:8-33` statically imports all major routes; `web/vite.config.ts:11-16` sets build warning limit 1500 KB but no route code splitting. Browser at 1704×857, dark, with an isolated QA game: workspace 1584px; main board 472×472; board column 760px; rail 380px; ~424px of horizontal workspace past the two columns unused. Independent QA at `qa/agent07/frontend-overhaul-smoke.mjs:243-255` requires board squareness, **maximum** board-to-viewport ratio and absence of horizontal overflow, not good use of available area. Root `scrollWidth==innerWidth` passed despite visible emptiness.

**Priority rubric:** P0 data/security loss; P1 large correctness/performance/product issue; P2 quality/maintenance; Future optional feature. Confidence is **measured**, **source-confirmed**, or **proposed / requires profiling**. No independently verified P0.

## Technical findings and remediations

| ID | Priority | Confidence | Complexity | Finding / recommended approach |
| --- | --- | --- | --- | --- |
| F01 | P1 | Measured | M | Eager route imports create a ~1.93 MB entry JS chunk — route-level lazy loading and prefetch |
| F02 | P1 | Measured | M | Game Review wastes available space — responsive chess workspace layout primitive |
| F03 | P1 | Source-confirmed | M | Three engine consumers compete for same per-user single-flight semaphore — request coordinator |
| F04 | P1 | Source-confirmed | M | Variation and mainline are not consistently represented across board/graph/link/report — displayed-position model |
| F05 | P1 | Source-confirmed | S | Analysis network failures not caught in UI — error+retry state and no unhandled promises |
| F06 | P1 | Source-confirmed | S | Bookmark/notes updates aren't synchronized with React Query game caches |
| F07 | P1 | Source-confirmed | S | Native keyboard actions leak into scoped chess navigation; global shortcuts conflict |
| F08 | P2 | Source-confirmed | M | Repeated O(n)-style graph/move derivations and renders on React UI state changes |
| F09 | P2 | Source-confirmed | S | API client cannot pass abort/cancellation through its convenience `get/post` API |
| F10 | P2 | Source-confirmed | M | Deep-link and variation state need a coherent serialization/restoration contract |
| F11 | P2 | Source-confirmed | M | Review game browser hard-limits results to 100, with no visible pagination |
| F12 | P2 | Source-confirmed | S | Long nested scroll surfaces are poorly coordinated and hit keyboard/viewport UX |
| F13 | P2 | Source-confirmed | S | MCP dashboard polls every 5s without in-flight guard or visibility awareness |
| F14 | P2 | Source-confirmed | M | Routes do not share a unified error boundary and request-error taxonomy |
| F15 | P2 | Source-confirmed | S | Browser screenshot QA captures but doesn't compare layouts or enforce minimum width usage |
| F16 | P2 | Source-confirmed | M | Massive GameAnalyzer/Play files blend chess logic with layout and I/O |
| F17 | P2 | Source-confirmed | S | Engine line suggestions appear actionable but most click handlers are inert |
| F18 | P2 | Source-confirmed | M | React Query usage is inconsistent with some manual `useEffect`/local caches |
| F19 | Future | Product proposal | L | Saved, named and shareable variation trees, with an explicit mainline-vs-branch UI |
| F20 | Future | Product proposal | M | One-click drill creation from an actual game mistake, linked to existing Train/Plan |
| F21 | Future | Product proposal | M | Review-to-opening repertoire feedback with statistics on recurring mistakes |
| F22 | Future | Product proposal | M | Lightweight comparison mode: saved move vs engine top line, evaluation swing and why |

### F01 — Initial JavaScript payload dominated by eager route loading (P1, measured)

**Evidence:** `web/src/App.tsx:8-33` static imports for every authenticated and unauthenticated screen, plus heavy Home, Play, Insights, Learn, Train, Lab and admin; `web/vite.config.ts:11-17` no `manualChunks` and sets 1500 KB warning. Build artifact `web/dist/assets/index-D6CdRn_x.js` ~1.93 MB raw, Vite reports ~493 KB gzip and warns about large entry. The raw size is confirmed; actual browser startup latency is **not yet measured**, so do not claim a specific FPS or second reduction. **Impact:** users loading Login/Home pay the parse/compile cost of game analysis and charts even before entering those pages; slower low-power/mobile devices. **Remedy:** React.lazy/Suspense with route-level chunks for Home, Play, Review/GameAnalyzer, Insights, training, Learning and admin; preserve lightweight shell/auth; prefetch likely next destination on hover/idle with budget and React Query prefetch. **Tests:** build chunk manifest diff, first-visit total JS transferred/parse time on simulated mid-range phone, keyboard and auth route behavior, lazy-loading fallback and offline errors; ensure features not broken by split dependencies.

### F02 — Layout policy clamps the board instead of allocating workspace (P1, measured)

**Evidence:** `GameAnalyzer.tsx:392-414,474`: 760px capped board column and 380px capped right rail, with board capped to `100vh - 24rem`. At 1704×857, Playwright measured a 1584px workspace with 760+20+380=1160px columns, **424px unused horizontally**; the board is only 472px wide, leaving blank space *within* its 760px board column too. Shell `Layout.tsx:319-324` is full width, so root cause lies in review child layout. `Play.tsx` has independent sizing constraints. **Remedy:** a shared chess-workspace CSS grid with viewport-aware board and a flexible, optionally resizable rail, avoiding unnecessary fixed `max-width` and nested scrolling. Introduce visual density presets Fit Height / Fill Width, persistent per-user setting if desired. **Verification:** computed board width, column usage and target focus at 1366/1440/1704/1920/2560 widths plus 200% zoom; full-page scroll and mobile layout must remain functional. **Note:** the gray screenshot overlay was not reproduced in the isolated QA session, so its owner must be identified separately; don't hide scrollbars blindly.

### F03 — Stockfish concurrency coordination is backend-only (P1, source-confirmed)

**Evidence:** `server/src/routes/analyze.ts:148-170,224-235` rejects a concurrent per-user `/position` or `/variation-move` with 429. Three consumers can be active simultaneously: `GameAnalyzer.tsx:176-207` branch scoring, `:282-293` MultiPV, `ThreatPanel.tsx:90-116` null-move analysis with 4 retries. UI cancellation flags prevent stale *display* updates, but the API helper does not abort fetch; the engine continues until complete. **Remedy:** a shared FEN-keyed frontend analysis query broker, priority scheduling, concurrency one, cancellation, deduplication and bounded backoff; consider a small server queue and progress API only if profiling justifies. **Verify:** trace 30 rapid ply changes with all panels on; assert no 429 storm, final FEN only, reasonable CPU/latency and no server engine leaks. **Risk:** changes must not starve interactive PvP or alter persisted analysis rules.

### F04 — Fragmented position state (P1, source-confirmed)

**Evidence:** `GameAnalyzer.tsx:155-171` variation controller returns FEN and current branch; `:221-227` URL synchronization writes only `originalPly`; `:280-320,530-542,605-680` graph/list/report and position export sometimes use different sources. The board reflects branch FEN; graph/highlights remain on mainline base ply. **Remedy:** `DisplayedPosition` domain type with `kind`, FEN, original game ID, base ply, cursor, evaluation state, last move, branch ancestry, share target; selectors are the only data source for presentation and API calls. Make baseline vs branch comparison explicit. **Verify:** a three-level branch with promotion/undo and move-list click, share link, graph highlight, training-from-position and export all agree or are labeled mainline-only.

### F05 — Failed analysis lacks a reliable application-level state (P1, source-confirmed)

**Evidence:** `GameAnalyzer.tsx:260-269` has `try/finally`, no `catch`; `:113-116` automatic stale-analysis calls `void analyze`. **Remedy:** common `AsyncState` (`idle/loading/success/error`, error type, retry, abort), user feedback and metrics; idempotence guards for auto-analysis. **Tests:** full-game analysis returning 429/500/network abort, timeout, stale analysis; no unhandled rejection, Retry must work. **Complexity:** S.

### F06 — Mutations leave overview game caches stale (P1, source-confirmed)

**Evidence:** `GameAnalyzer.tsx:697-705,711-714` locally toggles bookmark and saves notes with `useMutation` but does **not** use `useQueryClient`/invalidate `['games']` or `['game',gameId]`. `Review.tsx:24-32` caches list results under `['games',{bookmarkedOnly,q}]`, and `web/src/main.tsx:9-12` sets 30s staleTime and disables focus refetch. **Impact:** return from a game you just starred/noted can show an outdated Review list or stale metadata within the cache window; toggles may appear to succeed even if PATCH fails. **Remedy:** optimistic update with rollback, invalidate relevant game/list/stats queries, pending/error feedback and disable conflicting quick repeat. **Verify:** bookmark/unbookmark in Game Review, navigate immediately to Review filters without waiting 30s; list and game data agree after 2xx and recover correctly after 500. **Complexity:** S.

### F07 — No central shortcut ownership (P1, browser/source verified)

**Evidence:** `GameAnalyzer.tsx:239-258` window listener consumes Arrow/End/Home/F/S but no `preventDefault`, no editables beyond input/textarea/select and no modifier checks; `App.tsx:83-123` separately attaches Ctrl+K/?/g+key shortcuts. Isolated Chromium on `/review/1?ply=3` recorded ArrowRight/ArrowLeft `defaultPrevented:false` while moving 3/8→4/8→3/8. **Remedy:** focus-scoped keyboard command manager with clear priority for dialogs/forms/board/global; prevent browser defaults *only* for handled keys. See detailed chess audit #C01/#C02/#C16. **Complexity:** S–M. **Verify:** caret browsing, arrow key repeat, scroll and `g,s` interplay.

### F08 — Allocations rerender graph despite `useMemo` (P2, source-confirmed)

**Evidence:** `GameAnalyzer.tsx:526-535` maps `analysis.moves` to new `evals`/`markers` arrays every parent render. `EvalGraph.tsx:48-57` memoizes `points` based on `evals` identity, so every parent refresh (hover arrows, unrelated status, selected tab) invalidates that memo; `:63-67` builds SVG paths and `:103-134` renders markers. `MoveList.tsx:24-41,55-72` rebuilds paired rows on every render. **Remedy:** memoize stable graph data by analysis identity, use React.memo for pure graph and move rows, move hover visuals local, profile first rather than optimization by instinct. **Verify:** React Profiler on 100/250-ply fixtures: parent state change should not rerender unaltered graph/move list. **Complexity:** M; exact speedup unmeasured.

### F09 — Convenience API lacks request cancellation (P2, source-confirmed)

**Evidence:** `web/src/api.ts:1-32` internal `request` accepts RequestInit, but public `api.get<T>(path)`/`api.post<T>(path,body)` expose neither `signal` nor timeout. Higher-level panels work around with `cancelled` booleans (`GameAnalyzer.tsx:176-207,282-293`, `ExplorerPanel.tsx:54-64`), which prevents updates but still consumes network and engine work. **Remedy:** optional RequestInit (including AbortSignal), error type/status normalization, timeouts by endpoint, and React Query signal propagation. **Verify:** rapid route change aborts obsolete FEN request; don't abort important committed writes. **Complexity:** S.

### F10 — No variation/deep-link contract (P2, source-confirmed)

**Evidence:** `GameAnalyzer.tsx:149-157` initial `?ply` read, `:221-227` replaces current URL with mainline ply; branch state in `useAnalysisVariations.ts:47-65` is memory-only and resets when game changes. Buttons promise share link to position (`GameAnalyzer.tsx:668-675`) but variation state isn't encoded. **Remedy:** URL versioned serializer with `gameId`, `mainPly`, optional temporary FEN/branch path or a safe short share token; explicitly differentiate a mainline deep link vs a shared line. **Verify:** reload, back/forward and copy/paste nested branch, no implicit persistence of user-private analysis unless opted in. **Complexity:** M.

### F11 — Review pagination and search UX do not scale with collection size (P2)

**Evidence:** `Review.tsx:24-32` sets `limit:'100'` with no pagination controls visible, though server supports game listing. The search query key changes for every keystroke (`:18-20,24-31,100-105`), causing a new request/query-cache entry per character without debounce. **Remedy:** cursor pagination/infinite load, debounced search, result count/filter chips, virtualize if row count becomes large; cap cache variants. **Verify:** fixture of 1000 games, search rapidly, browse past first page, keyboard/focus and no lost bookmarked filter. **Complexity:** M. Server pagination capabilities require checking before design.

### F12 — Scroll surfaces are not a coordinated hierarchy (P2)

**Evidence:** review right rail `GameAnalyzer.tsx:474` uses `overflow-y-auto`, move list has another `overflow-auto` at `MoveList.tsx:42-45`, and selection calls `scrollIntoView` from `GameAnalyzer.tsx:364-371` plus `MoveRow.tsx:24-41` smooth scrolling. **Remedy:** choose one primary scroll container per viewport; desktop rail only with an anchored move list, mobile page scroll with sticky transport, avoid scroll chaining; use nearest-scroller calculation and reduced-motion check. **Verify:** keyboard replay and selected-stat jump in 120-ply game; no board motion, no inaccessible content. **Complexity:** S–M.

### F13 — MCP dashboard status polling is safe but unnecessarily noisy (P2)

**Evidence:** `McpConnection.tsx:33-49` polls every five seconds even when hidden and permits overlapping async `refresh` calls; its backend `server/src/mcp/tunnel.ts:112-135` performs two systemctl subprocesses and, if active, a tunnel-client health subprocess with up to 6.5s timeout (`:77-93`). **Impact:** out-of-order status responses and needless subprocesses while dashboard tab is idle; not a credential leak. **Remedy:** query with `refetchInterval` only while visible + connected, in-flight guard/generation token, cache small status period, immediate refresh on actions, separate warning if health is stale. **Verify:** simulate health check taking 7s, page hidden for 1 minute, rapid start/stop; status must not regress due to an old response. **Complexity:** S.

### F14 — Error management is route-dependent (P2)

**Evidence:** `App.tsx:190-220` renders routes without a common route-level React error boundary; GameAnalyzer has direct unguarded PGN parse (`:133-146`) and analysis JSON parsing (`:91-107`). Some panels have explicit catch while others don't, such as `GameAnalyzer.analyze`. **Remedy:** route boundary with safe error screen, retry/back and error logging without secrets, plus specific error states for data parsing/network conditions; validate imported PGN before rendering. **Verify:** corrupted QA analysis JSON, malformed PGN, lazy-chunk failure, transient backend outage; do not render a blank app. **Complexity:** M. Note: server import validation may prevent malformed PGN in normal use, so treat it as resilience defense rather than a reproduced production incident.

### F15 — Existing screenshot QA does not measure design outcomes (P2)

**Evidence:** `qa/agent07/frontend-overhaul-smoke.mjs:243-255` captures light/dark screenshots across five viewports and checks `noOverflow`, square board, and a maximum 58% board width ratio. It does not compare screenshots against approved baseline or require a minimum board width/workspace utilization. Thus 472px board and unused 424px gutter at 1704×857 remain a **passing test**. **Remedy:** add min/max ratio to available *workspace* size with exceptions for small-height viewports; capture geometry traces and approved visual snapshots, verify scroll ownership and caret selection. **Verify:** make old bug intentionally fail before fix, then pass afterward. **Complexity:** S–M.

### F16 — Large files blur responsibility boundaries (P2)

**Evidence:** `GameAnalyzer.tsx` 929 lines, `Play.tsx` over 1000 lines, with API calls, chess state, markup, sounds, navigation and async orchestration in the same components. This does not automatically make them wrong, but changes to one area can regress another. **Remedy:** extract a reusable `ChessWorkspaceLayout`, pure `useReviewKeyboard`, `useDisplayedPosition`, `usePositionAnalysis` and `useReviewMutations`; keep UI dumb and domain chess state pure. Prefer incremental extraction with tests rather than speculative rewrite. **Complexity:** M; regression risks are high if attempting all at once.

### F17 — UI affordance mismatch for PVs (P2)

**Evidence:** `GameAnalyzer.tsx:874-899` every engine line is a `button`, but only one coinciding with the PGN's next move performs `onAdvance`. **Remedy:** let a legal PV first move create an ephemeral branch (using existing analysis controller), or render as nonbutton text with a separate explicit “Try move” control. **Verify:** all focusable controls have an outcome. **Complexity:** S.

### F18 — State/cache consistency across modules (P2)

**Evidence:** `web/src/main.tsx:9-12` React Query provides stale/retry settings; Home/Review use it, but GameAnalyzer manually caches `analysis` (`:75-76,91-117`), prose (`:119-125`), branch scores (`:165-208`), and side panel engine data (`:274-293`), each with different cancellation/error policies. **Remedy:** shared query keys for id/FEN/depth/lines and auth scope; explicit invalidation policy, stable selectors, consistent `enabled`/retry rules; keep ephemeral branch state separate from fetch cache. **Verify:** switching games while requests pending, stale analysis refresh, fast board navigation and mainline return. **Complexity:** M; preserve real-time/socket behavior.

## Capability-maximization recommendations (extend what exists; don't duplicate)

**F19 — Named variation library** (Future, L): The pure branch reducer is already capable of parent/child sequences (`analysisVariations.ts:22-40,175-236`). Give analysts a tree view with rename/delete, compare 2 branches, choose best line and optionally persist *user-owned private* analyses separately from immutable game PGN; export to PGN variations and share controlled links. Test concurrency, opt-in privacy and PGN conversion.

**F20 — One-click “Train this mistake”** (Future, M): Review has classifications/cp-loss and `Train.tsx` already supports puzzle workflows. Link an actual mistake to a spaced-repetition queue with preceding FEN, side to move, best move, error type and last-attempt state. Display “Practice this position” from a Review moment, without adding an unrelated training engine. Test game ownership and FEN correctness.

**F21 — Opening repertoire feedback loop** (Future, M): Reuse existing `Openings.tsx` and Review's ECO/opening data. Show recurring mistake patterns per opening, connect specific game positions to matching trainer lines, and track improvement across sessions. Test source-game mapping and lower-sample uncertainty.

**F22 — Side-by-side move comparison** (Future, M): Existing Stockfish multipv and move classification support comparing played vs best UCI, evaluation delta, concrete tactical motifs and move continuation. Provide two linked board positions/variation panes only when space permits; on mobile use a segmented toggle. Never claim an AI explanation has Stockfish certainty if it comes from an LLM.

## Top-15 implementation roadmap, ranked impact / effort

| Rank | Priority | Work package | Size | Acceptance gate |
| --- | --- | --- | --- | --- |
| 1 | P1 | Centralize Review shortcuts and `preventDefault` | S | No caret/scroll, modals and inputs unaffected |
| 2 | P1 | Responsive board + rail grid and visual viewport contract | M | Board fills sensible space at 1704×857 and 1366×768 |
| 3 | P1 | Distinguish mainline versus variation position everywhere | M | Board, graph, annotations and share agree |
| 4 | P1 | Unknown engine eval remains unknown, not 0.00 | S | Slow/failed engine shows pending/unscored |
| 5 | P1 | Failure feedback and retry for Game Review analyses | S | 429/500/network errors don't throw silent promises |
| 6 | P1 | Mutation cache invalidation/rollback for bookmark/notes | S | Immediate return to Review shows true values |
| 7 | P1 | Coordinate Stockfish side panels and variation scoring | M | Rapid navigation has no runaway 429/search storm |
| 8 | P1 | Route-level code splitting and meaningful fallback | M | Smaller initial JS; navigation parity |
| 9 | P2 | Rework move-list/rail scroll hierarchy, no jitter | S–M | Rapid keyboard replay leaves board in place |
| 10 | P2 | Graph data memoization and bounded re-rendering | M | Profiler confirms fewer renders for 100+ ply |
| 11 | P2 | Abortable API helper + shared query key patterns | M | Abandon obsolete requests and keep last FEN result |
| 12 | P2 | Review pagination + debounced query | M | Browse/search 1000-game fixture effectively |
| 13 | P2 | Actionable engine line “Try it” and keyboard chart | M | All focusable lines actually work |
| 14 | P2 | Browser geometric and visual snapshot regression gate | S–M | Previous board sizing bug would fail CI |
| 15 | Future | Review → Train mistakes; named variation management | L | Useful practice loop, safe/private saved analyses |

## Validation and deployment constraints

- **Protect actual game data.** All new UI/browser tests must use disposable SQLite fixtures; the existing full browser script and main CI already isolate DB. No need to edit personal games during audit.
- **Baseline must remain green:** `npm run typecheck`, `npm test` (561 tests on latest merge), 7 MCP protocol tests, 27 independent browser QA checks, multiplayer/SSO/resume browser regressions and Docker boot smoke. Add new tests *that fail on current defects*.
- **Front-end performance baseline:** use Chromium Performance API/React Profiler and throttled devices before promising a speedup. Entry artifact size is measured; initial actual load-time is not.
- **Code safety:** preserve authorization/CSRF for MCP/admin endpoints (`server/src/routes/mcp.ts:12-42`), private key storage, local-only service controls, shared game ownership, and Stockfish queue limits. **Do not** loosen permissions for UX improvements.
- **Visual confidence:** existing screenshots were captured across 5 widths × 2 themes, but no human image diff or real screen-reader pass was performed in this audit. Color contrast, exact scrollbar origin, CPU savings and real mobile smoothness remain to be verified.

## Claims requiring further verification

1. Whether the gray bar across the owner's green board is an OS/browser overlay scrollbar, a transient DOM element, a screen recording artifact or extension-induced UI. The isolated dark test displayed **no `input[type=range]`** and the board had no scrolling overflow; don't guess.
2. Exact impact of route splitting on real startup time and low-end mobile responsiveness.
3. Whether game-list server pagination supports a cursor or must first be added.
4. Real-world Stockfish CPU/429 pattern with MultiPV+threat+variation simultaneously enabled.
5. How often users need to share ephemeral variation branches (privacy and storage design).
6. Whether Play and Review ought to use the same board density at very short viewport heights.
7. Any audio quality defects — no listening tests were performed.
8. Contrast WCAG ratios and real screen-reader behavior beyond source audit.

**Completed:** independent source- and geometry-based architecture audit. **Not completed:** user-approved UI implementation, benchmarks or release. All proposed changes remain for the owner-implementer.
