#!/usr/bin/env node
/** Agent D: real logout while a previously admitted SSE review is in flight.
 * Only synthetic fixtures, disposable SQLite, localhost model and read-only
 * candidate source. This measures behavior; policy judgment is separate.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,realpathSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,join} from 'node:path';
import {Hono} from 'hono';
import {Chess} from 'chess.js';
const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence'),results=join(qa,'results');
mkdirSync(results,{recursive:true});
const cli=Object.fromEntries(process.argv.slice(2).map(a=>{const i=a.indexOf('=');return i<0?[a.slice(2),true]:[a.slice(2,i),a.slice(i+1)];}));
const app=realpathSync(cli['app-root']||join(results,'worktree-coach'));
assert(app.startsWith(join(results,'worktree-')),'candidate must be a detached QA worktree');
const sha=x=>createHash('sha256').update(x).digest('hex');
const engine=realpathSync(cli.engine||join(results,'engine/unpacked/usr/games/stockfish'));
const pin=cli['engine-sha256'];
assert(typeof pin==='string'&&/^[a-f0-9]{64}$/.test(pin));
assert.equal(sha(readFileSync(engine)),pin);
const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8');
const entry=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(entry?.source_kind==='synthetic'&&entry.license==='self-authored');
const pgn=readFileSync(join(qa,'fixtures',entry.pgn_file),'utf8');
assert.equal(sha(pgn),entry.pgn_sha256);
const game=new Chess();game.loadPgn(pgn,{strict:true});assert(game.isCheckmate()&&game.turn()==='w');
const scratch=mkdtempSync(join(results,'logout-inflight-'));
process.env.DB_PATH=join(scratch,'qa-only.db');
process.env.SESSION_SECRET='qa-disposable-session-key';
process.env.ENGINE_BACKEND='local';process.env.STOCKFISH_PATH=engine;
process.env.STOCKFISH_THREADS='1';process.env.STOCKFISH_HASH='16';
process.env.OIDC_ENABLED='false';
const responses=[],stages=[];
let heldSummary=null,db=null,modelCalls=0,modelClosed=0;
const payload={title:'QA moment',prose:'Review every move before choosing your next move.',
 what_happened:'Review every move before choosing your next move.',
 summary:'Black won the game.',skill_assessment:'A single game is not enough to establish skill.',
 opening_prose:'The opening was recorded.'};
const reply=res=>{
 res.writeHead(200,{'content-type':'application/json'});
 res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(payload)}}]}));
};
const provider=createServer((req,res)=>{
 if(req.method==='GET'&&req.url==='/v1/models'){
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({data:[{id:'qa-logout-model'}]}));return;
 }
 if(req.method==='POST'&&req.url==='/v1/chat/completions'){
  let data='';req.on('data',s=>{data+=s;if(data.length>100000)req.destroy();});
  req.on('end',()=>{
   try{
    const body=JSON.parse(data);assert.equal(body.model,'qa-logout-model');
    modelCalls++;res.on('close',()=>modelClosed++);
    const user=body.messages?.find(m=>m.role==='user')?.content||'';
    const stage=user.includes('Schema: { "summary"')?'summary':
     user.includes('"what_happened"')?'moment':'phase';
    stages.push(stage);
    if(stage==='summary'&&!heldSummary){heldSummary=res;return;}
    reply(res);
   }catch(e){res.writeHead(500).end(String(e));}
  });return;
 }
 res.writeHead(404).end();
});
function timed(p,ms,label){let timeout;return Promise.race([p,new Promise((_,fail)=>{timeout=setTimeout(()=>fail(Error(label+'_timeout')),ms);})]).finally(()=>clearTimeout(timeout));}
const until=async(f,label)=>timed((async()=>{while(!f())await new Promise(done=>setTimeout(done,5));})(),3000,label);
const t0=Date.now(),outcome={};
try{
 await timed(new Promise((ok,fail)=>{provider.once('error',fail);provider.listen(0,'127.0.0.1',ok);}),1500,'listen');
 const {db:database,setSetting}=await import(join(app,'server/src/db.ts'));db=database;
 setSetting('llm_provider','vllm');
 setSetting('vllm_url','http://127.0.0.1:'+provider.address().port);
 setSetting('vllm_model','qa-logout-model');
 const {analyzePgn,saveAnalysis}=await import(join(app,'server/src/routes/analyze.ts'));
 const {createSession}=await import(join(app,'server/src/auth/sessions.ts'));
 const reviewRoute=(await import(join(app,'server/src/routes/review.ts'))).default;
 const authRoute=(await import(join(app,'server/src/routes/auth.ts'))).default;
 const api=new Hono();api.route('/api/games',reviewRoute);api.route('/api/auth',authRoute);
 db.prepare('INSERT INTO users(id,username,password_hash,role) VALUES(?,?,?,?)').run(1,'qa-owner','not-real','user');
 db.prepare('INSERT INTO profiles(user_id,display_name,language,audience) VALUES(?,?,?,?)').run(1,'QA','en','beginner');
 db.prepare('INSERT INTO games(id,user_id,source,pgn,user_color) VALUES(?,?,?,?,?)').run(1,1,'imported',pgn,'white');
 const analysis=await analyzePgn(pgn,8);saveAnalysis(1,analysis);
 const oldCookie=createSession(1),headers={Cookie:'chess_session='+oldCookie};
 const sessionCount=()=>db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=1').get().n;
 assert.equal(sessionCount(),1);
 outcome.session_rows_before_logout=sessionCount();
 const inFlight=await timed(api.request('http://localhost/api/games/1/review',{method:'POST',headers}),3000,'admit');
 assert.equal(inFlight.status,200);
 outcome.admitted_review_http_status=inFlight.status;
 const body=inFlight.text(); // retain concurrent pending stream read
 await until(()=>heldSummary!==null,'final_summary');
 outcome.final_model_response_held_at_logout=heldSummary!==null;
 outcome.cache_was_null_at_logout=db.prepare('SELECT prose_json FROM analyses WHERE game_id=1').get().prose_json===null;
 assert(outcome.final_model_response_held_at_logout&&outcome.cache_was_null_at_logout);
 const logout=await api.request('http://localhost/api/auth/logout',{method:'POST',headers});
 outcome.real_logout_status=logout.status;
 outcome.real_logout_ok=(await logout.json()).ok===true;
 const clearCookieHeader=logout.headers.get('set-cookie')||'';
 outcome.logout_cookie_cleared=/chess_session=\s*;/i.test(clearCookieHeader)
  &&/(?:max-age=0|expires=thu,\s*01 jan 1970)/i.test(clearCookieHeader)
  &&!clearCookieHeader.includes(oldCookie);
 outcome.session_rows_after_logout=sessionCount();
 assert.equal(outcome.real_logout_status,200);
 assert(outcome.real_logout_ok&&outcome.logout_cookie_cleared);
 assert.equal(outcome.session_rows_after_logout,0);
 outcome.revoked_get_status=(await api.request('http://localhost/api/games/1/review',{headers})).status;
 outcome.revoked_post_status=(await api.request('http://localhost/api/games/1/review',{method:'POST',headers})).status;
 assert.equal(outcome.revoked_get_status,401);
 assert.equal(outcome.revoked_post_status,401);
 // This is an already-admitted request. No source-level policy guarantees it
 // must be canceled by a subsequent logout. Record, do not prejudge it.
 reply(heldSummary);
 const sse=await timed(body,5000,'old_request_completed');
 outcome.existing_request_sse=sse;
 outcome.existing_request_emitted_done=sse.includes('event: done');
 outcome.existing_request_emitted_error=sse.includes('event: error');
 outcome.cached_after_logout=db.prepare('SELECT prose_json FROM analyses WHERE game_id=1').get().prose_json!==null;
 const newCookie=createSession(1),newHeaders={Cookie:'chess_session='+newCookie};
 outcome.new_session_rows=sessionCount();
 const fresh=await api.request('http://localhost/api/games/1/review',{headers:newHeaders});
 outcome.new_session_get_status=fresh.status;
 const freshResult=await fresh.json();
 outcome.new_session_cached_summary=freshResult.review?.summary??null;
 outcome.model_calls=modelCalls;outcome.model_responses_closed=modelClosed;
 outcome.model_stages=stages;
 assert.equal(outcome.new_session_get_status,200);
 assert.equal(outcome.new_session_cached_summary,payload.summary);
 assert(outcome.existing_request_emitted_done&&!outcome.existing_request_emitted_error);
 assert(outcome.cached_after_logout);
 assert.deepEqual(stages,['phase','moment','summary']);
 assert.equal(modelCalls,3);assert.equal(modelClosed,3);
}finally{
 try{db?.close();}catch{}
 provider.closeAllConnections();
 await timed(new Promise(ok=>provider.close(ok)),1500,'close').catch(()=>{});
 rmSync(scratch,{recursive:true,force:true});
}
const record={schema_version:1,candidate_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),
 at_utc:new Date().toISOString(),manifest_sha256:sha(manifest),engine_sha256:pin,
 fixture_id:entry.fixture_id,rights:'self-authored chess, disposable SQLite, synthetic sessions, loopback-only model',
 scope:'real logout route revokes admission mid-flight, old SSE admitted pre-logout and later completed',
 observations:outcome,elapsed_ms:Date.now()-t0,
 all_new_requests_denied:true,pre_admitted_stream_continued:true,
 logout_should_cancel_existing_stream_policy:'unspecified',
 full_security_certified:false,release_approved:false,
 limitations:['In-process routes, fake login rows, one synthetic four-ply game; not browser logout',
  'Does not determine whether an admitted request should be canceled on logout; product policy required',
  'No cross-process revocation, reverse proxy, external LLM or deployed network test']};
const output=join(results,'review-logout-inflight.json');
writeFileSync(output,JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({path:output,observation:{...outcome,existing_request_sse:'<raw SSE persisted only in ignored results>'},
  code:0,release_approved:false},null,2));
