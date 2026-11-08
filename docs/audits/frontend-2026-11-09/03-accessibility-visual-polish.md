# Patzer — Accessibility & Visual Polish Audit
**Date:** 2026-11-09
**Baseline:** c3ed65b
**Repository:** /home/mousa/projects/my-creations/chess/patzer-overhaul-integration
**Role:** Principal Product Designer & Frontend Accessibility Auditor

## Audit approach and confidence
Reviewed React/TSX source and CSS covering Home, Play, Game Review, Insights, Training, Learning, Settings, Admin, the common shell, navigation, modal and UI primitives. Inspected `/tmp/patzer-overhaul-final-qa/results.json` and screenshot filenames/dimensions (light/dark at widths 390/768/1366/1440/1920). That historical QA JSON reports PASS for responsive screenshots, accessible labels/focus and keyboard navigation; those assertions do **not** establish that default browser interactions are suppressed or WCAG requirements fully met. No live browser, screen-reader, axe scan or direct visual comparison was performed here. Issues are source-confirmed unless noted as needing visual reproduction.

Priorities: P0 = critical blocker, P1 = high-impact usability/accessibility, P2 = polish/consistency.

## P0
No independently verified P0 issue. Do not promote unverified screenshot impressions to blocking severity.

## P1 — high-impact findings

### A01 — Global Review move shortcuts do not suppress browser actions
**Evidence:** `web/src/pages/GameAnalyzer.tsx:239-258`. Window keydown changes ply for ArrowLeft/Right, Home/End, but never calls `preventDefault()`. It ignores INPUT/TEXTAREA/SELECT but not contenteditable, modifiers or dialogs.
**Impact:** Browser caret, text selection, scrolling and shortcuts may occur simultaneously with ply navigation; matches owner's reported symptom.
**Correction:** Scope to focused review workspace; ignore contenteditable, dialog/modal focus and modified shortcuts; prevent default only for consumed keys. Document shortcut priority and make behavior consistent in Play/Review.
**Verify:** Repeated arrows/Home/End on board, move list, control buttons and whitespace; check no selection/caret/scroll. Repeat while inputs, range control, modal and contenteditable are focused.

### A02 — Review board constrained by viewport math despite ample width
**Evidence:** `GameAnalyzer.tsx:392-414,474` caps board at `lg:max-w-[calc(100vh-24rem)]`, board column 760px, rail 380px; shell itself is full width (`components/Layout.tsx:315-324`). Play uses different `calc(100vh-26rem)` (`pages/Play.tsx:995-1003`).
**Impact:** At 1920×1080 board limit is ~696px; at 1366×768 ~384px. Left/right workspace balance and board prominence deteriorate independently of horizontal room.
**Correction:** Shared responsive chess-workspace grid with board dimension derived from measured available container, appropriate min/max, optional compact/fit-height mode, flexible rail or splitter.
**Verify:** Board bounding boxes and whitespace at 1366×768, 1440×900, 1920×1080 and ultrawide; both Play/Review; 200% zoom and mobile reflow.

### A03 — Evaluation graph is pointer-only
**Evidence:** `web/src/components/EvalGraph.tsx:77-97` SVG mouse-move/click handlers lack focus, role, accessible value and keyboard controls.
**Impact:** Keyboard and screen-reader users cannot access graph scrubbing and evaluation-by-move.
**Correction:** Implement a labeled keyboard-operable timeline (slider/listbox semantics) with ply/evaluation readout or an equivalently rich accessible alternative tied to move list.
**Verify:** Keyboard-only game scrubbing, accessible move/eval announcements, touch accuracy on a 100-move game.

### A04 — Review tabs are buttons without tab semantics
**Evidence:** `GameAnalyzer.tsx:573-607,779-792`: custom `TabBtn` exposes label but no tablist/selected/panel relationships or tab-arrow handling, despite shared `Tabs` primitive in `components/ui/index.tsx:99+`.
**Impact:** Screen readers don't announce active tab; visual active state is only a gold underline; navigation is inconsistent.
**Correction:** Adopt shared `Tabs` and ensure global Review hotkeys yield to tab keyboard events.
**Verify:** NVDA/VoiceOver selected tab announcement, Arrow/Home/End switching, proper panel focus.

