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
  // Same visible username on different providers is two distinct identities.
  const opponent = id % 2
    ? (id % 21 === 0 ? 'Nepo' : `Opponent ${id}`)
    : (id % 20 === 0 ? 'Nepo' : `Opponent ${id}`);
  return {
    id, white: id % 2 ? 'fixtureuser' : opponent,
    black: id % 2 ? opponent : 'fixtureuser',
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
const unicodeGames = [
  {...games[0],id:7001,source:'imported',white:'JOSÉ',black:'Bob',opening_name:'ÉCHEC',
    user_color:null,result:null,end_time:null},
  {...games[1],id:7002,source:'imported',white:'БОРИС',black:'Chris',opening_name:'King’s Pawn Game',
    user_color:null,result:null,end_time:null},
  {...games[2],id:7003,source:'imported',white:'Cafe\u0301',black:'Dana',opening_name:'Queen’s Gambit',
    user_color:null,result:null,end_time:null},
];
const unicodeFold = (value) => value.normalize('NFC').toLowerCase();

function list(params, availableGames = games) {
  let filtered = availableGames.filter(g =>
    (!params.get('q') || [g.white,g.black,g.opening_name,g.notes].some(v =>
      unicodeFold(v || '').includes(unicodeFold(params.get('q'))))) &&
    (!params.get('source') || g.source === params.get('source')) &&
    (!params.get('result') || g.result === params.get('result')) &&
    (!params.get('time_class') || g.time_class === params.get('time_class')) &&
    (!params.get('opening') || g.opening_name === params.get('opening')) &&
    (!params.get('opponent') || (g.user_color === 'white' ? g.black : g.white).toLowerCase()
      === params.get('opponent').trim().toLowerCase()) &&
    (!params.has('analyzed') || g.analyzed === Number(params.get('analyzed'))) &&
    (!params.get('from_date') || g.end_time.slice(0,10) >= params.get('from_date')) &&
    (!params.get('to_date') || g.end_time.slice(0,10) <= params.get('to_date')) &&
    (params.get('bookmarked') !== '1' || g.bookmarked === 1));
  if (params.get('sort') === 'oldest') filtered = [...filtered].reverse();
  const offset = Number(params.get('offset') || 0);
  const limit = Number(params.get('limit') || 50);
  return { games: filtered.slice(offset, offset + limit), total: filtered.length,
    offset, limit, has_more: offset + limit < filtered.length };
}

/** A disposable history that receives a newer game between two page reads.
 * Keep the first page's high-water ID in the cursor, just like the new API.
 * An offset-only client would duplicate the boundary card after the insert.
 */
function changingHistoryPage(params, newGamePresent) {
  const newGame = {...games[0], id:9999, white:'New Arrival',
    end_time:'2027-01-01T00:00:00.000Z'};
  const all = newGamePresent ? [newGame,...games] : games;
  const cursor=params.get('cursor');
  const anchor=cursor ? JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')) : null;
  const maxId=anchor ? anchor[1] : Math.max(...all.map(g=>g.id));
  const snapshot=all.filter(g=>g.id <= maxId);
  const offset=anchor ? snapshot.findIndex(g=>g.id===anchor[0])+1 : Number(params.get('offset')||0);
  const limit=Number(params.get('limit')||40);
  const slice=snapshot.slice(offset,offset+limit);
  const hasMore=offset+slice.length<snapshot.length;
  return {games:slice,total:snapshot.length,offset:cursor?0:offset,limit,has_more:hasMore,
    next_cursor:hasMore && slice.length ? Buffer.from(JSON.stringify([slice.at(-1).id,maxId])).toString('base64url') : null};
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

async function newPage(theme, width, height,
  {failOpeningsOnce = false, emptyLibrary = false, noLinked = false,
    changingHistory = false, starredOnlyScenario = false,
    unknownImportedNames = false, practiceForUnknownNames = false,
    unicodeLibrary = false, longPlayerNames = false,
    locale = 'en', timeZone = 'UTC', dateBoundary = false, noStarredGames = false,
    delayedContinuation = null, failContinuationUntilRetry = false,
    providerImportBreakdown = false, providerImportInvalidSummary = false} = {}) {
  const context = await browser.newContext({viewport: {width,height}, colorScheme: theme, timezoneId: timeZone});
  const page = await context.newPage();
  const pageErrors = [];
  let openingFailuresRemaining = failOpeningsOnce ? 1 : 0;
  let hasPgnImports = false;
  let latestGameInserted = false;
  let longPlayerBookmarked = false;
  let invalidProviderSummary = providerImportInvalidSummary;
  let continuationFailureActive=failContinuationUntilRetry;
  let releaseContinuation;
  const continuationGate=new Promise(resolve=>{releaseContinuation=resolve;});
  const removedStars = new Set();
  const seenPgnFiles = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const parsed = new URL(request.url());
    const path = parsed.pathname;
    let status = 200, json;
    if (path === '/api/setup/status') json = {setup_required: false};
    else if (path === '/api/auth/me') json = {user: {
      id: 7, username: 'fixture', role: 'user', created_at: '2026-11-10', profile: {...profile,
        site_theme: theme, language: locale,
        ...(noLinked ? {chesscom_username:null,lichess_username:null} : {})},
    }};
    else if (path === '/api/games/openings') {
      if (openingFailuresRemaining > 0) {
        openingFailuresRemaining--;
        status = 503;
        json = {error:'temporary_fixture_failure'};
      } else json = longPlayerNames
        ? {total:1,classified:1,unclassified:0,openings:[{name:'Italian Game',games:1}]}
        : unicodeLibrary
        ? {total:3,classified:3,unclassified:0,openings:[{name:'ÉCHEC',games:1},{name:'King’s Pawn Game',games:1},{name:'Queen’s Gambit',games:1}]}
        : unknownImportedNames
        ? {total:1,classified:1,unclassified:0,openings:[{name:"King's Pawn Game",games:1}]}
        : emptyLibrary
        ? {total:hasPgnImports ? 2 : 0,classified:hasPgnImports ? 2 : 0,
          unclassified:0,openings:hasPgnImports ? [{name:"King's Pawn Game",games:1},{name:"Queen's Pawn Game",games:1}] : []}
        : {
        total: 620, classified: 620, unclassified: 0,
        openings: [{name:'Italian Game',games:310}, {name:'Queen’s Gambit',games:310}],
      };
    }
    else if (path === '/api/games/opponents') json = {
      total: 620, identified: 620, unidentified: 0,
      opponents: [{source:'lichess',name:'Nepo',games:31}, {source:'chesscom',name:'Nepo',games:15}],
    };
    else if (path === '/api/games' && request.method() === 'GET') {
      queries.push(parsed.searchParams.toString());
      if (longPlayerNames) json = {games:[{
        ...games[0],id:9003,source:'imported',white:'棋手名'.repeat(40),
        black:'JOSÉ-'.repeat(22),user_color:null,result:null,end_time:null,
        bookmarked:longPlayerBookmarked ? 1 : 0,
      }],total:1,offset:0,limit:40,has_more:false};
      else if (hasPgnImports && parsed.searchParams.get('source') === 'imported') {
        json = { games: [
          {id:9001, source:'imported', white:'Alice',black:'Bob',result:null,time_control:null,
            end_time:null,user_color:null,bookmarked:0,analyzed:0,opening_name:"King's Pawn Game",notes:''},
          {id:9002, source:'imported',white:'Chris',black:'Dana',result:null,time_control:null,
            end_time:null,user_color:null,bookmarked:0,analyzed:0,opening_name:"Queen's Pawn Game",notes:''},
        ], total:2,offset:0,limit:40,has_more:false};
      } else if (unknownImportedNames) json = {
        games:[{id:9001, source:'imported', white:null,
          black:practiceForUnknownNames ? '  ' : null,
          result:practiceForUnknownNames ? 'loss' : null,
          time_control:null,end_time:practiceForUnknownNames ? '2026-11-09T12:00:00Z' : null,
          user_color:null,bookmarked:0,analyzed:practiceForUnknownNames ? 1 : 0,
          opening_name:"King's Pawn Game",notes:''}],
        total:1,offset:0,limit:40,has_more:false,
      };
      else if (dateBoundary) json = list(parsed.searchParams, [{
        ...games[0], source:'imported', end_time:'2026-11-09T23:45:00Z',
      }]);
      else if (unicodeLibrary) json = list(parsed.searchParams,unicodeGames);
      else if (emptyLibrary) json = {games:[],total:0,offset:0,limit:40,has_more:false};
      else if (changingHistory) {
        json = changingHistoryPage(parsed.searchParams,latestGameInserted);
        latestGameInserted = true;
      } else json = noStarredGames
        ? list(parsed.searchParams, games.map(g=>({...g, bookmarked:0})))
        : starredOnlyScenario
        ? list(parsed.searchParams, games.map(g=>removedStars.has(g.id) ? {...g,bookmarked:0} : g))
        : list(parsed.searchParams);
    } else if (longPlayerNames && path === '/api/games/9003/bookmark' && request.method() === 'PATCH') {
      longPlayerBookmarked = !!request.postDataJSON().bookmarked;
      json = {bookmarked:Number(longPlayerBookmarked)};
    } else if (starredOnlyScenario && /^\/api\/games\/\d+\/bookmark$/.test(path) && request.method() === 'PATCH') {
      const id = Number(path.split('/')[3]);
      await sleep(450);
      if (id === 22) { status=503; json={error:'synthetic_bookmark_failure'}; }
      else { removedStars.add(id); json={bookmarked:0}; }
    } else if (path === '/api/games/import/pgn' && request.method() === 'POST') {
      const pgn = request.postDataJSON().pgn;
      seenPgnFiles.push(pgn);
      if (pgn.includes('[Event "Broken"]')) {
        status = 422;
        json = {error:'invalid_pgn',game_index:2};
      } else if (pgn.includes('[Event "Invalid summary"]')) {
        json = {total:2,imported:1,duplicates:0};
      } else {
        json = {total:2, imported:1,duplicates:1};
        hasPgnImports = true;
      }
    } else if (/^\/api\/games\/import\/(?:chesscom|lichess)$/.test(path)) {
      const body = request.postDataJSON();
      if (body.limit === 100 && path.endsWith('/chesscom')) { status = 429; json = {error: 'chesscom_rate_limited'}; }
      else if (body.limit === 100) { status = 409; json = {error: 'linked_account_changed'}; }
      else if (body.limit === 20 && path.endsWith('/lichess')) { status = 502; json = {error: 'lichess_unavailable'}; }
      else if (invalidProviderSummary && path.endsWith('/chesscom')) {
        json = {imported:-1,total:200,duplicates:0,skipped:0,enriched:0};
      }
      else if (providerImportBreakdown && body.limit === 200 && path.endsWith('/chesscom')) {
        json = {imported:100,total:109,duplicates:6,skipped:3,enriched:5};
      }
      else json = {imported: Math.round(body.limit / 2), total: body.limit, skipped: 0, enriched: body.limit === 200 ? 7 : 0};
    } else if (path === '/api/games/live') json = {bot: null, pvp: []};
    else { status = 404; json = {error: 'test_fixture_not_implemented'}; }
    // A controlled late continuation from a *previous* filter is the hard
    // case: the user must be free to browse the newly selected collection.
    if (delayedContinuation && path === '/api/games' && request.method() === 'GET' &&
      parsed.searchParams.get('offset') === '40' && !parsed.searchParams.has('source')) {
      await continuationGate;
      if (delayedContinuation === 'failure') {
        status=503; json={error:'delayed_previous_filter_failure'};
      }
    }
    if (continuationFailureActive && path === '/api/games' && request.method() === 'GET' &&
      parsed.searchParams.get('offset') === '40') {
      status=503; json={error:'fixture_continuation_unavailable'};
    }
    await route.fulfill({status, contentType:'application/json', body: JSON.stringify(json)});
  });
  await page.goto(`${url}/review`, {waitUntil: 'domcontentloaded'});
  await page.getByRole('combobox', {name:locale === 'de' ? 'Partiequelle' : 'Game source'}).waitFor();
  if (longPlayerNames) {
    await page.getByText('1 of 1 games').waitFor();
  } else if (unicodeLibrary) {
    await page.getByText('3 of 3 games').waitFor();
  } else if (unknownImportedNames) {
    await page.getByText(locale === 'de' ? 'Partien: 1 von 1' : '1 of 1 games').waitFor();
  } else if (emptyLibrary) {
    await page.getByText('Your game history starts here').waitFor();
    await page.getByText('0 of 0 games').waitFor();
  } else {
    if (locale !== 'en') {
      // German translates both its discovery actions and game counts; wait
      // for real history and discovery results without guessing their text.
      await page.locator('a[href="/review/1"]').waitFor();
      await page.getByRole('button', {name:/Italian Game/}).waitFor();
    } else {
      if (failOpeningsOnce) await page.getByRole('button', {name:'Retry opening highlights'}).waitFor();
      else await page.getByRole('button', {name:'Show 310 saved games in Italian Game'}).waitFor();
      await page.getByText('40 of 620 games').waitFor();
    }
  }
  return {page,context,pageErrors,seenPgnFiles,releaseContinuation,
    allowValidProviderSummary:()=>{invalidProviderSummary=false;},
    allowContinuationRetry:()=>{continuationFailureActive=false;}};
}
async function measureStatusContrast(node) {
  return node.evaluate(element => {
    const style=getComputedStyle(element);
    const rgb=value=>(value.match(/[\d.]+/g) || []).map(Number);
    const fg=rgb(style.color), tint=rgb(style.backgroundColor);
    const pageColor=rgb(getComputedStyle(document.body).backgroundColor);
    const alpha=tint[3] ?? 1;
    const bg=[0,1,2].map(i=>tint[i]*alpha+pageColor[i]*(1-alpha));
    const luma=values=>{
      const linear=values.slice(0,3).map(v=>{
        const s=v/255;
        return s<=0.04045?s/12.92:((s+0.055)/1.055)**2.4;
      });
      return linear[0]*0.2126+linear[1]*0.7152+linear[2]*0.0722;
    };
    const ratio=(Math.max(luma(fg),luma(bg))+0.05)/(Math.min(luma(fg),luma(bg))+0.05);
    return {ratio,foreground:style.color,background:style.backgroundColor,page:getComputedStyle(document.body).backgroundColor};
  });
}

