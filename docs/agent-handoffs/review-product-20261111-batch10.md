# Agent C — Batch 10: localized, accessible mistake practice in all five interface languages

Date: 2026-11-11 (Asia/Dubai) · Assigned branch: `agent/review-product-20261111`.

## Resume and independent audit

- Continued from committed/pushed Batch 9 `07ed3fe7ff1086caf39eed3a70455863a4cd4e2a`, without replaying previous implementation or changing the original PGN.
- Inspected the existing Game Review and MistakePractice React code, all five product locale resources (`en`, `de`, `ru`, `bg`, `es`), localization parity tests and browser QA. Read-only comparison of Agent A `7178e26`, Agent B `19c359e`, Agent D `2ca55ef` and independent accuracy PR #17 `02bfe98` found no ownership conflict in the current practice component, but PR #17 still changes the shared `web/src/pages/Review.tsx` file and requires integrator reconciliation.

## Observed usability / accessibility gap

The blind-practice feature was implemented with English-only text: **Practice first** in the saved game library, the picker, retry and recovery flows, accessible `aria-label`s, native keyboard move selectors, engine errors/assessments and the complete FEN-based text description of chess pieces. This contradicted the application's five-language profile setting and could make a core accessibility fallback unreadable to German, Russian, Bulgarian and Spanish users.

## Implementation (frontend lane only)

1. Added a complete `practice` translation namespace to the five existing JSON locale resources. It covers labels, screen-reader descriptions, correct piece names, winner/player interpolation, move selection, check state, engine feedback, retries and errors. The English experience preserves previous wording/behavior; German, Russian, Bulgarian and Spanish no longer silently fall back to English for these keys.
2. Replaced hardcoded practice strings in `Review.tsx`, `GameAnalyzer.tsx`, and `MistakePractice.tsx` with the existing `react-i18next` translations. The initial hint-free picker and the in-review retry remain distinct.
3. Converted `describePracticePosition` output from English prose into **structured piece type + square** entries, so the same accurate chess.js FEN evidence is spoken in the chosen interface language. Neither the original move, best UCI/PV nor evaluation appears before an attempt.
4. Stored error **translation keys** rather than strings in the practice component. A locale change now relabels a pending/failed check without canceling, duplicating or restarting the actual Stockfish scoring request. Engine validation, stale response rejection and saved PGN immutability remain unchanged.
5. Used existing localized chess classification keys when showing a verified engine assessment, rather than displaying the backend's English enum values as UI text. SAN/UCI chess notation is deliberately kept canonical for engine legality; translated move-input descriptions still show `Nf3` and `e2e4` examples valid for chess.js.

## Verification, negative controls and honest test history

- Initial focused unit run failed **8 of 34** because old tests had no i18next provider/setup and expected the previous English-string data structure; those fixtures were updated to use the actual bundled i18n and structured FEN summary. A component regression additionally changes i18n to German while scoring is pending and asserts **exactly one** non-aborted engine request.
- Added locale-parity tests for all four non-English locales: same `practice` key tree as English, nonempty strings, identical interpolation placeholders and localized key screen-reader messages. Focused final suite: **39/39 PASS** across 3 files.
- Real disposable Chromium/local Stockfish QA: **17/17 PASS**. The added end-to-end test updates the synthetic user's actual profile language to each supported non-English language, reloads the authenticated library, verifies translated entry and aria text, enters the blind picker and practice board, checks localized screen-reader piece descriptions and illegal-move messages, then asserts the chessboard fits a real 390px mobile viewport without horizontal overflow for **each** translated language. The original PGN remains exactly unchanged. All earlier 16 practice tests (spoiler secrecy, history, real scored move, failed engine response, cancellation, touch and responsive views) also pass. Latest evidence: ignored `qa-artifacts/batch10-mobile-locales/`.
- First full unit run after the production changes: **743 PASS / 1 FAIL**; the one failure was in a simplified `Review.library.test.tsx` translation mock that returned the raw translation key for the newly localized practice accessibility label. The test mock was updated to interpolate the existing English test fixture without changing runtime behavior. Full rerun result recorded below.
- `npm run typecheck`: **PASS**, server and frontend including tests.
- `npm run build`: **PASS**, server build and Vite production bundle.
- `npx vitest run --maxWorkers=2`: **744/744 PASS** across 92 files, original five-second per-test timeout, 23.35s total. The increased test count reflects four new locale parity cases and one pending-engine localization regression; this does **not** establish unrestricted-worker CI stability.
- Original `qa/agent07/frontend-overhaul-smoke.mjs`: **35/35 PASS**, disposable SQLite, local Stockfish, 5 responsive viewports × two themes, move legality, keyboard/focus and PGN integrity. Ignored evidence: `qa-artifacts/batch10-original-smoke/`.

## Boundaries, risks and handoff

- This is **localization and frontend accessibility only**: no auth, scoring algorithm, AI/coach, SQLite, backend DTO, live process, updater, deployment or `main` change. The entire change remains unmerged and unshipped.
- The rest of Patzer's legacy Review shell may still have other English-only phrases not owned by this batch. Browser testing confirms application-level profile-language switching, but **human native-language copy review** and physical screen-reader verification remain desirable; this is not complete WCAG certification.
- The authenticated full game-detail API still includes engine suggestions in its response. Network-level answer secrecy remains an Agent A/integrator-approved reduced-practice-DTO dependency, distinct from the DOM-level isolation already tested.
- PR #17 accuracy branch and the Batch 2 link both touch `web/src/pages/Review.tsx`; the integrator must review the combined changes and run exact-head integration QA before release. No merge or cherry-pick is authorized in this Agent C branch.
- Do not include local `qa-artifacts/`, temporary databases or engine binaries in the commit. Confirm pushed remote SHA after the final validation gates.

## Final checkpoint

Pending full rerun and smoke result, staged-file audit and pushed SHA. This tracked handoff cannot contain its own future commit hash. The next automatic continuation should resume from the exact `git rev-parse HEAD` recorded after push, not repeat localization work.