### A05 — Admin new-user modal is inaccessible as a modal; most fields unlabeled
**Evidence:** `web/src/pages/admin/Users.tsx:154-200`: fixed div, no dialog semantics/focus trap, unlabeled X, placeholder-only inputs, unlabeled selects.
**Impact:** Focus escapes behind overlay; missing accessible input names; placeholders vanish after typing.
**Correction:** Replace with shared `Dialog` and `Field`, persistent label/input associations, alert-linked validation and focus restoration.
**Verify:** Keyboard-only open/edit/submit/cancel/Escape; screen-reader names for all inputs and select controls; tab cycling stays in modal.

### A06 — Changelog overlay is non-modal and allows shortcut collision
**Evidence:** `components/ChangelogModal.tsx:20-41` fixed div overlay without dialog role, Escape trap or focus restoration; global review hotkeys remain active (`GameAnalyzer.tsx:239-258`).
**Impact:** Focus leakage, game moves behind modal, poor keyboard access.
**Correction:** Reuse native `Dialog`, suspend workspace shortcuts while modal is active, label close control.
**Verify:** Open changelog from Review, Tab/Shift+Tab, Escape and Home/End; verify focus restoration and stable ply.

### A07 — Review boundary navigation remains apparently enabled
**Evidence:** `GameAnalyzer.tsx:460-466` first/previous/next/last have no disabled-state props; `Play.tsx:1046-1052` does disable unavailable navigation. `MoveRow.tsx:25-45` scrolls rows with smooth behavior, as does `GameAnalyzer.tsx:364-370`.
**Impact:** Dead actions lack feedback, inconsistent behavior across modes; repeated scrolling is distracting.
**Correction:** Disable at first/last ply and correct variation endpoints; show status, honor reduced motion in scripted scrolling.
**Verify:** First/last and branch boundaries, rapid keyboard repeat, reduce-motion on/off.

### A08 — Engine-depth range lacks accessible name
**Evidence:** `GameAnalyzer.tsx:542-555`: visual label lacks htmlFor, range input lacks ID/aria-label.
**Impact:** An unlabeled numerical slider for screen-reader users.
**Correction:** Associate label and help text with range, consider descriptive `aria-valuetext`.
**Verify:** Hear “Analysis depth slider, 8–22, current n” with NVDA/VoiceOver.

### A09 — Important Admin System settings have labels not attached to controls
**Evidence:** `pages/admin/System.tsx:275-356,398-402,454-522`: many label elements next to provider URL, key, model, Stockfish path and SMTP fields lack htmlFor/ID connections.
**Impact:** Screen-reader navigation in high-stakes configuration is confusing.
**Correction:** Convert to `Field` with IDs, grouped fieldsets, helper/error relationships.
**Verify:** Automated accessible-name audit plus keyboard/screen-reader review of each Admin section.

## P2 — perceived quality and cross-product coherence

### A10 — Unwanted GitHub star promotion in persistent footer and changelog
**Evidence:** `components/Layout.tsx:328-343` renders `GitHubStar`; `components/ChangelogModal.tsx:35-40` repeats CTA.
**Impact:** Occupies board-height budget, looks promotional rather than product-focused; owner explicitly wants footer promotion removed.
**Correction:** Remove footer CTA; decide if changelog CTA also goes, while retaining unobtrusive About/version links.
**Verify:** All routes/themes, footer and changelog no longer show promotional star; version still findable.