function metrics(page) {
  return page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    filterBounds: (() => {const e=document.getElementById('library-filters'); const b=e.getBoundingClientRect();return {x:b.x,right:b.right,width:b.width,display:getComputedStyle(e).display,grid:getComputedStyle(e).gridTemplateColumns};})(),
    selectSizes: [...document.querySelectorAll('select')].map(el => {
      const b = el.getBoundingClientRect();
      const p=el.parentElement.getBoundingClientRect();
      return {aria: el.getAttribute('aria-label') || el.id, x:b.x, right:b.right, width:b.width,parentWidth:p.width};
    }),
    dateSizes: [...document.querySelectorAll('input[type="date"]')].map(el => {
      const b=el.getBoundingClientRect();
      return {aria:el.getAttribute('aria-label'),x:b.x,right:b.right,width:b.width};
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
    if(width<=390) {
      const searchBox=await page.getByRole('searchbox').boundingBox();
      assert.ok(searchBox && searchBox.y>=0 && searchBox.y+searchBox.height<=height,
        `Search must appear in the first populated-Library mobile viewport: ${JSON.stringify(searchBox)}`);
      const toggle=page.getByRole('button',{name:'Import more games'});
      assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    }
    for (const item of [...m.selectSizes, ...m.dateSizes]) {
      assert.ok(item.right <= width + 2 && item.x >= -2,
        `Clipped select ${item.aria} on ${width}px ${theme}: ${JSON.stringify(item)}`);
    }
    await page.getByRole('button',{name:'Import more games'}).click();
    assert.equal(await page.getByRole('button',{name:'Hide import options'}).getAttribute('aria-expanded'),'true');
    const fileControl = await page.getByLabel('Choose a PGN file').boundingBox();
    assert.ok(fileControl && fileControl.x >= -2 && fileControl.x + fileControl.width <= width + 2,
      `PGN file picker clipped at ${width}px ${theme}: ${JSON.stringify(fileControl)}`);
    if (width<=390) {
      const submit=await page.getByRole('button',{name:'Import PGN file'}).boundingBox();
      assert.ok(fileControl.height>=44,
        `PGN chooser must have a 44px mobile touch target: ${JSON.stringify(fileControl)}`);
      assert.ok(submit && submit.height>=44 && submit.x>=0 && submit.x+submit.width<=width+2,
        `PGN import action must have an unclipped 44px target: ${JSON.stringify(submit)}`);
    }
    const closeImports=page.getByRole('button',{name:'Hide import options'});
    if(width===320) {
      await closeImports.focus();
      await page.keyboard.press('Enter');
    } else await closeImports.click();
    assert.equal(await page.getByRole('button',{name:'Import more games'}).getAttribute('aria-expanded'),'false');
    if (width <= 390) {
      const opening = page.locator('a[href="/review/1"] [title="Italian Game"]');
      assert.ok(await opening.isVisible(),
        `Opening name is missing from the saved-game card at ${width}px ${theme}`);
      const openingRect=await opening.boundingBox();
      assert.ok(openingRect && openingRect.x >= 0 && openingRect.x + openingRect.width <= width + 2,
        `Opening label overflows the mobile card: ${JSON.stringify(openingRect)}`);
    }
    await page.screenshot({path:join(output,`library-${theme}-${width}.png`),fullPage: width <= 390});
    await page.getByRole('button', {name:'Opponents'}).click();
    await page.getByRole('button', {name:'Show 31 Lichess games against Nepo'}).waitFor();
    const rivalLayout = await metrics(page);
    assert.ok(rivalLayout.overflow <= 2, `Opponent cards overflow at ${width}px ${theme}`);
    await page.screenshot({path:join(output,`library-opponents-${theme}-${width}.png`)});
    await page.getByRole('button', {name:'Openings'}).click();
    await page.getByRole('button', {name:'Show 310 saved games in Italian Game'}).waitFor();
    if (width <= 390) {
      await page.screenshot({path:join(output,`library-${theme}-${width}-viewport.png`)});
      for (const label of ['Bookmark game','Remove bookmark']) {
        const button=page.getByRole('button',{name:label}).first();
        if (!await button.count()) continue;
        const rect=await button.boundingBox();
        assert.ok(rect && rect.x>=0 && rect.x+rect.width<=width+2 && rect.width>=44 && rect.height>=44,
          `Mobile ${label} control was clipped or too small at ${width}px: ${JSON.stringify(rect)}`);
      }
      const practice=page.getByRole('link',{name:/Practice/}).first();
      assert.ok(await practice.isVisible(), 'Analyzed mobile cards must offer practice');
      const practiceRect=await practice.boundingBox();
      assert.ok(practiceRect && practiceRect.x+practiceRect.width<=width+2 && practiceRect.height>=44,
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

  const germanFilters=await newPage('dark',390,844,{locale:'de'});
  try {
    const {page,pageErrors}=germanFilters;
    await page.getByText('Partien: 40 von 620',{exact:true}).waitFor();
    assert.equal(await page.getByRole('group',{name:'Partien filtern und sortieren'}).count(),1,
      'German Library controls must have a localized accessible group name');
    for (const label of ['Partiequelle','Partiegeschwindigkeit','Partieergebnis',
      'Analysestatus','Partien sortieren']) {
      assert.equal(await page.getByRole('combobox',{name:label,exact:true}).count(),1,
        `German screen-reader filter label missing: ${label}`);
    }
    assert.equal(await page.getByRole('combobox',{name:'Partiequelle'}).locator('option').first().textContent(),
      'Alle Quellen', 'German Library must not display the English All sources option');
    assert.equal(await page.getByRole('combobox',{name:'Partien sortieren'}).locator('option').first().textContent(),
      'Neueste zuerst', 'German Library must localize sort options');
    await page.getByRole('combobox',{name:'Partiequelle'}).selectOption('lichess');
    await page.waitForURL(/source=lichess/);
    assert.equal(new URL(page.url()).searchParams.get('source'),'lichess');
    await page.getByRole('button',{name:'Filter zurücksetzen'}).click();
    await page.waitForURL(href => !(new URL(href)).searchParams.has('source'));
    const geometry=await metrics(page);
    assert.ok(geometry.overflow<=2,`Localized Library causes mobile overflow: ${geometry.overflow}px`);
    await page.screenshot({path:join(output,'library-german-filters-dark-390.png'),fullPage:true});
    assert.deepEqual(pageErrors,[],'Localized Library filters caused a browser exception');
    console.log('PASS German Library filter accessibility labels and URL-backed source selection');
  } finally {await germanFilters.context.close();}

  const germanImport=await newPage('light',390,844,{locale:'de'});
  try {
    const {page,pageErrors}=germanImport;
    const toggle=page.locator('button[aria-controls="library-import-controls"]');
    assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    assert.match(await toggle.textContent(),/Weitere Partien importieren/);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    const section=page.getByRole('region',{name:'Letzte Partien importieren'});
    await section.waitFor();
    await section.getByText('Wähle die Anzahl der Partien. Bereits gespeicherte Partien werden nicht überschrieben.').waitFor();
    const limit=section.getByRole('combobox',{name:'Anzahl der Partien'});
    const rect=await limit.boundingBox();
    assert.ok(rect && rect.height>=44 && rect.x>=0 && rect.x+rect.width<=392,
      `Import-limit control must be mobile touch accessible: ${JSON.stringify(rect)}`);
    await limit.selectOption('100');
    assert.equal(await limit.inputValue(),'100');
    const provider=section.getByRole('button',{name:/Von Chess.com importieren/});
    const providerRect=await provider.boundingBox();
    assert.ok(providerRect && providerRect.height>=44 && providerRect.x>=0 && providerRect.x+providerRect.width<=392,
      `Provider import action must be mobile touch accessible: ${JSON.stringify(providerRect)}`);
    const pgnSection=page.getByRole('region',{name:'PGN-Datei importieren'});
    await pgnSection.getByText('Keine Datei ausgewählt',{exact:true}).waitFor();
    assert.equal(await pgnSection.getByLabel('PGN-Datei auswählen').getAttribute('type'),'file');
    assert.ok((await metrics(page)).overflow<=2,'Expanded import section overflows German 390px view');
    await page.screenshot({path:join(output,'library-german-recent-import-light-390.png'),fullPage:true});
    assert.deepEqual(pageErrors,[],'German recent-import controls produced a JS exception');
    console.log('PASS German recent-import title, batch explanation, touch targets and bounded selection');
  } finally {await germanImport.context.close();}

  for (const theme of ['light','dark']) {
    const localizedFile=await newPage(theme,320,700,{locale:'de'});
    try {
      const {page,pageErrors}=localizedFile;
      await page.locator('button[aria-controls="library-import-controls"]').click();
      const fileInput=page.getByLabel('PGN-Datei auswählen');
      const chooserRect=await fileInput.boundingBox();
      assert.ok(chooserRect && chooserRect.width>=200 && chooserRect.height>=44 &&
        chooserRect.x>=0 && chooserRect.x+chooserRect.width<=322,
        `Native file chooser should keep an accessible 44px area at 320px: ${JSON.stringify(chooserRect)}`);
      await page.getByText('Keine Datei ausgewählt',{exact:true}).waitFor();
      const noFile=page.locator('#library-pgn-filename');
      const filenameBefore=await noFile.evaluate(el=>({visible:el.clientWidth,full:el.scrollWidth}));
      assert.ok(filenameBefore.visible>=200 && filenameBefore.full<=filenameBefore.visible+1,
        `German 320px file selection hint should fit without clipping: ${JSON.stringify(filenameBefore)}`);
      await noFile.scrollIntoViewIfNeeded();
      await page.screenshot({path:join(output,`library-german-pgn-picker-${theme}-320.png`)});
      const chooser=page.waitForEvent('filechooser',{timeout:10000});
      await fileInput.focus();
      assert.ok(await fileInput.evaluate(node=>document.activeElement===node),
        'Native PGN chooser must remain keyboard focusable');
      await page.keyboard.press('Enter');
      const fileDialog=await chooser;
      const filename='training_archive_with_long_unicode_names_ä_ç_фигуры_2026.pgn';
      await fileDialog.setFiles({name:filename,mimeType:'text/plain',
        buffer:Buffer.from('[Event "Training"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 *')});
      await page.getByText(filename,{exact:true}).waitFor();
      const selectedName=await noFile.boundingBox();
      assert.ok(selectedName && selectedName.width>=200,
        `Selected filename should have substantial visible width at 320px: ${JSON.stringify(selectedName)}`);
      assert.equal(await fileInput.getAttribute('aria-describedby'),
        'library-pgn-help library-pgn-filename');
      assert.ok((await metrics(page)).overflow<=2,
        `Long selected PGN filename caused overflow at 320px in ${theme}`);
      assert.equal(await page.getByRole('button',{name:'PGN-Datei importieren'}).isEnabled(),true);
      await page.screenshot({path:join(output,`library-german-pgn-selected-${theme}-320.png`)});
      assert.deepEqual(pageErrors,[],`Localized file chooser produced a JS exception in ${theme}`);
      console.log(`PASS ${theme} German 320px PGN native keyboard chooser and selected-file feedback`);
    } finally {await localizedFile.context.close();}
  }

  const germanResult=await newPage('light',390,844,{locale:'de',providerImportBreakdown:true});
  try {
    const {page,pageErrors}=germanResult;
    await page.locator('button[aria-controls="library-import-controls"]').click();
    const section=page.getByRole('region',{name:'Letzte Partien importieren'});
    await section.getByRole('button',{name:/Von Chess.com importieren/}).click();
    const success=page.getByRole('status').getByText(/100 neue Partien aus 109 abgerufenen Partien gespeichert/);
    await success.waitFor();
    for (const detail of [
      '6 bereits gespeichert', '3 nicht unterstützt oder ungültig',
      '5 vorhandene Partien haben neue Eröffnungsdetails erhalten',
      'Es werden nur die letzten Partien importiert, nicht dein vollständiger Spielverlauf',
    ]) {
      assert.ok((await success.textContent()).includes(detail),
        `German provider result omitted ${detail}`);
    }
    const contrast=await measureStatusContrast(success);
    assert.ok(contrast.ratio>=4.5,
      `Small Library success text must meet 4.5:1 WCAG AA contrast: ${JSON.stringify(contrast)}`);
    await success.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'library-german-provider-import-result-light-390.png')});
    assert.deepEqual(pageErrors,[],'German provider result caused a JS exception');
    console.log(`PASS German provider result counts and light WCAG AA contrast ${contrast.ratio.toFixed(2)}:1`);
  } finally {await germanResult.context.close();}

  const mobileFeedback=await newPage('light',320,700,{locale:'de',providerImportBreakdown:true});
  try {
    const {page,pageErrors}=mobileFeedback;
    await page.locator('button[aria-controls="library-import-controls"]').click();
    const section=page.getByRole('region',{name:'Letzte Partien importieren'});
    const submit=section.getByRole('button',{name:/Von Chess.com importieren/});
    await submit.click();
    const saved=page.getByRole('status').getByText(/100 neue Partien aus 109 abgerufenen Partien gespeichert/);
    await saved.waitFor();
    const successRect=await saved.boundingBox();
    const providerRect=await section.boundingBox();
    assert.ok(successRect && successRect.y>=0 && successRect.y<700,
      `Provider success should begin within the initiating mobile viewport: ${JSON.stringify(successRect)}`);
    assert.ok(providerRect && successRect.y>=providerRect.y+providerRect.height &&
      successRect.y<=providerRect.y+providerRect.height+24,
      'Provider success should appear directly after the provider panel, before the PGN picker');
    await page.screenshot({path:join(output,'library-provider-result-inline-light-320.png')});
    await section.getByRole('combobox',{name:'Anzahl der Partien'}).selectOption('100');
    await submit.click();
    const error=page.getByRole('alert').getByText(/Chess.com begrenzt derzeit die Anfragen/);
    await error.waitFor();
    const errorRect=await error.boundingBox();
    assert.ok(errorRect && errorRect.y>=0 && errorRect.y<700,
      `Provider failure should begin within the initiating mobile viewport: ${JSON.stringify(errorRect)}`);
    await page.locator('button[aria-controls="library-import-controls"]').click();
    assert.equal(await page.getByRole('alert').count(),1,
      'A late provider failure must remain visible after collapsing the import controls');
    assert.equal(await page.getByRole('status').count(),0,
      'A collapsed import must not duplicate the previous success announcement');
    assert.deepEqual(pageErrors,[],'Localized provider status placement caused a JS exception');
    console.log('PASS provider import success and failure are visible beside the initiating 320px action');
  } finally {await mobileFeedback.context.close();}

  const invalidProvider=await newPage('dark',390,844,{locale:'de',providerImportInvalidSummary:true});
  try {
    const {page,pageErrors,allowValidProviderSummary}=invalidProvider;
    await page.locator('button[aria-controls="library-import-controls"]').click();
    const submit=page.getByRole('region',{name:'Letzte Partien importieren'})
      .getByRole('button',{name:/Von Chess.com importieren/});
    await submit.click();
    const warning=page.getByRole('alert').getByText(/Das Importergebnis konnte nicht überprüft werden/);
    await warning.waitFor();
    assert.ok((await warning.textContent()).includes('Einige Partien könnten bereits gespeichert sein'));
    assert.equal(await page.getByRole('status').getByText(/neue Partien aus/).count(),0,
      'An invalid HTTP success must not announce that games were saved');
    await page.getByText('Partien: 40 von 620',{exact:true}).waitFor();
    allowValidProviderSummary();
    await submit.click();
    await page.getByRole('status').getByText(/100 neue Partien aus 200 abgerufenen Partien gespeichert/).waitFor();
    assert.equal(await page.getByRole('alert').count(),0);
    assert.deepEqual(pageErrors,[],'Bad provider summary and retry caused a JS exception');
    console.log('PASS German invalid provider counts report uncertainty and allow safe retry');
  } finally {await invalidProvider.context.close();}

  const darkSuccess=await newPage('dark',390,844,{locale:'de',providerImportBreakdown:true});
  try {
    const {page,pageErrors}=darkSuccess;
    await page.locator('button[aria-controls="library-import-controls"]').click();
    await page.getByRole('region',{name:'Letzte Partien importieren'})
      .getByRole('button',{name:/Von Chess.com importieren/}).click();
    const success=page.getByRole('status').getByText(/100 neue Partien aus 109 abgerufenen Partien gespeichert/);
    await success.waitFor();
    const contrast=await measureStatusContrast(success);
    assert.ok(contrast.ratio>=4.5,
      `Dark Library success text must meet 4.5:1 WCAG AA contrast: ${JSON.stringify(contrast)}`);
    await success.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'library-german-provider-import-result-dark-390.png')});
    assert.deepEqual(pageErrors,[],'Dark German provider result caused a JS exception');
    console.log(`PASS German dark success WCAG AA contrast ${contrast.ratio.toFixed(2)}:1`);
  } finally {await darkSuccess.context.close();}

  const germanDesktop=await newPage('dark',1440,900,{locale:'de'});
  try {
    const {page,pageErrors}=germanDesktop;
    const card=page.locator('a[href="/review/1"]');
    await card.locator('span.badge').getByText('Analysieren',{exact:true}).waitFor();
    await card.getByText('9.11.2026',{exact:true}).waitFor();
    await page.screenshot({path:join(output,'library-german-desktop-action-dark-1440.png')});
    assert.deepEqual(pageErrors,[],'German desktop Library caused a browser exception');
    console.log('PASS German desktop game-card Review action is translated');
  } finally {await germanDesktop.context.close();}

  const germanMobileStatus=await newPage('dark',390,844,{locale:'de'});
  try {
    const {page,pageErrors}=germanMobileStatus;
    await page.getByText('Noch nicht analysiert',{exact:true}).first().waitFor();
    await page.screenshot({path:join(output,'library-german-status-dark-390.png')});
    assert.deepEqual(pageErrors,[],'Localized mobile analysis status caused a JS exception');
    console.log('PASS German mobile Library shows an explicit translated unanalyzed state');
  } finally {await germanMobileStatus.context.close();}

  const timezoneBoundary=await newPage('light',390,844,{
    locale:'de',timeZone:'Asia/Dubai',dateBoundary:true,
  });
  try {
    const {page,pageErrors}=timezoneBoundary;
    await page.locator('a[href="/review/1"]').getByText('10.11.2026',{exact:true}).waitFor();
    assert.deepEqual(pageErrors,[], 'Localized near-midnight imported PGN caused a JS error');
    console.log('PASS German Library date respects a local day boundary in Dubai');
  } finally {await timezoneBoundary.context.close();}

  const narrowGerman=await newPage('light',320,700,{locale:'de'});
  try {
    const {page,pageErrors}=narrowGerman;
    const layout=await metrics(page);
    assert.ok(layout.overflow<=2,'German Library must not overflow at 320px');
    const starred=await page.getByRole('button',{name:'Alle Partien',exact:true}).boundingBox();
    const searchBox=await page.getByRole('searchbox').boundingBox();
    const controlSizes=await page.locator('#library-filters select, #library-filters input[type="date"]').evaluateAll(nodes=>nodes.map(node=>({
      label:node.getAttribute('aria-label'), height:node.getBoundingClientRect().height,
      width:node.getBoundingClientRect().width,
      x:node.getBoundingClientRect().x,
    })));
    assert.ok(starred && starred.height>=44,
      `The mobile Starred-only toggle must have a 44px target: ${JSON.stringify(starred)}`);
    assert.ok(searchBox && searchBox.height>=44,
      `The mobile Library search input must have a 44px target: ${JSON.stringify(searchBox)}`);
    assert.ok(controlSizes.length===7 && controlSizes.every(node=>node.height>=44 && node.x>=0 && node.x+node.width<=322),
      `Mobile Library filter/date controls need 44px unclipped targets: ${JSON.stringify(controlSizes)}`);
    for (const select of layout.selectSizes.filter(s=>s.width>0)) {
      assert.ok(select.x>=-2 && select.right<=322,
        `Localized narrow filter is clipped: ${JSON.stringify(select)}`);
    }
    const selectedOptions=await page.locator('#library-filters select').evaluateAll(nodes => nodes.map(select => {
      const style=getComputedStyle(select);
      const label=select.selectedOptions[0]?.textContent || '';
      const canvas=document.createElement('canvas');
      const ctx=canvas.getContext('2d');
      ctx.font=style.font;
      return {
        label, width:ctx.measureText(label).width,
        // The native-select chevron is already reserved by the right padding
        // in the app's .input style; do not deduct it a second time.
        available:select.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),
      };
    }));
    assert.ok(selectedOptions.every(choice=>choice.width<=choice.available+2),
      `German 320px selected options should remain readable: ${JSON.stringify(selectedOptions)}`);
    const search=await page.getByRole('searchbox').boundingBox();
    assert.ok(search && search.y>=0 && search.y+search.height<=700,
      'German returning players must see game search without scrolling at 320px');
    await page.screenshot({path:join(output,'library-german-filters-light-320.png')});
    assert.deepEqual(pageErrors,[],'German 320px Library produced a browser error');
    console.log('PASS German 320px filter layout, visible search and zero overflow');
  } finally {await narrowGerman.context.close();}

  const invertedDates=await newPage('light',390,844);
  try {
    const {page,pageErrors}=invertedDates;
    await page.goto(`${url}/review?from_date=2026-11-09&to_date=2026-11-01`);
    const start=page.getByLabel('Games from date');
    const end=page.getByLabel('Games through date');
    assert.equal(await start.inputValue(),'2026-11-09');
    assert.equal(await end.inputValue(),'');
    await page.waitForURL(href=>!(new URL(href)).searchParams.has('to_date'));
    await page.reload();
    assert.equal(await end.inputValue(),'');
    await start.fill('');
    await page.waitForURL(href=>!(new URL(href)).searchParams.has('from_date'));
    assert.equal(await end.inputValue(),'','Clearing a start date revived a previously rejected end date');
    assert.deepEqual(pageErrors,[],'Inverted date deep link produced a browser error');
    console.log('PASS inverted date range normalizes its URL and stays empty after reload and editing');
  } finally {await invertedDates.context.close();}

  const emptyGerman=await newPage('light',390,844,{locale:'de'});
  try {
    const {page,pageErrors}=emptyGerman;
    await page.getByRole('searchbox').fill('a-player-who-does-not-exist');
    const message=page.getByRole('status').getByText('Keine passenden Partien gefunden');
    await message.waitFor();
    const messageRect=await message.boundingBox();
    assert.ok(messageRect && messageRect.y>=0 && messageRect.y+messageRect.height<=844,
      `German empty-result explanation is below the first mobile screen: ${JSON.stringify(messageRect)}`);
    assert.equal(await page.getByRole('button',{name:'Filter zurücksetzen'}).count(),1,
      'An empty result should have one unambiguous reset action');
    await page.screenshot({path:join(output,'library-german-no-matches-light-390.png')});
    const recover=page.getByRole('button',{name:'Filter zurücksetzen'});
    assert.equal(await recover.count(),1,'Empty-state recovery should be clear in German');
    await recover.click();
    await page.waitForURL(href=>!(new URL(href)).searchParams.has('q'));
    await page.locator('a[href="/review/1"]').waitFor();
    await page.getByText('Partien: 40 von 620',{exact:true}).waitFor();
    assert.deepEqual(pageErrors,[], 'German empty-state filter reset caused a JS error');
    console.log('PASS German no-match recovery restores the saved Library and URL');
  } finally {await emptyGerman.context.close();}

  const clearSearchMobile=await newPage('light',320,700,{locale:'de'});
  try {
    const {page,pageErrors}=clearSearchMobile;
    const search=page.getByRole('searchbox');
    await search.fill('Opponent 501');
    await page.waitForURL(href=>new URL(href).searchParams.get('q')==='Opponent 501');
    await page.getByText('Partien: 1 von 1',{exact:true}).waitFor();
    const clear=page.getByRole('button',{name:/^(Suche löschen|Leeren)$/});
    const rect=await clear.boundingBox();
    assert.ok(rect && rect.width>=44 && rect.height>=44 && rect.x>=0 && rect.x+rect.width<=322,
      `Mobile search X needs a fully visible 44px touch target: ${JSON.stringify(rect)}`);
    assert.equal(await clear.getAttribute('aria-label'),'Suche löschen',
      'Search clear button should describe its action, not generic Clear');
    await page.screenshot({path:join(output,'library-search-clear-touch-light-320.png')});
    await clear.click();
    await page.waitForURL(href=>!(new URL(href)).searchParams.has('q'));
    await page.getByText('Partien: 40 von 620',{exact:true}).waitFor();
    assert.ok(await search.evaluate(el=>document.activeElement===el),
      'Clearing committed search should restore the search field keyboard focus');
    await search.fill('Opponent 502');
    await page.waitForURL(href=>new URL(href).searchParams.get('q')==='Opponent 502');
    await search.focus();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    await page.waitForURL(href=>!(new URL(href)).searchParams.has('q'));
    await page.getByText('Partien: 40 von 620',{exact:true}).waitFor();
    assert.deepEqual(pageErrors,[],'Clearing German mobile search caused a JS exception');
    console.log('PASS mobile search clear X and keyboard restore complete Library without stale URL query');
  } finally {await clearSearchMobile.context.close();}

  const noStarsGerman=await newPage('dark',390,844,{locale:'de',noStarredGames:true});
  try {
    const {page,pageErrors}=noStarsGerman;
    await page.getByRole('button',{name:'Alle Partien',exact:true}).click();
    await page.waitForURL(/bookmarked=1/);
    const message=page.getByRole('status').getByText('Noch keine markierten Partien');
    await message.waitFor();
    const showAll=page.getByRole('button',{name:'Alle Partien anzeigen'});
    await showAll.click();
    await page.waitForURL(href=>!(new URL(href)).searchParams.has('bookmarked'));
    await page.locator('a[href="/review/1"]').waitFor();
    assert.deepEqual(pageErrors,[], 'German empty-Starred-only recovery caused a JS error');
    console.log('PASS German empty Starred-only recovery returns to saved games');
  } finally {await noStarsGerman.context.close();}

  const errorFixture = await newPage('light', 390, 844, {failOpeningsOnce:true});
  try {
    const {page, pageErrors} = errorFixture;
    await page.getByRole('alert').getByText(/Opening highlights could not be loaded/).waitFor();
    await page.getByText('40 of 620 games').waitFor();
    await page.screenshot({path:join(output,'library-opening-retry-390.png')});
    await page.getByRole('button', {name:'Retry opening highlights'}).click();
    await page.getByRole('button', {name:'Show 310 saved games in Italian Game'}).waitFor();
    assert.equal(await page.getByRole('alert').count(),0,
      'Opening discovery error should disappear after a successful retry');
    assert.deepEqual(pageErrors,[], 'Opening summary retry produced a browser error');
    console.log('PASS partial opening summary failure with independent retry');
  } finally { await errorFixture.context.close(); }

  const pgnFixture = await newPage('dark', 390, 844);
  try {
    const {page, pageErrors, seenPgnFiles} = pgnFixture;
    await page.getByRole('button',{name:'Import more games'}).click();
    const good = '[Event "One"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 *\n\n' +
      '[Event "Two"]\n[White "Chris"]\n[Black "Dana"]\n\n1. d4 d5 *';
    const input = page.getByLabel('Choose a PGN file');
    const importButton = page.getByRole('button', {name:'Import PGN file'});
    assert.ok(await importButton.isDisabled(), 'PGN import should require a selected file');
    await input.setInputFiles({name:'history.pgn',mimeType:'text/plain',buffer:Buffer.from(good)});
    await importButton.click();
    const pgnSuccess=page.getByRole('status').getByText(/1 new games saved from 2 PGNs \(1 already saved\)/);
    await pgnSuccess.waitFor();
    const pgnSection=page.getByRole('region',{name:'Import a PGN file'});
    const resultRect=await pgnSuccess.boundingBox();
    const pgnRect=await pgnSection.boundingBox();
    assert.ok(resultRect && pgnRect && resultRect.y>=pgnRect.y+pgnRect.height &&
      resultRect.y<=pgnRect.y+pgnRect.height+24,
      'PGN success should be displayed directly after its own file controls');
    await page.getByText('2 of 2 games').waitFor();
    await page.getByText('Date unavailable').first().waitFor();
    assert.ok(await importButton.isDisabled(), 'Successful import must clear the file selection');
    assert.equal(seenPgnFiles[0],good, 'PGN text changed before upload');
    assert.equal(new URL(page.url()).searchParams.get('source'),'imported',
      'After import, users should see imported games rather than undated games lost at the end of history');
    await page.screenshot({path:join(output,'library-pgn-success-dark-390.png')});
    const bad = '[Event "One"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 *\n\n' +
      '[Event "Broken"]\n\n1. e4 e9 *';
    await input.setInputFiles({name:'broken.pgn',mimeType:'text/plain',buffer:Buffer.from(bad)});
    await importButton.click();
    await page.getByRole('alert').getByText(/Game 2: Invalid or incomplete PGN/).waitFor();
    await page.getByText('2 of 2 games').waitFor();
    await page.getByRole('button',{name:'Hide import options'}).click();
    await page.getByRole('alert').getByText(/Game 2: Invalid or incomplete PGN/).waitFor();
    assert.equal(await page.getByRole('button',{name:'Import PGN file'}).count(),0,
      'Collapsed imports must not expose hidden actions to the accessibility tree');
    await page.getByRole('button',{name:'Import more games'}).click();
    assert.equal(await input.evaluate(el=>el.files?.[0]?.name),'broken.pgn',
      'Closing import options discarded the selected file needed for retry');
    assert.equal(await importButton.isDisabled(),false,
      'The recoverable PGN import should still be retryable when reopened');
    const uploadsBeforeEncodingCheck = seenPgnFiles.length;
    const invalidEncoding = Buffer.concat([
      Buffer.from('[Event "Legacy"]\n[White "Jos'),
      Buffer.from([0xe9]), // Latin-1 é without a valid UTF-8 leading sequence
      Buffer.from('"]\n[Black "Bob"]\n\n1. e4 e5 *'),
    ]);
    await input.setInputFiles({name:'latin1.pgn',mimeType:'text/plain',buffer:invalidEncoding});
    await importButton.click();
    await page.getByRole('alert').getByText(/not valid UTF-8/).waitFor();
    assert.equal(seenPgnFiles.length, uploadsBeforeEncodingCheck,
      'Invalid UTF-8 was sent to the API as a corrupted PGN');
    const unicodePgn=good.replace('Alice','José');
    await input.setInputFiles({name:'unicode.pgn',mimeType:'text/plain',buffer:Buffer.from(unicodePgn,'utf8')});
    await importButton.click();
    await page.getByText(/1 new games saved from 2 PGNs/).waitFor();
    assert.equal(seenPgnFiles.at(-1),unicodePgn,
      'Valid accented player names must retain their original Unicode text');
    const reorderedPgn='[Site "Online"]\n[Event "Rated Rapid"]\n[SetUp "0"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 1-0\n\n'
      + '[White "Chris"]\n[Black "Dana"]\n\n1. d4 d5 0-1';
    const uploadCountBeforeReorder=seenPgnFiles.length;
    await input.setInputFiles({name:'reordered-headers.pgn',mimeType:'text/plain',buffer:Buffer.from(reorderedPgn)});
    await importButton.click();
    for(let i=0;i<30 && seenPgnFiles.length===uploadCountBeforeReorder;i++) await sleep(50);
    assert.equal(seenPgnFiles.at(-1),reorderedPgn,
      'The browser altered a PGN archive with valid non-Event-first headers');
    await page.getByText(/1 new games saved from 2 PGNs/).waitFor();
    await page.screenshot({path:join(output,'library-pgn-reordered-headers-dark-390.png')});
    const mismatched=good.replace('[Event "One"]','[Event "Invalid summary"]');
    await input.setInputFiles({name:'uncertain-report.pgn',mimeType:'text/plain',buffer:Buffer.from(mismatched)});
    await importButton.click();
    await page.getByRole('alert').getByText(/Import status could not be verified/).waitFor();
    assert.equal(await importButton.isDisabled(),false,
      'Unverifiable import summary should retain the selected file for safe retry');
    assert.equal(await page.getByText(/new games saved from/).count(),0,
      'The UI falsely claimed a complete PGN import despite inconsistent server counts');
    assert.deepEqual(pageErrors, [], 'PGN import UI had a JavaScript exception');
    console.log('PASS PGN file import, source filter, UTF-8 integrity, count validation, partial failure and recovery');
  } finally { await pgnFixture.context.close(); }

  const unknownNames = await newPage('light', 320, 700, {unknownImportedNames:true});
  try {
    const {page,pageErrors}=unknownNames;
    const card=page.locator('a[href="/review/9001"]');
    await card.waitFor();
    assert.equal(await card.getByText('Unknown player',{exact:true}).count(),2,
      'An imported game with no known players should not show empty player labels');
    await card.getByText('Date unavailable').waitFor();
    const missingLabels=await card.getByText('Unknown player',{exact:true}).evaluateAll(nodes=>nodes.map(node=>({
      scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,whiteSpace:getComputedStyle(node).whiteSpace,
    })));
    assert.ok(missingLabels.length===2 && missingLabels.every(label=>label.whiteSpace==='normal' &&
      label.scrollWidth<=label.clientWidth+1),
      `Unknown-player labels must wrap in full, not be cut off: ${JSON.stringify(missingLabels)}`);
    const cardBounds=await card.boundingBox();
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'library-unknown-players-light-320.png')});
    assert.ok(cardBounds && cardBounds.x>=0 && cardBounds.x+cardBounds.width<=322,
      'Unknown-player labels overflow a narrow mobile game card');
    assert.deepEqual(pageErrors,[], 'Unknown-player card produced a JavaScript error');
    console.log('PASS imported PGN without player headers has explicit mobile player labels');
  } finally { await unknownNames.context.close(); }

  const practiceUnknown=await newPage('dark',390,844,{
    locale:'de',unknownImportedNames:true,practiceForUnknownNames:true,
  });
  try {
    const {page,pageErrors}=practiceUnknown;
    const card=page.locator('a[href="/review/9001"]');
    assert.equal(await card.getByText('Unbekannter Spieler',{exact:true}).count(),2);
    await page.getByText('Analyse verfügbar',{exact:true}).waitFor();
    const practice=page.locator('a[href="/review/9001?practice=1"]');
    assert.equal(await practice.getAttribute('aria-label'),
      'Fehler in Unbekannter Spieler gegen Unbekannter Spieler ohne Lösungshinweise üben',
      'A dated imported game with blank players must announce both visible fallback identities');
    const target=await practice.boundingBox();
    assert.ok(target && target.height>=44 && target.x>=0 && target.x+target.width<=392,
      `Practice action with unknown identities must remain mobile touch-accessible: ${JSON.stringify(target)}`);
    await practice.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/review/9001?practice=1');
    assert.deepEqual(pageErrors,[], 'Practice navigation with missing imported identities caused a JS exception');
    console.log('PASS imported unknown players have a meaningful German Practice link and keyboard navigation');
  } finally {await practiceUnknown.context.close();}

  const longPlayers=await newPage('light',320,700,{longPlayerNames:true});
  try {
    const {page,pageErrors}=longPlayers;
    const card=page.locator('a[href="/review/9003"]');
    await card.scrollIntoViewIfNeeded();
    const bookmark=page.getByRole('button',{name:'Bookmark game',exact:true});
    const bookmarkBox=await bookmark.boundingBox();
    assert.ok(bookmarkBox && bookmarkBox.width>=44 && bookmarkBox.height>=44,
      `Mobile bookmark target is too small to tap reliably: ${JSON.stringify(bookmarkBox)}`);
    await card.focus();
    assert.ok(await card.evaluate(node=>document.activeElement===node),
      'The long-name game should have its own keyboard-focusable Review link');
    await page.keyboard.press('Tab');
    assert.ok(await bookmark.evaluate(node=>document.activeElement===node),
      'Tab must reach the bookmark action independently of the game link');
    await page.keyboard.press('Enter');
    const unbookmark=page.getByRole('button',{name:'Remove bookmark',exact:true});
    await unbookmark.waitFor();
    assert.equal(await unbookmark.getAttribute('aria-pressed'),'true',
      'Keyboard activation must save and announce the newly starred game');
    assert.equal(new URL(page.url()).pathname,'/review',
      'Bookmarking must not accidentally open Game Review');
    const m=await metrics(page);
    assert.ok(m.overflow<=2,`Long imported player names create horizontal overflow: ${m.overflow}px`);
    const playerNames=await card.locator('span.truncate.font-semibold').evaluateAll(nodes=>nodes.map(node=>({
      contentWidth:node.scrollWidth,visibleWidth:node.clientWidth,box:node.getBoundingClientRect().toJSON(),
    })));
    assert.equal(playerNames.length,2);
    assert.ok(playerNames.every(name=>name.box.x>=0 && name.box.right<=322),
      `Long player names escaped the mobile game card: ${JSON.stringify(playerNames)}`);
    await page.screenshot({path:join(output,'library-long-player-names-light-320.png')});
    await card.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/review/9003');
    assert.deepEqual(pageErrors,[], 'Long player names caused a browser exception');
    console.log('PASS long international names, mobile bookmark keyboard operation, and Review link navigation');
  } finally {await longPlayers.context.close();}

  const internationalHistory=await newPage('dark',390,844,{unicodeLibrary:true});
  try {
    const {page,pageErrors}=internationalHistory;
    const search=page.getByRole('searchbox');
    for(const [term,id] of [['josé',7001],['борис',7002],['café',7003]]) {
      await search.fill(term);
      await page.getByText('1 of 1 games').waitFor();
      await page.locator(`a[href="/review/${id}"]`).waitFor();
      assert.ok(queries.some(q=>new URLSearchParams(q).get('q')===term),
        `International search term was not sent unchanged: ${term}`);
    }
    const card=page.locator('a[href="/review/7003"]');
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'library-unicode-search-dark-390.png')});
    await search.fill('неизвестный');
    await page.getByText('No games match your search').waitFor();
    await page.getByRole('button',{name:'Clear filters'}).last().click();
    await page.getByText('3 of 3 games').waitFor();
    await page.locator('a[href="/review/7001"]').waitFor();
    assert.deepEqual(pageErrors,[], 'Unicode search produced a browser exception');
    console.log('PASS Unicode player searches through saved-game cards, URL params and empty-query recovery');
  } finally {await internationalHistory.context.close();}

  const discoverySwitch=await newPage('dark',390,844);
  try {
    const {page,pageErrors}=discoverySwitch;
    await page.getByRole('combobox',{name:'Sort games'}).selectOption('oldest');
    await page.getByRole('searchbox').fill('transient-search');
    await page.getByRole('button',{name:'Show 310 saved games in Italian Game'}).click();
    await page.getByText('Showing games in Italian Game').waitFor();
    await sleep(430); // No pending search debounce may revive stale text.
    const openingUrl=new URL(page.url()).searchParams;
    assert.equal(openingUrl.get('opening'),'Italian Game');
    assert.equal(openingUrl.get('sort'),'oldest');
    for(const stale of ['q','source','opponent','bookmarked']) assert.equal(openingUrl.has(stale),false,
      `Opening discovery unexpectedly retained ${stale}`);
    await page.getByRole('button',{name:'Opponents'}).click();
    const lichessChip=page.getByRole('button',{name:'Show 31 Lichess games against Nepo'});
    await lichessChip.click();
    await page.getByText('Showing Lichess games against Nepo').waitFor();
    await sleep(230);
    const selectedBorder=await lichessChip.evaluate(el=>getComputedStyle(el).borderTopColor);
    assert.equal(await lichessChip.getAttribute('aria-pressed'),'true');
    const opponentUrl=new URL(page.url()).searchParams;
    assert.equal(opponentUrl.get('source'),'lichess');
    assert.equal(opponentUrl.get('opponent'),'Nepo');
    assert.equal(opponentUrl.get('sort'),'oldest');
    assert.equal(opponentUrl.has('opening'),false);
    assert.equal(opponentUrl.has('q'),false);
    await page.getByRole('combobox',{name:'Game source'}).selectOption('chesscom');
    await page.getByText('Showing Lichess games against Nepo').waitFor({state:'detached'});
    const otherProvider=new URL(page.url()).searchParams;
    assert.equal(otherProvider.get('source'),'chesscom');
    assert.equal(otherProvider.has('opponent'),false,
      'A Lichess opponent identity leaked into a Chess.com filter');
    await lichessChip.hover();
    await sleep(230);
    assert.equal(await lichessChip.getAttribute('aria-pressed'),'false');
    const staleHoverBorder=await lichessChip.evaluate(el=>getComputedStyle(el).borderTopColor);
    assert.notEqual(staleHoverBorder,selectedBorder,
      'An unselected former opponent still uses the gold selected border while hovered');
    await page.getByRole('searchbox').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'library-discovery-filter-handoff-dark-390.png')});
    assert.deepEqual(pageErrors,[], 'Discovery filter switching produced a browser exception');
    console.log('PASS opening/opponent discovery handoffs with pending search and provider change');
  } finally {await discoverySwitch.context.close();}

  // Real first-use path: account has no linked providers and no saved games.
  // The empty-state CTA must open the native file picker and then navigate
  // directly to the imported games, rather than sending users to Settings.
  const firstUse = await newPage('light', 320, 700, {emptyLibrary:true,noLinked:true});
  try {
    const {page,pageErrors,seenPgnFiles}=firstUse;
    assert.equal(await page.getByRole('link',{name:'Connect a chess account'}).count(),1);
    assert.equal(await page.getByRole('link',{name:/Set Chess.com username/}).count(),0,
      'Empty-state account setup must not be duplicated in the header');
    const heroPicker = page.getByRole('button',{name:'Choose a PGN file to get started'});
    const heroBox = await heroPicker.boundingBox();
    assert.ok(heroBox && heroBox.y >= 0 && heroBox.y + heroBox.height <= 700,
      `First-use PGN action should be visible in the 320px mobile viewport: ${JSON.stringify(heroBox)}`);
    await page.screenshot({path:join(output,'library-firstuse-light-320.png')});
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),heroPicker.click(),
    ]);
    const pgn='[Event "First"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 *';
    await fileChooser.setFiles({name:'first-games.pgn',mimeType:'text/plain',buffer:Buffer.from(pgn)});
    await page.getByRole('button',{name:'Import PGN file'}).click();
    await page.getByText('2 of 2 games').waitFor();
    await page.locator('a[href="/review/9001"]').waitFor();
    const firstResult=page.getByRole('status').getByText(/1 new games saved from 2 PGNs/);
    await firstResult.waitFor();
    const firstResultRect=await firstResult.boundingBox();
    assert.ok(firstResultRect && firstResultRect.y>=0 && firstResultRect.y<700,
      `First-use import confirmation should remain visible after the panel collapses: ${JSON.stringify(firstResultRect)}`);
    assert.equal(await page.getByRole('status').count(),1,
      'First-use import must not duplicate the success announcement');
    assert.equal(await page.getByRole('button',{name:'Import more games'}).getAttribute('aria-expanded'),'false',
      'Import controls should return to their collapsed state after first-use completion');
    assert.equal(seenPgnFiles.at(-1),pgn);
    assert.equal(new URL(page.url()).searchParams.get('source'),'imported');
    assert.equal(await page.getByText('Your game history starts here').count(),0);
    await page.getByText('Date unavailable').first().waitFor();
    const m=await metrics(page);
    assert.ok(m.overflow <= 2, 'First PGN import introduced horizontal mobile overflow');
    assert.deepEqual(pageErrors,[], 'First-use flow threw a browser exception');
    await page.screenshot({path:join(output,'library-firstuse-imported-light-320.png')});
    console.log('PASS first-use empty unlinked library through PGN picker to first reviewable game');
  } finally {await firstUse.context.close();}

  const movingHistory = await newPage('dark',390,844,{changingHistory:true});
  try {
    const {page,pageErrors}=movingHistory;
    await page.getByRole('button',{name:'Load more games'}).click();
    await page.getByText('80 of 620 games').waitFor();
    assert.equal(await page.locator('a[href="/review/40"]').count(),1,
      'A concurrent import duplicated the original page boundary');
    assert.equal(await page.locator('a[href="/review/80"]').count(),1,
      'The moving library skipped game 80');
    assert.equal(await page.locator('a[href="/review/9999"]').count(),0,
      'An in-flight history snapshot unexpectedly incorporated a newer game');
    const gameLinks=await page.locator('a[href^="/review/"]').evaluateAll(els=>els
      .map(el=>el.getAttribute('href')).filter(href=>/^\/review\/\d+$/.test(href)));
    assert.equal(gameLinks.length,80);
    assert.equal(new Set(gameLinks).size,80);
    assert.ok(queries.some(q=>new URLSearchParams(q).has('cursor')),
      'Browser Load more never sent the new continuation token');
    await page.screenshot({path:join(output,'library-cursor-after-new-import-dark-390.png')});
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByText('40 of 621 games').waitFor();
    await page.locator('a[href="/review/9999"]').waitFor();
    assert.deepEqual(pageErrors,[], 'Cursor pagination produced a browser error');
    console.log('PASS stable cursor load-more after concurrent import and fresh history refresh');
  } finally {await movingHistory.context.close();}

  for (const delayedContinuation of ['success','failure']) {
    const lagged = await newPage('light',390,844,{delayedContinuation});
    try {
      const {page,pageErrors,releaseContinuation}=lagged;
      const pending=page.waitForRequest(req=>{
        const parsed=new URL(req.url());
        return parsed.pathname==='/api/games' && parsed.searchParams.get('offset')==='40' &&
          !parsed.searchParams.has('source');
      });
      await page.getByRole('button',{name:'Load more games'}).click();
      await pending;
      await page.getByRole('combobox',{name:'Game source'}).selectOption('lichess');
      await page.getByText('40 of 310 games').waitFor();
      assert.equal(await page.locator('a[href="/review/1"]').count(),0,
        'Old Chess.com game leaked into the new Lichess-only collection');
      releaseContinuation();
      await sleep(550);
      await page.getByText('40 of 310 games').waitFor();
      assert.equal(await page.locator('a[href="/review/1"]').count(),0,
        `A late ${delayedContinuation} appended a stale game into the new filtered collection`);
      assert.equal(await page.getByText(/Could not load more games/).count(),0,
        'An old continuation failure must not appear as a failure of the new filter');
      await page.getByRole('button',{name:'Load more games'}).click();
      await page.getByText('80 of 310 games').waitFor();
      assert.deepEqual(pageErrors,[], 'Switching filters during a pending page caused a browser error');
      console.log(`PASS late ${delayedContinuation} continuation cannot contaminate another Library filter`);
    } finally {lagged.releaseContinuation(); await lagged.context.close();}
  }

  const failedPage=await newPage('dark',320,700,{locale:'de',failContinuationUntilRetry:true});
  try {
    const {page,pageErrors,allowContinuationRetry}=failedPage;
    await page.getByRole('button',{name:'Weitere Partien laden'}).click();
    await page.getByRole('alert').getByText('Weitere Partien konnten nicht geladen werden. Deine bereits geladenen Partien bleiben verfügbar.').waitFor({timeout:40000});
    assert.equal(await page.locator('a[href="/review/1"]').count(),1,
      'A failed continuation must preserve the first page of saved games');
    await page.getByText('Partien: 40 von 620',{exact:true}).waitFor();
    const retry=page.getByRole('button',{name:'Erneut versuchen'});
    const rect=await retry.boundingBox();
    assert.ok(rect && rect.height>=44 && rect.x>=0 && rect.x+rect.width<=322,
      `Failed continuation needs a 44px unclipped mobile Retry target: ${JSON.stringify(rect)}`);
    await retry.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'library-load-more-error-dark-320.png')});
    allowContinuationRetry();
    await retry.click();
    await page.getByText('Partien: 80 von 620',{exact:true}).waitFor();
    assert.equal(await page.locator('a[href^="/review/"]:not([href*="?"])').count(),80,
      'Continuation retry must append exactly 40 distinct game cards');
    assert.equal(await page.getByRole('alert').count(),0);
    assert.deepEqual(pageErrors,[], 'Mobile continuation failure/recovery caused a JS exception');
    console.log('PASS German 320px continuation failure keeps existing games and retries without duplication');
  } finally {await failedPage.context.close();}

  const starred = await newPage('dark',390,844,{starredOnlyScenario:true});
  try {
    const {page,pageErrors}=starred;
    await page.getByRole('button',{name:'All games'}).click();
    await page.getByText('40 of 56 games').waitFor();
    const firstStar=page.locator('a[href="/review/11"]').locator('..')
      .getByRole('button',{name:'Remove bookmark'});
    await firstStar.click();
    assert.equal(await firstStar.getAttribute('aria-pressed'),'true',
      'A pending unbookmark must not show an unstarred card in Starred only');
    assert.equal(await page.getByRole('button',{name:'Bookmark game'}).count(),0);
    await page.locator('a[href="/review/11"]').waitFor({state:'detached'});
    await page.getByText('40 of 55 games').waitFor();
    const failingStar=page.locator('a[href="/review/22"]').locator('..')
      .getByRole('button',{name:'Remove bookmark'});
    await failingStar.click();
    const starError=page.getByRole('alert').getByText(/Bookmark could not be saved/);
    await starError.waitFor();
    assert.equal(await page.locator('a[href="/review/22"]').count(),1,
      'A failed unbookmark must retain the starred game for retry');
    assert.equal(await failingStar.getAttribute('aria-pressed'),'true');
    const errorRect=await starError.boundingBox();
    const starRect=await failingStar.boundingBox();
    assert.ok(errorRect && starRect && errorRect.y >= starRect.y + starRect.height - 1 &&
      errorRect.x >= -2 && errorRect.x + errorRect.width <= 392,
    `Bookmark error must appear beneath the star button, without mobile overflow: ${JSON.stringify({errorRect,starRect})}`);
    await page.locator('a[href="/review/22"]').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'library-starred-failed-removal-dark-390.png')});
    assert.deepEqual(pageErrors,[], 'Starred-only bookmark retry caused a JS error');
    console.log('PASS Starred-only pending bookmark removal, server success and retryable failure');
  } finally {await starred.context.close();}

  const germanBookmarkError=await newPage('dark',390,844,{locale:'de',starredOnlyScenario:true});
  try {
    const {page,pageErrors}=germanBookmarkError;
    await page.getByRole('button',{name:'Alle Partien',exact:true}).click();
    await page.getByText('Partien: 40 von 56',{exact:true}).waitFor();
    const failed=page.locator('a[href="/review/22"]').locator('..')
      .getByRole('button',{name:'Markierung entfernen'});
    await failed.click();
    await page.getByRole('alert').getByText('Markierung konnte nicht gespeichert werden. Bitte erneut versuchen.').waitFor();
    assert.equal(await failed.getAttribute('aria-pressed'),'true',
      'Failed bookmark updates must keep the previous starred state');
    assert.deepEqual(pageErrors,[], 'German bookmark failure label caused a browser exception');
    console.log('PASS German bookmark error explains the retryable starred state');
  } finally {await germanBookmarkError.context.close();}

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
    // Provider-qualified encounter discovery must not mix identical names on
    // Chess.com and Lichess, and switching sources clears the scoped filter.
    await page.getByRole('button', {name:'Opponents'}).click();
    await page.getByRole('button', {name:'Show 31 Lichess games against Nepo'}).click();
    await page.getByText('31 of 31 games').waitFor();
    const lichessRivalParams = new URL(page.url()).searchParams;
    assert.equal(lichessRivalParams.get('source'), 'lichess');
    assert.equal(lichessRivalParams.get('opponent'), 'Nepo');
    assert.ok(queries.some(q => {
      const p=new URLSearchParams(q);
      return p.get('source') === 'lichess' && p.get('opponent') === 'Nepo';
    }), 'Provider-qualified opponent filter did not reach the API');
    await page.getByRole('combobox', {name:'Game source'}).selectOption('chesscom');
    await page.getByText('40 of 310 games').waitFor();
    assert.equal(new URL(page.url()).searchParams.has('opponent'), false,
      'Provider change must clear the previously selected opponent');
    await page.getByRole('button', {name:'Show 15 Chess.com games against Nepo'}).click();
    await page.getByText('15 of 15 games').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('source'), 'chesscom');
    await page.getByRole('button', {name:'Clear filters'}).click();
    await page.getByText('40 of 620 games').waitFor();
    await page.getByRole('button', {name:'Openings'}).click();
    await page.getByRole('button', {name:'Show 310 saved games in Italian Game'}).click();
    await page.getByText('40 of 310 games').waitFor();
    const exactOpening = new URL(page.url()).searchParams;
    assert.equal(exactOpening.get('opening'), 'Italian Game');
    assert.equal(exactOpening.has('result'), false);
    assert.ok(queries.some(q => new URLSearchParams(q).get('opening') === 'Italian Game'),
      'Exact opening selection did not reach the server');
    await page.getByRole('button', {name:'Clear filters'}).click();
    await page.getByText('40 of 620 games').waitFor();
    // Opening discovery should search all saved games, not only visible cards.
    await page.getByRole('searchbox').fill('Italian Game');
    await page.getByText('40 of 310 games').waitFor();
    assert.ok(queries.some(p => new URLSearchParams(p).get('q') === 'Italian Game'),
      'Opening search never reached the paginated backend');
    await page.getByRole('searchbox').fill('');
    await page.getByText('40 of 620 games').waitFor();
    // Calendar-day filtering must search the server-side full history and
    // include the entire selected ending day, not just midnight.
    await page.getByLabel('Games from date').fill('2026-10-01');
    await page.getByLabel('Games through date').fill('2026-10-05');
    await page.getByText('5 of 5 games').waitFor();
    assert.ok(queries.some(p => p.includes('from_date=2026-10-01') && p.includes('to_date=2026-10-05')),
      'Date boundaries were not forwarded to the server-side API');
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
    await page.getByRole('button',{name:'Import more games'}).click();
    await page.getByRole('button',{name:/@fixtureuser/}).first().click();
    await page.getByText(/100 new games saved from 200 retrieved/).waitFor();
    await page.getByText(/7 existing games gained opening details/).waitFor();
    await page.getByText(/not your entire history/).waitFor();
    await page.getByRole('combobox',{name:'Recent games to fetch'}).selectOption('20');
    await page.getByRole('button',{name:/@fixtureuser/}).first().click();
    await page.getByText(/10 new games saved from 20 retrieved/).waitFor();
    await page.getByRole('combobox',{name:'Recent games to fetch'}).selectOption('100');
    await page.getByRole('button',{name:/Import from Chess.com/}).click();
    await page.getByRole('alert').getByText(/Chess.com is limiting requests/).waitFor();
    await page.getByRole('button',{name:/Import from Lichess/}).click();
    await page.getByRole('alert').getByText(/Your linked account changed during import/).waitFor();
    await page.getByRole('combobox',{name:'Recent games to fetch'}).selectOption('20');
    await page.getByRole('button',{name:/Import from Lichess/}).click();
    await page.getByRole('alert').getByText(/Lichess can't be reached right now/).waitFor();
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
