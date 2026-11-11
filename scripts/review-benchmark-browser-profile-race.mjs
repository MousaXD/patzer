#!/usr/bin/env node
/** Agent D: independent second authenticated session changes a profile while
 * first session's REAL Chrome React Game Report SSE is awaiting final model.
 * Bounded, pinned candidate source, self-authored PGN, disposable SQLite.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {createServer as tcpServer} from 'node:net';
import {realpathSync,mkdtempSync,rmSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Hono} from 'hono';
import {serve} from '@hono/node-server';
import {createServer as createViteServer} from 'vite';
import {Chess} from 'chess.js';
import {launchBrowser,within,until} from './review-benchmark-cdp.mjs';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence'),results=join(qa,'results');mkdirSync(results,{recursive:true});
const args=Object.fromEntries(process.argv.slice(2).map(x=>{
 const p=x.indexOf('=');return p<0?[x.slice(2),true]:[x.slice(2,p),x.slice(p+1)];
}));
const runId=args['run-id']||randomUUID();
assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId));
assert(!args.fault||args.fault==='serve-stale-cache',
 'unsupported test-only guard fault');
const product=realpathSync(args['product-root']||join(results,'worktree-product-browser'));
const backend=realpathSync(args['backend-root']||join(results,'worktree-coach'));
const engine=realpathSync(args.engine||join(results,'engine/unpacked/usr/games/stockfish'));
const productSha='d72eaced6972c8a2ec7d8581365c45788b15a29a';
const backendSha='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const engineSha='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const manifestSha='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
const digest=x=>createHash('sha256').update(x).digest('hex');
const rev=dir=>execFileSync('git',['rev-parse','HEAD'],{cwd:dir,encoding:'utf8'}).trim();
assert.equal(rev(product),productSha);assert.equal(rev(backend),backendSha);
assert.equal(digest(readFileSync(engine)),engineSha);
const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8');
assert.equal(digest(manifest),manifestSha);
const fixture=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.source_kind==='synthetic'&&fixture.license==='self-authored');
const pgn=readFileSync(join(qa,'fixtures',fixture.pgn_file),'utf8');
assert.equal(digest(pgn),fixture.pgn_sha256);
const chess=new Chess();chess.loadPgn(pgn,{strict:true});assert(chess.isCheckmate()&&chess.turn()==='w');

const scratch=mkdtempSync(join(results,'chrome-profile-race-'));
process.env.DB_PATH=join(scratch,'disposable-only.db');
process.env.SESSION_SECRET='qa-disposable-two-session-signature';
process.env.ENGINE_BACKEND='local';process.env.STOCKFISH_PATH=engine;
process.env.STOCKFISH_THREADS='1';process.env.STOCKFISH_HASH='16';
process.env.OIDC_ENABLED='false';process.env.UPDATE_CHECK_ENABLED='false';

const en='Black won the game.';
const es='Las negras ganaron la partida.';
const provider={calls:[],closed:[],errors:[],held:[],modelResponses:[]};
const mock=createServer((req,res)=>{
 if(req.method==='GET'&&req.url==='/v1/models'){
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({data:[{id:'qa-two-session-model'}]}));return;
 }
 if(req.method!=='POST'||req.url!=='/v1/chat/completions'){
  res.writeHead(404).end();return;
 }
 let data='';req.on('data',c=>{data+=c;if(data.length>100000)req.destroy();});
 req.on('end',()=>{
  try{
   const parsed=JSON.parse(data);assert.equal(parsed.model,'qa-two-session-model');
   const prompt=parsed.messages?.find(x=>x.role==='user')?.content||'';
   assert.equal(typeof prompt,'string');
   // Patzer localizes the JSON schema label too: English "Schema" versus
   // Spanish "Esquema". The previous mock accidentally classified a genuine
   // Spanish summary request as a phase and allowed it to complete unheld.
   // Match the actual *JSON output schema* rather than an English word.
   const stage=/(?:Schema|Esquema):\s*\{\s*"summary"/.test(prompt)?'summary':
    prompt.includes('"what_happened"')?'moment':'phase';
   const lang=/"lang"\s*:\s*"es"/.test(prompt)?'es':'en';
   const audience=/"audience"\s*:\s*"advanced"/.test(prompt)?'advanced':'beginner';
   const id=provider.calls.length+1;
   const rec={res,id,stage,lang,audience};
   provider.calls.push({id,stage,lang,audience});
   res.on('close',()=>provider.closed.push(id));
   if(stage==='summary')provider.held.push(rec);
   else answer(rec);
  }catch(error){provider.errors.push(String(error));res.writeHead(500).end(String(error));}
 });
});
function answer(rec){
 if(rec.res.destroyed)return false;
 const localized=rec.lang==='es';
 const value={title:localized?'Momento de la partida':'Recorded move',
  prose:localized?'Revisa las jugadas de la partida.':'Review the recorded moves.',
  what_happened:localized?'Revisa las jugadas de la partida.':'Review the recorded moves.',
  why_it_matters:localized?'Verifica las amenazas.':'Verify threats.',
  what_to_learn:localized?'Comprueba las alternativas.':'Check the alternatives.',
  summary:localized?es:en,
  skill_assessment:localized?'Una partida no demuestra tu nivel.':'A single game does not establish your rating.',
  opening_prose:localized?'La apertura fue registrada.':'The opening was recorded.'};
 rec.res.writeHead(200,{'content-type':'application/json'});
 rec.res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}]}));
 provider.modelResponses.push({id:rec.id,stage:rec.stage,lang:rec.lang,summary:value.summary});
 return true;
}
async function localPort(){
 const s=tcpServer();
 await within(new Promise((ok,fail)=>{s.once('error',fail);s.listen(0,'127.0.0.1',ok);}),1600,'port_open');
 const port=s.address().port;await within(new Promise(ok=>s.close(ok)),1300,'port_close');
 return port;
}

let db=null,server=null,vite=null,browser=null,apiPort=0,vitePort=0;
const oldCwd=process.cwd(),started=Date.now();
const outcomes={};let error=null;
const cache=id=>db.prepare('SELECT prose_json,prose_lang,prose_audience FROM analyses WHERE game_id=?').get(id);
const currentProfile=()=>db.prepare('SELECT language,audience FROM profiles WHERE user_id=1').get();
const reviewSummary=id=>cache(id)?.prose_json?JSON.parse(cache(id).prose_json).summary:null;
try{
 await within(new Promise((ok,fail)=>{mock.once('error',fail);mock.listen(0,'127.0.0.1',ok);}),1400,'mock_start');
 const {db:database,setSetting}=await import(join(backend,'server/src/db.ts'));db=database;
 setSetting('llm_provider','vllm');setSetting('vllm_model','qa-two-session-model');
 setSetting('vllm_url','http://127.0.0.1:'+mock.address().port);
 const {analyzePgn,saveAnalysis}=await import(join(backend,'server/src/routes/analyze.ts'));
 const {createSession}=await import(join(backend,'server/src/auth/sessions.ts'));
 const routes={
  setup:(await import(join(backend,'server/src/routes/setup.ts'))).default,
  auth:(await import(join(backend,'server/src/routes/auth.ts'))).default,
  games:(await import(join(backend,'server/src/routes/games.ts'))).default,
  review:(await import(join(backend,'server/src/routes/review.ts'))).default,
  coach:(await import(join(backend,'server/src/routes/coach.ts'))).default,
  meta:(await import(join(backend,'server/src/routes/meta.ts'))).default,
  settings:(await import(join(backend,'server/src/routes/settings.ts'))).default,
 };
 db.prepare('INSERT INTO users(id,username,password_hash,role) VALUES(?,?,?,?)')
  .run(1,'qa-two-session-user','fake-password-hash','admin');
 db.prepare('INSERT INTO profiles(user_id,display_name,language,audience) VALUES(?,?,?,?)')
  .run(1,'Test two session','en','beginner');
 const analysis=await analyzePgn(pgn,8);
 for(const gameId of [1,2,3]){
  db.prepare('INSERT INTO games(id,user_id,source,pgn,user_color,white,black,result) VALUES(?,?,?,?,?,?,?,?)')
   .run(gameId,1,'imported',pgn,'white','Synthetic White','Synthetic Black','0-1');
  saveAnalysis(gameId,analysis);
 }
 const app=new Hono();
 app.use('/api/*',async(c,next)=>{
  if(!['GET','HEAD'].includes(c.req.method)&&c.req.header('X-Requested-With')!=='patzer')
   return c.json({error:'csrf_required'},403);
  await next();
 });
 // Negative control belongs ONLY to this QA host. After the second signed
 // session changes the user's server-side language, deliberately issue a
 // wrong-language cached GET 200 instead of the real route's stale result.
 // This must make the browser-profile provenance benchmark fail, rather
 // than becoming a green test because the UI happens to render content.
 if(args.fault==='serve-stale-cache'){
  app.use('/api/games/2/review',async(c,next)=>{
   if(c.req.method==='GET'&&currentProfile().language==='es'){
    const stored=cache(2).prose_json;
    if(stored){
     outcomes.bad_http_cache_get_injected=(outcomes.bad_http_cache_get_injected||0)+1;
     return c.json({review:JSON.parse(stored)},200);
    }
   }
   await next();
  });
 }
 app.get('/api/meta/update',c=>c.json({enabled:false,updateAvailable:false}));
 for(const [path,route] of Object.entries(routes))app.route('/api/'+(path==='review'?'games':path),route);
 server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0});
 await within(new Promise((ok,fail)=>{server.once('listening',ok);server.once('error',fail);}),1500,'api_start');
 apiPort=server.address().port;
 process.env.PORT=String(apiPort);process.chdir(join(product,'web'));
 const chosen=await localPort();
 vite=await createViteServer({root:join(product,'web'),configFile:join(product,'web/vite.config.ts'),
  server:{host:'127.0.0.1',port:chosen,strictPort:true,hmr:false,
   proxy:{'/api':{target:'http://127.0.0.1:'+apiPort,changeOrigin:true}}},logLevel:'error'});
 await within(vite.listen(),12000,'vite_start');vitePort=vite.httpServer.address().port;
 assert.equal(vitePort,chosen);
 browser=await launchBrowser({chromeBinary:args.chrome||'/usr/bin/google-chrome',
  profileDir:join(scratch,'qa-browser-profile')});
 const sessionBrowser=createSession(1),sessionOther=createSession(1);
 assert.notEqual(sessionBrowser,sessionOther);
 outcomes.distinct_signed_sessions=true;
 outcomes.signed_session_count=db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=1').get().n;
 assert.equal(outcomes.signed_session_count,2);
 const origin='http://127.0.0.1:'+vitePort;
 await browser.send('Network.setCookie',{url:origin,name:'chess_session',
  value:sessionBrowser,httpOnly:true,path:'/',sameSite:'Lax'});
 const otherHeaders={Cookie:'chess_session='+sessionOther,'Content-Type':'application/json',
  'X-Requested-With':'patzer'};
 const getOther=async gameId=>{
  const response=await within(fetch('http://127.0.0.1:'+apiPort+'/api/games/'+gameId+'/review',{
   headers:otherHeaders}),3000,'authenticated_get');
  return {status:response.status,body:await response.json()};
 };
 const patchOther=async profile=>{
  const response=await within(fetch('http://127.0.0.1:'+apiPort+'/api/settings/profile',{
   method:'PATCH',headers:otherHeaders,body:JSON.stringify(profile)}),2800,'real_settings_patch');
  const result=await response.json();
  return {status:response.status,profile:result.profile?{
   language:result.profile.language,audience:result.profile.audience}:null};
 };
 const startReview=async gameId=>{
  await browser.go(origin+'/review/'+gameId);
  await browser.wait('location.pathname === "/review/'+gameId+'" && !!document.querySelector("#review-tab-report")',
   'real_browser_analyzer_'+gameId,20000);
  await browser.click('#review-tab-report');
  if(gameId===2&&outcomes.changed){
   outcomes.after_reload_old_summary_visible=await browser.evalJs(
    'document.body.innerText.includes("Black won the game.")');
   outcomes.after_reload_document_language=await browser.evalJs('document.documentElement.lang');
   assert.equal(outcomes.after_reload_old_summary_visible,false,
    'stale_cached_prose_still_visible_after_profile_reload');
  }
  await browser.wait('!![...document.querySelectorAll("button")].find(x=>x.textContent.includes("Write AI report")||x.textContent.includes("informe"))',
   'write_button_'+gameId,8000);
  const before=provider.held.length;
  const clicked=await browser.evalJs(`(() => {
   const b=[...document.querySelectorAll('button')].find(x=>
    x.textContent.includes('Write AI report')||x.textContent.includes('informe'));
   if(!b)return false;b.click();return true;
  })()`);
  assert.equal(clicked,true);
  await until(()=>provider.held.length>before,'model_summary_'+gameId,11000);
  return provider.held.at(-1);
 };

 // Positive control: second authenticated session PATCHes SAME preferences.
 const first=await startReview(1);
 assert.equal(reviewSummary(1),null);
 const same=await patchOther({language:'en',audience:'beginner'});
 assert.equal(same.status,200);assert.deepEqual(same.profile,{language:'en',audience:'beginner'});
 assert.equal(answer(first),true);
 await until(()=>reviewSummary(1)===en,'control_cache_written',4500);
 await browser.wait('document.body.innerText.includes("Black won the game.")','control_browser_render',4500);
 const controlGet=await getOther(1);
 outcomes.unchanged={settings_status:same.status,settings_profile:same.profile,
  cache_language:cache(1).prose_lang,cache_audience:cache(1).prose_audience,
  cached_summary:reviewSummary(1),get_status:controlGet.status,
  get_summary:controlGet.body.review?.summary??null,
  get_stale:controlGet.body.stale??false,
  browser_renders_summary:await browser.evalJs('document.body.innerText.includes("Black won the game.")')};

 // The active Chrome tab remains at an English GameReportPanel. A SECOND
 // independently signed session changes the actual source-of-truth profile
 // while the first browser's final model response remains held.
 const pending=await startReview(2);
 assert.equal(reviewSummary(2),null);
 const currentAtAdmission=structuredClone(currentProfile());
 const altered=await patchOther({language:'es',audience:'advanced'});
 assert.equal(altered.status,200);assert.deepEqual(altered.profile,{language:'es',audience:'advanced'});
 assert.deepEqual(currentProfile(),{language:'es',audience:'advanced'});
 assert.equal(answer(pending),true);
 await until(()=>reviewSummary(2)===en,'stale_cache_written',5000);
 await browser.wait('document.body.innerText.includes("Black won the game.")',
  'browser_stale_report_visible',5000);
 const staleGet=await getOther(2);
 const staleRow=cache(2);
 const queue=db.prepare('SELECT COUNT(*) AS n FROM analyses WHERE game_id=2 AND prose_json IS NULL').get().n;
 outcomes.changed={source_profile_at_start:currentAtAdmission,
  settings_status:altered.status,new_profile:altered.profile,
  cached_summary:reviewSummary(2),cached_language:staleRow.prose_lang,
  cached_audience:staleRow.prose_audience,
  browser_renders_old_summary:await browser.evalJs('document.body.innerText.includes("Black won the game.")'),
  browser_path:await browser.evalJs('location.pathname'),
  fresh_get_status:staleGet.status,stale_get_review:staleGet.body.review??null,
  fresh_get_stale:staleGet.body.stale??false,
  auto_review_queue_pending:queue};
 assert.equal(staleGet.status,200);
 assert(staleGet.body.review===null&&staleGet.body.stale===true,
  'stale_profile_cache_served_over_real_HTTP');
 assert.equal(queue,0);
 assert.equal(outcomes.changed.fresh_get_stale,true,
  'stale_profile_cache_served_over_real_HTTP');

 // Recovery: refresh the authenticated first browser so its locale/profile
 // store updates. The backend GET now refuses the old cached review; a new
 // request should generate a Spanish/advanced report without a second user.
 const recovery=await startReview(2);
 assert.equal(recovery.lang,'es','fresh real model FACTS were not Spanish');
 assert.equal(recovery.audience,'advanced','fresh model FACTS did not honor audience');
 assert.equal(answer(recovery),true);
 await until(()=>reviewSummary(2)===es,'manual_profile_recovery',5000);
 await browser.wait('document.body.innerText.includes("Las negras ganaron la partida.")',
  'browser_spanish_recovery_visible',5500);
 const recoveredGet=await getOther(2);
 outcomes.recovery={model_language:recovery.lang,model_audience:recovery.audience,
  cached_summary:reviewSummary(2),cache_language:cache(2).prose_lang,
  cache_audience:cache(2).prose_audience,
  recovered_get_status:recoveredGet.status,
  recovered_get_summary:recoveredGet.body.review?.summary??null,
  recovered_get_stale:recoveredGet.body.stale??false,
  browser_renders_spanish:await browser.evalJs('document.body.innerText.includes("Las negras ganaron la partida.")'),
  spanish_navigation_visible:await browser.evalJs('document.body.innerText.includes("Inicio")'),
  document_declared_language:await browser.evalJs('document.documentElement.lang')};
 assert.equal(outcomes.recovery.recovered_get_stale,false);
 assert.equal(outcomes.recovery.recovered_get_summary,es);
 assert.equal(outcomes.recovery.cached_summary,es);
 assert.equal(outcomes.recovery.spanish_navigation_visible,true,
  'the React UI is not actually showing the Spanish language');
 assert.equal(outcomes.recovery.document_declared_language,'en',
  'document language was updated and the suspected accessibility mismatch is absent');

 outcomes.model_requests=provider.calls;
 outcomes.model_responses=provider.modelResponses;
 outcomes.model_closed=provider.closed;
 outcomes.model_errors=provider.errors;
 outcomes.browser_post_requests=browser.events.filter(x=>x.method==='Network.requestWillBeSent'
  &&x.params?.request?.method==='POST'&&/\/api\/games\/[12]\/review$/.test(x.params.request.url))
  .map(x=>({id:x.params.requestId,url:new URL(x.params.request.url).pathname}));
 outcomes.browser_exceptions=browser.events.filter(x=>x.method==='Runtime.exceptionThrown')
  .map(x=>x.params.exceptionDetails?.text||'browser exception');
 outcomes.chrome_version=execFileSync(args.chrome||'/usr/bin/google-chrome',['--version'],{encoding:'utf8'}).trim();
 assert.equal(provider.calls.length,9);
 assert.equal(provider.closed.length,9);
 assert.deepEqual(provider.errors,[]);
 assert.deepEqual(outcomes.browser_exceptions,[]);
 assert.deepEqual(outcomes.model_requests.map(x=>x.stage),
  ['phase','moment','summary','phase','moment','summary','phase','moment','summary']);
 assert.equal(outcomes.browser_post_requests.length,3);
 assert.equal(new Set(outcomes.browser_post_requests.map(x=>x.id)).size,3);
 assert.equal(outcomes.unchanged.get_stale,false);
 assert.equal(outcomes.changed.browser_renders_old_summary,true);
 assert.equal(outcomes.changed.fresh_get_stale,true);
 assert.equal(outcomes.after_reload_old_summary_visible,false);
 assert.equal(outcomes.distinct_signed_sessions,true);
}catch(e){error=e instanceof Error?e.stack||e.message:String(e);
 try{
  outcomes.debug={provider_calls:provider.calls,provider_held:provider.held.map(x=>({stage:x.stage,lang:x.lang,audience:x.audience})),
   provider_errors:provider.errors,
   browser_state:browser?await browser.evalJs(`({path:location.pathname,
    buttons:[...document.querySelectorAll('button')].map(x=>({text:x.textContent,disabled:x.disabled})),
    main:document.body.innerText.slice(0,1200)})`):null,
   chrome_posts:browser?.events.filter(x=>x.method==='Network.requestWillBeSent'
    &&x.params?.request?.method==='POST'&&/\/api\/games\/2\/review$/.test(x.params.request.url))
    .map(x=>({id:x.params.requestId,url:x.params.request.url})),
   chrome_failed:browser?.events.filter(x=>x.method==='Network.loadingFailed').slice(-8)};
 }catch(diagnosticError){outcomes.debug_error=String(diagnosticError);}
}finally{
 if(browser)await browser.dispose().catch(()=>{});
 if(vite)await within(vite.close(),3200,'vite_close').catch(()=>{});
 process.chdir(oldCwd);
 if(server){server.closeAllConnections();await within(new Promise(ok=>server.close(ok)),1800,'api_close').catch(()=>{});}
 try{db?.close();}catch{}
 for(const rec of provider.held){if(!rec.res.destroyed)try{answer(rec);}catch{}}
 mock.closeAllConnections();await within(new Promise(ok=>mock.close(ok)),1700,'mock_close').catch(()=>{});
 rmSync(scratch,{recursive:true,force:true});
}

const packet={schema_version:1,at_utc:new Date().toISOString(),run_id:runId,
 product_sha:productSha,backend_sha:backendSha,engine_sha256:engineSha,
 manifest_sha256:manifestSha,fixture_id:fixture.fixture_id,
 test_only_fault:args.fault||null,
 qa_status:error?'fail':'pass',qa_error:error,
 product_gate_passed:false,verified_defect_expected:args.fault===undefined,
 scenarios:outcomes,elapsed_ms:Date.now()-started,
 simulated_second_session:true,live_authenticated_settings_route:true,
 synthetic_only:true,disposable_sqlite_only:true,release_approved:false,
 product_fully_certified:false,
 limits:['Isolated Chrome 157 plus actual React + Hono via Vite development proxy',
  'Second authenticated session is synthetic and profile PATCH is real, not browser Settings page click',
  'Only one synthetic four-ply game cloned across local game IDs',
  'No production login, private game histories, external model, production performance or sealed holdout']};
const output=join(results,args.fault?
 'review-browser-profile-race-fault.json':'review-browser-profile-race.json');
writeFileSync(output,JSON.stringify(packet,null,2)+'\n');
console.log(JSON.stringify({output,run_id:runId,qa_status:packet.qa_status,
  scenarios:outcomes,qa_error:error,release_approved:false},null,2));
if(error)process.exitCode=1;
