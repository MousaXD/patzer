# Patzer — Chess UX, interaction and behavior audit (owner takeover)

**Audit date:** 2026-11-09 (Asia/Dubai). **Baseline:** `main` / `c3ed65b`.  **Scope:** source read-through, existing passing independent browser suite, and my own isolated Chromium examination. **AUDIT ONLY:** no app-source changes, live database edits, git commits, or deploys.

## Executive decision

The most disruptive regression is **unscoped Game Review keyboard handling without `preventDefault`**. A second group of issues stems from **two different positions being displayed as if they were one** when the user explores a variation: the board uses the variation FEN while the move list, graph, share link and other reports continue referring to the mainline. The board itself can execute legal moves, including promotion, castling, and en passant, and that part has strong existing automated coverage. The interaction and signaling around those capabilities are not yet mature.

**Proof / methodology:** On a disposable copy of the existing QA fixture (`/tmp/patzer-audit-ui-isolated.db`), I launched the forked server on **127.0.0.1:8892**, signed in as QA fixture user `qaadmin`, and used one Playwright Chromium session at **1704×857**, dark scheme, `/review/1?ply=3`. Arrows moved the position **3/8 → 4/8 → 3/8** but corresponding `keydown` events reported `defaultPrevented:false`, target `BODY`. The isolated app remained free of JS exceptions and the original live service was untouched. This does **not** prove the specific OS text caret in the owner's screenshot occurs in every browser configuration; it proves browser-native arrow behavior is not suppressed. The pre-existing full browser QA reported 27/27 green with special-move and saved-PGN isolation tests; those tests don't cover all scenarios below.

P0 = potentially unsafe/data-loss blocker, P1 = high-impact functional/interaction issue, P2 = polish/consistency. **No independently confirmed P0** was found.

## Ranked findings

| ID | Severity | Confidence | Area | Finding |
| --- | --- | --- | --- | --- |
| C01 | **P1** | Browser verified | Keyboard | Review uses global Arrow/Home/End shortcuts without `preventDefault` or a scope policy |
| C02 | **P1** | Source verified | Review focus | Shortcuts fire while buttons, dialogs, contenteditable and unrelated controls are focused |
| C03 | **P1** | Source verified | Variation context | Board, graph, mainline move list, report and share URL disagree about the selected position |
| C04 | **P1** | Source verified | Engine feedback | Unknown/unfinished variation evaluation is shown as exact `0.00` equality |
| C05 | **P1** | Source verified | Analysis errors | Full-game Stockfish analysis has no catch-visible feedback or recovery guidance |
| C06 | **P1** | Source verified | Audio | Replaying the next saved move by moving a piece causes duplicate sounds |
| C07 | **P1** | Source verified | Performance / UX | Separate variation, lines and threat searches compete for one user engine slot |
| C08 | **P1** | Source verified | Move transport | Buttons are active at impossible boundaries; rapid moves trigger repeated smooth scrolling |
| C09 | P2 | Source verified | Engine lines | Non-playable suggested lines are `<button>` elements that do nothing |
| C10 | P2 | Source verified | Deep links | `?ply` initializes state but later external URL changes are not replayed into controller state |
| C11 | P2 | Source verified | Report clicks | `scrollIntoView` on the tabs card can move the outer page despite an independently scrolling rail |
| C12 | P2 | Source verified | Evaluation graph | Pointer-only SVG, no keyboard/accessible current evaluation; start position marked as move 1 |
| C13 | P2 | Source verified | Notes | Save-on-blur has no visible failure state or safe retry and may lose failed edits |
| C14 | P2 | Source verified | Promotion picker | Absolute overlay is visually positioned but not a focus-managed dialog |
| C15 | P2 | Source verified | Move classification | Selected filters lower unrelated move opacity to 35%, impairing readability |
| C16 | P2 | Source verified | Commands | Global `g,s` navigation and Review `s` share are competing shortcuts |
| C17 | P2 | Source verified | Review animation | No explicit reduced-motion accommodation for programmatic move-list scrolling |
| C18 | Future | Product proposal | Variation power | Persist/share named variations, compare lines and train from a mistake |

### C01 — Global movement shortcuts allow native browser action (P1, reproduced)

**Evidence:** `web/src/pages/GameAnalyzer.tsx:239-258`: `window.addEventListener('keydown', onKey)` changes state for ArrowLeft, ArrowRight, Home and End but never calls `e.preventDefault()`. Chromium experiment: ArrowRight and ArrowLeft changed position as expected, and both event records retained `prevented:false`. **Impact:** browser scrolling, text caret/selection (when caret browsing is enabled), Home/End document navigation, and app navigation may coexist. This directly matches the owner's reported unintended caret. **Fix:** use a review-scoped keyboard controller with a deliberate focus policy; when a supported shortcut is consumed, call `preventDefault()` *before* changing state. Ignore Ctrl/Meta/Alt, auto-repeat as appropriate, editable targets, and any modal/dialog/command palette. Retain accessible key handling on explicitly focused move list and transport. **Test:** at 1704×857, 1366×768 and mobile keyboard, hold each direction, test first/last/Home/End, caret-browsing on/off, focus inside/outside Review and a dialog, confirm no document scroll or native selection.

