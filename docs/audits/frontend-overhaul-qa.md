# Patzer Frontend Overhaul — Independent QA Certification

**Reviewer:** Agent 07 (independent QA; no production-code ownership)  
**Audit date:** 2026-11-08  
**Repository:** https://github.com/MousaXD/patzer  
**Intended integration branch:** `feat/patzer-frontend-overhaul`  
**QA branch:** `agent-07/frontend-qa-certification`  
**Decision:** **NO-GO — integration exists but remains at the pre-overhaul baseline; release certification blocked**

## Exact revisions and evidence provenance

| Item | Evidence / state |
| --- | --- |
| Baseline main | `31b6e55f0762d23f9cad738b05174815acd37ed1` (https://github.com/MousaXD/patzer/commit/31b6e55f0762d23f9cad738b05174815acd37ed1) |
| Integration SHA | `31b6e55f0762d23f9cad738b05174815acd37ed1` when inspected on 2026-11-08. **This is identical to `main`**, so it does not yet contain the required frontend overhaul. The earlier HTTP 404 preceded creation of this branch. |
| Agent 01–06 branches | Absent from the initial search. Agent 04 PR #2 and Agent 06 PR #1 appeared later while the audit was underway. Specialist code is not yet integrated. |
| QA branch | **Created and pushed** at `agent-07/frontend-qa-certification`. QA browser harness fixes pushed at `60ad47bfd5befce87fb0411a9205840e67aafaf1`; this report update follows as a QA-only commit. Four QA-only files; baseline parent `31b6e55f0762d23f9cad738b05174815acd37ed1`. |
| QA pull request | **Draft PR #3:** https://github.com/MousaXD/patzer/pull/3, targeting `feat/patzer-frontend-overhaul`. Do not merge until Agent 00 coordinates integration. |
| GitHub Actions run URLs | Completed browser run on QA commit `3569feff33185987f308bddc15f0e49ff462d964`: https://github.com/MousaXD/patzer/actions/runs/42503920012 (PR) and https://github.com/MousaXD/patzer/actions/runs/42503914164 (push), both **failed**. Updated QA harness SHA `60ad47bfd5befce87fb0411a9205840e67aafaf1` queued: https://github.com/MousaXD/patzer/actions/runs/42509538957 and https://github.com/MousaXD/patzer/actions/runs/42509533617. No passing integrated candidate run. |
| Test execution | **Executed on unmodified baseline in GitHub-hosted Chromium.** Run #42503920012 completed with **15 PASS, 11 FAIL**. Typecheck, unit and build steps passed; independent browser step failed; artifact upload succeeded. Failures reflect missing overhaul functionality and some identified QA harness race/selector issues. These results do **not** test the integrated overhaul; updated harness commit requires rerun. |

**Evidence standard:** Source inspection describes the existing `main` baseline and new QA expectations. None of the baseline observations below is an observed regression of the unpushed overhaul. Screenshots, CI passes, Stockfish results, audio quality, and accessibility cannot be certified by reading source alone.

## Baseline findings and risks for the specialist agents

| ID | Severity / owner | Evidence on baseline `main` | Required acceptance evidence |
| --- | --- | --- | --- |
| QA-01 | **Release blocker / Agent 00** | Integration branch still points to unchanged pre-overhaul baseline; final specialist-integrated SHA is missing. Agent 04 PR #2 targets integration; Agent 06 PR #1 targets `main` instead, so Agent 00 must route it to integration without unsafe direct main merge. | Integration PR or branch with a fixed reviewed commit and complete required CI logs. |
| QA-02 | **P1 / Agent 01** | `web/src/App.tsx` computes `site_theme ?? 'auto'` and follows `prefers-color-scheme: dark`; `server/src/db.ts` defaults new profiles to `site_theme='auto'`. Under a dark OS, a newly created baseline user receives dark mode, contrary to the new white-default requirement. | A new-user real-browser case with dark OS preference remains light; explicit Dark still works. Confirm source of truth and migration compatibility. |
| QA-03 | **P1 / Agent 01** | `web/src/index.css` declares `font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;`; no local `@font-face` declaration is present in the inspected first 65 lines. | Prove bundled font assets load successfully without network dependencies; computed controls use the intended custom family, and controls are styled consistently. |
| QA-04 | **P1 / Agent 04** | Baseline `web/src/pages/GameAnalyzer.tsx` renders `<ChessBoard>` in the review pane without passing `movable` or `onMove`; `web/src/components/ChessBoard.tsx` defaults `movable=false`. Baseline game review is replay-only, not a variation editor. | Browser-driven Bc4 from the position after 1.e4 e5, with legal turns and saved PGN unchanged. Plus castling, en passant, promotions, branch navigation, keyboard, and touch. |
| QA-05 | **P1 / Agent 07 / Agent 00** | Existing `.github/workflows/ci.yml` responds to PRs targeting `main` only; it does not currently run for integration-targeted PRs. | Dedicated overhaul workflow targeting `feat/patzer-frontend-overhaul`, then required checks on the exact integration SHA. Do not bypass the existing checks. |
| QA-06 | **P2 / Agent 05** | `web/src/lib/sounds.ts` documents synthesized wood-knock `classic` default and optional board recordings; `server/src/db.ts` migration defaults `move_sound_set` to `classic`. | Verify the replacement default, mute/volume/offline handling, no duplicate sounds, and documented asset licensing. Human listening still required. |
| QA-07 | **P2 / Agent 01 / Agent 05** | Existing Settings defines an `EMOJIS` avatar picker and displays `form.avatar_emoji`. “No emoji UI” needs an explicit product decision without silently deleting existing avatar personalization. | No decorative emoji navigation/actions; owner signs off on how existing avatar feature is preserved or migrated. |
| QA-08 | **P1 / Agent 06** | Baseline classification uses `SCORING_VERSION=9` and the game analyzer paints a badge on the move destination. Reading source alone does not prove visual correctness or Stockfish parity. | Real Stockfish analysis results compared to UI labels, arrows, destination-square badge coordinates, both orientations, and high-DPI/mobile screenshots. |
| QA-09 | **P1 / Agent 03** | Workspace already has a board column and right analysis rail but is not the integrated reference redesign. Source-only inspection cannot establish 40–50% intended board proportion on every viewport. | Browser measurement and screenshot review at every requested viewport and theme, including clipped/overflow controls. |
| QA-10 | **P1 / Agent 02** | `web/src/App.tsx` has signed-in routes for Home, Play, Review, Insights, Train, Learn, Openings, Plan, Lab, Players, Settings, and admin Users/System. These must be preserved while switching to the rail. | Authenticated admin and ordinary-user route coverage, language changes, keyboard shortcuts, mobile drawer, and auth/logout flows. |

## Mandatory release gates

Statuses here are **NOT TESTED / BLOCKED**, not fabricated pass/fail results for unimplemented code.

| Gate | Status | Required evidence |
| --- | --- | --- |
| 1. No release-blocking frontend regression | **BLOCKED** | All existing Play/PvP/WebSocket/import/training/admin/persistence regressions and QA browser routes pass on integration SHA. |
| 2. No serious accessibility regression | **BLOCKED** | Keyboard/focus names, contrast, role semantics, screen-reader check, and mobile operation. |
| 3. Working keyboard move navigation | **BLOCKED** | First, previous, next, last and input-focus interactions in browser. |
| 4. Working interactive variations | **BLOCKED** | Legal moves from arbitrary ply; branch preservation; promotion/castling/en passant; touch. |
| 5. Correct Stockfish move classification | **BLOCKED** | Actual engine HTTP analysis, not only synthetic badge fixtures. |
| 6. Correct board badges and highlights | **BLOCKED** | Capture/move classes, placement, both orientations and viewport screenshots. |
| 7. Consistent white/dark themes | **BLOCKED** | Explicit theme switching + dark OS preference with new-user light default. |
| 8. No system-default appearance in audited controls | **BLOCKED** | Local font loaded; no generic system fallback; styled select/input/button/focus. |
| 9. Working sound preferences | **BLOCKED** | Mute, output, persistence, offline, no duplication; human listening quality check. |
| 10. Successful required CI | **BLOCKED** | Typecheck, unit, build, browser e2e and Docker smoke on exact SHA with inspected logs. |

## Browser coverage specification

`qa/agent07/frontend-overhaul-smoke.mjs` provides a new, independent Chromium black-box harness. It starts the actual server against a throwaway SQLite database, logs in with the actual login UI, injects *presentation-only* analyses, tests real Stockfish scoring through the API, and stores `results.json` + screenshots.

| Viewport | Light | Dark | Inputs/coverage |
| --- | --- | --- | --- |
| 1920×1080 desktop | **PASS (baseline only)** | **PASS (baseline only)** | Screenshot, board visible/square, overflow, layout |
| 1440×900 desktop | **PASS (baseline only)** | **PASS (baseline only)** | Screenshot, board proportions, keyboard review, badge, auth routes |
| 1366×768 desktop | **PASS (baseline only)** | **PASS (baseline only)** | Screenshot, overflow, cramped navigation |
| 768×1024 tablet | **PASS (baseline only)** | **PASS (baseline only)** | Screenshot, responsive stacking |
| 390×844 mobile | **PASS (baseline only)** | **PASS (baseline only)** | Screenshot, overflow, separate real touch variation |
| 1366×768, dark OS, fresh profile | **FAIL (baseline default)** | N/A | Must remain light unless dark explicitly chosen |

Real-browser QA cases: new-user theme default; 13 authenticated routes; computed styles/fonts; keyboard nav; accessible names and focus; no decorative emoji in chrome; original badge geometry and flipped orientation; legal alternative move and saved-game immutability; castling; en passant; queen promotion; touch move; saved sound/theme preference; **real** Stockfish classification of a known tactical error **and a legal exploratory variation**, including illegal-move rejection.

**Important:** Synthetic seed data checks presentation only; it does *not* certify scoring. Independent engine checks analyze a saved Fool's Mate game and the new `/api/analyze/variation-move` endpoint for a legal Bc4 variation, plus illegal-move rejection. Exact classification thresholds still need specialist review and additional tactical positions.

## Existing functionality not to drop

The current CI contains Node 20/22 typecheck, unit and builds; a real PvP protocol test; reconnect/resume; OIDC SSO; two-browser PvP; browser resume; Docker image boot smoke. Retain every one. The new workflow supplements those checks, not replaces them.

Before approval, independently exercise positive and negative cases for Game Review, Chess.com/Lichess imports, Stockfish analysis, AI coach, Play Bot/Friend, WebSocket multiplayer, premoves, takebacks, draws, rematches, training, lessons, openings, profiles, insights, login/signup/setup/password reset, admin permissions, translations, mobile and saved games. Existing automated coverage for some of these domains is necessary but not proof that the new integration behaves correctly.

## CI and runtime evidence limitations

- **Actual GitHub Actions job logs inspected.** https://github.com/MousaXD/patzer/actions/runs/42503920012 (independent QA 15 PASS / 11 FAIL); https://github.com/MousaXD/patzer/actions/runs/42503878359 (Agent 02, two failing navigation tests); https://github.com/MousaXD/patzer/actions/runs/42504080677 (Agent 05, one failing sound test); https://github.com/MousaXD/patzer/actions/runs/42503349323 (Agent 06 individual branch, four jobs passing). None is the final integrated candidate. Inspect logs once a run has completed.
- **Browser screenshots captured and uploaded, not manually reviewed.** QA run #42503920012 uploaded ten responsive light/dark screenshots and results artifact: https://github.com/MousaXD/patzer/actions/runs/42503920012/artifacts/13626738953. The harness's viewport/layout checks passed on the *baseline*; visual matching to the owner's reference remains unverified.
- **Real audio listening: not performed.** A human should judge timbre, clipping and perceived responsiveness on desktop and mobile; this cannot be inferred from waveforms alone.
- **Cross-browser testing: not performed.** The initial automation targets Chromium; add Firefox/WebKit passes where supported before claiming cross-browser certification.
- **Security:** preserve CSP, CSRF header, authentication, session scope and admin permission checks. The new UI must not expose unauthenticated data or let variations overwrite stored game records.

## Follow-up and release decision

1. Agent 00 integrates specialist PRs into the existing integration branch under a reviewable SHA.
2. QA files are pushed **only to `agent-07/frontend-qa-certification`** and draft QA PR #3 targets `feat/patzer-frontend-overhaul`. Do not merge without coordination.
3. Verify the QA workflow triggers and inspect every failed job **log**. Rerun at the fixed integration SHA after changes. Publish exact run URLs and completed matrix results.
4. Agent 07 re-inspects the six specialist code diffs, attends to browser screenshots/audio perception, and signs off only when all ten release gates are evidenced.

**Current independent recommendation: NO-GO, because integration still points to the unmodified baseline and complete certification has not run.** This status should be re-evaluated when code and CI evidence exist. Only Agent 00 can decide the final merge.

## GitHub Actions follow-up — 2026-11-08 (Agent 07 continuation)

All outcomes below are from **actual GitHub Actions logs**; never extrapolate them to the still-unintegrated `feat/patzer-frontend-overhaul` SHA `31b6e55f0762d23f9cad738b05174815acd37ed1`.

### Latest QA branch browser execution

- Independent QA run [#42503920012](https://github.com/MousaXD/patzer/actions/runs/42503920012), QA SHA `3569feff33185987f308bddc15f0e49ff462d964`: **15 PASS / 11 FAIL**, build/typecheck/unit passed, browser step failed, screenshot+JSON artifact uploaded.
- The ten responsive screenshot/overflow/board-square cases passed on the *old* baseline, not the redesign. Local font loading, OS-dark default-light theme, interaction variations, several keyboard/badge cases, and the new API endpoint failed or remained blocked.
- Actual run errors: `POST /api/analyze/variation-move` HTTP 404 (Agent 06 PR #1 not integrated); dark-OS preference selected dark (Agent 01 required change absent); no bundled loaded font (Agent 01 required change absent); review-board `Bc4`, castle, en passant, promotion and touch move unsupported on baseline (Agent 03/04 required integration absent).
- **Harness validity corrections** (Agent 07 only): route smoke previously declared `/lab` blank immediately after `domcontentloaded`, before auth hydration; now waits up to 5 seconds and still fails if the page does not render. Board-flip lookup wrongly expected an accessible name `Flip board` when the visible button is `Flip`; corrected to its real accessible name. Keyboard navigation now waits for the expected initial ply counter and polls browser history location, keeping the same first/previous/next/last acceptance checks. These corrections were pushed in QA-only commits `ac160193f325f9551d6bbe04cb732e534fbac1be` and `60ad47bfd5befce87fb0411a9205840e67aafaf1`. **They have not yet produced a completed verified result at time of report update.**
- Do not interpret prior 11 failures as 11 independently confirmed product regressions. The original branch is intentionally pre-overhaul and two failures were test-harness assumptions.

### Specialist branch review and exact-head restrictions

| Workstream | PR / head | Observed evidence | Gate / owner |
| --- | --- | --- | --- |
| 01 Theme | No reviewed PR in current list | New-user dark-OS baseline behavior violates white-default spec | BLOCKED — Agent 01 |
| 02 Navigation | [PR #5](https://github.com/MousaXD/patzer/pull/5) / `9b4dedc6345c214e0677f34af883e903e62f2a5d` | [Run #42503878359](https://github.com/MousaXD/patzer/actions/runs/42503878359) failed two tests: desktop resize leaves mobile drawer `<aside>` present; version/changelog control missing by accessible name `Patzer v7.19.0` | FAIL on specialist branch — Agent 02 to resolve or demonstrate test error |
| 03 Workspace | No reviewed PR in current list | Reference redesign not available for exact-SHA screenshot comparison | BLOCKED — Agent 03 |
| 04 Variations | [PR #2](https://github.com/MousaXD/patzer/pull/2) / `5703434bb287b91020f192957ebe4310ee185c19` | Code provides `analysisMode`, legal move handling, branch hook/state and tests. `GameAnalyzer.tsx` is not changed in this PR (owned by Agent 03). Thus successful end-user variation flow depends on later integration; no exact-head integration browser evidence. | BLOCKED — Agents 03/04 |
| 05 Audio | [PR #4](https://github.com/MousaXD/patzer/pull/4) / `521da6ecc280ae59d7895eeb6301f53c2448afbd` | [Run #42504080677](https://github.com/MousaXD/patzer/actions/runs/42504080677) (earlier workflow head `4f914a223ccee4da1aaa50ed9ce47a4ef83abc64`) failed `web/src/lib/sounds.test.ts:99` on Node 20/22: expected synthesizer 659 Hz missing; Docker and real-browser PvP/regression jobs passed. Run does **not** certify later PR head. | FAIL on tested earlier head — Agent 05 must resolve and rerun latest exact head |
| 06 Move quality | [PR #1](https://github.com/MousaXD/patzer/pull/1) / `0d7c58e9c720ef5898fa4eefb79644addeafd4fb` | [Run #42503349323](https://github.com/MousaXD/patzer/actions/runs/42503349323): all four CI jobs passed, including real browser regression. **PR base is `main`, not integration**; do not merge to main prematurely. | Individual head CI PASS only; Agent 00 must route into integration |
| 07 Independent QA | [PR #3](https://github.com/MousaXD/patzer/pull/3) / current harness `60ad47bfd5befce87fb0411a9205840e67aafaf1` before report update | Old baseline run failed as expected; [updated PR run #42509538957](https://github.com/MousaXD/patzer/actions/runs/42509538957) and [push run #42509533617](https://github.com/MousaXD/patzer/actions/runs/42509533617) were queued when checked. | QA release BLOCKED; Agent 07 to inspect completed updated logs |

### Release gate decision

The ten release gates above remain **BLOCKED**, not passed. Gate 10 additionally has observed specialist CI failures; the relevant technical owners must fix or explain them. The latest integrated product's SHA is still the baseline; any future integration update invalidates all earlier release-candidate conclusions until CI and browser QA execute against that exact integration SHA. Independent listening review for sound quality and manual screenshot comparison remain mandatory. **Recommendation remains NO-GO.**
