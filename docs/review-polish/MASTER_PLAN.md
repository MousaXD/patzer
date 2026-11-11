# Patzer Game Review — Product Quality Plan

## Scope and safety

- Baseline: `origin/main` at `738dd75`, fetched 11 November 2026.
- Workstream: `feat/review-polish-product-excellence-20261111`, isolated worktree.
- Improve the real Game Review interface without changing engine scoring, source revisions, report cache integrity, game PGNs or production services.
- Browser evidence uses synthetic chess game + analysis presentation fixtures and a disposable SQLite database. Synthetic move quality and score values **must not** be interpreted as engine certification.
- Chess.com is a product-quality benchmark, not a design source to clone.

## Evaluation method

Each candidate is ranked by user impact, defect severity, diagnosis confidence, implementation risk, expected benefit and verification coverage. No issue is considered fixed solely because the CSS appears plausible: capture real Chromium screenshots in light/dark at 1920×1080, 1728×900, 1440×900, 1366×768, 1024×768 and 390×844, and review the resulting geometry.

## Backlog

| Priority | User-visible issue and evidence | Impact / severity | Confidence | Risk | Expected benefit and verification | State |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | At 1024×768 the baseline 728px board filled the initial viewport, and the analysis rail began at y=1118px. At desktop/laptop sizes transport was below the viewport (e.g. y=1030px at 1440×900). | High / high | High: actual Chromium bounding boxes and screenshots | Low-medium: workspace CSS only | Put timeline beside board when space permits and ensure move controls fit vertically; 12 viewport/theme checks | Completed |
| P1 | Inactive variations panel occupied substantial space at the top of every Game Review rail, including a disabled **Return to game** button. | Medium / medium | High: DOM and captured screenshots | Low: presentation-only conditions | Compact a first-use hint; preserve branch controls and return flow when needed; screenshot check | Completed |
| P1 | The 1024px review tab labels wrapped onto multiple lines in a narrow right rail. | Medium / medium | High: actual 1024px screenshot | Low: spacing and white-space changes only | Restore one-line tab labels without hiding accessible names; browser screenshot check | Completed |
| P1 | Board dominates the mobile first view; move explanation begins below the evaluation graph and interactive-analysis hint, requiring manual traversal back and forth. | Medium / medium | High: reproduced in actual 390×844 Chromium screenshots | Low: additive, responsive-only navigation | Add visible two-way board/details jump with explicit keyboard focus, scroll positioning and reduced-motion handling; verify PGN unchanged | Completed |
| P1 | Small guidance labels and move explanation metadata are hard to read on the dark theme, especially the blue-arrow hint and inactive variation guidance. | Medium / medium | High: observed screenshots and low-contrast legacy `text-chesscom-500` styles | Low: foreground-only styles | Improve dark-mode contrast without changing light theme or layouts; browser light/dark inspection and text contrast checks | Completed |
| P1 | `MoveExplanation` substituted 0 cp for a null engine score, displayed a fabricated 50% win chance and interpolated it into a confident narrative. | High / high: undermines trust in coaching | High: source inspection and explicit regression fixture | Low-medium: explanation presentation only | Preserve real cp-derived probabilities, suppress unsupported comparisons, use localized evidence-gap copy; targeted unit and actual browser tests | Completed |
| P1 | Explanation header, move number and win-chance POV assumed White always starts the PGN. Black-first setup games were labeled as White's move and reversed the win-chance change. | High / high | High: independent shared FEN-aware helper already exists; reproduced with a Black-first fixture | Low: reuse FEN-aware display utility, no engine/scoring edits | Pass starting FEN, use FEN-aware mover and fullmove number; unit + real browser screenshot with Black-first FEN | Completed |
| P1 | In dark mode, move history's tiny row numbers had **3.02:1** contrast (under 4.5:1 AA for normal text), and the selected move was an almost-white tile (background luminance 0.817), competing with the coaching panel. | Medium / medium | High: Chromium screenshot and real computed-style contrast audit | Low: scoped foreground and selected-state colors | Raise row-number contrast above 4.5:1 and use a clear but subdued active tile; keep Light theme unchanged; real 390px screenshot, 12 viewport captures and browser contrast assertion | Completed |
| P1 | SVG classification markers in the evaluation graph were stretched into flat ovals due to `preserveAspectRatio="none"`: **4.4:1** marker aspect at desktop and **3.35–3.63:1** on mobile/tablet. | Medium / medium | High: 12 real-browser marker geometry measurements plus screenshot comparison | Low: fixed-pixel visual overlays, no eval changes | Render circular 1:1 markers, preserve score gaps and graph geometry, keep pointer/keyboard navigation usable and ensure PGN remains unchanged | Completed |
| P2 | Graph area fills can still read like a solid dark silhouette on real games. Marker circles were fixed separately; score-derived area shapes were deliberately left untouched. | Medium / medium | Medium: synthetic fixture exaggerates movement | Medium/high: score semantics | Validate with real bounded Stockfish evaluations and review area legibility and screen-reader value labels before any change; do not invent or smooth missing data | Needs investigation |
| P2 | Review has several lower rail utilities (engine lines, report, threats, explorer, notes, exports). Their ordering and discovery require task observation beyond static screenshot. | Medium / medium | Medium | Medium | Check user journeys: identify mistakes, switch tabs, test variation, return, export; reduce redundant surfaces only when verified | Open |
| P2 | Long games and narrow-viewport selection/focus behavior. Reproduced a 20px outer-page drift on Home/End navigation through a 160-ply game while the move row itself remained visible; Chrome anchored to dynamic content in the analysis rail. | Medium / low | High: real Chromium 390×844 reproducible comparison | Low: scoped CSS on stacked layouts only | Prevent anchor jumps without changing selected row tracking; assert list scrolls to current move, outer page delta ≤5px, and original PGN remains unchanged. Desktop/layout capture gate | Completed (browser + regression) |

## Quality gates

1. Reproduce an issue on source baseline with captured screenshots/geometry.
2. Apply smallest coherent fix on this feature branch.
3. Run `npm run typecheck`, `npm test`, `npm run build` at milestone.
4. Capture all 12 theme/viewport combinations with `scripts/review-polish-capture.mjs` (isolated local server and database).
5. Review the before/after screenshots, including mobile, and check browser runtime errors + horizontal overflow. For landscape ≥960px assert board and rail coexist and move transport remains in the viewport.
6. Commit and push only to this branch. Never merge/deploy without explicit owner authorization.

## Capture command

```bash
npm run build
PATZER_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
PATZER_POLISH_OUTPUT=qa-artifacts/review-polish/final \
node scripts/review-polish-capture.mjs
```

If the repository provides resolvable `playwright`, omit `PATZER_PLAYWRIGHT_MODULE`. Screen captures and JSON metrics are intentionally local QA artifacts, not bundled into the app. The source script is tracked so future runs remain reproducible.
