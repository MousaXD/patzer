#!/usr/bin/env node
/** Agent D — genuine Chrome cancel → immediate retry, same synthetic game.
 * Compare correctly aborted first generation with a QA-only browser fault
 * that leaves the canceled request connected to the REAL backend. Neither
 * the product code, real user profile nor production database is modified.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {createServer as createTcpServer} from 'node:net';
import {Hono} from 'hono';
import {serve} from '@hono/node-server';
import {createServer as createViteServer} from 'vite';
import {Chess} from 'chess.js';
import {launchBrowser,within,until} from './review-benchmark-cdp.mjs';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence'),results=join(qa,'results');
mkdirSync(results,{recursive:true});
const cli=Object.fromEntries(process.argv.slice(2).map(x=>{
 const n=x.indexOf('=');return n<0?[x.slice(2),true]:[x.slice(2,n),x.slice(n+1)];
}));
const mode=cli.fault??null;
assert(mode===null||mode==='skip-first-abort'||mode==='skip-first-abort-old-last',
 'only declared QA-only mutations allowed');
const runId=cli['run-id']||randomUUID();
assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId));
const product=realpathSync(cli['product-root']||join(results,'worktree-product-browser'));
const backend=realpathSync(cli['backend-root']||join(results,'worktree-coach'));
const engine=realpathSync(cli.engine||join(results,'engine/unpacked/usr/games/stockfish'));
const rev=dir=>execFileSync('git',['rev-parse','HEAD'],{cwd:dir,encoding:'utf8'}).trim();
const productSha='d72eaced6972c8a2ec7d8581365c45788b15a29a';
const backendSha='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const engineHash='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const manifestHash='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
const digest=data=>createHash('sha256').update(data).digest('hex');
assert.equal(rev(product),productSha);assert.equal(rev(backend),backendSha);
assert.equal(digest(readFileSync(engine)),engineHash);
const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8');
assert.equal(digest(manifest),manifestHash);
const fixture=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.source_kind==='synthetic'&&fixture.license==='self-authored');
const pgn=readFileSync(join(qa,'fixtures',fixture.pgn_file),'utf8');
assert.equal(digest(pgn),fixture.pgn_sha256);
const chess=new Chess();chess.loadPgn(pgn,{strict:true});
assert(chess.isCheckmate()&&chess.header().Result==='0-1');

const scratch=mkdtempSync(join(results,'chrome-retry-'));
process.env.DB_PATH=join(scratch,'synthetic-retry.db');
process.env.SESSION_SECRET='QA synthetic retry cookie not production';
process.env.STOCKFISH_PATH=engine;process.env.ENGINE_BACKEND='local';
process.env.STOCKFISH_THREADS='1';process.env.STOCKFISH_HASH='16';
process.env.OIDC_ENABLED='false';process.env.UPDATE_CHECK_ENABLED='false';

const sentences={
 first:'Black won the game. FIRST GENERATION.',
 second:'Black won the game. SECOND GENERATION.',
};
const model={calls:[],holds:[],closed:[],errors:[]};
let db=null,vite=null,server=null,browser=null,apiPort=0,vitePort=0;
const llm=createServer((req,res)=>{
 if(req.method==='GET'&&req.url==='/v1/models'){
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({data:[{id:'qa-retry-local-model'}]}));return;
 }
 if(req.method==='POST'&&req.url==='/v1/chat/completions'){
  let body='';req.on('data',data=>{body+=data;if(body.length>80000)req.destroy();});
  req.on('end',()=>{
   try{
    const parsed=JSON.parse(body);assert.equal(parsed.model,'qa-retry-local-model');
    const prompt=parsed.messages?.find(x=>x.role==='user')?.content||'';
    const stage=prompt.includes('Schema: { "summary"')?'summary':
     prompt.includes('"what_happened"')?'moment':'phase';
    const sequence=model.calls.length+1;
    const generation=sequence<=3?'first':'second';
    model.calls.push({sequence,stage,generation});
    res.on('close',()=>model.closed.push(sequence));
    const record={res,stage,sequence,generation};
    if(stage==='summary')model.holds.push(record);
    else respond(record);
   }catch(err){model.errors.push(String(err));res.writeHead(500).end(String(err));}
  });return;
 }
 res.writeHead(404).end();
});
function respond(item){
 if(item.res.destroyed)return false;
 const data={title:'QA test move',prose:'Inspect the board after this move.',
  what_happened:'Inspect the board after this move.',
  summary:sentences[item.generation],
  opening_prose:'The opening is recorded.',
  skill_assessment:'One game cannot establish playing ability.'};
 item.res.writeHead(200,{'content-type':'application/json'});
 item.res.end(JSON.stringify({choices:[{
  finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(data)},
 }]}));return true;
}

const observation={};
const initialCwd=process.cwd();
const started=Date.now();
let failure=null;
async function chooseEphemeralPort(){
 const probe=createTcpServer();
 await within(new Promise((ok,fail)=>{
  probe.once('error',fail);probe.listen(0,'127.0.0.1',ok);
 }),1800,'reserve_local_qa_port');
 const port=probe.address()?.port;
 await within(new Promise(ok=>probe.close(ok)),1800,'release_local_qa_port');
 assert(Number.isSafeInteger(port)&&port>0);
 return port;
}
const cached=()=>db.prepare('SELECT prose_json,prose_lang,prose_audience FROM analyses WHERE game_id=1').get();
const cachedSummary=()=>{
 const value=cached().prose_json;
 return value?JSON.parse(value).summary:null;
};
const clickText=async text=>{
 const pressed=await browser.evalJs(`(() => {
  const button=[...document.querySelectorAll('button')].find(x=>x.textContent.includes(${JSON.stringify(text)}));
  if(!button)return false;button.click();return true;
 })()`);
 assert.equal(pressed,true,'actual React button not found: '+text);
};
try{
 await within(new Promise((ok,fail)=>{llm.once('error',fail);llm.listen(0,'127.0.0.1',ok);}),1500,'mock_server');
 const {db:database,setSetting}=await import(join(backend,'server/src/db.ts'));db=database;
 setSetting('llm_provider','vllm');setSetting('vllm_model','qa-retry-local-model');
 setSetting('vllm_url','http://127.0.0.1:'+llm.address().port);
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
  .run(1,'QA browser retry','no-real-password','admin');
 db.prepare('INSERT INTO profiles(user_id,display_name,language,audience) VALUES(?,?,?,?)')
  .run(1,'QA browser retry','en','beginner');
 db.prepare('INSERT INTO games(id,user_id,source,pgn,user_color,white,black,result) VALUES(?,?,?,?,?,?,?,?)')
  .run(1,1,'imported',pgn,'white','Test White','Test Black','0-1');
 saveAnalysis(1,await analyzePgn(pgn,8));
 const app=new Hono();
 app.use('/api/*',async(c,next)=>{
  if(c.req.method!=='GET'&&c.req.method!=='HEAD'&&c.req.header('X-Requested-With')!=='patzer'){
   return c.json({error:'csrf_required'},403);
  }
  await next();
 });
 app.get('/api/meta/update',c=>c.json({enabled:false,updateAvailable:false}));
 for(const [path,route] of Object.entries(routes))app.route('/api/'+(path==='review'?'games':path),route);
 server=serve({fetch:app.fetch,port:0,hostname:'127.0.0.1'});
 await within(new Promise((ok,fail)=>{server.once('listening',ok);server.once('error',fail);}),1800,'api_server');
 apiPort=server.address().port;
 process.env.PORT=String(apiPort);
 process.chdir(join(product,'web'));
 const chosenVitePort=await chooseEphemeralPort();
 vite=await createViteServer({root:join(product,'web'),
  configFile:join(product,'web/vite.config.ts'),
  server:{host:'127.0.0.1',port:chosenVitePort,strictPort:true,hmr:false,
   proxy:{'/api':{target:'http://127.0.0.1:'+apiPort,changeOrigin:true}}},logLevel:'error'});
 await within(vite.listen(),10000,'vite_server');
 vitePort=vite.httpServer.address().port;
 assert.equal(vitePort,chosenVitePort,'Vite silently selected a different port');
 browser=await launchBrowser({chromeBinary:cli.chrome||'/usr/bin/google-chrome',
  profileDir:join(scratch,'chrome-profile')});
 const origin='http://127.0.0.1:'+vitePort;
 await browser.send('Network.setCookie',{url:origin,name:'chess_session',
  value:createSession(1),httpOnly:true,sameSite:'Lax',path:'/'});
 if(mode==='skip-first-abort'||mode==='skip-first-abort-old-last'){
  // This mutation is injected into only the temporary QA Chrome document.
  // User code remains unchanged, and only the FIRST report POST is affected.
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`(() => {
   const original=window.fetch.bind(window);let first=true;
   window.__qaFirstRequestBypassed=0;
   window.fetch=(url,options)=>{
    const target=typeof url==='string'?url:url?.url;
    if(first&&typeof target==='string'&&/\\/api\\/games\\/1\\/review$/.test(target)&&options?.method==='POST'){
     first=false;window.__qaFirstRequestBypassed++;
     return original(url,{...options,signal:undefined});
    }
    return original(url,options);
   };
  })();`});
 }
 await browser.go(origin+'/review/1');
 await browser.wait('!!document.querySelector("#review-tab-report")','real_analyzer_tab',19000);
 await browser.click('#review-tab-report');
 await browser.wait('!![...document.querySelectorAll("button")].find(x=>x.textContent.includes("Write AI report"))',
  'first_real_report_action',8000);
 await clickText('Write AI report');
 await until(()=>model.holds.length===1,'first_provider_response_held',12000);
 observation.first_generation_started=true;
 observation.cache_before_cancel=cachedSummary();
 assert.equal(observation.cache_before_cancel,null);
 const first=model.holds[0];
 observation.first_generation_model_sequence=first.sequence;
 observation.abort_bypass_count=mode!==null
  ? await browser.evalJs('window.__qaFirstRequestBypassed') : 0;
 await clickText('Cancel generation');
 await browser.wait('!!document.querySelector("[role=alert]")?.textContent?.includes("cancelled")',
  'real_cancel_displayed',6000);
 // Crucially: do NOT wait for the first server request to fully abort before
 // clicking Retry. This tests the actual brief overlapping cancellation race.
 await clickText('Write AI report');
 await until(()=>model.holds.length===2,'replacement_provider_response_held',12000);
 const second=model.holds[1];
 observation.second_generation_model_sequence=second.sequence;
 observation.second_generation_started=true;
 observation.cache_during_overlap=cachedSummary();
 await until(()=>first.res.destroyed||model.closed.includes(first.sequence),
  'old_provider_close_or_timeout',700).catch(()=>{});
 observation.first_closed_before_release=first.res.destroyed||model.closed.includes(first.sequence);
 observation.both_model_generations_observed=model.holds.length===2;
 if(mode==='skip-first-abort'){
  observation.first_model_response_sent=respond(first);
  await until(()=>cachedSummary()===sentences.first,'old_completed_after_cancel',3900).catch(()=>{});
  observation.cache_after_old_release=cachedSummary();
  observation.first_won_before_retry_completion=observation.cache_after_old_release===sentences.first;
  // After deliberately allowing old work to finish first, the fresh review
  // may fail its CAS. That is the poisoned retry outcome this gate must catch.
  observation.second_model_response_sent=respond(second);
 }else if(mode==='skip-first-abort-old-last'){
  // The inverse race is a different contract: the new report commits first,
  // then a stale canceled response arrives late. The source CAS must reject
  // the old writer and preserve the newer report.
  observation.second_model_response_sent=respond(second);
  await until(()=>cachedSummary()===sentences.second,
   'new_review_wins_before_old',4200).catch(()=>{});
  observation.cache_after_new_release=cachedSummary();
  observation.first_model_response_sent=respond(first);
  await until(()=>model.closed.includes(first.sequence),'late_old_model_response',3800).catch(()=>{});
  await new Promise(ok=>setTimeout(ok,450));
  observation.cache_after_old_release=cachedSummary();
  observation.first_won_before_retry_completion=false;
 }else{
  observation.first_model_response_sent=respond(first);
  observation.cache_after_old_release=cachedSummary();
  observation.first_won_before_retry_completion=observation.cache_after_old_release===sentences.first;
  observation.second_model_response_sent=respond(second);
 }
 await until(()=>model.closed.includes(second.sequence),'second_provider_closed',4500);
 await new Promise(done=>setTimeout(done,500));
 observation.final_cached_summary=cachedSummary();
 observation.final_cached_language=cached().prose_lang;
 observation.final_cached_audience=cached().prose_audience;
 observation.ui_contains_first=await browser.evalJs(
  'document.body.innerText.includes("FIRST GENERATION")');
 observation.ui_contains_second=await browser.evalJs(
  'document.body.innerText.includes("SECOND GENERATION")');
 observation.ui_error=await browser.evalJs('document.querySelector("[role=alert]")?.textContent??null');
 observation.model_calls=model.calls;
 observation.model_closed=model.closed;
 observation.model_errors=model.errors;
 const chromePosts=browser.events.filter(x=>x.method==='Network.requestWillBeSent'
  &&x.params?.request?.method==='POST'
  &&/\/api\/games\/1\/review$/.test(x.params?.request?.url||''));
 observation.chrome_review_post_ids=chromePosts.map(x=>x.params.requestId);
 observation.chrome_failed_posts=browser.events.filter(x=>x.method==='Network.loadingFailed'
  &&observation.chrome_review_post_ids.includes(x.params.requestId))
  .map(x=>({id:x.params.requestId,canceled:x.params.canceled??false,
   error:x.params.errorText}));
 observation.browser_exceptions=browser.events.filter(x=>x.method==='Runtime.exceptionThrown')
  .map(x=>x.params.exceptionDetails?.text||'browser runtime exception');
 observation.chrome_version=execFileSync(cli.chrome||'/usr/bin/google-chrome',
  ['--version'],{encoding:'utf8'}).trim();
 observation.vite_port=vitePort;observation.api_port=apiPort;
 assert.equal(observation.both_model_generations_observed,true);
 assert.equal(observation.chrome_review_post_ids.length,2);
 assert.equal(new Set(observation.chrome_review_post_ids).size,2);
 assert.deepEqual(observation.model_calls.map(x=>x.stage),
  ['phase','moment','summary','phase','moment','summary']);
 assert.equal(observation.model_closed.length,6);
 assert.deepEqual(observation.model_errors,[]);
 assert.deepEqual(observation.browser_exceptions,[]);
 if(mode===null){
  assert.equal(observation.abort_bypass_count,0);
  assert.equal(observation.first_closed_before_release,true,
   'first_canceled_generation_still_connected');
  assert.equal(observation.first_model_response_sent,false);
  assert.equal(observation.first_won_before_retry_completion,false);
  assert.equal(observation.second_model_response_sent,true);
  assert.equal(observation.final_cached_summary,sentences.second,
   'canceled_first_generation_poisoned_retry_cache');
  assert.equal(observation.ui_contains_second,true,
   'actual retry did not update GameReportPanel with second response');
  assert.equal(observation.ui_contains_first,false);
 }else{
  assert.equal(observation.abort_bypass_count,1,'test_only_fault_not_exercised');
  assert.equal(observation.first_closed_before_release,false,
   'faulty_first_request_was_already_canceled');
  assert.equal(observation.first_model_response_sent,true,
   'QA first response was not delivered after Cancel');
  if(mode==='skip-first-abort'){
   assert.equal(observation.first_won_before_retry_completion,true,
    'QA corruption never reached the real SQLite cache');
   assert.equal(observation.final_cached_summary,sentences.first,
    'faulty first report did not poison the replacement cache');
   assert.equal(observation.ui_contains_first,false,
    'canceled report unexpectedly rendered in UI');
   assert.equal(observation.ui_contains_second,false,
    'second review unexpectedly succeeded despite stale cache collision');
   assert.match(observation.ui_error||'',/review_source_changed/,
    'backend did not signal the expected CAS conflict');
   throw Error('canceled_first_generation_poisoned_retry_cache');
  }
  assert.equal(observation.cache_after_new_release,sentences.second,
   'fresh_report_failed_to_commit_before_old_reply');
  assert.equal(observation.cache_after_old_release,sentences.second,
   'late_canceled_model_overwrote_newer_report');
  assert.equal(observation.final_cached_summary,sentences.second,
   'late_stale_generation_won_cache');
  assert.equal(observation.ui_contains_first,false);
  assert.equal(observation.ui_contains_second,true,
   'fresh_retry_was_displaced_in_ui');
  assert.equal(observation.ui_error,null);
  // The cache survives this schedule thanks to compare-and-swap, but the
  // injected browser has still failed to cancel a producer. Fail closed.
  throw Error('test_only_uncanceled_old_request_CAS_preserved_new_report');
 }
}catch(error){
 failure=error instanceof Error?error.stack||error.message:String(error);
}finally{
 if(browser)await browser.dispose().catch(()=>{});
 if(vite)await within(vite.close(),3000,'vite_close').catch(()=>{});
 process.chdir(initialCwd);
 if(server){server.closeAllConnections();await within(new Promise(ok=>server.close(ok)),1800,'api_close').catch(()=>{});}
 try{db?.close();}catch{}
 for(const pending of model.holds){if(!pending.res.destroyed){try{respond(pending);}catch{}}}
 llm.closeAllConnections();
 await within(new Promise(ok=>llm.close(ok)),1600,'model_close').catch(()=>{});
 rmSync(scratch,{recursive:true,force:true});
}
const report={schema_version:1,at_utc:new Date().toISOString(),run_id:runId,
 product_sha:productSha,backend_sha:backendSha,engine_sha256:engineHash,
 manifest_sha256:manifestHash,fixture_id:fixture.fixture_id,
 fault:mode,qa_verdict:failure?'fail':'pass',qa_error:failure,
 observation,elapsed_ms:Date.now()-started,
 synthetic_only:true,disposable_sqlite_only:true,
 release_approved:false,whole_browser_certified:false,
 limits:['Chrome 157 with original candidate Vite, local Hono server and loopback model',
  'One self-authored four-ply PGN and two real browser report attempts for one game',
  'Fault is injected only into test-only Chrome page, never candidate source',
  'No real external model, production DB, user history or sealed holdout']};
const output=join(results,mode==='skip-first-abort-old-last'
 ? 'review-browser-retry-fault-old-last.json'
 : mode?'review-browser-retry-fault.json':'review-browser-retry.json');
writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,run_id:runId,fault:mode,qa_verdict:report.qa_verdict,
  observation,qa_error:failure,elapsed_ms:report.elapsed_ms},null,2));
if(failure)process.exitCode=1;
