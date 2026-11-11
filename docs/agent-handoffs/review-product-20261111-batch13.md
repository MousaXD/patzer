# Agent C — Batch 13: explain engine variation starting position

Date: 2026-11-11 (Asia/Dubai) · Branch: `agent/review-product-20261111`.

## Recovery and source audit

- Resumed from committed and pushed Batch 12 `37312f7f5cc75ad7030b12f92b8d1a65ef85b93d`. The tracked worktree was clean except ignored disposable QA artifacts.
- The existing server scoring contract in `server/src/chess/variationScoring.ts` constructs `best_pv = sanPv(fenBefore, pre.pv, 8)`. The frontend renders a board at `attempt.fenAfter`, then labels `best_pv` simply **Suggested continuation**. This could imply that the suggested line is playable from the displayed post-attempt board even when its first move belongs to the opposite side to move.
- Example with deterministic chess.js position: the legal submitted move `e4` leaves Black to play; the verified line `d4 d5` is legal from the *before-attempt* starting FEN, but trying `d4` on the after-`e4` board is illegal because it is Black's turn. There is no scoring error here; this was a **provenance and learning-copy ambiguity**.

## Minimal frontend correction

- The existing `practice.continuation` label now states **Engine line from before your attempt:**. Equivalent text was updated in all five supported locales (English, German, Russian, Bulgarian, Spanish), without changing any translation keys or interpolation fields.
- The practice UI still displays its attempted-move position. No separate engine analysis, speculative explanation or duplicate request is introduced; the SAN PV is only disclosed after a verified attempt.
- The permanent Chromium spoiler detector now explicitly forbids the new, correctly qualified label before an attempt. The real Stockfish feedback test confirms that label appears after verified scoring.

## Verification evidence

- A new focused component negative control constructs a legal engine line from the before FEN and proves that the same first SAN is *not legal* from the displayed after-attempt FEN. The test against previous copy failed (11/12 in the component file); after correcting the label, the focused component/locales suite is **38/38 PASS**.
- `npm run typecheck`: **PASS** (server, web, test TypeScript).
- `npm run build`: **PASS** (server compilation + production Vite frontend).
- Permanent Chromium + local Stockfish + disposable synthetic SQLite game suite: **19/19 PASS** with real verified best-PV wording after the attempt, no premature hint in blind mode, and all prior cancellation, keyboard, navigation, locale and viewport protections. Evidence under ignored `qa-artifacts/batch13-pv-provenance/`.
- `npx vitest run --maxWorkers=2`: **748/748 PASS across 92 test files**, with the original five-second per-test timeout unchanged (24.05s overall). This does not certify unrestricted-worker CI.
- Original independent `qa/agent07/frontend-overhaul-smoke.mjs`: **35/35 PASS**, isolated Chromium, real local Stockfish, disposable SQLite, keyboard/focus, responsive viewport/themes, legal branches and saved-game immutability. Ignored evidence: `qa-artifacts/batch13-original-smoke/`.

## Boundaries, residual dependencies

- Modified only Agent C adjacent locale resources, practice component test and browser QA, plus this handoff. No scoring, coach, auth, DB schema, updater, release pipeline or production data changes. Did not merge into `main`.
- An engine-preferred line is still a depth-limited recommendation, not proof that other alternatives are wrong. The existing educational caveat and verified-response checks remain in place.
- Existing `GET /api/games/{id}` exposes saved engine advice in its authenticated network payload even in blind mode. A reduced practice DTO requires Agent A/integrator approval. Physical screen-reader, Safari/Firefox, combined-tree exact-head QA and learning outcomes remain uncertified.
- PR #17 still intersects earlier `web/src/pages/Review.tsx` work, and Agent D's AI-prose profile-language/cache issue remains with Agent B/integrator.

## Next checkpoint

After broad verification, inspect the staged diff, commit/push to `agent/review-product-20261111` only, verify local HEAD against the remote SHA and report the exact result. The tracked handoff cannot include its own future SHA. Leave all ignored test artifacts and local engine binaries untracked.
