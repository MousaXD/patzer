#!/usr/bin/env bash
# Explicit, local-only Batch 3 + PR #17 release gates. This script NEVER
# commits, pushes, deploys, restarts Patzer or opens the production database.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(basename "$ROOT")" != '.patzer-cert-pr17-20261111' ]]; then
  echo 'Refusing to test an unexpected checkout. Use the isolated PR17 certification worktree.' >&2
  exit 2
fi

ENGINE="${PATZER_TEST_STOCKFISH:-${STOCKFISH_PATH:-$HOME/projects/my-creations/chess/patzer/bin/stockfish}}"
QA="$HOME/projects/my-creations/game/.patzer-benchmark-agent-d-20261111"
if [[ ! -x "$ENGINE" || ! -f "$QA/scripts/review-benchmark-batch3-aba.mjs" ]]; then
  echo 'Stockfish or the independent QA runner is unavailable. Cannot certify release.' >&2
  exit 2
fi

echo '=== Verify clean patch syntax and exact worktree ==='
git status --short --branch
git diff --check

echo '=== TypeScript ==='
npm run typecheck

echo '=== Release-blocker regressions: database, Hono and scoring backfill ==='
npx vitest run --maxWorkers=2 \
  server/test/review-cache-race.test.ts \
  server/test/review-source-hono.test.ts \
  server/test/review-source-integrity.test.ts \
  server/test/analysis-source-integrity.test.ts \
  server/test/analysis-source-routes.test.ts \
  server/test/accuracy-aggregation-regression.test.ts \
  server/test/insights-full-history.test.ts \
  server/test/insights-move-quality.test.ts \
  server/test/platform-backend.test.ts \
  server/test/platform-backend-scale.test.ts \
  web/src/components/review/reviewSource.test.ts

echo '=== Full source suite ==='
npx vitest run --maxWorkers=2

echo '=== Production compile and bundle ==='
npm run build

echo '=== MCP fake-server integration ==='
node integrations/mcp/test.mjs

echo '=== Real Chromium blind-practice and report source lifecycle ==='
STOCKFISH_PATH="$ENGINE" PATZER_TEST_STOCKFISH="$ENGINE" \
  node web/tests/review-practice.browser.mjs

echo '=== Independent real Hono + SQLite + Stockfish A -> B -> A regression ==='
(
  cd "$QA"
  PATZER_TEST_STOCKFISH="$ENGINE" \
    node --import tsx scripts/review-benchmark-batch3-aba.mjs "$ROOT"
)

echo 'All script-owned release checks passed. Separate migration rehearsal,'
echo 'negative-control reinsertion, exact-head CI and production authorization'
echo 'are STILL REQUIRED before a merge to main.'
