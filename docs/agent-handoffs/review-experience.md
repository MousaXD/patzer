# Game Review experience — Agent handoff

Date: 2026-11-10  
Agent branch: `agent/review-experience-20261110`  
Starting point: `c8d9e1e00609c30779a3e86542f25f9454e1e911`  
Draft verification PR: https://github.com/MousaXD/patzer/pull/13

## Impact-ranked findings and implementation

1. **P1 — misleading position/evaluation feedback**. The graph treated the starting position (ply zero) as move one, used array indexing by ply rather than matching records, and represented missing scores as 0.00. A missing score in the evaluation bar also appeared as an even 50/50 position. The graph now maps positions zero through the end, renders unscored gaps neutrally, aligns classified markers by their actual ply, and exposes correct keyboard/slider semantics. The bar uses a neutral unknown state with explicit screen-reader text.
2. **P1 — best-move arrows could reference the wrong board position**. Review move `best_move_uci` is evaluated before that move, but the board displays the result of the move. Mainline suggestions now come from the *following* move's cached analysis; free variations can only use a current-FEN live line. Stale position-analysis responses cannot be displayed for a new FEN. Added pure regression tests.
3. **P1 — indefinite loading and opaque Stockfish failure**. Failed or invalid game fetches previously left an endless skeleton. The review now shows a recoverable error and retry/back navigation. Top engine lines identify HTTP 429 as busy, distinguish other failures and expose a Retry button; pending responses from former positions are ignored.
4. **P1 — move history was buried below lengthy reports**. Moved the review tabbed history above the summary report, leaving engine/threat/explorer capabilities intact. Refined the board/rail grid sizing to a balanced ~48/52 split at desktop width, capped by viewport height, without editing shared CSS.
5. **P2 — controls and navigation ergonomics**. Added an explicit starting-position entry, accessible move number/side/classification labels, touch-sized move buttons, keyboard focus indicators, a shortcut legend, clear variation lengths/origins, and disabled next/last controls at the end of a variation. The move list now uses responsive CSS max heights rather than reading `window.innerWidth` during React render.
6. **P2 — stale master-explorer results and inaccessible previews**. Master-game results are now tagged with their source FEN, hidden immediately when the board changes, and previewable with focus/touch as well as mouse hover. Closing the panel clears its preview arrow; the W/D/L bar has a screen-reader description.

7. **P2 — incorrect notation for FEN-started games**. The original move list assumed ply one was White's first move. It now derives the side to move and fullmove number from the saved game's starting FEN; phase dividers use the corresponding relative pair index. Added tests for Black-first games, absolute move numbering and malformed FEN metadata.

## Modified files

- `web/src/pages/GameAnalyzer.tsx`
- `web/src/components/MoveList.tsx`
- `web/src/components/MoveRow.tsx`
- `web/src/components/EvalGraph.tsx`
- `web/src/components/EvalBar.tsx`
- `web/src/components/ExplorerPanel.tsx`
- `web/src/components/MoveRow.test.tsx` (updated expected accessibility labels)
- `web/src/components/MoveList.test.tsx` (new)
- `web/src/components/EvalBar.test.tsx` (new)
- `web/src/components/ExplorerPanel.test.tsx` (new)
- `web/src/components/review/evalGraphModel.ts` (new)
- `web/src/components/review/evalGraphModel.test.ts` (new)
- `web/src/components/review/reviewPosition.ts` (new)
- `web/src/components/review/reviewPosition.test.ts` (new)
- `web/src/components/review/moveHistoryModel.ts` (new)
- `web/src/components/review/moveHistoryModel.test.ts` (new)
- This handoff.

No backend, global stylesheet, shared app shell, data, secrets or dependencies changed.

## Tests and verification

The expected local worktree `/home/mousa/projects/my-creations/chess/patzer-agent-review` is not mounted in the execution environment; GitHub is accessible through the connected GitHub repository tool. A direct Git network checkout is also unavailable. Thus **local Vitest, TypeScript and build commands were not run**, and no pass claim is made for them.

The new regression tests cover initial/sparse graph positions, unscored gaps, accurate FEN-scoped best moves, stale explorer results and keyboard/touch-preview lifecycle, meaningful evaluation-bar unknown/mate labels, move-history semantics, and Black-first imported game positions.

Reproduce on a real checkout with existing dependencies:

```bash
npm run typecheck
npm test -- web/src/components/review/evalGraphModel.test.ts web/src/components/review/reviewPosition.test.ts web/src/components/review/moveHistoryModel.test.ts web/src/components/EvalBar.test.tsx web/src/components/MoveList.test.tsx web/src/components/MoveRow.test.tsx web/src/components/ExplorerPanel.test.tsx
npm run build
```

The draft PR intentionally triggers the repository's CI typecheck, complete unit suite, build and browser regression jobs. **Do not treat this branch as certified until those workflows complete successfully.**

## Remaining weaknesses / coordination

- Interactive board behavior, AI coaching, backend classification and variation persistence are deliberately unchanged. This patch does not certify the complete saved PGN to Stockfish-to-coach player journey.
- No visual screenshot comparison on desktop or mobile devices was possible from this environment. Review at 375px, 768px, 1280px and 1920px widths and both theme modes.
- The position API's engine-busy feedback now has manual retry; cross-panel 429 scheduling and global single-flight coordination remain outside this change.
- New review-only geometry and suggestion helper modules are intentionally pure and may be reused by later QA work. The move history has new aria-label semantics, so assertions about bare SAN-only labels must be updated.
- The branch and draft PR are **not merged or deployed**.
