#!/usr/bin/env node
/** Agent D — real signed Hono /api/analyze and /api/games/:id/review POST
 * against disposable SQLite with genuine saved Stockfish analysis. Show that
 * a game PGN change BEFORE admission can reuse an old analysis and generate
 * a successful but factually source-inconsistent NEW report. QA-only source
 * correction sabotage must break this reproduction (expected nonzero). */
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {Chess} from 'chess.js';
import {Hono} from 'hono';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const results=join(qa,'results');mkdirSync(results,{recursive:true});
const args=Object.fromEntries(process.argv.slice(2).map(x=>{
 const i=x.indexOf('=');return i<0?[x.slice(2),true]:[x.slice(2,i),x.slice(i+1)];
}));
assert(Object.keys(args).every(k=>['run-id','fault'].includes(k)));
const fault=args.fault??null;
assert(fault===null||fault==='correct-source-analysis-before-review');
const runId=args['run-id']||randomUUID();
assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId));
const sha=d=>createHash('sha256').update(d).digest('hex');
const candidate=realpathSync(join(results,'worktree-coach'));
assert(relative(results,candidate)==='worktree-coach');
const backendSHA='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:candidate,encoding:'utf8'}).trim(),backendSHA);
const engine=realpathSync(join(results,'engine/unpacked/usr/games/stockfish'));
const engineSHA='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
assert.equal(sha(readFileSync(engine)),engineSHA);
const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8');
const manifestSHA='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
assert.equal(sha(manifest),manifestSHA);
const fixture=manifest.trim().split('\n').map(JSON.parse)
 .find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.source_kind==='synthetic'&&fixture.license==='self-authored');
const originalPgn=readFileSync(join(qa,'fixtures',fixture.pgn_file),'utf8');
assert.equal(sha(originalPgn),fixture.pgn_sha256);
const original=new Chess();original.loadPgn(originalPgn,{strict:true});
assert(original.isCheckmate()&&original.turn()==='w'&&original.history().length===4);
const updated=new Chess();
for(const san of ['e4','e5','Qh5','Nc6','Bc4','Nf6','Qxf7#'])updated.move(san);
updated.header('Event','QA Synthetic Opposite Winner');updated.header('Result','1-0');
const updatedPgn=updated.pgn();
assert(updated.isCheckmate()&&updated.turn()==='b'&&updated.history().length===7);
assert.notEqual(sha(updatedPgn),sha(originalPgn));

