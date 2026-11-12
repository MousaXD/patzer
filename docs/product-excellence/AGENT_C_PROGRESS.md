# Agent C — Game Library, Imports and Exploration

## 2026-11-12 — First improvement (isolated branch)

- Base: `origin/feat/review-polish-product-excellence-20261111` at `5b5fe22`.
- Worktree: `/game/patzer-agent-library-20261112`.
- Scope: `web/src/pages/Review.tsx` and library regression tests; no Review internals, global shell, production service or database touched.

### Observed issues and verified implementation

1. The game list API already implements `source`, `time_class`, `result`, `analyzed`, and `sort`, but library visitors could only search text or show bookmarks. Added accessible, URL-persistent controls for all five server-side fields. The query cache key now distinguishes each filter combination so cached pages never leak between searches. Unknown deep-link values are constrained to supported options.
2. Manual imports always requested only 20 recent games despite each provider route supporting up to 200 per request. Added a 20/100/200 selector, defaulting to 200, with explicit recent-history language and a result message that distinguishes new games from retrieved games. The UI does **not** claim a complete import of a larger history.
3. Added tests for deep-link filter/query propagation and bounded import feedback.
4. Follow-up `6d19156`: a filtered zero-result library now provides a clear-filters recovery action rather than a misleading empty-account onboarding action. Preserves the separate header account-setup link where appropriate.

### Verification

- `npm test -- web/src/pages/Review.library.test.tsx`: **16 passed**.
- `npm run typecheck`: **passed**.
- `git diff --check`: **passed**.
- Rendered browser screenshots (desktop/mobile/light/dark): **not yet collected**; no browser certification claimed.

### Next highest-value work

1. Browser-render validation for mobile, desktop, dark and light; inspect filter wrapping and import controls.
2. Design safe, resumable full-history imports for Chess.com/Lichess. The current one-request ceiling is **200 recent games**, and additional requests for older games require a cursor/archive design; increasing a UI limit alone cannot retrieve 1,000 games reliably.
3. Improve importer return metadata (invalid/unsupported vs duplicate counts) and show partial failures explicitly.
4. Audit large-library query plans and provider rate-limit controls with disposable data.

### Safety / handoff

Do not merge or deploy. Do not run imports against live accounts. Recheck the branch and this file on continuation; avoid repeating the first implementation.

## 2026-11-12 — Continuation: browser-audited library and importer data integrity

Recovered the clean `38cacd6` Agent C tip. The first round of work was already finished and was **not reimplemented**.

### Reproduced and fixed

1. **Narrow phone layout:** Browser QA found a filter dropdown extending past 320px. Introduced two-column bounded mobile filters and constrained the library workspace to its available width. Screen captures at 320px and 390px in both themes now have no horizontal overflow or clipped filter controls.
2. **Mobile Game Cards:** Real captures revealed review/bookmark/practice affordances cramped on small screens. Cards now show a mobile-only two-row layout separating game information and actions. The player's own accuracy is displayed only when `user_color` is known; otherwise the row says analysis is available without assuming White is the owner.
3. **Import affordance:** Moved manual import into a distinct, clearly titled panel with explicit recent-game scope and account-linked source buttons.
4. **Import counting:** Both providers return `imported`, `total`, `skipped`, and `duplicates` so already-present games cannot be mistaken for failed or newly added games. Result messaging distinguishes those categories.
5. **Lichess correctness:** Previously accepted illegal PGNs, assigned foreign-account games to White, treated missing winners in ambiguous statuses as draws, and silently swallowed malformed/truncated NDJSON lines. The importer now rejects unsupported/invalid records, validates ownership and legal PGN, and fails a malformed response instead of silently claiming a complete batch.

### Evidence / verification

- `npm test -- server/test/platform-backend.test.ts server/test/lichess.test.ts web/src/pages/Review.library.test.tsx`: **48 tests passed**, including repeated Chess.com and Lichess imports, deduped IDs, malformed PGNs, account attribution, unknown-color accuracy, ambiguous results and truncated batches.
- `npm run typecheck`: **passed** after the main implementation.
- `npm run build -w web`: **passed**.
- Browser fixture: `web/tests/library.browser.mjs`. It runs a loopback-only Vite preview with mocked HTTP responses and no connection to production accounts or databases. Tested **1440×900, 390×844, 320×700**, each in **light and dark**, with rendered screenshots in ignored `qa-artifacts/agent-c-library/`. All viewport bounds and keyboard-labelled select controls passed. Interactive checks covered 240 loaded games with unique detail links, URL-bound filters, import results, and no-match recovery; no client JS errors were observed.
- One-time full-history Chess.com CLI already exists at `scripts/import-chesscom-history.mjs` with checkpoint/backups; it is **not** wired into the in-app import. No actual full-history import was run.

### Follow-up priorities

1. Enforce linked-account username match on manual provider imports; current route input accepts optional username overrides, which can attribute a different public account's games to the signed-in user.
2. Add transactional all-or-nothing writes to each bounded manual batch, and prove a simulated database failure cannot leave the import partially committed.
3. Extend browser checks to narrow/card scrolled state, keyboard focus and screen-reader names, and compare against light/dark captures after future changes.
4. A safe *in-app* full-history workflow requires explicit start, durable per-month checkpoints, resumption, rate control, integrity-backed backup and cancellation semantics; don't retrofit a 200-game endpoint to pretend it supports thousands.

### Scope boundaries

All implementation stays in Game Library, provider imports and dedicated tests. Review analysis internals, global shell, other agents' branches and live service remain untouched. No merge, deployment or production DB activity.

## 2026-11-12 — Follow-up: ownership boundary, atomic batches, and error recovery

- Recovered clean `a4cfe22`, then investigated the next risk identified above.
- **Route-level ownership boundary:** manual Chess.com and Lichess imports now require the requested username to match the linked profile username (case-insensitive), rejecting cross-account overrides with HTTP 403 before any provider request. No arbitrary public account's games can be attributed through this manual route.
- **Mid-flight safety:** a profile may change while a download is pending. Both providers recheck the currently linked account **inside** the SQLite transaction before inserting, reject changed links with HTTP 409, and avoid storing stale source data. Chess.com auto-import uses the same guard, so its scheduled imports do not race past a profile change.
- **Atomic batches:** both 200-game manual import paths now commit as a single transaction; a failed insert rolls the entire batch back. Import validation and PGN parsing occur **before** taking the writer lock to keep transaction duration bounded.
- **User recovery:** linked-account errors now show a specific, accessible alert in the Games Library rather than a generic failure message. The browser fixture covers this case with a mocked HTTP 409.
- **Hono/SQLite negative controls:** tests simulate cross-account requests, mid-request username changes, and a failing database trigger after an earlier valid game. Verify that zero games remain after aborted transactions, as well as successful duplicate accounting.

### Verification

- Targeted `server/test/platform-backend.test.ts`, `server/test/lichess.test.ts`, `web/src/pages/Review.library.test.tsx`: **55/55 passed**.
- `npm run typecheck`, `npm run build -w web`, `git diff --check`: **passed**.
- `web/tests/library.browser.mjs`: **passed** across six viewport/theme combinations and interactive scenarios, including the linked-account error alert. Uses mocked data and an isolated preview; it does not import real accounts.
- Full suite with three workers (`npm test -- --maxWorkers=3`): **106 files passed, 2 skipped; 977 tests passed, 12 skipped**. No failures. Skipped tests remain outside this change; do not count them as passing.

### Next problems to investigate

1. Current one-time full-history Chess.com CLI is safe but not discoverable from the in-app Games Library. Any new UI endpoint needs durable per-archive checkpoints, explicit confirmation, cancellation, throttling and verified backups. Do not claim full-history functionality from the 200-game recent import.
2. Inspect large-library opening/opponent discovery flows for more useful navigation without adding speculative data.
3. Review Chess.com provider error classification: the initial `getPlayer()` lookup currently maps network/rate failures to `player_not_found`; users may be told their existing profile is missing when the provider is unavailable.
4. Maintain independent release certification; do not merge or deploy without integrator review.

## 2026-11-12 — Chess.com profile failure classification

Recovered `0330b63` and finished the previously uncommitted Chess.com import error work.

- `server/src/chess/chesscom.ts`: `getPlayer()` now treats **only** an explicit HTTP 404 as an absent player. HTTP 429, HTTP 503, network failures, malformed JSON, and invalid/unexpected player payloads propagate as provider failures; account identity in the returned payload must match the linked username case-insensitively.
- `server/src/routes/games.ts`: rate limiting becomes `chesscom_rate_limited` (429); unavailable or malformed provider responses become `chesscom_unavailable` (502). A genuine missing Chess.com profile remains `player_not_found` (404). SQL errors still fail normally and do not masquerade as network errors.
- Added clear error text for all five supported UI languages (en/bg/es/de/ru). The browser fixture verifies distinct alerts for Chess.com rate limiting, changed linked account, and Lichess unavailability.
- Targeted backend/frontend tests: **43 passed**. `npm run typecheck`: **passed**. `npm run build -w web`: **passed**. Isolated Chromium fixtures in both themes at **1440, 390, 320px**: **passed**, including import error alerts and search/pagination.
- No real provider requests, production accounts, production databases, or merges/deploys.

**Next audit hypothesis:** `listArchives()` currently silently filters invalid archive URLs and `getMonth()` treats missing game-array properties as an empty monthly archive. The full-history CLI reuses those clients; malformed upstream replies could therefore incorrectly appear complete. Confirm with isolated mocks before changing behavior.

## 2026-11-12 — Archive completeness and historical-resume protection

