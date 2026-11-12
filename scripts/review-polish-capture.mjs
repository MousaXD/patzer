#!/usr/bin/env node
/** Real, isolated Game Review visual audit. All PGNs and engine scores below
 * are synthetic presentation fixtures in a disposable SQLite database.
 * Requires a successful `npm run build`; never touches production state. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/** Chromium-rendered text contrast against composite ancestor backgrounds.
 * Read actual theme colors; never hardcode an assumed dark surface. */
async function renderedContrast(page, selector) {
  return page.evaluate((selector)=>{
    const el=document.querySelector(selector);
    assertPresent(el);
    const parse=(css)=>{
      const values=css.match(/[\d.]+/g)?.map(Number) ?? [];
      return values.length>=3 ? [...values.slice(0,3),values[3]??1] : [0,0,0,0];
    };
    const ancestors=[];
    for(let p=el;p;p=p.parentElement)ancestors.unshift(p);
    const bg=ancestors.reduce((base,node)=>{
      const [r,g,b,a]=parse(getComputedStyle(node).backgroundColor);
      return [r,g,b].map((v,i)=>v*a+base[i]*(1-a));
    },[255,255,255]);
    const rgb=parse(getComputedStyle(el).color).slice(0,3);
    const lum=([r,g,b])=>[r,g,b].map(v=>{
      const n=v/255;return n<=.04045?n/12.92:Math.pow((n+.055)/1.055,2.4);
    }).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    const a=lum(rgb),b=lum(bg);
    return +((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toFixed(2);
    function assertPresent(node){if(!node)throw new Error('Missing visible text for contrast audit: '+selector);}
  },selector);
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
      graphMarkerAspectRatios:[...document.querySelectorAll('svg[role="slider"] circle[stroke="#fff"], [data-eval-graph-marker]')]
        .slice(0,12).map(el=>{ const r=el.getBoundingClientRect();
          return r.height ? +(r.width/r.height).toFixed(2) : null; }),
      documentHeight:document.documentElement.scrollHeight,
      horizontalOverflow:document.documentElement.scrollWidth-innerWidth,
      themeRendered:document.documentElement.classList.contains('dark')?'dark':'light',
      visibleRailSections:[...document.querySelectorAll('[data-review-side-rail] > *')]
        .filter(el=>el.getBoundingClientRect().top<innerHeight).length,
    };
  });
  assert.ok(boxes.board && boxes.board.width>175,'Board missing');
  assert.ok(Math.abs(boxes.board.width-boxes.board.height)<3,'Board not square');
  assert.ok(boxes.graphMarkerAspectRatios.length>0,'Evaluation classification markers are missing');
  assert.ok(boxes.graphMarkerAspectRatios.every((ratio)=>ratio!==null && ratio>=0.9 && ratio<=1.1),
    `Evaluation markers must render as circles, not distorted ovals: ${JSON.stringify(boxes.graphMarkerAspectRatios)}`);
  assert.ok(boxes.horizontalOverflow<=2,`Horizontal overflow: ${boxes.horizontalOverflow}`);
  assert.equal(boxes.themeRendered,theme);
  if(width>=960){
    assert.ok(boxes.rail && boxes.rail.y <= boxes.board.y,
      'The analysis rail must not begin below the chessboard on landscape screens');
    assert.ok(boxes.transport && boxes.transport.bottom <= height,
      `Move transport fell below the viewport: ${boxes.transport?.bottom}px > ${height}px`);
  }
  if(width===1024){
    const tabs=await page.getByRole('tab').evaluateAll((elements)=>elements.map(tab=>{
      const label=tab.querySelector('span');
      const icon=tab.querySelector('svg');
      return {name:tab.getAttribute('aria-label'),
        textWidth:label?.scrollWidth??0,available:label?.clientWidth??0,
        iconVisible:!!icon && getComputedStyle(icon).display!=='none'};
    }));
    console.log('1024px review tab labels:',JSON.stringify(tabs));
    assert.ok(tabs.length===3 && tabs.every(item=>item.textWidth<=item.available),
      `Review tab names must not be clipped in the 1024px cockpit: ${JSON.stringify(tabs)}`);
  }
  measurements.push({viewport:`${width}x${height}`,theme,...boxes});
  const label=`${theme}-${width}x${height}`;
  await page.screenshot({path:join(output,label+'-viewport.png')});
  if(width===1920||width===390)await page.screenshot({path:join(output,label+'-full.png'),fullPage:true});
}

