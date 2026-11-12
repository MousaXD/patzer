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
