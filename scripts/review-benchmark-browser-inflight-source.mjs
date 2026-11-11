#!/usr/bin/env node
/** Agent D. Real Chrome + React + Hono SSE + SQLite CAS. Hold a genuine
 * backend AI model-summary request while the SAME game changes its PGN and
 * its stored engine analysis, then verify old work is not canceled by the
 * browser but that the backend refuses to save/stream an obsolete report.
 * Only self-authored PGNs; local fake LLM; 2 bounded Stockfish searches. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createServer as tcpServer} from 'node:net';
import {realpathSync,mkdtempSync,readFileSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Chess} from 'chess.js';
import {Hono} from 'hono';
import {serve} from '@hono/node-server';
import {createServer as createViteServer} from 'vite';
import {launchBrowser,within,until} from './review-benchmark-cdp.mjs';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const results=join(qa,'results');mkdirSync(results,{recursive:true});
const cli=Object.fromEntries(process.argv.slice(2).map(s=>{
 const at=s.indexOf('=');return at<0?[s.slice(2),true]:[s.slice(2,at),s.slice(at+1)];
}));
assert(Object.keys(cli).every(x=>['run-id','fault','chrome'].includes(x)));
const fault=cli.fault??null;
assert(fault===null||fault==='abort-after-source-change','unsupported QA-only fault');
const runId=cli['run-id']||randomUUID();
assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(runId));
const product=realpathSync(join(results,'worktree-product-browser'));
const backend=realpathSync(join(results,'worktree-coach'));
const engine=realpathSync(join(results,'engine/unpacked/usr/games/stockfish'));
const productSHA='d72eaced6972c8a2ec7d8581365c45788b15a29a';
const backendSHA='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const engineSHA='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const manifestSHA='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
const hash=x=>createHash('sha256').update(x).digest('hex');
const gitHead=dir=>execFileSync('git',['rev-parse','HEAD'],{cwd:dir,encoding:'utf8'}).trim();
assert.equal(gitHead(product),productSHA);assert.equal(gitHead(backend),backendSHA);
assert.equal(hash(readFileSync(engine)),engineSHA);
const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8');
assert.equal(hash(manifest),manifestSHA);
const fixture=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.source_kind==='synthetic'&&fixture.license==='self-authored');
const firstPgn=readFileSync(join(qa,'fixtures',fixture.pgn_file),'utf8');
assert.equal(hash(firstPgn),fixture.pgn_sha256);
const firstChess=new Chess();firstChess.loadPgn(firstPgn,{strict:true});
assert.equal(firstChess.history().length,4);assert(firstChess.isCheckmate()&&firstChess.turn()==='w');
const secondChess=new Chess();
for(const san of ['e4','e5','Qh5','Nc6','Bc4','Nf6','Qxf7#'])secondChess.move(san);
secondChess.header('Event','QA Source Update During Model');
secondChess.header('Result','1-0');
const secondPgn=secondChess.pgn();
assert(secondChess.isCheckmate()&&secondChess.turn()==='b'&&secondChess.history().length===7);
assert.notEqual(hash(firstPgn),hash(secondPgn));

const scratch=mkdtempSync(join(results,'browser-inflight-source-'));
process.env.DB_PATH=join(scratch,'qa-only.sqlite');
process.env.SESSION_SECRET='qa-inflight-source-synthetic-only';
process.env.OIDC_ENABLED='false';process.env.UPDATE_CHECK_ENABLED='false';
process.env.ENGINE_BACKEND='local';process.env.STOCKFISH_PATH=engine;
process.env.STOCKFISH_THREADS='1';process.env.STOCKFISH_HASH='16';
const began=Date.now(),oldCwd=process.cwd();
let db=null,api=null,vite=null,browser=null,apiPort=0,vitePort=0,error=null;
const provider={calls:[],sent:[],closed:[],errors:[],held:[]};
const good='QA_CONTROL_BLACK_WON';
const obsolete='QA_OLD_BLACK_WON_AFTER_SOURCE_CHANGED';
const mock=createServer((req,res)=>{
 if(req.method==='GET'&&req.url==='/v1/models'){
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({data:[{id:'qa-model-inflight-source'}]}));return;
 }
 if(req.method!=='POST'||req.url!=='/v1/chat/completions'){
  res.writeHead(404).end();return;
 }
 let data='';req.on('data',part=>{data+=part;if(data.length>100000)req.destroy();});
 req.on('end',()=>{
  try{
   const body=JSON.parse(data);
   assert.equal(body.model,'qa-model-inflight-source');
   const prompt=body.messages?.find(x=>x.role==='user')?.content||'';
   assert.equal(typeof prompt,'string');
   const stage=/(?:Schema|Esquema):\s*\{\s*"summary"/.test(prompt)?'summary':
    prompt.includes('"what_happened"')?'moment':'phase';
   const rec={id:provider.calls.length+1,stage,res};
   provider.calls.push({id:rec.id,stage});
   res.on('close',()=>provider.closed.push(rec.id));
   if(stage==='summary')provider.held.push(rec);
   else respond(rec,good);
  }catch(e){provider.errors.push(String(e));res.writeHead(500).end(String(e));}
 });
});
function respond(rec,summary){
 if(rec.res.destroyed)return false;
 const v={title:'Synthetic legal moment',prose:'Review the recorded moves.',
  what_happened:'Review the moves.',why_it_matters:'Check threats.',
  what_to_learn:'Verify legal variations.',summary,
  skill_assessment:'One game does not prove a rating.',
  opening_prose:'The opening was recorded.'};
 rec.res.writeHead(200,{'content-type':'application/json'});
 rec.res.end(JSON.stringify({choices:[{finish_reason:'stop',
  message:{role:'assistant',content:JSON.stringify(v)}}]}));
 provider.sent.push({id:rec.id,stage:rec.stage,summary});return true;
}
async function freePort(){
 const s=tcpServer();
 await within(new Promise((ok,fail)=>{s.once('error',fail);s.listen(0,'127.0.0.1',ok);}),1800,'port_bind');
 const p=s.address().port;
 await within(new Promise(ok=>s.close(ok)),1300,'port_close');return p;
}
const observations={};
const cache=(id)=>db.prepare('SELECT prose_json FROM analyses WHERE game_id=?').get(id)?.prose_json??null;
const browserState=()=>browser.evalJs(`({path:location.pathname,
 moveCount:document.querySelector('[data-move-transport]')?.innerText??null,
 reportTab:document.querySelector('#review-tab-report')?.getAttribute('aria-selected')??null,
 progress:document.body.innerText.includes('Writing AI report'),
 error:document.querySelector('[role=alert]')?.innerText??null,
 canceled:document.body.innerText.includes('Report generation cancelled'),
 hasOld:document.body.innerText.includes(${JSON.stringify(obsolete)}),
 hasGood:document.body.innerText.includes(${JSON.stringify(good)}),
 writeButton:[...document.querySelectorAll('button')].some(x=>x.textContent.includes('Write AI report'))})`);
const getIds=()=>browser.events.filter(x=>x.method==='Network.requestWillBeSent'&&
 x.params?.request?.method==='GET'&&
 /\/api\/games\/2(?:\?.*)?$/.test(x.params?.request?.url||''))
 .map(x=>x.params.requestId);
const postIds=()=>browser.events.filter(x=>x.method==='Network.requestWillBeSent'&&
 x.params?.request?.method==='POST'&&
 /\/api\/games\/[12]\/review$/.test(x.params?.request?.url||''))
 .map(x=>({id:x.params.requestId,url:new URL(x.params.request.url).pathname}));
async function getAsOwner(path,cookie){
 const response=await within(fetch('http://127.0.0.1:'+apiPort+path,
  {headers:{Cookie:'chess_session='+cookie}}),3000,'owner_get');
 return {status:response.status,body:await response.json()};
}
async function startReport(id,origin){
 await browser.go(origin+'/review/'+id);
 await browser.wait(`location.pathname === '/review/${id}' && !!document.querySelector('#review-tab-report')`,
  'chrome_game_analyzer_'+id,20000);
 await browser.click('#review-tab-report');
 await browser.wait(`!![...document.querySelectorAll('button')].find(x=>x.textContent.includes('Write AI report'))`,
  'chrome_write_ai_button_'+id,7500);
 const before=provider.held.length;
 const clicked=await browser.evalJs(`(() => {const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Write AI report'));if(!b)return false;b.click();return true;})()`);
 assert.equal(clicked,true);
 await until(()=>provider.held.length>before,'held_final_summary_'+id,12000);
 return provider.held.at(-1);
}
try{
 await within(new Promise((ok,fail)=>{mock.once('error',fail);mock.listen(0,'127.0.0.1',ok);}),1500,'model_mock_start');
 const {db:database,setSetting}=await import(join(backend,'server/src/db.ts'));db=database;
 setSetting('llm_provider','vllm');setSetting('vllm_model','qa-model-inflight-source');
 setSetting('vllm_url','http://127.0.0.1:'+mock.address().port);
 const {analyzePgn,saveAnalysis}=await import(join(backend,'server/src/routes/analyze.ts'));
 const {createSession}=await import(join(backend,'server/src/auth/sessions.ts'));
 const routes={setup:(await import(join(backend,'server/src/routes/setup.ts'))).default,
  auth:(await import(join(backend,'server/src/routes/auth.ts'))).default,
  games:(await import(join(backend,'server/src/routes/games.ts'))).default,
  review:(await import(join(backend,'server/src/routes/review.ts'))).default,
  coach:(await import(join(backend,'server/src/routes/coach.ts'))).default,
  meta:(await import(join(backend,'server/src/routes/meta.ts'))).default,
  settings:(await import(join(backend,'server/src/routes/settings.ts'))).default};
 db.prepare('INSERT INTO users(id,username,password_hash,role) VALUES(?,?,?,?)')
  .run(1,'qa-inflight-source-owner','qa-not-a-real-password','admin');
 db.prepare('INSERT INTO profiles(user_id,display_name,language,audience) VALUES(?,?,?,?)')
  .run(1,'QA Source','en','beginner');
 const initialAnalysis=await within(analyzePgn(firstPgn,8),20000,'initial_depth8_analysis');
 const changedAnalysis=await within(analyzePgn(secondPgn,8),20000,'new_depth8_analysis');
 for(const id of [1,2]){
  db.prepare('INSERT INTO games(id,user_id,source,pgn,user_color,white,black,result) VALUES(?,?,?,?,?,?,?,?)')
   .run(id,1,'pvp',firstPgn,'white','QA White','QA Black','0-1');
  saveAnalysis(id,initialAnalysis);
 }
 assert.equal(initialAnalysis.moves.length,4);assert.equal(changedAnalysis.moves.length,7);
 const app=new Hono();
 app.use('/api/*',async(c,next)=>{
  if(!['GET','HEAD'].includes(c.req.method)&&c.req.header('X-Requested-With')!=='patzer')
   return c.json({error:'csrf_required'},403);
  await next();
 });
 app.get('/api/meta/update',c=>c.json({enabled:false,updateAvailable:false}));
 for(const [path,route] of Object.entries(routes))
  app.route('/api/'+(path==='review'?'games':path),route);
 api=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0});
 await within(new Promise((ok,fail)=>{api.once('listening',ok);api.once('error',fail);}),1600,'api_start');
 apiPort=api.address().port;
 const cookie=createSession(1),originPort=await freePort();
 process.chdir(join(product,'web'));
 vite=await createViteServer({root:join(product,'web'),configFile:join(product,'web/vite.config.ts'),
  server:{host:'127.0.0.1',port:originPort,strictPort:true,hmr:false,
   proxy:{'/api':{target:'http://127.0.0.1:'+apiPort,changeOrigin:true}}},logLevel:'error'});
 await within(vite.listen(),12000,'vite_start');vitePort=vite.httpServer.address().port;
 const origin='http://127.0.0.1:'+vitePort;
 browser=await launchBrowser({chromeBinary:cli.chrome||'/usr/bin/google-chrome',
  profileDir:join(scratch,'qa-only-chrome')});
 await browser.send('Network.setCookie',{url:origin,name:'chess_session',value:cookie,
  httpOnly:true,path:'/',sameSite:'Lax'});
 // Control: identical game and analysis, release final answer after real SSE.
 const control=await startReport(1,origin);
 assert.equal(control.stage,'summary');assert.equal(cache(1),null);
 observations.control_before=await browserState();
 assert.equal(observations.control_before.progress,true);
 assert.equal(respond(control,good),true);
 await until(()=>cache(1)!==null,'control_report_saved',6000);
 await browser.wait(`document.body.innerText.includes(${JSON.stringify(good)})`,
  'control_report_browser_done',5500);
 const controlGet=await getAsOwner('/api/games/1/review',cookie);
 assert.equal(controlGet.status,200);
 assert.equal(controlGet.body.review.summary,good);
 observations.control={cached_summary:JSON.parse(cache(1)).summary,
  http_report_summary:controlGet.body.review.summary,
  ui:await browserState(),network_posts:postIds().length};

 // New game with old PGN. Hold its LAST model call and replace the source
 // plus analysis while the real frontend and Hono stream remain mounted.
 const held=await startReport(2,origin);
 assert.equal(held.stage,'summary');assert.equal(cache(2),null);
 const oldOpen=!held.res.destroyed;
 observations.before_change={old_model_response_still_open:oldOpen,
  old_model_id:held.id,ui:await browserState(),
  old_pgn_sha256:hash(firstPgn),old_plies:4};
 assert.equal(oldOpen,true);
 db.prepare('UPDATE games SET pgn=?,result=? WHERE id=2').run(secondPgn,'1-0');
 saveAnalysis(2,changedAnalysis);
 assert.equal(cache(2),null);
 const changedGet=await getAsOwner('/api/games/2',cookie);
 assert.equal(changedGet.status,200);
 assert.equal(changedGet.body.game.pgn,secondPgn);
 assert.equal(changedGet.body.analysis.moves_json,JSON.stringify(changedAnalysis.moves));
 const beforeFetch=getIds().length;
 assert.equal(await browser.evalJs(`(() => {const b=document.querySelector('[title="Toggle bookmark"]');if(!b)return false;b.click();return true;})()`),true);
 await until(()=>getIds().length>beforeFetch,'real_react_query_new_source_get',6500);
 await browser.wait(`document.querySelector('[data-move-transport]')?.innerText?.includes('/ 7')`,
  'same_game_board_refreshed_during_model_call',6500);
 const afterUpdate=await browserState();
 const heldStillOpen=!held.res.destroyed;
 observations.after_change={old_model_response_still_open:heldStillOpen,
  ui:afterUpdate,read_new_moves:afterUpdate.moveCount==='0 / 7',
  new_pgn_sha256:hash(secondPgn),new_plies:7,
  new_engine_moves:changedAnalysis.moves.length,
  actual_game_detail_GETs:getIds(),
  real_game_pgn_updated:changedGet.body.game.pgn===secondPgn,
  real_analysis_updated:changedGet.body.analysis.moves_json===JSON.stringify(changedAnalysis.moves),
  real_http_game_detail:{status:changedGet.status,
   game_pgn:changedGet.body.game.pgn,
   analysis_moves_json:changedGet.body.analysis.moves_json}};
 assert.equal(heldStillOpen,true,'browser already canceled old model after PGN changed');
 assert.equal(afterUpdate.progress,true,'browser automatically left obsolete progress after source update');
 assert.equal(afterUpdate.hasOld,false);
 assert.equal(afterUpdate.hasGood,false);
 if(fault==='abort-after-source-change'){
  const canceled=await browser.evalJs(`(() => {const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Cancel generation'));if(!b)return false;b.click();return true;})()`);
  assert.equal(canceled,true,'QA abort control could not find actual cancel button');
  await until(()=>held.res.destroyed||provider.closed.includes(held.id),
   'fault_abort_old_model_connection',3400);
  observations.fault_cancel_exercised=true;
  observations.fault_cancel_model_connection_closed=held.res.destroyed||provider.closed.includes(held.id);
  observations.fault_cancel_backend_cache_still_null=cache(2)===null;
  observations.after_fault_cancel=await browserState();
 }
 // No operator cancellation in the clean scenario. The fake response now
 // completes; a real backend source CAS must reject the old report, not
 // write a stale winner or stream an SSE `done` event to the browser.
 const responseSent=respond(held,obsolete);
 observations.old_response_sent=responseSent;
 assert.equal(responseSent,true,'outdated model request was already terminated or aborted');
 await browser.wait(`!!document.querySelector('[role=alert]')?.innerText?.includes('review_source_changed')`,
  'post_source_change_real_sse_error',6500);
 const after=await browserState();
 const latest=await getAsOwner('/api/games/2/review',cookie);
 const afterRow=db.prepare('SELECT * FROM analyses WHERE game_id=2').get();
 const changedGame=db.prepare('SELECT pgn FROM games WHERE id=2').get();
 observations.after_release={ui:after,backend_get:latest,
  old_model_response_sent:responseSent,
  backend_cached_prose_null:cache(2)===null,
  saved_source_pgn_sha256:hash(changedGame.pgn),
  saved_analysis_moves_sha256:hash(afterRow.moves_json),
  provider_request_closed:provider.closed.includes(held.id),
  chrome_post_requests:postIds(),
  provider_calls:provider.calls,provider_errors:provider.errors,
  browser_exceptions:browser.events.filter(x=>x.method==='Runtime.exceptionThrown')
   .map(x=>x.params.exceptionDetails?.text||'browser exception')};
 assert.deepEqual(latest.body,{review:null});
 assert.equal(after.hasOld,false);
 assert.equal(after.progress,false);
 assert.match(after.error||'',/review_source_changed/);
 assert.equal(cache(2),null);
 assert.equal(afterRow.moves_json,JSON.stringify(changedAnalysis.moves));
 assert.equal(changedGame.pgn,secondPgn);
 assert.equal(observations.after_release.chrome_post_requests.length,2);
 assert.deepEqual(provider.errors,[]);
 assert.deepEqual(observations.after_release.browser_exceptions,[]);
 assert.equal(provider.calls.filter(x=>x.stage==='summary').length,2);
 assert.equal(provider.closed.length,provider.calls.length);
}catch(e){error=e instanceof Error?(e.stack||e.message):String(e);
 try{observations.failure_state=browser?await browserState():null;}catch(problem){observations.failure_diagnostic=String(problem);}
}finally{
 if(browser)await browser.dispose().catch(()=>{});
 if(vite)await within(vite.close(),3600,'vite_close').catch(()=>{});
 process.chdir(oldCwd);
 if(api){api.closeAllConnections();await within(new Promise(ok=>api.close(ok)),1900,'api_close').catch(()=>{});}
 try{db?.close();}catch{}
 for(const rec of provider.held){if(!rec.res.destroyed)try{respond(rec,good);}catch{}}
 mock.closeAllConnections();await within(new Promise(ok=>mock.close(ok)),1900,'mock_close').catch(()=>{});
 rmSync(scratch,{recursive:true,force:true});
}
const packet={schema_version:1,at_utc:new Date().toISOString(),run_id:runId,
 previous_checkpoint:'a59edb0d1f2ecf645ea01151ad1f5850e2e13482',
 product_sha:productSHA,backend_sha:backendSHA,stockfish_sha256:engineSHA,
 manifest_sha256:manifestSHA,fixture_id:fixture.fixture_id,fixture_sha256:fixture.pgn_sha256,
 new_pgn:secondPgn,new_pgn_sha256:hash(secondPgn),
 model_summary_for_old_game:obsolete,control_summary:good,
 test_only_fault:fault,qa_status:error?'fail':'pass',qa_error:error,
 observations,elapsed_ms:Date.now()-began,
 engine_depth:8,engine_threads:1,engine_hash_mib:16,stockfish_searches:2,
 external_model_requests:0,synthetic_game_only:true,
 disposable_db:true,live_chrome_with_react:true,
 product_release_approved:false,full_integration_certified:false,
 limits:['Two synthetic games and two depth-8 single-thread engine analyses, no mass searches',
  'Local vLLM-compatible fixture server only; no real generative model or external API expense',
  'Game PGN and scored analysis are changed directly in disposable SQLite, not a live websocket',
  'React Query updates via actual bookmark UI; no claim of automatic live game notifications',
  'The source CAS should prevent persistence of old prose despite frontend still loading it']};
const out=join(results,fault?'browser-inflight-source-fault.json':'browser-inflight-source.json');
writeFileSync(out,JSON.stringify(packet,null,2)+'\n');
console.log(JSON.stringify({file:out,run_id:runId,qa_status:packet.qa_status,
 before:observations.before_change??null,after_refetch:observations.after_change??null,
 after_release:observations.after_release??null,
 provider_call_count:provider.calls.length,
 qa_error:error,product_release_approved:false},null,2));
if(error)process.exitCode=1;