try {
  ({db}=await import('../server/dist/db.js'));
  const {SCORING_VERSION,cpToWinPct}=await import('../server/dist/chess/classifier.js');
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
  // A legitimate terminal position returns zero candidate PVs. Distinguish
  // it from a provider returning no suggestions for an otherwise playable
  // position; a bare dash provides neither guidance nor a useful Retry.
  const finishedGame=new Chess();
  for(const san of ['f3','e5','g4','Qh4#']) assert.ok(finishedGame.move(san));
  assert.ok(finishedGame.isCheckmate());
  const terminalId=Number(db.prepare(`INSERT INTO games
    (user_id,source,external_id,pgn,white,black,result,time_control,end_time,user_color)
    VALUES (?,'imported','polish-terminal-mate',?,'Mate White','Mate Black','0-1','600',datetime('now'),'white')`)
    .run(user.id,finishedGame.pgn()).lastInsertRowid);
  // The Engine Lines disclosure currently lives inside the scored review
  // rail. Supply a genuine source-matched *test-only* analyzed move list so
  // this fixture exercises that mounted UI instead of the unscored replay.
  const terminalReplay=new Chess();
  const terminalMoves=finishedGame.history({verbose:true}).map((move,index)=>{
    const fen_before=terminalReplay.fen();
    const played=terminalReplay.move(move.san);
    assert.ok(played);
    return {ply:index+1,san:played.san,uci:played.from+played.to+(played.promotion||''),
      fen_before,fen_after:terminalReplay.fen(),eval_before_cp:0,eval_after_cp:0,
      best_move_uci:played.from+played.to+(played.promotion||''),best_move_san:played.san,
      best_pv:[],centipawn_loss:0,classification:'best'};
  });
  assert.equal(terminalReplay.fen(),finishedGame.fen());
  const terminalSource=loadAnalysisGameSource(db,terminalId);
  assert.ok(terminalSource);
  db.prepare(`INSERT INTO analyses
    (game_id,depth,moves_json,accuracy_white,accuracy_black,scoring_version,
    source_hash,source_revision,analysis_generation)
    VALUES (?,12,?,80,80,?,?,?,1)`)
    .run(terminalId,JSON.stringify(terminalMoves),SCORING_VERSION,
      analysisSourceHash(terminalSource),terminalSource.source_revision);
  const terminalSavedPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(terminalId).pgn;
  const terminalContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await terminalContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await terminalContext.newPage();
    let candidateRequests=0;
    await page.route('**/api/analyze/position',async route=>{
      const request=route.request().postDataJSON();
      assert.equal(request.fen,finishedGame.fen());
      candidateRequests++;
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        fen:finishedGame.fen(),depth:0,lines:[],
      })});
    });
    await page.goto(`${base}/review/${terminalId}?ply=4`,{waitUntil:'domcontentloaded'});
    const terminalRequest=page.waitForResponse(response=>response.url().endsWith('/api/analyze/position') && response.status()===200);
    await page.getByRole('button',{name:'Engine lines',exact:true}).click();
    await terminalRequest;
    await page.getByText('Checkmate. No legal moves remain.',{exact:true}).waitFor({state:'visible',timeout:5000});
    assert.equal(candidateRequests,1);
    assert.equal(await page.getByRole('button',{name:'Retry',exact:true}).count(),0,
      'A finished checkmate must not imply that retrying the engine will generate a legal move');
    await page.locator('#review-engine-lines-content').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'engine-lines-terminal-checkmate-390.png')});
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(terminalId).pgn,terminalSavedPgn);
  }finally{await terminalContext.close();}
  // A custom-FEN game can finish in stalemate after just one saved move.
  // Confirm that a Black-to-move terminal board announces the *draw*, not
  // checkmate or an unavailable engine, using the actual source-attested PGN.
  const stalemateInitialFen='7k/4Q3/6K1/8/8/8/8/8 w - - 0 1';
  const stalemateGame=new Chess(stalemateInitialFen);
  stalemateGame.setHeader('SetUp','1');stalemateGame.setHeader('FEN',stalemateInitialFen);
  stalemateGame.setHeader('Result','1/2-1/2');
  const stalemateBefore=stalemateGame.fen();
  const stalemateMove=stalemateGame.move('Qf7');
  assert.ok(stalemateMove && stalemateGame.isStalemate());
  const stalemateId=Number(db.prepare(`INSERT INTO games
    (user_id,source,external_id,pgn,white,black,result,time_control,end_time,user_color)
    VALUES (?,'imported','polish-terminal-stalemate',?,'Draw White','Draw Black','1/2-1/2','600',datetime('now'),'white')`)
    .run(user.id,stalemateGame.pgn()).lastInsertRowid);
  const stalemateSource=loadAnalysisGameSource(db,stalemateId);
  assert.ok(stalemateSource);
  db.prepare(`INSERT INTO analyses
    (game_id,depth,moves_json,accuracy_white,accuracy_black,scoring_version,
    source_hash,source_revision,analysis_generation)
    VALUES (?,12,?,80,80,?,?,?,1)`)
    .run(stalemateId,JSON.stringify([{
      ply:1,san:stalemateMove.san,uci:stalemateMove.from+stalemateMove.to,
      fen_before:stalemateBefore,fen_after:stalemateGame.fen(),
      eval_before_cp:0,eval_after_cp:0,best_move_uci:'e7f7',best_move_san:'Qf7',
      best_pv:[],centipawn_loss:0,classification:'best',
    }]),SCORING_VERSION,analysisSourceHash(stalemateSource),stalemateSource.source_revision);
  const stalemateContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await stalemateContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await stalemateContext.newPage();
    let requests=0;
    await page.route('**/api/analyze/position',async route=>{
      assert.equal(route.request().postDataJSON().fen,stalemateGame.fen());
      requests++;
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        fen:stalemateGame.fen(),depth:0,lines:[],
      })});
    });
    await page.goto(`${base}/review/${stalemateId}?ply=1`,{waitUntil:'domcontentloaded'});
    const response=page.waitForResponse(result=>result.url().endsWith('/api/analyze/position') && result.status()===200);
    await page.getByRole('button',{name:'Engine lines',exact:true}).click();
    await response;
    await page.getByText('Stalemate. No legal moves remain; the game is drawn.',{exact:true})
      .waitFor({state:'visible',timeout:5000});
    assert.equal(requests,1);
    assert.equal(await page.getByRole('button',{name:'Retry',exact:true}).count(),0,
      'A stalemate position must not offer an engine Retry for nonexistent legal moves');
    assert.equal(await page.getByText('Checkmate. No legal moves remain.',{exact:true}).count(),0);
    await page.locator('#review-engine-lines-content').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'engine-lines-terminal-stalemate-390.png')});
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(stalemateId).pgn,stalemateGame.pgn());
  }finally{await stalemateContext.close();}
  const emptyNonterminalContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await emptyNonterminalContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await emptyNonterminalContext.newPage();
    const initialFen=new Chess().fen();
    let requests=0;
    await page.route('**/api/analyze/position',async route=>{
      assert.equal(route.request().postDataJSON().fen,initialFen);
      requests++;
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        fen:initialFen,depth:12,lines:requests===1 ? [] : [
          {uci:'e2e4',san:'e4',pv_san:['e4','e5'],cp:40,mate:null,multipv:1},
        ],
      })});
    });
    const originalPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    await page.goto(`${base}/review/${id}?ply=0`,{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Engine lines',exact:true}).click();
    await page.getByText('The engine returned no continuations for this position.',{exact:true})
      .waitFor({state:'visible',timeout:5000});
    assert.equal(requests,1);
    assert.equal(await page.getByText('Checkmate. No legal moves remain.',{exact:true}).count(),0,
      'An ordinary playable position with no engine PV must never be announced as checkmate');
    const retryEmpty=page.getByRole('button',{name:'Retry',exact:true});
    await retryEmpty.waitFor({state:'visible',timeout:3000});
    const emptyTarget=await retryEmpty.boundingBox();
    assert.ok(emptyTarget && emptyTarget.width>=44 && emptyTarget.height>=44,
      'An empty playable result must expose a usable 44px Retry action');
    await page.locator('#review-engine-lines-content').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'engine-lines-empty-nonterminal-390.png')});
    await retryEmpty.focus();
    await page.keyboard.press('Enter');
    const recovered=page.getByRole('button',{name:'Follow played move e4'});
    await recovered.waitFor({state:'visible',timeout:5000});
    assert.equal(requests,2,'Retrying a valid but empty position should fetch new live candidates');
    assert.equal((await recovered.locator('[data-review-engine-line-score]').innerText()).trim(),'+0.40');
    assert.equal(await page.evaluate(()=>document.activeElement?.id),'review-engine-lines-content',
      'Retry must keep keyboard focus in the persistent Engine Lines region');
    await page.keyboard.press('Tab');
    assert.ok(await recovered.evaluate(el=>document.activeElement===el),
      'Tab from an empty-result retry must reach the recovered legal move');
    await recovered.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'engine-lines-empty-nonterminal-recovered-390.png')});
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,originalPgn);
  }finally{await emptyNonterminalContext.close();}
  for(const theme of ['light','dark']){
    const setting=await api('/api/settings/profile',{method:'PATCH',cookie:account.cookie,body:{site_theme:theme}});
    assert.equal(setting.status,200,JSON.stringify(setting.json));
    for(const [width,height] of sizes){
      const context=await browser.newContext({viewport:{width,height},colorScheme:theme,
        reducedMotion:width===390 && theme==='dark' ? 'reduce' : 'no-preference'});
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
        // Classification dots are layered above the interactive SVG but must
        // not absorb taps or block its keyboard-slider navigation.
        const marker=page.locator('[data-eval-graph-marker]').first();
        const chosen=Number(await marker.getAttribute('data-ply'));
        const dot=await marker.boundingBox();
        assert.ok(dot && chosen>0);
        await page.mouse.click(dot.x+dot.width/2,dot.y+dot.height/2);
        await page.waitForFunction((ply)=>{
          const text=document.querySelector('[data-move-transport]')?.textContent?.replace(/\s+/g,' ').trim();
          return text?.startsWith(`${ply} /`);
        },chosen);
        const graph=page.getByRole('slider',{name:'Move evaluation timeline'});
        await graph.focus();
        await page.keyboard.press('End');
        await page.waitForFunction(()=>document.querySelector('[data-move-transport]')?.textContent?.replace(/\s+/g,' ').trim().startsWith('24 /'));
        await page.keyboard.press('Home');
        await page.waitForFunction(()=>document.querySelector('[data-move-transport]')?.textContent?.replace(/\s+/g,' ').trim().startsWith('0 /'));
        assert.equal(db.prepare('SELECT pgn FROM games WHERE id = ?').get(id).pgn,previousPgn,
          'Graph clicking and keyboard navigation must not rewrite saved game source');
      }
      if(width===390){
        if(theme==='dark'){
          const ratios=await page.evaluate(()=>{
            const rgb=(value)=>value.match(/[\d.]+/g)?.slice(0,3).map(Number)??[];
            const luminance=(value)=>rgb(value).map(component=>{
              const n=component/255; return n<=0.04045?n/12.92:Math.pow((n+0.055)/1.055,2.4);
            }).reduce((total,component,i)=>total+component*[0.2126,0.7152,0.0722][i],0);
            const contrast=(fg,bg)=>{
              const a=luminance(fg),b=luminance(bg);
              return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
            };
            const note=document.querySelector('[data-review-best-arrow-note]');
            const hint=document.querySelector('[data-review-explore-hint]');
            if(!note||!hint) return null;
            return {
              arrow:contrast(getComputedStyle(note).color,getComputedStyle(document.querySelector('[data-app-shell]')).backgroundColor),
              hint:contrast(getComputedStyle(hint).color,getComputedStyle(hint.closest('.card')).backgroundColor),
            };
          });
          assert.ok(ratios && ratios.arrow>=4.5 && ratios.hint>=4.5,
            `Dark review guidance must reach AA text contrast: ${JSON.stringify(ratios)}`);
        }
        const jump=page.locator('[data-review-jump-to-details]');
        assert.ok(await jump.isVisible(),'Mobile board-to-details jump is missing');
        const startingScroll=await page.evaluate(()=>window.scrollY);
        await jump.click();
        await page.waitForFunction(()=>document.activeElement?.id==='review-tab-moves');
        await page.waitForFunction(()=>{
          const el=document.querySelector('[data-review-jump-to-board]')?.closest('[role="tabpanel"]')
            ?? document.getElementById('review-tab-moves')?.closest('.card');
          return !!el && Math.abs(el.getBoundingClientRect().top-64)<22;
        },undefined,{timeout:5000});
        assert.ok((await page.evaluate(()=>window.scrollY))>startingScroll+100,
          'Mobile jump did not scroll to review details');
        const reviewTab=page.getByRole('tab',{name:'Moves'});
        assert.equal(await reviewTab.getAttribute('aria-selected'),'true');
        // Icons alone are not discoverable navigation for a first-time user.
        // At the 390px reference width, all three review destinations must
        // have readable, visible text labels, not just aria-label tooltips.
        for(const tab of await page.getByRole('tab').all()){
          const label=tab.locator('span').first();
          assert.ok(await label.isVisible(),
            `Mobile review tab ${await tab.getAttribute('aria-label')} must show its text label`);
          const fits=await label.evaluate(el=>{
            const label=el.getBoundingClientRect(),tab=el.closest('[role="tab"]')?.getBoundingClientRect();
            return !!tab && label.width>0 && label.right<=tab.right+1 && label.left>=tab.left-1;
          });
          assert.ok(fits,`Mobile review tab label must stay within its touch target: ${await tab.getAttribute('aria-label')}`);
        }
        const unavailable=page.locator('[data-review-coach-unavailable]');
        await unavailable.waitFor({state:'visible'});
        const noteHeight=await unavailable.evaluate(el=>el.getBoundingClientRect().height);
        const explanationHeight=await page.locator('[data-review-move-explanation]').evaluate(el=>el.getBoundingClientRect().height);
        assert.ok(noteHeight>0 && noteHeight<70,
          `Unavailable AI coaching should be a compact readable note: ${noteHeight}px`);
        console.log('Unconfigured coaching layout:',JSON.stringify({theme,noteHeight,explanationHeight}));
        await page.screenshot({path:join(output,`${theme}-390x844-details.png`)});
        if(theme==='dark'){
          const readability=await page.evaluate(()=>{
            const current=document.querySelector('[role="region"][aria-label="Moves"] button[aria-current="step"]');
            const rowNumber=current?.parentElement?.firstElementChild;
            const inactiveTab=document.getElementById('review-tab-report');
            if(!(current instanceof HTMLElement) || !(rowNumber instanceof HTMLElement) || !(inactiveTab instanceof HTMLElement)) return null;
            const rgb=(value)=>{ const parts=value.match(/[\d.]+/g)?.map(Number)??[];
              return [parts[0]??0,parts[1]??0,parts[2]??0,parts[3]??1]; };
            const compositeBg=(element)=>{
              const colors=[];
              for(let el=element;el;el=el.parentElement)colors.unshift(rgb(getComputedStyle(el).backgroundColor));
              return colors.reduce((base,color)=>color.slice(0,3).map((v,i)=>v*color[3]+base[i]*(1-color[3])),[255,255,255]);
            };
            const l=(r,g,b)=>[r,g,b].map(n=>{ const v=n/255; return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4; })
              .reduce((sum,n,i)=>sum+n*[0.2126,0.7152,0.0722][i],0);
            const f=l(...rgb(getComputedStyle(rowNumber).color));
            const b=l(...compositeBg(rowNumber));
            const tf=l(...rgb(getComputedStyle(inactiveTab).color));
            const tb=l(...compositeBg(inactiveTab));
            return { numberContrast:(Math.max(f,b)+0.05)/(Math.min(f,b)+0.05),
              inactiveTabContrast:(Math.max(tf,tb)+0.05)/(Math.min(tf,tb)+0.05),
              selectedBackgroundLuminance:l(...compositeBg(current)),
              numberColor:getComputedStyle(rowNumber).color,
              selectedColor:getComputedStyle(current).backgroundColor };
          });
          assert.ok(readability, 'Cannot inspect selected move and move number');
          console.log('Dark move-list readability:',JSON.stringify(readability));
          assert.ok(readability.numberContrast>=4.5,
            `Move numbers must have readable contrast: ${JSON.stringify(readability)}`);
          assert.ok(readability.inactiveTabContrast>=4.5,
            `Inactive review tabs must remain legible in dark mode: ${JSON.stringify(readability)}`);
          assert.ok(readability.selectedBackgroundLuminance<0.2,
            `A selected move must not create a glaring white block in dark mode: ${JSON.stringify(readability)}`);
        }
        const returnButton=page.locator('[data-review-jump-to-board]');
        assert.ok(await returnButton.isVisible(),'Return-to-board action missing');
        await returnButton.click();
        await page.waitForFunction(()=>document.activeElement?.classList.contains('review-board-square'));
        await page.waitForFunction(()=>Math.abs(document.querySelector('.review-board-square').getBoundingClientRect().top-64)<22,
          undefined,{timeout:5000});
        const oldPgn=db.prepare('SELECT pgn FROM games WHERE id = ?').get(id).pgn;
        const countBefore=await page.locator('[data-move-transport]').innerText();
        await page.keyboard.press('ArrowRight');
        assert.notEqual(await page.locator('[data-move-transport]').innerText(),countBefore,
          'Board focus lost the review keyboard shortcut');
        assert.equal(db.prepare('SELECT pgn FROM games WHERE id = ?').get(id).pgn,oldPgn,
          'Mobile jump/navigation must never modify the saved PGN');
      }
      assert.deepEqual(errors,[],`${theme} ${width}x${height} runtime errors`);
      await context.close();
    }
  }
  // Review utilities must remain comfortably actionable on narrow phones.
  // These are real control hitboxes rather than just icon dimensions.
  for(const width of [320,390]){
    const context=await browser.newContext({viewport:{width,height:844},colorScheme:'dark',reducedMotion:'reduce',acceptDownloads:true});
    try{
      await context.addCookies([{name:account.cookie.split('=')[0],
        value:account.cookie.split('=').slice(1).join('='),url:base}]);
      const page=await context.newPage();
      await page.goto(`${base}/review/${id}?ply=15`,{waitUntil:'domcontentloaded'});
      const targets=['Star','Flip','Share position','Notes','Copy FEN','Copy PGN','Download'];
      const boxes=[];
      for(const name of targets){
        const button=page.getByRole('button',{name,exact:true});
        const box=await button.boundingBox();
        boxes.push({name,width:Math.round(box?.width??0),height:Math.round(box?.height??0)});
      }
      console.log(`${width}px review utilities:`,JSON.stringify(boxes));
      assert.ok(boxes.every(item=>item.height>=44),
        `Review utilities must meet 44px touch height at ${width}px: ${JSON.stringify(boxes)}`);
      const exportLayout=await page.locator('[data-review-export-row] button').evaluateAll(buttons=>buttons.map(button=>{
        const outer=button.getBoundingClientRect();
        const label=button.querySelector('span');
        return {top:Math.round(outer.top),left:Math.round(outer.left),right:Math.round(outer.right),
          labelFits:!!label && label.scrollWidth<=label.clientWidth+1};
      }));
      console.log(`${width}px export layout:`,JSON.stringify(exportLayout));
      assert.ok(exportLayout.length===3 && exportLayout.every(item=>item.top===exportLayout[0].top && item.labelFits)
        && exportLayout.every((item,index)=>index===0 || item.left>=exportLayout[index-1].right),
        `Copy and download must fit in one labeled, non-overlapping row: ${width}px ${JSON.stringify(exportLayout)}`);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=2,
        `Review utility layout overflows at ${width}px`);
      if(width===320){
        const downloadEvent=page.waitForEvent('download');
        await page.getByRole('button',{name:'Download',exact:true}).click();
        const downloaded=await downloadEvent;
        assert.equal(downloaded.suggestedFilename(),'Sample_White_vs_Sample_Black.pgn');
        const downloadedPath=await downloaded.path();
        assert.equal(readFileSync(downloadedPath,'utf8'),db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,
          'Export PGN must download the untouched saved game source, byte for byte');
      }
      await page.getByRole('button',{name:'Star',exact:true}).scrollIntoViewIfNeeded();
      await page.screenshot({path:join(output,`review-utilities-${width}.png`)});
      const bookmark=page.getByRole('button',{name:'Star',exact:true});
      assert.equal(await bookmark.getAttribute('aria-pressed'),'false',
        'The saved-game bookmark must expose its pressed state');
      const flipButton=page.getByRole('button',{name:'Flip',exact:true});
      const boardWrap=page.locator('.review-board-square .cg-wrap');
      const initialOrientation=await boardWrap.evaluate(element=>element.classList.contains('orientation-white')?'white':'black');
      assert.equal(await flipButton.getAttribute('aria-pressed'),'false',
        'Flip must announce its initial toggle state to keyboard and screen-reader users');
      await flipButton.focus();
      await page.keyboard.press('Enter');
      assert.equal(await flipButton.getAttribute('aria-pressed'),'true',
        'Flip must announce that the board orientation was toggled');
      await page.waitForFunction(orientation=>document.querySelector('.review-board-square .cg-wrap')
        ?.classList.contains(`orientation-${orientation}`),initialOrientation==='white'?'black':'white',{timeout:3000});
      await page.keyboard.press('Space');
      assert.equal(await flipButton.getAttribute('aria-pressed'),'false',
        'Using Space to restore the original perspective must clear pressed state');
      await page.waitForFunction(orientation=>document.querySelector('.review-board-square .cg-wrap')
        ?.classList.contains(`orientation-${orientation}`),initialOrientation,{timeout:3000});
      assert.ok(await flipButton.evaluate(element=>document.activeElement===element),
        'Flipping the board with a keyboard must not drop focus');
      const notesButton=page.getByRole('button',{name:'Notes',exact:true});
      assert.equal(await notesButton.getAttribute('aria-expanded'),'false');
      await notesButton.click();
      assert.equal(await notesButton.getAttribute('aria-expanded'),'true');
      const notesId=await notesButton.getAttribute('aria-controls');
      assert.ok(notesId && await page.locator(`[id="${notesId}"] textarea`).isVisible(),
        'Notes toggle must reveal the controlled editor');
      await notesButton.click();
      assert.equal(await notesButton.getAttribute('aria-expanded'),'false');
      assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,
        (await api(`/api/games/${id}`,{cookie:account.cookie})).json.game.pgn,
        'Toolbar state must not mutate the saved game source');
    }finally{await context.close();}
  }
  // Reproduce blocked clipboard access in a self-hosted/browser permission
  // environment. Silent failure leaves users unable to export their game.
  const blockedContext=await browser.newContext({viewport:{width:320,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await blockedContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await blockedContext.newPage();
    await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{
      configurable:true,value:{writeText:async()=>{throw new DOMException('Clipboard blocked','NotAllowedError');}},
    }));
    await page.goto(`${base}/review/${id}?ply=15`,{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Copy FEN',exact:true}).click();
    const exportFallback=page.locator('[data-review-export-row] [data-review-clipboard-fallback]');
    await exportFallback.waitFor({state:'visible',timeout:3000});
    const manualText=exportFallback.locator('textarea');
    const expectedFen=JSON.parse(db.prepare('SELECT moves_json FROM analyses WHERE game_id=?').get(id).moves_json)[14].fen_after;
    assert.equal(await manualText.inputValue(),expectedFen,
      'Denied Copy FEN must expose only the exact displayed FEN, not fabricated game data');
    await manualText.focus();
    const selected=await manualText.evaluate(el=>({start:el.selectionStart,end:el.selectionEnd,length:el.value.length}));
    assert.ok(selected.start===0 && selected.end===selected.length,
      'Manual FEN fallback must auto-select the exact text for keyboard copying');
    await page.screenshot({path:join(output,'clipboard-denied-fen-320.png')});
    await page.getByRole('button',{name:'Copy PGN',exact:true}).click();
    assert.equal(await manualText.inputValue(),db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,
      'Denied Copy PGN must expose the exact authoritative saved PGN');
    await page.getByRole('button',{name:'Share position',exact:true}).click();
    const shareFallback=page.locator('[data-review-meta-toolbar] [data-review-clipboard-fallback]');
    await shareFallback.waitFor({state:'visible',timeout:3000});
    assert.equal(await shareFallback.locator('textarea').inputValue(),page.url(),
      'Denied Share position must expose the displayed review URL, not another move');
    await page.screenshot({path:join(output,'clipboard-denied-share-320.png')});
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{
      configurable:true,value:{writeText:async()=>{}},
    }));
    await page.getByRole('button',{name:'Copy FEN',exact:true}).click();
    await exportFallback.waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Share position',exact:true}).click();
    await shareFallback.waitFor({state:'hidden'});
    // The documented S shortcut must offer the same recovery as the visible
    // Share position button, not swallow clipboard failure silently.
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{
      configurable:true,value:{writeText:async()=>{throw new DOMException('Clipboard blocked','NotAllowedError');}},
    }));
    await page.locator('.review-board-square').focus();
    await page.keyboard.press('s');
    await shareFallback.waitFor({state:'visible',timeout:3000});
    const shortcutShareField=shareFallback.locator('textarea');
    assert.equal(await shortcutShareField.inputValue(),page.url(),
      'Keyboard S must expose the current position share URL when clipboard is denied');
    const shortcutGeometry=await shortcutShareField.evaluate(field=>{
      const rect=field.getBoundingClientRect();
      return {focused:document.activeElement===field,selected:field.selectionStart===0 && field.selectionEnd===field.value.length,
        top:rect.top,bottom:rect.bottom,viewport:innerHeight};
    });
    assert.ok(shortcutGeometry.focused && shortcutGeometry.selected && shortcutGeometry.top>=56
      && shortcutGeometry.bottom<=shortcutGeometry.viewport-8,
      `Keyboard S recovery must be visible, focused and selected: ${JSON.stringify(shortcutGeometry)}`);
    await page.screenshot({path:join(output,'clipboard-denied-keyboard-share-320.png')});
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,
      (await api(`/api/games/${id}`,{cookie:account.cookie})).json.game.pgn,
      'Denied and successful clipboard operations must never rewrite saved PGN');
  }finally{await blockedContext.close();}
  // Notes remain private, editable and recoverable after a real failed PATCH.
  // Verify the localized retry against the disposable authenticated backend.
  const spanishNotes=JSON.parse(readFileSync(new URL('../web/src/locales/es.json',import.meta.url),'utf8'));
  const notesLocale=await api('/api/settings/profile',{method:'PATCH',cookie:account.cookie,
    body:{language:'es',site_theme:'dark'}});
  assert.equal(notesLocale.status,200);
  const notesContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  let releaseOldNote=()=>{};
  let releaseNewNote=()=>{};
  try{
    await notesContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await notesContext.newPage();
    const savedPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    let noteAttempts=0;
    const heldOldNote=new Promise(resolve=>{releaseOldNote=resolve;});
    const heldNewNote=new Promise(resolve=>{releaseNewNote=resolve;});
    await page.route(`**/api/games/${id}/notes`,async route=>{
      noteAttempts++;
      if(noteAttempts===1)await route.fulfill({status:503,contentType:'application/json',body:'{"error":"backend_unavailable"}'});
      else {
        if(noteAttempts===3)await heldOldNote;
        if(noteAttempts===4)await heldNewNote;
        await route.continue();
      }
    });
    await page.goto(`${base}/review/${id}?ply=15`,{waitUntil:'domcontentloaded'});
    const notesButton=page.getByRole('button',{name:spanishNotes.review.notes,exact:true});
    await notesButton.click();
    assert.equal(await notesButton.getAttribute('aria-expanded'),'true');
    const editor=page.getByPlaceholder(spanishNotes.review.notesPlaceholder);
    await editor.fill('Nota de ensayo: revisar la partida');
    await editor.press('Tab');
    await page.getByText(spanishNotes.review.notesSaveFailed,{exact:true}).waitFor({state:'visible'});
    assert.equal(await editor.inputValue(),'Nota de ensayo: revisar la partida',
      'A failed save must preserve the unsaved notes draft');
    const retry=page.getByRole('button',{name:spanishNotes.review.notesRetrySave});
    const retryBox=await retry.boundingBox();
    assert.ok(retryBox && retryBox.height>=44,`Notes retry is too small: ${JSON.stringify(retryBox)}`);
    await retry.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'review-notes-save-failure-es-390.png')});
    const keyboardNotesRetryResponse=page.waitForResponse(response=>response.url().endsWith(`/api/games/${id}/notes`) && response.status()===200);
    await retry.focus();
    await page.keyboard.press('Enter');
    await keyboardNotesRetryResponse;
    await page.getByText(spanishNotes.review.notesSaveFailed,{exact:true}).waitFor({state:'hidden'});
    assert.ok(await editor.evaluate(element=>document.activeElement===element),
      'When Notes Retry succeeds and removes its own error banner, keyboard focus should return to the persistent editor');
    assert.equal(noteAttempts,2,'Notes retry must send exactly one new PATCH');
    assert.equal(db.prepare('SELECT notes FROM games WHERE id=?').get(id).notes,
      'Nota de ensayo: revisar la partida','Successful retry must persist the unchanged draft');
    // Two fast blur saves share a serialized mutation scope. If an older
    // response succeeds while the newer draft waits, the visible status must
    // still say Saving, never claim the stale text is the final saved note.
    const olderDraft='Nota intermedia: revisar el medio juego';
    const latestDraft='Nota final: revisar el final de partida';
    const oldRequest=page.waitForRequest(request=>request.url().endsWith(`/api/games/${id}/notes`)
      && request.postDataJSON().notes===olderDraft);
    await editor.fill(olderDraft);
    await editor.press('Tab');
    await oldRequest;
    await editor.fill(latestDraft);
    await editor.press('Tab');
    assert.equal(await editor.inputValue(),latestDraft,'Newer notes must remain editable while an older PATCH is pending');
    const newerRequest=page.waitForRequest(request=>request.url().endsWith(`/api/games/${id}/notes`)
      && request.postDataJSON().notes===latestDraft);
    releaseOldNote();
    await newerRequest;
    await page.getByText(spanishNotes.common.saving,{exact:true}).waitFor({state:'visible',timeout:3000});
    assert.equal(await page.getByText(spanishNotes.common.saved,{exact:true}).count(),0,
      'The older successful note PATCH must not announce Saved while a newer draft is pending');
    assert.equal(await editor.inputValue(),latestDraft,'An older success must not replace the newer unsaved draft');
    const latestResponse=page.waitForResponse(response=>response.url().endsWith(`/api/games/${id}/notes`)
      && response.status()===200 && response.request().postDataJSON().notes===latestDraft);
    releaseNewNote();
    await latestResponse;
    await page.getByText(spanishNotes.common.saved,{exact:true}).waitFor({state:'visible',timeout:5000});
    assert.equal(noteAttempts,4,'Exactly two queued saves must follow the original failure and retry');
    assert.equal(await editor.inputValue(),latestDraft);
    assert.equal(db.prepare('SELECT notes FROM games WHERE id=?').get(id).notes,latestDraft,
      'The latest typed note must be the final persisted value');
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,savedPgn);
  }finally{
    releaseOldNote();releaseNewNote();
    await notesContext.close();
    const restored=await api('/api/settings/profile',{method:'PATCH',cookie:account.cookie,
      body:{language:'en',site_theme:'dark'}});
    assert.equal(restored.status,200);
  }
  // The persisted PATCH can succeed before a background GET refreshes the
  // `notes` prop. The save label must trust the acknowledged mutation rather
  // than misleadingly saying "Click outside to save" while refetch is held.
  const acknowledgedStatusContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  let releaseStatusRefresh=()=>{};
  try{
    await acknowledgedStatusContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await acknowledgedStatusContext.newPage();
    const enNotes=JSON.parse(readFileSync(new URL('../web/src/locales/en.json',import.meta.url),'utf8'));
    const oldPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    await page.goto(`${base}/review/${id}?ply=15`,{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:enNotes.review.notes,exact:true}).click();
    const editor=page.getByPlaceholder(enNotes.review.notesPlaceholder);
    const heldStatusRefresh=new Promise(resolve=>{releaseStatusRefresh=resolve;});
    let blockedRefreshes=0;
    await page.route(`**/api/games/${id}`,async route=>{
      if(route.request().method()==='GET'){
        blockedRefreshes++;
        await heldStatusRefresh;
      }
      await route.continue();
    });
    const draft='Saved on the server before the background refresh completes';
    const savedResponse=page.waitForResponse(res=>res.url().endsWith(`/api/games/${id}/notes`)
      && res.status()===200 && res.request().postDataJSON().notes===draft);
    await editor.fill(draft);
    await editor.press('Tab');
    await savedResponse;
    await page.locator('[data-review-meta-toolbar]').getByText(enNotes.common.saved,{exact:true})
      .waitFor({state:'visible',timeout:3000});
    assert.ok(blockedRefreshes>0,'The background game refresh must actually be delayed');
    assert.equal(await page.locator('[data-review-meta-toolbar]').getByText(enNotes.review.notesUnsaved,{exact:true}).count(),0,
      'Successful acknowledged Notes PATCH must never continue to claim the saved draft is unsaved');
    assert.equal(await editor.inputValue(),draft);
    assert.equal(db.prepare('SELECT notes FROM games WHERE id=?').get(id).notes,draft);
    await page.screenshot({path:join(output,'review-notes-acknowledged-before-refetch-390.png')});
    releaseStatusRefresh();
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,oldPgn);
  }finally{releaseStatusRefresh();await acknowledgedStatusContext.close();}
  // Closing Notes blurs its editor and starts an asynchronous autosave. If
  // that PATCH fails *after* the editor collapses, the error cannot be left
  // inside its now-hidden content: the user must see and recover the draft.
  const collapsedNotesContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await collapsedNotesContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await collapsedNotesContext.newPage();
    const enNotes=JSON.parse(readFileSync(new URL('../web/src/locales/en.json',import.meta.url),'utf8'));
    const savedPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    let attempts=0;
    await page.route(`**/api/games/${id}/notes`,async route=>{
      attempts++;
      if(attempts===1)await route.fulfill({status:503,contentType:'application/json',body:'{"error":"backend_unavailable"}'});
      else await route.continue();
    });
    await page.goto(`${base}/review/${id}?ply=15`,{waitUntil:'domcontentloaded'});
    const notesButton=page.getByRole('button',{name:enNotes.review.notes,exact:true});
    await notesButton.click();
    const editor=page.getByPlaceholder(enNotes.review.notesPlaceholder);
    const latestDraft='Review notes: keep this edit when collapsed save fails';
    await editor.fill(latestDraft);
    const failedResponse=page.waitForResponse(response=>response.url().endsWith(`/api/games/${id}/notes`)
      && response.status()===503);
    await notesButton.click();
    await failedResponse;
    assert.equal(await notesButton.getAttribute('aria-expanded'),'false');
    const collapsedAlert=page.locator('[data-review-notes-collapsed-error]');
    await collapsedAlert.getByText(enNotes.review.notesSaveFailed,{exact:true})
      .waitFor({state:'visible',timeout:5000});
    const retry=collapsedAlert.getByRole('button',{name:enNotes.review.notesRetrySave,exact:true});
    const retryTarget=await retry.boundingBox();
    assert.ok(retryTarget && retryTarget.height>=44,
      'Collapsed Notes save failure must offer a visible 44px retry target');
    await page.screenshot({path:join(output,'review-notes-collapsed-save-failure-390.png')});
    const successfulResponse=page.waitForResponse(response=>response.url().endsWith(`/api/games/${id}/notes`)
      && response.status()===200 && response.request().postDataJSON().notes===latestDraft);
    await retry.focus();
    await page.keyboard.press('Enter');
    await successfulResponse;
    await collapsedAlert.waitFor({state:'hidden',timeout:5000});
    assert.equal(attempts,2,'Collapsed notes must retry the same latest draft only once');
    assert.ok(await notesButton.evaluate(element=>document.activeElement===element),
      'Once a keyboard-initiated collapsed-notes retry succeeds, focus should return to Notes');
    assert.equal(db.prepare('SELECT notes FROM games WHERE id=?').get(id).notes,latestDraft);
    await notesButton.click();
    assert.equal(await editor.inputValue(),latestDraft,
      'Reopening Notes must display the latest successful draft');
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,savedPgn);
  }finally{await collapsedNotesContext.close();}
  // Leaving Review while a blurred note PATCH is unresolved must not silently
  // discard the only copy of a private draft. Hold a failing request while a
  // user follows the real Back link; source PGN must never be affected.
  const leaveNotesContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  let releaseLeavingNotes=()=>{};
  try{
    await leaveNotesContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await leaveNotesContext.newPage();
    const enNotes=JSON.parse(readFileSync(new URL('../web/src/locales/en.json',import.meta.url),'utf8'));
    const originalPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    const held=new Promise(resolve=>{releaseLeavingNotes=resolve;});
    let failures=0;
    await page.route(`**/api/games/${id}/notes`,async route=>{
      failures++;
      if(failures===1 || failures===4 || failures===5 || failures===6){
        if(failures===1) await held;
        await route.fulfill({status:503,contentType:'application/json',body:'{"error":"backend_unavailable"}'});
      } else await route.continue();
    });
    await page.goto(`${base}/review/${id}?ply=15`,{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:enNotes.review.notes,exact:true}).click();
    const draft='Draft must survive leaving Review after a save failure';
    await page.getByPlaceholder(enNotes.review.notesPlaceholder).fill(draft);
    const pending=page.waitForRequest(request=>request.url().endsWith(`/api/games/${id}/notes`)
      && request.postDataJSON().notes===draft);
    await page.getByRole('link',{name:'Back',exact:true}).click();
    await pending;
    assert.equal(new URL(page.url()).pathname,`/review/${id}`,
      'A pending note PATCH must keep the user in Review until the new draft is safely stored');
    const leaveDialog=page.getByRole('alertdialog',{name:enNotes.review.notesLeaveTitle});
    await leaveDialog.getByText(enNotes.review.notesLeaveSaving,{exact:true})
      .waitFor({state:'visible',timeout:3000});
    await page.screenshot({path:join(output,'review-notes-leave-while-saving-390.png')});
    releaseLeavingNotes();
    await leaveDialog.getByText(enNotes.review.notesSaveFailed,{exact:true})
      .waitFor({state:'visible',timeout:5000});
    const stay=leaveDialog.getByRole('button',{name:'Keep editing',exact:true});
    const discard=leaveDialog.getByRole('button',{name:'Discard changes',exact:true});
    const retryAction=leaveDialog.getByRole('button',{name:enNotes.review.notesRetrySave,exact:true});
    assert.ok(await discard.isVisible(),
      'A failed save must permit a deliberate, clearly labeled leave-without-saving choice');
    assert.ok(await stay.evaluate(element=>document.activeElement===element),
      'The pending-to-failed save dialog must preserve initial keyboard focus on Keep editing');
    await page.keyboard.press('Shift+Tab');
    assert.ok(await discard.evaluate(element=>document.activeElement===element),
      'Shift+Tab from the first dialog action must wrap to the last');
    await page.keyboard.press('Tab');
    assert.ok(await stay.evaluate(element=>document.activeElement===element),
      'Tab from the last dialog action must wrap to the first');
    await page.keyboard.press('Tab');
    assert.ok(await retryAction.evaluate(element=>document.activeElement===element),
      'The Retry action must be keyboard-reachable after the save fails');
    await page.keyboard.press('Tab');
    assert.ok(await discard.evaluate(element=>document.activeElement===element),
      'The explicit Discard action must be reachable only within the modal');
    assert.equal(failures,1);
    assert.equal(await page.getByPlaceholder(enNotes.review.notesPlaceholder).inputValue(),draft);
    await page.screenshot({path:join(output,'review-notes-leave-save-failed-390.png')});
    const retry=leaveDialog.getByRole('button',{name:enNotes.review.notesRetrySave,exact:true});
    await retry.focus();
    const savedRequest=page.waitForResponse(response=>response.url().endsWith(`/api/games/${id}/notes`)
      && response.status()===200 && response.request().postDataJSON().notes===draft);
    await page.keyboard.press('Enter');
    await savedRequest;
    await page.waitForURL(`${base}/review`,{timeout:5000});
    assert.equal(failures,2,'Retry from the leave guard must save the latest draft once');
    assert.equal(db.prepare('SELECT notes FROM games WHERE id=?').get(id).notes,draft,
      'Successful recovery must persist the draft before leaving Game Review');
    await page.locator(`a[href="/review/${id}"]`).first().click();
    await page.waitForURL(`${base}/review/${id}`);
    await page.getByRole('button',{name:enNotes.review.notes,exact:true}).click();
    assert.equal(await page.getByPlaceholder(enNotes.review.notesPlaceholder).inputValue(),draft,
      'Reopening Game Review must show the last safely stored note');
    // A normal successful blur save must continue the user's originally
    // requested navigation automatically, without an unnecessary discard.
    const nextDraft='Autosave succeeds and navigation continues automatically';
    await page.getByPlaceholder(enNotes.review.notesPlaceholder).fill(nextDraft);
    const automaticSave=page.waitForResponse(response=>response.url().endsWith(`/api/games/${id}/notes`)
      && response.status()===200 && response.request().postDataJSON().notes===nextDraft);
    await page.getByRole('link',{name:'Back',exact:true}).click();
    await automaticSave;
    await page.waitForURL(`${base}/review`,{timeout:5000});
    assert.equal(failures,3);
    assert.equal(db.prepare('SELECT notes FROM games WHERE id=?').get(id).notes,nextDraft);
    // After an explicit 503, users who choose Discard changes may still
    // leave. That choice must never overwrite the last acknowledged draft.
    await page.locator(`a[href="/review/${id}"]`).first().click();
    await page.waitForURL(`${base}/review/${id}`);
    await page.getByRole('button',{name:enNotes.review.notes,exact:true}).click();
    await page.getByPlaceholder(enNotes.review.notesPlaceholder).fill('Intentionally discarded notes after a failed save');
    await page.getByRole('link',{name:'Back',exact:true}).click();
    const discardDialog=page.getByRole('alertdialog',{name:enNotes.review.notesLeaveTitle});
    await discardDialog.getByText(enNotes.review.notesSaveFailed,{exact:true})
      .waitFor({state:'visible',timeout:5000});
    assert.equal(new URL(page.url()).pathname,`/review/${id}`);
    await discardDialog.getByRole('button',{name:'Discard changes'}).click();
    await page.waitForURL(`${base}/review`,{timeout:5000});
    assert.equal(failures,4);
    assert.equal(db.prepare('SELECT notes FROM games WHERE id=?').get(id).notes,nextDraft,
      'An explicit discard must not overwrite previously stored notes');
    // Keep editing must restore the draft and keyboard focus, rather than
    // trapping a player in the blocked navigation dialog after a 503.
    await page.locator(`a[href="/review/${id}"]`).first().click();
    await page.waitForURL(`${base}/review/${id}`);
    await page.getByRole('button',{name:enNotes.review.notes,exact:true}).click();
    const retainedDraft='Keep editing retains this private note after a failed save';
    const reopenedEditor=page.getByPlaceholder(enNotes.review.notesPlaceholder);
    await reopenedEditor.fill(retainedDraft);
    await page.getByRole('link',{name:'Back',exact:true}).click();
    const keepDialog=page.getByRole('alertdialog',{name:enNotes.review.notesLeaveTitle});
    await keepDialog.getByText(enNotes.review.notesSaveFailed,{exact:true})
      .waitFor({state:'visible',timeout:5000});
    await page.keyboard.press('Escape');
    await keepDialog.waitFor({state:'hidden',timeout:3000});
    assert.equal(new URL(page.url()).pathname,`/review/${id}`);
    assert.equal(await reopenedEditor.inputValue(),retainedDraft);
    assert.ok(await reopenedEditor.evaluate(element=>document.activeElement===element),
      'Escape should cancel blocked navigation and focus the preserved draft');
    await page.getByRole('link',{name:'Back',exact:true}).click();
    await keepDialog.getByText(enNotes.review.notesSaveFailed,{exact:true})
      .waitFor({state:'visible',timeout:3000});
    await keepDialog.getByRole('button',{name:'Keep editing'}).click();
    await keepDialog.waitFor({state:'hidden',timeout:3000});
    assert.equal(new URL(page.url()).pathname,`/review/${id}`);
    assert.equal(await reopenedEditor.inputValue(),retainedDraft);
    assert.ok(await reopenedEditor.evaluate(element=>document.activeElement===element),
      'Keep editing should return keyboard focus to the surviving note draft');
    const nextSave=page.waitForResponse(response=>response.url().endsWith(`/api/games/${id}/notes`)
      && response.status()===200 && response.request().postDataJSON().notes===retainedDraft);
    await reopenedEditor.press('Tab');
    await nextSave;
    assert.equal(db.prepare('SELECT notes FROM games WHERE id=?').get(id).notes,retainedDraft);
    assert.equal(failures,7,
      'Reattempted navigation after Escape may trigger a fresh blur save; Keep editing must preserve the draft through both failures');
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,originalPgn);
  }finally{releaseLeavingNotes();await leaveNotesContext.close();}
  // A successful old notes PATCH must not release a blocked navigation while
  // the player's newer edit is still queued behind it in the mutation scope.
  const noteRaceContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  let releaseRaceOlder=()=>{};
  let releaseRaceNewer=()=>{};
  let releaseRaceMove=()=>{};
  try{
    await noteRaceContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await noteRaceContext.newPage();
    const enNotes=JSON.parse(readFileSync(new URL('../web/src/locales/en.json',import.meta.url),'utf8'));
    const savedPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    const oldText='First draft, not the final note';
    const newText='Second draft must be saved before leaving';
    const heldOlder=new Promise(resolve=>{releaseRaceOlder=resolve;});
    const heldNewer=new Promise(resolve=>{releaseRaceNewer=resolve;});
    const heldMove=new Promise(resolve=>{releaseRaceMove=resolve;});
    const moveText='Review move navigation should not discard or block notes';
    const submitted=[];
    await page.route(`**/api/games/${id}/notes`,async route=>{
      const text=route.request().postDataJSON().notes;
      submitted.push(text);
      if(text===oldText) await heldOlder;
      if(text===newText) await heldNewer;
      if(text===moveText) await heldMove;
      await route.continue();
    });
    await page.goto(`${base}/review/${id}?ply=15`,{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:enNotes.review.notes,exact:true}).click();
    const editor=page.getByPlaceholder(enNotes.review.notesPlaceholder);
    const oldRequest=page.waitForRequest(req=>req.url().endsWith(`/api/games/${id}/notes`) && req.postDataJSON().notes===oldText);
    await editor.fill(oldText);
    await editor.press('Tab');
    await oldRequest;
    await editor.fill(newText);
    await editor.press('Tab');
    const newRequest=page.waitForRequest(req=>req.url().endsWith(`/api/games/${id}/notes`) && req.postDataJSON().notes===newText);
    await page.getByRole('link',{name:'Back',exact:true}).click();
    const leaveDialog=page.getByRole('alertdialog',{name:enNotes.review.notesLeaveTitle});
    await leaveDialog.getByText(enNotes.review.notesLeaveSaving,{exact:true}).waitFor({state:'visible',timeout:4000});
    const oldResponse=page.waitForResponse(res=>res.url().endsWith(`/api/games/${id}/notes`) && res.status()===200 && res.request().postDataJSON().notes===oldText);
    releaseRaceOlder();
    await oldResponse;
    await newRequest;
    assert.equal(new URL(page.url()).pathname,`/review/${id}`,
      'Old successful notes save must not leave Game Review while a newer edit is unresolved');
    assert.equal(await editor.inputValue(),newText);
    assert.equal(await leaveDialog.getByText(enNotes.review.notesLeaveSaving,{exact:true}).count(),1);
    await page.screenshot({path:join(output,'review-notes-two-saves-pending-390.png')});
    const newResponse=page.waitForResponse(res=>res.url().endsWith(`/api/games/${id}/notes`) && res.status()===200 && res.request().postDataJSON().notes===newText);
    releaseRaceNewer();
    await newResponse;
    await page.waitForURL(`${base}/review`,{timeout:5000});
    assert.deepEqual(submitted,[oldText,newText],
      'Only one ordered PATCH should be sent per draft, including the blur/navigation race');
    assert.equal(db.prepare('SELECT notes FROM games WHERE id=?').get(id).notes,newText,
      'Only the final acknowledged edit may release navigation');
    // Normal ?ply= changes keep GameAnalyzer and its Notes editor mounted.
    // A held autosave must never introduce an unrelated navigation dialog
    // when someone simply steps forward in the same saved game.
    await page.goto(`${base}/review/${id}?ply=15`,{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:enNotes.review.notes,exact:true}).click();
    const moveEditor=page.getByPlaceholder(enNotes.review.notesPlaceholder);
    await moveEditor.fill(moveText);
    const moveRequest=page.waitForRequest(req=>req.url().endsWith(`/api/games/${id}/notes`)
      && req.postDataJSON().notes===moveText);
    await moveEditor.press('Tab');
    await moveRequest;
    assert.equal((await page.locator('[data-review-move-progress]').innerText()).trim(),'15 / 24');
    await page.locator('[data-move-transport] button').nth(2).click();
    await page.waitForFunction(()=>document.querySelector('[data-review-move-progress]')?.textContent?.trim()==='16 / 24',
      undefined,{timeout:5000});
    assert.equal(await page.getByRole('alertdialog').count(),0,
      'Changing ?ply= within the same saved game must not block chess exploration');
    assert.equal(await moveEditor.inputValue(),moveText,
      'The private note must remain mounted while the player explores a saved move');
    const moveResponse=page.waitForResponse(res=>res.url().endsWith(`/api/games/${id}/notes`)
      && res.status()===200 && res.request().postDataJSON().notes===moveText);
    releaseRaceMove();
    await moveResponse;
    assert.equal(db.prepare('SELECT notes FROM games WHERE id=?').get(id).notes,moveText);
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,savedPgn);
  }finally{releaseRaceOlder();releaseRaceNewer();releaseRaceMove();await noteRaceContext.close();}
  // In-review "Retry this mistake" currently changes React state without a
  // URL transition. A pending failed notes save must still have a recovery
  // surface before the normal Review workspace disappears into blind mode.
  // The ordinary replay fixture is an *ongoing* game, and correctly cannot
  // offer blind practice. Use a separate completed, source-attested copy with
  // the same legal moves to exercise a real eligible white-player mistake.
  const practicePgn=new Chess();
  practicePgn.loadPgn(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn);
  practicePgn.setHeader('Result','1-0');
  const practiceGameId=Number(db.prepare(`INSERT INTO games
    (user_id,source,external_id,pgn,white,black,result,time_control,end_time,user_color)
    VALUES (?,'imported','polish-completed-practice',?,'Practice White','Practice Black','1-0','600',datetime('now'),'white')`)
    .run(user.id,practicePgn.pgn()).lastInsertRowid);
  const practiceSource=loadAnalysisGameSource(db,practiceGameId);
  assert.ok(practiceSource);
  db.prepare(`INSERT INTO analyses
    (game_id,depth,moves_json,accuracy_white,accuracy_black,scoring_version,
    source_hash,source_revision,analysis_generation)
    VALUES (?,12,?,81,77,?,?,?,1)`)
    .run(practiceGameId,db.prepare('SELECT moves_json FROM analyses WHERE game_id=?').get(id).moves_json,
      SCORING_VERSION,analysisSourceHash(practiceSource),practiceSource.source_revision);
  const practiceNotesContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  let releasePracticeNotes=()=>{};
  try{
    await practiceNotesContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await practiceNotesContext.newPage();
    const enNotes=JSON.parse(readFileSync(new URL('../web/src/locales/en.json',import.meta.url),'utf8'));
    const pgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(practiceGameId).pgn;
    const held=new Promise(resolve=>{releasePracticeNotes=resolve;});
    let attempts=0;
    const draft='Private note before practicing this mistake';
    await page.route(`**/api/games/${practiceGameId}/notes`,async route=>{
      attempts++;
      if(attempts===1){
        await held;
        await route.fulfill({status:503,contentType:'application/json',body:'{"error":"backend_unavailable"}'});
      } else await route.continue();
    });
    await page.goto(`${base}/review/${practiceGameId}?ply=17`,{waitUntil:'domcontentloaded'});
    const practiceAction=page.locator('#learn-from-mistake');
    await practiceAction.waitFor({state:'visible',timeout:5000});
    assert.equal((await page.locator('[data-review-move-progress]').innerText()).trim(),'17 / 24',
      'Blind-practice safety must be tested on a genuine user-side mistake');
    await page.getByRole('button',{name:enNotes.review.notes,exact:true}).click();
    await page.getByPlaceholder(enNotes.review.notesPlaceholder).fill(draft);
    const pending=page.waitForRequest(req=>req.url().endsWith(`/api/games/${practiceGameId}/notes`)
      && req.postDataJSON().notes===draft);
    await practiceAction.click();
    await pending;
    const guard=page.getByRole('alertdialog',{name:enNotes.review.notesLeaveTitle});
    await guard.getByText(enNotes.review.notesLeaveSaving,{exact:true})
      .waitFor({state:'visible',timeout:3000});
    assert.ok(await page.getByPlaceholder(enNotes.review.notesPlaceholder).isVisible(),
      'Unsaved Notes must not unmount when starting blind practice from Review');
    releasePracticeNotes();
    await guard.getByText(enNotes.review.notesSaveFailed,{exact:true})
      .waitFor({state:'visible',timeout:5000});
    const recovered=page.waitForResponse(response=>response.url().endsWith(`/api/games/${practiceGameId}/notes`)
      && response.status()===200 && response.request().postDataJSON().notes===draft);
    await guard.getByRole('button',{name:enNotes.review.notesRetrySave,exact:true}).click();
    await recovered;
    await page.getByRole('button',{name:enNotes.practice.returnSaved,exact:true}).waitFor({state:'visible',timeout:5000});
    assert.equal(attempts,2);
    assert.equal(db.prepare('SELECT notes FROM games WHERE id=?').get(practiceGameId).notes,draft);
    await page.getByRole('button',{name:enNotes.practice.returnSaved,exact:true}).click();
    await page.getByRole('button',{name:enNotes.review.notes,exact:true}).click();
    assert.equal(await page.getByPlaceholder(enNotes.review.notesPlaceholder).inputValue(),draft);
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(practiceGameId).pgn,pgn);
    // The new in-review practice query is also a directly openable URL. A
    // bookmark must start on a truly blind attempt, without rendering the
    // saved move list, graph, notes or engine hints before the learner exits.
    await page.goto(`${base}/review/${practiceGameId}?ply=17&practicePly=17`,{waitUntil:'domcontentloaded'});
    const directPractice=page.locator('[data-practice-mode="true"]');
    await directPractice.waitFor({state:'visible',timeout:5000});
    assert.equal(await page.locator('[data-review-move-progress]').count(),0,
      'A directly opened valid attempt must not mount the scored saved-game transport');
    assert.equal(await page.locator('[data-review-meta-toolbar]').count(),0,
      'A direct blind-practice URL must not reveal the saved Notes or Review rail');
    assert.equal(await page.locator('[data-review-workspace]').count(),0);
    assert.equal(await page.locator('[data-practice-mode] h1').evaluate(el=>document.activeElement===el),true,
      'Direct blind practice must focus its own heading for keyboard users');
    const returnSaved=page.getByRole('button',{name:enNotes.practice.returnSaved,exact:true});
    await returnSaved.focus();
    await page.keyboard.press('Enter');
    await page.locator('[data-review-move-progress]').waitFor({state:'visible',timeout:5000});
    assert.equal((await page.locator('[data-review-move-progress]').innerText()).trim(),'17 / 24');
    assert.ok(!new URL(page.url()).searchParams.has('practicePly'),
      'Returning to normal Review must remove the transient practice query');
    assert.ok(await page.locator('#learn-from-mistake').evaluate(el=>document.activeElement===el),
      'Returning from blind practice should restore focus to the selected mistake action');
    // Invalid or no-longer-eligible targets must remain in the isolated
    // unavailable screen rather than unmounting it to reveal PGN/hints.
    await page.goto(`${base}/review/${practiceGameId}?ply=17&practicePly=999`,{waitUntil:'domcontentloaded'});
    await page.getByRole('alert').getByRole('button',{name:enNotes.practice.returnSaved,exact:true})
      .waitFor({state:'visible',timeout:5000});
    assert.equal(await page.locator('[data-review-workspace]').count(),0,
      'An invalid direct practice target must not expose the scored Game Review workspace');
    await page.getByRole('alert').getByRole('button',{name:enNotes.practice.returnSaved,exact:true}).click();
    await page.locator('[data-review-move-progress]').waitFor({state:'visible',timeout:5000});
    assert.ok(!new URL(page.url()).searchParams.has('practicePly'));
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(practiceGameId).pgn,pgn);
  }finally{releasePracticeNotes();await practiceNotesContext.close();}
  // Bookmark PATCH failures currently roll back the optimistic Star button
  // without telling the user whether the bookmark was actually saved.
  const bookmarkContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await bookmarkContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await bookmarkContext.newPage();
    let bookmarkAttempts=0;
    const requestedBookmarkStates=[];
    let releasePendingBookmark=()=>{};
    const pendingBookmark=new Promise(resolve=>{releasePendingBookmark=resolve;});
    const savedPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    await page.route(`**/api/games/${id}/bookmark`,async route=>{
      bookmarkAttempts++;
      requestedBookmarkStates.push(route.request().postDataJSON().bookmarked);
      if(bookmarkAttempts===1) await pendingBookmark;
      if(bookmarkAttempts===1 || bookmarkAttempts===3)await route.fulfill({status:503,contentType:'application/json',body:'{"error":"backend_unavailable"}'});
      else await route.continue();
    });
    await page.goto(`${base}/review/${id}?ply=15`,{waitUntil:'domcontentloaded'});
    // The optimistic toggle changes the visible label from Star to Starred
    // before the PATCH settles. Anchor focus checks to this stable control,
    // not an accessible-name locator that legitimately changes mid-request.
    const starButton=page.locator('[data-review-meta-toolbar] button[aria-pressed][aria-busy]');
    await starButton.focus();
    const startedBookmark=page.waitForRequest(req=>req.url().endsWith(`/api/games/${id}/bookmark`));
    await page.keyboard.press('Enter');
    await startedBookmark;
    await page.waitForFunction(()=>document.querySelector('[data-review-meta-toolbar] button[aria-pressed][aria-busy]')?.getAttribute('aria-disabled')==='true',
      undefined,{timeout:3000});
    const pendingBookmarkFocused=await starButton.evaluate(element=>document.activeElement===element);
    await page.keyboard.press('Enter');
    assert.equal(bookmarkAttempts,1,
      'Repeated Enter during the same pending bookmark must not issue another request');
    releasePendingBookmark();
    assert.ok(pendingBookmarkFocused,
      'A pending keyboard-activated bookmark must retain focus until the result or provide a stable alternative');
    await page.getByRole('button',{name:'Star',exact:true}).waitFor({state:'visible',timeout:3000});
    assert.equal(await page.getByRole('button',{name:'Star',exact:true}).getAttribute('aria-pressed'),'false',
      'Failed bookmark PATCH must not leave a falsely selected star');
    await page.locator('[data-review-bookmark-error]').waitFor({state:'visible',timeout:3000});
    const retry=page.locator('[data-review-bookmark-error] button');
    assert.ok((await retry.boundingBox())?.height>=44,'Bookmark retry needs a 44px touch target');
    await retry.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'bookmark-save-failure-390.png')});
    const keyboardRetryResponse=page.waitForResponse(response=>response.url().endsWith(`/api/games/${id}/bookmark`) && response.status()===200);
    await retry.focus();
    await page.keyboard.press('Enter');
    await keyboardRetryResponse;
    assert.equal(bookmarkAttempts,2);
    await page.locator('[data-review-bookmark-error]').waitFor({state:'hidden'});
    assert.ok(await starButton.evaluate(element=>document.activeElement===element),
      'After a keyboard-initiated bookmark retry removes its own alert, focus must recover to Star');
    assert.equal(db.prepare('SELECT bookmarked FROM games WHERE id=?').get(id).bookmarked,1);
    // The reverse operation (unstar) must retry false, never accidentally
    // re-star a game because a failed optimistic toggle was rolled back.
    await page.getByRole('button',{name:'Starred',exact:true}).click();
    await page.locator('[data-review-bookmark-error]').waitFor({state:'visible'});
    assert.equal(await page.getByRole('button',{name:'Starred',exact:true}).getAttribute('aria-pressed'),'true');
    await Promise.all([
      page.waitForResponse(response=>response.url().endsWith(`/api/games/${id}/bookmark`) && response.status()===200),
      retry.click(),
    ]);
    await page.locator('[data-review-bookmark-error]').waitFor({state:'hidden'});
    assert.deepEqual(requestedBookmarkStates,[true,true,false,false],
      'Failed bookmark and unbookmark retries must preserve the exact original intent');
    assert.equal(db.prepare('SELECT bookmarked FROM games WHERE id=?').get(id).bookmarked,0);
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,savedPgn);
  }finally{
    await bookmarkContext.close();
    db.prepare('UPDATE games SET bookmarked=0 WHERE id=?').run(id);
  }
  // An abandoned temporary branch must not accept an obsolete Stockfish
  // response after the user returns to the saved mainline. Give the first
  // request a deliberately late, synthetic scored result, then verify that
  // reopening the branch requires a fresh request instead of stale prose.
  const staleContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  let releaseObsolete=()=>{};
  const obsoleteGate=new Promise(resolve=>{releaseObsolete=resolve;});
  try{
    await staleContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await staleContext.newPage();
    const storedPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    const initialChess=new Chess();
    const beforeFen=initialChess.fen();
    const d4=initialChess.move('d4');
    assert.ok(d4);
    const syntheticOldQuality={source:'variation',scoring_version:1,fen_before:beforeFen,
      fen_after:initialChess.fen(),ply:1,san:'d4',uci:'d2d4',from:'d2',to:'d4',
      classification:'brilliant',centipawn_loss:0,win_pct_drop:0,eval_before_cp:0,
      eval_after_cp:200,mate_before:null,mate_after:null,best_move_uci:'d2d4',
      best_move_san:'d4',best_pv:[],is_best:true,legal_move_count:20,
      depth_before:12,depth_after:12,candidate_count:20,terminal:null};
    let scoringRequests=0;
    await page.route('**/api/analyze/variation-move',async route=>{
      scoringRequests++;
      if(scoringRequests===1){
        await obsoleteGate;
        // The browser may have aborted the fetch; fulfilling a cancelled
        // intercepted request is expected to fail without impacting the app.
        await route.fulfill({status:200,contentType:'application/json',
          body:JSON.stringify({quality:syntheticOldQuality})}).catch(()=>{});
      }else{
        await route.fulfill({status:503,contentType:'application/json',body:'{"error":"engine_unavailable"}'});
      }
    });
    await page.goto(`${base}/review/${id}?ply=0`,{waitUntil:'domcontentloaded'});
    await page.locator('cg-board').waitFor({state:'visible'});
    const board=await page.locator('cg-board').boundingBox();
    assert.ok(board);
    const requestStarted=page.waitForRequest(request=>request.url().endsWith('/api/analyze/variation-move'));
    await page.mouse.move(board.x+board.width*3.5/8,board.y+board.height*6.5/8);
    await page.mouse.down();
    await page.mouse.move(board.x+board.width*3.5/8,board.y+board.height*4.5/8,{steps:12});
    await page.mouse.up();
    await requestStarted;
    const english=JSON.parse(readFileSync(new URL('../web/src/locales/en.json',import.meta.url),'utf8'));
    await page.getByRole('button',{name:english.review.variationReturn}).click();
    await page.waitForFunction(()=>document.querySelector('[data-move-transport]')?.textContent?.replace(/\s+/g,' ').trim().startsWith('0 /'));
    releaseObsolete();
    await page.waitForTimeout(200);
    const freshRequest=page.waitForRequest(request=>request.url().endsWith('/api/analyze/variation-move'));
    await page.getByRole('button',{name:english.review.variationOption
      .replace('{{number}}','1').replace('{{moves}}','1')}).click();
    await freshRequest;
    await page.getByText(english.review.variationEngineUnavailable,{exact:true}).waitFor({state:'visible'});
    assert.equal(scoringRequests,2,
      'Reopening a branch must not replay obsolete engine scores from a cancelled request');
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,storedPgn);
    await page.screenshot({path:join(output,'abandoned-variation-scoring-390.png')});
  }finally{
    releaseObsolete();
    await staleContext.close();
  }
  // A response that claims the correct final FEN but identifies a different
  // preceding move must not be presented as a Brilliant (or any) score.
  // Source identity is stronger than matching the resulting board alone.
  const mismatchedContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await mismatchedContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await mismatchedContext.newPage();
    const originalPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    const chess=new Chess();
    const sourceFen=chess.fen();
    assert.ok(chess.move('d4'));
    const resultFen=chess.fen();
    let interceptedRequest=false;
    const receivedScoringRequests=[];
    const mismatchedQuality={
      source:'variation',scoring_version:1,fen_before:'different-source-fen',
      fen_after:resultFen,ply:1,san:'e4',uci:'e2e4',from:'e2',to:'e4',
      classification:'brilliant',centipawn_loss:0,win_pct_drop:0,
      eval_before_cp:0,eval_after_cp:200,mate_before:null,mate_after:null,
      best_move_uci:'e2e4',best_move_san:'e4',best_pv:[],is_best:true,
      legal_move_count:20,depth_before:12,depth_after:12,candidate_count:20,terminal:null,
    };
    await page.route('**/api/analyze/variation-move',async route=>{
      const request=route.request().postDataJSON();
      interceptedRequest=true;
      receivedScoringRequests.push(request);
      const quality=receivedScoringRequests.length===1 ? mismatchedQuality : {
        ...mismatchedQuality,fen_before:sourceFen,uci:'d2d4',san:'d4',
        from:'d2',to:'d4',classification:'best',best_move_uci:'d2d4',best_move_san:'d4',
      };
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({quality})});
    });
    await page.goto(`${base}/review/${id}?ply=0`,{waitUntil:'domcontentloaded'});
    const board=await page.locator('cg-board').boundingBox();
    assert.ok(board);
    const from={x:board.x+board.width*3.5/8,y:board.y+board.height*6.5/8};
    const to={x:board.x+board.width*3.5/8,y:board.y+board.height*4.5/8};
    const scoringCompleted=page.waitForResponse(response=>response.url().endsWith('/api/analyze/variation-move') && response.status()===200,{timeout:6000});
    await page.mouse.move(from.x,from.y);
    await page.mouse.down();
    await page.mouse.move(to.x,to.y,{steps:12});
    await page.mouse.up();
    await scoringCompleted;
    assert.ok(interceptedRequest,'Injected mismatched engine response must reach the browser');
    assert.equal(receivedScoringRequests[0]?.fen_before,sourceFen);
    assert.equal(receivedScoringRequests[0]?.move_uci,'d2d4');
    const locale=JSON.parse(readFileSync(new URL('../web/src/locales/en.json',import.meta.url),'utf8'));
    await page.getByText(locale.review.variationMove.replace('{{san}}','d4'),{exact:true}).waitFor({state:'visible'});
    await page.getByText(locale.review.variationProgress.replace('{{current}}','1').replace('{{total}}','1'),{exact:true})
      .waitFor({state:'visible'});
    const mismatchNotice=page.getByText(locale.review.variationSourceMismatch,{exact:true});
    await mismatchNotice.waitFor({state:'visible',timeout:3000});
    await mismatchNotice.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'mismatched-variation-score-rejected-390.png')});
    assert.equal(await page.locator('[data-review-variation-quality]').count(),0,
      'A score for a different move must never classify the active variation');
    assert.ok(await page.getByLabel(locale.review.variationEvalUnavailable).count()>0,
      'Rejected engine data must not display a fabricated active variation evaluation');
    const matchedAgain=page.waitForResponse(response=>response.url().endsWith('/api/analyze/variation-move') && response.status()===200);
    const retryButton=page.getByRole('button',{name:locale.review.variationRetryScoring});
    await retryButton.focus();
    await page.keyboard.press('Enter');
    await matchedAgain;
    await page.locator('[data-review-variation-quality]').getByText(locale.classification.best,{exact:true}).waitFor({state:'visible',timeout:3000});
    const retryFocus=await page.evaluate(()=>({
      tag:document.activeElement?.tagName,
      onMoveSummary:document.activeElement?.hasAttribute('data-review-move-summary'),
    }));
    assert.equal(retryFocus.onMoveSummary,true,
      `Keyboard Retry must focus the current move status after its action unmounts: ${JSON.stringify(retryFocus)}`);
    await page.getByText(locale.review.variationSourceMismatch,{exact:true}).waitFor({state:'hidden'});
    assert.equal(receivedScoringRequests.length,2,'Retry should fetch a fresh response for the same authoritative move');
    await page.screenshot({path:join(output,'matched-variation-score-after-retry-390.png')});
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,originalPgn);
  }finally{await mismatchedContext.close();}
  // A cached engine report with the same UCI sequence but FENs from another
  // real chess position can still describe a different evaluation. The
  // Game Review must not show its fabricated Brilliant or score for the PGN.
  const storedFenContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await storedFenContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await storedFenContext.newPage();
    const originalPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    let intercepted=false;
    await page.route(`**/api/games/${id}`,async route=>{
      const response=await route.fetch();
      const details=await response.json();
      assert.ok(details.analysis?.moves_json);
      const recorded=JSON.parse(details.analysis.moves_json);
      assert.equal(recorded[0].uci,'e2e4');
      // Nf3 d5 e4 is a legal alternate game with the *same* e2e4 UCI, but
      // drastically different position/evaluation evidence from initial e4.
      const alternate=new Chess();
      alternate.move('Nf3');alternate.move('d5');
      recorded[0].fen_before=alternate.fen();
      alternate.move('e4');
      recorded[0].fen_after=alternate.fen();
      recorded[0].classification='brilliant';
      recorded[0].eval_after_cp=700;
      details.analysis.moves_json=JSON.stringify(recorded);
      intercepted=true;
      await route.fulfill({response,contentType:'application/json',body:JSON.stringify(details)});
    });
    await page.goto(`${base}/review/${id}?ply=1`,{waitUntil:'domcontentloaded'});
    const locale=JSON.parse(readFileSync(new URL('../web/src/locales/en.json',import.meta.url),'utf8'));
    await page.getByText(locale.review.storedAnalysisUnreadable,{exact:true}).waitFor({state:'visible',timeout:5000});
    assert.ok(intercepted,'The test must intercept and contaminate the cached review payload');
    assert.equal(await page.locator('[data-review-move-explanation]').count(),0,
      'Source-inconsistent cached analysis must not drive the coaching card');
    assert.equal(await page.getByText(locale.classification.brilliant,{exact:true}).count(),0,
      'A Brilliant claim from another position must never be displayed for the saved game');
    await page.screenshot({path:join(output,'stored-fen-mismatch-rejected-390.png')});
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,originalPgn);
  }finally{await storedFenContext.close();}
  // A cached Key Moment is independently serialized from the scored move.
  // Matching the game source is insufficient if that moment mislabels the
  // same ply as Brilliant while the authoritative engine move says Book.
  const mismatchedMomentContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await mismatchedMomentContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await mismatchedMomentContext.newPage();
    const savedPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    let received=false;
    await page.route(`**/api/games/${id}`,async route=>{
      const response=await route.fetch();
      const details=await response.json();
      const firstMove=JSON.parse(details.analysis.moves_json)[0];
      assert.equal(firstMove.classification,'book');
      details.analysis.key_moments_json=JSON.stringify([{
        ply:firstMove.ply,side:'white',san:firstMove.san,fen_before:firstMove.fen_before,
        classification:'brilliant',cp_loss:750,win_pct_delta:80,
        best_san:'Nf3',best_pv:['Nf3'],
      }]);
      received=true;
      await route.fulfill({response,contentType:'application/json',body:JSON.stringify(details)});
    });
    await page.goto(`${base}/review/${id}?ply=1`,{waitUntil:'domcontentloaded'});
    const locale=JSON.parse(readFileSync(new URL('../web/src/locales/en.json',import.meta.url),'utf8'));
    await page.getByText(locale.review.storedAnalysisUnreadable,{exact:true}).waitFor({state:'visible',timeout:5000});
    assert.ok(received,'Browser must receive the contaminated Key Moment payload');
    assert.equal(await page.getByText(locale.classification.brilliant,{exact:true}).count(),0,
      'Contradictory Key Moment classification must never appear as a truthful score');
    await page.screenshot({path:join(output,'stored-key-moment-mismatch-rejected-390.png')});
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,savedPgn);
  }finally{await mismatchedMomentContext.close();}
  // A Key Moment can match SAN/FEN/classification while advertising an
  // impossible win-chance swing. The underlying before/after engine scores
  // are the only evidence for that percentage; reject a contradictory 90wp.
  const inflatedWinContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await inflatedWinContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await inflatedWinContext.newPage();
    const savedPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    let tampered=false;
    await page.route(`**/api/games/${id}`,async route=>{
      const response=await route.fetch();
      const details=await response.json();
      const scored=JSON.parse(details.analysis.moves_json)[1];
      assert.ok(scored && scored.eval_before_cp!=null && scored.eval_after_cp!=null);
      assert.ok(Math.abs(cpToWinPct(scored.eval_before_cp)-cpToWinPct(scored.eval_after_cp))<10);
      details.analysis.key_moments_json=JSON.stringify([{
        ply:scored.ply,side:'black',san:scored.san,fen_before:scored.fen_before,
        classification:scored.classification,cp_loss:scored.centipawn_loss,
        win_pct_delta:90,best_san:scored.best_move_san,best_pv:scored.best_pv,
      }]);
      tampered=true;
      await route.fulfill({response,contentType:'application/json',body:JSON.stringify(details)});
    });
    await page.goto(`${base}/review/${id}?ply=2`,{waitUntil:'domcontentloaded'});
    const locale=JSON.parse(readFileSync(new URL('../web/src/locales/en.json',import.meta.url),'utf8'));
    await page.getByText(locale.review.storedAnalysisUnreadable,{exact:true}).waitFor({state:'visible',timeout:5000});
    assert.ok(tampered,'The browser must receive the inflated Key Moment swing');
    await page.screenshot({path:join(output,'stored-key-moment-inflated-odds-rejected-390.png')});
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,savedPgn);
  }finally{await inflatedWinContext.close();}
  // A legitimate cached move/classification can still carry malformed
  // advisory fields. The move header, coaching explanation and board arrow
  // must not display an invented 'best Qh5' when the stored best UCI is e4.
  const falseBestContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await falseBestContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await falseBestContext.newPage();
    const savedPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    let changed=false;
    await page.route(`**/api/games/${id}`,async route=>{
      const response=await route.fetch();
      const details=await response.json();
      const scored=JSON.parse(details.analysis.moves_json);
      assert.equal(scored[0].uci,'e2e4');
      scored[0].best_move_uci='e2e4';
      scored[0].best_move_san='Qh5';
      scored[0].best_pv=['Qh5','Qh4'];
      scored[1].best_move_uci='g7g5';
      scored[1].best_move_san='Qh5';
      scored[1].best_pv=['Qh5'];
      details.analysis.moves_json=JSON.stringify(scored);
      changed=true;
      await route.fulfill({response,contentType:'application/json',body:JSON.stringify(details)});
    });
    await page.goto(`${base}/review/${id}?ply=0`,{waitUntil:'domcontentloaded'});
    await page.locator('cg-board').waitFor({state:'visible'});
    await page.locator('[data-review-move-summary]').waitFor({state:'visible'});
    assert.ok(changed,'The Chromium fixture must replace the cached best-move advice');
    assert.equal(await page.locator('[data-review-best-arrow-note]').count(),0,
      'A saved-game best arrow must require matching legal UCI and SAN');
    await page.getByRole('button',{name:'Next',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-review-move-progress]')?.textContent?.trim().startsWith('1 /'));
    assert.equal(await page.locator('[data-review-move-summary]').getByText(/Qh5/).count(),0,
      'The current-move summary must not claim an impossible best move');
    assert.equal(await page.locator('[data-review-best-arrow-note]').count(),0,
      'The next move on the mainline must not expose an unverified best arrow');
    await page.locator('[data-review-jump-to-details]').click();
    const explanation=page.locator('[data-review-move-explanation]');
    await explanation.waitFor({state:'visible'});
    assert.equal(await explanation.getByText(/Qh5/).count(),0,
      'The explanation must not repeat an illegal SAN or fake continuation');
    assert.equal(await explanation.locator('[data-review-show-best-move]').count(),0,
      'A corrupted advisory move must not offer a clickable best-move CTA');
    await page.screenshot({path:join(output,'stored-best-move-label-rejected-390.png')});
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,savedPgn);
  }finally{await falseBestContext.close();}
  // Hide-corrupt-advice-only is not enough. The configured AI coach receives
  // its own FACTS body; a corrupt best_san/PV must not be sent there as
  // authoritative evidence after the visible coaching card hid those fields.
  const coachFactsContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await coachFactsContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await coachFactsContext.newPage();
    const savedPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    await page.route('**/api/coach/status',async route=>
      route.fulfill({status:200,contentType:'application/json',body:'{"configured":true}'}));
    await page.route(`**/api/games/${id}`,async route=>{
      const response=await route.fetch();
      const details=await response.json();
      const scored=JSON.parse(details.analysis.moves_json);
      assert.equal(scored[0].uci,'e2e4');
      scored[0].best_move_uci='e2e4';
      scored[0].best_move_san='Qh5';
      scored[0].best_pv=['Qh5','Qh4'];
      details.analysis.moves_json=JSON.stringify(scored);
      await route.fulfill({response,contentType:'application/json',body:JSON.stringify(details)});
    });
    const coachBodies=[];
    await page.route('**/api/coach/explain',async route=>{
      coachBodies.push(route.request().postDataJSON());
      await route.fulfill({status:200,contentType:'text/event-stream',
        body:'data: Synthetic coach answer for isolated request validation\n\n'});
    });
    await page.goto(`${base}/review/${id}?ply=1`,{waitUntil:'domcontentloaded'});
    await page.locator('[data-review-jump-to-details]').click();
    await page.locator('[data-review-move-explanation]').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('.coach-md')?.textContent?.includes('Synthetic coach answer'),
      undefined,{timeout:5000});
    assert.equal(coachBodies.length,1,'The coaching card should issue one debounced request');
    assert.equal(coachBodies[0].played_san,'e4');
    assert.equal(coachBodies[0].classification,'book');
    assert.equal(coachBodies[0].best_san,null,
      'Invalid best-move SAN must not be sent as an AI coaching fact');
    assert.deepEqual(coachBodies[0].pv_san,[],
      'A fabricated PV must not reach the LLM FACTS payload');
    await page.screenshot({path:join(output,'coach-request-unsupported-best-filtered-390.png')});
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,savedPgn);
  }finally{await coachFactsContext.close();}
  // Source generation is part of the truth of an AI explanation. On a
  // harmless bookmark change the coach should not be regenerated; on a real
  // reanalysis of the same PGN/ply, old narration must be cleared and its
  // request replaced even though the selected move number is unchanged.
  const coachGenerationContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await coachGenerationContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await coachGenerationContext.newPage();
    const savedPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    let generation=1;
    let fetched=0;
    let coachCalls=0;
    await page.route('**/api/coach/status',async route=>
      route.fulfill({status:200,contentType:'application/json',body:'{"configured":true}'}));
    await page.route(`**/api/games/${id}`,async route=>{
      const response=await route.fetch();
      const details=await response.json();
      assert.ok(details.analysis?.source_hash && details.analysis?.source_revision === details.game.source_revision);
      details.analysis.analysis_generation=generation;
      fetched++;
      await route.fulfill({response,contentType:'application/json',body:JSON.stringify(details)});
    });
    await page.route('**/api/coach/explain',async route=>{
      coachCalls++;
      await route.fulfill({status:200,contentType:'text/event-stream',
        body:`data: Isolated coaching for source generation ${generation}\n\n`});
    });
    await page.goto(`${base}/review/${id}?ply=15`,{waitUntil:'domcontentloaded'});
    await page.locator('[data-review-jump-to-details]').click();
    await page.getByText('Isolated coaching for source generation 1',{exact:true}).waitFor({state:'visible',timeout:5000});
    assert.equal(coachCalls,1);
    // The fetch count is watched through the page-route hook; bookmarking is
    // a real disposable DB mutation, not a synthetic React state injection.
    const firstCount=fetched;
    const sameGenerationResponse=page.waitForResponse(response=>response.url().endsWith(`/api/games/${id}`)
      && response.request().method()==='GET' && response.status()===200);
    await page.getByRole('button',{name:'Star',exact:true}).click();
    await sameGenerationResponse;
    assert.ok(fetched>firstCount,'Bookmark edit must refetch the current game in the disposable browser');
    await page.waitForTimeout(850);
    assert.equal(coachCalls,1,'A harmless bookmark change must not restart AI coaching');
    generation=2;
    const secondCount=fetched;
    const nextGenerationResponse=page.waitForResponse(response=>response.url().endsWith(`/api/games/${id}`)
      && response.request().method()==='GET' && response.status()===200);
    await page.getByRole('button',{name:'Starred',exact:true}).click();
    await nextGenerationResponse;
    assert.ok(fetched>secondCount,'A second bookmark edit must refetch the new source generation');
    await page.getByText('Isolated coaching for source generation 2',{exact:true}).waitFor({state:'visible',timeout:5000});
    assert.ok(coachCalls>=2,'A changed authoritative generation requires new coaching evidence');
    assert.equal(await page.getByText('Isolated coaching for source generation 1',{exact:true}).count(),0,
      'Obsolete narration must not remain mounted after the source generation changes');
    await page.getByText('Isolated coaching for source generation 2',{exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'coach-new-generation-replaces-stale-prose-390.png')});
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,savedPgn);
  }finally{await coachGenerationContext.close();}
  // A position-matched engine result can still lie about the move itself:
  // UCI e2e4 with a visible d4 label, or an illegal projected SAN line. The
  // board must not offer that result as a truthful clickable engine move.
  const engineLineContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await engineLineContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await engineLineContext.newPage();
    const originalPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    const initialFen=new Chess().fen();
    let engineRequests=0;
    await page.route('**/api/analyze/position',async route=>{
      const data=route.request().postDataJSON();
      assert.equal(data.fen,initialFen,'The engine query must use the displayed pre-move FEN');
      engineRequests++;
      const scoredLine={uci:'e2e4',san:'e4',pv_san:['e4','e5','Nf3'],cp:45,mate:null,multipv:1};
      const unsignedTerminalLine={uci:'d2d4',san:'d4',pv_san:['d4','d5'],cp:0,mate:0,multipv:2};
      const lines=engineRequests===1
        ? [{...scoredLine,san:'d4',pv_san:['d4']}]
        : [scoredLine,unsignedTerminalLine];
      await route.fulfill({status:200,contentType:'application/json',
        body:JSON.stringify({fen:initialFen,depth:18,lines})});
    });
    await page.goto(`${base}/review/${id}?ply=0`,{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Engine lines',exact:true}).click();
    await page.locator('#review-engine-lines-content').waitFor({state:'visible'});
    await page.getByText('Engine lines are unavailable.',{exact:true}).waitFor({state:'visible',timeout:5000});
    assert.equal(await page.getByRole('button',{name:'Follow played move d4'}).count(),0,
      'A legal UCI must never be displayed under another move name');
    await page.getByText('Engine lines are unavailable.',{exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'engine-line-wrong-san-rejected-390.png')});
    const retryHit=await page.getByRole('button',{name:'Retry',exact:true}).boundingBox();
    const contrastAndSize={
      errorContrast:await renderedContrast(page,'#review-engine-lines-content [role="status"] span'),
      retryWidth:retryHit?.width,retryHeight:retryHit?.height,
    };
    console.log('Engine-line dark-mode error legibility:',JSON.stringify(contrastAndSize));
    assert.ok(contrastAndSize.errorContrast>=4.5,
      `Engine error text must be readable against its dark card: ${JSON.stringify(contrastAndSize)}`);
    assert.ok(contrastAndSize.retryWidth>=44 && contrastAndSize.retryHeight>=44,
      `Engine recovery Retry must have a 44px minimum touch target: ${JSON.stringify(contrastAndSize)}`);
    const scoredAgain=page.waitForResponse(response=>response.url().endsWith('/api/analyze/position')&&response.status()===200);
    await page.getByRole('button',{name:'Retry',exact:true}).focus();
    await page.keyboard.press('Enter');
    await scoredAgain;
    const validMove=page.getByRole('button',{name:'Follow played move e4'});
    await validMove.waitFor({state:'visible',timeout:5000});
    const accessibleLine=await validMove.evaluate(element=>{
      const ids=element.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) || [];
      return {action:element.getAttribute('aria-label'), ids,
        text:ids.map(key=>document.getElementById(key)?.textContent?.trim() || '').join(' ')};
    });
    assert.deepEqual(accessibleLine.text,'+0.45 e4 e5 Nf3',
      `A valid engine action must describe its source-backed score and legal PV: ${JSON.stringify(accessibleLine)}`);
    assert.equal(accessibleLine.ids.length,2,
      'The accessible line description must reference the separate visible score and PV');
    const unsignedLine=page.getByRole('button',{name:'Try engine move d4'});
    await unsignedLine.waitFor({state:'visible',timeout:5000});
    assert.equal((await unsignedLine.locator('[data-review-engine-line-score]').innerText()).trim(),'—',
      'Mate zero must never claim the Black side wins a false -#0, nor invent a drawn cp value');
    assert.ok(await unsignedLine.isEnabled(),
      'Score uncertainty must not hide a still-legal engine continuation from the same FEN');
    const focused=await page.evaluate(()=>({
      tag:document.activeElement?.tagName,
      id:document.activeElement?.id,
    }));
    assert.equal(focused.id,'review-engine-lines-content',
      `Keyboard Retry must retain context after the disappearing button unmounts: ${JSON.stringify(focused)}`);
    await page.keyboard.press('Tab');
    assert.ok(await validMove.evaluate(el=>document.activeElement===el),
      'Tab from recovered engine content should enter the first playable engine line');
    await page.waitForFunction(()=>document.querySelector('.review-board-square')
      ?.getAttribute('data-review-live-preview-uci')==='e2e4',undefined,{timeout:3000});
    await page.screenshot({path:join(output,'engine-line-keyboard-preview-390.png')});
    await page.locator('.review-board-square').scrollIntoViewIfNeeded();
    assert.ok(await validMove.evaluate(el=>document.activeElement===el),
      'Revealing the board preview must keep keyboard focus on the chosen engine line');
    await page.screenshot({path:join(output,'engine-line-keyboard-board-arrow-390.png')});
    await unsignedLine.focus();
    await page.waitForFunction(()=>document.querySelector('.review-board-square')
      ?.getAttribute('data-review-live-preview-uci')==='d2d4',undefined,{timeout:3000});
    await page.locator('.review-board-square').focus();
    await page.waitForFunction(()=>!document.querySelector('.review-board-square')
      ?.hasAttribute('data-review-live-preview-uci'),undefined,{timeout:3000});
    await validMove.focus();
    await page.waitForFunction(()=>document.querySelector('.review-board-square')
      ?.getAttribute('data-review-live-preview-uci')==='e2e4',undefined,{timeout:3000});
    await page.getByText('Engine lines are unavailable.',{exact:true}).waitFor({state:'hidden'});
    await page.screenshot({path:join(output,'engine-line-matched-after-retry-390.png')});
    const pvContrast=await renderedContrast(page,'#review-engine-lines-content button[aria-label="Follow played move e4"] span:nth-child(4)');
    const playedContrast=await renderedContrast(page,'#review-engine-lines-content button[aria-label="Follow played move e4"] span:nth-child(5)');
    console.log('Engine-line dark PV/played contrast:',JSON.stringify({pvContrast,playedContrast}));
    assert.ok(pvContrast>=4.5 && playedContrast>=4.5,
      `Projected SAN and played marker must be legible: ${JSON.stringify({pvContrast,playedContrast})}`);
    // A focused engine suggestion describes the current position. Global
    // Review Arrow/Home/End shortcuts must not silently change that position
    // from inside an engine-line button, detaching its focused move context.
    const engineFocusedPly=(await page.locator('[data-review-move-progress]').innerText()).trim();
    await validMove.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal((await page.locator('[data-review-move-progress]').innerText()).trim(),engineFocusedPly,
      'ArrowRight on a focused engine suggestion must not navigate its underlying saved PGN');
    assert.ok(await validMove.evaluate(element=>document.activeElement===element),
      'The same engine suggestion should retain focus after a blocked global shortcut');
    assert.equal(await page.locator('.review-board-square').getAttribute('data-review-live-preview-uci'),'e2e4');
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Try engine move d4'
      && document.querySelector('.review-board-square')?.getAttribute('data-review-live-preview-uci')==='d2d4',
      undefined,{timeout:3000});
    assert.equal((await page.locator('[data-review-move-progress]').innerText()).trim(),engineFocusedPly,
      'ArrowDown must compare live engine suggestions without playing a saved move');
    await page.screenshot({path:join(output,'engine-line-keyboard-arrowdown-preview-390.png')});
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Follow played move e4'
      && document.querySelector('.review-board-square')?.getAttribute('data-review-live-preview-uci')==='e2e4',
      undefined,{timeout:3000});
    await page.keyboard.press('End');
    await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Try engine move d4',
      undefined,{timeout:3000});
    await page.keyboard.press('Home');
    await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Follow played move e4',
      undefined,{timeout:3000});
    assert.equal((await page.locator('[data-review-move-progress]').innerText()).trim(),engineFocusedPly,
      'Home/End on the engine list must not jump the original chessboard');
    // Collapsing Engine Lines from its persistent header must never strand
    // keyboard focus inside hidden, inactive suggestions.
    const linesDisclosure=page.getByRole('button',{name:'Engine lines',exact:true});
    await linesDisclosure.focus();
    await page.keyboard.press('Enter');
    assert.equal(await linesDisclosure.getAttribute('aria-expanded'),'false');
    assert.ok(await linesDisclosure.evaluate(element=>document.activeElement===element),
      'Closing engine suggestions should preserve focus on the disclosure');
    await page.keyboard.press('Enter');
    assert.equal(await linesDisclosure.getAttribute('aria-expanded'),'true');
    await validMove.focus();
    await validMove.click();
    await page.waitForFunction(()=>document.querySelector('[data-move-transport]')?.textContent?.replace(/\s+/g,' ').trim().startsWith('1 /'));
    assert.ok(await page.locator('.review-board-square').evaluate(element=>document.activeElement===element),
      'Applying a focused engine suggestion must focus the updated board when its button disappears');
    assert.equal(await page.locator('.review-board-square').getAttribute('data-review-live-preview-uci'),null,
      'A line-focused preview from the starting FEN must not survive navigation to Black-to-move');
    assert.equal(engineRequests,3,
      'Initial request, explicit retry, and reopening the on-demand panel each fetch the displayed FEN');
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,originalPgn);
    // The disclosure button itself remains mounted, unlike the candidate
    // buttons. Global Home/Arrow shortcuts must not unexpectedly navigate
    // the saved PGN while the user is focused on this native control.
    await linesDisclosure.click();
    assert.equal(await linesDisclosure.getAttribute('aria-expanded'),'false');
    await linesDisclosure.focus();
    const disclosurePly=(await page.locator('[data-review-move-progress]').innerText()).trim();
    await page.keyboard.press('Home');
    assert.equal((await page.locator('[data-review-move-progress]').innerText()).trim(),disclosurePly,
      'Home on a focused Engine Lines disclosure must not reset the saved chess position');
    await page.keyboard.press('ArrowRight');
    assert.equal((await page.locator('[data-review-move-progress]').innerText()).trim(),disclosurePly,
      'ArrowRight on a focused Engine Lines disclosure must not advance the saved chess position');
    assert.ok(await linesDisclosure.evaluate(element=>document.activeElement===element),
      'The disclosure must retain keyboard focus after Home and ArrowRight');
    const locale=JSON.parse(readFileSync(new URL('../web/src/locales/en.json',import.meta.url),'utf8'));
    for(const name of [locale.threat.title,locale.explorer.title]){
      const disclosure=page.getByRole('button',{name,exact:true});
      await disclosure.focus();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');
      assert.equal((await page.locator('[data-review-move-progress]').innerText()).trim(),disclosurePly,
        `Global Review shortcuts must not navigate the saved game from focused ${name}`);
      assert.ok(await disclosure.evaluate(element=>document.activeElement===element),
        `Focused ${name} disclosure should keep keyboard focus during navigation keys`);
    }
    // The exclusion is narrow: global Review navigation still works when
    // the board itself, not a disclosure control, has keyboard focus.
    await page.locator('.review-board-square').focus();
    await page.keyboard.press('Home');
    await page.waitForFunction(()=>document.querySelector('[data-review-move-progress]')?.textContent?.trim().startsWith('0 /'));
    await page.keyboard.press('ArrowRight');
    assert.equal((await page.locator('[data-review-move-progress]').innerText()).trim(),disclosurePly,
      'Global Home and ArrowRight must still navigate the board outside disclosure controls');
    // The mobile jump-to-details and toolbar buttons are actions, not board
    // navigation surfaces. Focused action buttons should not accidentally
    // replay a move when a keyboard user presses Home or an arrow key.
    for(const action of [
      page.locator('[data-review-jump-to-details]'),
      page.getByRole('button',{name:'Star',exact:true}),
      page.locator('[data-move-transport] button').nth(3),
    ]){
      await action.focus();
      await page.keyboard.press('Home');
      assert.equal((await page.locator('[data-review-move-progress]').innerText()).trim(),disclosurePly,
        'Home on a focused Game Review action button must not jump to the opening');
      await page.keyboard.press('ArrowRight');
      assert.equal((await page.locator('[data-review-move-progress]').innerText()).trim(),disclosurePly,
        'ArrowRight on a focused Game Review action button must not play an unintended move');
      assert.ok(await action.evaluate(element=>document.activeElement===element),
        'A focused Review action button should retain keyboard focus');
    }
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,originalPgn);
  }finally{await engineLineContext.close();}
  // Engine Lines can be collapsed while an HTTP search is still in flight.
  // Opening the same FEN again starts a fresh request; a late response from
  // the abandoned request must not replace the new legal recommendation.
  const cancelLinesContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  let releaseOldLineRequest;
  try{
    await cancelLinesContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await cancelLinesContext.newPage();
    const originalPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    const fen=new Chess().fen();
    let requests=0;
    let signalOldRequest;
    let signalOldSettled;
    const oldRequestStarted=new Promise(resolve=>{signalOldRequest=resolve;});
    const oldRequestSettled=new Promise(resolve=>{signalOldSettled=resolve;});
    const oldRequestGate=new Promise(resolve=>{releaseOldLineRequest=resolve;});
    await page.route('**/api/analyze/position',async route=>{
      assert.equal(route.request().postDataJSON().fen,fen);
      requests++;
      if(requests===1){
        signalOldRequest();
        await oldRequestGate;
        try{
          await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
            fen,depth:18,lines:[{uci:'d2d4',san:'d4',pv_san:['d4','d5'],cp:20,mate:null,multipv:1}],
          })});
        }catch{
          // An AbortController may already have terminated the first fetch.
        }finally{
          signalOldSettled();
        }
      }else{
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
          fen,depth:18,lines:[{uci:'e2e4',san:'e4',pv_san:['e4','e5'],cp:40,mate:null,multipv:1}],
        })});
      }
    });
    await page.goto(`${base}/review/${id}?ply=0`,{waitUntil:'domcontentloaded'});
    const header=page.getByRole('button',{name:'Engine lines',exact:true});
    await header.click();
    await Promise.race([oldRequestStarted,sleep(5000).then(()=>{throw new Error('First engine request never started');})]);
    await header.click();
    assert.equal(await header.getAttribute('aria-expanded'),'false');
    await header.click();
    await page.getByRole('button',{name:'Follow played move e4'}).waitFor({state:'visible',timeout:5000});
    releaseOldLineRequest();
    await Promise.race([oldRequestSettled,sleep(5000).then(()=>{throw new Error('Abandoned engine response never settled');})]);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(requests,2,'Reopening a cancelled engine panel should initiate only one fresh request');
    assert.ok(await page.getByRole('button',{name:'Follow played move e4'}).isEnabled(),
      'The newer on-demand engine line must survive a delayed abandoned response');
    assert.equal(await page.getByRole('button',{name:'Try engine move d4'}).count(),0,
      'An abandoned engine search must not overwrite newer recommendations for the same FEN');
    await page.locator('#review-engine-lines-content').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'engine-lines-reopened-stale-response-390.png')});
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,originalPgn);
  }finally{releaseOldLineRequest?.();await cancelLinesContext.close();}
  // A malformed HTTP MultiPV result can supply two individually legal moves
  // with duplicate rank 1, or the same move at multiple ranks. Do not render
  // two conflicting "best" rows; surface the existing safe Retry state.
  const duplicateRankContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await duplicateRankContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await duplicateRankContext.newPage();
    const initialFen=new Chess().fen();
    const originalRankPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    let requests=0;
    await page.route('**/api/analyze/position',async route=>{
      assert.equal(route.request().postDataJSON().fen,initialFen);
      requests++;
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        fen:initialFen,depth:18,lines:requests===1 ? [
          {uci:'e2e4',san:'e4',pv_san:['e4','e5'],cp:55,mate:null,multipv:1},
          {uci:'d2d4',san:'d4',pv_san:['d4','d5'],cp:70,mate:null,multipv:1},
        ] : requests===2 ? [
          // These are extreme *centipawn* scores without verified mate. Do
          // not fabricate a checkmate marker from the number's magnitude.
          {uci:'e2e4',san:'e4',pv_san:['e4','e5'],cp:9500,mate:null,multipv:1},
          {uci:'d2d4',san:'d4',pv_san:['d4','d5'],cp:-9500,mate:null,multipv:2},
        ] : requests===3 ? [
          // A corrupted response claims White mates in two while its cp
          // score favors Black. The supported adapters emit one or the other.
          {uci:'e2e4',san:'e4',pv_san:['e4','e5'],cp:-200,mate:2,multipv:1},
        ] : [
          // A fractional mate distance is not a scored UCI checkmate claim.
          // Never promote it into a best-ranked board hint.
          {uci:'e2e4',san:'e4',pv_san:['e4','e5'],cp:null,mate:1.5,multipv:1},
        ],
      })});
    });
    await page.goto(`${base}/review/${id}?ply=0`,{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Engine lines',exact:true}).click();
    await page.getByText('Engine lines are unavailable.',{exact:true}).waitFor({state:'visible',timeout:5000});
    assert.equal(await page.getByRole('button',{name:/^(Try engine move|Follow played move) (e4|d4)$/}).count(),0,
      'Malformed duplicate-best engine evidence must not appear as playable recommendations');
    const retry=page.getByRole('button',{name:'Retry',exact:true});
    assert.ok(await retry.isEnabled(),'Malformed MultiPV response must retain the real Retry recovery path');
    await retry.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'engine-lines-duplicate-rank-rejected-390.png')});
    assert.equal(requests,1);
    await retry.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelectorAll('#review-engine-lines-content [data-review-engine-line-score]').length===2,
      undefined,{timeout:5000});
    const extremeScores=await page.locator('#review-engine-lines-content [data-review-engine-line-score]').allTextContents();
    assert.deepEqual(extremeScores.map(score=>score.trim()),['+95.00','−95.00'],
      'Centipawn-only extreme scores must retain their numeric evidence, not imply a proven checkmate');
    const firstExtreme=page.getByRole('button',{name:'Follow played move e4'});
    assert.ok((await firstExtreme.getAttribute('aria-describedby'))?.includes('review-engine-line-score-0'),
      'Screen readers should receive the same source-backed numeric score');
    await firstExtreme.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'engine-line-extreme-cp-no-mate-390.png')});
    assert.equal(requests,2);
    const disclosure=page.getByRole('button',{name:'Engine lines',exact:true});
    await disclosure.click();
    await disclosure.click();
    await page.getByText('Engine lines are unavailable.',{exact:true}).waitFor({state:'visible',timeout:5000});
    assert.equal(await page.getByRole('button',{name:'Follow played move e4'}).count(),0,
      'A contradictory cp/mate response must not create a false winning move recommendation');
    await page.locator('#review-engine-lines-content').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'engine-line-contradictory-mate-rejected-390.png')});
    assert.equal(requests,3);
    const fourthResponse=page.waitForResponse(response=>response.url().endsWith('/api/analyze/position') && response.status()===200);
    await page.getByRole('button',{name:'Retry',exact:true}).click();
    await fourthResponse;
    await page.getByText('Engine lines are unavailable.',{exact:true}).waitFor({state:'visible',timeout:5000});
    assert.equal(await page.getByRole('button',{name:'Follow played move e4'}).count(),0,
      'A fractional mate must not masquerade as a scored engine recommendation');
    assert.equal(requests,4);
    await page.locator('#review-engine-lines-content').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'engine-line-fractional-mate-rejected-390.png')});
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,originalRankPgn);
  }finally{await duplicateRankContext.close();}
  // Stockfish and the hosted adapter both return live MultiPV scores from
  // the side to move's perspective. When Black is to move a positive live
  // score means Black is better; the rest of Review reports White's POV.
  // Confirm normalized cp and mate signs on a genuine saved Black-to-move FEN.
  const blackLinesContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await blackLinesContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await blackLinesContext.newPage();
    const sourcePgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    const blackPosition=new Chess();
    assert.ok(blackPosition.move('e4'));
    const blackFen=blackPosition.fen();
    let requests=0;
    await page.route('**/api/analyze/position',async route=>{
      assert.equal(route.request().postDataJSON().fen,blackFen,
        'Live engine lines must be tied to the displayed Black-to-move FEN');
      requests++;
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        fen:blackFen,depth:18,lines:[
          {uci:'e7e5',san:'e5',pv_san:['e5','Nf3'],cp:75,mate:null,multipv:1},
          {uci:'c7c5',san:'c5',pv_san:['c5','Nf3'],cp:null,mate:2,multipv:2},
          {uci:'d7d5',san:'d5',pv_san:['d5','exd5'],cp:null,mate:-1,multipv:3},
        ],
      })});
    });
    await page.goto(`${base}/review/${id}?ply=1`,{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Engine lines',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('#review-engine-lines-content [data-review-engine-line-score]').length===3,
      undefined,{timeout:5000});
    const scores=await page.locator('#review-engine-lines-content [data-review-engine-line-score]').allTextContents();
    assert.deepEqual(scores.map(value=>value.trim()),['−0.75','-#2','#1'],
      `On Black's turn, all live cp/mate labels must match White's perspective: ${JSON.stringify(scores)}`);
    const describedLines=await page.locator('#review-engine-lines-content button[aria-describedby]').evaluateAll(elements=>
      elements.map(element=>({
        label:element.getAttribute('aria-label'),
        details:(element.getAttribute('aria-describedby')?.split(/\s+/) || [])
          .map(id=>document.getElementById(id)?.textContent?.trim() || ''),
      })));
    assert.deepEqual(describedLines.map(row=>row.details),[
      ['−0.75','e5 Nf3'],['-#2','c5 Nf3'],['#1','d5 exd5'],
    ],'Screen readers must receive each correct Black-to-move score and source-legal continuation');
    const locale=JSON.parse(readFileSync(new URL('../web/src/locales/en.json',import.meta.url),'utf8'));
    await page.getByText(locale.review.linesScorePerspective,{exact:true}).waitFor({state:'visible'});
    for(const san of ['e5','c5','d5']){
      assert.ok(await page.getByRole('button',{name:new RegExp(`^(Follow played move|Try engine move) ${san}$`)}).isEnabled());
    }
    await page.locator('#review-engine-lines-content').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'engine-lines-black-turn-white-perspective-390.png')});
    assert.equal(requests,1,'One displayed FEN must produce one live MultiPV request');
    // Selecting an alternative also destroys the focused old-FEN button. It
    // should show the legal unsaved branch on the board, not lose keyboard
    // focus or silently replace the original PGN.
    const alternative=page.getByRole('button',{name:'Try engine move c5'});
    await alternative.focus();
    await page.keyboard.press('Enter');
    await page.locator('[data-review-variation-trail]').waitFor({state:'visible',timeout:5000});
    assert.ok(await page.locator('.review-board-square').evaluate(element=>document.activeElement===element),
      'Trying a new engine move must focus the resulting variation board');
    await page.screenshot({path:join(output,'engine-line-applied-alternative-board-390.png')});
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,sourcePgn);
  }finally{await blackLinesContext.close();}
  // The Game Review shell is localized, but Engine Lines used to expose raw
  // English-only 503/retry and move-action labels inside a German review. Its
  // clickable engine rows also had hitboxes under 44px on actual phones.
  const localizedLineContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    const languageSetting=await api('/api/settings/profile',{method:'PATCH',cookie:account.cookie,
      body:{language:'de',site_theme:'dark'}});
    assert.equal(languageSetting.status,200);
    await localizedLineContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await localizedLineContext.newPage();
    const savedPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    const fen=new Chess().fen();
    let requests=0;
    await page.route('**/api/analyze/position',async route=>{
      const request=route.request().postDataJSON();
      assert.equal(request.fen,fen);
      requests++;
      await route.fulfill(requests===1
        ? {status:503,contentType:'application/json',body:'{"error":"engine_unavailable"}'}
        : {status:200,contentType:'application/json',body:JSON.stringify({
            fen,depth:18,lines:[{uci:'e2e4',san:'e4',pv_san:['e4','e5'],cp:36,mate:null,multipv:1}],
          })});
    });
    await page.goto(`${base}/review/${id}?ply=0`,{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Engine-Varianten',exact:true}).click();
    await page.getByText('Engine-Varianten sind derzeit nicht verfügbar.',{exact:true}).waitFor({state:'visible',timeout:5000});
    const retry=page.getByRole('button',{name:'Erneut versuchen',exact:true});
    const retryBox=await retry.boundingBox();
    assert.ok(retryBox && retryBox.height>=44 && retryBox.width>=44);
    await page.screenshot({path:join(output,'engine-lines-localized-error-de-390.png')});
    const scored=page.waitForResponse(response=>response.url().endsWith('/api/analyze/position')&&response.status()===200);
    await retry.click();
    await scored;
    const row=page.getByRole('button',{name:'Dem gespielten Zug e4 folgen',exact:true});
    await row.waitFor({state:'visible'});
    const de=JSON.parse(readFileSync(new URL('../web/src/locales/de.json',import.meta.url),'utf8'));
    await page.getByText(de.review.linesScorePerspective,{exact:true}).waitFor({state:'visible'});
    const hit=await row.boundingBox();
    assert.ok(hit && hit.height>=44 && hit.width>=44,
      `A playable engine line should have a 44px touch target: ${JSON.stringify(hit)}`);
    await page.screenshot({path:join(output,'engine-lines-localized-row-de-390.png')});
    await page.setViewportSize({width:320,height:760});
    const narrowHit=await row.boundingBox();
    assert.ok(narrowHit && narrowHit.height>=44 && narrowHit.width>=44,
      `A playable German engine line should stay touch-friendly at 320px: ${JSON.stringify(narrowHit)}`);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert.ok(overflow<=2,`A long localized engine-row label must not force 320px overflow: ${overflow}`);
    await page.screenshot({path:join(output,'engine-lines-localized-row-de-320.png')});
    assert.equal(requests,2);
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,savedPgn);
  }finally{
    await localizedLineContext.close();
    const reset=await api('/api/settings/profile',{method:'PATCH',cookie:account.cookie,body:{language:'en'}});
    assert.equal(reset.status,200);
  }
  // A scoring failure belongs to a specific exploratory move. An error from
  // d4 must never follow the user to an already scored c4 branch when the
  // browser reselects it from cache (no new engine request is sent there).
  const branchErrorContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await branchErrorContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await branchErrorContext.newPage();
    const originalPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    const locale=JSON.parse(readFileSync(new URL('../web/src/locales/en.json',import.meta.url),'utf8'));
    const chess=new Chess();
    const fenBefore=chess.fen();
    assert.ok(chess.move('c4'));
    const c4Quality={source:'variation',scoring_version:1,
      fen_before:fenBefore,fen_after:chess.fen(),ply:1,san:'c4',uci:'c2c4',from:'c2',to:'c4',
      classification:'best',centipawn_loss:0,win_pct_drop:0,eval_before_cp:0,eval_after_cp:24,
      mate_before:null,mate_after:null,best_move_uci:'c2c4',best_move_san:'c4',best_pv:[],
      is_best:true,legal_move_count:20,depth_before:12,depth_after:12,candidate_count:20,terminal:null};
    const requests=[];
    await page.route('**/api/analyze/variation-move',async route=>{
      const request=route.request().postDataJSON();
      requests.push(request.move_uci);
      if(request.move_uci==='c2c4'){
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({quality:c4Quality})});
      }else{
        assert.equal(request.move_uci,'d2d4');
        await route.fulfill({status:503,contentType:'application/json',body:'{"error":"engine_unavailable"}'});
      }
    });
    await page.goto(`${base}/review/${id}?ply=0`,{waitUntil:'domcontentloaded'});
    await page.locator('cg-board').waitFor({state:'visible'});
    const drag=async file=>{
      const board=await page.locator('cg-board').boundingBox();
      assert.ok(board);
      await page.mouse.move(board.x+board.width*(file+.5)/8,board.y+board.height*6.5/8);
      await page.mouse.down();
      await page.mouse.move(board.x+board.width*(file+.5)/8,board.y+board.height*4.5/8,{steps:12});
      await page.mouse.up();
    };
    const failure=page.getByText(locale.review.variationEngineUnavailable,{exact:true});
    await drag(3); // d2-d4, deliberate Stockfish outage
    await failure.waitFor({state:'visible'});
    assert.equal(await page.locator('[data-review-move-summary] .font-mono.text-base').getAttribute('aria-label'),
      locale.review.variationEvalUnavailable,'A failed score should be announced as unavailable');
    const variationCounter=page.locator('[data-move-transport] > div');
    assert.equal((await variationCounter.innerText()).trim(),'Var 1 / 1',
      'An unsaved one-move branch must not display the saved game length as its own total');
    assert.equal(await page.locator('[data-move-transport]').getAttribute('aria-label'),locale.review.variationMoveNavigation);
    const feedback=page.locator('[data-review-variation-scoring-feedback]');
    await feedback.waitFor({state:'visible'});
    const feedbackRect=await feedback.boundingBox();
    assert.ok(feedbackRect && feedbackRect.y>=0 && feedbackRect.y+Math.min(feedbackRect.height,44)<=844,
      `The active move's scoring error must be discoverable above the fold: ${JSON.stringify(feedbackRect)}`);
    const retryRect=await page.getByRole('button',{name:locale.review.variationRetryScoring}).boundingBox();
    assert.ok(retryRect && retryRect.height>=44 && retryRect.width>=44,
      `The immediate mobile scoring retry must be comfortably actionable: ${JSON.stringify(retryRect)}`);
    await page.screenshot({path:join(output,'variation-scoring-failure-visible-390.png')});
    // Returning from a branch disables its own Return button. After pressing
    // Enter there, keyboard focus must reach the saved board rather than
    // remain on a disabled control or fall back to document BODY.
    const returnFromBranch=page.getByRole('button',{name:locale.review.variationReturn});
    await returnFromBranch.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('[data-review-move-progress]')?.textContent?.trim().startsWith('0 /'));
    assert.ok(await page.locator('.review-board-square').evaluate(el=>document.activeElement===el),
      'Return to game must move keyboard focus back to the original chessboard');
    await drag(2); // c2-c4, engine returns source-matched score
    await page.locator('[data-review-variation-quality]').getByText(locale.classification.best,{exact:true}).waitFor({state:'visible'});
    await failure.waitFor({state:'hidden'});
    const branchButton=index=>page.getByRole('button',{name:locale.review.variationOption
      .replace('{{number}}',String(index)).replace('{{moves}}','1')});
    await branchButton(1).click();
    // On a narrow phone the branch picker is below the board. Clicking it
    // must reveal the newly selected board instead of leaving the player
    // below the fold looking at an unchanged-looking button list.
    await page.waitForFunction(()=>document.activeElement?.classList.contains('review-board-square'),
      undefined,{timeout:1200});
    const selectedBranchBoard=await page.locator('.review-board-square').boundingBox();
    assert.ok(selectedBranchBoard && selectedBranchBoard.y>=40 && selectedBranchBoard.y<=96,
      `Switching variations on a phone must reveal the playable board: ${JSON.stringify(selectedBranchBoard)}`);
    await page.screenshot({path:join(output,'mobile-branch-selection-reveals-board-390.png')});
    await failure.waitFor({state:'visible'});
    const requestCount=requests.length;
    await branchButton(2).click();
    await page.locator('[data-review-variation-quality]').getByText(locale.classification.best,{exact:true}).waitFor({state:'visible'});
    await page.screenshot({path:join(output,'variation-cross-branch-error-390.png')});
    assert.equal(requests.length,requestCount,'Reopening a scored branch should not request the engine again');
    assert.equal(await failure.count(),0,
      'An unscored d4 error must not be shown alongside the cached, source-matched c4 score');
    assert.equal(await feedback.count(),0,'A cached, validated move must not display another branch scoring error');
    await page.getByRole('button',{name:locale.review.first}).click();
    assert.equal((await variationCounter.innerText()).trim(),'Var 0 / 1',
      'Navigating to the branch point must not display a mainline PGN ply');
    await branchButton(1).click();
    await branchButton(2).click();
    assert.equal((await variationCounter.innerText()).trim(),'Var 0 / 1',
      'Reopening a variation must preserve the last viewed cursor rather than jump to its final move');
    await page.getByRole('button',{name:locale.review.last}).click();
    assert.equal((await variationCounter.innerText()).trim(),'Var 1 / 1',
      'Navigating to the final branch move must use the active branch total');
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,originalPgn);
  }finally{await branchErrorContext.close();}
  // While the engine is still scoring an exploratory move, screen readers
  // must hear the same pending status as sighted players. An older delayed
  // score must not replace the newer move or falsely announce Brilliant.
  const pendingScoreContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  let releaseD4=()=>{};
  try{
    await pendingScoreContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await pendingScoreContext.newPage();
    const savedPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    const locale=JSON.parse(readFileSync(new URL('../web/src/locales/en.json',import.meta.url),'utf8'));
    const heldD4=new Promise(resolve=>{releaseD4=resolve;});
    const qualityFor=(fen,uci,label)=>{
      const board=new Chess(fen);
      const before=board.fen();
      const move=board.move({from:uci.slice(0,2),to:uci.slice(2,4)});
      assert.ok(move);
      return {source:'variation',scoring_version:1,fen_before:before,fen_after:board.fen(),
        ply:before.split(' ')[1]==='w'?1:2,san:move.san,uci,from:move.from,to:move.to,
        classification:label,centipawn_loss:0,win_pct_drop:0,
        eval_before_cp:0,eval_after_cp:label==='brilliant'?500:24,mate_before:null,mate_after:null,
        best_move_uci:uci,best_move_san:move.san,best_pv:[],is_best:true,
        legal_move_count:20,depth_before:12,depth_after:12,candidate_count:20,terminal:null};
    };
    const requests=[];
    await page.route('**/api/analyze/variation-move',async route=>{
      const req=route.request().postDataJSON();
      requests.push(req.move_uci);
      if(req.move_uci==='d2d4') await heldD4;
      const quality=qualityFor(req.fen_before,req.move_uci,
        req.move_uci==='d2d4'?'brilliant':'best');
      try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({quality})});}
      catch(e){if(req.move_uci!=='d2d4')throw e;}// navigation should abort the obsolete request
    });
    await page.goto(`${base}/review/${id}?ply=0`,{waitUntil:'domcontentloaded'});
    await page.locator('cg-board').waitFor({state:'visible'});
    const drag=async(from,to)=>{
      const board=await page.locator('cg-board').boundingBox();
      assert.ok(board);
      const sq=s=>({x:board.x+board.width*(s.charCodeAt(0)-97+.5)/8,
        y:board.y+board.height*(8-Number(s[1])+.5)/8});
      const a=sq(from),b=sq(to);
      await page.mouse.move(a.x,a.y);await page.mouse.down();
      await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();
    };
    const firstRequest=page.waitForRequest(req=>req.url().endsWith('/api/analyze/variation-move')
      && req.postDataJSON().move_uci==='d2d4');
    await drag('d2','d4');
    await firstRequest;
    const evalStatus=page.locator('[data-review-move-summary] .font-mono.text-base');
    await page.getByText(locale.review.variationAnalyzing,{exact:true}).waitFor({state:'visible'});
    assert.equal(await evalStatus.getAttribute('aria-label'),locale.review.variationAnalyzing,
      'A pending engine score must not be announced as an unavailable evaluation');
    const landscapeSummary=async expectedScore=>{
      await page.setViewportSize({width:568,height:320});
      const header=page.locator('[data-review-move-summary]');
      await header.scrollIntoViewIfNeeded();
      const geometry=await header.evaluate(element=>{
        const move=element.firstElementChild;
        const value=element.querySelector('.font-mono.text-base');
        if(!move||!value)return null;
        const labelRect=move.getBoundingClientRect();
        const scoreRect=value.getBoundingClientRect();
        const headerRect=element.getBoundingClientRect();
        return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,
          headerLeft:headerRect.left,headerRight:headerRect.right,
          labelRight:labelRect.right,scoreLeft:scoreRect.left,
          scoreRight:scoreRect.right,scoreWidth:scoreRect.width,
          scoreText:value.textContent?.trim()};
      });
      console.log('Landscape variation score geometry:',JSON.stringify(geometry));
      assert.ok(geometry && geometry.scoreText===expectedScore
        && geometry.documentWidth<=geometry.width+2 && geometry.headerLeft>=0
        && geometry.headerRight<=geometry.width+1 && geometry.labelRight<=geometry.scoreLeft+1
        && geometry.scoreRight<=geometry.width+1 && geometry.scoreWidth>=20,
      `The pending/ready variation score must stay legible without overlapping its move name at 568x320: ${JSON.stringify(geometry)}`);
      return geometry;
    };
    await landscapeSummary(locale.review.variationAnalyzing);
    await page.screenshot({path:join(output,'variation-scoring-landscape-pending-568x320.png')});
    await page.setViewportSize({width:390,height:844});
    // chessground can remount its inner custom element during responsive
    // resize; scroll the stable React wrapper to avoid a detached-locator race.
    await page.locator('.review-board-square').scrollIntoViewIfNeeded();
    const secondResponse=page.waitForResponse(r=>r.url().endsWith('/api/analyze/variation-move')
      && r.status()===200);
    await drag('d7','d5');
    await secondResponse;
    await page.locator('[data-review-variation-quality]').getByText(locale.classification.best,{exact:true})
      .waitFor({state:'visible'});
    assert.equal(await evalStatus.getAttribute('aria-label'),
      locale.review.variationEvalLabel.replace('{{score}}','+0.24'),
      'A completed score should be announced with its real evaluated value');
    releaseD4();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('[data-review-move-summary]').getByText('Brilliant',{exact:true}).count(),0,
      'A delayed older score must not relabel the latest exploratory move');
    assert.equal(await page.locator('[data-review-move-summary]').getByText(/d5/).count(),1);
    await landscapeSummary('+0.24');
    await page.screenshot({path:join(output,'variation-scoring-landscape-ready-568x320.png')});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:join(output,'rapid-variation-scoring-status-390.png')});
    assert.deepEqual(requests,['d2d4','d7d5']);
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,savedPgn);
  }finally{releaseD4();await pendingScoreContext.close();}
  // A nested branch must preserve its own local cursor, ancestor prefix and
  // last-move highlighting when a learner compares the sibling continuations.
  // Verify in actual chessground, on both phone and side-by-side desktop.
  for(const [width,height] of [[390,844],[1024,768]]){
    const nestedContext=await browser.newContext({viewport:{width,height},colorScheme:'dark',reducedMotion:'reduce'});
    try{
      await nestedContext.addCookies([{name:account.cookie.split('=')[0],
        value:account.cookie.split('=').slice(1).join('='),url:base}]);
      const page=await nestedContext.newPage();
      const savedPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
      await page.route('**/api/analyze/variation-move',async route=>
        route.fulfill({status:503,contentType:'application/json',body:'{"error":"engine_unavailable"}'}));
      await page.goto(`${base}/review/${id}?ply=1`,{waitUntil:'domcontentloaded'});
      await page.locator('cg-board').waitFor({state:'visible'});
      const coords=(sq,board)=>({
        x:board.x+board.width*(sq.charCodeAt(0)-97+.5)/8,
        y:board.y+board.height*(8-Number(sq[1])+.5)/8,
      });
      const dragMove=async(from,to)=>{
        const board=await page.locator('cg-board').boundingBox();
        assert.ok(board);
        const first=coords(from,board),last=coords(to,board);
        await page.mouse.move(first.x,first.y);
        await page.mouse.down();
        await page.mouse.move(last.x,last.y,{steps:12});
        await page.mouse.up();
      };
      const expectProgress=async(expected)=>{
        await page.waitForFunction(value=>document.querySelector('[data-review-move-progress]')
          ?.textContent?.trim()===value,expected,{timeout:4000});
      };
      const highlighted=async()=>page.locator('cg-board square.last-move').evaluateAll(
        squares=>squares.map(s=>s.getAttribute('style')).sort());
      const expectHighlighted=async(expected,message)=>{
        // The React move counter commits before Chessground's useEffect
        // applies its new position/last-move styles. Wait for the rendered
        // board, not merely the state counter, before judging its squares.
        await page.waitForFunction(styles=>{
          const actual=[...document.querySelectorAll('cg-board square.last-move')]
            .map(square=>square.getAttribute('style')).sort();
          return JSON.stringify(actual)===JSON.stringify(styles);
        },expected,{timeout:3000});
        assert.deepEqual(await highlighted(),expected,message);
      };
      const trail=page.getByRole('navigation',{name:'Variation moves'});
      const currentTrail=async()=> (await trail.locator('[aria-current="step"]').innerText()).trim();
      await dragMove('c7','c5');
      await expectProgress('Var 1 / 1');
      await dragMove('g1','f3');
      await expectProgress('Var 2 / 2');
      await page.getByRole('button',{name:'Previous',exact:true}).click();
      await expectProgress('Var 1 / 2');
      assert.equal(await currentTrail(),'c5');
      const parentSquares=await highlighted();
      assert.equal(parentSquares.length,2,'The original c7-c5 should highlight two board squares');
      await dragMove('d2','d4');
      await expectProgress('Var 1 / 1');
      const originalTimeline=page.getByRole('slider',{name:'Move evaluation timeline'});
      await originalTimeline.waitFor({state:'visible'});
      const english=JSON.parse(readFileSync(new URL('../web/src/locales/en.json',import.meta.url),'utf8'));
      assert.equal(await originalTimeline.getAttribute('aria-valuetext'),english.review.variationTimelineHint,
        'Exploring a variation must not label the original timeline as an unavailable current evaluation');
      await trail.getByRole('button',{name:'Go to c5 in variation 1'}).waitFor({state:'visible'});
      await trail.getByRole('button',{name:'Go to d4 in variation 2'}).waitFor({state:'visible'});
      assert.equal((await trail.locator('[data-review-trail-move]').allInnerTexts()).join(' '),'c5 d4');
      await trail.getByRole('button',{name:'Go to c5 in variation 1'}).click();
      await expectProgress('Var 1 / 2');
      await page.getByRole('button',{name:'Variation 2 · 1 moves',exact:true}).click();
      await expectProgress('Var 1 / 1');
      await page.waitForFunction(previous=>{
        const current=[...document.querySelectorAll('cg-board square.last-move')]
          .map(square=>square.getAttribute('style')).sort();
        return current.length===2 && JSON.stringify(current)!==JSON.stringify(previous);
      },parentSquares,{timeout:3000});
      const childSquares=await highlighted();
      assert.equal(childSquares.length,2);
      assert.notDeepEqual(childSquares,parentSquares,'The child move d2-d4 must have its own board highlight');
      const parent=page.getByRole('button',{name:'Variation 1 · 2 moves',exact:true});
      const child=page.getByRole('button',{name:'Variation 2 · 1 moves',exact:true});
      assert.ok((await parent.innerText()).includes('c5 Nf3'),
        'A variation pill must preview the moves to distinguish its line');
      assert.ok((await child.innerText()).includes('c5 d4'),
        'A nested child must preview its ancestral c5 and own d4 move');
      const childDescription=await child.getAttribute('aria-describedby');
      assert.ok(childDescription,'Nested branch picker needs a screen-reader description');
      assert.ok((await page.locator(`#${childDescription}`).innerText()).includes('Fork of variation 1'),
        'A child must identify its parent without forcing the learner to open it');
      await parent.click();
      await expectProgress('Var 1 / 2');
      assert.equal(await currentTrail(),'c5');
      await expectHighlighted(parentSquares,'Returning to the ancestor must restore c7-c5 highlighting');
      await child.click();
      await expectProgress('Var 1 / 1');
      assert.equal(await currentTrail(),'d4');
      await page.getByRole('button',{name:'First',exact:true}).click();
      await expectProgress('Var 0 / 1');
      assert.equal(await currentTrail(),'Branch point');
      await expectHighlighted(parentSquares,'At the child fork the last played move must be c7-c5');
      await parent.click();
      await expectProgress('Var 1 / 2');
      await child.click();
      await expectProgress('Var 0 / 1');
      await expectHighlighted(parentSquares,'Reopening a child must preserve its independent fork cursor');
      await page.getByRole('button',{name:'Last',exact:true}).click();
      await expectProgress('Var 1 / 1');
      await expectHighlighted(childSquares,'Last move must still navigate explicitly to the child final move');
      assert.equal(await child.getAttribute('aria-pressed'),'true');
      await page.locator('.review-board-square').scrollIntoViewIfNeeded();
      await page.screenshot({path:join(output,`nested-variation-cursors-${width}.png`)});
      // On long exploratory lines the selected SAN can move outside the
      // horizontal viewport. The trail should reveal it automatically when
      // moving via the board or transport, without scrolling the whole page.
      for(const [index,from,to] of [
        ['e7','e6'],['g1','f3'],['d7','d5'],['b1','c3'],
        ['b8','c6'],['f1','e2'],['g8','f6'],['a2','a3'],
      ].map(([from,to],index)=>[index,from,to])) {
        await dragMove(from,to);
        await expectProgress(`Var ${index+2} / ${index+2}`);
      }
      const geometry=async()=>trail.evaluate(nav=>{
        const current=nav.querySelector('[aria-current="step"]');
        const bounds=nav.getBoundingClientRect();
        const active=current?.getBoundingClientRect();
        return {left:bounds.left,right:bounds.right,activeLeft:active?.left,
          activeRight:active?.right,scrollLeft:nav.scrollLeft,
          scrollWidth:nav.scrollWidth,clientWidth:nav.clientWidth};
      });
      const longTrail=await geometry();
      assert.ok(longTrail.scrollWidth>longTrail.clientWidth,
        `Long variation must overflow horizontally: ${JSON.stringify(longTrail)}`);
      await page.waitForFunction(()=>{
        const nav=document.querySelector('nav[aria-label="Variation moves"]');
        const current=nav?.querySelector('[aria-current="step"]');
        if(!nav||!current)return false;
        const a=current.getBoundingClientRect(),n=nav.getBoundingClientRect();
        return a.left>=n.left-2 && a.right<=n.right+2;
      },undefined,{timeout:2400});
      await trail.scrollIntoViewIfNeeded();
      await page.screenshot({path:join(output,`long-variation-active-trail-${width}.png`)});
      // Clicking the original-game graph exits an exploratory branch. On a
      // phone the saved board is above the graph; reveal it immediately,
      // while desktop should preserve side-by-side graph/board context.
      const timeline=page.getByRole('slider',{name:'Move evaluation timeline'});
      await timeline.scrollIntoViewIfNeeded();
      const graphBox=await timeline.boundingBox();
      assert.ok(graphBox);
      const previousScroll=await page.evaluate(()=>window.scrollY);
      await page.mouse.click(graphBox.x+graphBox.width*.30,graphBox.y+graphBox.height*.50);
      await page.waitForFunction(()=>document.querySelector('[data-review-move-progress]')
        ?.textContent?.trim().match(/^\d+ \/ \d+$/),undefined,{timeout:3000});
      const savedCursor=Number((await page.locator('[data-review-move-progress]').innerText()).split(' / ')[0]);
      const replay=new Chess();
      replay.loadPgn(savedPgn);
      const savedMoves=replay.history();
      assert.ok(savedCursor>0 && savedCursor<=savedMoves.length,'The graph must select a real saved move');
      const expected=new Chess();
      for(const san of savedMoves.slice(0,savedCursor)) assert.ok(expected.move(san));
      await page.waitForFunction(san=>document.querySelector('[data-review-move-summary]')
        ?.textContent?.includes(san),savedMoves[savedCursor-1],{timeout:3000});
      assert.equal(await page.getByRole('button',{name:'Return to game'}).count(),1,
        'Previously created variations remain selectable after returning to saved-game evaluation');
      if(width===390){
        await page.waitForFunction(()=>document.activeElement?.classList.contains('review-board-square'),
          undefined,{timeout:2500});
        const board=await page.locator('.review-board-square').boundingBox();
        assert.ok(board && board.y>=40 && board.y<=110,
          `A mobile graph click must reveal the original-game board: ${JSON.stringify(board)}`);
      }else{
        const currentScroll=await page.evaluate(()=>window.scrollY);
        assert.ok(Math.abs(currentScroll-previousScroll)<=3,
          `Desktop graph clicks must not jump the whole page: ${previousScroll} -> ${currentScroll}`);
      }
      await page.screenshot({path:join(output,`variation-graph-return-board-${width}.png`)});
      // The rendered board's source is the selected, legal PGN position,
      // not the exploratory branch or an invented score. Use the existing
      // Copy FEN control to inspect its authoritative displayed identity.
      await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{
        configurable:true,value:{writeText:async text=>{window.__graphSelectedFen=text;}},
      }));
      await page.getByRole('button',{name:'Copy FEN',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.__graphSelectedFen),expected.fen(),
        'Selecting the saved timeline must render the saved PGN FEN, not the variation FEN');
      // Keyboard slider scrubbing must remain continuous: focus stays on
      // the graph after every arrow key instead of jumping offscreen to the
      // board. A phone tap, tested above, deliberately reveals the board.
      await page.getByRole('button',{name:'Variation 2 · 9 moves',exact:true}).click();
      await expectProgress('Var 9 / 9');
      await timeline.focus();
      await page.keyboard.press('End');
      await expectProgress(`${savedMoves.length} / ${savedMoves.length}`);
      assert.ok(await timeline.evaluate(el=>document.activeElement===el),
        'Keyboard End must keep focus on the graph for further scrubbing');
      await page.keyboard.press('ArrowLeft');
      await expectProgress(`${savedMoves.length-1} / ${savedMoves.length}`);
      assert.equal(await timeline.getAttribute('aria-valuenow'),String(savedMoves.length-1));
      assert.ok(await timeline.evaluate(el=>document.activeElement===el),
        'Keyboard arrows must retain slider focus and use saved-game plies');
      await page.screenshot({path:join(output,`variation-graph-keyboard-scrub-${width}.png`)});
      // The saved move list is below the board on phones, just like the
      // original timeline. A tapped SAN must reveal the selected original
      // board; keyboard SAN navigation must keep focus in the move list.
      const childPicker=page.getByRole('button',{name:'Variation 2 · 9 moves',exact:true});
      await childPicker.click();
      await expectProgress('Var 9 / 9');
      const savedList=page.getByRole('region',{name:'Moves'});
      const expectMoveFocus=async(ply)=>{
        // The move counter commits before the keyboard handler's requested
        // animation-frame focus correction. Check the actual rendered target
        // after that frame rather than racing the React state update.
        await page.waitForFunction(ply=>document.activeElement===
          document.querySelector(`button[data-review-ply="${ply}"]`),ply,{timeout:3000});
      };
      const firstSaved=savedList.getByRole('button',{name:/^1\. White e4/});
      await firstSaved.scrollIntoViewIfNeeded();
      const beforeMoveClick=await page.evaluate(()=>window.scrollY);
      await firstSaved.click();
      await expectProgress(`1 / ${savedMoves.length}`);
      assert.equal(await firstSaved.getAttribute('aria-current'),'step',
        'Selecting a saved SAN must highlight the matching move, not the variation');
      if(width===390){
        await page.waitForFunction(()=>document.activeElement?.classList.contains('review-board-square'),
          undefined,{timeout:2500});
        const board=await page.locator('.review-board-square').boundingBox();
        assert.ok(board && board.y>=40 && board.y<=110,
          `A tapped saved SAN must reveal its original board on mobile: ${JSON.stringify(board)}`);
      }else{
        const afterMoveClick=await page.evaluate(()=>window.scrollY);
        assert.ok(Math.abs(afterMoveClick-beforeMoveClick)<=3,
          `Desktop SAN clicks must keep their side-by-side scroll: ${beforeMoveClick} -> ${afterMoveClick}`);
      }
      await page.screenshot({path:join(output,`variation-movelist-return-board-${width}.png`)});
      await childPicker.click();
      await expectProgress('Var 9 / 9');
      await firstSaved.focus();
      await page.keyboard.press('Enter');
      await expectProgress(`1 / ${savedMoves.length}`);
      assert.ok(await firstSaved.evaluate(el=>document.activeElement===el),
        'Keyboard SAN selection must keep focus in the list for rapid comparison');
      const secondSaved=savedList.getByRole('button',{name:/^1… Black e5/});
      await secondSaved.focus();
      await page.keyboard.press('Enter');
      await expectProgress(`2 / ${savedMoves.length}`);
      assert.ok(await secondSaved.evaluate(el=>document.activeElement===el),
        'Successive keyboard SAN selections must not steal focus');
      // In the two-column move list, vertical arrows should navigate to the
      // next/previous move made by the same side, unlike left/right which
      // step one ply. This also works for Black-first saved games.
      const nextBlack=savedList.getByRole('button',{name:/^2… Black Nc6/});
      await page.keyboard.press('ArrowDown');
      await expectProgress(`4 / ${savedMoves.length}`);
      await expectMoveFocus(4);
      assert.ok(await nextBlack.evaluate(el=>document.activeElement===el),
        'ArrowDown on e5 must focus Black’s next played move Nc6');
      await page.keyboard.press('ArrowUp');
      await expectProgress(`2 / ${savedMoves.length}`);
      await expectMoveFocus(2);
      assert.ok(await secondSaved.evaluate(el=>document.activeElement===el),
        'ArrowUp on Nc6 must return focus to Black’s e5');
      const thirdSaved=savedList.getByRole('button',{name:/^2\. White Nf3/});
      await page.keyboard.press('ArrowRight');
      await expectProgress(`3 / ${savedMoves.length}`);
      await expectMoveFocus(3);
      assert.equal(await thirdSaved.getAttribute('aria-current'),'step',
        'ArrowRight in the move list must select the next saved SAN');
      assert.ok(await thirdSaved.evaluate(el=>document.activeElement===el),
        'ArrowRight must move keyboard focus to the newly selected SAN, not leave it on e5');
      await page.keyboard.press('Home');
      await expectProgress(`0 / ${savedMoves.length}`);
      await expectMoveFocus(0);
      const startingPosition=savedList.getByRole('button',{name:'starting position',exact:true});
      assert.ok(await startingPosition.evaluate(el=>document.activeElement===el),
        'Home in move history must focus the starting-position button');
      await page.keyboard.press('End');
      await expectProgress(`${savedMoves.length} / ${savedMoves.length}`);
      await expectMoveFocus(savedMoves.length);
      const finalSaved=savedList.getByRole('button',{name:/^12… Black Rad8/});
      assert.ok(await finalSaved.evaluate(el=>document.activeElement===el),
        'End in move history must focus the actual last saved move');
      await page.keyboard.press('ArrowDown');
      await expectProgress(`${savedMoves.length} / ${savedMoves.length}`);
      await expectMoveFocus(savedMoves.length);
      assert.ok(await finalSaved.evaluate(el=>document.activeElement===el),
        'ArrowDown at the final Black move must not switch into the other column or lose focus');
      const priorBlack=savedList.getByRole('button',{name:/^11… Black Qd7/});
      await page.keyboard.press('ArrowUp');
      await expectProgress(`${savedMoves.length-2} / ${savedMoves.length}`);
      await expectMoveFocus(savedMoves.length-2);
      assert.ok(await priorBlack.evaluate(el=>document.activeElement===el),
        'ArrowUp from the final Black move must focus the previous Black move');
      await page.keyboard.press('ArrowDown');
      await expectProgress(`${savedMoves.length} / ${savedMoves.length}`);
      await expectMoveFocus(savedMoves.length);
      assert.ok(await finalSaved.evaluate(el=>document.activeElement===el),
        'ArrowDown must restore the next move in the same column');
      await page.screenshot({path:join(output,`variation-movelist-keyboard-${width}.png`)});
      assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,savedPgn);
    }finally{await nestedContext.close();}
  }
  // Selecting a classification from the report should move the keyboard
  // reader to the filtered Moves tab, not leave focus on an offscreen count.
  for(const [width,height] of [[320,760],[390,844],[1024,768]]){
    const filterContext=await browser.newContext({viewport:{width,height},colorScheme:'dark',reducedMotion:'reduce'});
    try{
      const originalPgn=db.prepare('SELECT pgn FROM games WHERE id = ?').get(id).pgn;
      await filterContext.addCookies([{name:account.cookie.split('=')[0],
        value:account.cookie.split('=').slice(1).join('='),url:base}]);
      const page=await filterContext.newPage();
      await page.goto(`${base}/review/${id}?ply=1`,{waitUntil:'domcontentloaded'});
      await page.getByRole('button',{name:'Blunder',exact:true}).waitFor({state:'visible'});
      const reportCountTargets=await page.locator('[data-review-report-summary] button.font-mono.tabular-nums')
        .evaluateAll(buttons=>buttons.map(button=>{
          const rect=button.getBoundingClientRect();
          return {width:Math.round(rect.width),height:Math.round(rect.height),
            name:button.getAttribute('aria-label')||button.getAttribute('title')};
        }));
      const reportCategoryTarget=await page.getByRole('button',{name:'Blunder',exact:true})
        .evaluate(button=>{const rect=button.getBoundingClientRect();
          return {width:Math.round(rect.width),height:Math.round(rect.height)};});
      console.log(`${width}px Game Report classification targets:`,JSON.stringify({counts:reportCountTargets,category:reportCategoryTarget}));
      assert.ok(reportCountTargets.length>0 && reportCountTargets.every(target=>target.width>=44 && target.height>=44)
        && reportCategoryTarget.height>=44,
        `Game Report classification buttons need usable touch areas at ${width}px`);
      const countNames=reportCountTargets.map(target=>target.name);
      assert.ok(countNames.every(name=>name && name!=='Show these moves')
        && new Set(countNames).size===countNames.length,
        'Each report count button must identify its own classification, side and count');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=2,
        `Game Report classification target resizing must not cause horizontal overflow at ${width}px`);
      await page.getByRole('button',{name:'Blunder',exact:true}).scrollIntoViewIfNeeded();
      await page.screenshot({path:join(output,`report-classification-counts-${width}.png`)});
      await page.getByRole('button',{name:'Blunder',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('[data-move-transport]')?.textContent?.replace(/\s+/g,' ').trim().startsWith('22 /'));
      const focus=await page.evaluate(()=>({id:document.activeElement?.id,
        tag:document.activeElement?.tagName,
        tabTop:document.getElementById('review-tab-moves')?.getBoundingClientRect().top}));
      console.log(`${width}px classification filter focus:`,JSON.stringify(focus));
      assert.equal(focus.id,'review-tab-moves',
        `Selecting a report classification must focus the destination Moves tab: ${JSON.stringify(focus)}`);
      assert.ok(focus.tabTop >= 55 && focus.tabTop < 200,
        `Focused filtered Moves tab must remain visible below the fixed app header (${width}px): ${JSON.stringify(focus)}`);
      assert.equal(await page.getByRole('tab',{name:'Moves'}).getAttribute('aria-selected'),'true');
      const filterButtons=await page.locator('#review-tabpanel > div').first().locator('button[title]')
        .evaluateAll(elements=>elements.map(button=>{
          const box=button.getBoundingClientRect();
          return {name:button.getAttribute('aria-label')||button.getAttribute('title'),
            width:Math.round(box.width),height:Math.round(box.height),
            left:Math.round(box.left),right:Math.round(box.right)};
        }));
      console.log(`${width}px filter controls:`,JSON.stringify(filterButtons));
      assert.ok(filterButtons.length===3 && filterButtons.every(button=>button.name && button.width>=44 && button.height>=44),
        `Previous/Next/Clear classification controls must have labeled 44px touch targets: ${JSON.stringify(filterButtons)}`);
      // The move list itself is the primary review control on phones; SAN
      // entries and the starting-position action need the same usable touch
      // targets as the surrounding history and filter navigation.
      const list=page.getByRole('region',{name:'Moves'});
      const moveHitboxes=await Promise.all([
        list.getByRole('button',{name:'starting position',exact:true}),
        list.getByRole('button',{name:/^1\. White e4/}),
        list.getByRole('button',{name:/^1… Black e5/}),
      ].map(async(button)=>{
        const rect=await button.boundingBox();
        return {label:await button.getAttribute('aria-label') || (await button.innerText()).trim(),
          width:rect?.width,height:rect?.height};
      }));
      console.log(`${width}px move history targets:`,JSON.stringify(moveHitboxes));
      assert.ok(moveHitboxes.every(item=>item.width>=44 && item.height>=44),
        `Game Review move-history targets must be at least 44px in both dimensions: ${JSON.stringify(moveHitboxes)}`);
      await list.scrollIntoViewIfNeeded();
      await page.screenshot({path:join(output,`review-move-list-targets-${width}.png`)});
      const english=JSON.parse(readFileSync(new URL('../web/src/locales/en.json',import.meta.url),'utf8'));
      const guide=page.locator('[data-review-classification-guide]');
      const guideTrigger=guide.locator('summary');
      await guideTrigger.waitFor({state:'visible'});
      assert.equal((await guideTrigger.innerText()).trim(),english.review.moveSymbolGuide,
        'Move-symbol guide must name the on-demand, localized explanation');
      const guideHit=await guideTrigger.boundingBox();
      assert.ok(guideHit && guideHit.width>=44 && guideHit.height>=44,
        `The move-symbol guide must be touch-friendly at ${width}px: ${JSON.stringify(guideHit)}`);
      assert.equal(await guide.getAttribute('open'),null,'Move symbol guide must stay collapsed by default');
      await guideTrigger.focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(()=>document.querySelector('[data-review-classification-guide]')?.hasAttribute('open'));
      const labels=await guide.locator('li span').allTextContents();
      assert.ok(labels.includes(english.classification.brilliant)
        && labels.includes(english.classification.blunder)
        && labels.includes(english.classification.forced),
        `Guide must explain the observed move-classification glyphs at ${width}px: ${JSON.stringify(labels)}`);
      assert.equal(new Set(labels).size,labels.length,'Guide should list each icon only once');
      const glyphs=await guide.locator('li img, li svg').count();
      assert.equal(glyphs,labels.length,'Every guide label must have its matching icon');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=2,
        `Expanded move-symbol guide must not overflow a ${width}px viewport`);
      await guide.scrollIntoViewIfNeeded();
      await page.screenshot({path:join(output,`review-move-symbol-guide-${width}.png`)});
      await guideTrigger.focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(()=>!document.querySelector('[data-review-classification-guide]')?.hasAttribute('open'));
      const beforeGuideShortcut=(await page.locator('[data-review-move-progress]').innerText()).trim();
      await page.keyboard.press('Home');
      const afterGuideShortcut=(await page.locator('[data-review-move-progress]').innerText()).trim();
      assert.equal(afterGuideShortcut,beforeGuideShortcut,
        'Home while focused on the move-symbol disclosure must not jump the saved game back to ply 0');
      await page.keyboard.press('ArrowRight');
      assert.equal((await page.locator('[data-review-move-progress]').innerText()).trim(),beforeGuideShortcut,
        'Arrow keys on the focused disclosure must not change the chess position');
      // Return to the originally focused tab before its separate Arrow-key
      // navigation regression. The native summary correctly retains focus
      // after toggling the guide and must not steal tab/board shortcuts.
      await page.getByRole('tab',{name:'Moves'}).focus();
      assert.deepEqual(filterButtons.map(button=>button.name),
        [english.review.filterPrev,english.review.filterNext,english.review.filterClear],
        'Filtered move controls must explain their action to assistive technology');
      const filterOverflow=await page.locator('#review-tabpanel > div').first()
        .evaluate(el=>el.scrollWidth-el.clientWidth);
      assert.ok(filterOverflow<=1 && filterButtons.every((button,index)=>index===0 || button.left>=filterButtons[index-1].right),
        `Enlarged filter actions must not overflow or overlap at ${width}px: ${JSON.stringify({filterOverflow,filterButtons})}`);
      if(width<960)assert.ok(await page.locator('[data-review-jump-to-board]').isVisible(),
        'Filtered mobile move results must retain an explicit path back to the board');
      await page.screenshot({path:join(output,`report-filter-focus-${width}.png`)});
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.getByRole('tab',{name:'AI report'}).getAttribute('aria-selected'),'true',
        'The focused tab must retain keyboard navigation after classification filtering');
      await page.keyboard.press('ArrowLeft');
      assert.equal(await page.getByRole('tab',{name:'Moves'}).getAttribute('aria-selected'),'true');
      await page.getByRole('button',{name:english.review.filterClear}).click();
      assert.equal(await page.getByRole('button',{name:english.review.filterClear}).count(),0,
        'Clear must remove the move-classification filter without changing the saved line');
      const blackBlunderCount=english.review.pickCountLabel
        .replace('{{side}}',english.review.black)
        .replace('{{classification}}',english.classification.blunder)
        .replace('{{count}}','1');
      await page.getByRole('button',{name:blackBlunderCount,exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('[data-move-transport]')?.textContent?.replace(/\s+/g,' ').trim().startsWith('22 /'));
      await page.getByRole('button',{name:english.review.filterClear}).click();
      await page.getByRole('button',{name:'Inaccuracy',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('[data-move-transport]')?.textContent?.replace(/\s+/g,' ').trim().startsWith('7 /'));
      await page.getByRole('button',{name:english.review.filterNext}).click();
      await page.waitForFunction(()=>document.querySelector('[data-move-transport]')?.textContent?.replace(/\s+/g,' ').trim().startsWith('15 /'));
      await page.getByRole('button',{name:english.review.filterPrev}).click();
      await page.waitForFunction(()=>document.querySelector('[data-move-transport]')?.textContent?.replace(/\s+/g,' ').trim().startsWith('7 /'));
      assert.equal(db.prepare('SELECT pgn FROM games WHERE id = ?').get(id).pgn,originalPgn);
    }finally{await filterContext.close();}
  }
  // A phase can begin with Black's reply in the same two-column move pair.
  // Its section heading belongs between the preceding White SAN and that
  // Black SAN, not before both. Keep phase metadata disposable; the actual
  // PGN and saved analysis evidence remain unchanged in the database.
  const savedPgnForPhase=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
  for(const width of [320,390,1024]){
    const phaseContext=await browser.newContext({viewport:{width,height:844},colorScheme:'dark',reducedMotion:'reduce'});
    try{
      await phaseContext.addCookies([{name:account.cookie.split('=')[0],
        value:account.cookie.split('=').slice(1).join('='),url:base}]);
      const page=await phaseContext.newPage();
      let phaseInjected=false;
      await page.route(`**/api/games/${id}`,async route=>{
        const response=await route.fetch();
        const details=await response.json();
        assert.equal(JSON.parse(details.analysis.moves_json).length,24);
        const segment=(from_ply,to_ply)=>({from_ply,to_ply,
          accuracy_white:80,accuracy_black:80,acpl_white:15,acpl_black:15});
        details.analysis.phase_split_json=JSON.stringify({
          opening:segment(1,14),middlegame:segment(15,21),endgame:segment(22,24),
        });
        phaseInjected=true;
        await route.fulfill({response,contentType:'application/json',body:JSON.stringify(details)});
      });
      await page.goto(`${base}/review/${id}?ply=22`,{waitUntil:'domcontentloaded'});
      const history=page.getByRole('region',{name:'Moves'});
      const endgame=history.getByRole('heading',{name:'Endgame',exact:true});
      await endgame.waitFor({state:'visible',timeout:4000});
      assert.ok(phaseInjected,'A source-aligned saved PGN must display the injected phase boundary');
      const placement=await endgame.evaluate(heading=>{
        const history=heading.closest('[role="region"]');
        const prior=history?.querySelector('button[data-review-ply="21"]');
        const next=history?.querySelector('button[data-review-ply="22"]');
        const follows=(a,b)=>!!a && !!b && !!(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING);
        return {priorBeforeHeading:follows(prior,heading),headingBeforeNext:follows(heading,next),
          headings:history?.querySelectorAll('h3').length,
          selected:next?.getAttribute('aria-current'),
          priorSan:prior?.textContent?.trim(),nextSan:next?.textContent?.trim()};
      });
      assert.ok(placement.priorBeforeHeading && placement.headingBeforeNext,
        `Endgame header must appear between saved plies 21 and 22: ${JSON.stringify(placement)}`);
      assert.equal(placement.headings,3,'The original game should expose three navigable phase headings');
      assert.equal(placement.selected,'step','A split phase row must preserve the selected Black SAN');
      await endgame.scrollIntoViewIfNeeded();
      await page.screenshot({path:join(output,`phase-boundary-black-${width}.png`)});
      assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,savedPgnForPhase,
        'The phase-badge placement audit must not mutate the saved PGN');
    }finally{await phaseContext.close();}
  }
  // Mate scores are white-perspective, source-aligned evidence: the Review
  // bar and visible score must preserve the engine's count and winning side,
  // not collapse M3/-M2 into an undifferentiated +/-# cp proxy. Test-only
  // annotations exercise presentation, never assert a real Stockfish mate.
  const mateContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await mateContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await mateContext.newPage();
    let sourceInjected=false;
    const originalMatePgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    await page.route(`**/api/games/${id}`,async route=>{
      const response=await route.fetch();
      const detail=await response.json();
      const moves=JSON.parse(detail.analysis.moves_json);
      assert.equal(moves.length,24);
      for(const [index,mate,cp] of [[0,3,9970],[1,-2,-9980],[2,0,10000],[3,3,-9970],[4,null,9970]]){
        moves[index].mate_after=mate;
        moves[index].eval_after_cp=cp;
      }
      detail.analysis.moves_json=JSON.stringify(moves);
      sourceInjected=true;
      await route.fulfill({response,contentType:'application/json',body:JSON.stringify(detail)});
    });
    await page.goto(`${base}/review/${id}?ply=1`,{waitUntil:'domcontentloaded'});
    const score=page.locator('[data-review-move-summary] .font-mono.text-base');
    const savedGraph=page.getByRole('slider',{name:'Move evaluation timeline'});
    await page.getByRole('img',{name:'Mate in 3 for White',exact:true}).waitFor({state:'visible',timeout:4000});
    assert.equal((await score.innerText()).trim(),'M3','White mate score must show its exact distance');
    assert.equal(await score.getAttribute('aria-label'),'Evaluation M3');
    assert.equal(await savedGraph.getAttribute('aria-valuetext'),'M3',
      'The original timeline must announce the source-verified White mate distance');
    await page.screenshot({path:join(output,'review-mate-white-390.png')});
    await page.getByRole('region',{name:'Moves'}).getByRole('button',{name:/^1… Black e5/}).click();
    await page.getByRole('img',{name:'Mate in 2 for Black',exact:true}).waitFor({state:'visible',timeout:4000});
    assert.equal((await score.innerText()).trim(),'−M2','Black mate score must carry the negative White-perspective sign');
    assert.equal(await score.getAttribute('aria-label'),'Evaluation −M2');
    assert.equal(await savedGraph.getAttribute('aria-valuetext'),'−M2',
      'The timeline must announce the verified Black mate without losing its sign');
    await page.screenshot({path:join(output,'review-mate-black-390.png')});
    await page.getByRole('region',{name:'Moves'}).getByRole('button',{name:/^2\. White Nf3/}).click();
    await page.waitForFunction(()=>document.querySelector('[data-review-move-summary] .font-mono.text-base')?.textContent?.trim()==='+100.00');
    assert.equal(await page.getByRole('img',{name:/Mate in 0/}).count(),0,
      'A terminal mate 0 has no winning-side sign; never invent Black as the mating side');
    assert.equal(await savedGraph.getAttribute('aria-valuetext'),'+100.00',
      'An ambiguous terminal mate zero must preserve the recorded numeric cp without claiming mate');
    await page.getByRole('region',{name:'Moves'}).getByRole('button',{name:/^2… Black Nc6/}).click();
    await page.getByRole('img',{name:'Evaluation −99.70 for White',exact:true}).waitFor({state:'visible',timeout:4000});
    assert.equal((await score.innerText()).trim(),'−99.70',
      'Contradictory cached mate and cp must show only the numeric evidence, not a fabricated White M3');
    assert.equal(await savedGraph.getAttribute('aria-valuetext'),'−99.70',
      'Contradictory mate and cp must not imply a terminal outcome in the graph');
    await page.screenshot({path:join(output,'review-mate-contradictory-390.png')});
    await page.getByRole('region',{name:'Moves'}).getByRole('button',{name:/^3\. White Bc4/}).click();
    assert.equal(await savedGraph.getAttribute('aria-valuetext'),'+99.70',
      'A high normalized cp without explicit mate evidence must remain numeric in the graph');
    assert.equal((await score.innerText()).trim(),'+99.70',
      'The saved score header must agree with the graph and not invent checkmate');
    await page.getByRole('img',{name:'Evaluation +99.70 for White',exact:true}).waitFor({state:'visible',timeout:4000});
    await page.screenshot({path:join(output,'review-mate-unproven-graph-390.png')});
    // The former bare # fitted in the thin evaluation bar, but factual
    // 5–6-character numerical labels cannot fit between the phone's edge
    // and the chessboard. The redundant chip should disappear rather than
    // clip, while the full visible score and bar's accessible name remain.
    await page.setViewportSize({width:320,height:780});
    for(const [moveLabel,accessibleScore,scoreText,capture] of [
      [/^2\. White Nf3/,'Evaluation +100.00 for White','+100.00','review-numeric-score-plus-320.png'],
      [/^2… Black Nc6/,'Evaluation −99.70 for White','−99.70','review-numeric-score-minus-320.png'],
    ]){
      await page.getByRole('region',{name:'Moves'}).getByRole('button',{name:moveLabel}).click();
      const bar=page.getByRole('img',{name:accessibleScore,exact:true});
      await bar.waitFor({state:'visible',timeout:4000});
      const geometry=await bar.evaluate(element=>{
        const board=document.querySelector('.review-board-square');
        const score=document.querySelector('[data-review-move-summary] .font-mono.text-base');
        if(!board||!score)return null;
        return {chipPresent:!!element.querySelector('[data-review-eval-chip]'),
          boardLeft:board.getBoundingClientRect().left,
          viewportWidth:window.innerWidth,documentWidth:document.documentElement.scrollWidth,
          summaryScore:score.textContent?.trim()};
      });
      console.log('320px extreme numeric EvalBar chip:',JSON.stringify(geometry));
      await page.screenshot({path:join(output,capture)});
      assert.ok(geometry && !geometry.chipPresent && geometry.summaryScore===scoreText
        && geometry.documentWidth<=geometry.viewportWidth+2,
      `Wide numeric scores must remain visible in the header without an overflowing board chip: ${JSON.stringify(geometry)}`);
    }
    // Shorter, common pawn scores keep their floating chip. Verify that the
    // 18px rail's label does not cover the first chess file or screen edge.
    for(const [ply,scoreText,capture] of [
      [6,'−0.4','review-short-score-negative-320.png'],
      [9,'+0.8','review-short-score-positive-320.png'],
    ]){
      await page.locator(`button[data-review-ply="${ply}"]`).click();
      const geometry=await page.locator('[data-review-eval-chip]').evaluate(chip=>{
        const board=document.querySelector('.review-board-square');
        if(!board)return null;
        const r=chip.getBoundingClientRect(),b=board.getBoundingClientRect();
        return {text:chip.textContent?.trim(),left:r.left,right:r.right,
          boardLeft:b.left,viewportWidth:innerWidth,
          documentWidth:document.documentElement.scrollWidth};
      });
      console.log('320px common numeric EvalBar chip:',JSON.stringify(geometry));
      await page.screenshot({path:join(output,capture)});
      assert.ok(geometry && geometry.text===scoreText && geometry.left>=-1
        && geometry.right<=geometry.boardLeft+1 && geometry.documentWidth<=geometry.viewportWidth+2,
      `Common pawn scores must not clip the screen or cover the board: ${JSON.stringify(geometry)}`);
    }
    assert.ok(sourceInjected,'This test must receive source-matched full saved move history');
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,originalMatePgn);
  }finally{await mateContext.close();}
  // Evidence-gap regression: a cached analysis may legitimately lack one
  // evaluation even when its recorded move classification is present. In a
  // disposable fixture only, remove the before score from an inaccuracy and
  // verify the live React component does not display a fake 50% comparison.
  const stored=db.prepare('SELECT moves_json FROM analyses WHERE game_id = ?').get(id);
  const incomplete=JSON.parse(stored.moves_json);
  incomplete[14].eval_before_cp=null;
  db.prepare('UPDATE analyses SET moves_json = ? WHERE game_id = ?').run(JSON.stringify(incomplete),id);
  const missingContext=await browser.newContext({viewport:{width:390,height:844}});
  try{
    await missingContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await missingContext.newPage();
    await page.goto(`${base}/review/${id}?ply=15`);
    await page.locator('[data-review-jump-to-details]').click();
    await page.getByText('The engine has no complete before-and-after evaluation for this move, so its win-chance change cannot be shown.').waitFor();
    assert.equal(await page.getByTitle('Win chance for the side that moved: before → after').count(),0,
      'An unknown engine score must not render fake win odds');
    await page.waitForFunction(()=>{
      const section=document.querySelector('[data-review-jump-to-board]')?.closest('.card');
      return !!section && Math.abs(section.getBoundingClientRect().top-64)<22;
    },undefined,{timeout:5000});
    await page.screenshot({path:join(output,'missing-eval-details.png')});
  }finally{await missingContext.close();}
  // Black-first FEN uses game-relative ply 1 for Black's 12th move. The UI
  // must not label it White's 1st move or invert Black's win-chance direction.
  const blackFen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 12';
  const blackGame=new Chess(blackFen);
  blackGame.setHeader('SetUp','1'); blackGame.setHeader('FEN',blackFen);
  const before=blackGame.fen(), played=blackGame.move('e5');
  assert.ok(played);
  const blackId=Number(db.prepare(`INSERT INTO games
    (user_id,source,external_id,pgn,white,black,result,time_control,end_time,user_color)
    VALUES (?,'imported','polish-black-first',?,'Example White','Example Black','*','600',datetime('now'),'white')`)
    .run(user.id,blackGame.pgn()).lastInsertRowid);
  const blackSource=loadAnalysisGameSource(db,blackId);
  assert.ok(blackSource);
  const blackMove={ply:1,san:'e5',uci:'e7e5',fen_before:before,
    fen_after:blackGame.fen(),eval_before_cp:-100,eval_after_cp:100,
    best_move_uci:'c7c5',best_move_san:'c5',best_pv:['c5'],
    centipawn_loss:200,classification:'inaccuracy'};
  const blackWinDelta=Math.abs(cpToWinPct(blackMove.eval_before_cp)-cpToWinPct(blackMove.eval_after_cp));
  db.prepare(`INSERT INTO analyses
    (game_id,depth,moves_json,accuracy_white,accuracy_black,scoring_version,
    source_hash,source_revision,analysis_generation)
    VALUES (?,12,?,80,80,?,?,?,1)`)
    .run(blackId,JSON.stringify([blackMove]),SCORING_VERSION,
      analysisSourceHash(blackSource),blackSource.source_revision);
  // Deliberately preserve a historical White-first side label to demonstrate
  // that the UI recovers the real mover from FEN, not from cached metadata.
  db.prepare('UPDATE analyses SET key_moments_json = ? WHERE game_id = ?')
    .run(JSON.stringify([{
      ply:1,side:'white',san:'e5',fen_before:before,classification:'inaccuracy',
      cp_loss:200,win_pct_delta:blackWinDelta,best_san:'c5',best_pv:['c5'],
    }]),blackId);
  // Keep a separate, source-attested Black-player fixture. Editing the first
  // fixture's user_color would invalidate its analysis source fingerprint and
  // interfere with the White-player learning/Key Moment checks below.
  const blackPlayerId=Number(db.prepare(`INSERT INTO games
    (user_id,source,external_id,pgn,white,black,result,time_control,end_time,user_color)
    VALUES (?,'imported','polish-black-player-flip',?,'Example White','Example Black','*','600',datetime('now'),'black')`)
    .run(user.id,blackGame.pgn()).lastInsertRowid);
  const blackPlayerSource=loadAnalysisGameSource(db,blackPlayerId);
  assert.ok(blackPlayerSource);
  db.prepare(`INSERT INTO analyses
    (game_id,depth,moves_json,accuracy_white,accuracy_black,scoring_version,
    source_hash,source_revision,analysis_generation)
    VALUES (?,12,?,80,80,?,?,?,1)`)
    .run(blackPlayerId,JSON.stringify([blackMove]),SCORING_VERSION,
      analysisSourceHash(blackPlayerSource),blackPlayerSource.source_revision);
  const blackContext=await browser.newContext({viewport:{width:390,height:844}});
  try{
    await blackContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await blackContext.newPage();
    await page.goto(`${base}/review/${blackId}?ply=1`);
    await page.locator('[data-review-jump-to-details]').click();
    await page.getByText('12…e5',{exact:true}).waitFor();
    await page.getByText("Opponent's move",{exact:true}).waitFor();
    const value=await page.getByTitle('Win chance for the side that moved: before → after').innerText();
    assert.match(value,/59%\s*→\s*41%/,'Black-first win chances are not from Black\'s perspective');
    await page.waitForFunction(()=>{
      const section=document.querySelector('[data-review-jump-to-board]')?.closest('.card');
      return !!section && Math.abs(section.getBoundingClientRect().top-64)<22;
    },undefined,{timeout:5000});
    await page.screenshot({path:join(output,'black-first-details.png')});
    await page.getByRole('tab',{name:'Key moments'}).click();
    const firstMoment=page.getByRole('button',{name:/#12…\s*e5/});
    await firstMoment.waitFor({state:'visible'});
    assert.equal(await firstMoment.getAttribute('aria-current'),'step',
      'Black-first key moment must be marked as the selected game-relative ply');
    const momentText=await firstMoment.innerText();
    console.log('Black-first Key Moment rendered:',JSON.stringify(momentText));
    await page.screenshot({path:join(output,'black-first-key-moments.png')});
    assert.ok(momentText.toLocaleLowerCase('en-US').includes("opponent's move"),
      `Black-first key moment must identify the mover using the actual FEN: ${momentText}`);
    assert.equal(await page.getByText('#1.',{exact:true}).count(),0,
      'Black-first key moment must not be mislabeled as move 1');
    await page.getByRole('slider',{name:'Move evaluation timeline'}).focus();
    await page.keyboard.press('Home');
    await page.getByRole('button',{name:/#12…\s*e5/}).click();
    await page.waitForFunction(()=>document.querySelector('[data-move-transport]')?.textContent?.replace(/\s+/g,' ').trim().startsWith('1 /'));
    await page.waitForFunction(()=>{
      const board=document.querySelector('.review-board-square');
      return !!board && board===document.activeElement && board.getBoundingClientRect().top>=40 && board.getBoundingClientRect().top<=95;
    },undefined,{timeout:5000});
    const afterMoment=await page.locator('.review-board-square').boundingBox();
    const momentFocus=await page.evaluate(()=>document.activeElement?.classList.contains('review-board-square'));
    console.log('Mobile Key Moment navigation:',JSON.stringify({boardY:afterMoment?.y,boardHeight:afterMoment?.height,momentFocus}));
    await page.screenshot({path:join(output,'black-first-moment-after-click.png')});
    assert.ok(afterMoment && afterMoment.y>=40 && afterMoment.y<=95 && momentFocus,
      `Tapping a mobile Key Moment must reveal/focus its board instead of leaving it off screen: ${JSON.stringify({afterMoment,momentFocus})}`);
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id = ?').get(blackId).pgn,blackGame.pgn(),
      'Jumping from a Black-first Key Moment must preserve the original PGN');
  }finally{await blackContext.close();}
  const blackPlayerContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await blackPlayerContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await blackPlayerContext.newPage();
    await page.goto(`${base}/review/${blackPlayerId}?ply=1`,{waitUntil:'domcontentloaded'});
    const flipButton=page.getByRole('button',{name:'Flip',exact:true});
    await flipButton.waitFor({state:'visible',timeout:5000});
    await page.waitForFunction(()=>document.querySelector('.review-board-square .cg-wrap')?.classList.contains('orientation-black'));
    assert.equal(await flipButton.getAttribute('aria-pressed'),'false',
      'Black-player initial orientation must be announced as the unflipped player perspective');
    assert.equal((await page.locator('[data-review-move-progress]').innerText()).trim(),'1 / 1');
    await page.locator('.review-board-square').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'flip-black-player-default-390.png')});
    await flipButton.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('.review-board-square .cg-wrap')?.classList.contains('orientation-white'));
    assert.equal(await flipButton.getAttribute('aria-pressed'),'true');
    assert.equal((await page.locator('[data-review-move-progress]').innerText()).trim(),'1 / 1',
      'Flipping Black player perspective must not step through the saved moves');
    await page.locator('.review-board-square').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'flip-black-player-white-perspective-390.png')});
    await page.keyboard.press('Space');
    await page.waitForFunction(()=>document.querySelector('.review-board-square .cg-wrap')?.classList.contains('orientation-black'));
    assert.equal(await flipButton.getAttribute('aria-pressed'),'false');
    assert.ok(await flipButton.evaluate(element=>document.activeElement===element),
      'Black-player flip must preserve keyboard focus in both directions');
    // Route transitions can reuse the React Router element. The entire
    // GameAnalyzerView is intentionally keyed by game id so the *next*
    // saved game does not inherit this Black player's chosen flip state.
    await flipButton.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('.review-board-square .cg-wrap')?.classList.contains('orientation-white'));
    assert.equal(await flipButton.getAttribute('aria-pressed'),'true');
    await page.getByRole('link',{name:'Back',exact:true}).click();
    await page.waitForURL(`${base}/review`);
    await page.locator(`a[href="/review/${id}"]`).first().click();
    await page.waitForURL(`${base}/review/${id}`);
    const whiteFlip=page.getByRole('button',{name:'Flip',exact:true});
    await whiteFlip.waitFor({state:'visible',timeout:5000});
    await page.waitForFunction(()=>document.querySelector('.review-board-square .cg-wrap')?.classList.contains('orientation-white'));
    assert.equal(await whiteFlip.getAttribute('aria-pressed'),'false',
      'In-app navigation from flipped Black game must reset the next White game to its player default');
    await page.getByRole('link',{name:'Back',exact:true}).click();
    await page.waitForURL(`${base}/review`);
    await page.locator(`a[href="/review/${blackPlayerId}"]`).first().click();
    await page.waitForURL(`${base}/review/${blackPlayerId}`);
    const returnedFlip=page.getByRole('button',{name:'Flip',exact:true});
    await returnedFlip.waitFor({state:'visible',timeout:5000});
    await page.waitForFunction(()=>document.querySelector('.review-board-square .cg-wrap')?.classList.contains('orientation-black'));
    assert.equal(await returnedFlip.getAttribute('aria-pressed'),'false',
      'Returning to a Black-player game through the library must also restore its default perspective');
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(blackPlayerId).pgn,blackGame.pgn(),
      'Changing the board perspective must preserve the Black-player saved PGN');
  }finally{await blackPlayerContext.close();}
  // The saved mistake is displayed AFTER e5, but its alternative c5 is legal
  // only on the position BEFORE that move. Exercise the entire honest flow:
  // click the verified alternative, reveal the earlier position + source-
  // matched arrow, play c5 by hand as an unsaved variation, then return.
  const bestContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  try{
    await bestContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await bestContext.newPage();
    await page.goto(`${base}/review/${blackId}?ply=1`);
    await page.locator('[data-review-jump-to-details]').click();
    const bestButton=page.getByRole('button',{name:'Show c5 on board'});
    await bestButton.waitFor({state:'visible'});
    await page.screenshot({path:join(output,'black-first-best-alternative-before.png')});
    await bestButton.click();
    await page.waitForFunction(()=>{
      const board=document.querySelector('.review-board-square');
      const transport=document.querySelector('[data-move-transport]')?.textContent?.replace(/\s+/g,' ').trim();
      return board===document.activeElement && board.getBoundingClientRect().top>=40
        && board.getBoundingClientRect().top<=95 && transport?.startsWith('0 /');
    },undefined,{timeout:5000});
    assert.ok(await page.locator('[data-review-best-arrow-note]').isVisible(),
      'Showing the better move must reveal the board-level next-move arrow');
    await page.screenshot({path:join(output,'black-first-best-alternative-ready.png')});
    const board=await page.locator('cg-board').boundingBox();
    assert.ok(board);
    const from={x:board.x+board.width*2.5/8,y:board.y+board.height*1.5/8}; // c7
    const to={x:board.x+board.width*2.5/8,y:board.y+board.height*3.5/8}; // c5
    await page.mouse.move(from.x,from.y);
    await page.mouse.down();
    await page.mouse.move(to.x,to.y,{steps:12});
    await page.mouse.up();
    await page.getByText('Variation c5',{exact:true}).waitFor({state:'visible',timeout:5000});
    assert.equal((await page.locator('[data-review-move-progress]').innerText()).trim(),'Var 1 / 1',
      'Trying the better move must navigate its one-move branch, not the saved PGN');
    await page.screenshot({path:join(output,'black-first-best-alternative-variation.png')});
    await page.getByRole('button',{name:'Return to game'}).click();
    await page.waitForFunction(()=>document.querySelector('[data-move-transport]')?.textContent?.replace(/\s+/g,' ').trim().startsWith('0 /'));
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id = ?').get(blackId).pgn,blackGame.pgn(),
      'Exploring the verified alternative must never change the original PGN');
  }finally{await bestContext.close();}
  const desktopBestContext=await browser.newContext({viewport:{width:1024,height:768},reducedMotion:'reduce'});
  try{
    await desktopBestContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await desktopBestContext.newPage();
    await page.goto(`${base}/review/${blackId}?ply=1`);
    await page.getByRole('button',{name:'Show c5 on board'}).click();
    await page.waitForFunction(()=>{
      const board=document.querySelector('.review-board-square');
      const transport=document.querySelector('[data-move-transport]')?.textContent?.replace(/\s+/g,' ').trim();
      return board===document.activeElement && transport?.startsWith('0 /');
    },undefined,{timeout:5000});
    assert.ok(await page.locator('[data-review-best-arrow-note]').isVisible());
    const board=await page.locator('.review-board-square').boundingBox();
    assert.ok(board && board.y<768 && board.y+board.height>55,
      'Desktop better-move preview must keep the board visible without losing the analysis rail');
    await page.screenshot({path:join(output,'black-first-best-alternative-desktop.png')});
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id = ?').get(blackId).pgn,blackGame.pgn());
  }finally{await desktopBestContext.close();}
  // AI Report and Key Moments share the mobile board-navigation contract.
  // Install a synthetic, source-attested report only in the disposable QA DB.
  // Its cached moment must use the real Black-first mover for the backend's
  // provenance validator; the earlier intentionally stale-side test remains
  // independent and is restored after these report navigation assertions.
  const blackCachedMoment=db.prepare('SELECT key_moments_json FROM analyses WHERE game_id = ?').get(blackId).key_moments_json;
  db.prepare('UPDATE analyses SET key_moments_json = ? WHERE game_id = ?')
    .run(JSON.stringify([{...JSON.parse(blackCachedMoment)[0],side:'black'}]),blackId);
  const {saveReviewIfFresh}=await import('../server/dist/coach/reviewCache.js');
  const {REVIEW_PROSE_VERSION}=await import('../server/dist/coach/review.js');
  const profile=db.prepare('SELECT language,audience FROM profiles WHERE user_id = ?').get(user.id);
  const reportSource=db.prepare(`SELECT a.*,g.pgn,g.user_id,g.user_color,g.result,
      g.start_fen,g.opponent_rating_before,g.user_rd_before,
      g.source_revision AS current_source_revision
    FROM analyses a JOIN games g ON g.id = a.game_id WHERE a.game_id = ?`).get(blackId);
  const syntheticProse={
    version:REVIEW_PROSE_VERSION,language:profile.language,audience:profile.audience,
    opening:null,summary:'Synthetic report for isolated navigation testing only',
    skill_assessment:'Test-only text; not an engine or AI assessment',
    phases:{opening:null,middlegame:null,endgame:null},
    key_moments:[{ply:1,side:'black',san:'e5',classification:'inaccuracy',
      cp_loss:200,win_pct_delta:blackWinDelta,best_san:'c5',title:'Black played e5',
      prose:'Synthetic explanation to test navigation, not a real chess claim',by_user:false}],
  };
  assert.ok(saveReviewIfFresh(db,blackId,reportSource,reportSource,syntheticProse,
    profile.language,profile.audience,true),'Could not seed source-verified disposable AI report');
  const certifiedProse=await api(`/api/games/${blackId}/review`,{cookie:account.cookie});
  assert.equal(certifiedProse.status,200);
  assert.equal(certifiedProse.json.review?.summary,syntheticProse.summary,
    'AI report must pass the real authenticated provenance gate');
  for(const [width,height] of [[390,844],[1024,768]]){
    const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
    try{
      await context.addCookies([{name:account.cookie.split('=')[0],
        value:account.cookie.split('=').slice(1).join('='),url:base}]);
      const page=await context.newPage();
      await page.goto(`${base}/review/${blackId}?ply=0`);
      await page.getByRole('tab',{name:'AI report'}).click();
      await page.getByText(syntheticProse.summary,{exact:true}).waitFor({state:'visible'});
      const moment=page.getByRole('button',{name:/#12…\s*Black played e5/});
      await moment.waitFor({state:'visible'});
      await moment.click();
      await page.waitForFunction(()=>document.querySelector('[data-move-transport]')?.textContent?.replace(/\s+/g,' ').trim().startsWith('1 /'));
      if(width===390){
        await page.waitForFunction(()=>{
          const board=document.querySelector('.review-board-square');
          return !!board && board===document.activeElement && board.getBoundingClientRect().top>=40 && board.getBoundingClientRect().top<=95;
        },undefined,{timeout:5000});
      }else{
        assert.ok(await moment.evaluate(el=>document.activeElement===el),
          'Desktop AI Report must keep the selected moment focused for side-by-side browsing');
      }
      assert.equal(db.prepare('SELECT pgn FROM games WHERE id = ?').get(blackId).pgn,blackGame.pgn(),
        'Selecting an AI Report moment must preserve the saved PGN');
      await page.screenshot({path:join(output,`black-first-ai-report-moment-${width}.png`)});
    }finally{await context.close();}
  }
  db.prepare(`UPDATE analyses SET key_moments_json=?,prose_json=NULL,
    prose_version=0,prose_lang=NULL,prose_audience=NULL WHERE game_id=?`)
    .run(blackCachedMoment,blackId);
  // Legacy key_moments_json can still hold an odds delta when the underlying
  // engine move has no before/after score. Never present that unsupported
  // percentage as though it were measured. The fixture is disposable only.
  db.prepare('UPDATE analyses SET moves_json = ? WHERE game_id = ?')
    .run(JSON.stringify([{...blackMove,eval_before_cp:null}]),blackId);
  const unsupportedContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await unsupportedContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await unsupportedContext.newPage();
    await page.goto(`${base}/review/${blackId}?ply=1`);
    await page.getByRole('tab',{name:'Key moments'}).click();
    const moment=page.getByRole('button',{name:/#12…\s*e5/});
    await moment.waitFor({state:'visible'});
    const text=await moment.innerText();
    assert.ok(text.includes('200cp') && !text.includes('wp'),
      `Missing engine evidence must not appear as measured win-chance change: ${text}`);
    await page.screenshot({path:join(output,'black-first-key-moments-no-evaluation.png')});
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id = ?').get(blackId).pgn,blackGame.pgn(),
      'Key Moments incomplete-score presentation must preserve the saved PGN');
  }finally{await unsupportedContext.close();}
  // The classification label in Key Moments previously bypassed i18next.
  // Check the same evidence-gap fixture in every supported language using
  // the actual browser locale and visible translated classification label.
  for(const lang of ['en','de','es','ru','bg']){
    const locale=JSON.parse(readFileSync(new URL(`../web/src/locales/${lang}.json`,import.meta.url),'utf8'));
    const setting=await api('/api/settings/profile',{
      method:'PATCH',cookie:account.cookie,body:{language:lang,site_theme:'dark'},
    });
    assert.equal(setting.status,200,`Unable to set Key Moments locale ${lang}`);
    const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
    try{
      await context.addCookies([{name:account.cookie.split('=')[0],
        value:account.cookie.split('=').slice(1).join('='),url:base}]);
      const page=await context.newPage();
      await page.goto(`${base}/review/${blackId}?ply=1`);
      await page.getByRole('tab',{name:locale.review.keyMoments}).click();
      const moment=page.getByRole('button',{name:/#12…\s*e5/});
      await moment.waitFor({state:'visible'});
      assert.ok((await moment.innerText()).includes(locale.classification.inaccuracy),
        `Key Moments classification is not localized in ${lang}`);
      assert.ok((await moment.innerText()).toLocaleLowerCase(lang).includes(locale.review.why.opponentMove.toLocaleLowerCase(lang)),
        `Key Moments mover label is not localized in ${lang}`);
      await page.screenshot({path:join(output,`black-first-key-moments-${lang}-390.png`)});
    }finally{await context.close();}
  }
  const english=await api('/api/settings/profile',{method:'PATCH',cookie:account.cookie,body:{language:'en'}});
  assert.equal(english.status,200);
  // Long legal game: check that arrow-key replay tracks the chosen move inside
  // the move-list scroll container, without jumping the surrounding page.
  const longChess=new Chess(), longMoves=[];
  const repeatedCycle=['Nf3','Nf6','Ng1','Ng8'];
  for(let index=0;index<160;index++){
    const before=longChess.fen(), move=longChess.move(repeatedCycle[index%4]);
    assert.ok(move);
    longMoves.push({ply:index+1,san:move.san,uci:move.from+move.to,
      fen_before:before,fen_after:longChess.fen(),eval_before_cp:0,
      eval_after_cp:0,best_move_uci:move.from+move.to,
      best_move_san:move.san,best_pv:[],centipawn_loss:0,classification:'book'});
  }
  const longId=Number(db.prepare(`INSERT INTO games
    (user_id,source,external_id,pgn,white,black,result,time_control,end_time,user_color)
    VALUES (?,'imported','polish-long-game',?,'Long White','Long Black','*','600',datetime('now'),'white')`)
    .run(user.id,longChess.pgn()).lastInsertRowid);
  const longSource=loadAnalysisGameSource(db,longId);
  assert.ok(longSource);
  db.prepare(`INSERT INTO analyses
    (game_id,depth,moves_json,accuracy_white,accuracy_black,scoring_version,
    source_hash,source_revision,analysis_generation)
    VALUES (?,12,?,80,80,?,?,?,1)`)
    .run(longId,JSON.stringify(longMoves),SCORING_VERSION,
      analysisSourceHash(longSource),longSource.source_revision);
  // Isolate move-history scrolling from the board-to-detail smooth-scroll
  // animation: that transition is already exercised separately above.
  const longContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await longContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await longContext.newPage(),errors=[];
    page.on('pageerror',err=>errors.push(err.message));
    await page.goto(`${base}/review/${longId}?ply=155`,{waitUntil:'domcontentloaded'});
    await page.locator('[data-review-jump-to-details]').click();
    await page.waitForFunction(()=>{
      const panel=document.querySelector('[data-review-jump-to-board]')?.closest('.card');
      return !!panel && Math.abs(panel.getBoundingClientRect().top-64)<22;
    },undefined,{timeout:5000});
    await page.waitForFunction(()=>{
      const root=document.querySelector('[role="region"][aria-label="Moves"]');
      const selected=root?.querySelector('button[aria-current="step"]');
      if(!root||!selected)return false;
      const outer=root.getBoundingClientRect(),inner=selected.getBoundingClientRect();
      return root.scrollTop>1000 && inner.top>=outer.top && inner.bottom<=outer.bottom;
    });
    await page.screenshot({path:join(output,'long-game-initial-details.png')});
    const graph=page.getByRole('slider',{name:'Move evaluation timeline'});
    await graph.focus();
    const outerStart=await page.evaluate(()=>window.scrollY);
    await page.keyboard.press('Home');
    await page.waitForFunction(()=>document.querySelector('[role="region"][aria-label="Moves"]')?.scrollTop===0 &&
      !!document.querySelector('[role="region"][aria-label="Moves"] button[aria-current="step"]'));
    const outerHome=await page.evaluate(()=>window.scrollY);
    await page.keyboard.press('End');
    await page.waitForFunction(()=>{
      const root=document.querySelector('[role="region"][aria-label="Moves"]');
      const selected=root?.querySelector('button[aria-current="step"]');
      if(!root||!selected)return false;
      const a=root.getBoundingClientRect(),b=selected.getBoundingClientRect();
      return root.scrollTop>1000 && b.top>=a.top && b.bottom<=a.bottom;
    });
    const outerEnd=await page.evaluate(()=>window.scrollY);
    console.log('Long-game outer page scroll:',JSON.stringify({outerStart,outerHome,outerEnd,delta:outerEnd-outerStart}));
    assert.ok(Math.abs(outerEnd-outerStart)<=5,
      `Long-game move tracking must scroll the move list, not the surrounding page: ${outerStart} -> ${outerEnd}`);
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id = ?').get(longId).pgn,longChess.pgn(),
      'Long-game navigation must preserve the saved PGN');
    assert.deepEqual(errors,[],'No long-game browser runtime exceptions');
    await page.locator('[data-review-jump-to-board]').evaluate(el=>el.closest('.card')?.scrollIntoView({block:'start',behavior:'auto'}));
    await page.waitForFunction(()=>{
      const panel=document.querySelector('[data-review-jump-to-board]')?.closest('.card');
      return !!panel && Math.abs(panel.getBoundingClientRect().top-64)<22;
    });
    await page.screenshot({path:join(output,'long-game-details.png')});
  }finally{await longContext.close();}
  // Mobile tabs must explain their destinations visually, not rely on
  // hover-only titles. Audit all supported app languages using the actual
  // localized labels at the target 390px width, plus an extra narrow 320px
  // layout. The latter may truncate but must preserve an accessible name,
  // a visible text fragment, keyboard tab semantics and no overlap.
  for(const lang of ['en','de','es','ru','bg']){
    const locale=JSON.parse(readFileSync(new URL(`../web/src/locales/${lang}.json`,import.meta.url),'utf8'));
    const updated=await api('/api/settings/profile',{
      method:'PATCH',cookie:account.cookie,body:{language:lang,site_theme:'dark'},
    });
    assert.equal(updated.status,200,`Could not switch synthetic fixture to ${lang}`);
    for(const width of [390,320]){
      const context=await browser.newContext({viewport:{width,height:844},colorScheme:'dark',reducedMotion:'reduce'});
      try{
        await context.addCookies([{name:account.cookie.split('=')[0],
          value:account.cookie.split('=').slice(1).join('='),url:base}]);
        const page=await context.newPage();
        await page.goto(`${base}/review/${id}?ply=15`,{waitUntil:'domcontentloaded'});
        const hint=page.locator('[data-review-explore-hint]');
        await hint.waitFor({state:'visible'});
        const hintText=await hint.innerText();
        assert.ok(hintText.includes(locale.review.exploreLabel) && hintText.includes(locale.review.exploreHint),
          `Board exploration hint must use the selected ${lang} locale: ${hintText}`);
        const arrowNote=page.locator('[data-review-best-arrow-note]');
        await arrowNote.waitFor({state:'visible'});
        assert.equal((await arrowNote.innerText()).trim(),locale.review.bestArrowNote,
          `Board arrow guidance must be localized in ${lang}`);
        if(width===390){
          await hint.scrollIntoViewIfNeeded();
          await page.screenshot({path:join(output,`review-explore-hint-${lang}-390.png`)});
        }
        await page.locator('[data-review-jump-to-details]').click();
        const detailTablist=page.getByRole('tablist',{name:locale.review.detailSections,exact:true});
        await detailTablist.waitFor({state:'visible'});
        const expected=[locale.review.moves,locale.review.gameReport,locale.review.keyMoments];
        const tabs=page.getByRole('tab');
        assert.equal(await tabs.count(),3);
        const actual=await tabs.evaluateAll((elements)=>elements.map((element)=>{
          const text=element.querySelector('span');
          const textRect=text?.getBoundingClientRect();
          const rect=element.getBoundingClientRect();
          return {name:element.getAttribute('aria-label'),label:text?.textContent,
            labelVisible:!!textRect && textRect.width>0 && getComputedStyle(text).display!=='none',
            textFits:!!text && text.scrollWidth<=text.clientWidth+1,
            left:rect.left,right:rect.right,
          };
        }));
        assert.deepEqual(actual.map(a=>a.name),expected,`Wrong tab names for ${lang}`);
        assert.ok(actual.every(a=>a.labelVisible && a.label),`Invisible mobile labels: ${lang} ${width}: ${JSON.stringify(actual)}`);
        if(width===390) assert.ok(actual.every(a=>a.textFits),
          `Truncated target-width locale label: ${lang}: ${JSON.stringify(actual)}`);
        const gear=await page.getByRole('button',{name:locale.review.depth}).boundingBox();
        assert.ok(gear);
        assert.ok(actual[2].right<=gear.x+1,
          `Tab bar overlaps engine settings for ${lang} at ${width}px`);
        // The collapsed Engine Lines header used to repeat its name in a
        // long call-to-action that wrapped into two lines in German/Spanish.
        // Its entire header is now one accessible disclosure touch target.
        const engine=page.getByRole('button',{name:locale.review.lines,exact:true});
        assert.ok(await engine.isVisible(),`Engine Lines disclosure missing in ${lang}`);
        assert.equal(await engine.getAttribute('aria-expanded'),'false');
        assert.equal(await engine.getAttribute('aria-controls'),'review-engine-lines-content');
        const header=await engine.boundingBox();
        assert.ok(header && header.height<=48 && header.height>=40,
          `Collapsed Engine Lines should fit one comfortable row in ${lang}/${width}: ${JSON.stringify(header)}`);
        const engineLabel=engine.locator('span').first();
        assert.ok(await engineLabel.isVisible());
        assert.ok(await engineLabel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),
          `Engine Lines label is clipped in ${lang}/${width}`);
        if(width===390){
          await engine.click();
          assert.equal(await engine.getAttribute('aria-expanded'),'true');
          assert.ok(await page.locator('#review-engine-lines-content').isVisible());
          await engine.click();
          assert.equal(await engine.getAttribute('aria-expanded'),'false');
          assert.ok(!(await page.locator('#review-engine-lines-content').isVisible()));
        }
        for(const [label,contentId] of [
          [locale.threat.title,'review-threat-content'],
          [locale.explorer.title,'review-master-games-content'],
        ]){
          const disclosure=page.getByRole('button',{name:label,exact:true});
          assert.equal(await disclosure.getAttribute('aria-controls'),contentId,
            `Disclosure has no valid content association: ${lang} ${label}`);
          assert.equal(await disclosure.getAttribute('aria-expanded'),'false');
          const rect=await disclosure.boundingBox();
          assert.ok(rect && rect.height>=40 && rect.height<=48,
            `Utility disclosure must have a consistent one-row touch target: ${lang}/${width} ${label}: ${JSON.stringify(rect)}`);
          if(width===390){
            await disclosure.focus();
            await page.keyboard.press('Enter');
            assert.equal(await disclosure.getAttribute('aria-expanded'),'true');
            assert.ok(await page.locator(`#${contentId}`).isVisible(),`Expanded utility content hidden: ${lang} ${label}`);
            await disclosure.click();
            assert.equal(await disclosure.getAttribute('aria-expanded'),'false');
            assert.ok(!(await page.locator(`#${contentId}`).isVisible()),`Collapsed utility content still visible: ${lang} ${label}`);
          }
        }
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
        assert.ok(overflow<=2,`Horizontal overflow in ${lang} at ${width}px: ${overflow}`);
        if(width===390){
          const movesTab=page.getByRole('tab',{name:locale.review.moves});
          const reportTab=page.getByRole('tab',{name:locale.review.gameReport});
          await movesTab.focus();
          await page.keyboard.press('ArrowRight');
          await page.waitForFunction(()=>document.activeElement?.id==='review-tab-report'
            && document.activeElement?.getAttribute('aria-selected')==='true',undefined,{timeout:2500});
          assert.equal(await reportTab.getAttribute('aria-selected'),'true',
            `The translated ${lang} tablist must preserve keyboard arrow navigation`);
          assert.ok(await reportTab.evaluate(el=>document.activeElement===el),
            `The ${lang} tablist must focus the selected review section`);
          await page.keyboard.press('Home');
          await page.waitForFunction(()=>document.activeElement?.id==='review-tab-moves'
            && document.activeElement?.getAttribute('aria-selected')==='true',undefined,{timeout:2500});
          assert.equal(await movesTab.getAttribute('aria-selected'),'true');
          assert.ok(await movesTab.evaluate(el=>document.activeElement===el));
          await tabs.nth(1).click();
          assert.equal(await tabs.nth(1).getAttribute('aria-selected'),'true');
          await tabs.nth(2).click();
          assert.equal(await tabs.nth(2).getAttribute('aria-selected'),'true');
          await tabs.nth(0).click();
          assert.equal(await tabs.nth(0).getAttribute('aria-selected'),'true');
          await page.screenshot({path:join(output,`review-tabs-${lang}-390.png`)});
          if(lang==='de'||lang==='es'){
            await page.getByText(locale.threat.title,{exact:true}).scrollIntoViewIfNeeded();
            await page.screenshot({path:join(output,`review-utilities-${lang}-390.png`)});
            // Try a legal unsaved branch from the starting board. It must be
            // explorable and reversible without changing the original PGN.
            const originalPgn=db.prepare('SELECT pgn FROM games WHERE id = ?').get(id).pgn;
            await page.goto(`${base}/review/${id}?ply=0`,{waitUntil:'domcontentloaded'});
            await page.locator('cg-board').waitFor({state:'visible'});
            await page.locator('.review-board-square').waitFor({state:'visible'});
            await page.getByText(locale.review.startingPosition,{exact:true}).first().waitFor({state:'visible'});
            const board=await page.locator('cg-board').boundingBox();
            assert.ok(board);
            if(lang==='de'){
              // Chessground should reject an illegal pawn jump before the
              // variation controller is called, without locking future legal
              // moves or modifying the immutable saved game.
              let illegalRequests=0;
              page.on('request',request=>{
                if(request.url().endsWith('/api/analyze/variation-move')) illegalRequests++;
              });
              const invalidFrom={x:board.x+board.width*4.5/8,y:board.y+board.height*6.5/8}; // e2
              const invalidTo={x:board.x+board.width*4.5/8,y:board.y+board.height*3.5/8}; // e5
              await page.mouse.move(invalidFrom.x,invalidFrom.y);
              await page.mouse.down();
              await page.mouse.move(invalidTo.x,invalidTo.y,{steps:12});
              await page.mouse.up();
              assert.equal(await page.getByText(locale.review.variationTitle,{exact:true}).count(),0,
                'Illegal e2-e5 drag must not create a variation');
              assert.ok((await page.locator('[data-move-transport]').innerText()).startsWith('0 /'),
                'Illegal drag must not move the original game cursor');
              assert.equal(illegalRequests,0,'Illegal drag must not request engine scoring');
              assert.equal(db.prepare('SELECT pgn FROM games WHERE id = ?').get(id).pgn,originalPgn);
              await page.screenshot({path:join(output,'review-invalid-drag-de-390.png')});
            }
            const from={x:board.x+board.width*3.5/8,y:board.y+board.height*6.5/8}; // d2
            const to={x:board.x+board.width*3.5/8,y:board.y+board.height*4.5/8}; // d4
            await page.mouse.move(from.x,from.y);
            await page.mouse.down();
            await page.mouse.move(to.x,to.y,{steps:12});
            await page.mouse.up();
            const title=page.getByText(locale.review.variationTitle,{exact:true});
            if(!(await title.isVisible())){
              await page.mouse.click(from.x,from.y);
              await page.mouse.click(to.x,to.y);
            }
            await title.waitFor({state:'visible',timeout:4000});
            assert.equal(await page.locator('[data-review-move-progress]').innerText(),
              locale.review.variationProgress.replace('{{current}}','1').replace('{{total}}','1'),
              `A ${lang} one-move branch must not display the saved-game length`);
            assert.equal(await page.locator('[data-move-transport]').getAttribute('aria-label'),
              locale.review.variationMoveNavigation,
              `Active branch navigation must be labeled in ${lang}`);
            const shareBranch=page.getByRole('button',{name:locale.review.shareBranch,exact:true});
            assert.equal(await shareBranch.getAttribute('title'),locale.review.shareBranchTitle,
              `Variation sharing must be localized in ${lang}`);
            const restore=page.getByRole('button',{name:locale.review.variationReturn});
            assert.ok(await restore.isEnabled());
            const activeBranch=page.getByRole('button',{
              name:locale.review.variationOption.replace('{{number}}','1').replace('{{moves}}','1'),
            });
            const controls={restore:await restore.boundingBox(),branch:await activeBranch.boundingBox()};
            console.log(`${lang} 390px variation controls:`,JSON.stringify(controls));
            assert.ok(controls.restore && controls.branch && controls.restore.height>=44 && controls.branch.height>=44,
              `Active variation actions must have usable 44px touch heights: ${lang} ${JSON.stringify(controls)}`);
            assert.equal(await activeBranch.getAttribute('aria-pressed'),'true');
            // The shortcut shares the displayed *variation*, not the saved
            // starting position, even when clipboard permission is denied.
            await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{
              configurable:true,value:{writeText:async()=>{throw new DOMException('Clipboard blocked','NotAllowedError');}},
            }));
            await page.locator('.review-board-square').focus();
            await page.keyboard.press('s');
            const branchFallback=page.locator('[data-review-meta-toolbar] [data-review-clipboard-fallback]');
            await branchFallback.waitFor({state:'visible',timeout:3000});
            const expectedBranch=new Chess();
            assert.ok(expectedBranch.move('d4'));
            const expectedLabUrl=`${base}/lab#${encodeURI(expectedBranch.fen())}`;
            assert.equal(await branchFallback.locator('textarea').inputValue(),expectedLabUrl,
              `Shortcut S must share the exact unsaved ${lang} branch FEN`);
            const branchPosition=await branchFallback.locator('textarea').evaluate(field=>{
              const rect=field.getBoundingClientRect();
              return {focused:document.activeElement===field,
                selected:field.selectionStart===0 && field.selectionEnd===field.value.length,
                top:rect.top,bottom:rect.bottom,viewport:innerHeight};
            });
            assert.ok(branchPosition.focused && branchPosition.selected && branchPosition.top>=56
              && branchPosition.bottom<=branchPosition.viewport-8,
              `Denied ${lang} variation shortcut must reveal selected fallback: ${JSON.stringify(branchPosition)}`);
            await page.screenshot({path:join(output,`review-variation-share-fallback-${lang}-390.png`)});
            await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{
              configurable:true,value:{writeText:async(text)=>{window.__lastCopiedShare=text;}},
            }));
            await page.locator('.review-board-square').focus();
            await page.keyboard.press('s');
            await branchFallback.waitFor({state:'hidden'});
            assert.equal(await page.evaluate(()=>window.__lastCopiedShare),expectedLabUrl);
            const variationCopy=await page.getByRole('region',{name:locale.review.variationTitle}).innerText().catch(async()=>
              page.getByLabel(locale.review.variationTitle).innerText());
            assert.ok(variationCopy.includes(locale.review.variationHelp),
              `Active variation instructions must be translated in ${lang}`);
            await page.getByText(locale.review.variationEngineUnavailable,{exact:true})
              .waitFor({state:'visible',timeout:15000});
            const retry=page.getByRole('button',{name:locale.review.variationRetryScoring});
            const retryBox=await retry.boundingBox();
            assert.ok(retryBox && retryBox.height>=44,
              `Variation failure retry must have a usable touch target: ${lang} ${JSON.stringify(retryBox)}`);
            await Promise.all([
              page.waitForRequest(request=>request.url().endsWith('/api/analyze/variation-move') && request.method()==='POST'),
              retry.click(),
            ]);
            await title.scrollIntoViewIfNeeded();
            await page.screenshot({path:join(output,`review-variation-active-${lang}-390.png`)});
            await restore.click();
            await page.waitForFunction(()=>{
              const transport=document.querySelector('[data-move-transport]')?.textContent?.replace(/\s+/g,' ').trim();
              return transport?.startsWith('0 /');
            });
            assert.equal(await page.locator('[data-move-transport]').getAttribute('aria-label'),locale.review.moveNavigation);
            assert.equal(await restore.isDisabled(),true,
              `Return to game must be unavailable when already on the saved line (${lang})`);
            const savedBranch=page.getByRole('button',{name:locale.review.variationOption.replace('{{number}}','1').replace('{{moves}}','1')});
            assert.ok(await savedBranch.isVisible(),
              `Returning to the saved game should not delete the optional exploratory branch (${lang})`);
            await page.screenshot({path:join(output,`review-variation-returned-${lang}-390.png`)});
            assert.equal(db.prepare('SELECT pgn FROM games WHERE id = ?').get(id).pgn,originalPgn,
              'An explored variation must not alter the saved PGN');
          }
          await page.goto(`${base}/review/${id}?ply=0`,{waitUntil:'domcontentloaded'});
          await page.getByText(locale.review.startingPosition,{exact:true}).first().waitFor({state:'visible'});
          const startingArrow=page.locator('[data-review-best-arrow-note]');
          await startingArrow.waitFor({state:'visible'});
          assert.equal((await startingArrow.innerText()).trim(),locale.review.bestArrowNote);
          await startingArrow.scrollIntoViewIfNeeded();
          await page.screenshot({path:join(output,`review-start-arrow-${lang}-390.png`)});
        }
      }finally{await context.close();}
    }
    const desktop=await browser.newContext({viewport:{width:1024,height:768},colorScheme:'dark',reducedMotion:'reduce'});
    try{
      await desktop.addCookies([{name:account.cookie.split('=')[0],
        value:account.cookie.split('=').slice(1).join('='),url:base}]);
      const page=await desktop.newPage();
      await page.goto(`${base}/review/${id}?ply=15`,{waitUntil:'domcontentloaded'});
      await page.getByRole('tab',{name:locale.review.moves}).waitFor({state:'visible'});
      const shortcuts=page.locator('[data-review-keyboard-shortcuts]');
      await shortcuts.waitFor({state:'visible'});
      assert.equal((await shortcuts.innerText()).trim(),locale.review.keyboardShortcuts,
        `Desktop keyboard shortcut instructions were not translated in ${lang}`);
      assert.equal(await page.locator('[data-move-transport]').getAttribute('aria-label'),locale.review.moveNavigation,
        `Keyboard/screen-reader move transport label is not localized in ${lang}`);
      const tabWidths=await page.getByRole('tab').evaluateAll(elements=>elements.map(element=>{
        const label=element.querySelector('span');
        return {name:element.getAttribute('aria-label'),width:label?.clientWidth,scroll:label?.scrollWidth};
      }));
      assert.ok(tabWidths.every(tab=>tab.scroll!=null && tab.width!=null && tab.scroll<=tab.width+1),
        `Localized 1024px analysis tabs clip a destination: ${lang} ${JSON.stringify(tabWidths)}`);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
      assert.ok(overflow<=2,`Localized desktop transport causes overflow in ${lang}: ${overflow}`);
      await page.screenshot({path:join(output,`review-shortcuts-${lang}-1024.png`)});
    }finally{await desktop.close();}
  }
  const errorLocale=await api('/api/settings/profile',{
    method:'PATCH',cookie:account.cookie,body:{language:'es'},
  });
  assert.equal(errorLocale.status,200);
  const errorContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await errorContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await errorContext.newPage();
    const spanish=JSON.parse(readFileSync(new URL('../web/src/locales/es.json',import.meta.url),'utf8'));
    await page.goto(`${base}/review/not-a-number`,{waitUntil:'domcontentloaded'});
    const invalidHeading=page.getByRole('heading',{name:spanish.review.unavailableHeading});
    await invalidHeading.waitFor({state:'visible'});
    assert.ok(await invalidHeading.evaluate(el=>document.activeElement===el),
      'Invalid review must focus the recovery heading for keyboard users');
    await page.getByText(spanish.review.unavailableReason.invalid,{exact:true}).waitFor({state:'visible'});
    assert.equal(await page.getByRole('button',{name:spanish.review.retryLoading}).count(),0,
      'Malformed links cannot be resolved by retrying');
    await page.screenshot({path:join(output,'invalid-review-es-after.png')});
    await page.goto(`${base}/review/999999`,{waitUntil:'domcontentloaded'});
    await page.getByText(spanish.review.unavailableReason.notFound,{exact:true}).waitFor({state:'visible'});
    assert.equal(await page.getByRole('button',{name:spanish.review.retryLoading}).count(),0,
      'A confirmed missing game cannot be found by repeated requests');
    assert.equal(await page.getByText('not_found',{exact:true}).count(),0,
      'Backend error codes must not be rendered as user messages');
    await page.screenshot({path:join(output,'missing-review-es-after.png')});
    await page.getByRole('link',{name:spanish.review.backToGames}).click();
    assert.ok(new URL(page.url()).pathname==='/review',
      'The unavailable recovery must lead back to the saved-game library');
    // A transient outage is different: retry should be offered, and the
    // raw response body must not be exposed as explanatory UI text.
    let attempts=0;
    await page.route('**/api/games/999998',async route=>{
      attempts+=1;
      await route.fulfill({status:503,contentType:'application/json',body:'{"error":"backend_unavailable"}'});
    });
    await page.goto(`${base}/review/999998`,{waitUntil:'domcontentloaded'});
    const retry=page.getByRole('button',{name:spanish.review.retryLoading});
    await retry.waitFor({state:'visible',timeout:18000});
    await page.getByText(spanish.review.unavailableReason.loadFailed,{exact:true}).waitFor({state:'visible'});
    assert.equal(await page.getByText('backend_unavailable',{exact:true}).count(),0);
    const previousAttempts=attempts;
    await Promise.all([
      page.waitForRequest(request=>request.url().endsWith('/api/games/999998'),{timeout:10000}),
      retry.click(),
    ]);
    assert.ok(attempts>previousAttempts,'Retry must issue a fresh request');
    await page.screenshot({path:join(output,'transient-review-es-after.png')});
  }finally{await errorContext.close();}
  // The authoritative server rejects prefix-only analyses, so do not create
  // an impossible partial source. A full move-for-move matching cache with
  // malformed classification metadata is admitted by source provenance but
  // deliberately rejected by the frontend's stricter rendering validator.
  // This is a reachable, safe cached-analysis recovery state.
  const partialMovesJson=db.prepare('SELECT moves_json FROM analyses WHERE game_id=?').get(id).moves_json;
  const partialMoves=JSON.parse(partialMovesJson);
  const malformedMoves=partialMoves.map((move,index)=>index===partialMoves.length-1
    ? {...move,classification:'not-a-valid-classification'} : move);
  db.prepare('UPDATE analyses SET moves_json=? WHERE game_id=?')
    .run(JSON.stringify(malformedMoves),id);
  const sourceAttested=await api(`/api/games/${id}`,{cookie:account.cookie});
  assert.equal(sourceAttested.status,200);
  assert.equal(sourceAttested.json.analysis_stale,false,
    'Malformed classifications must not bypass move/PGN source guards');
  assert.ok(sourceAttested.json.analysis,
    'A source-aligned, malformed classification should reach the frontend decode guard');
  const partialContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await partialContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await partialContext.newPage();
    const spanish=JSON.parse(readFileSync(new URL('../web/src/locales/es.json',import.meta.url),'utf8'));
    await page.goto(`${base}/review/${id}?ply=24`,{waitUntil:'domcontentloaded'});
    await page.getByText(spanish.review.storedAnalysisUnreadable,{exact:true})
      .waitFor({state:'visible'});
    const retryAnalysis=page.getByRole('button',{name:spanish.review.runEngine});
    assert.ok(await retryAnalysis.isEnabled(),
      'An invalid cached classification must offer an explicit reanalysis action');
    await page.screenshot({path:join(output,'unreadable-cache-es-after.png')});
    const firstAttempt=page.waitForRequest(request=>request.url().endsWith('/api/analyze') && request.method()==='POST');
    await retryAnalysis.focus();
    await page.keyboard.press('Enter');
    await firstAttempt;
    await page.getByText(spanish.review.analysisError.unavailable,{exact:true})
      .waitFor({state:'visible',timeout:10000});
    assert.ok(await retryAnalysis.evaluate(button=>document.activeElement===button),
      'A failed engine analysis must restore keyboard focus to the enabled Retry action');
    const secondAttempt=page.waitForRequest(request=>request.url().endsWith('/api/analyze') && request.method()==='POST');
    await page.keyboard.press('Enter');
    await secondAttempt;
    await page.getByText(spanish.review.analysisError.unavailable,{exact:true})
      .waitFor({state:'visible',timeout:10000});
    assert.ok(await retryAnalysis.isEnabled(),'A second failed attempt must leave reanalysis available');
    await page.screenshot({path:join(output,'engine-retry-unavailable-es-after.png')});
    const originalPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    assert.equal(sourceAttested.json.game.pgn,originalPgn,
      'Trying to recover an invalid analysis must not alter the saved game PGN');
  }finally{
    await partialContext.close();
    db.prepare('UPDATE analyses SET moves_json=? WHERE game_id=?').run(partialMovesJson,id);
  }
  // Historical partial engine evidence can be a valid, source-matched prefix
  // of a saved PGN. It must still show a truthful translated gap and offer a
  // working, keyboard-retryable full reanalysis instead of merely opening
  // depth settings below the fold. Do not mutate the authoritative database:
  // simulate the historical prefix only in the disposable HTTP response.
  const prefixContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await prefixContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await prefixContext.newPage();
    const spanish=JSON.parse(readFileSync(new URL('../web/src/locales/es.json',import.meta.url),'utf8'));
    const originalPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    let evidenceInjected=false, forcedAttempts=0;
    await page.route(`**/api/games/${id}`,async route=>{
      const response=await route.fetch();
      const detail=await response.json();
      const original=JSON.parse(detail.analysis.moves_json);
      assert.equal(original.length,24);
      detail.analysis.moves_json=JSON.stringify(original.slice(0,-1));
      detail.analysis.key_moments_json=null;
      detail.analysis.phase_split_json=null;
      evidenceInjected=true;
      await route.fulfill({response,contentType:'application/json',body:JSON.stringify(detail)});
    });
    await page.route('**/api/analyze',async route=>{
      const request=route.request().postDataJSON();
      assert.equal(request.game_id,id);
      assert.equal(request.force,true,
        'Recovering a partial cached report must request a forced full reanalysis');
      forcedAttempts++;
      await route.fulfill({status:503,contentType:'application/json',body:'{"error":"engine_unavailable"}'});
    });
    await page.goto(`${base}/review/${id}?ply=24`,{waitUntil:'domcontentloaded'});
    await page.getByRole('region',{name:spanish.review.moves}).waitFor({state:'visible'});
    assert.ok(evidenceInjected,'The exact source-aligned prefix must reach the React decoder');
    assert.equal((await page.locator('[data-review-move-progress]').innerText()).trim(),'24 / 24');
    const status=page.getByText(spanish.review.partialMoveUnavailable,{exact:true});
    await status.waitFor({state:'visible'});
    const action=page.getByRole('button',{name:spanish.review.partialReanalyze,exact:true});
    await action.waitFor({state:'visible'});
    const hit=await action.boundingBox();
    assert.ok(hit && hit.height>=44 && hit.width>=44,
      `Partial-analysis recovery needs a usable mobile target: ${JSON.stringify(hit)}`);
    await action.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'partial-score-recovery-before-es-390.png')});
    await action.focus();
    const firstRequest=page.waitForRequest(request=>request.url().endsWith('/api/analyze')
      && request.method()==='POST');
    await page.keyboard.press('Enter');
    await firstRequest;
    await page.getByText(spanish.review.analysisError.unavailable,{exact:true})
      .waitFor({state:'visible',timeout:8000});
    assert.equal(forcedAttempts,1,'Keyboard recovery must start an engine request immediately');
    await page.waitForFunction(()=>document.activeElement?.getAttribute('data-review-partial-retry')==='true',
      undefined,{timeout:3000});
    assert.ok(await action.isEnabled(),'A failed full reanalysis must restore Retry');
    const secondRequest=page.waitForRequest(request=>request.url().endsWith('/api/analyze')
      && request.method()==='POST');
    await page.keyboard.press('Enter');
    await secondRequest;
    await page.getByText(spanish.review.analysisError.unavailable,{exact:true})
      .waitFor({state:'visible',timeout:8000});
    await page.waitForFunction(()=>document.activeElement?.getAttribute('data-review-partial-retry')==='true',
      undefined,{timeout:3000});
    assert.equal(forcedAttempts,2,'Retrying from the same focused action must issue a new request');
    await page.screenshot({path:join(output,'partial-score-recovery-after-es-390.png')});
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,originalPgn);
  }finally{await prefixContext.close();}
  // A cached score may be unavailable at a single PGN ply. The graph's
  // keyboard-slider announcement must use the account language, not a
  // hardcoded English string or an invented 0.00 evaluation.
  const noEvalContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await noEvalContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await noEvalContext.newPage();
    const spanish=JSON.parse(readFileSync(new URL('../web/src/locales/es.json',import.meta.url),'utf8'));
    const savedPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    let intercepted=false;
    await page.route(`**/api/games/${id}`,async route=>{
      const response=await route.fetch();
      const detail=await response.json();
      const moves=JSON.parse(detail.analysis.moves_json);
      assert.equal(moves[0].uci,'e2e4');
      moves[0].eval_after_cp=null;
      detail.analysis.moves_json=JSON.stringify(moves);
      intercepted=true;
      await route.fulfill({response,contentType:'application/json',body:JSON.stringify(detail)});
    });
    await page.goto(`${base}/review/${id}?ply=1`,{waitUntil:'domcontentloaded'});
    const graph=page.getByRole('slider',{name:spanish.review.evalGraph});
    await graph.waitFor({state:'visible',timeout:5000});
    assert.equal(await graph.getAttribute('aria-valuenow'),'1');
    assert.equal(await graph.getAttribute('aria-valuetext'),spanish.review.variationEvalUnavailable,
      'The missing evaluation in the review graph must be announced in Spanish');
    assert.ok(intercepted,'The displayed game must include the unscored move fixture');
    await graph.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(output,'unscored-eval-graph-localized-es-390.png')});
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,savedPgn);
  }finally{await noEvalContext.close();}
  // Engine analysis is optional evidence; the saved PGN must remain usable
  // as a move-by-move review even before the engine starts or after an outage.
  // Check real Spanish Game Review with normal and zero-move legal PGNs.
  const originalPgnWithoutEngine=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
  const spanishWithoutEngine=JSON.parse(readFileSync(new URL('../web/src/locales/es.json',import.meta.url),'utf8'));
  const emptyLocale=await api('/api/settings/profile',{method:'PATCH',cookie:account.cookie,
    body:{language:'es',site_theme:'dark'}});
  assert.equal(emptyLocale.status,200);
  for(const [label,fixturePgn] of [['unscored',originalPgnWithoutEngine],['empty','*']]){
    const noEngineContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
    try{
      await noEngineContext.addCookies([{name:account.cookie.split('=')[0],
        value:account.cookie.split('=').slice(1).join('='),url:base}]);
      const page=await noEngineContext.newPage();
      await page.route(`**/api/games/${id}`,async route=>{
        const response=await route.fetch();
        const details=await response.json();
        details.game.pgn=fixturePgn;
        details.analysis=null;
        details.analysis_stale=false;
        details.analysis_unverified=false;
        await route.fulfill({response,contentType:'application/json',body:JSON.stringify(details)});
      });
      await page.goto(`${base}/review/${id}?ply=0`,{waitUntil:'domcontentloaded'});
      await page.locator('cg-board').waitFor({state:'visible'});
      await page.getByRole('img',{name:spanishWithoutEngine.review.variationEvalUnavailable,exact:true})
        .waitFor({state:'visible',timeout:4000});
      assert.equal(await page.getByRole('img',{name:'Evaluation unavailable',exact:true}).count(),0,
        'The Spanish Review evaluation bar must not announce its unknown score in English');
      assert.equal(await page.locator('[data-review-classification-guide]').count(),0,
        'Without actual engine classifications, a saved PGN must not display a classification guide');
      const moveList=page.getByRole('region',{name:spanishWithoutEngine.review.moves});
      await moveList.waitFor({state:'visible',timeout:4000});
      if(label==='unscored'){
        await page.getByRole('button',{name:spanishWithoutEngine.review.runEngine}).waitFor({state:'visible'});
        await page.getByText(spanishWithoutEngine.review.savedMovesWithoutAnalysis,{exact:true})
          .waitFor({state:'visible'});
        const first=moveList.getByRole('button',{name:/^1\. Blancas e4/});
        const second=moveList.getByRole('button',{name:/^1… Negras e5/});
        await first.waitFor({state:'visible'});
        await second.click();
        await page.waitForFunction(()=>document.querySelector('[data-review-move-progress]')
          ?.textContent?.trim()==='2 / 24',undefined,{timeout:4000});
        assert.equal(await second.getAttribute('aria-current'),'step',
          'An unscored saved PGN must allow SAN selection without engine classifications');
        assert.equal(await page.locator('[data-review-move-summary]').getByText('0.00',{exact:true}).count(),0,
          'Unscored saved moves must never be presented as engine-evaluated equality');
      }else{
        await page.getByText(spanishWithoutEngine.review.noMovesToAnalyze,{exact:true})
          .waitFor({state:'visible'});
        assert.equal(await page.getByRole('button',{name:spanishWithoutEngine.review.runEngine}).count(),0,
          'A zero-ply PGN must not offer a full-game engine job without any played moves');
        await page.getByText(spanishWithoutEngine.review.noRecordedMoves,{exact:true})
          .waitFor({state:'visible'});
        const starting=moveList.getByRole('button',{name:spanishWithoutEngine.review.startingPosition});
        assert.equal(await starting.getAttribute('aria-current'),'step');
        await starting.click();
        assert.equal((await page.locator('[data-review-move-progress]').innerText()).trim(),'0 / 0');
        assert.equal(await page.getByText('No recorded moves.',{exact:true}).count(),0,
          'A Spanish zero-move game must not fall back to the English empty state');
      }
      await moveList.scrollIntoViewIfNeeded();
      await page.screenshot({path:join(output,`saved-pgn-without-engine-${label}-es-390.png`)});
      assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,originalPgnWithoutEngine,
        'Unscored Review navigation must never mutate persisted game PGN');
    }finally{await noEngineContext.close();}
  }
  // The evaluation bar's accessible mate score must use the player's review
  // locale without altering the signed, source-verified mate count.
  const spanishMateContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  try{
    await spanishMateContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await spanishMateContext.newPage();
    await page.route(`**/api/games/${id}`,async route=>{
      const response=await route.fetch();
      const detail=await response.json();
      const scored=JSON.parse(detail.analysis.moves_json);
      assert.equal(scored.length,24);
      scored[0].mate_after=3;scored[0].eval_after_cp=9970;
      scored[1].mate_after=-2;scored[1].eval_after_cp=-9980;
      detail.analysis.moves_json=JSON.stringify(scored);
      await route.fulfill({response,contentType:'application/json',body:JSON.stringify(detail)});
    });
    await page.goto(`${base}/review/${id}?ply=1`,{waitUntil:'domcontentloaded'});
    await page.getByRole('img',{name:spanishWithoutEngine.review.evalBarMateWhite.replace('{{count}}','3'),exact:true})
      .waitFor({state:'visible',timeout:4000});
    await page.getByRole('region',{name:spanishWithoutEngine.review.moves})
      .getByRole('button',{name:/^1… Negras e5/}).click();
    await page.getByRole('img',{name:spanishWithoutEngine.review.evalBarMateBlack.replace('{{count}}','2'),exact:true})
      .waitFor({state:'visible',timeout:4000});
    assert.equal(await page.getByRole('img',{name:'Mate in 2 for Black',exact:true}).count(),0,
      'Localized Black mate must not retain the hardcoded English accessible label');
    await page.screenshot({path:join(output,'review-evalbar-localized-mate-es-390.png')});
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,originalPgnWithoutEngine);
  }finally{await spanishMateContext.close();}
  const restored=await api('/api/settings/profile',{
    method:'PATCH',cookie:account.cookie,body:{language:'en'},
  });
  assert.equal(restored.status,200);
  writeFileSync(join(output,'metrics.json'),JSON.stringify(measurements,null,2)+'\n');
  console.log(JSON.stringify({output,measurements},null,2));
}catch(error){console.error(error);process.exitCode=1;}
finally{await browser?.close(); db?.close(); rmSync(scratch,{recursive:true,force:true});}
process.exit(process.exitCode||0);
