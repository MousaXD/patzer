# Agent C — Game Library, Imports and Exploration

## 2026-11-12 — First improvement (isolated branch)

- Base: `origin/feat/review-polish-product-excellence-20261111` at `5b5fe22`.
- Worktree: `/game/patzer-agent-library-20261112`.
- Scope: `web/src/pages/Review.tsx` and library regression tests; no Review internals, global shell, production service or database touched.

### Observed issues and verified implementation

1. The game list API already implements `source`, `time_class`, `result`, `analyzed`, and `sort`, but library visitors could only search text or show bookmarks. Added accessible, URL-persistent controls for all five server-side fields. The query cache key now distinguishes each filter combination so cached pages never leak between searches. Unknown deep-link values are constrained to supported options.
2. Manual imports always requested only 20 recent games despite each provider route supporting up to 200 per request. Added a 20/100/200 selector, defaulting to 200, with explicit recent-history language and a result message that distinguishes new games from retrieved games. The UI does **not** claim a complete import of a larger history.
3. Added tests for deep-link filter/query propagation and bounded import feedback.

### Verification

- `npm test -- web/src/pages/Review.library.test.tsx`: **15 passed**.
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
