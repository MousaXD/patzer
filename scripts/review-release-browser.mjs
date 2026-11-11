#!/usr/bin/env node
// Independent combined-app source test: real Chromium, HTTP/SSE, SQLite and
// bounded Stockfish. Only the optional model is a local, deliberately held HTTP
// server. No browser routes or product functions are replaced.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const scratch = mkdtempSync(join(tmpdir(), 'patzer-independent-browser-'));
assert(process.env.PATZER_TEST_STOCKFISH, 'Set PATZER_TEST_STOCKFISH to a bounded local engine');
Object.assign(process.env, { DB_PATH: join(scratch, 'test.db'), HOST: '127.0.0.1',
  PORT: process.env.PATZER_RELEASE_QA_PORT || '8899', SESSION_SECRET: 'synthetic-release-browser-only',
  OIDC_ISSUER: '', OIDC_CLIENT_ID: '', ENGINE_BACKEND: 'local', STOCKFISH_THREADS: '1',
  STOCKFISH_HASH: '16', STOCKFISH_PATH: process.env.PATZER_TEST_STOCKFISH, UPDATE_CHECK: '0' });
const base = `http://127.0.0.1:${process.env.PORT}`;
let browser, db, model, held = [], calls = 0;
const until = async (test, message) => {
  for (let i = 0; i < 100; i++) { if (await test()) return; await sleep(50); }
  throw new Error(message);
};
try {
  ({ db } = await import('../server/dist/db.js'));
  const { setSetting } = await import('../server/dist/db.js');
  const { analyzePgn, saveAnalysis } = await import('../server/dist/routes/analyze.js');
  const { loadAnalysisGameSource } = await import('../server/dist/chess/analysisSource.js');
  const { buildGameReview } = await import('../server/dist/coach/review.js');
  const { saveReviewIfFresh } = await import('../server/dist/coach/reviewCache.js');
  const { createSession } = await import('../server/dist/auth/sessions.js');
  db.prepare("INSERT INTO users(id,username,password_hash,role) VALUES(1,'synthetic','unused','admin')").run();
  db.prepare("INSERT INTO profiles(user_id,display_name,language,audience) VALUES(1,'QA','en','beginner')").run();
  const A = '1. f3 e5 2. g4 Qh4# 0-1';
  const B = '1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0';
  const analysisA = await analyzePgn(A, 8), analysisB = await analyzePgn(B, 8);
  const save = (id, result) => assert.equal(saveAnalysis(id, result, loadAnalysisGameSource(db, id)), true);
  for (const id of [1, 2, 3]) {
    db.prepare("INSERT INTO games(id,user_id,source,pgn,result,user_color) VALUES(?,1,'imported',?,'loss','white')").run(id, A);
    save(id, analysisA);
  }
  const review = await buildGameReview({ pgn: A, analysis: analysisA,
    language: 'en', audience: 'beginner', userColor: 'white', llmEnabled: false });
  review.summary = 'INDEPENDENT_OLD_BLACK_MATE_REPORT';
  const game = db.prepare(`SELECT *,source_revision AS current_source_revision FROM games WHERE id=1`).get();
  const row = db.prepare('SELECT * FROM analyses WHERE game_id=1').get();
  assert.equal(saveReviewIfFresh(db, 1, row, game, review, 'en', 'beginner', true), true);
  const legacy = JSON.stringify({ ...review, summary: 'LEGACY_HISTORY_MUST_BE_PRESERVED' });
  db.prepare(`UPDATE analyses SET source_hash=NULL,source_revision=NULL,analysis_generation=0,
    prose_json=? WHERE game_id=3`).run(legacy);
  await import('../server/dist/index.js');
  await sleep(300);
  const token = createSession(1), cookie = `chess_session=${token}`;
  const get = async (id) => (await fetch(`${base}/api/games/${id}/review`, { headers: { Cookie: cookie } })).json();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addCookies([{ name: 'chess_session', value: token, url: base }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let unexpectedAnalysis = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/analyze')) unexpectedAnalysis++;
  });
  await page.goto(`${base}/review/3`);
  await page.getByRole('button', { name: 'Run engine analysis', exact: true }).waitFor();
  await page.getByText('This saved analysis needs updating.', { exact: false }).waitFor();
  await sleep(900);
  assert.equal(unexpectedAnalysis, 0, 'Opening legacy evidence must not silently replace it');
  assert.equal(db.prepare('SELECT prose_json FROM analyses WHERE game_id=3').get().prose_json, legacy);
  assert.equal(await page.getByText('LEGACY_HISTORY_MUST_BE_PRESERVED', { exact: true }).count(), 0);
  console.log('PASS independent Chromium: legacy analysis requires explicit action and retains historical prose');
  await page.goto(`${base}/review/1`);
  await page.getByRole('tab', { name: 'AI report' }).click();
  await page.getByText(review.summary, { exact: true }).waitFor();
  const digest = (await get(1)).review.source_integrity;
  await page.getByRole('button', { name: 'Star', exact: true }).click();
  await page.getByRole('button', { name: 'Starred', exact: true }).waitFor();
  assert.equal((await get(1)).review.source_integrity, digest);
  assert.equal(await page.getByText(review.summary, { exact: true }).count(), 1);
  console.log('PASS independent Chromium: cold-load cache and harmless bookmark preserve verified prose');
  db.prepare('UPDATE games SET pgn=?,result=? WHERE id=1').run(B, 'win');
  save(1, analysisB);
  await page.getByRole('button', { name: 'Starred', exact: true }).click();
  await page.getByText('The game changed. Reanalyze it to generate an updated report.').waitFor();
  assert.equal(await page.getByText(review.summary, { exact: true }).count(), 0);
  assert.equal((await get(1)).review, null);
  await page.getByRole('button', { name: 'Write AI report' }).click();
  await until(async () => !!(await get(1)).review, 'Fresh report did not persist');
  assert.notEqual((await get(1)).review.source_integrity, digest);
  await page.reload();
  await page.getByRole('tab', { name: 'AI report' }).click();
  await page.getByText((await get(1)).review.summary, { exact: true }).waitFor();
  assert.equal(await page.getByText(review.summary, { exact: true }).count(), 0);
  console.log('PASS independent Chromium: same-game fresh engine refetch removes old prose and cold reload reads new report');
  model = createServer((req, res) => {
    req.resume();
    if (req.method === 'GET') { res.end(JSON.stringify({ data: [{ id: 'qa-held-model' }] })); return; }
    calls++; held.push(res);
  });
  await new Promise((resolve) => model.listen(0, '127.0.0.1', resolve));
  setSetting('llm_provider', 'vllm'); setSetting('vllm_model', 'qa-held-model');
  setSetting('vllm_url', `http://127.0.0.1:${model.address().port}`);
  await page.goto(`${base}/review/2`);
  await page.getByRole('tab', { name: 'AI report' }).click();
  await page.getByRole('button', { name: 'Write AI report' }).click();
  await until(() => held.length > 0, 'No real model request was held');
  await page.getByRole('button', { name: 'Star', exact: true }).click();
  await page.getByRole('button', { name: 'Starred', exact: true }).waitFor();
  await sleep(900);
  assert.equal(held[0].destroyed, false, 'Metadata should preserve the active real model request');
  db.prepare('UPDATE games SET pgn=?,result=? WHERE id=2').run(B, 'win'); save(2, analysisB);
  await page.getByRole('button', { name: 'Starred', exact: true }).click();
  await page.getByText('The game changed. Reanalyze it to generate an updated report.').waitFor();
  await until(() => held.every((res) => res.destroyed), 'Obsolete model HTTP connection survived source refresh');
  assert.equal((await get(2)).review, null);
  assert.equal(calls, 1, 'Canceled model call must not retry');
  assert.equal(await page.getByText('review_source_changed', { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS independent Chromium: source refresh aborts real model HTTP/SSE, no stale write or retry; zero page errors');
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  await browser?.close();
  for (const res of held) res.destroy();
  model?.closeAllConnections(); model?.close();
  db?.close(); rmSync(scratch, { recursive: true, force: true });
}
// The app owns background timers and its server; terminate this isolated runner.
process.exit(process.exitCode || 0);
