#!/usr/bin/env node
/**
 * Recreate README screenshots with a disposable demo account and database.
 * Never screenshots a real user's account; fixture games are generated locally.
 *
 * Build first: npm run build
 * Install Playwright separately or set PATZER_PLAYWRIGHT_MODULE to its ESM path.
 * A local Chrome can be selected with PATZER_CHROME_EXECUTABLE.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { Chess } from 'chess.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'docs/screenshots');
const tmp = mkdtempSync(join(tmpdir(), 'patzer-readme-demo-'));
const runtimeDir = join(tmp, 'runtime');
mkdirSync(runtimeDir, { mode: 0o700 });
const { chromium } = await import(process.env.PATZER_PLAYWRIGHT_MODULE || 'playwright');
const password = 'demo-chess-only-not-for-real-accounts';
let child;
let browser;
let sql;

async function unusedPort() {
  const srv = createServer();
  await new Promise((ok, fail) => srv.once('error', fail).listen(0, '127.0.0.1', ok));
  const port = srv.address().port;
  await new Promise((ok) => srv.close(ok));
  return port;
}

async function ready(url) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw Error('Screenshot server exited unexpectedly');
    try { if ((await fetch(url + '/api/health')).ok) return; } catch { /* booting */ }
    await new Promise((ok) => setTimeout(ok, 200));
  }
  throw Error('Screenshot server did not become healthy');
}

function pgnFor(sequence, index) {
  const game = new Chess();
  game.header('Event', 'Patzer README demo', 'Site', 'Local only',
    'White', index % 2 === 0 ? 'Patzer Demo' : 'Training Partner',
    'Black', index % 2 === 0 ? 'Training Partner' : 'Patzer Demo',
    'Result', index % 5 === 0 ? '1/2-1/2' : index % 3 === 0 ? '0-1' : '1-0');
  for (const move of sequence) game.move(move);
  return game.pgn();
}

async function snap(page, path, file, expectation) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expectation(page);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(output, file), animations: 'disabled' });
  console.log(`Captured ${file}: ${new URL(page.url()).pathname}`);
}

