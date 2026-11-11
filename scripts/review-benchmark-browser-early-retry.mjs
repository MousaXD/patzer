#!/usr/bin/env node
/**
 * Agent D: REAL Chrome/React and REAL backend cancel/retry while an early
 * model phase or key-moment response is stalled. Two cases run in ONE isolated
 * browser. The QA-only fault drops the first POST AbortSignal on each game.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {createServer as createTcpServer} from 'node:net';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Hono} from 'hono';
import {serve} from '@hono/node-server';
import {createServer as createViteServer} from 'vite';
import {Chess} from 'chess.js';
import {launchBrowser,within,until} from './review-benchmark-cdp.mjs';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence'),results=join(qa,'results');
mkdirSync(results,{recursive:true});
const options=Object.fromEntries(process.argv.slice(2).map(x=>{
 const i=x.indexOf('=');return i<0?[x.slice(2),true]:[x.slice(2,i),x.slice(i+1)];
}));
const fault=options.fault??null;
assert(fault===null||fault==='suppress-first-controller-abort','unsupported QA fault');
const runId=options['run-id']||randomUUID();
assert(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(runId));
const frontend=realpathSync(options['product-root']||join(results,'worktree-product-browser'));
const backend=realpathSync(options['backend-root']||join(results,'worktree-coach'));
const engine=realpathSync(options.engine||join(results,'engine/unpacked/usr/games/stockfish'));
const sha=x=>createHash('sha256').update(x).digest('hex');
const productSha='d72eaced6972c8a2ec7d8581365c45788b15a29a';
const backendSha='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const engineSha='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const manifestSha='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
const head=dir=>execFileSync('git',['rev-parse','HEAD'],{cwd:dir,encoding:'utf8'}).trim();
assert.equal(head(frontend),productSha);assert.equal(head(backend),backendSha);
assert.equal(sha(readFileSync(engine)),engineSha);
const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8');
assert.equal(sha(manifest),manifestSha);
const entry=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(entry?.source_kind==='synthetic'&&entry.license==='self-authored');
const pgn=readFileSync(join(qa,'fixtures',entry.pgn_file),'utf8');
assert.equal(sha(pgn),entry.pgn_sha256);
const chess=new Chess();chess.loadPgn(pgn,{strict:true});
assert(chess.isCheckmate()&&chess.turn()==='w'&&chess.header().Result==='0-1');

const scratch=mkdtempSync(join(results,'chrome-early-retry-'));
process.env.DB_PATH=join(scratch,'synthetic.sqlite');
process.env.SESSION_SECRET='qa-local-synthetic-cookie-do-not-use';
process.env.ENGINE_BACKEND='local';process.env.STOCKFISH_PATH=engine;
process.env.STOCKFISH_THREADS='1';process.env.STOCKFISH_HASH='16';
process.env.OIDC_ENABLED='false';process.env.UPDATE_CHECK_ENABLED='false';

const labels={first:'Black won the game. FIRST EARLY GENERATION.',
 second:'Black won the game. SECOND EARLY GENERATION.'};
let active=null;
const provider=createServer((req,res)=>{
 if(req.method==='GET'&&req.url==='/v1/models'){
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({data:[{id:'qa-early-stage-model'}]}));return;
 }
 if(req.method!=='POST'||req.url!=='/v1/chat/completions'){
  res.writeHead(404).end();return;
 }
 let body='';req.on('data',chunk=>{body+=chunk;if(body.length>120000)req.destroy();});
 req.on('end',()=>{
  try{
   assert(active,'no active bounded synthetic scenario');
   const parsed=JSON.parse(body);
   assert.equal(parsed.model,'qa-early-stage-model');
   const prompt=parsed.messages?.find(x=>x.role==='user')?.content||'';
   const stage=prompt.includes('Schema: { "summary"')?'summary':
    prompt.includes('"what_happened"')?'moment':'phase';
   const c=active;
   const record={res,stage,sequence:c.calls.length+1};
   c.calls.push({stage,sequence:record.sequence});
   res.on('close',()=>c.closed.push(record.sequence));
   if(stage===c.earlyStage&&!c.heldEarly){c.heldEarly=record;return;}
   if(stage==='summary'){
    if(!c.heldReplacementSummary){c.heldReplacementSummary=record;return;}
    // The first request was held at an earlier step: a second summary only
    // becomes possible if that obsolete request remained alive and advanced.
    c.oldSummaryDelivered++;
    answer(record,labels.first);return;
   }
   answer(record,labels.first);
  }catch(error){
   if(active)active.errors.push(String(error));
   res.writeHead(500).end(String(error));
  }
 });
});
function answer(record,summary){
 if(record.res.destroyed)return false;
 const obj={prose:'Review the legal recorded moves.',
  title:'QA chess moment',what_happened:'Review the actual played move.',
  why_it_matters:'Check the legal alternatives.',what_to_learn:'Verify threats.',
  summary,opening_prose:'The opening was recorded.',
  skill_assessment:'One match does not establish playing strength.'};
 record.res.writeHead(200,{'content-type':'application/json'});
 record.res.end(JSON.stringify({choices:[{finish_reason:'stop',
  message:{role:'assistant',content:JSON.stringify(obj)}}]}));
 return true;
}
async function port(){
 const s=createTcpServer();
 await within(new Promise((ok,fail)=>{
  s.once('error',fail);s.listen(0,'127.0.0.1',ok);
 }),1400,'ephemeral_port');
 const value=s.address().port;
 await within(new Promise(ok=>s.close(ok)),1400,'port_close');
 assert(Number.isInteger(value)&&value>0);
 return value;
}

let db=null,api=null,vite=null,browser=null,apiPort=0,vitePort=0;
const originalCwd=process.cwd(),started=Date.now(),resultsByStage=[];
let experimentError=null;
const cache=id=>db.prepare('SELECT prose_json,prose_lang,prose_audience FROM analyses WHERE game_id=?').get(id);
const cachedSummary=id=>{
 const row=cache(id);return row?.prose_json?JSON.parse(row.prose_json).summary:null;
};
async function clickContaining(fragment){
 const done=await browser.evalJs(`(() => {
  const button=[...document.querySelectorAll('button')].find(x=>x.textContent.includes(${JSON.stringify(fragment)}));
  if(!button)return false;button.click();return true;
})()`);
 assert.equal(done,true,'actual React button missing: '+fragment);
}
async function scenario(id,earlyStage){
 const c={id,earlyStage,calls:[],closed:[],errors:[],heldEarly:null,
  heldReplacementSummary:null,oldSummaryDelivered:0};
 active=c;
 await browser.go('http://127.0.0.1:'+vitePort+'/review/'+id);
 await browser.wait('location.pathname === "/review/'+id+'" && !!document.querySelector("#review-tab-report")',
  'real_analyzer_'+id,20000);
 await browser.click('#review-tab-report');
 await browser.wait('!![...document.querySelectorAll("button")].find(b=>b.textContent.includes("Write AI report"))',
  'report_button_'+id,9000);
 await clickContaining('Write AI report');
 await until(()=>c.heldEarly!==null,'held_early_'+earlyStage,12000);
 const before=c.calls.map(x=>x.stage);
 const old=c.heldEarly;
 const emptyBefore=cachedSummary(id)===null;
 assert(emptyBefore);
 const bypass=fault?await browser.evalJs('window.__qaEarlyAbortBypass')??0:0;
 if(fault)assert.equal(bypass,1,
  'fault_not_installed_on_first_real_review_post');
 await clickContaining('Cancel generation');
 await browser.wait('!!document.querySelector("[role=alert]")?.textContent?.includes("cancelled")',
  'cancel_confirm_'+id,6500);
 const swallowed=fault?await browser.evalJs('window.__qaEarlyAbortSwallowed')??0:0;
 assert.equal(swallowed,fault?1:0,'controlled AbortController injection did not exercise cancellation');
 // Start replacement without ever awaiting old provider closure.
 await clickContaining('Write AI report');
 await until(()=>c.heldReplacementSummary!==null,'new_summary_held_'+id,14000);
 assert.equal(cachedSummary(id),null);
 const closedBeforeRelease=old.res.destroyed||c.closed.includes(old.sequence);
 if(fault)assert.equal(closedBeforeRelease,false,
  'old_request_already_closed_before_fault_response');
 let oldResponseSent=false,retryResponseSent=false,oldCachedBeforeRetry=null;
 if(fault){
  oldResponseSent=answer(old,labels.first);
  assert.equal(oldResponseSent,true,'old_model_response_not_delivered');
  await until(()=>c.oldSummaryDelivered===1,'old_summary_completed_'+id,7000);
  await until(()=>cachedSummary(id)===labels.first,'old_cache_first_'+id,5500);
  oldCachedBeforeRetry=cachedSummary(id);
  retryResponseSent=answer(c.heldReplacementSummary,labels.second);
 }else{
  await until(()=>old.res.destroyed||c.closed.includes(old.sequence),
   'aborted_early_'+id,2800);
  oldResponseSent=answer(old,labels.first);
  oldCachedBeforeRetry=cachedSummary(id);
  retryResponseSent=answer(c.heldReplacementSummary,labels.second);
 }
 await until(()=>c.closed.includes(c.heldReplacementSummary.sequence),
  'replacement_response_closed_'+id,5500);
 await new Promise(ok=>setTimeout(ok,420));
 const outcome={fixture_id:entry.fixture_id,game_id:id,held_stage:earlyStage,
  first_stage_sequence:old.sequence,initial_stages:before,
  bypass_count:bypass,abort_calls_swallowed:swallowed,
  old_closed_before_release:closedBeforeRelease,
  old_response_sent:oldResponseSent,old_summary_requests_after_release:c.oldSummaryDelivered,
  old_cache_before_retry_completion:oldCachedBeforeRetry,
  replacement_response_sent:retryResponseSent,
  final_cached_summary:cachedSummary(id),cached_language:cache(id).prose_lang,
  cached_audience:cache(id).prose_audience,
  ui_shows_old:await browser.evalJs('document.body.innerText.includes("FIRST EARLY GENERATION")'),
  ui_shows_new:await browser.evalJs('document.body.innerText.includes("SECOND EARLY GENERATION")'),
  ui_error:await browser.evalJs('document.querySelector("[role=alert]")?.textContent??null'),
  calls:c.calls,closed:c.closed,errors:c.errors,
  chrome_post_ids:browser.events.filter(x=>x.method==='Network.requestWillBeSent'&&
   x.params?.request?.method==='POST'&&
   new RegExp('/api/games/'+id+'/review$').test(x.params.request.url))
   .map(x=>x.params.requestId),
 };
 outcome.chrome_failed_posts=browser.events.filter(x=>x.method==='Network.loadingFailed'
  &&outcome.chrome_post_ids.includes(x.params.requestId))
  .map(x=>({id:x.params.requestId,canceled:x.params.canceled??false,
   error:x.params.errorText}));
 resultsByStage.push(outcome);
 assert.equal(outcome.chrome_post_ids.length,2,'two actual browser requests required');
 assert.equal(new Set(outcome.chrome_post_ids).size,2);
 assert.equal(outcome.old_closed_before_release,!fault,
  'unexpected old model connection state');
 assert.equal(outcome.old_response_sent,!!fault);
 assert.equal(outcome.old_summary_requests_after_release,fault?1:0);
 assert.equal(outcome.old_cache_before_retry_completion,fault?labels.first:null);
 assert.equal(outcome.replacement_response_sent,true);
 assert.equal(outcome.final_cached_summary,fault?labels.first:labels.second);
  if(!fault){
   assert.equal(outcome.ui_shows_old,false,'canceled report appeared in the UI');
   assert.equal(outcome.ui_shows_new,true);
   assert.equal(outcome.ui_error,null);
  }else{
   assert.equal(outcome.ui_shows_new,false,
    'the replacement unexpectedly succeeded despite old-first cache write');
   assert.match(outcome.ui_error||'',/review_source_changed/,
    'the new review did not report its actual cache conflict');
  }
 assert.equal(outcome.cached_language,'en');assert.equal(outcome.cached_audience,'beginner');
 assert.deepEqual(outcome.errors,[]);
 assert.equal(new Set(outcome.closed).size,outcome.calls.length);
 assert.deepEqual(outcome.initial_stages,earlyStage==='phase'?['phase']:['phase','moment']);
 assert.deepEqual(outcome.calls.map(x=>x.stage),fault?
  (earlyStage==='phase'?['phase','phase','moment','summary','moment','summary']:
   ['phase','moment','phase','moment','summary','summary']):
  (earlyStage==='phase'?['phase','phase','moment','summary']:
   ['phase','moment','phase','moment','summary']));
}

try{
 await within(new Promise((ok,fail)=>{
  provider.once('error',fail);provider.listen(0,'127.0.0.1',ok);
 }),1600,'provider_server');
 const {db:database,setSetting}=await import(join(backend,'server/src/db.ts'));db=database;
 setSetting('llm_provider','vllm');setSetting('vllm_model','qa-early-stage-model');
 setSetting('vllm_url','http://127.0.0.1:'+provider.address().port);
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
  .run(1,'qa-early-local','not-a-password','admin');
 db.prepare('INSERT INTO profiles(user_id,display_name,language,audience) VALUES(?,?,?,?)')
  .run(1,'QA early','en','beginner');
 const analysis=await analyzePgn(pgn,8);
 for(const id of [1,2]){
  db.prepare('INSERT INTO games(id,user_id,source,pgn,user_color,white,black,result) VALUES(?,?,?,?,?,?,?,?)')
   .run(id,1,'imported',pgn,'white','Synthetic White','Synthetic Black','0-1');
  saveAnalysis(id,analysis);
 }
 const app=new Hono();
 app.use('/api/*',async(c,next)=>{
  if(!['GET','HEAD'].includes(c.req.method)&&c.req.header('X-Requested-With')!=='patzer')
   return c.json({error:'csrf_required'},403);
  await next();
 });
 app.get('/api/meta/update',c=>c.json({enabled:false,updateAvailable:false}));
 for(const [name,router] of Object.entries(routes))
  app.route('/api/'+(name==='review'?'games':name),router);
 api=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0});
 await within(new Promise((ok,fail)=>{
  api.once('listening',ok);api.once('error',fail);
 }),1800,'api');
 apiPort=api.address().port;
 process.env.PORT=String(apiPort);
 process.chdir(join(frontend,'web'));
 const chosen=await port();
 vite=await createViteServer({root:join(frontend,'web'),
  configFile:join(frontend,'web/vite.config.ts'),
  server:{host:'127.0.0.1',port:chosen,strictPort:true,hmr:false,
   proxy:{'/api':{target:'http://127.0.0.1:'+apiPort,changeOrigin:true}}},
  logLevel:'error'});
 await within(vite.listen(),10000,'vite');
 vitePort=vite.httpServer.address().port;
 assert.equal(vitePort,chosen);
 browser=await launchBrowser({chromeBinary:options.chrome||'/usr/bin/google-chrome',
  profileDir:join(scratch,'isolated-chrome')});
 const origin='http://127.0.0.1:'+vitePort;
 await browser.send('Network.setCookie',{url:origin,name:'chess_session',
  value:createSession(1),httpOnly:true,path:'/',sameSite:'Lax'});
 if(fault){
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`(() => {
   // Test-only fault: the React AbortController for the FIRST report POST
   // must remain non-aborted even after Cancel invokes its .abort() method.
   // Later report POSTs retain normal cancellation. This fault is stronger
   // than just removing fetch's signal: the old reader will not see a
   // synthetic aborted flag after receiving its next SSE progress event.
   const Native=window.AbortController;
   const bySignal=new WeakMap();
   window.__qaEarlyAbortBypass=0;
   window.__qaEarlyAbortSwallowed=0;
   window.AbortController=class extends Native {
    constructor(){super();bySignal.set(this.signal,this);}
    abort(reason){
     if(this.__qaIgnoreReportCancel){window.__qaEarlyAbortSwallowed++;return;}
     return super.abort(reason);
    }
   };
   const original=window.fetch.bind(window);let used=false;
   window.fetch=(request,options)=>{
    const url=typeof request==='string'?request:request?.url;
    if(!used&&typeof url==='string'&&/\\/api\\/games\\/\\d+\\/review$/.test(url)&&options?.method==='POST'){
     used=true;window.__qaEarlyAbortBypass++;
     const controller=bySignal.get(options.signal);
     if(!controller)throw Error('QA report AbortController not found');
     controller.__qaIgnoreReportCancel=true;
     return original(request,options);
    }
    return original(request,options);
   };
  })();`});
 }
 await scenario(1,'phase');
 await scenario(2,'moment');
 const errors=browser.events.filter(x=>x.method==='Runtime.exceptionThrown').map(x=>
  x.params.exceptionDetails?.text||'Chrome runtime exception');
 assert.deepEqual(errors,[]);
 if(fault)throw Error('qa_injected_early_abort_kept_canceled_request_alive');
}catch(error){
 experimentError=error instanceof Error?error.stack||error.message:String(error);
}finally{
 if(browser)await browser.dispose().catch(()=>{});
 if(vite)await within(vite.close(),3000,'vite_close').catch(()=>{});
 process.chdir(originalCwd);
 if(api){api.closeAllConnections();await within(new Promise(ok=>api.close(ok)),1800,'api_close').catch(()=>{});}
 try{db?.close();}catch{}
 if(active){for(const pending of [active.heldEarly,active.heldReplacementSummary]){
  if(pending&&!pending.res.destroyed)try{answer(pending,labels.first);}catch{}
 }}
 provider.closeAllConnections();
 await within(new Promise(ok=>provider.close(ok)),1800,'provider_close').catch(()=>{});
 rmSync(scratch,{recursive:true,force:true});
}
const packet={schema_version:1,at_utc:new Date().toISOString(),run_id:runId,
 frontend_sha:productSha,backend_sha:backendSha,engine_sha256:engineSha,
 manifest_sha256:manifestSha,fixture_id:entry.fixture_id,
 chrome_version:execFileSync(options.chrome||'/usr/bin/google-chrome',
  ['--version'],{encoding:'utf8'}).trim(),
 fault,qa_verdict:experimentError?'fail':'pass',qa_error:experimentError,
 scenarios:resultsByStage,
 incomplete_scenario:experimentError&&active&&resultsByStage.length<2?{
  game_id:active.id,stage:active.earlyStage,
  calls:active.calls,closed:active.closed,errors:active.errors,
  held_early_destroyed:active.heldEarly?.res.destroyed??null,
  held_replacement_destroyed:active.heldReplacementSummary?.res.destroyed??null,
  late_old_summaries:active.oldSummaryDelivered,
 }:null,
 elapsed_ms:Date.now()-started,
 synthetic_only:true,disposable_database_only:true,
 release_approved:false,full_security_certified:false,
 limitations:['Real Chrome, React, Hono, Stockfish and Vite with loopback mock LLM',
  'One self-authored four-ply chess game on two synthetic game rows',
  'One Chrome profile is reused across both early-stage cancellation cases',
  'No production DB, authenticated game histories, live browser or remote LLM']};
const output=join(results,fault?'review-early-retry-fault.json':'review-early-retry.json');
writeFileSync(output,JSON.stringify(packet,null,2)+'\n');
console.log(JSON.stringify({output,run_id:runId,qa_verdict:packet.qa_verdict,
  fault,scenarios:resultsByStage,incomplete:packet.incomplete_scenario,
  qa_error:experimentError,
  elapsed_ms:packet.elapsed_ms,release_approved:false},null,2));
if(experimentError)process.exitCode=1;