### C02 — Keyboard shortcuts disregard interactive focus (P1)

**Evidence:** `GameAnalyzer.tsx:240-254` only skips `INPUT`, `TEXTAREA`, `SELECT`; it processes key events from `contenteditable`, buttons, links, command-palette dialogs, custom menuitems and sliders implemented with other roles. `web/src/App.tsx:83-123` owns separate global shortcuts and does test `isContentEditable`, but has no shared modal priority policy. **Impact:** pressing Home/End in an open overlay or ArrowLeft/Right on a focused control changes the chess position behind the UI, and `f` flips the board while typing into custom editors. **Fix:** central shortcut registry/priority: modal > editor > scoped board > global navigation; disable outside focused workspace or use explicit activation. **Test:** run a focus matrix for body, move buttons, graph, custom `role=textbox`, changelog, shortcuts modal, command palette, and game notes.

### C03 — Two selected positions: mainline versus exploratory variation (P1)

**Evidence:** `GameAnalyzer.tsx:155-171,280-282,303-320,495-534,605-611,616-642,662-680`. The board displays `variations.currentFen`. When `isVariation` is true, `ply` stays on `variations.originalPly` (the branch base). The `EvalGraph current={ply}`, `MoveList current={ply}`, `GameReportPanel onMomentJump={setPly}`, and share link derived only from `window.location.href` describe the original line, not the currently displayed continuation. MoveExplanation hides, which is correct, but no comprehensive distinction is shown. `ExportRow` copies the actual variation FEN, so a user may see **one position on the board and another in the graph/list or shared URL**. **Fix:** define a discriminated `DisplayedPosition` (`mainline` vs `variation`) containing FEN, branch/cursor, move metadata, evaluation availability and shareability. Explicitly mark the graph/list as “main game” or pause their selection until returning; offer shared FEN/variation URL or label link “share original game position”. **Test:** branch after ply 3, play 3 legal moves, click graph/list, share/reload, return to mainline; confirm every indicator and URL states which line is active.

### C04 — Unknown evaluation is represented as equality (P1)

**Evidence:** `GameAnalyzer.tsx:317` sets `const currentEvalCp = variationQuality?.eval_after_cp ?? move?.eval_after_cp ?? 0`, and `fmtCp(0) => '0.00'` at `:53-59`. Since `move` is undefined in a branch (`:295`), unscored new variations produce `0.00` and a centered evaluation bar, regardless of the position. The `.catch` displays “Move not scored” but still leaves `0.00`. **Fix:** use `number | null`; display `—` or “Analyzing” until a valid, FEN-matched score arrives; show explicit “Unavailable” on engine error, never assume a draw. Ensure EvalBar can display an unscored state. **Test:** slow/failed/429 scoring, rapid variation switching; no fabricated zero and no stale cp from previous branch.

### C05 — Game analysis has no user-visible error boundary (P1)

**Evidence:** `GameAnalyzer.tsx:260-269`, `analyze` uses `try/finally` with no `catch`; `:111-115` invokes `void analyze(16,true)` for stale analysis. A network error or server 429 propagates an unhandled rejected Promise from both button handlers and the fire-and-forget effect; `analyzing` simply resets, giving little explanation. **Fix:** explicit error state per request; display diagnostic text and Retry; distinguish already-running, engine unavailable, timeout and unauthorized. Avoid automatic repeated full reanalysis when stale and failed; expose progress/cancel where feasible. **Test:** mock 429, 500, loss of connection, stale analysis and successful retry; assert no unhandled rejection.

### C06 — Duplicate move sound on a saved-game replay (P1)

**Evidence:** `GameAnalyzer.tsx:210-213` plays `soundForMove` after `variations.submitMove(uci)` returns true. When the move matches the saved next move, `analysisVariations.ts:186-195` advances `originalPly`. The separate ply-change effect in `GameAnalyzer.tsx:229-237` then **plays the same sound again**. **Fix:** one audio dispatcher that observes a canonical completed move with source `manual-board`/`transport`/`variation`, rather than both event callback and ply effect. **Test:** mock sound sink and move a piece matching the PGN continuation; expect exactly one cue, and one per variation move, undo/redo policy explicit.

### C07 — Engine calls compete and can queue behind each other (P1)

