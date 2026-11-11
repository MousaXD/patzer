#!/usr/bin/env node
/**
 * Release adaptation of Agent D's real same-game concurrent SSE reviews, two bounded synthetic
 * sessions, one disposable SQLite, controlled loopback vLLM provider.
 * Deliberately create the last-writer race and test the source CAS.
 *
 * No production state or owned Agent A/B/C source changes.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { Hono } from 'hono';
import { Chess } from 'chess.js';

const root=resolve(import.meta.dirname,'..'), results=join(root,'qa/review-excellence/results');
mkdirSync(results,{recursive:true});
const args=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return i<0?[x.slice(2),true]:[x.slice(2,i),x.slice(i+1)];}));
const app=realpathSync(args['app-root']||join(results,'worktree-coach'));
assert(args['app-root'], 'Explicit isolated --app-root required');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const engine=realpathSync(args.engine||join(results,'engine/unpacked/usr/games/stockfish'));
if(!/^[a-f0-9]{64}$/.test(args['engine-sha256']||''))throw Error('Pinned --engine-sha256 required');
const engineHash=sha(readFileSync(engine));
assert.equal(engineHash,args['engine-sha256']);
const manifest=readFileSync(join(root,'qa/review-excellence/manifests/manifest-v2.jsonl'),'utf8');
const fixture=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.source_kind==='synthetic' && fixture.license==='self-authored');
const pgn=readFileSync(join(root,'qa/review-excellence/fixtures',fixture.pgn_file),'utf8');
assert.equal(sha(pgn),fixture.pgn_sha256);
const board=new Chess();board.loadPgn(pgn,{strict:true});
assert(board.isCheckmate()&&board.turn()==='w','require independent checkmate proof');

const work=mkdtempSync(join(results,'same-game-review-'));
process.env.DB_PATH=join(work,'synthetic-only.db');
process.env.SESSION_SECRET='qa-generated-only';
process.env.ENGINE_BACKEND='local';
process.env.STOCKFISH_PATH=engine;
process.env.STOCKFISH_THREADS='1';
process.env.STOCKFISH_HASH='16';
const state={requestCount:0,held:[],replies:[],errors:[],releases:[],resClosed:0};
let currentMode='hold',db=null,providerClosed=false;
const summaries={A:'Black won this game.',B:'Black won the game.'};
const prose={A:'Consider all checks before making a move.',B:'Review every move before choosing your next move.'};
const postReply=(res,tag,phase)=>{
 state.replies.push({tag,phase});
 res.writeHead(200,{'content-type':'application/json'});
 res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({
  title:'Key moment',
  prose:prose[tag],
  what_happened:prose[tag],
  summary:summaries[tag],
  skill_assessment:'One game cannot measure skill.',
  opening_prose:'The opening was recorded.'
 })}}]}));
};
function stageOf(body){
 const text=body?.messages?.at(-1)?.content||'';
 if(text.includes('Schema: { "summary"'))return 'summary';
 if(text.includes('title')&&text.includes('what_happened'))return 'moment';
 return 'phase';
}
const provider=createServer((req,res)=>{
 if(req.method==='GET'&&req.url==='/v1/models'){
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({data:[{id:'qa-concurrency-model'}]}));return;
 }
 if(req.method==='POST'&&req.url==='/v1/chat/completions'){
  let data='';
  req.on('data',chunk=>{data+=chunk;if(data.length>100000)req.destroy();});
  req.on('end',()=>{
   try{
    const body=JSON.parse(data);
    assert.equal(body.model,'qa-concurrency-model');
    state.requestCount++;
    res.on('close',()=>state.resClosed++);
    const phase=stageOf(body);
    if(currentMode==='hold'&&state.held.length<2){
     const tag=state.held.length===0?'A':'B';
     state.held.push({tag,res,phase});
     return;
    }
    if(currentMode==='hold')throw Error('Unexpected third request before race releases');
    postReply(res,currentMode,phase);
   }catch(error){state.errors.push(String(error));res.writeHead(500).end(String(error));}
  });return;
 }
 res.writeHead(404).end('not configured');
});
const deadline=(promise,ms,name)=>{
 let id;
 const timeout=new Promise((_,reject)=>{id=setTimeout(()=>reject(Error(name+'_timeout')),ms);});
 return Promise.race([promise,timeout]).finally(()=>clearTimeout(id));
};
const started=Date.now();
const outcome={};
try{
 await deadline(new Promise((resolve,reject)=>{provider.once('error',reject);provider.listen(0,'127.0.0.1',resolve);}),1500,'provider_listen');
 const {db:database,setSetting}=await import(join(app,'server/src/db.ts'));db=database;
 setSetting('llm_provider','vllm');
 setSetting('vllm_url','http://127.0.0.1:'+provider.address().port);
 setSetting('vllm_model','qa-concurrency-model');
 const {analyzePgn,saveAnalysis}=await import(join(app,'server/src/routes/analyze.ts'));
 const {createSession}=await import(join(app,'server/src/auth/sessions.ts'));
 const route=(await import(join(app,'server/src/routes/review.ts'))).default;
 const api=new Hono();api.route('/api/games',route);
 for(let id=1;id<=2;id++){
  db.prepare('INSERT INTO users (id,username,password_hash,role) VALUES (?,?,?,?)')
   .run(id,'qa-user-'+id,'qa-only-not-authentic','user');
  db.prepare('INSERT INTO profiles (user_id,display_name,language,audience) VALUES (?,?,?,?)')
   .run(id,'Synthetic User '+id,'en','beginner');
 }
 db.prepare('INSERT INTO games (id,user_id,source,pgn,user_color) VALUES (?,?,?,?,?)')
  .run(1,1,'imported',pgn,'white');
 const authorized=createSession(1),unauthorized=createSession(2);
 const header=c=>({Cookie:'chess_session='+c});
 const noAuth=await api.request('http://localhost/api/games/1/review',{method:'POST'});
 const other=await api.request('http://localhost/api/games/1/review',{method:'POST',headers:header(unauthorized)});
 assert.equal(noAuth.status,401);assert.equal(other.status,404);
 const {loadAnalysisGameSource}=await import(join(app,'server/src/chess/analysisSource.ts'));
 const analysis=await analyzePgn(pgn,8);assert.equal(saveAnalysis(1,analysis,loadAnalysisGameSource(db,1)),true);
 const readRaw=()=>db.prepare('SELECT prose_json FROM analyses WHERE game_id=1').get().prose_json;
 assert.equal(readRaw(),null);
 const startReview=async()=>{
  const response=await deadline(api.request('http://localhost/api/games/1/review',{
   method:'POST',headers:header(authorized)
  }),3500,'review_setup');
  assert.equal(response.status,200);
  // IMPORTANT: async functions flatten a returned Promise. Returning the
  // body Promise directly would await SSE completion before starting request
  // B, falsely making the "concurrency" harness sequential and deadlocked.
  // Package the promise in a non-thenable object; bound each read only when
  // the corresponding held provider is deliberately released.
  return {body:response.text()};
 };
 // A begins first but its provider is intentionally blocked. B also starts
 // from prose_json NULL, and thus both are eligible to generate.
 const {body:a}=await startReview();
 await deadline((async()=>{while(state.held.length<1)await new Promise(r=>setTimeout(r,5));})(),2000,'a_provider');
 const {body:b}=await startReview();
 await deadline((async()=>{while(state.held.length<2)await new Promise(r=>setTimeout(r,5));})(),2000,'b_provider');
 assert.equal(state.held[0].tag,'A');assert.equal(state.held[1].tag,'B');
 assert.equal(readRaw(),null);
 // Permit B to fully finish before A's first model response. All B model
 // requests after release are tagged B; A cannot write until B has finished.
 currentMode='B';
 state.releases.push('B phase first');
 postReply(state.held[1].res,'B',state.held[1].phase);
 const bSse=await deadline(b,5500,'b_review_complete');
 assert(bSse.includes('event: done'),'B should be the source-of-truth writer');
 assert(!bSse.includes('event: error'),'B should not fail');
 const storedB=JSON.parse(readRaw());
 outcome.b_saved=storedB.summary===summaries.B;
 assert.equal(outcome.b_saved,true,'B did not win the write');
 // Now allow A's delayed generation to finish. Its old database snapshot
 // must fail the actual saveReviewIfFresh atomic CAS and not overwrite B.
 currentMode='A';
 state.releases.push('A phase second');
 postReply(state.held[0].res,'A',state.held[0].phase);
 const aSse=await deadline(a,5500,'a_review_stale');
 outcome.a_done=aSse.includes('event: done');
 outcome.a_stale_error=aSse.includes('event: error')&&aSse.includes('review_source_changed');
 assert.equal(outcome.a_done,false,'stale review A incorrectly reported completion');
 assert.equal(outcome.a_stale_error,true,'stale review A was not rejected');
 const after=JSON.parse(readRaw());
 outcome.final_summary=after.summary;
 outcome.final_b_remains=after.summary===summaries.B;
 assert.equal(outcome.final_b_remains,true,'stale A overwrote B');
 const saved=await api.request('http://localhost/api/games/1/review',{headers:header(authorized)});
 assert.equal(saved.status,200);
 const json=await saved.json();
 outcome.read_b_verbatim=json.review?.summary===summaries.B;
 assert(outcome.read_b_verbatim);
 const otherRead=await api.request('http://localhost/api/games/1/review',{headers:header(unauthorized)});
 assert.equal(otherRead.status,404);
 outcome.cross_user_get_denied=true;
 outcome.no_auth_post_denied=true;
 outcome.cross_user_post_denied=true;
 outcome.b_done=true;
 outcome.same_source_both_started_without_cache=true;
 outcome.error_event=aSse.includes('review_source_changed');
 outcome.provider_calls=state.requestCount;
 outcome.provider_responses_closed=state.resClosed;
 outcome.provider_errors=state.errors;
 outcome.provider_reply_stages={
  A:state.replies.filter(x=>x.tag==='A').map(x=>x.phase),
  B:state.replies.filter(x=>x.tag==='B').map(x=>x.phase)
 };
 outcome.release_order=state.releases;
 outcome.a_summary=summaries.A;
 outcome.b_summary=summaries.B;
 outcome.duplicate_provider_work=state.requestCount>3;
 // The current route checks freshness after every progress stage. Once B is
 // saved, A must stop after its held phase instead of spending two more calls
 // before the final CAS. Keep the original historical runner unchanged.
 assert.equal(state.requestCount,4,'obsolete pipeline must stop after its first phase');
 assert.equal(state.resClosed,4,'provider resource leak');
 assert.deepEqual(outcome.provider_reply_stages.A,['phase'],
  'obsolete request A continued after the winning report was persisted');
 assert.deepEqual(outcome.provider_reply_stages.B,['phase','moment','summary'],
  'request B did not actually complete all three stages');
 assert.deepEqual(state.errors,[]);
}finally{
 try{db?.close();}catch{}
 provider.closeAllConnections();
 await deadline(new Promise(done=>provider.close(done)),1500,'mock_close').catch(()=>{});
 rmSync(work,{recursive:true,force:true});
}
const report={
 schema_version:1,at_utc:new Date().toISOString(),
 candidate_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),
 manifest_sha256:sha(manifest),engine_sha256:engineHash,
 fixture_id:fixture.fixture_id,source_rights:'self-authored synthetic; disposable SQLite and sessions',
 scope:'two concurrent authenticated real POST Game Review SSE requests with controlled opposite completion order',
 observation:outcome,elapsed_ms:Date.now()-started,
 correct_stale_write_cas:outcome.a_stale_error&&outcome.final_b_remains,
 concurrent_coalescing_observed:!outcome.duplicate_provider_work,
 release_approved:false,overall_product_certified:false,
 limits:['One synthetic game and two concurrent in-process Hono requests',
  'No real HTTP reverse proxy, browser, external LLM, user data or production database',
  'Provider deliberately reorders the first model response; later calls are deterministic',
  'Duplicate work observation is bounded to these two overlapping requests, not a throughput SLO',
  'No statements about full game-review truth, cache freshness after reanalysis or release readiness']
};
const dest=join(results,'release-concurrent-real-route.json');
writeFileSync(dest,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({file:dest,sha:report.candidate_sha,...outcome,
 correct_cas:report.correct_stale_write_cas,coalesced:report.concurrent_coalescing_observed,ms:report.elapsed_ms},null,2));
