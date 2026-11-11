#!/usr/bin/env node
/**
 * Agent D — two distinct Node processes, one disposable WAL SQLite database,
 * real localhost HTTP review and logout requests, held local model response.
 * This differs from Checkpoint 18's same-process Hono test. No production DB,
 * active app, third-party model, authenticated Chess.com or credentials.
 */
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync,fork} from 'node:child_process';
import {createServer} from 'node:http';
import {join,resolve,relative,sep,isAbsolute} from 'node:path';
import {Chess} from 'chess.js';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const results=join(qa,'results');mkdirSync(results,{recursive:true});
const cli=Object.fromEntries(process.argv.slice(2).map(x=>{
 const i=x.indexOf('=');return i<0?[x.slice(2),true]:[x.slice(2,i),x.slice(i+1)];
}));
assert(!cli.fault||cli.fault==='grant-revoked','unexpected QA-only fault');
const runId=cli['run-id']||randomUUID();
assert(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(runId));
const sha=x=>createHash('sha256').update(x).digest('hex');
const candidate=realpathSync(cli['app-root']||join(results,'worktree-coach'));
assert(relative(results,candidate).startsWith('worktree-'),'candidate must be detached QA worktree');
const candidateSha=execFileSync('git',['rev-parse','HEAD'],{cwd:candidate,encoding:'utf8'}).trim();
assert.equal(candidateSha,'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87');
const engine=realpathSync(cli.engine||join(results,'engine/unpacked/usr/games/stockfish'));
const engineHash=sha(readFileSync(engine));
assert(/^[a-f0-9]{64}$/.test(cli['engine-sha256']||''));
assert.equal(engineHash,cli['engine-sha256']);
const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8');
const fixture=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.source_kind==='synthetic'&&fixture.license==='self-authored');
const pgn=readFileSync(join(qa,'fixtures',fixture.pgn_file),'utf8');
assert.equal(sha(pgn),fixture.pgn_sha256);
const chess=new Chess();chess.loadPgn(pgn,{strict:true});
assert(chess.isCheckmate()&&chess.turn()==='w'&&chess.header().Result==='0-1');

const scratch=mkdtempSync(join(results,'crossproc-logout-'));
const dbPath=join(scratch,'synthetic.db');
const secret='qa-disposable-signed-cookie';
const commonEnv={PATH:process.env.PATH,HOME:process.env.HOME,TZ:'UTC',
 NODE_ENV:'test',DB_PATH:dbPath,SESSION_SECRET:secret,ENGINE_BACKEND:'local',
 STOCKFISH_PATH:engine,STOCKFISH_THREADS:'1',STOCKFISH_HASH:'16',OIDC_ENABLED:'false'};
Object.assign(process.env,commonEnv);

const modelName='qa-crossprocess-local-model';
const model={requests:0,closed:0,stages:[],held:null,errors:[]};
const text={title:'QA legal moment',prose:'Review the played moves.',
 what_happened:'Review the played moves.',opening_prose:'The opening was recorded.',
 summary:'Black won the game.',skill_assessment:'One game does not determine rating.'};
const respond=res=>{
 res.writeHead(200,{'content-type':'application/json'});
 res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(text)}}]}));
};
const llm=createServer((req,res)=>{
 if(req.method==='GET'&&req.url==='/v1/models'){
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({data:[{id:modelName}]}));return;
 }
 if(req.method==='POST'&&req.url==='/v1/chat/completions'){
  let data='';req.on('data',b=>{data+=b;if(data.length>100000)req.destroy();});
  req.on('end',()=>{
   try{
    const body=JSON.parse(data);assert.equal(body.model,modelName);
    const user=body.messages?.find(m=>m.role==='user')?.content||'';
    assert.equal(typeof user,'string');
    const stage=user.includes('Schema: { "summary"')?'summary':
     user.includes('"what_happened"')?'moment':'phase';
    model.requests++;model.stages.push(stage);res.on('close',()=>model.closed++);
    if(stage==='summary'&&!model.held){model.held=res;return;}
    respond(res);
   }catch(e){model.errors.push(String(e));res.writeHead(500).end(String(e));}
  });return;
 }
 res.writeHead(404).end();
});

function deadline(p,ms,name){let t;return Promise.race([p,new Promise((_,fail)=>{
 t=setTimeout(()=>fail(Error(name+'_timeout')),ms);
})]).finally(()=>clearTimeout(t));}
const until=(predicate,name)=>deadline((async()=>{
 while(!predicate())await new Promise(done=>setTimeout(done,7));
})(),4500,name);

