/**
 * Game Review blind practice — reproducible real Chromium + local Stockfish QA.
 * Requires a built app, Playwright/Chromium and STOCKFISH_PATH or configured engine.
 * All accounts, games and analyses are generated in a disposable SQLite database.
 * Run: STOCKFISH_PATH=/path/to/stockfish node web/tests/review-practice.browser.mjs
 * Never reads .env, copies the live DB or connects to the running Patzer service.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { Chess } from 'chess.js';

const artifacts = resolve(process.env.PATZER_PRACTICE_QA_ARTIFACTS || 'qa-artifacts/review-practice-browser');
const tempRoot = mkdtempSync(join(tmpdir(), 'patzer-blind-practice-'));
const port = Number(process.env.PATZER_PRACTICE_QA_PORT || 8898);
const base = `http://127.0.0.1:${port}`;
process.env.PORT = String(port);
process.env.HOST = '127.0.0.1';
process.env.DB_PATH = join(tempRoot, 'practice-qa.db');
mkdirSync(artifacts, { recursive: true });
const results = [];
const browserErrors = [];
let browser;
let db;

async function test(name, fn) {
  try { await fn(); results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`); }
  catch (error) {
    results.push({ name, status: 'FAIL', error: String(error?.stack || error) });
    console.error(`FAIL ${name}: ${String(error?.stack || error)}`);
  }
}
async function api(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json',
      ...(method === 'GET' ? {} : { 'X-Requested-With': 'patzer' }),
      ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(120_000),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
function seed(userId, name, sans, classifications, partialLength = sans.length, fen) {
  const chess = new Chess(fen);
  if (fen) { chess.setHeader('SetUp', '1'); chess.setHeader('FEN', fen); }
  const analyzed = [];
  for (const san of sans) {
    const before = chess.fen();
    const m = chess.move(san);
    assert.ok(m, `legal synthetic move ${san}`);
    analyzed.push({ ply: analyzed.length + 1, san: m.san,
      uci: m.from + m.to + (m.promotion ?? ''), fen_before: before, fen_after: chess.fen(),
      eval_before_cp: 0, eval_after_cp: 0, classification: classifications[analyzed.length] || 'good',
      centipawn_loss: 0, best_move_uci: m.from + m.to + (m.promotion ?? ''),
      best_move_san: m.san, best_pv: [], });
  }
  const pgn = chess.pgn();
  const id = Number(db.prepare("INSERT INTO games (user_id,source,external_id,pgn,white,black,result,time_control,end_time,user_color) VALUES (?, 'imported', ?, ?, 'QA White', 'QA Black', '1-0', '600', datetime('now'), 'white')")
    .run(userId, name, pgn).lastInsertRowid);
  const scored = analyzed.slice(0, partialLength);
  db.prepare('INSERT INTO analyses (game_id,depth,moves_json,accuracy_white,accuracy_black,scoring_version) VALUES (?,12,?,83,85,?)')
    .run(id, JSON.stringify(scored), scoringVersion);
  return { id, pgn, analyzed: scored };
}
let scoringVersion;
async function logIn(context) {
  const page = await context.newPage();
  page.on('pageerror', (error) => browserErrors.push(`${page.url()}: ${error.message}`));
  await page.goto(base + '/login');
  await page.locator('#login-username').fill('qaadmin');
  await page.locator('#login-password').fill('qa-password-123');
  await page.locator('#login-password').press('Enter');
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 15000 });
  return page;
}
async function openPicker(page, id) {
  await page.goto(`${base}/review/${id}?practice=1`);
  await page.locator('[data-practice-picker]').waitFor({ timeout: 15000 });
}
async function startBlind(page, id, number = 1) {
  await openPicker(page, id);
  await page.getByRole('button', { name: new RegExp(`Practice moment ${number}`) }).click();
  await page.locator('[data-practice-mode]').waitFor({ timeout: 15000 });
}
async function assertNoSpoilers(page) {
  assert.equal(await page.locator('[data-review-workspace], [data-review-side-rail], [data-move-transport]').count(), 0);
  assert.equal(await page.getByText(/Engine-preferred move:|Blue arrow:|Suggested continuation:|Engine assessment:/).count(), 0);
  assert.equal(await page.locator('[role="img"][aria-label^="Evaluation"]').count(), 0);
  assert.equal(await page.locator('cg-board [cg-shapes]').count(), 0);
}
async function assertLayout(page) {
  const dims = await page.evaluate(() => {
    const board = document.querySelector('cg-board');
    const r = board?.getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      boardWidth: r?.width ?? 0, boardHeight: r?.height ?? 0, viewport: window.innerWidth,
      left: r?.left ?? -1, right: r?.right ?? -1 };
  });
  assert.ok(dims.overflow <= 2, `horizontal overflow ${JSON.stringify(dims)}`);
  assert.ok(dims.boardWidth > 150 && Math.abs(dims.boardWidth - dims.boardHeight) < 3, `bad square ${JSON.stringify(dims)}`);
  assert.ok(dims.left >= 0 && dims.right <= dims.viewport + 2, `offscreen board ${JSON.stringify(dims)}`);
}
async function tapSquare(page, square) {
  const board = page.locator('cg-board');
  await board.scrollIntoViewIfNeeded();
  const rect = await board.boundingBox();
  assert.ok(rect && rect.width > 150, 'touch board visible');
  const x = rect.x + ('abcdefgh'.indexOf(square[0]) + 0.5) * rect.width / 8;
  const y = rect.y + (8.5 - Number(square[1])) * rect.height / 8;
  await page.touchscreen.tap(x, y);
}

try {
  await import('../../server/dist/index.js');
  await sleep(750);
  assert.equal((await api('/api/health')).status, 200);
  const account = await api('/api/setup/init', { method: 'POST', body: {
    username: 'qaadmin', password: 'qa-password-123', display_name: 'Practice QA', language: 'en',
  } });
  assert.equal(account.status, 200);
  const cookie = account.cookie;
  assert.ok(cookie, 'session cookie');
  db = (await import('../../server/dist/db.js')).db;
  scoringVersion = (await import('../../server/dist/chess/classifier.js')).SCORING_VERSION;
  const user = db.prepare("SELECT id FROM users WHERE username='qaadmin'").get();
  const standard = seed(user.id, 'standard', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'd3', 'Bc5'],
    ['book', 'book', 'good', 'best', 'mistake', 'good', 'inaccuracy', 'blunder']);
  const partial = seed(user.id, 'partial', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
    ['good', 'mistake', 'good', 'blunder', 'blunder'], 2);
  // Adversarial presentation-only fixture: intentionally labels a mate-in-one
  // as a missed moment to test that SAN '#' is NEVER exposed before the
  // player's attempt. This is not a gold engine classification or benchmark.
  const beforeMate = new Chess();
  for (const san of ['f3', 'e5', 'g4']) beforeMate.move(san);
  const mateLeakFixture = seed(user.id, 'spoiler-negative-control', ['Qh4#'], ['miss'], 1, beforeMate.fen());
  const baselinePgn = db.prepare('SELECT pgn FROM games WHERE id=?').get(standard.id).pgn;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const page = await logIn(context);

  await test('Library entry is independently spoiler free', async () => {
    await page.goto(base + '/review');
    const link = page.locator(`a[href="/review/${standard.id}?practice=1"]`);
    await link.waitFor();
    assert.match(await link.getAttribute('aria-label'), /Practice mistakes in QA White versus QA Black without spoilers/);
    assert.equal(new URL(await link.getAttribute('href'), base).searchParams.get('practice'), '1');
    await link.click();
    await page.locator('[data-practice-picker]').waitFor();
    await page.waitForTimeout(150); // Allow router commit/focus effects, not a blind arbitrary navigation wait.
    const initialFocus = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      text: document.activeElement?.textContent?.trim().slice(0, 90),
    }));
    assert.deepEqual(initialFocus, { tag: 'H1', text: 'Practice without spoilers' },
      'Entering the blind picker must announce its heading instead of leaving keyboard focus in the old library');
    assert.equal(await page.locator('[data-practice-mode]').count(), 0);
    await assertNoSpoilers(page);
    assert.equal(await page.getByRole('button', { name: /Practice moment/ }).count(), 3);
  });

  await test('Browser Back returns from an active blind attempt to the spoiler-free picker', async () => {
    await page.goto(base + '/review');
    await page.locator(`a[href="/review/${standard.id}?practice=1"]`).click();
    await page.locator('[data-practice-picker]').waitFor();
    await page.getByRole('button', { name: /Practice moment 1/ }).click();
    await page.locator('[data-practice-mode]').waitFor();
    await assertNoSpoilers(page);
    await page.goBack();
    await page.locator('[data-practice-picker]').waitFor({ timeout: 3000 });
    assert.equal(new URL(page.url()).searchParams.get('practice'), '1');
    await assertNoSpoilers(page);
    await page.waitForFunction(() => document.activeElement?.id === 'practice-picker-heading',
      null, { timeout: 2500 });
    await page.goForward();
    await page.locator('[data-practice-mode]').waitFor({ timeout: 3000 });
    await assertNoSpoilers(page);
    assert.equal(await page.locator('#practice-move-input').count(), 1);
    await page.getByRole('button', { name: 'Back to practice choices' }).click();
    await page.locator('[data-practice-picker]').waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'practice-move-5');
    await assertNoSpoilers(page);
    await page.goBack();
    await page.waitForURL((url) => url.pathname === '/review' && !url.searchParams.has('practice'),
      { timeout: 3000 });
  });

  await test('Direct attempt links and invalid practice plies fail closed without requiring prior history', async () => {
    await page.goto(`${base}/review/${standard.id}?practice=1&practicePly=5`);
    await page.locator('[data-practice-mode]').waitFor();
    await assertNoSpoilers(page);
    await page.getByRole('button', { name: 'Back to practice choices' }).click();
    await page.locator('[data-practice-picker]').waitFor();
    assert.equal(new URL(page.url()).searchParams.has('practicePly'), false);
    await page.waitForFunction(() => document.activeElement?.id === 'practice-move-5');
    await page.goto(`${base}/review/${standard.id}?practice=1&practicePly=999999`);
    await page.getByText('Practice position unavailable').waitFor();
    await assertNoSpoilers(page);
    await page.getByRole('button', { name: 'Back to practice choices' }).click();
    await page.locator('[data-practice-picker]').waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'practice-picker-heading');
    assert.equal(new URL(page.url()).searchParams.has('practicePly'), false);
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(standard.id).pgn, baselinePgn);
  });

  await test('Browser Back cancels an in-flight attempt and Forward starts a fresh blind retry', async () => {
    await page.goto(base + '/review');
    await page.locator(`a[href="/review/${standard.id}?practice=1"]`).click();
    await page.getByRole('button', { name: /Practice moment 1/ }).click();
    await page.locator('[data-practice-mode]').waitFor();
    let received;
    const requestReceived = new Promise((resolve) => { received = resolve; });
    let calls = 0;
    await page.route('**/api/analyze/variation-move', async (route) => {
      calls++;
      received();
      await sleep(1300);
      await route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ error: 'obsolete_attempt_must_not_appear' }) }).catch(() => undefined);
    });
    try {
      await page.locator('#practice-move-input').fill('d4');
      await page.getByRole('button', { name: 'Submit move' }).click();
      await requestReceived;
      await page.goBack();
      await page.locator('[data-practice-picker]').waitFor();
      await sleep(1400);
      await assertNoSpoilers(page);
      assert.equal(calls, 1);
      await page.goForward();
      await page.locator('[data-practice-mode]').waitFor();
      await assertNoSpoilers(page);
      assert.equal(await page.locator('#practice-move-input').count(), 1);
      assert.equal(await page.getByText(/Engine assessment:|The engine could not score/).count(), 0);
      assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(standard.id).pgn, baselinePgn);
    } finally { await page.unroute('**/api/analyze/variation-move'); }
  });

  await test('Blind picker does not fetch AI prose, coach config or hidden engine work', async () => {
    const requests = [];
    const onRequest = (request) => requests.push({ path: new URL(request.url()).pathname, method: request.method() });
    page.on('request', onRequest);
    try {
      await openPicker(page, standard.id);
      await sleep(300);
      const hiddenWork = requests.filter(({ path, method }) =>
        path === `/api/games/${standard.id}/review`
        || path === '/api/coach/status'
        || path === '/api/coach/explain'
        || (method === 'POST' && path.startsWith('/api/analyze')));
      assert.deepEqual(hiddenWork, [], 'the blind picker requested answer-bearing or unrelated background work');
      await page.getByRole('button', { name: /Open full game review/ }).click();
      await page.locator('[data-analysis-workspace]').waitFor();
      await page.waitForFunction(() => document.activeElement?.id === 'full-game-review-heading',
        null, { timeout: 2000 });
      await page.waitForFunction((id) => performance.getEntriesByType('resource')
        .some((entry) => entry.name.includes(`/api/games/${id}/review`)), standard.id, { timeout: 8000 });
      assert.ok(requests.some(({ path }) => path === `/api/games/${standard.id}/review`),
        'full review did not resume cached AI prose loading');
    } finally { page.off('request', onRequest); }
  });

  await test('Stale analysis is never practiced or silently reanalyzed in blind mode', async () => {
    const sent = [];
    const onRequest = (request) => sent.push({ path: new URL(request.url()).pathname, method: request.method() });
    await page.route(`**/api/games/${standard.id}`, async (route) => {
      const response = await route.fetch();
      const original = await response.json();
      await route.fulfill({ response, json: { ...original, analysis_stale: true } });
    });
    page.on('request', onRequest);
    try {
      await openPicker(page, standard.id);
      await page.getByText(/Saved analysis is out of date/).waitFor();
      assert.equal(await page.getByRole('button', { name: /Practice moment/ }).count(), 0);
      await sleep(300);
      assert.equal(sent.filter(({ path, method }) => method === 'POST' && path === '/api/analyze').length, 0);
      assert.equal(sent.filter(({ path }) => path === `/api/games/${standard.id}/review`).length, 0);
    } finally {
      page.off('request', onRequest);
      await page.unroute(`**/api/games/${standard.id}`);
    }
  });

  await test('Bookmarked-game refetch becoming stale must not start engine work during an active retry', async () => {
    // An in-review bookmark mutation legitimately invalidates this exact
    // React Query game key. Delay the refreshed response until the player has
    // entered practice and mark ONLY that returned snapshot as stale.
    await page.goto(`${base}/review/${standard.id}?ply=5`);
    await page.locator('[data-analysis-workspace]').waitFor();
    let staleResponses = 0;
    let hiddenAnalysisPosts = 0;
    await page.route(`**/api/games/${standard.id}`, async (route) => {
      const response = await route.fetch();
      const original = await response.json();
      staleResponses++;
      await sleep(750);
      await route.fulfill({ response, json: { ...original, analysis_stale: true } });
    });
    await page.route('**/api/analyze', (route) => {
      hiddenAnalysisPosts++;
      return route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ error: 'blind_stale_refresh_must_not_analyze' }) });
    });
    try {
      await page.getByRole('button', { name: 'Star', exact: true }).click();
      await page.locator('#learn-from-mistake').click();
      await page.locator('[data-practice-mode]').waitFor();
      await page.getByText('Practice position unavailable').waitFor({ timeout: 6000 });
      await page.waitForFunction(() => document.activeElement?.id === 'practice-unavailable-heading',
        null, { timeout: 2500 });
      await sleep(300);
      assert.ok(staleResponses >= 1, 'bookmark must trigger a real game-detail refetch');
      assert.equal(hiddenAnalysisPosts, 0,
        'stale refetch silently started expensive full-game analysis behind a hidden retry');
      assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(standard.id).pgn, baselinePgn);
      await page.getByRole('button', { name: 'Return to saved game' }).click();
      await page.locator('[data-analysis-workspace]').waitFor();
      await page.waitForFunction(() => document.activeElement?.id === 'full-game-review-heading',
        null, { timeout: 2500 });
      await page.getByText('Engine analysis could not finish. Retry when Stockfish is available.').waitFor();
      assert.equal(hiddenAnalysisPosts, 1,
        'leaving a blind retry should resume one ordinary stale-analysis attempt, without an unbounded retry loop');
    } finally {
      await page.unroute(`**/api/games/${standard.id}`);
      await page.unroute('**/api/analyze');
    }
  });

  await test('Entering a retry cancels in-flight full-game reanalysis and restores controls', async () => {
    await page.goto(`${base}/review/${standard.id}?ply=5`);
    await page.locator('[data-analysis-workspace]').waitFor();
    // The localized accessible name is "Depth" in English; locate the
    // unique expansion control within the Review tablist instead of relying
    // on a fallback translation that is never shown in this locale.
    await page.locator('[role="tablist"][aria-label="Review detail sections"] button[aria-expanded]').click();
    const depthCard = page.locator('#review-analysis-depth').locator('..');
    await page.route('**/api/analyze', async (route) => {
      await sleep(1200);
      await route.fulfill({
        status: 503, contentType: 'application/json',
        body: JSON.stringify({ error: 'late_engine_failure_negative_control' }),
      }).catch(() => undefined);
    });
    try {
      await depthCard.getByRole('button').click();
      await page.locator('#learn-from-mistake').click();
      await page.locator('[data-practice-mode]').waitFor();
      await page.getByRole('button', { name: 'Return to saved game' }).click();
      await page.locator('[data-analysis-workspace]').waitFor();
      assert.equal(await depthCard.getByRole('button').isEnabled(), true,
        'abandoned full-game analysis left the Review button locked');
      await sleep(1300);
      assert.equal(await page.getByText('Engine analysis could not finish. Retry when Stockfish is available.').count(), 0,
        'late failure from a canceled analysis surfaced in Review');
    } finally { await page.unroute('**/api/analyze'); }
  });

  await test('Blind keyboard selector never reveals mate SAN before committing a move', async () => {
    await startBlind(page, mateLeakFixture.id);
    await assertNoSpoilers(page);
    await page.getByText('Read board position as text').click();
    const boardAsText = page.getByText('Read board position as text').locator('..');
    const readableBefore = await boardAsText.innerText();
    assert.match(readableBefore, /Black to move/);
    assert.match(readableBefore, /Pawn on g4/);
    assert.match(readableBefore, /Queen on d8/);
    assert.ok(!readableBefore.includes('Qh4#'), 'text-only position revealed a future mate');
    await page.getByText(/Or choose a piece and destination/).click();
    const optionsBefore = await page.locator('option').allTextContents();
    assert.ok(optionsBefore.every((label) => !/[+#]/.test(label)), 'an accessible option exposed check or mate');
    assert.ok(!(await page.locator('[data-practice-mode]').innerText()).includes('Qh4#'), 'the answer was shown before attempting');
    await page.locator('#practice-from').selectOption('d8');
    const optionsAfter = await page.locator('#practice-to option').allTextContents();
    assert.ok(optionsAfter.includes('h4'), 'legal queen destination omitted');
    assert.ok(optionsAfter.every((label) => !/[+#]/.test(label)), 'destination leaked mate');
    await page.locator('#practice-to').selectOption('h4');
    assert.ok(!(await page.locator('[data-practice-mode]').innerText()).includes('Qh4#'), 'the answer leaked after choosing a destination');
    await page.route('**/api/analyze/variation-move', (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'offline_negative_control' }),
    }));
    try {
      await page.getByRole('button', { name: 'Play chosen move' }).click();
      await page.getByText(/Your move:/).waitFor();
      assert.match(await page.locator('[data-practice-mode]').innerText(), /Qh4#/);
      const readableAfter = await boardAsText.innerText();
      assert.match(readableAfter, /White to move, in check/);
      assert.match(readableAfter, /Queen on h4/);
      await page.getByText(/could not score this attempt/).waitFor();
      assert.equal(await page.getByText(/Engine assessment:/).count(), 0);
    } finally { await page.unroute('**/api/analyze/variation-move'); }
  });

  await test('Independent attempt, keyboard SAN, real Stockfish feedback, saved PGN unchanged', async () => {
    await startBlind(page, standard.id);
    await assertNoSpoilers(page);
    await page.locator('#practice-move-input').fill('e7e5');
    await page.getByRole('button', { name: 'Submit move' }).click();
    assert.match(await page.getByRole('alert').textContent(), /not legal/);
    await page.locator('#practice-move-input').fill('d4');
    await page.getByRole('button', { name: 'Submit move' }).click();
    assert.equal(await page.locator('#practice-move-input').count(), 0);
    await page.getByText(/Engine assessment:/).waitFor({ timeout: 120_000 });
    assert.equal(await page.getByText(/Engine-preferred move:/).count(), 1);
    assert.equal((await api(`/api/games/${standard.id}`, { cookie })).json?.game.pgn, baselinePgn);
    await page.getByRole('button', { name: 'Back to practice choices' }).click();
    await page.locator('[data-practice-picker]').waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'practice-move-5');
    await assertNoSpoilers(page);
  });

  await test('Original game remains immutable after repeated attempts and game switch', async () => {
    await startBlind(page, standard.id);
    await page.getByText(/Or choose a piece and destination/).click();
    await page.locator('#practice-from').selectOption('d2');
    await page.locator('#practice-to').selectOption('d4');
    await page.getByRole('button', { name: 'Play chosen move' }).click();
    await page.getByText(/Engine assessment:/).waitFor({ timeout: 120_000 });
    await page.getByRole('button', { name: 'Try another move' }).click();
    await page.getByText(/Or choose a piece and destination/).click();
    await page.locator('#practice-move-input').fill('Nf3');
    // Nf3 is illegal because the knight was already moved on the saved timeline.
    await page.getByRole('button', { name: 'Submit move' }).click();
    assert.match(await page.getByRole('alert').textContent(), /not legal/);
    await openPicker(page, partial.id);
    await assertNoSpoilers(page);
    assert.equal(await page.getByRole('button', { name: /Practice moment/ }).count(), 1);
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(standard.id).pgn, baselinePgn);
  });

  await test('Busy and mismatched engine responses give honest retries, never a fabricated score', async () => {
    await startBlind(page, standard.id);
    let calls = 0;
    await page.route('**/api/analyze/variation-move', async (route) => {
      calls++;
      if (calls === 1) {
        await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'engine_busy' }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ quality: {
          source: 'variation', fen_before: 'wrong-position', fen_after: 'wrong-position', uci: 'd2d4',
          classification: 'best', eval_before_cp: 0, eval_after_cp: 0,
        } }) });
      }
    });
    try {
      await page.locator('#practice-move-input').fill('d4');
      await page.getByRole('button', { name: 'Submit move' }).click();
      await page.getByText(/The engine is busy/).waitFor({ timeout: 15000 });
      assert.equal(await page.getByText(/Engine assessment:/).count(), 0);
      await page.getByRole('button', { name: 'Retry scoring' }).click();
      await page.getByText(/did not match your attempt/).waitFor({ timeout: 15000 });
      assert.equal(await page.getByText(/Engine assessment:/).count(), 0);
      assert.equal(calls, 2);
    } finally { await page.unroute('**/api/analyze/variation-move'); }
    await page.getByRole('button', { name: 'Retry scoring' }).click();
    await page.getByText(/Engine assessment:/).waitFor({ timeout: 120000 });
  });

  await test('Leaving while evaluation is pending cannot reveal a late reply', async () => {
    await startBlind(page, standard.id);
    let requestReceived;
    const received = new Promise((resolve) => { requestReceived = resolve; });
    await page.route('**/api/analyze/variation-move', async (route) => {
      requestReceived();
      await sleep(1200);
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'late' }) }).catch(() => {});
    });
    try {
      await page.locator('#practice-move-input').fill('d4');
      await page.getByRole('button', { name: 'Submit move' }).click();
      await received;
      await page.getByRole('button', { name: 'Cancel check and try another move' }).click();
      await page.getByRole('button', { name: 'Back to practice choices' }).click();
      await sleep(1500);
      await assertNoSpoilers(page);
      assert.equal(await page.locator('[data-practice-picker]').count(), 1);
    } finally { await page.unroute('**/api/analyze/variation-move'); }
  });

  await test('Mobile touch attempt works and never alters the original PGN', async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      const mobile = await logIn(phone);
      await startBlind(mobile, standard.id);
      await assertLayout(mobile);
      await assertNoSpoilers(mobile);
      await tapSquare(mobile, 'd2');
      await sleep(150);
      await tapSquare(mobile, 'd4');
      await mobile.getByText(/Engine assessment:/).waitFor({ timeout: 120_000 });
      assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(standard.id).pgn, baselinePgn);
    } finally { await phone.close(); }
  });

  await test('All supported non-English languages expose localized blind practice without spoilers', async () => {
    const languages = [
      { lang: 'de', entry: 'Zuerst üben', picker: 'Ohne Lösungshinweise üben',
        heading: 'Aus diesem Fehler lernen', pieces: 'Weiße Figuren:', error: 'Dieser Zug ist in der Stellung nicht legal.' },
      { lang: 'ru', entry: 'Сначала потренироваться', picker: 'Тренировка без подсказок',
        heading: 'Учиться на этой ошибке', pieces: 'Белые фигуры:', error: 'Этот ход недопустим' },
      { lang: 'bg', entry: 'Първо тренирай', picker: 'Тренировка без подсказки',
        heading: 'Учи се от тази грешка', pieces: 'Бели фигури:', error: 'Този ход не е позволен' },
      { lang: 'es', entry: 'Practicar primero', picker: 'Practicar sin pistas',
        heading: 'Aprender de este error', pieces: 'Piezas blancas:', error: 'Esa jugada no es legal' },
    ];
    try {
      for (const locale of languages) {
        const changed = await api('/api/settings/profile', { method: 'PATCH', cookie,
          body: { language: locale.lang } });
        assert.equal(changed.status, 200, `profile update for ${locale.lang}`);
        await page.goto(base + '/review');
        const link = page.locator(`a[href="/review/${standard.id}?practice=1"]`);
        await link.waitFor();
        assert.equal((await link.innerText()).trim(), locale.entry);
        assert.ok(!(await link.getAttribute('aria-label')).includes('Practice mistakes in'),
          `${locale.lang}: accessibility label must be localized`);
        await link.click();
        await page.getByRole('heading', { name: locale.picker }).waitFor();
        await assertNoSpoilers(page);
        await page.locator('#practice-move-5').click();
        await page.getByRole('heading', { name: locale.heading }).waitFor();
        await assertNoSpoilers(page);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForFunction(() => {
          const bounds = document.querySelector('cg-board')?.getBoundingClientRect();
          return bounds && bounds.width > 150 && bounds.left >= 0 && bounds.right <= innerWidth + 2;
        }, null, { timeout: 2500 });
        await assertLayout(page); // Long translated labels must not create mobile overflow.
        const position = page.locator('[data-practice-mode] details').first();
        await position.locator('summary').click();
        assert.ok((await position.innerText()).includes(locale.pieces),
          `${locale.lang}: screen-reader board description is still English`);
        await page.locator('#practice-move-input').fill('e7e5');
        await page.locator('#practice-move-input').press('Enter');
        assert.ok((await page.getByRole('alert').innerText()).includes(locale.error),
          `${locale.lang}: illegal-move message must be localized`);
        await page.setViewportSize({ width: 1440, height: 900 });
      }
    } finally {
      const restore = await api('/api/settings/profile', { method: 'PATCH', cookie, body: { language: 'en' } });
      assert.equal(restore.status, 200);
      await page.goto(base + '/review');
      await page.locator(`a[href="/review/${standard.id}?practice=1"]`).waitFor();
    }
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(standard.id).pgn, baselinePgn);
  });

  for (const theme of ['light', 'dark']) {
    await test(`${theme} responsive board, focus and no overflow at 1920, 1440, 1366, 768, 390 and zoom-equivalent 1152/720 widths`, async () => {
      const changed = await api('/api/settings/profile', { method: 'PATCH', cookie, body: { site_theme: theme } });
      assert.equal(changed.status, 200);
      await startBlind(page, standard.id);
      for (const [width, height] of [[1920, 1080], [1440, 900], [1366, 768], [1152, 900], [768, 1024], [720, 900], [390, 844]]) {
        await page.setViewportSize({ width, height });
        // Chromium can report a new viewport before layout/ResizeObserver has
        // recomputed the board. Do not accept a persistent clipped position:
        // wait only for the real DOM box to fit, with a strict 2.5 s bound.
        await page.waitForFunction(() => {
          const box = document.querySelector('cg-board')?.getBoundingClientRect();
          return box && box.width > 150 && box.right <= innerWidth + 2 && box.left >= 0;
        }, null, { timeout: 2500 });
        await assertLayout(page);
        await assertNoSpoilers(page);
        if (width === 1920 || width === 768 || width === 390) {
          await page.screenshot({ path: join(artifacts, `practice-${theme}-${width}.png`), fullPage: true });
        }
      }
    });
  }
} catch (error) {
  results.push({ name: 'Harness initialization', status: 'FAIL', error: String(error?.stack || error) });
  console.error(error?.stack || error);
} finally {
  if (browser) await browser.close();
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({
    baseline: process.env.GITHUB_SHA || 'local', results, browserErrors, created: new Date().toISOString(),
  }, null, 2));
  try { rmSync(tempRoot, { recursive: true, force: true }); } catch { /* temp cleanup best effort */ }
  const failed = results.filter((entry) => entry.status !== 'PASS').length;
  console.log(`Practice QA results: ${results.length - failed} PASS; ${failed} FAIL. Evidence: ${artifacts}`);
  if (browserErrors.length) console.error('Browser exceptions:', browserErrors);
  process.exit(failed || browserErrors.length ? 1 : 0);
}