- Recovered clean `99978cd` after the previous error-handling change; new archive assertions **failed against the original code** (11 failing checks), confirming the silent-truncation defect.
- `listArchives()` now verifies every URL uses the canonical HTTPS Chess.com monthly-archive path, has the expected linked username, a valid calendar month, no injected query/fragment/credentials, and comes from the trusted host. Malformed archive-list structures or even *one* invalid entry fail the import rather than dropping the affected month silently. Valid months are sorted chronologically and deduplicated before retrieval.
- `getMonth()` no longer interprets missing/null/invalid `games` as an empty month; it rejects malformed response data with `chesscom_invalid_response`. Legitimate `{games: []}` remains valid. This protects manual recent imports and the existing resumable historical CLI.
- Tests in `server/test/chesscom-archive-responses.test.ts` verify malformed host/path/identity/month/shape, valid duplicate/out-of-order lists, empty months, and a historical catch-up interrupted after one committed month: the first month's game is preserved and the import **does not claim completion** after the corrupt next month.
- Focused provider/history/route tests: **50 passed** (12 provider-contract, 11 existing historical, 27 authenticated backend tests). All data is mocked or uses an in-memory SQLite fixture; no real Chess.com fetch or production database action was performed. The additional Hono negatives confirm invalid archive listings/months produce HTTP 502, no inserts, and no false success.
- Full suite (`npm test -- --maxWorkers=3`): **107 test files passed, 2 skipped; 995 tests passed, 12 skipped**. No failures. `npm run typecheck`, `npm run build -w server`, and `git diff --check`: **passed**.
- Isolated Chromium smoke (`web/tests/library.browser.mjs`): **passed** at 1440/390/320 widths, light/dark, including interactive filters, pagination and import error alerts. No production service started or modified.

**Next investigations:** test performance with large synthetic game histories, examine library search/navigation learnability, and determine what additional safety contract an in-app full-history controller would need before exposing the existing CLI functionality to end users. Do not change global design, Game Review internals, or other agent lanes.

## 2026-11-12 — Game Library calendar date exploration

Recovered `750ddab` and the six unfinished modified files; finished the date-range work without repeating earlier filter/import investigations.

- Added optional validated `from_date` and `to_date` query parameters to authenticated `GET /api/games`, with inclusive UTC-day semantics, rejection of nonexistent calendar dates and backwards/duplicate ranges, and ownership-restricted SQL filters. Retains offset pagination, server-side sorting, search, analysis-status filters, and bounded request sizes.
- Added URL-persistent Game Library date pickers (`From date`, `Through date`) with clear-filter recovery. Invalid deep links are not sent to the API; editing the start/end of an incompatible range clears the other boundary. Cache keys include both dates.
- Added accessible date labels and translations across English, Spanish, German, Bulgarian, and Russian; date inputs use bounded two-column mobile layout instead of overflowing the viewport.
- Added live authenticated Hono/SQLite tests for inclusive start/end day, ownership, zero-result, and invalid date handling; component tests for deep links and inverted ranges; and Chromium checks for mobile date inputs, URL request parameters, and narrowed list results.

### Verification

- Targeted backend/frontend tests: **48/48 passed** after translation-only edits.
- Entire repository `npm test -- --maxWorkers=3`: **107 files passed, 2 skipped; 998 tests passed, 12 skipped**. No failures.
- `npm run typecheck`, `npm run build -w web`: **passed**. Isolated browser fixture passed **again after translation edits** at **1440×900, 390×844 and 320×700** in light/dark, including date boundary filtering and no horizontal overflow. Inspected the 320px dark-mode capture.
- The standalone date-range component, Hono/SQLite data semantics, full test suite, and generated web build are all verified. Ready to commit and push on Agent C's own branch only.

### Next highest-impact checks

1. Benchmark date/search/sort SQL on a large synthetic SQLite library. Measure before optimizing; use disposable fixtures only.
2. Audit how users move between opening, opponent, and bookmarked games to identify real discoverability gaps in the Library screen without adding fake metadata.
3. Keep full-history UI workflow out of scope until its durable checkpoints, cancellation, and progress contract are designed and validated.

## 2026-11-12 — Opening search available immediately after import

- Resumed the unfinished opening metadata investigation on clean `308bd0c` (no other agent worktree used).
- **Reproduced before the fix:** A valid, newly imported Chess.com or Lichess game with known moves stored `eco=NULL, opening_name=NULL`, so a Library search by opening could miss games until an expensive full analysis ran. Two authenticated import/SQLite tests failed before changes.
- **Fixed:** Manual recent Chess.com and Lichess imports now classify validated PGNs using the same curated opening lookup already employed by the existing Chess.com historical catch-up. Added `importOpeningMetadata` as a shared display-only helper; the historical path delegates to the same logic without changing its behavior. Opening name is provided only when the recognized ECO agrees with any original ECO header; custom-start positions are never misclassified. Original PGN, ownership, ratings, result, source revision and prior analyses remain unchanged. No synthetic game results or guessed opening names.
- Added import-route tests proving source PGNs survive verbatim and imported games become searchable by opening immediately, even before analysis. Dedicated tests cover named openings, contradictory ECO headers and custom-start positions. The isolated Chromium fixture exercises opening text search across a paginated 620-game library.

### Verification

- Targeted server tests: **60 passed** over 4 files. Full suite (`npm test -- --maxWorkers=3`): **108 passed files, 2 skipped; 1,003 passed tests, 12 skipped**; zero failures.
- `npm run typecheck` and `npm run build -w server`: passed.
- Isolated Chromium browser: 1440/390/320 widths, light/dark, pagination, opening search, date filtering, imports and error recovery: passed. No production service or external provider accessed.
- `git diff --check`: passed.

### Next highest-impact issue

- **Previously imported games:** The new insert-only enrichment does not fill opening metadata on existing duplicate IDs (`ON CONFLICT DO NOTHING`), so older collections may remain undiscoverable by opening. Investigate a carefully scoped PGN-identity-preserving enrichment strategy for duplicate imports, with regression tests proving no original PGN, user ownership, analysis provenance or conflicting existing ECO is changed. Do not claim a full-history metadata backfill unless it is explicitly implemented and tested.

## 2026-11-12 — Enrich opening details on safe reimports

- Recovered clean `9a2a59b`. The outstanding duplicate-import gap was reproduced with **3 failing tests** (existing games did not gain opening metadata).
- Added a shared, prepared SQLite enrichment statement for Chess.com and Lichess. On a duplicate game, only missing ECO/name data can be added, and **only when user ID, source, external ID and the complete original PGN match**. An existing ECO or opening name cannot be overwritten. Conflicting ECO is not assigned a guessed opening name. Original PGN, ownership, result, bookmarks, notes, ratings, source revision and saved analyses remain unchanged.
- Both import routes return a separate `enriched` count, without inflating `imported`; the Library's success message explains how many existing games gained opening details while still stating the recent-game limit.
- Proved no-op repeated imports, preservation of mismatched original PGNs and conflicting ECOs, and transaction rollback of prior enrichment if a subsequent insert fails. Separate Chess.com and Lichess Hono/SQLite negative controls use disposable test data and synthetic SQLite abort triggers.
- **Limit:** This applies only to games encountered in an explicit recent-game reimport. It is **not** a complete backfill of every historical game and does not silently scan the production database.

### Verification

- Targeted backend/frontend tests: **58 passed**. Full suite: **108 test files passed, 2 skipped; 1,008 tests passed, 12 skipped** (no failures).
- `npm run typecheck`, web build and server build: **passed**. `git diff --check`: passed.
- Reusable isolated Chromium browser fixture: **passed** at 1440px, 390px and 320px in both themes. Checked distinct opening-enrichment feedback, old history pagination, server-side opening search, import errors and mobile geometry.
- No live provider requests, production DB access, deployment or changes to another agent worktree.

### Next improvement candidates

1. Evaluate performance and SQLite query plans for 10k+ historical games using disposable fixtures. Avoid premature indexes.
2. Explore useful library-based opening and opponent discovery from *actual stored game data*, clearly distinguishing recognized from unclassified openings. No synthetic history or claimed complete backfill.
3. Design explicit, durable opt-in historical metadata enrichment if the operator wants to classify earlier archived games that cannot appear in the 200-game recent fetch.

## 2026-11-12 — Opening exploration from real saved games

- Recovered clean `9ddc63f` and implemented a scoped browsing journey across older saved games, **not** merely the 40 cards currently visible.
- Added authenticated `GET /api/games/openings` using only persisted `opening_name` classifications. Returns total games, classified/unclassified coverage, and the five most played named openings with exact persisted counts. Rejects names longer than the supported filter. Never guesses unrecognized openings, evaluates PGNs on request, or queries another user's history.
- Added strictly validated and account-scoped `opening` filter to the paginated games endpoint. Matches an opening exactly, avoiding false positives when an opponent or note contains the same word. Existing date/search/source/status filters remain independently supported.
- Added a compact, accessible Games Library discovery section with account-specific top-opening choices and explicit classification coverage. Choosing an opening clears unrelated filters and navigates to a shareable exact-opening URL; clearing filters restores the complete history. Labels have translations in the five supported languages.
- Hono/SQLite tests confirm ownership, exact matching, unclassified records, ordering, invalid/duplicated input and no-auth rejection. React tests confirm deep links, chip selection and recovery. Browser fixtures verify navigation and capture light/dark views at 1440, 390 and 320 px.

### Validation and performance

- Focused backend and UI tests: **59 passed**. Full suite: **108 test files passed, 2 skipped; 1,012 tests passed, 12 skipped**; zero failures.
- TypeScript, web build, server build, `git diff --check` and isolated Chromium browser verification: **passed**.
- Disposable, in-memory SQLite benchmark: 30,000 games belonging to one user and 2,500 belonging to another. Opening summary + exact count, measured together over 20 runs, had **~21 ms median, ~25 ms maximum** on this machine. Query plan used the existing owner-scoped index; no migration/index was needed.
- Inspected desktop light-mode and mobile dark-mode screenshots: opening cards readable and unclipped. No production service, actual provider data, live SQLite, deployment, merge or other agent's worktree used.

