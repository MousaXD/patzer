#!/usr/bin/env node
// Independent hostile integration probe against the *actual* Game Review
// cache production functions and authenticated route. No live server, imports,
// credentials, or SQLite may be used. Approved synthetic PGN only.
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,realpathSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {Hono} from 'hono';
import {Chess} from 'chess.js';
const root=resolve(import.meta.dirname,'..');
const results=join(root,'qa/review-excellence/results');
mkdirSync(results,{recursive:true});
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const args=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return i<0?[x.slice(2),true]:[x.slice(2,i),x.slice(i+1)];}));
const expectation=args.expect??'reproduce';
if(!['reproduce','fixed'].includes(expectation))throw Error('--expect must be reproduce or fixed');
const app=realpathSync(args['app-root']??join(results,'worktree-coach'));
if(!app.startsWith(join(results,'worktree-')))throw Error('Only detached QA worktree is permitted');
const srcSha=execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim();
const engine=realpathSync(args.engine??join(results,'engine/unpacked/usr/games/stockfish'));
if(!/^[a-f0-9]{64}$/.test(args['engine-sha256']||''))throw Error('Pinned engine sha256 is required');
const engineSha=sha(readFileSync(engine));
assert.equal(engineSha,args['engine-sha256'],'wrong engine identity');
const manifest=readFileSync(join(root,'qa/review-excellence/manifests/manifest-v2.jsonl'),'utf8');
const entry=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(entry?.source_kind==='synthetic'&&entry.license==='self-authored');
const pgn=readFileSync(join(root,'qa/review-excellence/fixtures',entry.pgn_file),'utf8');
assert.equal(sha(pgn),entry.pgn_sha256);
const replay=new Chess();replay.loadPgn(pgn,{strict:true});
assert(replay.isCheckmate());
const tmp=mkdtempSync(join(results,'coach-cache-'));
process.env.DB_PATH=join(tmp,'cache-only.db');
process.env.SESSION_SECRET='qa-only-disposable-sessions';
process.env.ENGINE_BACKEND='local';
process.env.STOCKFISH_PATH=engine;
process.env.STOCKFISH_THREADS='1';
process.env.STOCKFISH_HASH='16';
let db=null;
const trace={};
const testStarted=Date.now();
try{
 const {db:database}=await import(join(app,'server/src/db.ts'));
 db=database;
 const {createSession}=await import(join(app,'server/src/auth/sessions.ts'));
 const {analyzePgn,saveAnalysis}=await import(join(app,'server/src/routes/analyze.ts'));
 const {buildGameReview,REVIEW_PROSE_VERSION}=await import(join(app,'server/src/coach/review.ts'));
 const {saveReviewIfFresh}=await import(join(app,'server/src/coach/reviewCache.ts'));
 const router=(await import(join(app,'server/src/routes/review.ts'))).default;
 const api=new Hono();api.route('/api/games',router);
 for(let id=1;id<=2;id++){
  db.prepare('INSERT INTO users (id,username,password_hash,role) VALUES (?,?,?,?)')
    .run(id,'synthetic-user-'+id,'qa-not-a-real-password','user');
  db.prepare('INSERT INTO profiles (user_id,display_name,language,audience) VALUES (?,?,?,?)')
    .run(id,'Synthetic User '+id,'en','beginner');
 }
 db.prepare('INSERT INTO games (id,user_id,source,pgn,user_color) VALUES (?,?,?,?,?)')
  .run(1,1,'imported',pgn,'white');
 const cookie1=createSession(1),cookie2=createSession(2);
 async function get(cookie){
  const response=await api.request('http://localhost/api/games/1/review',{method:'GET',headers:{Cookie:'chess_session='+cookie}});
  return {status:response.status,body:await response.json()};
 }
 trace.no_auth=await get('');
 trace.other_user=await get(cookie2);
 assert.equal(trace.no_auth.status,401,'review route must require auth');
 assert.equal(trace.other_user.status,404,'other user must not see a review');
 const analysis=await analyzePgn(pgn,8);
 saveAnalysis(1,analysis);
 const source=db.prepare('SELECT * FROM analyses WHERE game_id = 1').get();
 assert.equal(source.scoring_version,9);
 const review=await buildGameReview({pgn,analysis,language:'en',audience:'beginner',userColor:'white',llmEnabled:false});
 assert.equal(review.version,REVIEW_PROSE_VERSION);
 trace.generated_review_has_scoring_marker=Object.hasOwn(review,'accuracy_model_version');
 const saved=saveReviewIfFresh(db,1,source,{pgn,user_color:'white',user_id:1},review,'en','beginner');
 assert.equal(saved,true);
 trace.initial=await get(cookie1);
 assert.equal(trace.initial.status,200);
 assert.equal(trace.initial.body.review?.summary,review.summary,'actual cached review must be visible');
 assert.equal(trace.initial.body.stale,undefined);
 const reviewHash=sha(Buffer.from(JSON.stringify(review)));
 // The *real* analyzer upsert retains prose_json while changing the analysis.
 // Reproduce with altered evidence to distinguish stale text from benign recalc.
 const rerun={...analysis,accuracy_white:Math.max(0,analysis.accuracy_white-25)};
 assert.notEqual(rerun.accuracy_white,analysis.accuracy_white);
 saveAnalysis(1,rerun);
 const updated=db.prepare('SELECT accuracy_white, scoring_version, prose_json FROM analyses WHERE game_id=1').get();
 assert.equal(updated.accuracy_white,rerun.accuracy_white,'real reanalysis must have changed evidence');
 trace.after_reanalysis=await get(cookie1);
 trace.cached_prose_retained_after_reanalysis=updated.prose_json!==null;
 trace.unmarked_prose_returned_after_reanalysis=trace.after_reanalysis.body.review?.summary===review.summary;
 trace.auto_review_queue_pending_after_reanalysis=db.prepare('SELECT COUNT(*) AS total FROM analyses WHERE prose_json IS NULL').get().total;
 // Direct scoring-version update reproduces a version-only migration/backfill;
 // this is a controlled mutation, not a claim a deployed migration did it.
 db.prepare('UPDATE analyses SET scoring_version=10 WHERE game_id=1').run();
 trace.after_scoring_version_change=await get(cookie1);
 trace.unmarked_prose_returned_after_scoring_change=trace.after_scoring_version_change.body.review?.summary===review.summary;
 // The route *does* invalidate marked stale prose. This is a positive control.
 const marked={...review,accuracy_model_version:9};
 db.prepare('UPDATE analyses SET prose_json=? WHERE game_id=1').run(JSON.stringify(marked));
 trace.marked_version_mismatch=await get(cookie1);
 assert.equal(trace.marked_version_mismatch.body.review,null);
 assert.equal(trace.marked_version_mismatch.body.stale,true);
 // A genuinely matching marker is accepted.
 db.prepare('UPDATE analyses SET prose_json=? WHERE game_id=1').run(JSON.stringify({...review,accuracy_model_version:10}));
 trace.marked_version_match=await get(cookie1);
 assert.equal(trace.marked_version_match.body.review?.summary,review.summary);
 // Changing profile language must reject cached review.
 db.prepare("UPDATE profiles SET language='ru' WHERE user_id=1").run();
 trace.lang_change=await get(cookie1);
 assert.equal(trace.lang_change.body.review,null);
 assert.equal(trace.lang_change.body.stale,true);
 db.prepare('UPDATE analyses SET prose_json=NULL WHERE game_id=1').run();
 db.prepare("UPDATE profiles SET language='en' WHERE user_id=1").run();
 trace.uncached=await get(cookie1);
 assert.equal(trace.uncached.body.review,null);
 // The asynchronous write race *is* guarded by a conditional UPDATE. A newer
 // source must invalidate an in-flight review even if the prose slot is empty.
 const preflight=db.prepare('SELECT * FROM analyses WHERE game_id=1').get();
 saveAnalysis(1,{...rerun,accuracy_white:Math.max(0,rerun.accuracy_white-1)});
 const staleWriteAccepted=saveReviewIfFresh(db,1,preflight,{pgn,user_color:'white',user_id:1},review,'en','beginner');
 trace.inflight_stale_write_rejected=staleWriteAccepted===false;
 assert(trace.inflight_stale_write_rejected,'a stale asynchronous report overwrote the changed analysis');
 // Directly check the policy allows the unmarked legacy cache to pass.
 trace.verified_original_review_sha256=reviewHash;
 trace.prose_version=REVIEW_PROSE_VERSION;
 trace.initial_accuracy_white=analysis.accuracy_white;
 trace.updated_accuracy_white=rerun.accuracy_white;
}finally{
 try{db?.close();}catch{}
 rmSync(tmp,{recursive:true,force:true});
}
const report={
 schema_version:1,at_utc:new Date().toISOString(),
 source_candidate_sha:srcSha,
 engine_sha256:engineSha,manifest_sha256:sha(Buffer.from(manifest)),fixture:'SYN-GAME-FOOLS-MATE',
 notes:'Actual saveAnalysis + buildGameReview + saveReviewIfFresh + authenticated GET; disposable SQLite, no real users',
 expectation,
 attacks:{
  real_reanalysis_stale_prose_escaped:trace.unmarked_prose_returned_after_reanalysis===true,
  controlled_scoring_migration_stale_prose_escaped:trace.unmarked_prose_returned_after_scoring_change===true
 },
 controls:{
  unauthorized_rejected:trace.no_auth.status===401,
  other_user_rejected:trace.other_user.status===404,
  original_review_served:!!trace.initial.body.review,
  marked_mismatch_rejected:trace.marked_version_mismatch.body.stale===true,
  marked_match_accepted:!!trace.marked_version_match.body.review,
  language_mismatch_rejected:trace.lang_change.body.stale===true,
  null_cache_not_served:trace.uncached.body.review===null,
  in_flight_stale_write_rejected:trace.inflight_stale_write_rejected===true
 },
 checks:{old_accuracy_white:trace.initial_accuracy_white,new_accuracy_white:trace.updated_accuracy_white,prose_version:trace.prose_version,generated_review_sha256:trace.verified_original_review_sha256,auto_review_queue_after_reanalysis:trace.auto_review_queue_pending_after_reanalysis,prose_retained_after_reanalysis:trace.cached_prose_retained_after_reanalysis,generated_review_has_scoring_marker:trace.generated_review_has_scoring_marker},
 scoped_cache_passed:!trace.unmarked_prose_returned_after_reanalysis&&!trace.unmarked_prose_returned_after_scoring_change,
 product_cache_certified:false,release_approved:false,
 elapsed_ms:Date.now()-testStarted
};
const output=resolve(args.out??join(results,'coach-cache-real-route.json'));
if(!output.startsWith(results+'/'))throw Error('QA result must stay inside ignored disposable results');
writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,...report},null,2));
for(const flag of Object.values(report.controls)) assert.equal(flag,true,'cache route control did not behave as expected');
const isLeaking=report.attacks.real_reanalysis_stale_prose_escaped&&report.attacks.controlled_scoring_migration_stale_prose_escaped;
assert.equal(isLeaking,expectation==='reproduce',
  'cache behavior differs from pinned expectation; re-audit source and evidence before certifying');
