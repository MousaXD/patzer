#!/usr/bin/env node
/**
 * Test actual authenticated Game Review SSE cancellation against an
 * intentionally stalled *localhost* LLM provider with disposable SQLite.
 * The purpose is to verify no incomplete report survives a client abort.
 */
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {resolve,join} from 'node:path';
import {Hono} from 'hono';
import {Chess} from 'chess.js';

const root=resolve(import.meta.dirname,'..');
const results=join(root,'qa/review-excellence/results');mkdirSync(results,{recursive:true});
const args=Object.fromEntries(process.argv.slice(2).map(x=>{const n=x.indexOf('=');return n<0?[x.slice(2),true]:[x.slice(2,n),x.slice(n+1)];}));
const appRoot=realpathSync(args['app-root']||join(results,'worktree-coach'));
assert(appRoot.startsWith(join(results,'worktree-')),'candidate must be detached QA worktree');
const engine=realpathSync(args.engine||join(results,'engine/unpacked/usr/games/stockfish'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const engineSha=sha(readFileSync(engine));
assert(/^[a-f0-9]{64}$/.test(args['engine-sha256']||''),'engine pin required');
assert.equal(engineSha,args['engine-sha256']);
const manifest=readFileSync(join(root,'qa/review-excellence/manifests/manifest-v2.jsonl'),'utf8');
const meta=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(meta?.source_kind==='synthetic'&&meta.license==='self-authored');
const pgn=readFileSync(join(root,'qa/review-excellence/fixtures',meta.pgn_file),'utf8');
assert.equal(sha(pgn),meta.pgn_sha256);
const board=new Chess();board.loadPgn(pgn,{strict:true});assert(board.isCheckmate()&&board.turn()==='w');

const scratch=mkdtempSync(join(results,'coach-cancel-'));
process.env.DB_PATH=join(scratch,'qa-synthetic-only.db');
process.env.SESSION_SECRET='qa-only-not-a-real-session';
process.env.STOCKFISH_PATH=engine;
process.env.STOCKFISH_THREADS='1';
process.env.STOCKFISH_HASH='16';
process.env.ENGINE_BACKEND='local';
const started=Date.now();
let mode='stall',providerPosts=0,serverClosures=0;
let pendingSignal=null;
const signalReady=()=>new Promise(resolve=>{pendingSignal=resolve;});
const good={
 title:'Review move',
 prose:'Review your options before committing to a move.',
 what_happened:'Review your options before committing to a move.',
 summary:'Black won the game.',
 skill_assessment:'One game is not proof of playing strength.',
 opening_prose:'This game began with opening moves.'
};
const provider=createServer((req,res)=>{
 if(req.method==='GET'&&req.url==='/v1/models'){
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({data:[{id:'qa-cancel-llm'}]}));return;
 }
 if(req.method==='POST'&&req.url==='/v1/chat/completions'){
  let body='';
  req.on('data',chunk=>{body+=chunk;if(body.length>100000)req.destroy();});
  req.on('end',()=>{
   try{
    const r=JSON.parse(body);
    assert.equal(r.model,'qa-cancel-llm');
    providerPosts++;
    res.on('close',()=>serverClosures++);
    if(mode==='stall'){
     pendingSignal?.();
     return; // wait for caller to abort; never send data
    }
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(good)}}]}));
   }catch(e){res.writeHead(500);res.end(JSON.stringify({error:String(e)}));}
  });return;
 }
 res.writeHead(404);res.end();
});
let db=null;
const resultsObject={};
function deadline(p,ms,label){
 let timer;
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+'_timeout_'+ms)),ms);});
 return Promise.race([p,timeout]).finally(()=>clearTimeout(timer));
}
try{
 await deadline(new Promise((ok,fail)=>{provider.once('error',fail);provider.listen(0,'127.0.0.1',ok);}),1500,'listen');
 const {db:database,setSetting}=await import(join(appRoot,'server/src/db.ts'));
 db=database;
 setSetting('llm_provider','vllm');
 setSetting('vllm_url','http://127.0.0.1:'+provider.address().port);
 setSetting('vllm_model','qa-cancel-llm');
 const {analyzePgn,saveAnalysis}=await import(join(appRoot,'server/src/routes/analyze.ts'));
 const {createSession}=await import(join(appRoot,'server/src/auth/sessions.ts'));
 const route=(await import(join(appRoot,'server/src/routes/review.ts'))).default;
 const api=new Hono();api.route('/api/games',route);
 for(let id=1;id<=2;id++){
  db.prepare('INSERT INTO users (id,username,password_hash,role) VALUES (?,?,?,?)')
   .run(id,'qa-user-'+id,'qa-not-valid-credentials','user');
  db.prepare('INSERT INTO profiles (user_id,display_name,language,audience) VALUES (?,?,?,?)')
   .run(id,'QA User '+id,'en','beginner');
 }
 db.prepare('INSERT INTO games (id,user_id,source,pgn,user_color) VALUES (?,?,?,?,?)')
   .run(1,1,'imported',pgn,'white');
 const cookie=createSession(1),otherCookie=createSession(2);
 const headers=c=>({'Cookie':'chess_session='+c});
 const rejectAnon=await api.request('http://localhost/api/games/1/review',{method:'POST'});
 const rejectCross=await api.request('http://localhost/api/games/1/review',{method:'POST',headers:headers(otherCookie)});
 assert.equal(rejectAnon.status,401);assert.equal(rejectCross.status,404);
 const analysis=await analyzePgn(pgn,8);saveAnalysis(1,analysis);
 const cached=()=>db.prepare('SELECT prose_json FROM analyses WHERE game_id=1').get().prose_json;
 assert.equal(cached(),null);
 // This is actual route->buildGameReview->chatJson via Hono with a stalled
 // provider response. We abort after the first POST actually reaches the mock.
 const controller=new AbortController();
 const firstRequest=signalReady();
 const request=await deadline(api.request('http://localhost/api/games/1/review',{
  method:'POST',headers:headers(cookie),signal:controller.signal
 }),3500,'construct_sse');
 assert.equal(request.status,200);
 // Do not turn a rejected read into "closed with no done" evidence. A real
 // stream read must actually resolve for this narrow cancellation certificate.
 const bodyTask=request.text();
 await deadline(firstRequest,3500,'first_llm_request');
 assert.equal(providerPosts,1);
 controller.abort();
 // Fail CLOSED if the abort never closes SSE. A superficial test can falsely
 // pass by treating an unanswered body/read timeout as an empty response.
 // Do not infer a clean cancellation from an empty string fabricated by QA.
 const canceledBody=await deadline(bodyTask,1200,'sse_abort_close');
 resultsObject.aborted_sse_closed=true;
 // The asynchronous request callback must have had a bounded opportunity
 // to commit; verify the persisted source after the actual SSE completion.
 await new Promise(r=>setTimeout(r,180));
 resultsObject.aborted_request_cache_absent=cached()===null;
 resultsObject.aborted_before_any_model_reply=true;
 resultsObject.provider_posts_when_canceled=providerPosts;
 resultsObject.aborted_sse_emitted_done=canceledBody.includes('event: done');
 resultsObject.aborted_sse_body_bytes=canceledBody.length;
 assert.equal(resultsObject.aborted_request_cache_absent,true,'aborted review wrote cache');
 assert.equal(resultsObject.aborted_sse_emitted_done,false,'aborted review announced completion');
 // After abort, the same authorized real route must still work. The
 // previous canceled response must not prevent an independently generated
 // new review. No Stockfish rerun needed.
 mode='valid';
 const request2=await deadline(api.request('http://localhost/api/games/1/review',{
  method:'POST',headers:headers(cookie)
 }),3500,'successful_sse');
 assert.equal(request2.status,200);
 const completed=await deadline(request2.text(),5000,'complete_sse');
 resultsObject.success_sse_has_done=completed.includes('event: done');
 resultsObject.success_cache_written=!!cached();
 assert.equal(resultsObject.success_sse_has_done,true,'normal review failed to finish');
 assert.equal(resultsObject.success_cache_written,true,'normal review failed to cache');
 const fromGet=await api.request('http://localhost/api/games/1/review',{headers:headers(cookie)});
 const getPayload=await fromGet.json();
 resultsObject.success_read_shows_written_review=fromGet.status===200&&!!getPayload.review;
 assert(resultsObject.success_read_shows_written_review);
 resultsObject.success_summary=getPayload.review.summary;
 resultsObject.provider_total_posts=providerPosts;
}finally{
 try{db?.close();}catch{}
 provider.closeAllConnections();
 await deadline(new Promise(ok=>provider.close(ok)),1500,'mock_cleanup').catch(()=>{});
 rmSync(scratch,{recursive:true,force:true});
}
const report={
 schema_version:1,at_utc:new Date().toISOString(),
 candidate_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:appRoot,encoding:'utf8'}).trim(),
 engine_sha256:engineSha,manifest_sha256:sha(manifest),fixture_id:meta.fixture_id,
 scope:'actual authenticated Game Review POST SSE; real nonstreaming JSON transport; local stalled model',
 source_rights:'self-authored synthetic; synthetic users and disposable SQLite',
 results:resultsObject,localhost_provider_responses_closed:serverClosures,
 elapsed_ms:Date.now()-started,
 cancellation_safe_on_tested_path:resultsObject.aborted_request_cache_absent&&!resultsObject.aborted_sse_emitted_done,
 product_cancellation_fully_certified:false,release_approved:false,
 limitations:['Single canceled request, one local JSON provider, short synthetic game',
  'No real browser disconnect, HTTP reverse proxy or multitenant server process',
  'No production database or external model; this is a narrow protocol-lifecycle smoke',
  'A passed cancellation smoke does not establish all races or performance SLOs']
};
const output=join(results,'coach-cancellation-real-route.json');
writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,source:report.candidate_sha,...report.results,closure_count:report.localhost_provider_responses_closed,
 cancellation_safe:report.cancellation_safe_on_tested_path,elapsed_ms:report.elapsed_ms},null,2));