### A11 — Oversized gray bar is NOT yet proven to be a range slider
**Evidence:** Range CSS `index.css:346-350` defines 26px input / 6px track / 18px thumb; review range is optional depth control `GameAnalyzer.tsx:548-553`. Meanwhile review has nested rail scrolling `GameAnalyzer.tsx:392,474`, move list `MoveList.tsx:39-45`, global scrollbars `index.css:351-352`. None alone explains an oversized bar **over** the board.
**Impact:** Guessing the element and hiding it can conceal clipping or break controls.
**Correction:** Reproduce screenshot viewport, inspect DOM element beneath bar, bounds, computed overflow and slider styles; fix root owner rather than hide an arbitrary scrollbar.
**Verify:** Before/after capture at exact viewport, DOM evidence of element, no bad overflow, preserved keyboard/touch scrolling.

### A12 — Inconsistent chess-workspace scale across Play and Review
**Evidence:** `Play.tsx:951-1003` max-width 7xl, 360px rail, viewport cap `26rem`; `GameAnalyzer.tsx:392-474` full width, 380px rail, `24rem` cap.
**Impact:** Switching between closely related tasks changes layout density and board size.
**Correction:** Share board/rail sizing and player-header/transport tokens; make differences explicitly task-driven.
**Verify:** Identical viewport contact sheet, matching board visual priority, no overflow.

### A13 — Small metadata type, low-opacity filtered moves
**Evidence:** `Insights.tsx:149,169,217,352,533,565+`, `Learn.tsx:192-204,264,358`, `MoveList.tsx:43,83` use 10–11px text; `MoveRow.tsx:65-81` uses `opacity-35` for dimmed moves.
**Impact:** Poor legibility and risk of insufficient contrast in dense screens.
**Correction:** 12–13px metadata floor, 14px interactive labels, adjust subdued token contrast; preserve essential move legibility rather than 35% opacity.
**Verify:** WCAG 2.2 AA measured contrast in both themes, low-vision/200% zoom, 390px reflow.

### A14 — Two design-component systems coexist
**Evidence:** `index.css:366-460` has `.ui-*` component classes and legacy `.btn-*`, `.card`, `.input`; `components/ui/index.tsx` has accessible Dialog/Tabs but `GameAnalyzer.tsx` and `admin/Users.tsx` bypass them; Admin MCP wizard (`admin/McpConnection.tsx:75-170`) uses amber/ink instead of Review chesscom/gold palette.
**Impact:** Inconsistent states, spacing, radii and modality; the app feels assembled from generations of screens.
**Correction:** One set of semantic color, spacing, type, radii, elevation and motion tokens; migrate to shared button, field, tabs, dialog and feedback primitives.
**Verify:** Storybook-style inventory and same interaction QA across all eight product areas.

### A15 — Missing feedback or announcements for clipboard/import
**Evidence:** `GameAnalyzer.tsx:805-811` silently swallows clipboard rejection; `admin/McpConnection.tsx:160` writes to clipboard without feedback; `Review.tsx:34-46,100-109` import messages auto-disappear without status/alert role.
**Impact:** Users cannot confidently tell whether an action succeeded, especially with assistive tech.
**Correction:** Consistent pending/success/error status with accessible live regions and retry, avoid ephemeral-only failure feedback.
**Verify:** Clipboard permission denial, failed import, screen reader announcements and keyboard retry.

### A16 — Classification and active states depend on small color cues
**Evidence:** `EvalGraph.tsx:105-135` tiny colored markers, `MoveRow.tsx:63-85` colored badges/opacity, `GameAnalyzer.tsx:779-792` tab gold underline.
**Impact:** Important information may be lost to color-vision deficiency, low resolution or high contrast settings.
**Correction:** Pair color with shape/text and selected indication; high-contrast styles and accessible evaluation/classification descriptions.
**Verify:** Grayscale/color-vision simulation, forced-colors mode, screen reader, measured contrast.

