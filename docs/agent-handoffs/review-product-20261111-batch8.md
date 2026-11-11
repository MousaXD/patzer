# Agent C — Batch 8: accessible recovery from invalidated blind practice

Date: 2026-11-11 (Asia/Dubai) · Branch: `agent/review-product-20261111`.

## Starting checkpoint

- Resumed from pushed Batch 7 commit `f43c5343b9b72e0756f66b19c8ad1315432b25f3` and its handoff; did not replay completed analysis/engine work.
- Inspected the unchanged UI branch and recovered the deliberate bookmark-triggered stale game-detail refetch fixture from `web/tests/review-practice.browser.mjs`.
- Latest remote heads fetched and inspected **read-only**: Agent A `7178e26`, Agent B `19c359e`, benchmark `d86a9f9`, independent accuracy PR #17 `02bfe98`. The first three do not overlap Agent C's practice file paths; PR #17 still edits the earlier Batch 2 `Review.tsx` practice-entry neighbor. Agent C owns only frontend practice files. No changes to another agent's branch, `main`, auth, SQL, scoring, coach, updater or running service.

## Verified defect

**Before:** The existing practice state correctly refuses a stale/mismatched saved-game analysis and shows `Practice position unavailable`, with an explicit return action. But on a background game-detail refetch, the focused blind-practice control is unmounted without focus transfer. The user's keyboard focus falls back to the page body; even the return button did not restore focus to the newly revealed destination. This is particularly disorienting for screen-reader and keyboard-only users.

The permanent Chromium negative control uses the *real* bookmark mutation/invalidation to produce a late `analysis_stale: true` snapshot while practice is open. The first run against the old code: **12/13 checks passed; the new recovery test failed**, timing out while waiting for the `practice-unavailable-heading` to become the active element. No assertion was invented from an isolated mock or code assumption.

## Correction

- Isolated the existing recovery markup into a small `PracticeUnavailable` component. Its mount effect focuses its `h1` (`tabIndex={-1}`, stable `id`, accessible `aria-labelledby`) whenever a background state change invalidates the active practice position. The existing `role="alert"` remains for alert announcement and the original failure explanation is unchanged.
- The explicit return action now moves focus to the correct destination: `full-game-review-heading` for the in-review retry or `practice-picker-heading` for a direct blind-pick session. This preserves the existing safe 'unavailable' behavior; it never exposes a best move during practice and does not dismiss the failure automatically.
- The native return control has a minimum 44px target height. The normal successful attempt focus/return behavior, request cancellation, PGN immutability and scoring validation remain unchanged.

## Verification

- **Baseline negative control:** 12/13 practice-browser checks PASS, 1 FAIL on missing focus after the stale response (expected failing pre-fix baseline).
- **After:** `npm run typecheck` PASS and `npm run build` PASS (server and production frontend).
- Permanent `web/tests/review-practice.browser.mjs` with isolated Chromium, synthetic SQLite and real local Stockfish: **13/13 PASS**. The bookmark/refetch test now checks focus on recovery heading, 0 hidden reanalysis POSTs while blind, return to full Review heading, one ordinary stale reanalysis attempt afterward, no engine retry loop and exact source PGN equality. Other tests cover fresh blind entry and recovery, mate-SAN secrecy, legal alternative feedback, error/429/stale responses, cancellation, focus, mobile emulation and both themes. Evidence: ignored `qa-artifacts/batch8-focus-fix/`.
- `npx vitest run --maxWorkers=2`: **739/739 PASS across 92 test files**, original five-second per-test timeout, 23.51 seconds overall. This is resource-bounded local validation; it does not establish unrestricted-worker CI stability.
- Original `qa/agent07/frontend-overhaul-smoke.mjs` with disposable SQLite and local Stockfish: **35/35 PASS** including chess legality, keyboard, focus, desktop/mobile overflow, dark/light, security and PGN immutability checks. Artifacts ignored at `qa-artifacts/batch8-existing-smoke/`.
- `git diff --check`: PASS. No cross-agent branch or package file changed, and ignored `qa-artifacts/` will not be staged.

## Remaining risks / handoff

1. True HTTP-payload secrecy still requires Agent A/integrator approval of a reduced practice DTO; authenticated game detail includes stored engine best moves. This frontend fix is a **DOM/user-interaction** accessibility correction, not network secrecy.
2. No claim of physical screen-reader, Braille, hardware touch, Safari/Firefox, true zoom, or completed WCAG certification. Chromium accessibility focus assertions are necessary but not sufficient.
3. PR #17 changes `web/src/pages/Review.tsx` near the Batch 2 practice-entry UI. Integrated branch reconciliation remains the integrator's job; this batch does not touch that file.
4. Other review-agent branches were read-only inspected at this checkpoint; Agent A's engine-score provenance and B's validated coach claims remain independent of this small frontend recovery change and still require combined-tree release certification.

## Checkpoint

Verify the diff and test records, then commit and push only `GameAnalyzer.tsx`, the permanent browser test and this handoff to `agent/review-product-20261111`. Obtain exact remote-matching HEAD with `git rev-parse HEAD` and `git ls-remote --heads origin agent/review-product-20261111`. Keep `qa-artifacts/` and all local binaries/databases out of the commit. Do not merge or deploy.