**Evidence:** `server/src/routes/analyze.ts:148-170,224-235` shares `positionInflight` per user for `/position` and `/variation-move`. `GameAnalyzer.tsx:176-207` automatically scores each played branch move (with a delayed retry on 429); `:282-293` separately requests top lines; `ThreatPanel.tsx:90-116` requests a null-move position and retries up to 4 times. Three panels can race and display short-lived “busy/unavailable” while calculations from previous positions continue server-side even when UI cancels only its promise handler. **Fix:** frontend request coordinator keyed by FEN + analysis type, with dedupe, cancellation/debounce, priority (user action > background threats), pending indicator and bounded retries; server queue/cancel support if justified. **Test:** rapid 20-ply navigation while all panels active, record rate of 429, request count, latency and no stale results. Current risk is source-proven contention, exact CPU cost needs profiling.

### C08 — Transport boundary and scroll smoothness (P1)

**Evidence:** `GameAnalyzer.tsx:459-470` renders first/previous/next/last buttons without `disabled` at endpoints. `MoveRow.tsx:24-41` uses `behavior:'smooth'` for every active move outside visible area; `GameAnalyzer.tsx:364-371` scrolls tabs on category click. **Impact:** dead buttons look active; held arrows can trigger scrolling animations that fight the user's visual tracking. **Fix:** disable inapplicable actions; use selected ply and variationCursor to derive exact capability state; instant scroll for rapid keyboard replay, smooth only for user-requested jump and when reduced-motion allows; avoid scroll chaining. **Test:** start/end/branch endpoint disabled semantics, fast hold in 100-ply game, reduced motion and scroll top unchanged.

### C09 — Engine PV rows promise actions they cannot perform (P2)

**Evidence:** `GameAnalyzer.tsx:874-899` maps every MultiPV line to a `<button>`; `onClick` does anything only if `isPlayed`. In a variation or when the PV isn't the saved next move, users can focus a button and click without any response. **Fix:** display non-interactive lines as rows or make clicking them create a legal ephemeral branch by applying `l.uci`; add a preview/“Try this” affordance and correct aria labels. **Test:** click best line while it differs from PGN; either it starts a variation or is not presented as a button.

### C10 — URL initialization does not track navigation after mount (P2)

**Evidence:** `GameAnalyzer.tsx:149-157` reads `?ply=` to initialize the reducer; `:221-227` only writes controller ply back using `replace:true`. `useAnalysisVariations.ts:53-64` resets on game identity, not URL query changes. **Impact:** navigating to a different `?ply` on the same mounted game via external router navigation or back/forward can get overwritten by the current state. **Fix:** treat route navigation as explicit input with loop guard, or use a query-key-aware navigation source; document branch URL rules. **Test:** navigate between `/review/1?ply=3` and `?ply=6` within the same component without unmounting; board and URL agree.

### C11 — Scrolling into a clipped rail can move the page (P2)

**Evidence:** `GameAnalyzer.tsx:364-372` calls `tabsRef.current?.scrollIntoView({ behavior:'smooth', block:'start' })` without specifying the nearest scroll container. The page has its own main, the rail is separately `overflow-y-auto` (`:474`), and the move list is another scroller (`MoveList.tsx:42-45`). **Fix:** scroll the rail using its ref and element offsets, avoid document-level jumps, and honor `prefers-reduced-motion`. **Test:** click mistake badge when right rail is scrolled, verify board/client window position does not move.

### C12 — Evaluation graph lacks equivalent input modes and start-position accuracy (P2)

**Evidence:** `EvalGraph.tsx:78-93` provides only SVG mousemove/click handlers, no role/tabIndex/keyboard interaction. `:125-127` uses `points[current-1] ?? points[0]`, so `current=0` visually highlights the first move, not the starting position. **Fix:** provide a labeled keyboard-operable scrubber or accessible slider/list alongside the graphic; explicit start-position tick/unknown evaluation. **Test:** arrow keys in focused graph change ply and announce move/eval; cursor 0 displays a start marker, not move-1 evaluation.

### C13 — Notes can fail silently on blur (P2)

**Evidence:** `GameAnalyzer.tsx:693-706,735-748` saves notes on blur by `saveNotes.mutate(draft)` with only `onSuccess`, and labels unsaved draft “Click outside to save.” **Impact:** network failures produce no accessible error, and users can navigate away assuming text persisted. **Fix:** visible Save/Cancel plus debounced autosave or on-blur commit with `onError`/retry and unsaved-change guard. **Test:** abort/reject PATCH, switch games, reload, verify draft preserved and acknowledged.

### C14 — Promotion dialog is a visual overlay only (P2)

