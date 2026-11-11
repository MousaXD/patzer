# Agent C — Batch 4: blind practice request isolation and cancellation

Date: 2026-11-11 (Asia/Dubai) · Branch: `agent/review-product-20261111`

## Starting checkpoint and evidence

- Continued **after** committed/pushed `8d1674e23b065acdf45ab22b2889333ac22a0dab`. No replay of earlier implementation.
- Prior Batch 3 fixed the verified `Qh4#` spoiler from SAN-based accessibility choices; refer to `review-product-20261111-batch3.md`.
- Inspected source and recorded browser requests during `?practice=1`. Despite the isolated visible UI, `GameAnalyzer.tsx` still fetched `/api/games/{id}/review` (answer-bearing cached AI prose) and `/api/coach/status`, and its `analysis_stale` effect could POST a full-game `/api/analyze` while the player was trying a blind exercise. The free-variation scoring effect could likewise run in the background after a transition from full Review. These were actual code paths; AI prose/coach HTTP requests were also visible in the previous disposable Chromium QA logs.

## Narrow frontend-only correction

1. **No unrelated hidden requests from the blind picker.** Cache loading for AI report prose and coach configuration now waits until normal full Review is visible. Entering full Review still triggers both loads, verified in Chromium.
2. **Stale analysis cannot silently trigger blind-session engine work.** Suppress the automatic forced reanalysis while `?practice=1`; do not offer stale/invalid cached classifications as practice-ready candidates; show an actionable message to open full Review and refresh the engine result. This is a trustworthiness guard, not a silently changed scoring formula.
3. **Abort competing analysis requests.** Entering either direct blind practice or an in-review retry now cancels an outstanding full-game engine request and resets its busy indicator. The existing on-demand engine-line effect and variation scoring effect are also gated by both blind states and abort on transition.
4. **State/request correctness.** A canceled full-game request cannot leave a disabled Re-analyze control or surface a late failure after returning to the saved game. Earlier PGN immutability, legal-move validation, SAN-hidden entry, error/retry behavior and focus restoration remain intact.

No data migrations, scoring changes, auth changes, AI algorithm changes, shared DTO modifications, package updates, live server actions or `main` merges occurred.

## Tests and adversarial controls

- `npm run typecheck`: **PASS**, server+web+test TypeScript.
- `npm run build`: **PASS**, server compilation + production Vite bundle.
- Permanent disposable Chromium + local Stockfish `web/tests/review-practice.browser.mjs`: **12/12 PASS** on the final code. New controls assert *zero* AI report fetches, coach status calls, unexpected analysis POSTs in the blind picker, and their resumption when full Review is opened. Stale cached analysis is shown as unavailable without background force-reanalysis. A delayed 503 full-game reanalysis is aborted when the player enters an in-review retry; returning to Review immediately restores the Re-analyze control and never displays that late error. All original real-engine, 429, corrupt-result, cancellation, same-PGN, mobile touch, keyboard input, FEN-mate anti-spoiler, and light/dark responsive tests remain passing. Local artifacts: `qa-artifacts/batch4b-depth-locator/` (ignored).
- During the first run of the new cancellation test, one *test locator* failed after 30 seconds because the app translates `review.depth` to `Depth`, not the fallback `Engine depth settings`. The locator was corrected to the unique `[aria-expanded]` control in the Review tablist and the complete browser suite passed **12/12** on rerun. This was not a production UX fault or a claimed initial green run.
- `npx vitest run --maxWorkers=2`: **92/92 test files, 737/737 tests PASS**, normal 5-second test timeout; no global configuration change. Concurrent multi-worker CI remains a separate resource contention issue documented in Batch 2.
- Existing independent Chromium/Stockfish smoke `qa/agent07/frontend-overhaul-smoke.mjs`: **35/35 PASS**, using an isolated loopback server and synthetic disposable SQLite games. Local evidence: `qa-artifacts/batch4b-existing-smoke/`.

## Limits and integration dependencies

- This is **UI and ordinary network-request isolation**, not cryptographic confidentiality. The existing `GET /api/games/{id}` response still contains the saved full engine analysis (including best UCI/PV) required by the current client to find bad moves. A technically sophisticated player inspecting network payloads could see hints; a **narrow server DTO that exposes only practice candidate IDs/FEN without best moves** would be required for stronger network-level non-disclosure. The shared/backend contract belongs to Agents A and the integrator; no unauthorized backend rewrite.
- A cached AI prose request already initiated in full Review may finish at the HTTP layer if the player switches to a blind retry mid-flight; React ignores obsolete responses, but `api.get` does not currently expose an abort contract. Further cancellation would require an approved shared client API change.
- Full-game reanalysis intentionally remains available after explicit entry into ordinary Review. A stale game does not present old verdicts as current blind candidates.
- Agent A's latest engine work and Agent B's verified claim work should be integrated separately. PR #17 still changes a nearby `Review.tsx` accuracy label from Batch 2; conflict resolution is integrator-owned.
- Actual screen-reader operation, hardware mobile touch, Firefox/Safari, cross-agent combined-head QA, learning gains and equivalent-best engine evidence have not been certified.

## Final recorded test results and remote state

All targeted/browser, full unit, TypeScript, production build and broad Chromium validation gates passed locally. Resulting commit/push SHA must be taken from `git rev-parse HEAD` after this handoff is committed. No local screenshot, synthetic database or engine binary is staged; no cross-agent combined-tree release certification is asserted.
