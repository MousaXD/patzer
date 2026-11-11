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
  // Review utilities must remain comfortably actionable on narrow phones.
  // These are real control hitboxes rather than just icon dimensions.
  for(const width of [320,390]){
    const context=await browser.newContext({viewport:{width,height:844},colorScheme:'dark',reducedMotion:'reduce'});
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
      await page.getByRole('button',{name:'Star',exact:true}).scrollIntoViewIfNeeded();
      await page.screenshot({path:join(output,`review-utilities-${width}.png`)});
      const bookmark=page.getByRole('button',{name:'Star',exact:true});
      assert.equal(await bookmark.getAttribute('aria-pressed'),'false',
        'The saved-game bookmark must expose its pressed state');
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
  try{
    await notesContext.addCookies([{name:account.cookie.split('=')[0],
      value:account.cookie.split('=').slice(1).join('='),url:base}]);
    const page=await notesContext.newPage();
    const savedPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    let noteAttempts=0;
    await page.route(`**/api/games/${id}/notes`,async route=>{
      noteAttempts++;
      if(noteAttempts===1)await route.fulfill({status:503,contentType:'application/json',body:'{"error":"backend_unavailable"}'});
      else await route.continue();
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
    await Promise.all([
      page.waitForResponse(response=>response.url().endsWith(`/api/games/${id}/notes`) && response.status()===200),
      retry.click(),
    ]);
    await page.getByText(spanishNotes.review.notesSaveFailed,{exact:true}).waitFor({state:'hidden'});
    assert.equal(noteAttempts,2,'Notes retry must send exactly one new PATCH');
    assert.equal(db.prepare('SELECT notes FROM games WHERE id=?').get(id).notes,
      'Nota de ensayo: revisar la partida','Successful retry must persist the unchanged draft');
    assert.equal(db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn,savedPgn);
  }finally{
    await notesContext.close();
    const restored=await api('/api/settings/profile',{method:'PATCH',cookie:account.cookie,
      body:{language:'en',site_theme:'dark'}});
    assert.equal(restored.status,200);
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
      const english=JSON.parse(readFileSync(new URL('../web/src/locales/en.json',import.meta.url),'utf8'));
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
  // Deliberately preserve a historical White-first side label to demonstrate
  // that the UI recovers the real mover from FEN, not from cached metadata.
  db.prepare('UPDATE analyses SET key_moments_json = ? WHERE game_id = ?')
    .run(JSON.stringify([{
      ply:1,side:'white',san:'e5',fen_before:before,classification:'inaccuracy',
      cp_loss:200,win_pct_delta:9,best_san:'c5',best_pv:['c5'],
    }]),blackId);
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
    assert.ok((await page.locator('[data-move-transport]').innerText()).includes('var'),
      'Trying the better move must create an ephemeral branch, not overwrite e5');
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
      cp_loss:200,win_pct_delta:9,best_san:'c5',title:'Black played e5',
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
    assert.ok(text.includes('200cp') && !text.includes('9wp'),
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
            // Try a legal unsaved branch from the starting board. It must be
            // explorable and reversible without changing the original PGN.
            const originalPgn=db.prepare('SELECT pgn FROM games WHERE id = ?').get(id).pgn;
            await page.goto(`${base}/review/${id}?ply=0`,{waitUntil:'domcontentloaded'});
            await page.locator('cg-board').waitFor({state:'visible'});
            await page.locator('.review-board-square').waitFor({state:'visible'});
            await page.getByText(locale.review.startingPosition,{exact:true}).first().waitFor({state:'visible'});
            const board=await page.locator('cg-board').boundingBox();
            assert.ok(board);
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
              return transport?.startsWith('0 /') && !transport.includes('var');
            });
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
    await Promise.all([
      page.waitForRequest(request=>request.url().endsWith('/api/analyze') && request.method()==='POST'),
      retryAnalysis.click(),
    ]);
    await page.getByText(spanish.review.analysisError.unavailable,{exact:true})
      .waitFor({state:'visible',timeout:10000});
    await page.screenshot({path:join(output,'engine-retry-unavailable-es-after.png')});
    const originalPgn=db.prepare('SELECT pgn FROM games WHERE id=?').get(id).pgn;
    assert.equal(sourceAttested.json.game.pgn,originalPgn,
      'Trying to recover an invalid analysis must not alter the saved game PGN');
  }finally{
    await partialContext.close();
    db.prepare('UPDATE analyses SET moves_json=? WHERE game_id=?').run(partialMovesJson,id);
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
