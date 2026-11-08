/**
 * Agent 07 independent black-box certification.
 * Requires npm run build, npm run setup and isolated Playwright/Chromium.
 * Test data is confined to a disposable SQLite database.
 */
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { Chess } from 'chess.js';

const port = 8894;
const base = 'http://127.0.0.1:' + port;
const dbPath = join(tmpdir(), 'patzer-agent07-' + process.pid + '.db');
const artifacts = resolve(process.env.PATZER_QA_ARTIFACTS || 'qa-artifacts/frontend-overhaul');
process.env.PORT = String(port);
process.env.HOST = '127.0.0.1';
process.env.DB_PATH = dbPath;
mkdirSync(artifacts, { recursive: true });
for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
const results = [];
const browserErrors = [];
let browser;
async function test(name, fn) {
  try { await fn(); results.push({ name, status: 'PASS' }); console.log('PASS ' + name); }
  catch (e) {
    const error = e instanceof Error ? e.stack || e.message : String(e);
    results.push({ name, status: 'FAIL', error }); console.error('FAIL ' + name + '\n' + error);
  }
}
async function api(path, { method='GET', body, cookie }={}) {
  const r = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json',
      ...(method !== 'GET' ? {'X-Requested-With':'patzer'} : {}),
      ...(cookie ? {Cookie:cookie} : {}) },
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
    signal: AbortSignal.timeout(120000),
  });
  let json;
  try { json = await r.json(); } catch { json = null; }
  return {status:r.status, json, cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
async function login(context, username='qaadmin', password='qa-password-123') {
  const page = await context.newPage();
  page.on('pageerror', error => browserErrors.push(page.url()+': '+error.message));
  await page.goto(base + '/login');
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill(password);
  await page.locator('#login-password').press('Enter');
  await page.waitForURL(u => u.pathname !== '/login', {timeout:15000});
  return page;
}
function seed(db, userId, {name, moves=[], fen, classifications=[]}) {
  const game = new Chess(fen);
  if (fen) { game.setHeader('SetUp','1'); game.setHeader('FEN', fen); }
  const analyzed = [];
  for (const san of moves) {
    const before = game.fen(), m = game.move(san);
    assert.ok(m, 'valid test fixture move '+san);
    analyzed.push({
      ply:analyzed.length+1, san:m.san, uci:m.from+m.to+(m.promotion||''),
      fen_before:before, fen_after:game.fen(), eval_before_cp:0, eval_after_cp:0,
      best_move_uci:m.from+m.to+(m.promotion||''), best_move_san:m.san, best_pv:[],
      centipawn_loss:0, classification:classifications[analyzed.length] || 'good',
    });
  }
  const pgn = game.pgn();
  const id = Number(db.prepare("INSERT INTO games (user_id,source,external_id,pgn,white,black,result,time_control,end_time,user_color) VALUES (?, 'imported', ?, ?, 'QA White', 'QA Black', '*', '600', datetime('now'), 'white')").run(userId,name,pgn).lastInsertRowid);
  return {id,pgn,analyzed};
}
function presentationOnly(db, scoringVersion, game) {
  // Never treat synthetic classifications as proof that Stockfish is correct.
  db.prepare('INSERT INTO analyses (game_id,depth,moves_json,accuracy_white,accuracy_black,scoring_version) VALUES (?,12,?,83,85,?)')
    .run(game.id, JSON.stringify(game.analyzed), scoringVersion);
}
async function setTheme(cookie, site_theme) {
  const r = await api('/api/settings/profile', {method:'PATCH',cookie,body:{site_theme}});
  assert.equal(r.status,200,'theme PATCH: '+JSON.stringify(r.json));
}
async function pieces(page) {
  return page.locator('cg-board').first().evaluate(board => {
    const rect = board.getBoundingClientRect();
    return [...board.querySelectorAll('piece')].map(p => {
      const r=p.getBoundingClientRect();
      const col=Math.floor((r.x+r.width/2-rect.x)/(rect.width/8));
      const row=Math.floor((r.y+r.height/2-rect.y)/(rect.height/8));
      return {type:p.className, square:('abcdefgh'[col]||'?')+(8-row)};
    });
  });
}
function at(pieces, type, square) { return pieces.some(p=>p.type.split(/\s+/).includes(type)&&p.square===square); }
async function square(page, name, touch=false) {
  const board=page.locator('cg-board').first();
  await board.scrollIntoViewIfNeeded();
  const b=await board.boundingBox(); assert.ok(b&&b.width>120,'visible chessboard');
  const x=b.x+(0.5+'abcdefgh'.indexOf(name[0]))*b.width/8;
  const y=b.y+(8.5-Number(name[1]))*b.height/8;
  if(touch) await page.touchscreen.tap(x,y); else await page.mouse.click(x,y);
}
async function move(page, from, to, touch=false) {
  await square(page,from,touch); await sleep(120); await square(page,to,touch); await sleep(350);
}
async function noOverflow(page) {
  const x=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  assert.ok(x<=2,'horizontal overflow '+x+'px');
}
async function pageReady(page, gameId, ply=0) {
  await page.goto(base+'/review/'+gameId+(ply?'?ply='+ply:''));
  await page.locator('cg-board').first().waitFor({state:'visible',timeout:15000});
}
try {
  await import('../../server/dist/index.js');
  await sleep(1000);
  assert.equal((await api('/api/health')).status,200,'server booted');
  const created=await api('/api/setup/init',{method:'POST',body:{
    username:'qaadmin',password:'qa-password-123',display_name:'QA Admin',language:'en'}});
  assert.equal(created.status,200,JSON.stringify(created.json));
  assert.ok(created.cookie,'session cookie returned');
  const cookie=created.cookie;
  const db=(await import('../../server/dist/db.js')).db;
  const scoring=(await import('../../server/dist/chess/classifier.js')).SCORING_VERSION;
  const user=db.prepare("SELECT id FROM users WHERE username='qaadmin'").get();
  assert.ok(user?.id,'fixture account exists');
  const main=seed(db,user.id,{name:'review',moves:['e4','e5','Nf3','Nc6','Bc4','Nf6','d3','Bc5'],
    classifications:['book','book','good','best','mistake','good','inaccuracy','blunder']});
  presentationOnly(db,scoring,main);
  const special={
    castle:seed(db,user.id,{name:'castle',fen:'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'}),
    ep:seed(db,user.id,{name:'ep',fen:'4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'}),
    promotion:seed(db,user.id,{name:'promotion',fen:'4k3/P7/8/8/8/8/8/4K3 w - - 0 1'}),
    engine:seed(db,user.id,{name:'engine',moves:['f3','e5','g4','Qh4#']}),
  };
  for(const k of ['castle','ep','promotion']) presentationOnly(db,scoring,special[k]);
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'light'});
  const page=await login(context);

  await test('Real Stockfish scoring and persisted classification',async()=>{
    const r=await api('/api/analyze',{method:'POST',cookie,body:{game_id:special.engine.id,depth:12}});
    assert.equal(r.status,200,'Stockfish: '+JSON.stringify(r.json));
    assert.equal(r.json?.cached,false);
    const m=r.json?.analysis?.moves;
    assert.equal(m?.length,4);
    assert.ok(['mistake','blunder','miss'].includes(m[2].classification),'2.g4 was not marked harmful');
    for(const x of m){
      assert.match(x.uci,/^([a-h][1-8]){2}[qrbn]?$/);
      assert.ok(Number.isFinite(x.centipawn_loss),'finite cp loss');
      assert.ok(x.fen_before&&x.fen_after&&x.classification,'complete evaluated move');
    }
    assert.equal((await api('/api/games/'+special.engine.id,{cookie})).json?.analysis?.scoring_version,scoring);
  });
  await test('Variation-specific Stockfish scoring is read-only and agrees with FEN',async()=>{
    const chess=new Chess();
    chess.move('e4');chess.move('e5');
    const before=chess.fen();
    chess.move('Bc4');
    const after=chess.fen();
    const response=await api('/api/analyze/variation-move',{
      method:'POST',cookie,body:{fen_before:before,move_uci:'f1c4',depth:8,ply:3}
    });
    assert.equal(response.status,200,'variation scoring endpoint: '+JSON.stringify(response.json));
    const quality=response.json?.quality;
    assert.equal(quality?.source,'variation');
    assert.equal(quality?.uci,'f1c4');
    assert.equal(quality?.san,'Bc4');
    assert.equal(quality?.fen_after,after,'returned FEN must match legal move');
    assert.ok(['brilliant','great','best','excellent','good','book','forced','inaccuracy','mistake','blunder','miss'].includes(quality?.classification));
    assert.ok(Number.isFinite(quality?.centipawn_loss),'real numeric Stockfish score');
    const invalid=await api('/api/analyze/variation-move',{
      method:'POST',cookie,body:{fen_before:before,move_uci:'e7e5',depth:8,ply:3}
    });
    assert.equal(invalid.status,400,'illegal variation must be rejected');
    assert.equal((await api('/api/games/'+main.id,{cookie})).json?.game?.pgn,main.pgn,'scoring must not mutate saved game');
  });
  await test('All authenticated routes and admin destinations remain reachable',async()=>{
    const prior=browserErrors.length;
    for(const path of ['/','/play','/review','/insights','/train','/learn','/openings','/plan','/lab','/players','/settings','/admin/users','/admin/system']){
      await page.goto(base+path,{waitUntil:'domcontentloaded'});
      assert.equal(new URL(page.url()).pathname,path,'redirect at '+path);
      // domcontentloaded may predate React hydration and authentication refresh.
      // Wait for meaningful content rather than falsely flagging a normal loading transition.
      await page.waitForFunction(() => (document.querySelector('#root')?.textContent?.trim().length ?? 0) > 0,
        undefined, { timeout: 5000 });
      assert.ok((await page.locator('#root').innerText()).trim().length>0,'blank '+path);
    }
    assert.deepEqual(browserErrors.slice(prior),[],'uncaught route errors');
  });
  await test('Security headers, CSRF, role restriction and saved-game isolation',async()=>{
    const root=await fetch(base+'/');
    assert.equal(root.status,200);
    assert.equal(root.headers.get('x-frame-options'),'DENY');
    assert.equal(root.headers.get('x-content-type-options'),'nosniff');
    const csp=root.headers.get('content-security-policy')||'';
    assert.match(csp,/script-src 'self'/);
    assert.match(csp,/frame-ancestors 'none'/);
    // A session cookie alone must never authorize a mutating API request.
    const csrf=await fetch(base+'/api/settings/profile',{
      method:'PATCH',headers:{Cookie:cookie,'Content-Type':'application/json'},
      body:JSON.stringify({site_theme:'dark'})
    });
    assert.equal(csrf.status,403,'missing CSRF header must be rejected');
    assert.equal((await api('/api/games/'+main.id)).status,401,'anonymous game access');
    const createdUser=await api('/api/admin/users',{method:'POST',cookie,body:{
      username:'qauser',password:'qa-user-password-123',display_name:'QA User',role:'user'
    }});
    assert.equal(createdUser.status,200,'create normal-user fixture: '+JSON.stringify(createdUser.json));
    const auth=await api('/api/auth/login',{method:'POST',body:{
      username:'qauser',password:'qa-user-password-123'
    }});
    assert.equal(auth.status,200,'normal user authentication');
    assert.ok(auth.cookie,'normal user session cookie');
    assert.equal((await api('/api/games/'+main.id,{cookie:auth.cookie})).status,404,'cross-user saved game must be private');
    assert.equal((await api('/api/admin/users',{cookie:auth.cookie})).status,403,'admin API must reject normal user');
    const priorBrowserErrors=browserErrors.length;
    const normalContext=await browser.newContext({viewport:{width:1366,height:768}});
    try {
      const normalPage=await login(normalContext,'qauser','qa-user-password-123');
      await normalPage.goto(base+'/admin/users');
      await normalPage.waitForFunction(()=>location.pathname==='/',undefined,{timeout:6000});
      assert.equal(new URL(normalPage.url()).pathname,'/','normal user must not render admin route');
      assert.deepEqual(browserErrors.slice(priorBrowserErrors),[],'browser errors in normal user flow');
    } finally { await normalContext.close(); }
  });
  await test('New user remains in white theme when OS prefers dark',async()=>{
    // A genuine newly created account defaults to Light; an existing user who
    // explicitly selected Auto must still follow their OS preference.
    const darkOS=await browser.newContext({viewport:{width:1366,height:768},colorScheme:'dark'});
    try {
      const fresh=await login(darkOS,'qauser','qa-user-password-123');
      await fresh.goto(base+'/settings');
      await fresh.locator('input').first().waitFor({state:'visible'});
      assert.equal(await fresh.locator('html').evaluate(el=>el.classList.contains('dark')),false);
      const explicit=await api('/api/settings/profile', {method:'PATCH',body:{site_theme:'auto'},cookie:(await api('/api/auth/login',{method:'POST',body:{username:'qauser',password:'qa-user-password-123'}})).cookie});
      assert.equal(explicit.status,200,'Auto preference remains supported');
      await fresh.reload();
      await fresh.waitForFunction(() => document.documentElement.classList.contains('dark'));
    } finally {await darkOS.close();}
  });
  const sizes=[['1920x1080',1920,1080],['1440x900',1440,900],['1366x768',1366,768],['768x1024',768,1024],['390x844',390,844]];
  for(const theme of ['light','dark']){
    await setTheme(cookie,theme);
    for(const [label,width,height] of sizes){
      await test('Responsive '+label+' / '+theme+' / screenshot',async()=>{
        await page.setViewportSize({width,height});
        const prior=browserErrors.length;
        await pageReady(page,main.id,5);
        assert.equal(await page.locator('html').evaluate(el=>el.classList.contains('dark')),theme==='dark');
        const b=await page.locator('cg-board').first().boundingBox();
        assert.ok(b&&b.width>170&&Math.abs(b.width-b.height)<4,'board must be square');
        if(width>=1366)assert.ok(b.width/width<=0.58,'board too wide for desktop workspace');
        await noOverflow(page);
        await page.screenshot({path:join(artifacts,theme+'-'+label+'.png'),fullPage:true});
        assert.deepEqual(browserErrors.slice(prior),[],'runtime exceptions');
      });
    }
  }
  await test('Bundled local font and styled controls / accessible labels',async()=>{
    await page.setViewportSize({width:1440,height:900});
    await setTheme(cookie,'light');
    await page.goto(base+'/settings');
    // Wait for React hydration and CSS font requests before asserting their
    // load state. document.fonts.ready on an empty loading shell can resolve
    // before the authenticated Settings UI has mounted.
    await page.locator('input').first().waitFor({state:'visible'});
    await page.waitForFunction(async () => {
      await document.fonts.load('400 14px "Patzer Sans"');
      return [...document.fonts].some(f => f.family === 'Patzer Sans' && f.status === 'loaded');
    }, undefined, { timeout: 10000 });
    const evidence=await page.evaluate(async()=>{
      await document.fonts.ready;
      const loaded=[...document.fonts].some(f=>f.status==='loaded');
      const inputs=[...document.querySelectorAll('input,select,textarea')].filter(x=>x.getBoundingClientRect().width>0);
      const defects=inputs.filter(x=>!x.closest('label')&&!x.id&&!x.getAttribute('aria-label'));
      const system=inputs.filter(x=>/system-ui|-apple-system|segoe ui|arial/i.test(getComputedStyle(x).fontFamily));
      return {loaded,unnamed:defects.map(x=>x.outerHTML.slice(0,140)),system:system.map(x=>x.outerHTML.slice(0,140))};
    });
    assert.ok(evidence.loaded,'no bundled font loaded');
    assert.deepEqual(evidence.unnamed,[],'unlabelled controls');
    assert.deepEqual(evidence.system,[],'generic system fonts');
  });
  await test('Navigation and actions have no decorative emoji',async()=>{
    await pageReady(page,main.id,5);
    const labels=await page.evaluate(()=>[...document.querySelectorAll('nav a, nav button, main button')]
      .filter(el=>/\p{Extended_Pictographic}/u.test(el.textContent||''))
      .map(el=>(el.textContent||'').trim().slice(0,80)));
    assert.deepEqual(labels,[],'emoji substituted for designed navigation/actions');
  });
  await test('Visible interactive controls have accessible names and focus styles',async()=>{
    await pageReady(page,main.id,5);
    const missing=await page.evaluate(()=>[...document.querySelectorAll('button,a[href],input,select,textarea')]
      .filter(el=>{
        const r=el.getBoundingClientRect();
        if(!r.width||!r.height||getComputedStyle(el).visibility==='hidden')return false;
        if(el.getAttribute('aria-hidden')==='true')return false;
        const name=el.getAttribute('aria-label')||el.getAttribute('title')||el.textContent?.trim()
          ||(el.id&&document.querySelector('label[for="'+el.id+'"]')?.textContent?.trim())
          ||el.closest('label')?.textContent?.trim();
        return !name;
      }).map(el=>el.outerHTML.slice(0,120)));
    assert.deepEqual(missing.slice(0,20),[],'unnamed visible controls');
    await page.keyboard.press('Tab');
    const focus=await page.evaluate(()=>{
      const el=document.activeElement;
      if(!el||el===document.body)return null;
      const st=getComputedStyle(el);
      return {name:el.tagName,outline:st.outlineStyle,shadow:st.boxShadow,border:st.borderWidth};
    });
    assert.ok(focus&&(
      (focus.outline&&focus.outline!=='none') ||
      (focus.shadow&&focus.shadow!=='none') ||
      (focus.border&&focus.border!=='0px')
    ),'no discernible focus styling');
  });
  await test('Keyboard first/previous/next/last follows selected ply',async()=>{
    await pageReady(page,main.id,2);
    // Ensure the review state has hydrated before sending keyboard events.
    await page.getByText('2 / 8', { exact: true }).waitFor({ timeout: 8000 });
    // The new navigation rail contains a Home link at top-left. Clicking
    // body at (3,3) accidentally navigates Home; only clear field focus.
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    const expectPly = async (expected) => {
      await page.waitForFunction(ply => {
        const actual = new URL(window.location.href).searchParams.get('ply');
        return ply === 0 ? actual === null : actual === String(ply);
      }, expected, {timeout: 8000});
      const current = await page.locator('cg-board').first().isVisible();
      assert.equal(current,true,'board must remain visible after keyboard navigation');
    };
    await page.keyboard.press('ArrowLeft'); await expectPly(1);
    await page.keyboard.press('ArrowRight'); await expectPly(2);
    await page.keyboard.press('End'); await expectPly(8);
    await page.keyboard.press('Home'); await expectPly(0);
  });
  await test('Desktop review fills space without clipped or promotional chrome',async()=>{
    await page.setViewportSize({width:1704,height:857});
    await pageReady(page,main.id,3);
    const dims=await page.evaluate(()=>{
      const rect=(sel)=>{const n=document.querySelector(sel);return n?.getBoundingClientRect().toJSON();};
      return {content:rect('[data-analysis-workspace]'), board:rect('cg-board'),
        rail:rect('[data-review-side-rail]'), column:rect('.review-board-column'),
        footerCount:document.querySelectorAll('[data-app-shell] footer').length,
        railOverflow:getComputedStyle(document.querySelector('[data-review-side-rail]')).overflowY,
        rootWidth:document.documentElement.scrollWidth};
    });
    assert.ok(dims.board?.width>580, 'board did not expand to use available space: '+JSON.stringify(dims));
    assert.ok(dims.rail?.width>500, 'right rail should be useful on desktop: '+JSON.stringify(dims));
    const leftGap=dims.column.left-dims.content.left;
    const rightGap=dims.content.right-dims.rail.right;
    assert.ok(Math.abs(leftGap-rightGap)<45,`unbalanced margins: ${leftGap}, ${rightGap}`);
    assert.equal(dims.footerCount,0,'persistent GitHub promotion footer must be removed');
    assert.equal(dims.rootWidth,1704,'unexpected horizontal overflow');
    assert.notEqual(dims.railOverflow,'auto','rail should not have a second private vertical scrollbar');
  });
  await test('Review arrow shortcuts consume browser actions but respect editing controls',async()=>{
    await page.setViewportSize({width:1366,height:768});
    await pageReady(page,main.id,2);
    await page.getByText('2 / 8',{exact:true}).waitFor();
    await page.evaluate(()=>{
      document.activeElement?.blur?.();
      window.__patzerAuditKeys=[];
      window.addEventListener('keydown',e=>{
        if(['ArrowRight','ArrowLeft','Home','End'].includes(e.key)){
          window.__patzerAuditKeys.push({key:e.key,prevented:e.defaultPrevented,target:e.target?.tagName});
        }
      });
    });
    const scrollStart=await page.evaluate(()=>window.scrollY);
    await page.keyboard.press('ArrowRight');
    await page.getByText('3 / 8',{exact:true}).waitFor();
    await page.keyboard.press('ArrowLeft');
    await page.getByText('2 / 8',{exact:true}).waitFor();
    await page.keyboard.press('End');
    await page.getByText('8 / 8',{exact:true}).waitFor();
    await page.keyboard.press('Home');
    await page.getByText('0 / 8',{exact:true}).waitFor();
    const scrollEnd=await page.evaluate(()=>window.scrollY);
    assert.equal(scrollEnd,scrollStart,'Home/End scrolled page instead of only navigating chess moves');
    const keys=await page.evaluate(()=>window.__patzerAuditKeys);
    assert.deepEqual(keys.map(x=>x.key),['ArrowRight','ArrowLeft','End','Home']);
    assert.ok(keys.every(x=>x.prevented),'chess keyboard handler did not suppress native browser actions: '+JSON.stringify(keys));
    await page.evaluate(()=>{
      const input=document.createElement('input');input.id='qa-shortcut-input';
      document.body.appendChild(input);input.focus();
    });
    await page.keyboard.press('ArrowRight');
    assert.equal((await page.getByText('0 / 8',{exact:true}).count()),1,'arrow key in text field changed review ply');
    const last=await page.evaluate(()=>window.__patzerAuditKeys.at(-1));
    assert.equal(last.target,'INPUT');
    assert.equal(last.prevented,false,'arrow key in a text field should keep native caret movement');
    await page.evaluate(()=>document.querySelector('#qa-shortcut-input')?.remove());
  });
  await test('Review tabs expose selected semantics and keyboard traversal',async()=>{
    await pageReady(page,main.id,2);
    const movesTab=page.getByRole('tab',{name:/^moves$/i});
    await movesTab.focus();
    assert.equal(await movesTab.getAttribute('aria-selected'),'true');
    await page.keyboard.press('ArrowRight');
    await page.getByRole('tab',{name:/AI report/i}).waitFor();
    assert.equal(await page.getByRole('tab',{name:/AI report/i}).getAttribute('aria-selected'),'true');
    assert.equal(await page.getByText('2 / 8',{exact:true}).count(),1,'tab arrow should not change chess ply');
    await page.keyboard.press('End');
    assert.equal(await page.getByRole('tab',{name:/key moments/i}).getAttribute('aria-selected'),'true');
    await page.keyboard.press('Home');
    assert.equal(await movesTab.getAttribute('aria-selected'),'true');
    assert.equal(await page.getByRole('tabpanel').getAttribute('aria-labelledby'),'review-tab-moves');
  });
  await test('Changelog modal traps focus, blocks Review arrows and exits on Escape',async()=>{
    await page.setViewportSize({width:1366,height:768});
    await pageReady(page,main.id,2);
    const version=page.getByRole('button',{name:/patzer version .* view changelog/i});
    await version.click();
    const modal=page.getByRole('dialog',{name:/changelog/i});
    await modal.waitFor({state:'visible'});
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByText('2 / 8',{exact:true}).count(),1,'arrow navigated behind dialog');
    await page.keyboard.press('Escape');
    await modal.waitFor({state:'detached'});
    assert.equal(await version.evaluate(el=>document.activeElement===el),true,'focus must return to changelog trigger');
  });
  await test('Evaluation graph has working keyboard scrubbing semantics',async()=>{
    await pageReady(page,main.id,2);
    const slider=page.getByRole('slider',{name:/move evaluation timeline/i});
    await slider.focus();
    assert.equal(await slider.getAttribute('aria-valuenow'),'2');
    await page.keyboard.press('ArrowRight');
    await page.getByText('3 / 8',{exact:true}).waitFor();
    assert.equal(await slider.getAttribute('aria-valuenow'),'3');
  });
  await test('Quality badge matches persisted class and is anchored to board',async()=>{
    await pageReady(page,main.id,5);
    const marker=page.locator('[title="mistake"]').first();
    await marker.waitFor({state:'visible'});
    const b=await page.locator('cg-board').first().boundingBox(),m=await marker.boundingBox();
    assert.ok(b&&m&&m.x>b.x-30&&m.y>b.y-30&&m.x<b.x+b.width+30&&m.y<b.y+b.height+30,'badge outside board');
  });
  await test('Marker position follows flipped board orientation',async()=>{
    await pageReady(page,main.id,5);
    const marker=page.locator('[title="mistake"]').first();
    const before=await marker.boundingBox();
    assert.ok(before,'initial marker visible');
    // The current button's accessible name is the visible action "Flip";
    // its longer title is a tooltip, not the accessibility name.
    await page.getByRole('button',{name:/^flip$/i}).first().click();
    const after=await marker.boundingBox();
    assert.ok(after,'flipped marker visible');
    assert.ok(Math.abs(after.x-before.x)>8 || Math.abs(after.y-before.y)>8,'badge must move when board orientation changes');
  });
  await test('Engine suggested continuation is a playable legal branch',async()=>{
    await pageReady(page,main.id,0);
    await page.route('**/api/analyze/position', async route => {
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        fen:new Chess().fen(),depth:12,lines:[{uci:'d2d4',san:'d4',pv_san:['d4','d5','c4'],cp:32,mate:null,multipv:1}]
      })});
    });
    try {
      await page.getByRole('button',{name:/show top engine lines/i}).click();
      const tryMove=page.getByRole('button',{name:/try engine move d4/i});
      await tryMove.waitFor({state:'visible',timeout:6000});
      await tryMove.click();
      await page.waitForFunction(()=>document.querySelector('section[aria-label="Analysis variations"]')?.textContent?.includes('Variation 1'),undefined,{timeout:7000});
      assert.ok(at(await pieces(page),'pawn','d4'),'clicking best-line button did not play d4');
      assert.equal((await api('/api/games/'+main.id,{cookie})).json?.game?.pgn,main.pgn);
    } finally {await page.unroute('**/api/analyze/position');}
  });
  await test('Sharing a variation opens its exact FEN in the Lab, not a mainline link',async()=>{
    await pageReady(page,main.id,2);
    await page.evaluate(()=>{
      window.__patzerCopiedText='';
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__patzerCopiedText=text;}}});
    });
    await move(page,'f1','c4');
    await page.getByRole('button',{name:/share branch fen/i}).click();
    const copied=await page.evaluate(()=>window.__patzerCopiedText);
    assert.ok(copied.includes('/lab#'),'branch should link to Lab: '+copied);
    const fen=decodeURI(new URL(copied).hash.slice(1));
    const chess=new Chess(fen);
    assert.equal(chess.get('c4')?.type,'b');
    assert.equal((await api('/api/games/'+main.id,{cookie})).json?.game?.pgn,main.pgn);
  });
  await test('Unscored variation displays no fabricated 0.00 evaluation',async()=>{
    await pageReady(page,main.id,2);
    await page.route('**/api/analyze/variation-move', async route=>{
      await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'engine_unavailable'})});
    });
    try {
      await move(page,'f1','c4');
      await page.getByText(/Move not scored/i).waitFor({timeout:8000});
      assert.equal(await page.getByLabel('Position evaluation unavailable').count(),1);
      assert.equal(await page.getByRole('img',{name:'Evaluation unavailable'}).count(),1);
      assert.ok(!(await page.locator('[aria-label="Position evaluation unavailable"]').innerText()).includes('0.00'));
    } finally {await page.unroute('**/api/analyze/variation-move');}
  });
  await test('Review variation Bc4 is legal and saved PGN immutable',async()=>{
    await pageReady(page,main.id,2);
    assert.ok(at(await pieces(page),'bishop','f1'));
    await move(page,'f1','c4');
    assert.ok(at(await pieces(page),'bishop','c4'),'legal variation did not appear');
    assert.equal((await api('/api/games/'+main.id,{cookie})).json?.game?.pgn,main.pgn);
  });
  for(const [key,from,to,type,target] of [
    ['castle','e1','g1','king','g1'],['ep','e5','d6','pawn','d6'],['promotion','a7','a8','queen','a8']
  ]){
    await test('Analysis special move '+key+' preserves saved game',async()=>{
      await pageReady(page,special[key].id);
      await move(page,from,to);
      if(key==='promotion') {
        await page.getByRole('button',{name:/queen|^q$/i}).first().click({timeout:2500});
        // Chessground redraw and React's immutable variation update are async.
        // Check the resulting piece after the board actually settles.
        await page.waitForFunction(() => {
          const board=document.querySelector('cg-board');
          if(!board)return false;
          const br=board.getBoundingClientRect();
          return [...board.querySelectorAll('piece')].some(piece => {
            if(!piece.classList.contains('queen'))return false;
            const r=piece.getBoundingClientRect();
            return r.x+r.width/2<br.x+br.width/8 && r.y+r.height/2<br.y+br.height/8;
          });
        },undefined,{timeout:5000});
      }
      const p=await pieces(page);
      assert.ok(at(p,type,target),'piece missing at '+target);
      if(key==='castle')assert.ok(at(p,'rook','f1'),'castling rook missing');
      if(key==='ep')assert.ok(!at(p,'pawn','d5'),'en passant capture not removed');
      assert.equal((await api('/api/games/'+special[key].id,{cookie})).json?.game?.pgn,special[key].pgn);
    });
  }
  await test('Mobile touchscreen variation',async()=>{
    const phone=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    try {
      const mobile=await login(phone);
      await pageReady(mobile,main.id,2);
      await move(mobile,'f1','c4',true);
      assert.ok(at(await pieces(mobile),'bishop','c4'),'touch move did not succeed');
    } finally {await phone.close();}
  });
  await test('Sound preferences and theme survive reload',async()=>{
    const r=await api('/api/settings/profile',{method:'PATCH',cookie,body:{sound_enabled:false,site_theme:'dark'}});
    assert.equal(r.status,200);
    await page.goto(base+'/settings');await page.reload();
    const p=(await api('/api/settings/profile',{cookie})).json?.profile;
    assert.equal(p?.sound_enabled,0);
    assert.equal(p?.site_theme,'dark');
    assert.equal(await page.locator('html').evaluate(el=>el.classList.contains('dark')),true);
  });
  // Audio timbre and perceived quality require human listening; never auto-certify.
} catch(e) {
  const error=e instanceof Error?e.stack||e.message:String(e);
  results.push({name:'QA harness bootstrap',status:'FAIL',error}); console.error(error);
} finally {
  if(browser)await browser.close();
  writeFileSync(join(artifacts,'results.json'),JSON.stringify({
    tested_ref:process.env.GITHUB_SHA||'local (SHA not supplied)',
    timestamp:new Date().toISOString(), results, browserErrors
  },null,2));
  const failed=results.filter(x=>x.status==='FAIL').length;
  console.log('QA results: '+(results.length-failed)+' PASS; '+failed+' FAIL. Evidence: '+artifacts);
  process.exit(failed||browserErrors.length?1:0);
}