**Evidence:** `ChessBoard.tsx:216-255` renders a full-board click-catching div and 4 piece buttons without a dialog/label/focus trap/Escape/cancel button. While the buttons have `aria-label`, keyboard users must discover them by Tab without focus moved there. **Fix:** focus picker on open, return to originating square on close, provide keyboard Escape and a labeled cancel, with `role=dialog` or appropriate board-specific menu semantics. **Test:** keyboard-only underpromotion and cancel at all four board orientations/endpoints.

### C15 — Filter removes too much information (P2)

**Evidence:** `MoveRow.tsx:65-81` sets `opacity-35` on unrelated non-current moves when a classification filter is active. **Impact:** users lose chess context; especially weak in dark mode. **Fix:** keep all SAN at readable contrast and lower chroma of non-selected rows, not whole row opacity. **Test:** contrast in dark/light, keyboard navigation while filter active.

### C16 — Duplicate app-level shortcut meanings (P2)

**Evidence:** `App.tsx:105-119` implements `g` prefix and `s` to navigate Settings; `GameAnalyzer.tsx:247-253` implements `s` share link regardless of whether it is part of a `g,s` chord. Two window listeners can handle the same key before unmount. **Fix:** central shortcuts manager with consumed markers; if `g` mode active, `s` must not also share; disable review shortcuts for modals and inputs. **Test:** `g,s` navigates Settings *only*, plain `s` shares *only* if workspace activated, no clipboard write during navigation.

### C17 — Smooth scrolling ignores reduced-motion preference (P2)

**Evidence:** `MoveRow.tsx:39-40` and `GameAnalyzer.tsx:370` always choose smooth scrolling; CSS `index.css:261-269` only disables visual animations, not JS scroll calls. **Fix:** `matchMedia('(prefers-reduced-motion:reduce)')` and immediate scroll when true. **Test:** emulate reduced-motion then select a far move.

## Existing strengths not to regress

- Legal UCI and promotion validation lives in `analysisVariations.ts:149-173`; branch creation/replay/undo and parent-prefix handling are pure state transitions with dedicated tests.
- `ChessBoard.tsx:75-99` prevents duplicate optimistic analysis submissions and handles promotion; `:49-73,133-146` uses ResizeObserver for board hitbox resynchronization.
- `server/src/routes/analyze.ts` rejects unauthenticated/busy scoring and doesn't persist hypothetical variation moves.
- Existing independent browser suite covers real Stockfish scoring, special moves, mobile touch, database PGN immutability and baseline keyboard position changes. **Passing suite ≠ polished keyboard behavior**.

## Top ten fixes and acceptance order

1. **C01 + C02 + C16:** Define shortcut scope and priority; `preventDefault` only on consumed keys. Test caret/selection and no scroll.
2. **C03:** Establish a coherent displayed-position model across board, graph, list, tools and share URL.
3. **C04:** Eliminate fabricated `0.00` before an engine score arrives; convey waiting/error explicitly.
4. **C05:** Add full game-analysis error/loading/retry UI and prevent silent Promise rejections.
5. **C06:** Deduplicate move audio; add test around saved-move click through board.
6. **C08 + C11 + C17:** Disable transport endpoints, eliminate unwanted scroll chaining/animations and respect reduced motion.
7. **C07:** Coordinate background engine requests and make pending/busy state predictable.
8. **C09:** Enable "Try engine line" as a safe ephemeral variation or demote inert buttons to display-only rows.
9. **C12 + C14:** Add keyboard parity for graph scrubbing and promotion picker.
10. **C13 + C15 + C10:** Fix notes reliability, filtered-move legibility and deep-link synchronization.

### Suggested regression matrix

- 1920×1080 / 1704×857 / 1366×768 / 768×1024 / 390×844, light/dark, reduced-motion on/off.
- Mouse, keyboard-only, touchscreen and screen-reader workflows; focus in main board, toolbar, move list, notes, graph and dialogs.
- Game start, middle, last ply, deep link, 120-ply PGN, games from arbitrary FEN, selected result and three-level branch.
- Saved vs hypothetical move equality, queen and underpromotion, checkmate, en passant, castling, and Stockfish response 200/429/500/timeout.
- Explicit browser assertion: keyboard command consumed ⇒ `event.defaultPrevented === true`; no document scroll, selected text or caret artifact.

## Limits and nonfindings

- The gray horizontal bar from the owner's screenshot was **not reproduced** in the isolated Chromium sample. At that viewport, `document.querySelectorAll('input[type=range]').length === 0` and the board's computed `overflow-x/y` was `hidden`. Therefore **do not claim** it is the depth range input, a Chessground scrollbar, or browser overlay without inspecting the affected session's DOM and computed styles.
- No claim is made that sound plays twice perceptually on the owner's audio device; the two independent call sites are source-confirmed and require instrumented playback test.
- No source files were edited, no user secrets were read, no live data was modified.