### A17 — Variable page width systems need intentional archetypes
**Evidence:** `Review.tsx:68` max-w-5xl, `Learn.tsx:143` max-w-6xl, `admin/System.tsx:245` max-w-3xl, `admin/McpConnection.tsx:75` max-w-4xl, shell default max-w-1440 (`Layout.tsx:322`), detailed Review full-width.
**Impact:** Editorial screens can be appropriately narrow, but sudden widths/density between similar dashboard screens are visually inconsistent.
**Correction:** Define editorial, dashboard, settings and chess workspace page archetypes with matching gutters, titles and card rhythm.
**Verify:** Cross-route screenshots at 1440/1920, check deliberate widths rather than accidental empty space.

## High-impact design improvements
1. Create a **unified analysis cockpit**: board-dominant measured grid, resizable right rail, compact player rows and consistent move transport.
2. Build **responsive layout choreography**: desktop adjustable split; tablet board + lower panel; mobile board + sticky transport and distinct information tabs. Avoid nested scroll islands wherever possible.
3. Establish **interaction grammar**: shared focus-visible states, at least 44px touch targets when feasible, labels/tooltips for icons, real selected/disabled/busy states, shortcut conflict policy.
4. Reduce **decorative chrome and visual noise**: keep position, evaluation, explanation and next action at the top; consolidate repetitive cards and promotional footer.
5. Ship a **single semantic visual language** for all pages: scale, color roles, spacing, border/elevation, loading/error/empty states; make chessboard exceptions explicit.
6. Create a **quality gate** covering keyboard, real screen reader, contrast, 200%/400% zoom, reduced motion, touch, light/dark, and screenshot regression.

## Whole-product coherence verdict
Patzer already has shared fonts, shell, CSS primitives and chess-oriented visuals; it is not wholly disconnected. But Home's dashboard, Play's game shell, Review's cockpit, Insights' dense analytics, Training/Learning educational cards, Settings forms and Admin wizard have mismatched density and control conventions. The biggest improvement comes from consolidating these contracts, not layering on more decoration. Findings above name confirmed code evidence; screens not personally exercised remain candidates for further testing rather than declared broken.

## Design-quality acceptance checklist
- [ ] Footer GitHub star removed; changelog CTA decision explicit; version/About still accessible.
- [ ] Gray bar reproduced, DOM owner documented, fixed without hiding needed scrolling.
- [ ] No caret/selection/unintended scroll from arrows/Home/End; shortcuts respect editables, dialogs and modifiers.
- [ ] Eval graph and tabs fully keyboard-operable and screen-reader announced.
- [ ] All modals have name, focus trap/return, Escape and labeled close control.
- [ ] All inputs/selects/ranges have persistent visible and programmatic labels.
- [ ] Correct disabled transport boundary state; distinguish active ply non-visually.
- [ ] Board and rail use space well at 1366×768, 1440×900, 1920×1080, 2560×1440.
- [ ] 390px mobile/768px tablet avoid clipping and accidental horizontal overflow.
- [ ] Reduced motion, zoom/reflow, focus indication, target size and status feedback verified.
- [ ] Text/UI colors meet WCAG AA targets in both modes; important meaning not solely color-coded.
- [ ] Shared components used across Home, Play, Review, Insights, Train, Learn, Settings and Admin.
- [ ] Contrast/axe, keyboard, screen reader and visual regression evidence attached after implementation.

**Restrictions honored:** Audit only. No application code, database, credentials, unrelated services, git commits or pushes changed.

---

## Independent owner-validation addendum (2026-11-09)

The report above was already present in the audit directory when I took over the failed agents. I **preserved its findings rather than replacing it** and independently inspected the relevant code and an isolated Chromium session. These additions refine its confidence and repair priority.

### V01 — Reproduced keyboard default-action leakage (confirmed P1)

At `1704×857`, dark scheme, `/review/1?ply=3` on an isolated QA database/server (`127.0.0.1:8892`), ArrowRight took the counter from **3/8 to 4/8**, then ArrowLeft returned to **3/8**. The two DOM events emitted:

```
{key:'ArrowRight', defaultPrevented:false, target:'BODY'}
{key:'ArrowLeft',  defaultPrevented:false, target:'BODY'}
```

