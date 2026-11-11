#!/usr/bin/env node
/**
 * Agent D — real headless Chrome + actual Agent C React App and Agent B review
 * backend, disposable SQLite, real localhost HTTP and an isolated Chrome
 * profile. Compare ordinary unmount/logout against a test-only browser fault
 * that removes the report fetch AbortSignal. No live application is modified.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {Hono} from 'hono';
import {serve} from '@hono/node-server';
import {createServer as createViteServer} from 'vite';
import {Chess} from 'chess.js';
import {launchBrowser,within,until} from './review-benchmark-cdp.mjs';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence'),results=join(qa,'results');
mkdirSync(results,{recursive:true});
const args=Object.fromEntries(process.argv.slice(2).map(s=>{
 const i=s.indexOf('=');return i<0?[s.slice(2),true]:[s.slice(2,i),s.slice(i+1)];
}));
const runId=args['run-id']||randomUUID();
assert(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(runId));
const injectedFault=args.fault??null;
assert(injectedFault===null||injectedFault==='disable-navigation-abort',
 'only the documented QA-owned browser fault is permitted');
const product=realpathSync(args['product-root']||join(results,'worktree-product-browser'));
const backend=realpathSync(args['backend-root']||join(results,'worktree-coach'));
const engine=realpathSync(args.engine||join(results,'engine/unpacked/usr/games/stockfish'));
const gitSha=path=>execFileSync('git',['rev-parse','HEAD'],{cwd:path,encoding:'utf8'}).trim();
const productSha='d72eaced6972c8a2ec7d8581365c45788b15a29a';
const backendSha='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
assert.equal(gitSha(product),productSha);
assert.equal(gitSha(backend),backendSha);
const sha=data=>createHash('sha256').update(data).digest('hex');
const engineHash=sha(readFileSync(engine));
assert.equal(engineHash,'00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca');
const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8');
const entry=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(entry?.source_kind==='synthetic'&&entry.license==='self-authored');
const pgn=readFileSync(join(qa,'fixtures',entry.pgn_file),'utf8');
assert.equal(sha(pgn),entry.pgn_sha256);
const chess=new Chess();chess.loadPgn(pgn,{strict:true});
assert(chess.isCheckmate()&&chess.turn()==='w');

const scratch=mkdtempSync(join(results,'chrome-abort-'));
process.env.DB_PATH=join(scratch,'qa-only.db');
process.env.SESSION_SECRET='synthetic-cdp-test-key';
process.env.ENGINE_BACKEND='local';
process.env.STOCKFISH_PATH=engine;
process.env.STOCKFISH_THREADS='1';
process.env.STOCKFISH_HASH='16';
process.env.OIDC_ENABLED='false';
process.env.UPDATE_CHECK_ENABLED='false';

const model={holds:[],posts:[],closed:[],errors:[]};
let db=null,vite=null,server=null,browser=null;
const llm=createServer((req,res)=>{
 if(req.method==='GET'&&req.url==='/v1/models'){
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({data:[{id:'qa-cdp-llm'}]}));return;
 }
 if(req.method==='POST'&&req.url==='/v1/chat/completions'){
  let body='';req.on('data',s=>{body+=s;if(body.length>80000)req.destroy();});
  req.on('end',()=>{
   try{
    const payload=JSON.parse(body);assert.equal(payload.model,'qa-cdp-llm');
    const prompt=payload.messages?.find(m=>m.role==='user')?.content||'';
    const stage=prompt.includes('Schema: { "summary"')?'summary':
     prompt.includes('"what_happened"')?'moment':'phase';
    const record={stage,res,sequence:model.posts.length+1};
    model.posts.push({stage,sequence:record.sequence});
    res.on('close',()=>model.closed.push(record.sequence));
    if(stage==='summary'){model.holds.push(record);return;}
    respond(record);
   }catch(error){model.errors.push(String(error));res.writeHead(500).end(String(error));}
  });return;
 }
 res.writeHead(404).end();
});
function respond(held){
 const output={title:'QA model summary',prose:'Review the actual moves.',
  what_happened:'Review the actual moves.',summary:'Black won the game.',
  opening_prose:'These are opening moves.',
  skill_assessment:'One match is insufficient to judge your skill.'};
 if(held.res.destroyed)return false;
 held.res.writeHead(200,{'content-type':'application/json'});
 held.res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(output)}}]}));
 return true;
}
const events={reviewHttp:[],modelStages:[],browserExceptions:[],scenarios:[]};
const started=Date.now();

function cache(id){
 return db.prepare('SELECT prose_json,prose_lang,prose_audience FROM analyses WHERE game_id=?').get(id);
}
async function pageAtBrowserGame(id){
 await browser.go('http://127.0.0.1:'+vitePort+'/review/'+id);
 await browser.wait('location.pathname === "/review/'+id+'" && !!document.querySelector("#review-tab-report")',
  'actual_game_analyzer_mounted',20000);
 await browser.click('#review-tab-report');
 await browser.wait('!![...document.querySelectorAll("button")].find(b=>b.textContent.includes("Write AI report"))',
  'real_game_report_button',8000);
}
async function startActualReview(id){
 const before=model.holds.length;
 await pageAtBrowserGame(id);
 const clicked=await browser.evalJs(`(() => {
  const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Write AI report'));
  if(!b)return false;b.click();return true;
 })()`);
 assert.equal(clicked,true,'real React report trigger missing');
 await until(()=>model.holds.length>before,'real_provider_summary_'+id,12000);
 assert.equal(cache(id).prose_json,null,'do not certify a review that was already cached');
 return model.holds.at(-1);
}
async function checkModelAfterNavigate(hold,gameId,expectCache){
 // A short bounded race window lets Hono and the Vite HTTP proxy observe the
 // browser's stream cancellation. This is measured rather than assumed.
 await until(()=>hold.res.destroyed||model.closed.includes(hold.sequence),
  'model_request_abort_'+gameId,1600).catch(()=>{});
 const closedBeforeRelease=hold.res.destroyed||model.closed.includes(hold.sequence);
 const released=respond(hold);
 if(expectCache){
  await until(()=>cache(gameId).prose_json!==null,'faulty_report_cache_write_'+gameId,3500).catch(()=>{});
 }else{
  // Check again after an independent event-loop interval: an immediate NULL
  // read would be a weak false green if a queued callback writes afterward.
  await new Promise(done=>setTimeout(done,600));
 }
 return {provider_closed_before_release:closedBeforeRelease,
  provider_response_sent_after_navigation:released,
  cached_after_release:cache(gameId).prose_json!==null};
}

// `vitePort` must be the actual ephemeral QA Vite listener, not any active
// local app port. It is assigned only after the server is safely initialized.
let vitePort=0,apiPort=0,experimentError=null;
const originalCwd=process.cwd();
try{
 await within(new Promise((ok,fail)=>{llm.once('error',fail);llm.listen(0,'127.0.0.1',ok);}),1800,'provider_listen');
 const {db:database,setSetting}=await import(join(backend,'server/src/db.ts'));db=database;
 setSetting('llm_provider','vllm');
 setSetting('vllm_model','qa-cdp-llm');
 setSetting('vllm_url','http://127.0.0.1:'+llm.address().port);
 const {analyzePgn,saveAnalysis}=await import(join(backend,'server/src/routes/analyze.ts'));
 const {createSession}=await import(join(backend,'server/src/auth/sessions.ts'));
 const realRoutes={
  setup:(await import(join(backend,'server/src/routes/setup.ts'))).default,
  auth:(await import(join(backend,'server/src/routes/auth.ts'))).default,
  games:(await import(join(backend,'server/src/routes/games.ts'))).default,
  review:(await import(join(backend,'server/src/routes/review.ts'))).default,
  coach:(await import(join(backend,'server/src/routes/coach.ts'))).default,
  meta:(await import(join(backend,'server/src/routes/meta.ts'))).default,
  settings:(await import(join(backend,'server/src/routes/settings.ts'))).default,
 };
 db.prepare('INSERT INTO users(id,username,password_hash,role) VALUES(?,?,?,?)')
  .run(1,'qa-browser-user','not-a-real-password','admin');
 db.prepare('INSERT INTO profiles(user_id,display_name,language,audience) VALUES(?,?,?,?)')
  .run(1,'QA Chrome user','en','beginner');
 const analysis=await analyzePgn(pgn,8);
 for(let id=1;id<=4;id++){
  db.prepare('INSERT INTO games(id,user_id,source,pgn,user_color,white,black,result) VALUES(?,?,?,?,?,?,?,?)')
   .run(id,1,'imported',pgn,'white','Synthetic White','Synthetic Black','0-1');
  saveAnalysis(id,analysis);
 }
 const app=new Hono();
 app.use('/api/*',async(c,next)=>{
  const url=new URL(c.req.url);
  if(url.pathname.match(/^\/api\/games\/\d+\/review$/)){
   events.reviewHttp.push({method:c.req.method,url:url.pathname});
  }
  if(c.req.method!=='GET'&&c.req.method!=='HEAD'&&c.req.header('X-Requested-With')!=='patzer'){
   return c.json({error:'csrf_required'},403);
  }
  await next();
 });
 app.get('/api/meta/update',c=>c.json({enabled:false,updateAvailable:false}));
 app.route('/api/setup',realRoutes.setup);
 app.route('/api/auth',realRoutes.auth);
 app.route('/api/games',realRoutes.games);
 app.route('/api/games',realRoutes.review);
 app.route('/api/coach',realRoutes.coach);
 app.route('/api/meta',realRoutes.meta);
 app.route('/api/settings',realRoutes.settings);
 server=serve({fetch:app.fetch,port:0,hostname:'127.0.0.1'});
 await within(new Promise((ok,fail)=>{server.once('listening',ok);server.once('error',fail);}),2000,'api_server');
 apiPort=server.address().port;
 // Use the actual candidate frontend Vite/Tailwind settings, from the
 // product directory. This avoids silently certifying an unstyled mock app.
 process.env.PORT=String(apiPort);
 process.chdir(join(product,'web'));
 vite=await createViteServer({
  root:join(product,'web'),configFile:join(product,'web/vite.config.ts'),
  server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,
   proxy:{'/api':{target:'http://127.0.0.1:'+apiPort,changeOrigin:true}}},
  logLevel:'error',
 });
 await within(vite.listen(),10000,'vite_server');
 vitePort=vite.httpServer.address().port;
 assert(vitePort!==apiPort&&vitePort>0&&apiPort>0);
 const apiHealth=await within(fetch('http://127.0.0.1:'+vitePort+'/api/setup/status'),3500,'vite_proxy');
 assert.equal(apiHealth.status,200);
 assert.equal((await apiHealth.json()).setup_required,false);

 browser=await launchBrowser({chromeBinary:args.chrome||'/usr/bin/google-chrome',
  profileDir:join(scratch,'chrome-profile')});
 const origin='http://127.0.0.1:'+vitePort;
 let signed=createSession(1);
 await browser.send('Network.setCookie',{url:origin,name:'chess_session',value:signed,path:'/',
  sameSite:'Lax',httpOnly:true});
 if(injectedFault==='disable-navigation-abort'){
  // Hostile control for the CERTIFICATION GATE itself: remove only game 1's
  // report AbortSignal before the first normal-navigation scenario. The real
  // React component is unchanged; an otherwise green benchmark must turn red.
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`(() => {
   const original=window.fetch.bind(window);
   window.__qaUnexpectedNormalAbortBypass=0;
   window.fetch=(input,options)=>{
    const url=typeof input==='string'?input:input?.url;
    if(typeof url==='string'&&/\\/api\\/games\\/1\\/review$/.test(url)&&options?.method==='POST'){
     window.__qaUnexpectedNormalAbortBypass++;
     return original(input,{...options,signal:undefined});
    }
    return original(input,options);
   };
  })();`});
 }

 // Test 1 — navigating within the actual authenticated SPA should unmount
 // GameReportPanel and invoke its AbortController cleanup.
 const navHeld=await startActualReview(1);
 const unexpectedBypass=injectedFault==='disable-navigation-abort'
  ? await browser.evalJs('window.__qaUnexpectedNormalAbortBypass') : 0;
 await browser.click('a[href="/review"]');
 await browser.wait('location.pathname === "/review"','navigated_from_game_to_library',8000);
 const navigateResult=await checkModelAfterNavigate(navHeld,1,false);
 events.scenarios.push({scenario:'real_internal_navigation',...navigateResult,
  browser_path:await browser.evalJs('location.pathname'),
  test_only_unexpected_abort_bypass_count:unexpectedBypass});

 // Test 2 — the actual Cancel generation button must abort the same SSE
 // while staying on the Game Report tab. A dismissed spinner alone is not
 // proof that its backend model computation was canceled.
 const cancelHeld=await startActualReview(4);
 const cancelClicked=await browser.evalJs(`(() => {
  const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Cancel generation'));
  if(!b)return false;b.click();return true;
 })()`);
 assert.equal(cancelClicked,true,'real Cancel generation control missing');
 await browser.wait('!!document.querySelector("[role=alert]")?.textContent?.includes("cancelled")',
  'manual_cancel_message',8000);
 const cancelResult=await checkModelAfterNavigate(cancelHeld,4,false);
 events.scenarios.push({scenario:'real_cancel_generation_button',...cancelResult,
  browser_path:await browser.evalJs('location.pathname'),
  cancellation_alert_visible:await browser.evalJs(
   '!!document.querySelector("[role=alert]")?.textContent?.includes("cancelled")')});

 // Test 3 — real navigation-shell logout clears session and unmounts report.
 const logoutHeld=await startActualReview(2);
 await browser.click('button[aria-label="Log out"]');
 await browser.wait('location.pathname === "/login"', 'real_logout_login_routing',12000);
 const revoked=db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=1').get().n;
 const logoutResult=await checkModelAfterNavigate(logoutHeld,2,false);
 events.scenarios.push({scenario:'real_layout_logout',...logoutResult,
  session_rows_after_logout:revoked,
  browser_path:await browser.evalJs('location.pathname')});
 assert.equal(revoked,0,'real browser logout did not revoke session');

 // Test 4 — negative control: fresh login and test-only browser request wrapper
 // discard ONLY the report POST AbortSignal. Navigating should now leave an
 // actual pending fetch/producer. No production source is changed.
 signed=createSession(1);
 await browser.send('Network.setCookie',{url:origin,name:'chess_session',value:signed,path:'/',
  sameSite:'Lax',httpOnly:true});
 await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`(() => {
  const original=window.fetch.bind(window);
  window.__qaReportAbortBypass=0;
  window.fetch=(input,opts)=>{
   const url=typeof input==='string'?input:input?.url;
   if(typeof url==='string'&&/\\/api\\/games\\/\\d+\\/review$/.test(url)&&opts?.method==='POST'){
    window.__qaReportAbortBypass++;
    return original(input,{...opts,signal:undefined});
   }
   return original(input,opts);
  };
})();`});
 const faultyHeld=await startActualReview(3);
 const injected=await browser.evalJs('window.__qaReportAbortBypass');
 assert.equal(injected,1,'test-only browser fault was not applied to report POST');
 await browser.click('a[href="/review"]');
 await browser.wait('location.pathname === "/review"','faulty_browser_internal_navigation',8000);
 const faultyResult=await checkModelAfterNavigate(faultyHeld,3,true);
 events.scenarios.push({scenario:'qa_only_removed_fetch_abort_signal',...faultyResult,
  browser_path:await browser.evalJs('location.pathname'),
  test_only_abort_bypass_count:injected});
 events.chromeVersion=execFileSync(args.chrome||'/usr/bin/google-chrome',['--version'],{encoding:'utf8'}).trim();
 events.product_sha=productSha;events.backend_sha=backendSha;
 events.network_review_requests=browser.events.filter(x=>
  x.method==='Network.requestWillBeSent'&&/\/api\/games\/\d+\/review/.test(x.params?.request?.url||''))
  .map(x=>({method:x.params.request.method,url:new URL(x.params.request.url).pathname,
   requestId:x.params.requestId}));
 const reviewRequestIds=new Set(events.network_review_requests.filter(x=>x.method==='POST')
  .map(x=>x.requestId));
 events.network_report_failures=browser.events.filter(x=>x.method==='Network.loadingFailed'
  &&reviewRequestIds.has(x.params.requestId)).map(x=>({
   canceled:x.params.canceled??false,errorText:x.params.errorText,
  }));
 events.browser_exceptions=browser.events.filter(x=>x.method==='Runtime.exceptionThrown')
  .map(x=>x.params.exceptionDetails?.text||'exception');
 events.model_posts=model.posts;
 events.model_closed=model.closed;
 events.model_errors=model.errors;
 events.localhost_vite_port=vitePort;
 events.localhost_api_port=apiPort;
 // A benchmark must fail closed when the correct browser stops aborting.
 // Showing that the report tab disappeared is NOT sufficient evidence.
 const [navigate,cancel,logout,broken]=events.scenarios;
 assert.equal(events.scenarios.length,4);
 for(const ordinary of [navigate,cancel,logout]){
  assert.equal(ordinary.provider_closed_before_release,true,
   ordinary.scenario+': the real model request stayed active');
  assert.equal(ordinary.provider_response_sent_after_navigation,false,
   ordinary.scenario+': provider still accepted a response after navigation');
  assert.equal(ordinary.cached_after_release,false,
   ordinary.scenario+': old report was cached after UI unmounted');
 }
 assert.equal(navigate.browser_path,'/review');
 assert.equal(cancel.browser_path,'/review/4');
 assert.equal(cancel.cancellation_alert_visible,true);
 assert.equal(logout.browser_path,'/login');
 assert.equal(logout.session_rows_after_logout,0);
 assert.equal(broken.test_only_abort_bypass_count,1);
 assert.equal(broken.provider_closed_before_release,false,
  'faulty request was already aborted; negative control ineffective');
 assert.equal(broken.provider_response_sent_after_navigation,true,
  'faulty browser did not preserve provider stream');
 assert.equal(broken.cached_after_release,true,
  'faulty browser did not cause real after-navigation cache persistence');
 assert.deepEqual(events.model_posts.map(x=>x.stage),
  ['phase','moment','summary','phase','moment','summary',
   'phase','moment','summary','phase','moment','summary']);
 assert.equal(new Set(events.model_closed).size,12);
 assert.deepEqual(events.model_errors,[]);
 assert.deepEqual(events.network_review_requests.filter(x=>x.method==='POST')
  .map(x=>x.url),['/api/games/1/review','/api/games/4/review',
   '/api/games/2/review','/api/games/3/review']);
 assert.deepEqual(events.browser_exceptions,[],
  'real React app threw during Chrome exercise');
}catch(error){
 experimentError=error instanceof Error?error.stack||error.message:String(error);
}finally{
 if(browser)await browser.dispose().catch(()=>{});
 if(vite)await within(vite.close(),3000,'vite_close').catch(()=>{});
 process.chdir(originalCwd);
 if(server){server.closeAllConnections();await within(new Promise(ok=>server.close(ok)),2000,'api_close').catch(()=>{});}
 if(db){try{db.close();}catch{}}
 llm.closeAllConnections();
 await within(new Promise(ok=>llm.close(ok)),1700,'model_close').catch(()=>{});
 rmSync(scratch,{recursive:true,force:true});
}
const packet={schema_version:1,at_utc:new Date().toISOString(),
 benchmark_run_id:runId,test_only_browser_fault:injectedFault,
 candidate_backend_sha:backendSha,candidate_product_sha:productSha,
 manifest_sha256:sha(manifest),fixture_id:entry.fixture_id,stockfish_sha256:engineHash,
 chrome:events.chromeVersion,
 source:'actual React GameAnalyzer + Layout/GameReportPanel in isolated Chrome, real Hono routes, Vite proxy, fake local LLM',
 observations:events,elapsed_ms:Date.now()-started,
 qa_verdict:experimentError?'fail':'pass',
 qa_error:experimentError,
 real_browser_test_executed:true,disposable_user_data_only:true,
 product_release_approved:false,full_browser_security_certified:false,
 limitations:['Chrome CDP is real headless Chromium; no Playwright tests or remote browser login',
  'Only a local Vite proxy and Hono route subset; not the complete production reverse proxy',
  'One four-ply self-authored PGN reused for four test-only game rows',
  'LLM final response is held artificially; real provider and performance distribution are not covered']};
const output=join(results,injectedFault
 ? 'review-browser-abort-fault.json':'review-browser-abort.json');
writeFileSync(output,JSON.stringify(packet,null,2)+'\n');
console.log(JSON.stringify({output,benchmark_run_id:runId,chrome:events.chromeVersion,results:events.scenarios,
  model_posts:events.model_posts,network_failures:events.network_report_failures,
  elapsed_ms:packet.elapsed_ms,qa_verdict:packet.qa_verdict,
  error:experimentError,release_approved:false},null,2));
if(experimentError)process.exitCode=1;
