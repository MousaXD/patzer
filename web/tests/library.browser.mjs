#!/usr/bin/env node
/** Browser-only library acceptance. All user/game/API data is synthetic.
 * Runs a private loopback Vite preview on a dedicated port. It never reaches
 * any real Patzer server, Chess.com, Lichess, or SQLite database.
 *
 * Usage: npm run build -w web && node web/tests/library.browser.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const {chromium} = await import(process.env.PATZER_PLAYWRIGHT_MODULE || 'playwright');

const port = Number(process.env.LIBRARY_QA_PORT || 5386);
const url = `http://127.0.0.1:${port}`;
const output = resolve(process.env.LIBRARY_QA_OUTPUT || 'qa-artifacts/agent-c-library');
mkdirSync(output, { recursive: true });

const profile = {
  user_id: 7, display_name: 'Fixture Chess User', avatar_emoji: '♟', language: 'en',
  audience: 'intermediate', chesscom_username: 'fixtureuser', lichess_username: 'fixtureuser',
  coach_behavior: 'on_demand', tts_enabled: 0, tts_voice: null, tts_rate: 1, tts_pitch: 1,
  board_theme: 'green', piece_set: 'cburnett', site_theme: 'light', blunder_warning: 1,
  sound_enabled: 0, sound_set: 'classic', move_sound_set: 'classic',
};
const games = Array.from({ length: 620 }, (_, i) => {
  const id = i + 1;
  return {
    id, white: id % 2 ? 'fixtureuser' : `Opponent ${id}`,
    black: id % 2 ? `Opponent ${id}` : 'fixtureuser',
    user_color: id % 2 ? 'white' : 'black',
    result: ['win', 'loss', 'draw'][id % 3], time_control: '600+0',
    time_class: id % 2 ? 'rapid' : 'blitz',
    end_time: new Date(Date.UTC(2026, 10, 10) - id * 86_400_000).toISOString(),
    source: id % 2 ? 'chesscom' : 'lichess',
    bookmarked: id % 11 === 0 ? 1 : 0, analyzed: id % 7 === 0 ? 1 : 0,
    opening_name: id % 2 ? 'Italian Game' : 'Queen’s Gambit',
    accuracy_white: 78, accuracy_black: 85, notes: id % 13 === 0 ? 'Study later' : '',
    from_position: 0,
  };
});

function list(params) {
  let filtered = games.filter(g =>
    (!params.get('q') || [g.white,g.black,g.opening_name,g.notes].some(v =>
      v.toLowerCase().includes(params.get('q').toLowerCase()))) &&
    (!params.get('source') || g.source === params.get('source')) &&
    (!params.get('result') || g.result === params.get('result')) &&
    (!params.get('time_class') || g.time_class === params.get('time_class')) &&
    (!params.has('analyzed') || g.analyzed === Number(params.get('analyzed'))) &&
    (params.get('bookmarked') !== '1' || g.bookmarked === 1));
  if (params.get('sort') === 'oldest') filtered = [...filtered].reverse();
  const offset = Number(params.get('offset') || 0);
  const limit = Number(params.get('limit') || 50);
  return { games: filtered.slice(offset, offset + limit), total: filtered.length,
    offset, limit, has_more: offset + limit < filtered.length };
}

let preview, browser;
const queries = [];
async function awaitUp() {
  for (let i = 0; i < 100; i++) {
    if (preview.exitCode !== null) throw new Error('Vite preview exited unexpectedly');
    try { const res = await fetch(url); if (res.ok) return; } catch {}
    await sleep(100);
  }
  throw new Error('Private Vite preview did not start');
}

async function newPage(theme, width, height) {
  const context = await browser.newContext({viewport: {width,height}, colorScheme: theme});
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const parsed = new URL(request.url());
    const path = parsed.pathname;
    let status = 200, json;
    if (path === '/api/setup/status') json = {setup_required: false};
    else if (path === '/api/auth/me') json = {user: {
      id: 7, username: 'fixture', role: 'user', created_at: '2026-11-10', profile: {...profile, site_theme: theme},
    }};
    else if (path === '/api/games' && request.method() === 'GET') {
      queries.push(parsed.searchParams.toString());
      json = list(parsed.searchParams);
    } else if (/^\/api\/games\/import\/(?:chesscom|lichess)$/.test(path)) {
      const body = request.postDataJSON();
      if (body.limit === 100) { status = 409; json = {error: 'linked_account_changed'}; }
      else json = {imported: Math.round(body.limit / 2), total: body.limit, skipped: 0};
    } else if (path === '/api/games/live') json = {bot: null, pvp: []};
    else { status = 404; json = {error: 'test_fixture_not_implemented'}; }
    await route.fulfill({status, contentType:'application/json', body: JSON.stringify(json)});
  });
  await page.goto(`${url}/review`, {waitUntil: 'domcontentloaded'});
  await page.getByRole('combobox', {name:'Game source'}).waitFor();
  await page.getByText('40 of 620 games').waitFor();
  return {page,context,pageErrors};
}
function metrics(page) {
  return page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    filterBounds: (() => {const e=document.querySelector('[aria-label="Filter and sort games"]'); const b=e.getBoundingClientRect();return {x:b.x,right:b.right,width:b.width,display:getComputedStyle(e).display,grid:getComputedStyle(e).gridTemplateColumns};})(),
    selectSizes: [...document.querySelectorAll('select')].map(el => {
      const b = el.getBoundingClientRect();
      const p=el.parentElement.getBoundingClientRect();
      return {aria: el.getAttribute('aria-label') || el.id, x:b.x, right:b.right, width:b.width,parentWidth:p.width};
    }),
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  }));
}
async function verifyViewport(theme, width, height) {
  const {page, context, pageErrors} = await newPage(theme, width, height);
  try {
    const m = await metrics(page);
    assert.equal(m.theme,theme);
    assert.ok(m.overflow <= 2, `Horizontal overflow on ${width}px ${theme}: ${m.overflow}px`);
    if(width<=390) console.log('Mobile geometry',width,JSON.stringify(m));
    for (const item of m.selectSizes) {
      assert.ok(item.right <= width + 2 && item.x >= -2,
        `Clipped select ${item.aria} on ${width}px ${theme}: ${JSON.stringify(item)}`);
    }
    await page.screenshot({path:join(output,`library-${theme}-${width}.png`),fullPage: width <= 390});
    if (width <= 390) {
      await page.screenshot({path:join(output,`library-${theme}-${width}-viewport.png`)});
      for (const label of ['Bookmark game','Remove bookmark']) {
        const button=page.getByRole('button',{name:label}).first();
        if (!await button.count()) continue;
        const rect=await button.boundingBox();
        assert.ok(rect && rect.x>=0 && rect.x+rect.width<=width+2,
          `Mobile ${label} control was clipped at ${width}px: ${JSON.stringify(rect)}`);
      }
      const practice=page.getByRole('link',{name:/Practice/}).first();
      assert.ok(await practice.isVisible(), 'Analyzed mobile cards must offer practice');
      const practiceRect=await practice.boundingBox();
      assert.ok(practiceRect && practiceRect.x+practiceRect.width<=width+2,
        `Mobile practice link was clipped: ${JSON.stringify(practiceRect)}`);
    }
    assert.deepEqual(pageErrors, [],`Client JS errors: ${pageErrors}`);
    return m;
  } finally { await context.close(); }
}

try {
  // Child serves only static web/dist. No backend process, DB, cron or workers.
  const vite = resolve('node_modules/vite/bin/vite.js');
  preview = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: resolve('web'), stdio:'ignore', detached:true,
  });
  await awaitUp();
  browser = await chromium.launch({headless:true});
  for (const theme of ['light','dark']) {
    for (const [w,h] of [[1440,900],[390,844],[320,700]]) {
      const m = await verifyViewport(theme,w,h);
      console.log(`PASS ${theme} ${w}x${h} overflow=${m.overflow}`);
    }
  }

  const {page, context, pageErrors} = await newPage('light', 1440, 900);
  try {
    // Exercise URL-backed source filtering, result/analysis sort, and reset.
    await page.getByRole('combobox', {name:'Game source'}).selectOption('lichess');
    await page.getByRole('combobox', {name:'Game result'}).selectOption('win');
    await page.getByRole('combobox', {name:'Sort games'}).selectOption('oldest');
    await page.getByRole('combobox', {name:'Review status'}).selectOption('1');
    await page.waitForURL(/source=lichess/);
    for (let attempt=0; attempt<30 && !queries.some(p => p.includes('source=lichess') && p.includes('result=win')
      && p.includes('sort=oldest') && p.includes('analyzed=1')); attempt++) await sleep(100);
    assert.ok(queries.some(p => p.includes('source=lichess') && p.includes('result=win')
      && p.includes('sort=oldest') && p.includes('analyzed=1')),
    `Filter changes did not reach the paginated API: url=${page.url()} recent=${JSON.stringify(queries.slice(-6))}`);
    await page.getByRole('button', {name:'Clear filters'}).click();
    await page.getByText('40 of 620 games').waitFor();
    // Walk beyond the historical 200-card cutoff without duplicated rows.
    for (let n = 80; n <= 240; n += 40) {
      await page.getByRole('button', {name:'Load more games'}).click();
      await page.getByText(`${n} of 620 games`).waitFor();
    }
    // Analyzed cards include a *second* explicit practice link. Count only
    // the primary game-detail anchors when checking pagination uniqueness.
    assert.equal(await page.locator('a[href^="/review/"]:not([href*="?"])').count(),240);
    assert.equal(await page.locator('a[href="/review/240"]').count(),1);
    // Import shows the number *newly saved* vs *retrieved* — not "all history".
    await page.getByRole('button',{name:/@fixtureuser/}).first().click();
    await page.getByText(/100 new games saved from 200 retrieved/).waitFor();
    await page.getByText(/not your entire history/).waitFor();
    await page.getByRole('combobox',{name:'Recent games to fetch'}).selectOption('20');
    await page.getByRole('button',{name:/@fixtureuser/}).first().click();
    await page.getByText(/10 new games saved from 20 retrieved/).waitFor();
    await page.getByRole('combobox',{name:'Recent games to fetch'}).selectOption('100');
    await page.getByRole('button',{name:/@fixtureuser/}).first().click();
    await page.getByRole('alert').getByText(/Your linked account changed during import/).waitFor();
    // No-match recovery should stay within library.
    await page.getByRole('searchbox').fill('no-such-player-84841');
    await page.getByText('No games match your search').waitFor();
    await page.getByRole('button',{name:'Clear filters'}).last().click();
    await page.getByText('40 of 620 games').waitFor();
    assert.deepEqual(pageErrors, []);
    console.log('PASS interactive filter/pagination/import/empty recovery');
  } finally { await context.close(); }
} finally {
  if (browser) await browser.close();
  if (preview?.pid) {
    try {process.kill(-preview.pid,'SIGTERM');} catch {try {preview.kill('SIGTERM');} catch {}}
  }
}
