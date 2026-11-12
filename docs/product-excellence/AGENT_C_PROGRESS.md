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