const scratch=mkdtempSync(join(results,'admission-source-'));
process.env.DB_PATH=join(scratch,'qa-only.sqlite');
process.env.SESSION_SECRET='qa-only-admission-source-sessions';
process.env.OIDC_ENABLED='false';
process.env.ENGINE_BACKEND='local';process.env.STOCKFISH_PATH=engine;
process.env.STOCKFISH_THREADS='1';process.env.STOCKFISH_HASH='16';
const since=Date.now(),obs={};let db=null,error=null;
async function jsonRequest(app,url,{cookie=null,method='GET',body=null}={}){
 const headers={};if(cookie)headers.Cookie='chess_session='+cookie;
 if(body!==null){headers['Content-Type']='application/json';headers['X-Requested-With']='patzer';}
 const response=await app.request('http://127.0.0.1'+url,
  {method,headers,body:body!==null?JSON.stringify(body):undefined});
 const payload=await response.json();return {status:response.status,body:payload};
}
function parseSSE(body){
 const entries=[];
 for(const event of body.trim().split(/\r?\n\r?\n/)){
  const type=/^event:\s*(.*)$/m.exec(event)?.[1];
  const data=/^data:\s*(.*)$/m.exec(event)?.[1];
  if(type)entries.push({type,data:data??null});
 }
 return entries;
}
async function postReview(app,id,cookie){
 const response=await app.request('http://127.0.0.1/api/games/'+id+'/review',
  {method:'POST',headers:{Cookie:'chess_session='+cookie,
   'X-Requested-With':'patzer','Content-Type':'application/json'},body:'{}'});
 const raw=await response.text();
 const events=parseSSE(raw);
 const dones=events.filter(x=>x.type==='done');
 const errors=events.filter(x=>x.type==='error');
 const review=dones.length===1?JSON.parse(dones[0].data).review:null;
 return {status:response.status,events,done_count:dones.length,
  error_count:errors.length,review,
  raw_sse:raw,raw_sse_sha256:sha(raw)};
}
try{
 const {db:database}=await import(join(candidate,'server/src/db.ts'));db=database;
 const {createSession}=await import(join(candidate,'server/src/auth/sessions.ts'));
 const {llmConfigured}=await import(join(candidate,'server/src/coach/llm.ts'));
 const {analyzePgn,saveAnalysis}=await import(join(candidate,'server/src/routes/analyze.ts'));
 const analyzer=(await import(join(candidate,'server/src/routes/analyze.ts'))).default;
 const reviewer=(await import(join(candidate,'server/src/routes/review.ts'))).default;
 const games=(await import(join(candidate,'server/src/routes/games.ts'))).default;
 assert.equal(llmConfigured(),false,'no real external model configured in isolated test');
 for(const userId of [1,2]){
  db.prepare('INSERT INTO users(id,username,password_hash,role) VALUES(?,?,?,?)')
   .run(userId,'qa-source-user-'+userId,'qa-no-login','user');
  db.prepare('INSERT INTO profiles(user_id,display_name,language,audience) VALUES(?,?,?,?)')
   .run(userId,'Synthetic player '+userId,'en','beginner');
 }
 for(const [id,pgn,win] of [[1,originalPgn,'loss'],[2,originalPgn,'loss'],[3,updatedPgn,'win']]){
  db.prepare('INSERT INTO games(id,user_id,source,pgn,user_color,result) VALUES(?,?,?,?,?,?)')
   .run(id,1,'pvp',pgn,'white',win);
 }
 const oldAnalysis=await analyzePgn(originalPgn,8);
 const newAnalysis=await analyzePgn(updatedPgn,8);
 assert.equal(oldAnalysis.moves.length,4);
 assert.equal(newAnalysis.moves.length,7);
 assert(oldAnalysis.key_moments.some(m=>m.san==='g4'),
  'the synthetic old analysis is not visibly distinct in the resulting report');
 for(const id of [1,2])saveAnalysis(id,oldAnalysis);
 saveAnalysis(3,newAnalysis);
 const app=new Hono();app.route('/api/analyze',analyzer);
 app.route('/api/games',games);app.route('/api/games',reviewer);
 const owner=createSession(1),other=createSession(2);
 const analyze=(id,cookie=owner)=>jsonRequest(app,'/api/analyze',{
  cookie,method:'POST',body:{game_id:id,depth:8,force:false}});
 const getReport=(id,cookie=owner)=>jsonRequest(app,'/api/games/'+id+'/review',{cookie});
 const getGame=(id,cookie=owner)=>jsonRequest(app,'/api/games/'+id,{cookie});
 // Both fully consistent source/analysis controls must produce correct cached
 // hits and a new report bound to their OWN legal move history.
 const oldControlAnalysis=await analyze(1);
 const newControlAnalysis=await analyze(3);
 assert.equal(oldControlAnalysis.status,200);
 assert.equal(newControlAnalysis.status,200);
 assert.equal(oldControlAnalysis.body.cached,true);
 assert.equal(newControlAnalysis.body.cached,true);
 const oldReview=await postReview(app,1,owner);
 const newReview=await postReview(app,3,owner);
 for(const [id,data] of [[1,oldReview],[3,newReview]]){
  assert.equal(data.status,200);assert.equal(data.done_count,1);
  assert.equal(data.error_count,0);
  assert.deepEqual((await getReport(id)).body.review,data.review);
 }
 assert(oldReview.review.key_moments.some(m=>m.san==='g4'));
 assert(newReview.review.key_moments.every(m=>m.san!=='g4'));
 obs.controls={original:{analysis:oldControlAnalysis,report:oldReview},
  new_source:{analysis:newControlAnalysis,report:newReview}};
 // Independent route auth controls. No data from other users or anonymous.
 const ownerIsolation={
  unauthorized_analysis:await analyze(2,null),
  other_user_analysis:await analyze(2,other),
  unauthorized_review_post:await postReview(app,2,''),
  other_user_review_post:await postReview(app,2,other),
  other_user_get:await getReport(2,other),
 };
 assert.equal(ownerIsolation.unauthorized_analysis.status,401);
 assert.equal(ownerIsolation.other_user_analysis.status,404);
 assert.equal(ownerIsolation.unauthorized_review_post.status,401);
 assert.equal(ownerIsolation.other_user_review_post.status,404);
 assert.equal(ownerIsolation.other_user_get.status,404);
 obs.owner_isolation={
  anonymous_analysis_status:ownerIsolation.unauthorized_analysis.status,
  foreign_analysis_status:ownerIsolation.other_user_analysis.status,
  anonymous_review_post_status:ownerIsolation.unauthorized_review_post.status,
  foreign_review_post_status:ownerIsolation.other_user_review_post.status,
  foreign_cached_get_status:ownerIsolation.other_user_get.status};

 const prior=await getGame(2);
 assert.equal(prior.body.game.pgn,originalPgn);
 assert.equal(JSON.parse(prior.body.analysis.moves_json).length,4);
 const change=db.prepare('UPDATE games SET pgn=?,result=? WHERE id=2').run(updatedPgn,'win');
 assert.equal(change.changes,1);
 const changed=await getGame(2);
 assert.equal(changed.status,200);
 assert.equal(changed.body.game.pgn,updatedPgn);
 assert.equal(JSON.parse(changed.body.analysis.moves_json).length,4);
 // Crucial: route GETs a cached analysis based only on (depth, scoring_version).
 const staleAnalyze=await analyze(2);
 assert.equal(staleAnalyze.status,200);
 assert.equal(staleAnalyze.body.cached,true,'old analysis was correctly invalidated; test no longer reproduces');
 assert.equal(staleAnalyze.body.analysis.moves.length,4);
 assert.deepEqual(staleAnalyze.body.analysis.moves,oldAnalysis.moves);
 obs.after_pgn_change={
  game_detail:{status:changed.status,
   game_pgn:changed.body.game.pgn,
   stored_analysis_moves_json:changed.body.analysis.moves_json},
  cached_analysis_reply:staleAnalyze,
  cached_analysis_row_before_review:
   db.prepare('SELECT depth,scoring_version,moves_json,prose_json FROM analyses WHERE game_id=2').get(),
  current_pgn_sha256:sha(updatedPgn),
  prior_pgn_sha256:sha(originalPgn)};
 if(fault==='correct-source-analysis-before-review'){
  // QA-only counterfactual: correct the analysis row with the actual owner's
  // exported saveAnalysis BEFORE the report begins. No app source changes.
  saveAnalysis(2,newAnalysis);
  obs.corrected_before_post={
   real_corrected_analysis_move_count:JSON.parse(db.prepare('SELECT moves_json FROM analyses WHERE game_id=2').get().moves_json).length,
   fresh_cached_analysis:(await analyze(2)).body};
 }
 const report=await postReview(app,2,owner);
 const afterReport=await getReport(2);
 const postRow=db.prepare(`SELECT depth,scoring_version,moves_json,prose_json,prose_lang,
  prose_audience FROM analyses WHERE game_id=2`).get();
 obs.after_new_report={sse:report,authenticated_cached_get:afterReport,
  final_database_row:postRow,
  reported_review_source_moments:report.review?.key_moments?.map(m=>({
   ply:m.ply,san:m.san,fen_before:m.fen_before}))??[],
  report_contains_old_move_g4:report.review?.key_moments.some(m=>m.san==='g4')??false,
  report_contains_current_new_ply3:report.review?.key_moments.some(m=>m.ply===3&&m.san==='Qh5')??false};
 assert.equal(report.status,200);
 assert.equal(report.error_count,0);
 assert.equal(report.done_count,1);
 assert.equal(afterReport.status,200);
 assert.deepEqual(afterReport.body.review,report.review);
 assert(postRow.prose_json,'new report was not accepted into real SQLite cache');
 assert.deepEqual(JSON.parse(postRow.prose_json),report.review);
 assert.equal(JSON.parse(postRow.moves_json).length,4,
  'old analysis did NOT survive to successful new report admission');
 assert.equal(obs.after_new_report.report_contains_old_move_g4,true,
  'old-game moment did not leak into new-game prose');
 assert.equal(obs.after_new_report.report_contains_current_new_ply3,false,
  'new-game current move was correctly present rather than old move');
}catch(e){error=e instanceof Error?(e.stack||e.message):String(e);}
finally{try{db?.close();}catch{}rmSync(scratch,{recursive:true,force:true});}
const packet={schema_version:1,at_utc:new Date().toISOString(),run_id:runId,
 prior_checkpoint:'7e569cd2e93147e20e210fa9806d179e0344fed3',
 backend_candidate_sha:backendSHA,engine_sha256:engineSHA,
 manifest_sha256:manifestSHA,source_fixture_id:fixture.fixture_id,
 original_pgn:originalPgn,original_pgn_sha256:sha(originalPgn),
 updated_pgn:updatedPgn,updated_pgn_sha256:sha(updatedPgn),
 fault,qa_status:error?'fail':'pass',qa_error:error,
 observations:obs,elapsed_ms:Date.now()-since,
 engine_searches:2,engine_depth:8,engine_threads:1,engine_hash_mib:16,
 external_llm_requests:0,source_is_synthetic:true,sqlite_is_disposable:true,
 authenticated_real_hono_routes:true,product_release_approved:false,
 caveats:['Custom synthetic PGN source update and bounded Stockfish depth-8 analyses',
  'PGN mutation occurs through disposable SQLite, matching source persistence but not the full live websocket',
  'All request/response data is real signed owner Hono; owner app files remain read-only',
  'No hosted LLM: actual product fallback prose with genuine old/new move moments',
  'This proves source mismatch at report ADMISSION, distinct from in-flight CAS and stale cached GET']};
const file=join(results,fault?'coach-admission-source-fault.json':'coach-admission-source.json');
writeFileSync(file,JSON.stringify(packet,null,2)+'\n');
console.log(JSON.stringify({file,run_id:runId,qa_status:packet.qa_status,
 old_analysis_plies:obs.after_pgn_change?.cached_analysis_reply?.body?.analysis?.moves?.length??null,
 old_analysis_cache_hit:obs.after_pgn_change?.cached_analysis_reply?.body?.cached??null,
 new_report_plies:obs.after_new_report?.final_database_row?.moves_json?
  JSON.parse(obs.after_new_report.final_database_row.moves_json).length:null,
 stale_old_moment_in_new_report:obs.after_new_report?.report_contains_old_move_g4??null,
 cas_accepted_new_report:!!obs.after_new_report?.final_database_row?.prose_json,
 errors:error,product_release_approved:false},null,2));
if(error)process.exitCode=1;
