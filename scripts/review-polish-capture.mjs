#!/usr/bin/env node
/** Real, isolated Game Review visual audit. All PGNs and engine scores below
 * are synthetic presentation fixtures in a disposable SQLite database.
 * Requires a successful `npm run build`; never touches production state. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
// An isolated QA installation can be supplied without modifying shared
// workspace dependencies: PATZER_PLAYWRIGHT_MODULE=/absolute/path/index.mjs.
const { chromium } = await import(process.env.PATZER_PLAYWRIGHT_MODULE || 'playwright');
import { Chess } from 'chess.js';

const scratch = mkdtempSync(join(tmpdir(), 'patzer-review-polish-'));
const output = resolve(process.env.PATZER_POLISH_OUTPUT || 'qa-artifacts/review-polish/baseline');
const port = process.env.PATZER_POLISH_PORT || '8917';
const base = `http://127.0.0.1:${port}`;
Object.assign(process.env, { DB_PATH: join(scratch, 'test.db'), HOST: '127.0.0.1',
  PORT: port, SESSION_SECRET: 'review-polish-synthetic-only', UPDATE_CHECK: '0',
  OIDC_ISSUER: '', OIDC_CLIENT_ID: '' });
mkdirSync(output, { recursive: true });
const sizes = [[1920,1080], [1728,900], [1440,900], [1366,768], [1024,768], [390,844]];
const measurements = [];
let browser, db;

async function api(path, { method='GET', cookie, body } = {}) {
  const response = await fetch(base+path, { method,
    headers: { 'Content-Type':'application/json',
      ...(method !== 'GET' ? { 'X-Requested-With':'patzer' } : {}),
      ...(cookie ? { Cookie:cookie } : {}) },
    ...(body === undefined ? {} : { body:JSON.stringify(body) }),
  });
  return { status:response.status, json:await response.json(), cookie:response.headers.get('set-cookie')?.split(';')[0] };
}

function seed(userId, scoringVersion, analysisSourceHash, loadAnalysisGameSource) {
  const chess = new Chess();
  const sans = ['e4','e5','Nf3','Nc6','Bc4','Bc5','c3','Nf6',
    'd3','d6','O-O','O-O','Re1','a6','Bb3','Ba7',
    'h3','h6','Nbd2','Be6','Nf1','Qd7','Ng3','Rad8'];
  const classifications = ['book','book','best','excellent','great','good',
    'inaccuracy','mistake','best','good','excellent','best','brilliant',
    'good','inaccuracy','good','mistake','miss','good','best','good',
    'blunder','excellent','forced'];
  const moves = sans.map((san, index) => {
    const before = chess.fen(), move = chess.move(san);
    assert.ok(move, `Invalid synthetic move ${san}`);
    const ply = index + 1;
    return { ply, san:move.san, uci:move.from+move.to+(move.promotion || ''),
      fen_before:before, fen_after:chess.fen(),
      eval_before_cp:ply === 1 ? null : (ply-1)%5*38-75,
      eval_after_cp:ply%5*38-75,
      best_move_uci:move.from+move.to+(move.promotion || ''),
      best_move_san:move.san, best_pv:[], centipawn_loss:0,
      classification:classifications[index],
    };
  });
  const id=Number(db.prepare(`INSERT INTO games
    (user_id,source,external_id,pgn,white,black,result,time_control,end_time,user_color)
    VALUES (?,'imported','polish-example',?,'Sample White','Sample Black','*','600',datetime('now'),'white')`)
    .run(userId,chess.pgn()).lastInsertRowid);
  const source = loadAnalysisGameSource(db,id);
  assert.ok(source);
  db.prepare(`INSERT INTO analyses
    (game_id,depth,moves_json,accuracy_white,accuracy_black,scoring_version,
    source_hash,source_revision,analysis_generation)
    VALUES (?,12,?,81.3,76.8,?,?,?,1)`)
    .run(id,JSON.stringify(moves),scoringVersion,analysisSourceHash(source),source.source_revision);
  return id;
}

async function measure(page,width,height,theme) {
  await page.locator('[data-review-workspace]').waitFor({state:'visible'});
  await page.locator('cg-board').first().waitFor({state:'visible'});
  await page.evaluate(async()=>await document.fonts.ready);
  const boxes=await page.evaluate(()=>{
    const rect=(selector)=>{
      const el=document.querySelector(selector); if(!el)return null;
      const r=el.getBoundingClientRect();
      return {x:+r.x.toFixed(1),y:+r.y.toFixed(1),width:+r.width.toFixed(1),
        height:+r.height.toFixed(1),bottom:+r.bottom.toFixed(1)};
    };
    return {board:rect('cg-board'), rail:rect('[data-review-side-rail]'),
      workspace:rect('[data-review-workspace]'), transport:rect('[data-move-transport]'),
      documentHeight:document.documentElement.scrollHeight,
      horizontalOverflow:document.documentElement.scrollWidth-innerWidth,
      themeRendered:document.documentElement.classList.contains('dark')?'dark':'light',
      visibleRailSections:[...document.querySelectorAll('[data-review-side-rail] > *')]
        .filter(el=>el.getBoundingClientRect().top<innerHeight).length,
    };
  });
  assert.ok(boxes.board && boxes.board.width>175,'Board missing');
  assert.ok(Math.abs(boxes.board.width-boxes.board.height)<3,'Board not square');
  assert.ok(boxes.horizontalOverflow<=2,`Horizontal overflow: ${boxes.horizontalOverflow}`);
  assert.equal(boxes.themeRendered,theme);
  if(width>=960){
    assert.ok(boxes.rail && boxes.rail.y <= boxes.board.y,
      'The analysis rail must not begin below the chessboard on landscape screens');
    assert.ok(boxes.transport && boxes.transport.bottom <= height,
      `Move transport fell below the viewport: ${boxes.transport?.bottom}px > ${height}px`);
  }
  measurements.push({viewport:`${width}x${height}`,theme,...boxes});
  const label=`${theme}-${width}x${height}`;
  await page.screenshot({path:join(output,label+'-viewport.png')});
  if(width===1920||width===390)await page.screenshot({path:join(output,label+'-full.png'),fullPage:true});
}

try {
  ({db}=await import('../server/dist/db.js'));
  const {SCORING_VERSION}=await import('../server/dist/chess/classifier.js');
  const {analysisSourceHash,loadAnalysisGameSource}=await import('../server/dist/chess/analysisSource.js');
  await import('../server/dist/index.js');
  let health=false;
  for(let i=0;i<40;i++){
    try{health=(await api('/api/health')).status===200;}catch{/* server startup */}
    if(health)break;
    await sleep(100);
  }
  assert.ok(health,'Disposable server failed to start');
  const account=await api('/api/setup/init',{method:'POST',body:{username:'polishaudit',
    password:'synthetic-password-123',display_name:'Fixture User',language:'en'}});
  assert.equal(account.status,200,JSON.stringify(account.json));
  assert.ok(account.cookie);
  const user=db.prepare('SELECT id FROM users WHERE username = ?').get('polishaudit');
  const id=seed(user.id,SCORING_VERSION,analysisSourceHash,loadAnalysisGameSource);
  browser=await chromium.launch({headless:true});
  for(const theme of ['light','dark']){
    const setting=await api('/api/settings/profile',{method:'PATCH',cookie:account.cookie,body:{site_theme:theme}});
    assert.equal(setting.status,200,JSON.stringify(setting.json));
    for(const [width,height] of sizes){
      const context=await browser.newContext({viewport:{width,height},colorScheme:theme});
      await context.addCookies([{name:account.cookie.split('=')[0],
        value:account.cookie.split('=').slice(1).join('='),url:base}]);
      const page=await context.newPage(),errors=[];
      page.on('pageerror',err=>errors.push(err.message));
      await page.goto(`${base}/review/${id}?ply=15`,{waitUntil:'domcontentloaded'});
      await measure(page,width,height,theme);
      if(width===1024){
        // Exercise the compact landscape rail, not just its pixels. Keyboard
        // navigation must select a real tab, and transport must advance the
        // original PGN without writing anything to the persisted source.
        const movesTab=page.getByRole('tab',{name:'Moves'});
        await movesTab.focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.getByRole('tab',{name:'AI report'}).getAttribute('aria-selected'),'true');
        await page.keyboard.press('ArrowLeft');
        assert.equal(await movesTab.getAttribute('aria-selected'),'true');
        const transport=page.locator('[data-move-transport]');
        const oldText=await transport.innerText();
        const previousPgn=db.prepare('SELECT pgn FROM games WHERE id = ?').get(id).pgn;
        await transport.locator('button').nth(2).click();
        assert.notEqual(await transport.innerText(),oldText,'Next move did not advance');
        assert.equal(db.prepare('SELECT pgn FROM games WHERE id = ?').get(id).pgn,previousPgn,
          'Move navigation must not rewrite the saved PGN');
      }
      assert.deepEqual(errors,[],`${theme} ${width}x${height} runtime errors`);
      await context.close();
    }
  }
  writeFileSync(join(output,'metrics.json'),JSON.stringify(measurements,null,2)+'\n');
  console.log(JSON.stringify({output,measurements},null,2));
}catch(error){console.error(error);process.exitCode=1;}
finally{await browser?.close(); db?.close(); rmSync(scratch,{recursive:true,force:true});}
process.exit(process.exitCode||0);
