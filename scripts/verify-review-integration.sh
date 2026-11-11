#!/usr/bin/env bash
# Explicit, local-only Batch 3 + PR #17 release gates. This script NEVER
# commits, pushes, deploys, restarts Patzer or opens the production database.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENGINE="${PATZER_TEST_STOCKFISH:-${STOCKFISH_PATH:-$ROOT/bin/stockfish}}"
if [[ ! -x "$ENGINE" ]]; then
  echo 'Stockfish or the independent QA runner is unavailable. Cannot certify release.' >&2
  exit 2
fi
export PATZER_TEST_STOCKFISH="$ENGINE" STOCKFISH_PATH="$ENGINE"
export STOCKFISH_THREADS=1 STOCKFISH_HASH=16
export PATZER_PRACTICE_QA_ARTIFACTS="${PATZER_PRACTICE_QA_ARTIFACTS:-$ROOT/qa/review-excellence/results/release-browser}"

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
node scripts/review-release-browser.mjs

echo '=== Independent real Hono + SQLite + Stockfish A -> B -> A regression ==='
node --import tsx scripts/review-benchmark-batch3-aba.mjs "$ROOT"
node --import tsx scripts/review-benchmark-batch3-fixed-behavior.mjs "$ROOT"
node --import tsx scripts/review-release-concurrent.mjs --app-root="$ROOT" \
  --engine="$ENGINE" --engine-sha256="$(sha256sum "$ENGINE" | cut -d ' ' -f1)"

echo '=== Synthetic schema, score migration, interruption and rollback ==='
node scripts/test-review-migration.mjs

echo 'All script-owned release checks passed. Negative-control reinsertion,'
echo 'exact-head CI and production rollout review'
echo 'are STILL REQUIRED before a merge to main.'
