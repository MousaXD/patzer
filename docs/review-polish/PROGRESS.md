# Patzer Review Polish — Durable Progress

## Session: 11 November 2026

**Branch:** `feat/review-polish-product-excellence-20261111`

**Base:** `origin/main` at `738dd75`

**Worktree:** `/home/mousa/projects/my-creations/game/patzer-review-polish-20261111` (independent of production checkout)
**Previous validated implementation commit:** `fdddebb` (review cockpit and audit harness). The next commit includes mobile jump and contrast refinements.

**Mobile navigation/contrast commit:** `14ec726` (pushed). The current work adds the missing-evaluation presentation guard and regression evidence.

**Source truth commit:** `5ba9029` (pushed). This session also fixes Black-first FEN move labels and win-chance POV.

**Black-first FEN commit:** `c5779e5` (pushed). Current work addresses dark-mode move history readability.

**Dark move-history readability commit:** `3e07a3d` (pushed). Current work corrects the evaluation graph marker geometry.

## Completed changes

1. Reproduced and measured the original board-versus-controls conflict through real Chromium screenshot capture, both themes and all six target screen sizes.
2. Converted the ≥960px review workspace into a genuine two-column board/analysis cockpit (including 1024px). Board width now accounts for viewport height and leaves room for player bars and move transport.
3. Reduced default variation panel chrome into a compact hint; active variations retain the full branching UI and Return to game action.
4. Corrected review tab whitespace and spacing to prevent narrow desktop tab labels wrapping.
5. Added a self-contained isolated browser capture script with disposable SQLite, synthetic PGN/evaluations, assertion of board squareness, no horizontal overflow, correct theme, and visible desktop transport.
6. Added a compact mobile-only **Move details** jump from the board and a **Back to board** action above the Moves/AI report/Key moments tabs. Both scroll to the destination with a 64px sticky-header clearance and move keyboard focus. Respect reduced-motion preferences; no overlay obscures the board. New control labels exist in all five locale JSON files.
7. Removed irrelevant desktop-only keyboard shortcut instructions from narrow stacked layouts. Preserved them on landscape desktop layouts.
8. Corrected dark-theme foreground colors in the variation guidance, blue-arrow note, and move explanation metadata that were visibly dim against dark panels.
9. Fixed a real source-truth defect: `MoveExplanation.whiteWinPct` used to turn a missing cp into 0, implicitly claiming 50% odds. `moverWinPct` now refuses a comparison unless both positions have finite engine scores, hides numerical odds when unavailable, and displays a translated evidence-gap explanation. Independent prose for Book, Best, and Forced is retained. No scoring algorithm, classification or source revision changed.
10. Added 8 unit regression cases for numerical cp, missing and non-finite scores, and evidence-independent classifications; added a disposable real-React browser capture that removes a score from the cached fixture and verifies no odds appear in the rendered explanation.
11. Reused the existing `moveSideForPly`/`moveNumberForPly` helpers in `MoveExplanation`, preserving the actual mover, fullmove number and win-chance point-of-view for imported Black-first FEN games. Wired the already-available starting FEN through `GameAnalyzer` without altering the PGN or scoring. Added Black-first assertions and an isolated real browser screenshot; `12…e5` correctly appears as an opponent Black move with a Black-side 59% → 41% comparison in the synthetic fixture.
12. Detected a concrete dark-mode accessibility/polish problem in the real Chromium move list: row numbers at **3.018:1** contrast, and a selected-move tile of **0.817** relative background luminance (near-white). Lightened secondary label text only in dark mode, used a subdued dark selected tile with a gold inset ring, and aligned Starting position/phase labels with the same contrast system. Post-fix measured **4.844:1** row-number contrast and **0.064** relative luminance of the selected tile. The light version is unchanged. The real dark/light 390px review-detail screenshots were opened and inspected after the fix.
13. Diagnosed flat, oval evaluation markers in real Chromium captures. The responsive SVG stretches both axes independently; marker bounding boxes were **4.4:1** wide-to-tall on desktop and **3.35–3.63:1** on tablet/mobile. Rendered fixed-pixel classification, sampled-position and selected-position circles on a pointer-transparent overlay without touching evaluation curves, gaps or graph click positions. All 12 browser geometry checks now report **1.0:1**. Compared real 1440px before/after screenshots in light theme and inspected 1024px dark result. Browser navigation tests now click an actual marker and exercise keyboard Home/End, checking the saved PGN remains unchanged.

## Before/after visual evidence

All dimensions are actual Chromium `getBoundingClientRect` measurements, not CSS estimates. Captures are under ignored `qa-artifacts/review-polish/{baseline,after,final}`.

