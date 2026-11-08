# Patzer — Responsive layout and scrollbar audit (owner fallback)

**Date:** 2026-11-09. **Revision:** `c3ed65b`. **Auditor:** Repository owner/implementer as fallback because Agent 1's expected report was not present in the repository or other local worktrees. This is an audit record, not evidence that Agent 1 completed its independent audit.

## Evidence and method

- User's 1704-ish-pixel-wide screenshot of Game Review identifies a large empty area to the right, a gray bar across the board, and a tiny scrollbar at the bottom of the left navigation rail.
- Read `web/src/pages/GameAnalyzer.tsx`, `web/src/pages/Play.tsx`, `web/src/components/Layout.tsx`, `web/src/components/MoveList.tsx`, `web/src/components/MoveRow.tsx`, `web/src/index.css` and the 27-case Chromium test suite.
- Independently measured a disposable QA account/session on `127.0.0.1:8892` at 1704×857, dark theme, game `/review/1?ply=3`. Main content x=100..1684, width=1584; board column x=100 width=760; actual chessboard x=257 width=472; right rail x=880 width=380; right rail scrollHeight 1530, clientHeight 681; unused width beyond rail ~424. The outer shell correctly provides full width, but the child doesn't use it.
- `input[type=range]` count was **zero** in the isolated session, and the board had no overflow (`scrollWidth=clientWidth`, `scrollHeight=clientHeight`). The gray horizontal overlay **was not reproduced**, so its exact owner is still unknown.
- QA captures 5 viewport widths × 2 themes; the browser assertions check square board, no root horizontal overflow and an upper maximum board ratio, but not workspace utilization or text caret behavior (`qa/agent07/frontend-overhaul-smoke.mjs:243-255`). Existing green QA therefore doesn't refute these layout complaints.

## Findings

| ID | Priority | Confidence | Problem and location | Proposed remedy |
| --- | --- | --- | --- | --- |
| L01 | P1 | **Measured** | Game Review board `lg:max-w-[calc(100vh-24rem)]` causes 472px board in a 1584px workspace (`GameAnalyzer.tsx:397-414`) | Replace with responsive max board size and fitted desktop two-column layout; don't hard-clip to fold |
| L02 | P1 | **Measured** | Fixed right rail 380px plus left column cap 760px leaves 424px unused (`GameAnalyzer.tsx:392,397,474`) | Fit board + rail together and center the whole cockpit; allow rail to grow reasonably |
| L03 | P1 | Source | `lg:max-h-[calc(100vh-11rem)] lg:overflow-hidden` clips the entire workspace height and forces the rail into its own scroll (`GameAnalyzer.tsx:392,474`) | Prefer document vertical scrolling plus sticky board on tall reports; eliminate unneeded nested scroll islands |
| L04 | P1 | Source | Main shell's footer burns valuable fold height and shows unwanted GitHub star CTA (`Layout.tsx:328-343`) | Remove footer CTA / footer, move changelog access into navigation or Settings |
| L05 | P1 | Source | Sidebar `nav` has `overflow-y-auto` but no explicit `overflow-x-hidden` and full-width labels may overflow (`Layout.tsx:231,73-91`) | Force x-clip for narrow desktop navigation, inspect scrolling on non-English strings |
| L06 | P2 | Browser | Review board column is 760px while actual 472px board is horizontally centered 157px from column's edge (`GameAnalyzer.tsx:397,410-414`) | Constrain board-column to actual board width so headers, chart, controls align, or use intentional center grouping |
| L07 | P2 | Source | Review's viewport-height cap and Play's different `26rem` cap produce inconsistent chess page density (`Play.tsx:951-1003`) | Shared chess workspace size tokens with deliberate mode differences |
| L08 | P2 | Source | Move list maxHeight 420/460 and rail scrolling create a nested scroll surface (`MoveList.tsx:42-45`, `GameAnalyzer.tsx:605-612`) | One primary scroll surface per viewport, targeted nearest-scroller moving |
| L09 | P2 | Source | `MoveRow.tsx:24-41` uses smooth scroll on every move navigation | Instant navigation for repeated arrow keys, reduced-motion-aware for jumps |
| L10 | P2 | Source | `window.innerWidth < 768` is evaluated during render for move-list maxHeight (`GameAnalyzer.tsx:611`) and does not subscribe to resize | CSS media query or `useMediaQuery` hook; avoid reactive staleness |
| L11 | P2 | Source | Move transport on board is `h-10`/`h-12` with no disabled boundary state, no fixed bottom placement on phone (`GameAnalyzer.tsx:459-466`) | Disabled-aware sticky transport on touch layouts, explicit focus and safe-area padding |
| L12 | P2 | Source | Custom styles have both baseline WebKit scrollbars at `index.css:173-176` and later overrides at `:357-359`, leading to inconsistent theme treatment | One canonical scoped scrollbar system; keep scrollbars available for accessibility |
| L13 | P2 | Hypothesis | Gray bar on owner's board may be a browser/OS scroll indicator or an overlay from another element; **not reproduced** | Inspect `elementsFromPoint`, scroll containers and browser extensions in the actual session before attributing it |
| L14 | P2 | Source | No minimum board width ratio measured by QA (`qa/agent07/frontend-overhaul-smoke.mjs:250-253`) | Assert a useful minimum ratio at desktop viewports and a balanced two-column bounding box |
| L15 | P2 | Source | Global shell itself can scroll while rail/MoveList scroll independently (`Layout.tsx:319-325`, `GameAnalyzer.tsx:392,474`, `MoveList.tsx:42`) | Establish scroll ownership explicitly by breakpoint |

## Viewport-specific recommendation

- **Large desktop (>=1200px):** centered, balanced board and useful rail; board dimension from both viewport height *and* width. Avoid fixed 380px rail and gap after it. Let main page scroll as needed; keep board sticky only if it doesn't extend beyond viewport.
- **Desktop/laptop 1024–1199:** if two-column cannot fit a usable board plus rail, stack panels rather than shrinking to tiny boards.
- **Tablet 768–1023:** board above content or an adaptive side panel only if it exceeds practical board-width minimum. No horizontal overflow.
- **Mobile 390px:** 100%-available-width square board, eval strip no clipping, sticky move navigation within safe area, page scroll instead of nested scroll; test landscape and virtual keyboard.
- **Ultrawide 2560px+:** modest max-width to preserve reading length, centered rather than anchored left with a giant right gutter; optional user-controlled rail width later.

## Implementation and acceptance sequence

1. Remove persistent promotional footer, retain version/Changelog somewhere discoverable; verify no footer on Game Review.
2. Replace `GameAnalyzer` viewport hard cap and fixed rail width with a balanced, centered CSS grid/flex layout; measure at 1704×857 and 1366×768; ensure actual board width increases materially without clipping controls.
3. Eliminate outer `overflow-hidden` and independent rail scrolling unless an explicit short-height layout requires them; verify full report reachable on keyboard/touch.
4. Prevent default arrow behavior only within Review's keyboard workspace, so normal form and accessibility behavior remains.
5. Inspect the actual OS/browser DOM underlying the gray bar, not a guessed slider; remove root cause only when confirmed.
6. Add automated geometry assertions of board size, empty margin balance, root scrollWidth and no page-jump on keyboard actions; screenshots light/dark at multiple widths.

**Audit boundaries:** no modifications to source code, Git history, live database or service during this diagnostic. The conclusions marked "hypothesis" must not be described as reproduced defects.