const workers=[];
function spawnWorker(id){
 const c=fork(join(root,'scripts/review-benchmark-revocation-worker.mjs'),[
  '--candidate='+candidate,'--worker-id='+id,
  ...(cli.fault==='grant-revoked'&&id==='review'?['--fault=grant-revoked']:[])],{
  cwd:root,env:{...commonEnv},execArgv:['--import','tsx'],
  stdio:['ignore','pipe','pipe','ipc'],
 });
 workers.push(c);
 const logs=[];
 for(const stream of [c.stdout,c.stderr])stream.on('data',data=>{
  if(logs.join('').length<10000)logs.push(String(data).slice(0,2500));
 });
 const ready=deadline(new Promise((ok,fail)=>{
  c.on('error',fail);
  c.on('exit',(code,signal)=>fail(Error('worker_'+id+'_exited_'+code+'_'+signal+': '+logs.join(''))));
  c.on('message',m=>{
   if(m?.type==='worker_error')fail(Error('worker_'+id+'_error_'+m.message));
   if(m?.type==='ready'&&m.worker_id===id)ok(m);
  });
 }),12000,'worker_'+id+'_startup');
 return ready;
}

const observations={},t0=Date.now();
let db=null;
try{
 await deadline(new Promise((ok,fail)=>{llm.once('error',fail);llm.listen(0,'127.0.0.1',ok);}),2000,'mock_listen');
 const {db:database,setSetting}=await import(join(candidate,'server/src/db.ts'));db=database;
 setSetting('llm_provider','vllm');
 setSetting('vllm_url','http://127.0.0.1:'+llm.address().port);
 setSetting('vllm_model',modelName);
 const {analyzePgn,saveAnalysis}=await import(join(candidate,'server/src/routes/analyze.ts'));
 const {createSession}=await import(join(candidate,'server/src/auth/sessions.ts'));
 db.prepare('INSERT INTO users(id,username,password_hash,role) VALUES(?,?,?,?)')
  .run(1,'qa-synthetic-account','synthetic-no-password','user');
 db.prepare('INSERT INTO profiles(user_id,display_name,language,audience) VALUES(?,?,?,?)')
  .run(1,'Synthetic owner','en','beginner');
 db.prepare('INSERT INTO games(id,user_id,source,pgn,user_color) VALUES(?,?,?,?,?)')
  .run(1,1,'imported',pgn,'white');
 const analysis=await analyzePgn(pgn,8);
 saveAnalysis(1,analysis);
 const session=createSession(1),cookie='chess_session='+session;
 const rows=()=>db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=1').get().n;
 assert.equal(rows(),1);
 const ready=await Promise.all([spawnWorker('review'),spawnWorker('logout')]);
 const a=ready[0],b=ready[1];
 assert(a.pid!==b.pid&&a.port!==b.port,'must prove separate process and socket');
 observations.worker_pids=[a.pid,b.pid];
 observations.worker_ports=[a.port,b.port];
 const A='http://127.0.0.1:'+a.port;
 const B='http://127.0.0.1:'+b.port;
 const req=(base,path,method='GET',withCookie=cookie,probe=false)=>deadline(fetch(base+path,{
  method,headers:{...(withCookie?{Cookie:withCookie}:{}),
   ...(probe?{'X-QA-Adversarial-Admission':'grant-revoked'}:{})},
 }),5000,method+'_'+path);
 // Both independent processes initially see the same valid signed cookie.
 const initial=await Promise.all([req(A,'/api/games/1/review'),req(B,'/api/games/1/review')]);
 observations.pre_logout_get=[initial[0].status,initial[1].status];
 assert.deepEqual(observations.pre_logout_get,[200,200]);
 for(const r of initial){
  const response=await r.json();
  // No cached prose is different from an *existing but stale* prose entry.
  // The real GET contract deliberately omits `stale` for an empty cache.
  assert.deepEqual(response,{review:null});
 }
 const inFlight=await req(A,'/api/games/1/review','POST');
 observations.pre_admitted_post_status=inFlight.status;
 assert.equal(inFlight.status,200);
 const inFlightBody=inFlight.text();
 // If an adversarial assertion interrupts the experiment, the final cleanup
 // can disconnect this reader. Consume its potential cleanup rejection so it
 // does not masquerade as the intended admission-security failure.
 inFlightBody.catch(()=>{});
 await until(()=>model.held!==null,'model_final_held');
 observations.model_final_held_at_logout=model.held!==null;
 observations.cache_null_when_logout_started=
  db.prepare('SELECT prose_json FROM analyses WHERE game_id=1').get().prose_json===null;
 assert(observations.model_final_held_at_logout&&observations.cache_null_when_logout_started);
 const logout=await req(B,'/api/auth/logout','POST');
 observations.logout_status=logout.status;
 const logged=await logout.json();
 observations.logout_acknowledged=logged.ok===true;
 const h=logout.headers.get('set-cookie')||'';
 observations.cookie_expired=/chess_session=\s*;/i.test(h)&&
  /(?:max-age=0|expires=thu,\s*01 jan 1970)/i.test(h);
 observations.session_rows_after_logout=rows();
 assert.equal(observations.logout_status,200);
 assert(observations.logout_acknowledged&&observations.cookie_expired);
 assert.equal(rows(),0,'second process did not revoke shared SQLite session');
 // Actual network requests after cross-process deletion; both must fail.
 const checks=await Promise.all([
  req(A,'/api/games/1/review','GET',cookie,cli.fault==='grant-revoked'),
  req(A,'/api/games/1/review','POST'),
  req(B,'/api/games/1/review'),req(B,'/api/games/1/review','POST'),
 ]);
 observations.old_cookie_statuses=checks.map(x=>x.status);
 assert.deepEqual(observations.old_cookie_statuses,[401,401,401,401],
  'revoked_cookie_accepted_by_worker');
 // Invalid signature remains rejected by both, independent of revocation.
 const invalid=session.slice(0,-1)+(session.at(-1)==='a'?'b':'a');
 const invalidReq=await Promise.all([
  req(A,'/api/games/1/review','GET','chess_session='+invalid),
  req(B,'/api/games/1/review','GET','chess_session='+invalid),
 ]);
 observations.tampered_cookie_statuses=invalidReq.map(x=>x.status);
 assert.deepEqual(observations.tampered_cookie_statuses,[401,401]);
 // Whether the already admitted stream must be killed is unspecified. Measure.
 respond(model.held);model.held=null;
 const wire=await deadline(inFlightBody,7000,'pre_admitted_sse');
 observations.pre_admitted_sse=wire;
 observations.pre_admitted_stream_done=wire.includes('event: done')&&!wire.includes('event: error');
 observations.cache_written_after_logout=
  db.prepare('SELECT prose_json FROM analyses WHERE game_id=1').get().prose_json!==null;
 assert(observations.pre_admitted_stream_done&&observations.cache_written_after_logout);
 // A brand new session must be visible to both independent processes.
 const newer=createSession(1),newCookie='chess_session='+newer;
 observations.new_session_count=rows();
 const restored=await Promise.all([
  req(A,'/api/games/1/review','GET',newCookie),
  req(B,'/api/games/1/review','GET',newCookie),
 ]);
 observations.fresh_cookie_statuses=restored.map(x=>x.status);
 assert.deepEqual(observations.fresh_cookie_statuses,[200,200]);
 const stored=await Promise.all(restored.map(x=>x.json()));
 observations.new_cookie_summaries=stored.map(x=>x.review?.summary??null);
 assert.deepEqual(observations.new_cookie_summaries,[text.summary,text.summary]);
 observations.model_calls=model.requests;
 observations.provider_closed=model.closed;
 observations.model_stages=model.stages;
 observations.model_errors=model.errors;
 assert.equal(model.requests,3);assert.equal(model.closed,3);
 assert.deepEqual(model.stages,['phase','moment','summary']);
 assert.deepEqual(model.errors,[]);
}finally{
 if(model.held){try{respond(model.held);}catch{}}
 for(const child of workers){
  if(child.connected)child.send({type:'stop'});
 }
 await Promise.all(workers.map(c=>deadline(new Promise(ok=>{
  if(c.exitCode!==null||c.signalCode!==null)return ok();
  c.once('exit',ok);
 }),2500,'worker_exit').catch(()=>{c.kill('SIGKILL');})));
 try{db?.close();}catch{}
 llm.closeAllConnections();
 await deadline(new Promise(ok=>llm.close(ok)),1600,'provider_close').catch(()=>{});
 rmSync(scratch,{recursive:true,force:true});
}
const report={schema_version:1,at_utc:new Date().toISOString(),
 benchmark_run_id:runId,
 candidate_sha:candidateSha,engine_sha256:engineHash,
 manifest_sha256:sha(manifest),fixture_id:fixture.fixture_id,
 rights:'self-authored synthetic chess, fake sessions and disposable WAL SQLite only',
 scope:'two independent real HTTP Node workers with shared disposable SQLite and mid-review logout',
 observations,elapsed_ms:Date.now()-t0,
 qa_test_only_http_fault:cli.fault||null,
 cross_process_new_request_revocation_passed:true,
 pre_admitted_stream_continues:true,
 in_flight_cancel_policy:'unspecified',release_approved:false,
 overall_authentication_certified:false,
 limitations:['two isolated localhost Node workers, not production reverse proxy or browser logout',
  'CSRF/global middleware and external identity providers are not included in the minimal mounted route worker',
  'one synthetic account, one session revoked during a single held model response',
  'real user history and production SQLite were never accessed']};
const path=join(results,'review-crossprocess-logout.json');
writeFileSync(path,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({path,worker_pids:observations.worker_pids,
  benchmark_run_id:runId,
  worker_ports:observations.worker_ports,
  old_cookie_statuses:observations.old_cookie_statuses,
  pre_admitted_stream_continues:observations.pre_admitted_stream_done,
  new_cookie_summaries:observations.new_cookie_summaries,
  model_calls:observations.model_calls,elapsed_ms:report.elapsed_ms,
  release_approved:false},null,2));
