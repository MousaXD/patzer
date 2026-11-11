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
    best_move_uci:'c7c5',best_move_san:'c5',best_pv:[],
    centipawn_loss:200,classification:'inaccuracy'};
  db.prepare(`INSERT INTO analyses
    (game_id,depth,moves_json,accuracy_white,accuracy_black,scoring_version,
    source_hash,source_revision,analysis_generation)
    VALUES (?,12,?,80,80,?,?,?,1)`)
    .run(blackId,JSON.stringify([blackMove]),SCORING_VERSION,
      analysisSourceHash(blackSource),blackSource.source_revision);
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
  }finally{await blackContext.close();}
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
        await page.locator('[data-review-jump-to-details]').click();
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
          }
        }
      }finally{await context.close();}
    }
  }
  const restored=await api('/api/settings/profile',{
    method:'PATCH',cookie:account.cookie,body:{language:'en'},
  });
  assert.equal(restored.status,200);
  writeFileSync(join(output,'metrics.json'),JSON.stringify(measurements,null,2)+'\n');
  console.log(JSON.stringify({output,measurements},null,2));
}catch(error){console.error(error);process.exitCode=1;}
finally{await browser?.close(); db?.close(); rmSync(scratch,{recursive:true,force:true});}
process.exit(process.exitCode||0);
