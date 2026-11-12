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
