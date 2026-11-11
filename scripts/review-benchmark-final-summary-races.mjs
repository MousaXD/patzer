#!/usr/bin/env node
/**
 * Agent D: final model-response races in the real Game Review route.
 *
 * 1. Re-analysis while the final JSON response is pending -> must reject.
 * 2. Profile language changed while final response is pending -> detect
 *    whether old-language prose is saved/delivered and autoreview stuck.
 * 3. Cancellation while FINAL response is pending -> must not persist.
 *
 * Only disposable SQLite, synthetic licensed PGN, pinned Stockfish, and
 * loopback mock LLM. Never launches Patzer's active server.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, realpathSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { Hono } from 'hono';
import { Chess } from 'chess.js';
const root=resolve(import.meta.dirname,'..'), results=join(root,'qa/review-excellence/results');
mkdirSync(results,{recursive:true});
const args=Object.fromEntries(process.argv.slice(2).map(x=>{const n=x.indexOf('=');return n<0?[x.slice(2),true]:[x.slice(2,n),x.slice(n+1)];}));
const app=realpathSync(args['app-root']||join(results,'worktree-coach'));
assert(app.startsWith(join(results,'worktree-')),'candidate must be an isolated QA worktree');
const sha=b=>createHash('sha256').update(b).digest('hex');
const engine=realpathSync(args.engine||join(results,'engine/unpacked/usr/games/stockfish'));
assert(/^[0-9a-f]{64}$/.test(args['engine-sha256']||''),'pin engine before running');
const engineHash=sha(readFileSync(engine));
assert.equal(engineHash,args['engine-sha256']);
const manifest=readFileSync(join(root,'qa/review-excellence/manifests/manifest-v2.jsonl'),'utf8');
const fixture=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.source_kind==='synthetic'&&fixture.license==='self-authored');
const pgn=readFileSync(join(root,'qa/review-excellence/fixtures',fixture.pgn_file),'utf8');
assert.equal(sha(pgn),fixture.pgn_sha256);
const chess=new Chess();chess.loadPgn(pgn,{strict:true});assert(chess.isCheckmate()&&chess.turn()==='w');
const scratch=mkdtempSync(join(results,'final-summary-race-'));
process.env.DB_PATH=join(scratch,'synthetic-only.db');
process.env.SESSION_SECRET='qa-test-only';
process.env.ENGINE_BACKEND='local';
process.env.STOCKFISH_PATH=engine;
process.env.STOCKFISH_THREADS='1';
process.env.STOCKFISH_HASH='16';
let mode='instant',db=null;
const waiting=[],stats={requestCount:0,responseClosed:0,stages:[]};
const payload={
 title:'Review move',prose:'Review every move before choosing your next move.',
 what_happened:'Review every move before choosing your next move.',
 summary:'Black won the game.',
 skill_assessment:'One game cannot estimate a rating.',
 opening_prose:'The opening was recorded.'
};
function stage(input){
 const t=input?.messages?.at(-1)?.content||'';
 if(t.includes('Schema: { "summary"'))return 'summary';
 if(t.includes('title')&&t.includes('what_happened'))return 'moment';
 return 'phase';
}
const reply=res=>{
 res.writeHead(200,{'content-type':'application/json'});
 res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(payload)}}]}));
};
const llm=createServer((req,res)=>{
 if(req.method==='GET'&&req.url==='/v1/models'){
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({data:[{id:'qa-final-summary'}]}));return;
 }
 if(req.method==='POST'&&req.url==='/v1/chat/completions'){
  let input='';
  req.on('data',chunk=>{input+=chunk;if(input.length>100000)req.destroy();});
  req.on('end',()=>{
   try{
    const body=JSON.parse(input);assert.equal(body.model,'qa-final-summary');
    stats.requestCount++;
    const phase=stage(body);stats.stages.push({mode,phase});
    res.on('close',()=>stats.responseClosed++);
    if(mode!=='instant'&&phase==='summary')waiting.push({mode,res});
    else reply(res);
   }catch(error){res.writeHead(500).end(String(error));}
  });
  return;
 }
 res.writeHead(404).end();
});
const deadline=(work,ms,label)=>{
 let timer;
 return Promise.race([work,new Promise((_,fail)=>{timer=setTimeout(()=>fail(Error(label+'_deadline')),ms);})])
  .finally(()=>clearTimeout(timer));
};
const after=async(check,ms,label)=>{
 await deadline((async()=>{while(!check())await new Promise(r=>setTimeout(r,5));})(),ms,label);
};
let started=Date.now(),report={};
try {
 await deadline(new Promise((ok,fail)=>{llm.once('error',fail);llm.listen(0,'127.0.0.1',ok);}),1500,'listener');
 const {db:database,setSetting}=await import(join(app,'server/src/db.ts'));db=database;
 setSetting('llm_provider','vllm');setSetting('vllm_url','http://127.0.0.1:'+llm.address().port);setSetting('vllm_model','qa-final-summary');
 const {analyzePgn,saveAnalysis}=await import(join(app,'server/src/routes/analyze.ts'));
 const {createSession}=await import(join(app,'server/src/auth/sessions.ts'));
 const reviewRoute=(await import(join(app,'server/src/routes/review.ts'))).default;
 const api=new Hono();api.route('/api/games',reviewRoute);
 db.prepare('INSERT INTO users(id,username,password_hash,role) VALUES (?,?,?,?)').run(1,'qa-only-user','qa-only-hash','user');
 db.prepare('INSERT INTO profiles(user_id,display_name,language,audience) VALUES (?,?,?,?)')
  .run(1,'Synthetic User','en','beginner');
 for(let gameId=1;gameId<=3;gameId++){
  db.prepare('INSERT INTO games(id,user_id,source,pgn,user_color) VALUES (?,?,?,?,?)')
   .run(gameId,1,'imported',pgn,'white');
 }
 const analysis=await analyzePgn(pgn,8);
 for(let id=1;id<=3;id++)saveAnalysis(id,analysis);
 const auth=createSession(1),headers={Cookie:'chess_session='+auth};
 const raw=id=>db.prepare('SELECT accuracy_white,prose_json,prose_lang,scoring_version FROM analyses WHERE game_id=?').get(id);
 async function post(id,signal){
  const response=await deadline(api.request('http://localhost/api/games/'+id+'/review',{
   method:'POST',headers,...(signal?{signal}:{})
  }),3000,'open_'+id);
  assert.equal(response.status,200);
  return {body:response.text()};
 }
 async function get(id){
  const res=await api.request('http://localhost/api/games/'+id+'/review',{headers});
  assert.equal(res.status,200);
  return res.json();
 }
 const queue=id=>db.prepare('SELECT count(*) AS n FROM analyses WHERE game_id=? AND prose_json IS NULL').get(id).n;
 // Source reanalysis while final LLM response still pending.
 mode='source_change';
 const {body:sourceBody}=await post(1);
 await after(()=>waiting.some(x=>x.mode==='source_change'),3000,'source_summary');
 const before=raw(1);
 assert.equal(before.prose_json,null);
 const changed={...analysis,accuracy_white:Math.max(0,analysis.accuracy_white-20)};
 assert.notEqual(changed.accuracy_white,before.accuracy_white);
 saveAnalysis(1,changed);
 const now=raw(1);
 assert.equal(now.accuracy_white,changed.accuracy_white);
 const w1=waiting.find(x=>x.mode==='source_change');
 mode='instant';reply(w1.res);
 const sseSource=await deadline(sourceBody,4000,'source_reply');
 report.reanalysis={
  original_accuracy:before.accuracy_white,new_accuracy:changed.accuracy_white,
  stale_done:sseSource.includes('event: done'),
  stale_error:sseSource.includes('event: error')&&sseSource.includes('review_source_changed'),
  cache_null:raw(1).prose_json===null,
  pending_autoreview_queue:queue(1)
 };
 report.raw_sse={source:sseSource};
 assert(report.reanalysis.stale_error&&!report.reanalysis.stale_done);
 assert.equal(report.reanalysis.cache_null,true);
 assert.equal(report.reanalysis.pending_autoreview_queue,1);
 // Profile changes while the final LLM response is pending. The current
 // CAS compares game and analysis evidence but not the profile language.
 // The user can then receive an outdated-language "done", and GET is stale.
 mode='profile_change';
 const {body:profileBody}=await post(2);
 await after(()=>waiting.some(x=>x.mode==='profile_change'),3000,'profile_summary');
 assert.equal(raw(2).prose_json,null);
 db.prepare('UPDATE profiles SET language=? WHERE user_id=1').run('es');
 const w2=waiting.find(x=>x.mode==='profile_change');
 mode='instant';reply(w2.res);
 const sseProfile=await deadline(profileBody,4000,'profile_reply');
 const row2=raw(2);
 const get2=await get(2);
 report.profile_change={
  old_language:'en',new_language:'es',
  emitted_done:sseProfile.includes('event: done'),
  cached_prose_language:row2.prose_lang,
  old_language_cache_saved:row2.prose_json!==null&&row2.prose_lang==='en',
  stale_get:get2.stale===true&&get2.review===null,
  auto_review_queued:queue(2),
  delivered_old_language_in_sse:sseProfile.includes('"language":"en"')
 };
 report.raw_sse.profile=sseProfile;
 assert(report.profile_change.emitted_done,'test needs to demonstrate old review delivery');
 assert(report.profile_change.old_language_cache_saved,'old language not cached');
 assert(report.profile_change.stale_get,'new-language GET unexpectedly returned old review');
 assert.equal(report.profile_change.auto_review_queued,0,'old-language cached review unexpectedly queued for auto regen');
 assert.equal(report.profile_change.delivered_old_language_in_sse,true);
 // Cancellation at final summary request (not at initial phase). Test the
 // already verified cancellation behavior at a distinct point in lifecycle.
 db.prepare('UPDATE profiles SET language=? WHERE user_id=1').run('en');
 mode='cancel_summary';
 const controller=new AbortController();
 const {body:cancelBody}=await post(3,controller.signal);
 await after(()=>waiting.some(x=>x.mode==='cancel_summary'),3000,'cancel_summary');
 assert.equal(raw(3).prose_json,null);
 controller.abort();
 const canceled=await deadline(cancelBody,2000,'cancel_body');
 await new Promise(r=>setTimeout(r,160));
 report.cancel_last_model={
  summary_request_reached:true,
  sse_closed:true,
  done_emitted:canceled.includes('event: done'),
  observed_stream_bytes:canceled.length,
  cache_null:raw(3).prose_json===null,
  pending_autoreview_queue:queue(3)
 };
 report.raw_sse.cancel=canceled;
 assert(canceled.length>0,'model cancellation did not provide real closed SSE evidence');
 assert.equal(report.cancel_last_model.done_emitted,false);
 assert.equal(report.cancel_last_model.cache_null,true);
 assert.equal(report.cancel_last_model.pending_autoreview_queue,1);
 report.total_model_calls=stats.requestCount;
 report.raw_provider_response_closures=stats.responseClosed;
 report.stage_counts=stats.stages.reduce((m,x)=>(m[x.mode]=(m[x.mode]||0)+1,m),{});
}finally{
 try{db?.close();}catch{}
 llm.closeAllConnections();
 await deadline(new Promise(done=>llm.close(done)),1500,'cleanup').catch(()=>{});
 rmSync(scratch,{recursive:true,force:true});
}
const result={
 schema_version:1,at_utc:new Date().toISOString(),
 candidate_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),
 manifest_sha256:sha(manifest),engine_sha256:engineHash,
 fixture_id:fixture.fixture_id,
 rights:'self-authored synthetic, disposable SQLite, synthetic profile, local mock only',
 scope:'three real authenticated SSE runs held at the final model JSON response',
 outcomes:report,elapsed_ms:Date.now()-started,
 reanalysis_cas_protected:report.reanalysis.stale_error&&report.reanalysis.cache_null,
 midflight_profile_language_race_reproduced:report.profile_change.old_language_cache_saved&&report.profile_change.stale_get,
 final_summary_cancel_safe:report.cancel_last_model.cache_null&&!report.cancel_last_model.done_emitted,
 product_certified:false,release_approved:false,
 notes:['The profile language update is a test-only mutation to disposable DB, not user data',
  'The auth/profile source itself is not modified; route is real implementation',
  'Synthetic four-ply game and one mock provider; no representative production frequency claim',
  'Cancellation occurs while final model request is pending, NOT in the synchronous commit instruction window']
};
const out=join(results,'review-final-summary-races.json');
writeFileSync(out,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({file:out,candidate:result.candidate_sha,claims:{
 reanalysis_cas_protected:result.reanalysis_cas_protected,
 midflight_profile_language_race_reproduced:result.midflight_profile_language_race_reproduced,
 final_summary_cancel_safe:result.final_summary_cancel_safe},
 outcomes:report,elapsed_ms:result.elapsed_ms},null,2));