| Viewport | Baseline board | Revised board after initial responsive change | Baseline transport top | Revised transport top | Baseline sidebar top | Revised sidebar top |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1920×1080 | 848px | 704px | 1154px | 1004px | 124px | 124px |
| 1728×900 | 728px | 520px | 1030px | 824px | 124px | 124px |
| 1440×900 | 728px | 520px | 1030px | 824px | 124px | 124px |
| 1366×768 | 616px | 392px | 919px | 692px | 124px | 124px |
| 1024×768 | 728px | 392px | 1034px | 692px | 1118px | 124px |
| 390×844 | 336px | 336px | 636px | 636px | 728px | 728px |

The board resizing intentionally prioritizes simultaneous visibility of navigation controls and analysis over maximizing square size. The large drop at 1024px is a deliberate tradeoff that should continue to be assessed with actual end-user feedback.

## Validation

- `npm run build` on baseline: PASS.
- 12 baseline screenshots and measured bounding boxes: PASS, no horizontal overflow or browser page errors.
- `npm run typecheck` after initial changes: PASS.
- `npm test`: **102 files passed, 2 skipped; 916 tests passed, 12 skipped**. An initial invocation with unsupported Jest flag `--runInBand` failed as a CLI error; rerun with the supported Vitest command passed.
- After the initial responsive CSS change: 12 screenshots and geometry captures PASS, zero horizontal overflow.
- **Final implementation build + screenshots: PASS** across all 12 theme/viewport combinations. Independently viewed the 1440×900, 1024×768 and 390×844 Chromium screenshot results. On 1024×768 the tab labels now stay on a single line, the idle variation CTA is compact, and the move transport sits within the viewport.
- Browser interaction checks at 1024×768 in both light and dark themes: PASS. Right/Left keyboard arrows switch between Moves and AI report tabs; Next move advances the visible position and leaves the original PGN in SQLite unchanged.
- Mobile browser interaction checks at 390×844 light/dark: PASS. Two-way jump scrolls and focuses on the correct tab/board, keeps next-move keyboard navigation and does not alter saved PGN. The dark-theme run uses `prefers-reduced-motion: reduce`. Browser asserts minimum 4.5:1 contrast on board note and inactive-variation hint.
- After the source-truth guard: `npm run typecheck` PASS; targeted 34 tests PASS (8 newly added), full suite **924 PASS / 12 skipped**, production build PASS; 12 viewport/theme browser captures PASS and actual missing-score browser assertion PASS. Additional details screenshot is captured separately under `qa-artifacts/review-polish/source-evidence/missing-eval-details.png`.
- Black-first FEN follow-up: typecheck PASS, targeted 13 tests PASS including a new real-mover test, **full suite 925 passed / 12 skipped**, build PASS, all 12 layout captures PASS and Black-first real Chromium fixture PASS; screenshot `qa-artifacts/review-polish/black-first/black-first-details.png`.
- Dark move-list readability: a new browser assertion intentionally failed against the preceding implementation, recording a 3.018:1 row-number contrast. After correction: typecheck PASS, 7 targeted tests PASS, **full suite 925 passed / 12 skipped**, production build PASS, 12/12 layout captures PASS, and dark-mode browser assertion PASS. Before/after captures: `qa-artifacts/review-polish/dark-list-baseline/dark-390x844-details.png` and `qa-artifacts/review-polish/dark-list-after/dark-390x844-details.png`.
- Graph geometry refinement: typecheck PASS, 4 targeted tests PASS, **full suite 926 passed / 12 skipped**, build PASS, 12/12 geometry captures PASS with 1:1 marker aspect; marker click and keyboard Home/End regression PASS with PGN unchanged. Captures: `qa-artifacts/review-polish/graph-marker-before/` vs `graph-marker-final/`.
- Updated mobile implementation: typecheck PASS, 916 tests PASS (12 skipped), build PASS, screenshot capture 12/12 PASS. The final explanation-metadata color change was followed by another successful typecheck, production build, and all 12 browser screenshots; actual dark mobile board and details views were inspected.
- Screenshot fixtures are presentation-only: classifications/eval scores are synthetic and **do not** certify actual chess analysis.

## Open investigation

- Mobile two-way navigation is verified using actual browser pointer/keyboard interaction. Verify physical touch gesture behavior separately when a device is available; it has not been claimed as tested.
- Inspect actual Stockfish evaluation curves before changing graph presentation; synthetic samples are not representative.
- Dark move-number and phase-label foreground styles have been corrected; future passes can audit the rest of the interface's secondary labels quantitatively rather than globally overriding the palette.
- Investigate whether the lengthy utilities below the core review distract users, without removing functionality merely for shorter pages.
- Run independent real analysis source integrity/browser regression suite separately before eventual release. This iteration modifies frontend layout only.

## Deployment/merge status

No merge, deployment, updater, production SQLite or live service changes authorized or performed. Commit and push only the isolated feature branch.