This corroborates A01's missing `preventDefault()` at `GameAnalyzer.tsx:239-258`. It does **not** prove a blinking caret appears in every environment: Chromium without caret-browsing produced no persistent selection in this run. The owner's caret complaint is consistent with default handling and should be tested in the exact browser settings after the fix.

### V02 — Measured layout under-utilization (confirmed P1)

At the same viewport, browser geometry:

| Element | Measured size/position |
| --- | --- |
| Window | 1704 × 857 |
| Navigation sidebar | x=0, w=80 |
| Main content region | x=80, w=1624 |
| Analysis workspace | x=100, w=1584 |
| Board column | x=100, w=760 |
| Actual `cg-board` | x=257, y=172, **472 × 472** |
| Analysis right rail | x=880, w=380, h=681 |
| Right rail scroll content | scrollHeight=1530, clientHeight=681 |
| Unused width beyond both primary columns | **approximately 424px** |

The board is capped by `lg:max-w-[calc(100vh-24rem)]` (`GameAnalyzer.tsx:413`), so it shrinks well below available horizontal space and is centered within a much wider board column. The outer workspace itself has enough width; this is not a shell max-width problem. This directly validates A02. The chess workspace should be rebalanced, but not by simply removing the board's height cap (which can introduce clipping on short screens). Test the full viewport/scroll geometry after any layout change.

### V03 — Gray bar owner remains unidentified (not reproduced)

In the isolated browser at 1704×857, no `input[type=range]` was present in the Game Review DOM, and `cg-board` had `overflowX: hidden`, `overflowY: hidden`, `clientWidth=scrollWidth=472`, `clientHeight=scrollHeight=472`. A `document.elementsFromPoint` stack near the board's bottom-right returned `cg-board`, `cg-container`, `cg-wrap` and board wrapper — no range slider or scrollable overlay. Therefore **the huge gray bar in the owner's screenshot cannot responsibly be assigned to the depth-control range or Chessground from this evidence**. Before implementation, reproduce the original green-theme board on the owner's viewport, examine the exact element under the bar with DevTools, and check browser extensions/overlay scrollbars/caret mode as well as DOM. Do not globally hide scrollbars as a shortcut.

### V04 — Additional source-confirmed polish issues

- `GameAnalyzer.tsx:459-470`: boundary transport buttons lack disabled states. Marked A07; repair along with keyboard handling rather than separately.
- `GameAnalyzer.tsx:874-899`: non-playable engine PV rows are styled as buttons but do nothing. Affordance/accessibility mismatch; either support an actual branch action or demote to non-interactive rows.
- `GameAnalyzer.tsx:317` uses `?? 0` for unknown branch evaluation, then prints `0.00`; that is a misleading data label, **not merely a contrast issue**. Fix as a P1 product-trust requirement.
- `Layout.tsx:328-343` confirms the persistent footer star CTA is unconditional when shell is rendered. Removing the footer entirely (or restricting version/about to Settings) also returns vertical space to the board.
- `MoveRow.tsx:24-41` uses smooth scrolling for every move jump, including rapid keyboard holds, without an explicit reduced-motion check; see A07 and detailed chess report.

### Recommended polish sequence after audits converge

1. Remove footer star/chrome, then fix scoped keyboard navigation, focus, range input and modal semantics.
2. Replace ad-hoc board/rail sizing with a measured responsive workspace and inspect actual overlay/scroll ownership.
3. Improve variation/mainline state labels and eliminate misleading zero evaluation.
4. Consolidate tabs, dialogs, fields, touch-target sizes and feedback into existing shared primitives.
5. Run axe and screen-reader passes, contrast tests, reduced-motion checks and visual screenshot comparisons. Existing green QA covers functional paths but not this full design-quality threshold.

**Audit only.** I did not modify production source, live chess data or settings, and I did not claim a manual audio/screen-reader test that was not performed.