### Next candidate

- Audit first-use and partial-failure behavior of the new opening summary. Investigate whether silently hiding the section when the summary request fails is confusing and whether the library should offer a retry without disrupting the working game list.
- Consider **opponent discovery** and navigable past encounters, strictly from stored identities and results. Verify ownership and name normalization before adding UI.

## 2026-11-12 — Recover opening discovery independently from library failures

- Recovered clean `193bec4`. Reproduced a missing recovery state: when `GET /api/games/openings` failed, the entire opening-exploration section silently disappeared even though the user's game list was available. New component regression failed against the original implementation.
- Added an accessible, independent opening-summary error message with an explicit retry button. A broken summary fetch does not replace, blank, or retry the unaffected paginated game list. Added localized error/retry text across the existing five UI languages.
- Chromium fixture now simulates one failed opening summary (HTTP 503) on a separate mobile browser context, verifies the normal 620-game library stays usable, clicks the retry, verifies opening cards appear and the alert clears, and checks browser errors. Inspected the 390px light-mode failure screenshot.
- Targeted Library component suite: **24/24 passed**. Full suite: **108 files passed, 2 skipped; 1,013 tests passed, 12 skipped**, no failures.
- Typecheck and web production build: **passed**. Chromium tests passed at 1440, 390 and 320 widths in light and dark themes plus the mobile recovery flow; `git diff --check`: passed.
- No production requests, DB mutation, merge or deployment. No edits to other agents' worktrees.

### Next improvement

- Audit library opponent identity semantics (`user_color`, `white`, `black`) and research a compact way to discover frequent opponents without making up results or pushing search far below the fold on mobile. A dedicated, account-scoped query and explicit unknown-identity count may be appropriate.

## 2026-11-12 — Explore frequent opponents without identity collisions

- Recovered clean `fbece9d`. Completed the unfinished opponent-discovery implementation rather than restarting the existing opening/import audits. An initial backend regression correctly failed with HTTP 400 because the endpoint and provider-scoped filter did not exist; new frontend tests also exposed an existing fixture that returned game-list data for the opening summary endpoint.
- Implemented authenticated, account-scoped `GET /api/games/opponents`: derives opponent display names **only** from `chesscom`/`lichess` records with known `user_color`. Groups by **provider and case-normalized opponent name**, never merges identical usernames across different sites, and reports total, identifiable and missing-name coverage. Explicitly excludes untrusted local PGN free-text names and PvP from this provider-oriented summary. Empty accounts return numeric zeros, not nulls.
- Added validated `source=chesscom|lichess&opponent=...` to bounded, paginated Game Library queries. Exact, normalized opponent matching prevents accidental results from a similarly named player or note. Source changes clear the old opponent filter to avoid silently reusing an identity across providers.
- Reused the compact opening-discovery card as **Openings / Opponents** tabs, rather than adding another tall mobile section. Clicking a named opponent opens provider-qualified history and preserves a shareable URL; clearing filters restores the full library. Added independent error/retry states, recognized/unknown coverage, accessible button names and localized UI strings for the five existing languages.
- Hardened both discovery API consumers against malformed response shapes so an unexpected summary response cannot crash the unaffected game list. Fixed legacy component fixtures to mock each API's actual response shape, retaining bookmark error/retry behavior.
- Adjusted mobile cards to wrap provider/game-count details rather than truncate. Inspected 320px dark and 1440px light Chromium screenshots; navigation, 31-game Lichess / 15-game Chess.com fixtures with the **same username**, source-change clearing, mobile geometry, import recovery and independent opening retry all passed.

### Verification

- Targeted frontend/backend Hono tests: **64/64 passed**; includes cross-account privacy, exact provider identity, unknown color and empty-account cases.
- Full `npm test -- --maxWorkers=3`: **108 test files passed, 2 skipped; 1,017 tests passed, 12 skipped**; zero failures.
- `npm run typecheck`, `npm run build -w web`, `npm run build -w server`, `git diff --check`: **passed**.
- Isolated Chromium: **1440×900, 390×844, 320×700**, both light and dark, no horizontal overflow; opening/opponent discovery navigation, provider-qualified filtering and restoration, full history pagination, search/date filters, import feedback and independent failure recovery all passed. Test browser uses private local preview with mocked API responses and no live database/provider traffic.
- Disposable SQLite benchmark of **30,000 owner games plus 2,500 other-user games**, 20 runs of summary + exact opponent count: **~36 ms median, ~42 ms max**, with the existing user-scoped index used. No DB migration/index necessary based on this test.
- No changes to Game Review internals, other agents' worktrees, main branch, deployed services or production SQLite.

### Next highest-impact candidates

1. Fix the first-use/full-history import gap: the UI is explicitly limited to 200 recent games; the standalone Chess.com historical importer already has archive checkpoints and backups but is not accessible to ordinary Library users. Design and independently verify a safe, opt-in, resumable, cancellable, rate-controlled in-app workflow before implementing it. Do not claim full-history support until it exists and is tested.
2. Audit empty library and non-linked account onboarding, and PGN imports with duplicate/partial failure handling; preserve original files and authenticated ownership.
3. Retest large-source opening and opponent lists without guessing results or replacing curated classifications with synthetic data.

## 2026-11-12 — PGN file import for offline first-use and history recovery