try {
  mkdirSync(output, { recursive: true });
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server/dist/index.js'], {
    cwd: root, stdio: 'ignore',
    env: {
      // Never propagate the developer's provider credentials, SSO settings,
      // account-specific secrets or runtime configuration to this demo child.
      PATH: process.env.PATH || '/usr/bin:/bin',
      HOME: tmp, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1',
      XDG_RUNTIME_DIR: runtimeDir, DBUS_SESSION_BUS_ADDRESS: '',
      DB_PATH: join(tmp, 'demo.db'), STOCKFISH_PATH: join(root, 'bin/stockfish'),
      CHESSCOM_SYNC_MINUTES: '0', UPDATE_CHECK: '0',
    },
  });
  await ready(base);

  const setup = await fetch(base + '/api/setup/init', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'patzer' },
    body: JSON.stringify({ username: 'patzer_demo', password, display_name: 'Demo Player', language: 'en' }),
  });
  assert.equal(setup.status, 200, 'demo account setup failed: ' + await setup.text());
  const cookie = setup.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'demo session cookie missing');

  sql = new Database(join(tmp, 'demo.db'));
  sql.pragma('busy_timeout = 5000');
  const user = sql.prepare("SELECT id FROM users WHERE username = 'patzer_demo'").get();
  assert.ok(user?.id);
  sql.prepare("UPDATE profiles SET chesscom_username='patzer_demo', lichess_username='patzer_demo' WHERE user_id = ?")
    .run(user.id);

  const variations = [
    { moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7','Re1','b5','Bb3','d6'], eco: 'C60', opening: 'Ruy Lopez' },
    { moves: ['d4','d5','c4','e6','Nc3','Nf6','Bg5','Be7','e3','O-O'], eco: 'D30', opening: "Queen's Gambit Declined" },
    { moves: ['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Bf5'], eco: 'B12', opening: 'Caro-Kann Defense' },
    { moves: ['e4','e5','Nf3','Nc6','Bc4','Bc5','c3','Nf6'], eco: 'C50', opening: 'Italian Game' },
    { moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6'], eco: 'E60', opening: "King's Indian Defense" },
  ];
  const insert = sql.prepare(`INSERT INTO games
    (user_id,source,external_id,pgn,white,black,result,time_control,time_class,end_time,user_color,rated,eco,opening_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const baseline = Date.now();
  let featuredId = 0;
  sql.transaction(() => {
    for (let i = 0; i < 225; i++) {
      const variation = variations[i % variations.length];
      const mineWhite = i % 2 === 0;
      const result = i % 5 === 0 ? 'draw' : i % 3 === 0 ? 'loss' : 'win';
      const source = i % 4 === 0 ? 'lichess' : 'chesscom';
      const id = insert.run(
        user.id, source,
        source === 'chesscom' ? `https://www.chess.com/game/live/${800000 + i}` : `patzerDemo${i}`,
        pgnFor(variation.moves, i),
        mineWhite ? 'Patzer Demo' : `Training Partner ${i % 12 + 1}`,
        mineWhite ? `Training Partner ${i % 12 + 1}` : 'Patzer Demo',
        result, ['300+0','600+0','900+10','60+0'][i % 4],
        ['blitz','rapid','rapid','bullet'][i % 4],
        new Date(baseline - (i * 12 + i % 9) * 3600000).toISOString(),
        mineWhite ? 'white' : 'black', 0, variation.eco, variation.opening,
      ).lastInsertRowid;
      if (i === 0) featuredId = Number(id);
    }
  })();

  // Real Stockfish output for the featured review, not a fabricated engine chart.
  const analysisResponse = await fetch(base + '/api/analyze', {
    method: 'POST', headers: { 'Cookie': cookie, 'Content-Type': 'application/json', 'X-Requested-With': 'patzer' },
    body: JSON.stringify({ game_id: featuredId, depth: 8 }), signal: AbortSignal.timeout(120000),
  });
  assert.equal(analysisResponse.status, 200, 'demo Stockfish analysis failed: ' + await analysisResponse.text());

  browser = await chromium.launch({ headless: true,
    ...(process.env.PATZER_CHROME_EXECUTABLE ? { executablePath: process.env.PATZER_CHROME_EXECUTABLE } : {}),
  });
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const [name, value] = cookie.split(/=(.*)/s);
  await context.addCookies([{ name, value, url: base, httpOnly: true, sameSite: 'Lax' }]);
  const at = (locator) => locator.waitFor({ state: 'visible', timeout: 15000 });

  await snap(page, base + '/', 'fork-home.png', async (p) => at(p.getByText('Demo Player').first()));
  await snap(page, base + '/review', 'fork-library.png', async (p) => {
    await at(p.getByText(/of 225 games/).first());
    await p.getByRole('button', { name: /Import more games/i }).click();
    await at(p.getByRole('button', { name: 'Import all games' }).first());
  });
  await snap(page, base + `/review/${featuredId}?ply=7`, 'fork-game-review.png', async (p) => at(p.locator('cg-board').first()));
  await snap(page, base + '/insights', 'fork-insights.png', async (p) => at(p.getByText(/225/).first()));
  await snap(page, base + '/insights', 'fork-insights-charts.png', async (p) => {
    const activity = p.getByRole('heading', { name: 'Activity' }).first();
    await at(activity);
    await activity.scrollIntoViewIfNeeded();
    await p.evaluate(() => window.scrollBy(0, -80));
  });
  await snap(page, base + '/train?tab=puzzles', 'fork-training.png', async (p) => {
    await at(p.getByRole('tab', { name: /Puzzles/i }));
    // General tactics appear even when the user's saved games have no
    // personal review puzzles yet. Include the actual loaded board when ready.
    await at(p.locator('cg-board').first());
  });
  await snap(page, base + '/admin/mcp', 'fork-mcp.png', async (p) => at(p.getByText('ChatGPT & MCP connection')));
  await page.setViewportSize({ width: 390, height: 844 });
  await snap(page, base + `/review/${featuredId}?ply=7`, 'fork-mobile-review.png', async (p) => at(p.locator('cg-board').first()));
  await context.close();
} finally {
  try { await browser?.close(); } catch { /* best effort */ }
  try { sql?.close(); } catch { /* best effort */ }
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((ok) => child.once('exit', ok)),
      new Promise((ok) => setTimeout(ok, 2000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  rmSync(tmp, { recursive: true, force: true });
}