- Resumed clean `6ec0a26` and audited the historical Chess.com CLI safeguards before attempting any long-running in-app job. Confirmed the existing CLI can back up/checkpoint archives, but that is **not** an ordinary authenticated UI workflow and must not be described as complete in-app full-history support.
- Identified a smaller, practical blocker: the Library offered no PGN file upload despite having an `imported` games source. Implemented **explicit local .pgn/.txt upload** independent of provider account links. Import is limited to **4 MiB UTF-8 and 1,000 standard games per file**, with per-game limit of 256 KiB and 2,048 plies. No external Chess.com/Lichess requests occur.
- Added bounded streamed JSON request reading, source PGN parsing, invalid/unsupported variant and SetUp/FEN rejection (including chess.js's normalized-away SetUp case), full-batch validation before SQLite writes, and **one atomic transaction** for the complete file. If any game is malformed, the request returns an indexed error and saves no games; SQLite insertion errors also roll the batch back.
- Import deduplicates **exact original PGN content** using a deterministic SHA-256 external ID scoped to `(user_id, source='imported', external_id)`. Reimporting leaves PGNs, notes, ownership, bookmarks and reviews intact. The classifier may add a recognized opening, but does not invent a player identity, user's color, a match outcome or a date. Absent dates appear as **Date unavailable**, not **In progress**.
- Added a visible and accessible file picker, clear limits, a progress/pending indicator, actionable file/game errors and correct new/duplicate counts in all five UI languages. After successful upload, the UI automatically selects **PGN import** so undated files are visible immediately rather than buried after 1,000 dated games. File is cleared after success and retained on error for retry.

### Verification

- New unit/in-memory SQLite suite: 6 passed. Authenticated Hono route tests verify ownership, valid files, 4 MiB rejection, a broken second game with no partial writes, and account isolation. Targeted backend/frontend suites: **76/76 passed**.
- Full `npm test -- --maxWorkers=3`: **109 test files passed, 2 skipped; 1,029 tests passed, 12 skipped**, zero failures.
- `npm run typecheck`, `npm run build -w web`, `npm run build -w server`, and `git diff --check`: passed.
- Isolated Chromium: **1440×900, 390×844, 320×700** light/dark with zero horizontal overflow. Uploaded a real browser-generated 2-game PGN file, verified original text sent to the mocked endpoint, status, automatic `source=imported` navigation and unknown-date labeling; tested malformed second game, visible error, and retained library. Inspected the 390px dark-mode success screenshot. Browser uses only isolated mock APIs and a private loopback preview.
- Disposable SQLite performance smoke: **1,000 distinct valid PGNs** (82 KB) imported in **576 ms**; exact reimport in **504 ms** added zero games. No real user games or production DB involved. This is a local measurement, not a service-level guarantee.

### Known boundaries / next priority

- This is an explicit **PGN-file** import, not account-wide Chess.com sync; the existing in-app provider import still fetches up to 200 recent games. The original one-time Chess.com historical CLI has verified archive checkpoints and backups, but exposing it as an in-app job still needs durable progress state, cancellation, rate limits, recovery and backup validation. Do not claim full-history sync or run production bulk imports.
- Multi-game PGN files must have conventional `[Event "..."]` headers per game; single headerless PGNs are supported. Mixed/ambiguous exports fail clearly rather than dropping unknown entries. Variants and setup positions are deliberately unsupported until their analysis pipeline is certified.
- Next audit: review the first-use library screen with **no linked provider** and a real PGN upload, particularly its source-filter discoverability and clear missing-date/results semantics. Then independently certify any in-app full-history design before implementation.

## 2026-11-12 — First-use Library onboarding with no linked provider

- Recovered clean `6545aee` and finished the first-use audit left as the previous checkpoint. Reproduced a genuine UX dead end: an empty account without linked Chess.com/Lichess had redundant Settings setup links while the new PGN import option was not explained in the empty-state action. Two targeted tests failed against the original UI.
- Made the zero-game, unfiltered first-use state offer two explicit paths: **Choose a PGN file to get started** (opens the real existing file picker) or **Connect a chess account** (one link to Settings). Already-linked users see guidance to the recent-game import above instead of an unnecessary setup link. Filtered no-match and no-bookmark recovery remain separate and unchanged.
- Avoided a loading-state/account-switch regression by hiding the Settings header shortcut only on true unfiltered empty libraries; restored the existing account-switching test to wait for that account's new library query to settle.
- **Visual QA caught a second defect:** initially the new first-use choice appeared below all search/filter controls on a 320px mobile screen. Moved the true empty state above the filter controls and reduced padding, while keeping filtered recovery next to the filters. The native PGN picker action is now visible within the initial **320×700 viewport**.
- Added translated first-use title, actions, and explanations across en/es/de/ru/bg. Existing PGN import, status, opening/opponent discovery, ownership, library search and review URLs are unchanged.

### Verification

- Library component suite: **33/33 passed**, including two new first-use cases, real picker trigger, linked/unlinked paths, account-switching, and filtered-state recovery.
- Full repository suite (`npm test -- --maxWorkers=3`): **109 test files passed, 2 skipped; 1,031 tests passed, 12 skipped**. No failures.
- `npm run typecheck`, `npm run build -w web`, `git diff --check`: **passed**.
- Isolated Chromium: existing 1440/390/320 light/dark layouts and interactive imports/search/filters passed, as did a new true-empty, no-linked account at **320×700**. Clicked the onboarding CTA, handled a real native file chooser, supplied a PGN, verified the original text reached only the mocked API, saw the resulting `source=imported` list and valid `/review/9001` link; no horizontal overflow or JavaScript error. Inspected before/after 320px screenshots under `qa-artifacts/agent-c-library/library-firstuse-*.png`.
- No production data, external provider requests, service restarts, merges, or changes to other agents' branches.

### Next highest-impact audit

- Independently test the reliability of **multi-game PGN boundaries and accurate success counts** for unusual but realistic exported headers and comments. Reject ambiguous files explicitly rather than saving only the first game. Focus on a reproducible failure; preserve byte-exact original PGNs and avoid migrations unless justified.
- The in-app full Chess.com historical-import job remains intentionally unimplemented pending persistent checkpoints, consent, throttle, cancellation and backup verification.

## 2026-11-12 — PGN archive boundary integrity for annotated games

- Recovered clean pushed `9fe3d5f` and followed the existing next audit (multi-game PGN boundaries), with no repeated library/onboarding investigations.
- **Reproduced a data-loss-adjacent bug:** a valid annotated PGN may contain a line such as `[Event "Not a separate game"]` inside a multiline `{...}` move comment. The prior regex splitter treated that line as a game boundary, producing 2/3 false game segments and rejecting the otherwise valid archive. A new focused test failed against the original implementation.
- Replaced regex-only boundary splitting with a bounded linear scan of candidate Event lines, recognizing whether each line is inside an open brace comment, semicolon comment, or quoted header field. This keeps real `[Event]` headers as split markers while never promoting those embedded in comments. Still parses and validates every whole PGN through chess.js before the atomic database transaction. Does not alter original PGN content, owner, dedupe hash, game result or analysis provenance.
- Added tests for single/multiple annotated games, exact PGN retention, CRLF headers with literal `{` and `;` in values, and an authenticated `POST /api/games/import/pgn` integration covering the boundary case and exact stored content.

### Verification

- Targeted SQLite/parser + authenticated Hono suite: **47 tests passed**. Full repository suite rerun: **109 files passed, 2 skipped; 1,034 tests passed, 12 skipped; zero errors**.
- Initial parallel full-suite pass had all 1,034 assertions green but reported a *late* `window is not defined` timer teardown exception from `web/src/pages/Settings.persistence.test.tsx` / `Settings.tsx:159` (outside Agent C's lane). It passed in isolated rerun, and a second full-suite run was clean. No out-of-scope Settings edits were made; share this as an independent QA handoff if it recurs.
- `npm run typecheck`, `npm run build -w server`, `npm run build -w web`, `git diff --check`: passed. Existing isolated Chromium fixture passed desktop/mobile light/dark, native PGN picker, browser import feedback, partial-error recovery and 320px first-use path; no production network or databases used.
- Disposable 1,000-game annotated archive (129,888 bytes, each game containing an Event-like comment): **1,000/1,000 recognized and saved**, byte-identical canonical game segments; splitter ~3.5 ms, validation + database insert ~566 ms on the test machine. Figures are local smoke measurements, not a latency guarantee.

### Next within Agent C's lane

- Examine whether other PGN comment forms or nonstandard header order cause a false import success. Only implement fixes after reproducing on an actual parser behavior. Continue to reject ambiguous archives rather than dropping games.
- The full historical Chess.com UI sync remains a separate, authorization-sensitive design and is intentionally not enabled by this boundary change.

## 2026-11-12 — Preserve UTF-8 PGN bytes on browser upload

- Recovered clean `6630bc1`. The next audit of unusual PGN exports found a new integrity gap: `File.text()` may silently replace invalid UTF-8 bytes with U+FFFD, corrupting imported player names and comments while the UI reports a successful archive import. An isolated frontend regression reproduced the unhandled condition before changing the importer.
- Replaced permissive `File.text()` with bounded `File.arrayBuffer()` plus `new TextDecoder('utf-8', {fatal:true})` so undecodable bytes cause an explicit pre-upload error. No replacement characters are injected into source PGNs, and no network request is made for invalid encoding. Retained 4 MiB/extension checks and the authenticated, atomic backend import unchanged.
- Added user-facing UTF-8 conversion guidance in the existing five UI languages. The file remains selected after the recoverable failure, allowing the user to replace it and retry.
- Added component assertions for invalid single-byte Latin-1 input and updated the browser regression to select a real malformed UTF-8 file, verify zero API submissions for that attempt, then submit an actual valid UTF-8 file with a non-ASCII player name (`José`) and verify its exact text reaches the mocked API.

### Verification

- Targeted Library component suite: **34/34 passed**. Full repository suite: **109 files passed, 2 skipped; 1,035 tests passed, 12 skipped**, zero failures.
- `npm run typecheck`, `npm run build -w web`, `git diff --check`: passed. Chromium verified 1440/390/320 px light/dark, strict encoding rejection, successful Unicode import, PGN first-use, import recovery, filters and pagination. No production data, deployed services or cross-agent changes.

### Next audit

- Verify asynchronous file reading cannot submit account A's selected PGN under account B's session if a user switches accounts while the bytes are being read. The upload mutation already guards result UI by account; test and independently verify the pre-request identity boundary.

## 2026-11-12 — Block cross-account uploads during asynchronous PGN reads

- Recovered clean `4144c8c` and finished the exact outstanding account-switch audit. Reproduced a **cross-account privacy issue** with a deferred `File.arrayBuffer()` read: an upload initiated under account A could send the chosen PGN after a switch to account B, when the API would use the new account's active browser session. The original UI had only guarded success/error feedback, not the upload request itself. The focused regression failed before the fix.
- Added explicit account-ID checks before reading and immediately before sending the decoded PGN. If the user changed while the file was being decoded, the mutation aborts without calling the API; the existing post-result guards ensure no stale alert appears in account B's Library.
- Added a deterministic component test that suspends `arrayBuffer()`, changes the active account, resumes the file read, and proves **zero upload API calls** and no stale success/error feedback. No auth or cross-agent state files were modified.

### Verification

- Targeted Library component suite: **35 passed**. Full repository suite: **109 files passed, 2 skipped; 1,036 tests passed, 12 skipped**, no failures.
- `npm run typecheck`, `npm run build -w web`, `git diff --check`: passed. Isolated Chromium browser fixture passed 1440/390/320 widths in both themes, valid/invalid PGN encoding paths, first-use import, normal upload feedback, search/pagination and error recovery.
- No real accounts, external providers, production data, service restarts, merges or other agents' worktrees were touched.

### Next highest-impact investigation

- Audit large-history pagination under concurrent imports, deletions, or edits: offset pagination may duplicate or skip cards if new games arrive between page requests. Reproduce with a disposable fixture and test whether the existing deduped UI provides sufficient recovery; prefer a scoped, compatibility-safe fix and avoid undocumented API breaks.

## 2026-11-12 — Stable, backwards-compatible Game Library pagination

- Recovered clean, pushed `f596557` and reproduced the highest-impact outstanding history issue with two **red** authenticated Hono/SQLite regression tests. A newer import inserted before page two caused OFFSET pagination to repeat the last page-one game. Deleting a page-one entry caused OFFSET pagination to skip an unseen game. UI de-duplication could hide the repeated card but could not restore the skipped one.
- Added optional, account/filter/sort-bound **keyset continuation tokens** (`next_cursor`) while preserving existing bounded `limit`/`offset`, `total` and `has_more` fields for older API clients. New clients prefer the cursor; older backends without cursors still use offset and retain the existing 200-game legacy ceiling. The parser rejects malformed, oversized or duplicate cursors, cursor+offset mixing, another account's cursor and tokens reused with changed filters/sort.
- A continuation token carries the final saved game's `(end_time, id)` and a first-page `MAX(id)` high-water mark. Game IDs use `INTEGER PRIMARY KEY AUTOINCREMENT`; newer imports are intentionally absent from the in-flight browsing snapshot and appear when the user refreshes/starts new filtered history. Both newest/oldest ordering, tied timestamps and NULL end times are handled explicitly; a removed earlier entry no longer shifts the continuation position.
- The server still enforces `g.user_id = ?` for every row and analysis provenance gate. Query parameters remain bound to SQLite placeholders, and sort expressions are hardcoded. No production migration, cursor storage or full-history background job was required.
- Added backend tests for insertion, deletion, NULL dates, equal timestamps, source/filter/sort invalidation, cross-account isolation, malformed tokens, no-auth rejection and old offset compatibility. React tests certify new cursor navigation and continued compatibility with offset-only and legacy servers.
- Isolated Chromium reproduced a newer game arriving between page requests on a 390px dark-mode history, then verified all 80 original cards were present exactly once, the new game was absent from that snapshot, and a fresh reload displayed it. Captured/inspected `qa-artifacts/agent-c-library/library-cursor-after-new-import-dark-390.png`. Existing 1440/390/320 light/dark, PGN imports, search, filters and recovery flows also passed.

### Verification / performance

- Targeted backend+frontend: **80 passed**. Full repository test suite: **109 files passed, 2 skipped; 1,041 tests passed, 12 skipped; zero failures**.
- `npm run typecheck`, `npm run build -w server`, `npm run build -w web`, `git diff --check`: **passed**.
- Disposable real Hono/SQLite benchmark, **30,000 owner games plus 2,500 other-user games**, with no production access: first 40-game page ~24 ms cold; next cursor page ~4 ms. A deep page after 25,000 records took **~5.7 ms with cursor vs ~21.2 ms with offset**; 12 cursor probes had median ~5.7 ms. These are single-machine smoke timings, not SLOs.

### Remaining boundaries / next audit

- The high-water-ID cursor protects against later **inserts and deletions**. A concurrent modification of an *existing* game's `end_time` or membership in a filtered collection can still reorder that existing game; this is not an immutable SQLite transaction snapshot. Avoid claiming one without a real snapshot mechanism.
- Independently audit filter resets and reopening a saved game while browsing a cursor-paginated history. Verify filters, bookmarks and navigation do not leave stale cursors or incorrectly reset to the beginning; prioritize reproducible UX failures only.
- The full historical Chess.com in-app sync job remains intentionally unimplemented pending durable checkpoints, opt-in consent, throttling, cancellation and recovery design.

## 2026-11-12 — Make recognized openings visible on mobile game cards

- Recovered clean pushed `6310606`; audited the next Library exploration workflow after stable pagination. The GameCard displayed `opening_name` only in a `sm:inline` header span, hiding one of the most useful discovery cues at phone widths. A new Chromium assertion reproduced the missing label at **390px light mode** before the fix.
- Kept the desktop heading unchanged and added a separate `sm:hidden` opening label inside the existing game-card review link. The label is one line, truncated to the card's available width, with the complete official saved opening available through the HTML title. No opening classification is invented or changed.
- Added a component regression using a realistically long opening name. Adjusted its selector to scope the label to the actual card (the same opening name can also appear in the Explore Openings summary).
- Chromium verified opening names are visible and within viewport bounds at 390px/320px in light and dark modes, and checked no horizontal overflow. Visually inspected full-page 320px light and 390px dark screenshots. Existing game review/practice navigation, import, error recovery, and cursor-pagination browser journeys still passed.

### Verification

- Targeted Library component suite: **37 passed**. Full repository suite: **109 files passed, 2 skipped; 1,042 tests passed, 12 skipped**, no failures.
- `npm run typecheck`, `npm run build -w web`, `git diff --check`: **passed**. No production environment, other agent branch, or database touched.

### Next investigation

- Audit bookmark interactions in the **Starred only** filtered history, especially when a game is unstarred while later cursor pages are already loaded. Confirm the UI does not temporarily show an item that violates the active filter or lose previously loaded cards on an avoidable refetch. Fix only a reproduced usability/reliability defect.

## 2026-11-12 — Keep Starred-only Library consistent during failed bookmark removal

- Recovered pushed `5eeb89d` and audited bookmark interaction within Starred-only game history. A new focused regression reproduced a genuine mismatch: immediately after clicking **Remove bookmark**, the optimistic cache changed the card into an **unstarred game** while the Starred-only filter remained active. On failed requests this momentarily looked like a successful removal and then reverted.
- Preserve the card's starred state only while **removal from Starred-only results** is pending; all-game lists retain their fast optimistic updates. On success, the owned Library queries are invalidated and the confirmed server list removes the card and fills from subsequent games. On failure, the starred card stays visible for retry with an accessible error. Query invalidation remains scoped to the account; no global design-system or Game Review files changed.
- Real Chromium at **390px dark mode** verified an actual 450ms pending request, confirmed the star stayed pressed, confirmed a successful removal disappeared from 40 visible starred games with the next saved game filling in, and confirmed a subsequent simulated 503 left the next game starred and displayed a retryable error.
- Visual QA caught an existing issue in that path: the error label overlaid the mobile action row. Wrapped the mobile actions and placed the error in its own padded row, with browser geometry assertions that it stays beneath the button and inside the viewport. Visually inspected `qa-artifacts/agent-c-library/library-starred-failed-removal-dark-390.png` after the fix. Desktop absolute positioning remains unchanged.

### Verification

- Targeted Library React suite: **38/38 passed**. Full repository suite: **109 test files passed, 2 skipped; 1,043 tests passed, 12 skipped**, no failures.
- `npm run typecheck`, `npm run build -w web`, `git diff --check`: passed. Chromium passed all 1440/390/320 light/dark layout cases, the new Starred-only successful/failed request scenario, opening discovery, provider filtering, cursor paging, PGN uploads and empty-state recovery.
- No production service, SQLite, merge, deployment or other agent branch touched.

### Next independent audit

- Verify that bookmark updates or failures begun on account A cannot modify account B's cached Library or show stale errors when switching between accounts that contain identically numbered game IDs while a request is in flight. Existing tests cover some cached-game isolation; focus on cross-account *in-flight* behavior rather than repeating completed probes.

## 2026-11-12 — Certify cross-account bookmark isolation and guard PGN import result integrity

- Recovered clean pushed `2b2946c`. Audited an in-flight bookmark failure when account A starts a save and the UI switches to account B with the same game ID. The new deterministic regression passed without implementation changes: B's button remains enabled/unstarred, no stale error is shown, and B's account-scoped cached games stay unmodified. Kept this as an ongoing regression instead of inventing a bug.
- Identified a separate **incorrect success-reporting** path in the PGN upload UI. An HTTP 200 containing inconsistent counts such as `{total:2, imported:1, duplicates:0}` previously displayed a completed import and cleared the selected file even though one game was unaccounted for. Added a focused test that failed against the old implementation.
- Validate returned PGN totals as safe nonnegative integers, bounded to 1–1,000 games, with the invariant `total === imported + duplicates`. A malformed/partial reply now results in a clearly distinct **unverified import** warning; it does not claim success or that no games were saved, and retains the file for an idempotent retry. Refresh owned Library and history-derived caches since the server may already have committed games. No cross-account invalidation or false source navigation occurs.
- Localized the uncertainty/retry guidance across all five supported languages. Existing backend atomic import, exact-PGN deduplication, authenticated ownership and data provenance remain unchanged.
- Added Chromium coverage that returns an intentionally inconsistent HTTP 200 after ordinary successful imports. Asserted a visible unverified-status alert, no false success message, retained file/retry control, and normal history recovery. Existing browser flows for provider filters, 320/390/1440 layouts, cursor paging, starred-only recovery, PGN UTF-8 integrity, and first-use onboarding still passed.

### Verification

- Targeted Library React suite: **40/40 passed**, including the new count-invariant test and in-flight cross-account bookmark regression.
- Full repository suite: **109 test files passed, 2 skipped; 1,045 tests passed, 12 skipped; zero failures**.
- `npm run typecheck`, `npm run build -w web`, `git diff --check`: passed. Chromium tested desktop/mobile in both themes and confirmed no horizontal overflow or console errors. Only disposable local API mocks; no production account, external import or database mutation.

### Next independent audit

- Verify the direct game-card-to-Game-Review transition from a filtered Library including user-uploaded PGNs, and document any cross-lane back-navigation issue for the Game Review agent rather than modifying their internals. A return link must not silently discard a deliberate filter or paginated-history context. Audit with the real browser first.

### Cross-lane handoff — Game Review back navigation loses filtered Library context

- A source audit confirmed that Library game cards currently link directly to `/review/:id` or `/review/:id?practice=1` without carrying source/filter/return state (`web/src/pages/Review.tsx`). The Game Review main and practice-picker Back links in `web/src/pages/GameAnalyzer.tsx` and unavailable-state recovery in `web/src/components/review/ReviewUnavailable.tsx` point unconditionally to `/review`. The in-app Back action therefore discards deliberate opening, opponent, bookmark, search and date URL filters rather than returning to the same exploration context. The browser's own Back button remains a separate path that may restore the previous URL.
- **Ownership handoff to Review/UX agent:** implement a safe, account-local return-context contract between Library cards and Game Review: supply the validated Library URL via router state or a carefully scoped same-origin return parameter, consume it in Game Review's Back actions, and fall back to `/review` for direct links, stale sessions or invalid values. Verify provider-qualified opponent and opening deep links, bookmarked-only filters, keyboard navigation, and both full Review and practice-picker entries in Chromium. Never accept an arbitrary external return URL.
- This was verified by inspecting the exact route links and absence of a Library return-state consumer in GameAnalyzer. It was **not** represented as a completed browser-certified fix because editing Game Review internals is explicitly outside Agent C's lane. Agent C's current branch remains independently clean and does not modify that domain.

### Next work owned by Agent C

- Continue auditing user-owned PGN import and large-history cards, especially whether custom headers with playable standard moves are surfaced with an actionable explanation instead of silently dropped. Avoid modifying Review analysis internals or making claims of historical account import completeness.

## 2026-11-12 — Import valid PGNs with reordered and non-Event headers

- Recovered clean pushed `490e195`, including the existing cross-agent Review back-navigation handoff. The next PGN integrity audit reproduced a real false rejection: chess.js accepts a legal standard game with `[Site "..."]` or a custom tag before `[Event "..."]`, but the Library parser assumed every new game begins with Event at byte zero and returned `ambiguous_pgn_archive`. Mixed exports with a later game using Site-first headers also failed.
- First wrote failing regressions for a single Site-first game, mixed Site-first/Event-first/custom-tag-first archives, and a real second game after an annotated move comment that contains fake Site/Event lines.
- Generalized the bounded, single-pass PGN tag lexer to detect **complete top-level header blocks** rather than Event tags alone. Consecutive tag lines belong to one game even if Event comes later; a new top-level tag following movetext begins the next game. The lexer retains existing brace/semicolon-comment protection and quoted-header escaping, preserves each parsed PGN exactly as before, and validates *every* separated game before one atomic SQLite transaction. An untagged single game remains supported; truly ambiguous untagged concatenations still fail instead of silently losing games.
- Updated a legacy assertion that had expected two perfectly valid explicitly tagged games without Event headers to fail. The corrected test now requires both games to import, with byte-identical PGN storage and accurate counts. Added an authenticated Hono route test verifying two reordered/no-Event games are saved only for the correct user with no invented user side or result, and that retry counts both as duplicates.
- Extended the real 390px dark-mode Chromium file picker scenario to upload an archive with a Site-first first game and Event-less second game. Verified the transmitted file text was unchanged and the import success UI remained legible; inspected `qa-artifacts/agent-c-library/library-pgn-reordered-headers-dark-390.png`. All existing browser cases at 1440/390/320 in both themes still passed.

### Verification

- Targeted SQLite + authenticated Hono suite: **55/55 passed**. Full repository suite: **109 files passed, 2 skipped; 1,048 tests passed, 12 skipped**, zero failures.
- `npm run typecheck`, `npm run build -w server`, `npm run build -w web`, `git diff --check`: passed. Isolated Chromium browser passed with synthetic APIs; no production or external provider requests.
- Disposable in-memory benchmark: 1,000 alternating Site-first and Event-less PGNs (70,833 UTF-8 bytes) split into **exactly 1,000 byte-identical games** (~3.47 ms splitter), saved **1,000/1,000** (~569 ms overall); idempotent retry reported 1,000 duplicates and zero new games. Numbers are local smoke measurements only, not performance guarantees.
- No migrations, Game Review internals, production data, merges, deploys, or other agent worktrees modified.

### Next highest-impact inspection

- Audit imported-game **player name metadata** when a valid PGN has long names, non-English characters, or placeholder headers. Confirm Library game cards never silently discard a valid player name or misidentify a player's side; preserve source PGN and authenticated ownership. Reproduce first; prefer conservative display handling over ungrounded inference.

## 2026-11-12 — Preserve recognizable international player names and label unknown players

- Resumed clean pushed `d69d260` and reproduced the next PGN metadata issue. A valid `[White "..."]` longer than 120 characters previously became `NULL` in the saved game record despite remaining present in the original PGN. An imported game with no White/Black headers also rendered two **blank player names** on the Library card, not a useful explanation. Two focused regressions failed before changes.
- Bound derived player-name metadata to **120 Unicode code points**, preserving the recognizable first 119 plus a visible ellipsis when truncated, rather than dropping a real name. The original PGN remains unchanged and its SHA-256 dedupe identity stays stable. Missing, empty and `?`-placeholder names remain unknown instead of inventing players or ownership.
- The Library now renders an explicit **Unknown player** label for absent/blank White and Black metadata, with translations in en/es/de/ru/bg. The action remains a normal `/review/:id` link; the card continues to say **Date unavailable** for imported undated games, and never invents the player's color or result.
- Added a Unicode unit/SQLite test checking the saved truncated name, byte-for-byte original PGN retention and idempotent retry. Added a React Library test verifying both unknown labels and the Review link. Isolated Chromium verified the missing-player card at **320px light mode**, full card in view, no overflow or JS errors. Visually inspected `qa-artifacts/agent-c-library/library-unknown-players-light-320.png`; the fixture uses consistent 1/1 opening coverage and 1/1 game counts.

### Verification

- Focused parser/Library tests: **52/52 passed**. Full repository suite: **109 files passed, 2 skipped; 1,050 tests passed, 12 skipped**, zero failures.
- `npm run typecheck`, `npm run build -w server`, `npm run build -w web`, `git diff --check`: passed. Isolated Chromium covered 1440/390/320 widths, light/dark, PGN import, source-specific exploration, pagination, bookmark recovery, and missing-name rendering. No real provider or production data was used.
- No Game Review internals, schema migration, merge, deployment, production SQLite, or other agents' worktrees changed.

### Next highest-impact audit

- Audit **import-file boundary detection around free-text comments, termination markers and single-game PGNs**: ensure valid annotations do not create phantom games and multi-game concatenation is never reported as a one-game success. Prefer deterministic parser regressions and indexed errors over permissive parsing. Preserve the existing 4 MiB / 1,000-game limits and all-or-nothing transaction semantics.

## 2026-11-12 — Recognize standard SetUp 0 without weakening position safety

- Recovered clean pushed `e78f88f` and probed the exact next PGN parser boundary. Reproduced a valid standard game with `[SetUp "0"]` being rejected as `unsupported_pgn_position`, despite chess.js accepting its ordinary opening moves. Another valid annotated PGN was falsely rejected because its multiline movetext comment contained example `[SetUp "1"]` and `[FEN "..."]` text, even though they were not actual PGN tags. A new targeted test failed on the original parser.
- Replaced the global regex that searched all lines for setup tags with a **bounded inspection of the initial actual PGN tag section only**. `SetUp "0"` remains a standard game; missing/blank setup remains standard; genuine `SetUp "1"`, invalid setup values and actual FEN tags remain unsupported. This remains necessary because chess.js can normalize away even a declared start-position FEN, so relying only on normalized `getHeaders()` would weaken the explicit position safety rule.
- Added parser and authenticated Hono tests: successful atomic import of standard SetUp 0 plus multiline annotations mentioning FEN, byte-identical PGN retention, rejection of genuine custom-position declarations with HTTP 422 and game index, and no accidental deletion of earlier accepted records. Extended the existing Chromium native-file-picker fixture so a reordered-header PGN also includes `SetUp "0"`.

### Verification

- Focused PGN/parser + authenticated API: **58/58 tests passed**. Full repository suite: **109 files passed, 2 skipped; 1,052 tests passed, 12 skipped**, zero failures.
- `npm run typecheck`, `npm run build -w server`, `npm run build -w web`, `git diff --check`: passed. Real isolated Chromium covered PGN upload, 1440/390/320px in light/dark, empty library, search, source filters, cursor pagination, unknown players and Starred-only error recovery. No browser JS errors or horizontal overflow.
- Original PGN bytes and deduplication semantics unchanged; all-or-nothing SQLite import and source/auth boundaries remain intact. No production accounts, providers or services touched.

### Next audit

- Continue testing actual multi-game PGN exports with comments and game termination markers that resemble headers. Explicitly confirm malformed or ambiguous archives never undercount real games, especially quoted header examples inside annotations. Only change behavior after a reproducible failing test and verify with the real browser.

## 2026-11-12 — Prioritize browsing for returning Library users

- Resumed clean pushed `28e41b2` after finishing the standard-SetUp parser fix, then independently reviewed 320px Library screenshots. A returning player with hundreds of games initially saw two tall import forms filling nearly the entire first viewport, while searching and exploring owned history required scrolling. This is an important first-screen product issue, not a backend missing-data problem.
- Wrote a failing component regression requiring a discoverable, initially collapsed **Import more games** button on populated libraries and a Chromium viewport check requiring the game search box to be visible within the first 320×700 and 390×844 mobile viewport.
- Grouped Chess.com/Lichess recent imports and local PGN upload under a single **accessible disclosure** that is collapsed for populated/filtered libraries, preserving the mounted native file input, selected file state, import progress and retry actions. The button advertises its live `aria-expanded` state and `aria-controls`, supports click and keyboard Enter, and reveals all previously available import options without changing their request/validation logic. First-time players with zero unfiltered games retain the visible import forms and their dedicated onboarding choice. The import-success/error status remains outside the disclosure so its feedback stays available.
- Added short translations for the disclosure in all five UI languages. Updated earlier import tests to explicitly expand the panel before exercising the original workflows; kept every provider failure, PGN error, idempotency, account-switch and count-validation assertion. Did not loosen the import or history tests.

### Verification

- Focused Library component suite: **42/42 passed**, including the new disclosure regression. Full repository suite: **109 files passed, 2 skipped; 1,053 tests passed, 12 skipped**, no failures.
- `npm run typecheck`, `npm run build -w web`, `git diff --check`: passed. Real isolated Chromium passed desktop and 390px/320px layouts in light/dark; confirmed the search box remains within the initial viewport, `Import more games` opens the source/PGN form, keyboard Enter closes it, all import/retry journeys still work, and there are no horizontal overflows or browser JS errors.
- Inspected the first 320×700 crop of the full mobile screenshot at `qa-artifacts/agent-c-library/library-populated-firstfold-light-320.png`: header, optional import action, opening exploration, saved-game search and first filters are now all visible without scrolling. No production access, external provider imports, Game Review edits, merges or deployments.

### Next audit within Agent C

- Check retained native PGN selection and stale error feedback when the disclosure is closed and reopened during a recoverable upload error. Ensure browser and keyboard paths remain accessible, especially on 320px mobile; reproduce and test before implementing changes.

## 2026-11-12 — Audit disclosure retry without changing functioning product behavior

- Recovered clean pushed `32f8fba` and verified the exact open item: a user-selected native PGN must survive hiding/reopening the new compact import disclosure, including after an invalid-PGN error. This path **already behaved correctly**; no speculative product fix was made.
- Added a deterministic React regression that selects a file, collapses/reopens import options, receives a recoverable error, confirms the alert is still accessible while collapsed, then reopens and retries the same original file successfully. Added real Chromium assertions for the browser file input retaining `broken.pgn`, a visible retry button, and hidden actions staying out of the collapsed accessibility tree. The remaining browser import, navigation, filters and mobile layouts passed.

### Verification

- Focused disclosure regression passed. Full repository suite: **109 files passed, 2 skipped; 1,054 tests passed, 12 skipped**, no failures. Existing production web build and typecheck from `32f8fba` passed; only regression tests and documentation changed. `git diff --check` and the isolated Chromium browser run passed.
- No production accounts, bulk imports, deployment, schema changes or other agents' worktrees touched.

### Next audit

- Search international chess-player names accurately. SQLite's built-in `LOWER()` is ASCII-only: in disposable probes `JOSÉ` did not match `josé`, and `БОРИС` did not match `борис`. The Library uses `instr(LOWER(...),q)` for literal search, so this is a reproducible mismatch between browser expectations and the authenticated backend. Design a bounded, performant Unicode-aware search without introducing SQL wildcards, authentication changes or expensive full-library JS materialization; add regression and run a disposable large-library benchmark before pushing.

## 2026-11-12 — Unicode-aware, literal full-Library search

- Recovered clean pushed `88a6fd9` after the disclosure retry audit. Confirmed a real international player-name search bug with both an isolated SQLite probe and a **failing authenticated Hono regression**: `LOWER('JOSÉ')` returns `josÉ` and `LOWER('БОРИС')` returns `БОРИС` in stock SQLite, so searching `josé` or `борис` failed despite owning the corresponding games. Decomposed and composed Unicode names also failed canonical substring matching.
- Registered a deterministic, account-scoped query helper `patzer_unicode_search_fold` on the existing SQLite connection, implementing `normalize('NFC').toLowerCase()` for stored White, Black, opening and note metadata. Queries continue to use **parameterized `instr`** rather than LIKE, so `%`, `_` and other special characters remain literal. The helper runs within the existing SQL user-ID-filtered count/page queries; no row materialization, schema changes, background job, or cross-account search was added.
- Added Hono/SQLite regressions using a disposable authenticated user for uppercase accented `JOSÉ`, Cyrillic `БОРИС`, canonically decomposed `Café`, uppercase Unicode opening `ÉCHEC`, Cyrillic note text, literal percent/underscore matches, accent-sensitive distinctions, and rejection of a match belonging only to another account. Existing 1,200-game history, pagination, filters and ownership tests remain green.
- Added an isolated Chromium Library fixture with three Unicode named games, queried `josé`, `борис`, and `café` through the real search input. Verified each term was passed unchanged in the URL, the correct saved card opened via its normal Review link, no browser errors, and the 390px dark-mode rendered layout stayed within bounds. Inspected `qa-artifacts/agent-c-library/library-unicode-search-dark-390.png`.

### Verification and measured overhead

- Targeted Hono suite: **47 passed**. Full repository suite: **109 files passed, 2 skipped; 1,055 tests passed, 12 skipped**, zero failures.
- `npm run typecheck`, `npm run build -w server`, `npm run build -w web`, `git diff --check`, isolated Chromium across 1440/390/320 light/dark: passed.
- Disposable **32,500-game SQLite** performance probe (30,000 owned, 2,500 foreign; count plus first 41-row retrieval): common ASCII query median ~37.7 ms with Unicode folding vs ~15.9 ms prior; international `josé` median ~86.7 ms vs ~22.2 ms prior **incorrect zero-match** query; Cyrillic median ~84.8 ms. This is a deliberate but bounded CPU tradeoff for correct Unicode matching; local timings are *not* service-level guarantees. Existing result limits, cursor and filters still bound output and request count.
- No real accounts, production server, schema change, merge, deploy, other agent branches or Game Review internals touched.

### Next independent audit

- Verify Unicode-aware Library search maintains correct **cursor pagination and sort order** for large matching international sets, with no duplicate or skipped games after a concurrent insert. The new function is deterministic, but exercising the combined search+cursor path would guard against any future query-order changes. Then independently inspect search-empty recovery on 320px.

## 2026-11-12 — Certify Unicode search with paginated history and empty-query recovery

- Resumed clean pushed `ac7dbbb` and finished the exact outstanding combined-path audit. No bug was reproduced: existing account-scoped cursor pagination behaves correctly with Unicode-filtered results. Added an authenticated Hono/SQLite regression populating **93 uppercase Cyrillic matching games** for a disposable user, browsing them in 17-game cursor pages, importing one new matching game between pages, and proving every original game appears **exactly once**. The in-flight listing stays at 93 games while a fresh query returns all 94 and the new game first.
- Extended the isolated 390px Chromium fixture to search for a **nonmatching Cyrillic phrase**, verify the explicit no-match message, clear filters through the real UI, and recover the full three-game collection without a stuck filter or console error. Existing international searches (`JOSÉ`, `БОРИС`, decomposed `Café`) and filter navigation still pass.
- This is **regression certification only**, with no additional product behavior change or ungrounded claim of an immutable SQLite snapshot. The cursor still documents that editing an existing game's sortable timestamp or search membership can reorder it between pages; that requires a separate snapshot design.

### Verification

- Targeted Unicode/cursor regression passed. Full repository suite: **109 files passed, 2 skipped; 1,056 tests passed, 12 skipped**, zero failures. Existing production builds/typecheck from `ac7dbbb` are green; this checkpoint only adds Hono and Chromium tests plus documentation.
- Isolated Chromium 1440/390/320 light/dark, Unicode search empty-state recovery, PGN imports, first-use, pagination and bookmark error recovery: passed. No production accounts, services, schema, merges or cross-agent files touched.

### Next product audit

- Independently review the Library search/deep-filter interaction for **source-qualified opponent names and exact openings** when switching between a normal search and a discovery chip. Ensure no stale filters stay selected in the URL or hide desired games. Coordinate Review back-navigation through the already documented cross-lane handoff rather than editing GameAnalyzer.

## 2026-11-12 — Correct false selection styling after discovery/provider switches

- Recovered clean pushed `663e23b`, and continued the exact outstanding search/deep-filter audit. Added a targeted React regression for switching from a provider-qualified opponent to an exact opening and back with a **pending unsubmitted search**, bookmarked-only filter and oldest-first sort. It passed after waiting for async discovery data: the chip actions clear stale search/source/opponent/bookmark/date filters while keeping deliberate sort; manually switching providers clears the previous provider's opponent identity.
- Real 390px dark-mode Chromium uncovered an additional, **reproducible visual defect**: after switching from a selected Lichess opponent to the Chess.com source, the old Lichess chip had `aria-pressed=false` but retained the *same gold border as a selected chip* when the pointer remained over it (a likely sticky-hover mobile problem). Added a browser regression comparing computed selected and unselected-hover border colors; it failed on the old implementation (`rgb(255, 201, 52)` in both states).
- Changed only Library-local opening/opponent discovery chips so **gold borders uniquely indicate selection**, while an unselected hovered chip uses neutral `chesscom-400` / `chesscom-500` contrast-appropriate borders. Preserved focus-visible rings and existing `aria-pressed` semantics. Did not edit the global design system or Game Review internals.
- Confirmed the browser now displays a clearly neutral old Lichess chip after selecting Chess.com, with the URL no longer carrying `opponent` or `opening`. Screenshots: `qa-artifacts/agent-c-library/library-discovery-filter-handoff-dark-390.png`, visually inspected.

### Verification

- Library React component suite: **44/44 passed**; full repository suite: **109 passed files, 2 skipped; 1,057 tests passed, 12 skipped**, zero failures.
- `npm run typecheck`, `npm run build -w web`, `git diff --check`: passed. Isolated Chromium desktop and 390px/320px light/dark, provider/source switching, search debounce, import retry, first-use, large-history cursor, Starred-only and Unicode search: passed with zero browser JS exceptions or horizontal overflow.
- No external provider calls, real account imports, production SQLite, merges, deploys or other agent branches changed.

### Next independent audit

- Audit **imported-game date and sort previews** for large mixed-provider libraries: undated local PGNs must stay accessible and recognizably undated when users sort oldest-first or combine date filters. Ensure the server never silently excludes undated games from an unfiltered page while reporting a misleading total; verify with a disposable dataset and the actual Library UI before changing anything.

## 2026-11-12 — Keep long international player names inside mobile game cards

- Recovered clean pushed `26eb2a3` and checked the planned mixed-date Library audit against existing coverage **before** repeating it. The Hono suite already certifies oldest/newest pagination across `NULL` game dates, sort boundaries after removals and inclusive date filters; undated PGNs remain marked **Date unavailable** in the Library. Moved to the next untested UI integrity risk: recently improved international player-name metadata may exceed narrow game-card widths.
- Added a new isolated 320px Chromium fixture with a **120-character CJK White name** and a long accented Latin Black name. It reproduced a genuine bug: the rendered names measured **1,680px and 969px** wide, and escaped the card even though the overall document-overflow check reported zero. The browser failed before implementation.
- Fixed the **root cause** by explicitly using a shrinkable `minmax(0,1fr)` single-column Library grid rather than the implicit min-content grid track. Grouped player names in a constrained inline-flex name pair with individual shrinkable truncation, retaining original visible/accessibility text and adding `title` for the full saved metadata. Normal short-name and dated/provider card layouts remain intact.
- First visual pass revealed that applying truncation to both **Unknown player** placeholders would unnecessarily shorten them, despite the wider-page defect being fixed. Gave missing-player labels a wrap-friendly text style rather than ellipsis, so both **Unknown player** labels remain fully legible over two lines on 320px mobile. Existing language translations and identity provenance stay unchanged.
- Added React coverage for 120-character Unicode and long accented Latin names, full title and link text, and min-width constraints. Strengthened Chromium assertions for **both** missing player labels to be visibly uncut (`white-space: normal`, no horizontal clipping), plus page/card/name geometry for the very long player names. Inspected `qa-artifacts/agent-c-library/library-long-player-names-light-320.png` and `qa-artifacts/agent-c-library/library-unknown-players-light-320.png` after the final build.

### Verification

- Focused Library suite: **45/45 tests passed**. Full repository suite: **109 files passed, 2 skipped; 1,058 tests passed, 12 skipped**, zero failures.
- `npm run typecheck`, `npm run build -w web`, `git diff --check`: passed. Isolated Chromium desktop and 390/320px light/dark, long/unknown names, searches, provider and opening switching, imports, first-use, bookmark recovery and cursor pagination: passed without JS errors or horizontal overflow.
- No provider calls, production SQLite, merge, deploy, schema change, or other agent code/worktrees touched.

### Next independent audit

- Audit **keyboard and touch access to full long-name identity and the adjacent bookmark/review actions** on densely populated mobile cards. Verify focus, hit areas and correct navigation with a disposable fixture before changing UI behavior; preserve the Review ownership boundary and the account-local bookmark error semantics.

## 2026-11-12 — Make mobile Library bookmarks easier to reach and operate by keyboard

- Recovered `e64107d` with the exact unfinished `web/tests/library.browser.mjs` change; preserved the existing long-name regression instead of redoing it. The first real Chromium run reproduced a **test/locale mismatch**: English `review.star` exposed the label **Star**, not the component-mock fallback **Bookmark game**. After targeting the real label, Chromium reproduced a genuine **40×40px** bookmark control on 320px mobile, below the tested 44×44px touch target.
- Enlarged only the Library card's bookmark action to `min-h-11 min-w-11` (44×44px), preserving focus-visible rings and the separate Review/practice links. Added explicit, action-oriented **Bookmark game** and **Remove bookmark** translations in all five UI languages; left the existing `review.star` string in place for other consumers. Both tooltip and accessible name now use the same localized action. Did not modify shared design system or Game Review internals.
- Strengthened the component test and browser geometry assertions. Added a persisted synthetic bookmark response to the long international-player fixture. Actual Chromium keyboard flow now starts on the Review link, tabs to the bookmark, activates it with **Enter** and confirms `aria-pressed=true` and no accidental navigation; then focuses the independent Review link, presses **Enter**, and confirms navigation to `/review/9003`. Existing Starred-only pending/error/retry behavior remains covered.

### Verification

- Focused Library React tests: **45/45 passed**. Full repository suite: **109 files passed, 2 skipped; 1,058 tests passed, 12 skipped**, zero failures.
- `npm run typecheck`, `npm run build -w web`, `git diff --check`: passed. Isolated Chromium **1440px desktop, 390px and 320px mobile, light and dark** passed the complete import/discovery/Unicode/cursor/bookmark suite. Inspected `qa-artifacts/agent-c-library/library-long-player-names-light-320.png` and the 390/320px mobile screenshots; no card clipping, page overflow or JS exceptions.
- Changes stayed within Agent C's worktree. No production import, database, external provider, deployment or cross-agent files touched.

### Next independent audit

- Inspect **Library source and filter controls' accessible names and state synchronization** in languages other than English on narrow screens. The Library currently carries English-only filter `<select>` labels and fixture-specific hard-coded English locators; first reproduce any real a11y gap in a non-English browser fixture before implementing a localized, testable fix. Keep any changes Library-local and avoid shared navigation/localization infrastructure.

## 2026-11-12 — Localize Library filter accessible labels without changing filter state

- Resumed clean pushed `ada7e3f` and the outstanding five-select accessibility audit. Confirmed the source, speed, result, analyzed and sort controls were hard-coded with English `aria-label` strings regardless of the active language. Used `review.libraryFilterLabel.*` with translations in English, German, Spanish, Russian and Bulgarian, preserving the exact English names and a `defaultValue` for the existing component translation stub. No shared navigation or Game Review UI changed.
- Added locale coverage for all five filters across all five languages and real isolated Chromium with a **German-profile 390px dark-mode session**. Initially the new German scenario's fixture waited for an English discovery label, so it timed out despite correctly translated controls; corrected the test to await its synthetic history and opening independently of localized wording. The browser now verifies the five German accessible names, successful Lichess source selection through the actual `<select>`, preserved `source=lichess` query state, no JS errors and no horizontal overflow.

### Verification

- Focused Library+locales suite: **91 tests passed**. Full repository suite: **109 files passed, 2 skipped; 1,063 tests passed, 12 skipped**, zero failures. `npm run typecheck`, `npm run build -w web`, `git diff --check`: passed. Isolated Chromium passed the preexisting 1440px/390px/320px light/dark matrix and the added German 390px dark-mode filter scenario, along with existing import, practice, Unicode, cursor, starred-only and keyboard tests.
- Inspected `qa-artifacts/agent-c-library/library-german-filters-dark-390.png`. Existing **dropdown option text remains English** even when the filter accessible names are German. This is a separate, reproducible localization gap; the label-only change intentionally preserves option rendering and filter values.

### Next independent audit

- Fix the Library's **untranslated filter option choices** (e.g. "All sources", "Newest first") across all five languages, keeping enum values unchanged. Reproduce in German Chromium, provide localized option names, and verify a selection still updates the exact URL and backend query. Also inspect `Clear filters` and the Library's accessible filter-group label, which are currently English literals; keep all work within the Library lane.

## 2026-11-12 — Localize Library filter choices and keep narrow controls legible

- Recovered clean pushed `bfde1a5` and reproduced the next issue in the saved German 390px Chromium screenshot: the five filter *labels* had been translated, but every native `<select>` still displayed its English options. Wrote failing locale tests for all **20** static enum choices in **five** languages, plus the filter group's accessible name and **Clear filters** action. A pre-fix locale run had five failed tests, one per language.
- Added explicit `review.libraryFilterOptions` translations for source, speed, result, analysis status and sort, preserving the existing underlying option values and same `updateFilter`/URL flow. Localized the Library-only filter group (`role=group`) and reset button. Kept the original English labels as translation fallbacks for the existing component test stub. Updated synthetic Chromium selectors to use a stable in-scope `library-filters` element ID rather than depending on the English accessible name.
- Real German 390px Chromium verified the translated group, all five labels, native source option **Alle Quellen**, sort option **Neueste zuerst**, switching to Lichess (`source=lichess`) and clearing it without stale query state. Added 320px light-mode fixture to check first-screen search, geometry, overflow and native select text width. The first true-width test reproduced clipping: **Alle Bedenkzeiten** rendered 103px of text in roughly 92px of available select content width. Narrowed only that translation to **Alle Tempi**; reran Chromium and inspected the final 320px screenshot to confirm complete text without layout widening.

### Verification

- Focused component/locales tests: **96/96 passed**. Full repository suite: **109 passed files, 2 skipped; 1,068 passed tests, 12 skipped**, zero failures.
- `npm run typecheck`, `npm run build -w web`, `git diff --check`: passed. Isolated Chromium covered desktop 1440px and mobile 390/320px in light/dark plus German 390px dark and 320px light; complete existing import, Unicode, large-history cursor, keyboard, bookmark, error and source-filter scenarios passed. No horizontal overflow or browser JS errors. Visually inspected `qa-artifacts/agent-c-library/library-german-filters-firstfold-dark-390.png` and `qa-artifacts/agent-c-library/library-german-filters-light-320.png`.
- No Game Review internals, Play/Learn/Insights, global design system, other agents' worktrees, production data, deployments or external provider imports modified.

### Next independent audit

- Inspect **Library result-count and loading feedback** in the German mobile session. Current `40 of 620 Partien` mixes an English connective with German text; determine whether locale-specific count phrases can be shown without breaking pagination, loading/error announcements, English test expectations or translated number formats. Reproduce and fix within the Library page only.

## 2026-11-12 — Translate the complete Library result count and refresh announcement

- Resumed clean pushed `c02f596` and reproduced the documented English/German mixing: the Library count composed an English `of` between separately formatted numbers and the translated `games` noun, displaying **40 of 620 Partien** for German users. The live status also announced hard-coded English **Updating** to screen readers. Added a failing locale regression in all five languages for a complete count phrase with `{{visible}}` and `{{total}}` placeholders plus a translated refresh-announcement string.
- Added `review.libraryVisibleCount` and `review.libraryUpdating` in English, German, Spanish, Russian and Bulgarian. Each language now owns the whole count phrasing rather than interpolating English connectors. German displays **Partien: 40 von 620**, which stays grammatical even for single-game libraries. Visible and total counts continue to come directly from the authenticated paginated response; formatting uses the active UI locale, with the existing English component-stub fallback preserved. No paging/filter/API logic changed.
- Expanded the synthetic 390px German Chromium scenario to wait for the exact translated count. Rechecked the existing 320px light mobile fixture, opening discovery, native source filtering and filter reset. Inspected `qa-artifacts/agent-c-library/library-german-count-dark-390.png` and confirmed the mixed-language counter is gone and there is no layout shift.

### Verification

- Focused Library+locales tests: **101/101 passed**. Full repository suite: **109 passed files, 2 skipped; 1,073 tests passed, 12 skipped**, zero failures.
- `npm run typecheck`, `npm run build -w web`, `git diff --check`: passed. Isolated Chromium passed 1440px desktop and 390/320px mobile in light/dark, plus 390px dark and 320px light German, including previous import, keyboard, Unicode, cursor, bookmark and source-selection tests. No browser JavaScript exceptions or horizontal overflow.
- All changes remained isolated to the Library page, its translations, regression tests and this durable progress report. No production services/data, providers, Game Review internals, other agents, merge or deployment touched.

### Next independent audit

- Inspect **localized Game Library card actions on desktop**: the unanalyzed-game card currently shows the literal English badge text `review` next to the book icon in every locale, even though the card itself navigates by a separate accessible link. Reproduce in a non-English desktop fixture, decide whether it should be a descriptive translated status or a translated action, and verify keyboard/screen-reader clarity without changing Game Review internals.
