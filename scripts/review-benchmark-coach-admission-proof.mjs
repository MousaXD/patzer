#!/usr/bin/env node
/** Independent source PGN/analysis/real SSE provenance verification. Replays
 * chess.js source on its own and never imports the owner's Hono routes, CAS,
 * analyzePgn nor this benchmark's producer. A real 7-ply game must not gain
 * new report evidence from a different 4-ply game at admission. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Chess} from 'chess.js';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const results=join(qa,'results');
const sha=x=>createHash('sha256').update(x).digest('hex');
const fileSha=p=>sha(readFileSync(p));
const pins={
 candidate:'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87',
 engine:'00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca',
 manifest:'2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44',
 old:'13f1a0fa95e0a4acfd77168159c38ccc514f3b60d083945bbb49f2913524196e',
 updated:'8829dbcb41587754d9178379fcf724bb70fd6a798917cdd25a1103a156d2d646',
};
const candidate=realpathSync(join(results,'worktree-coach'));
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:candidate,encoding:'utf8'}).trim(),pins.candidate);
const originalSources={
 'server/src/routes/analyze.ts':'ccfe50080f298fc0cdc25848b1f62f77f2bcb28bd36947af5b874b504d6f4b3d',
 'server/src/routes/review.ts':'21e0a25f00418d7c1749b6089ed6d685ad1cb4f752e28bf5af16f9fa752442d0',
 'server/src/coach/reviewCache.ts':'72aba2c3883feb2534fd8fd252f0eed9189eaccc46911141ac3943256019912b',
 'server/src/ws/play.ts':'7d17d20aa58dba2684d40acab1d7f42f8b5a2f54f38b38a329555f5fb3ae9839',
};
for(const [path,digest] of Object.entries(originalSources))
 assert.equal(fileSha(join(candidate,path)),digest,'unreviewed Agent B source drift '+path);
assert.equal(fileSha(join(results,'engine/unpacked/usr/games/stockfish')),pins.engine);
const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8');
assert.equal(sha(manifest),pins.manifest);
const fixture=manifest.trim().split('\n').map(JSON.parse)
 .find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.license==='self-authored'&&fixture.source_kind==='synthetic');
const oldPgn=readFileSync(join(qa,'fixtures',fixture.pgn_file),'utf8');
assert.equal(fileSha(join(qa,'fixtures',fixture.pgn_file)),pins.old);
assert.equal(fixture.pgn_sha256,pins.old);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function replayPGN(pgn,expectedSha,expectedPlies,winningColor){
 assert.equal(sha(pgn),expectedSha);
 const g=new Chess();g.loadPgn(pgn,{strict:true});
 assert.equal(g.history().length,expectedPlies);
 assert.equal(g.isCheckmate(),true);
 assert.equal(g.turn(),winningColor==='white'?'b':'w');
 const h=g.history({verbose:true});
 return h.map((m,i)=>({ply:i+1,san:m.san,uci:m.from+m.to+(m.promotion??''),
  before:m.before,after:m.after}));
}
const oldHistory=replayPGN(oldPgn,pins.old,4,'black');
assert.deepEqual(oldHistory.map(m=>m.san),['f3','e5','g4','Qh4#']);
function validateMoves(source,analysisMoves){
 assert(Array.isArray(analysisMoves)&&analysisMoves.length===source.length);
 for(let i=0;i<source.length;i++){
  const a=analysisMoves[i],s=source[i];
  assert.equal(a.ply,s.ply);
  assert.equal(a.san,s.san);
  assert.equal(a.uci,s.uci);
  assert.equal(a.fen_before,s.before);
  assert.equal(a.fen_after,s.after);
 }
}
function validateReportSSE(result){
 assert.equal(result.status,200);
 assert.equal(typeof result.raw_sse,'string');
 assert(result.raw_sse.length>100&&result.raw_sse.length<40_000);
 assert.equal(sha(result.raw_sse),result.raw_sse_sha256,
  'actual wire-response SSE bytes changed or were omitted');
 const parsed=[];
 for(const frame of result.raw_sse.trim().split(/\r?\n\r?\n/)){
  const event=/^event:\s*(.*)$/m.exec(frame)?.[1];
  const data=/^data:\s*(.*)$/m.exec(frame)?.[1];
  if(event)parsed.push({type:event,data:data??null});
 }
 assert.deepEqual(result.events,parsed,'parsed SSE events do not match wire bytes');
 assert.equal(result.done_count,1);
 assert.equal(result.error_count,0);
 assert(Array.isArray(result.events));
 assert.equal(result.events.filter(e=>e.type==='done').length,1);
 assert.equal(result.events.filter(e=>e.type==='error').length,0);
 const done=result.events.find(e=>e.type==='done');
 assert.deepEqual(JSON.parse(done.data),{review:result.review});
 assert(result.events.some(x=>x.type==='progress'));
 assert(/^[0-9a-f]{64}$/.test(result.raw_sse_sha256));
 assert.equal(result.review.version,9);
 assert.equal(result.review.language,'en');
 assert.equal(result.review.audience,'beginner');
 assert.equal(typeof result.review.summary,'string');
 assert(Array.isArray(result.review.key_moments));
}
function validateReportMoments(report,history){
 for(const moment of report.key_moments){
  assert(Number.isInteger(moment.ply)&&moment.ply>=1&&moment.ply<=history.length);
  const src=history[moment.ply-1];
  assert.equal(moment.san,src.san);
  assert.equal(moment.fen_before,src.before);
 }
}
export function verifyAdmissionSourceEvidence(packet,{kind='clean'}={}){
 assert(['clean','fault'].includes(kind));
 assert.equal(packet.schema_version,1);
 assert(uuid.test(packet.run_id||''));
 assert.equal(packet.prior_checkpoint,'7e569cd2e93147e20e210fa9806d179e0344fed3');
 assert.equal(packet.backend_candidate_sha,pins.candidate);
 assert.equal(packet.engine_sha256,pins.engine);
 assert.equal(packet.manifest_sha256,pins.manifest);
 assert.equal(packet.source_fixture_id,fixture.fixture_id);
 assert.equal(packet.original_pgn,oldPgn);
 assert.equal(packet.original_pgn_sha256,pins.old);
 const updatedHistory=replayPGN(packet.updated_pgn,pins.updated,7,'white');
 assert.deepEqual(updatedHistory.map(x=>x.san),['e4','e5','Qh5','Nc6','Bc4','Nf6','Qxf7#']);
 assert.equal(packet.updated_pgn_sha256,pins.updated);
 assert.equal(packet.fault,kind==='clean'?null:'correct-source-analysis-before-review');
 assert.equal(packet.qa_status,kind==='clean'?'pass':'fail');
 assert.equal(packet.engine_searches,2);
 assert.equal(packet.engine_depth,8);
 assert.equal(packet.engine_threads,1);
 assert.equal(packet.engine_hash_mib,16);
 assert.equal(packet.external_llm_requests,0);
 assert.equal(packet.source_is_synthetic,true);
 assert.equal(packet.sqlite_is_disposable,true);
 assert.equal(packet.authenticated_real_hono_routes,true);
 assert.equal(packet.product_release_approved,false);
 assert(packet.elapsed_ms>0&&packet.elapsed_ms<35000,'unbounded job');
 assert(Array.isArray(packet.caveats)&&packet.caveats.length===5);
 const obs=packet.observations;
 assert(obs&&typeof obs==='object');
 const auth=obs.owner_isolation;
 assert.deepEqual(auth,{
  anonymous_analysis_status:401,foreign_analysis_status:404,
  anonymous_review_post_status:401,foreign_review_post_status:404,
  foreign_cached_get_status:404});
 const oldCtrl=obs.controls?.original;
 const newCtrl=obs.controls?.new_source;
 assert(oldCtrl&&newCtrl);
 const oldAnalysis=oldCtrl.analysis.body.analysis;
 const newAnalysis=newCtrl.analysis.body.analysis;
 for(const [control,source,analysis] of [[oldCtrl,oldHistory,oldAnalysis],
  [newCtrl,updatedHistory,newAnalysis]]){
  assert.equal(control.analysis.status,200);
  assert.equal(control.analysis.body.cached,true);
  assert.equal(control.analysis.body.analysis.depth,8);
  validateMoves(source,analysis.moves);
  validateReportSSE(control.report);
  validateReportMoments(control.report.review,source);
 }
 assert(oldCtrl.report.review.key_moments.some(x=>x.ply===3&&x.san==='g4'));
 assert(newCtrl.report.review.key_moments.some(x=>x.ply===6&&x.san==='Nf6'));
 assert(newCtrl.report.review.key_moments.every(x=>x.san!=='g4'));
 assert.notEqual(oldCtrl.report.review.summary,newCtrl.report.review.summary);

 const changed=obs.after_pgn_change;
 assert(changed&&typeof changed==='object');
 assert.equal(changed.current_pgn_sha256,pins.updated);
 assert.equal(changed.prior_pgn_sha256,pins.old);
 assert.equal(changed.game_detail.status,200);
 assert.equal(changed.game_detail.game_pgn,packet.updated_pgn);
 const badRow=changed.cached_analysis_row_before_review;
 const stored=JSON.parse(badRow.moves_json);
 validateMoves(oldHistory,stored);
 assert.equal(badRow.depth,8);
 assert.equal(badRow.scoring_version,9);
 assert.equal(badRow.prose_json,null);
 assert.equal(changed.game_detail.stored_analysis_moves_json,badRow.moves_json);
 assert.equal(changed.cached_analysis_reply.status,200);
 assert.equal(changed.cached_analysis_reply.body.cached,true,
  'new PGN was recognized and old cached analysis was not reused');
 assert.deepEqual(changed.cached_analysis_reply.body.analysis,oldAnalysis,
  'source-mismatched cached response did not return old engine results');

 const output=obs.after_new_report;
 assert(output&&typeof output==='object');
 const report=output.sse;
 validateReportSSE(report);
 assert.equal(output.authenticated_cached_get.status,200);
 assert.deepEqual(output.authenticated_cached_get.body,{review:report.review});
 const record=output.final_database_row;
 assert.equal(record.depth,8);
 assert.equal(record.scoring_version,9);
 assert.equal(record.prose_lang,'en');
 assert.equal(record.prose_audience,'beginner');
 assert.deepEqual(JSON.parse(record.prose_json),report.review,
  'real atomic CAS did not persist the claimed new report');
 assert.deepEqual(output.reported_review_source_moments,
  report.review.key_moments.map(m=>({ply:m.ply,san:m.san,fen_before:m.fen_before})));
 assert.equal(output.report_contains_current_new_ply3,false);
 if(kind==='clean'){
  assert.equal(packet.qa_error,null);
  assert.equal(obs.corrected_before_post,undefined);
  assert.equal(record.moves_json,badRow.moves_json);
  assert.equal(output.report_contains_old_move_g4,true);
  assert.equal(report.review.summary,oldCtrl.report.review.summary);
  validateReportMoments(report.review,oldHistory);
  assert(report.review.key_moments.some(x=>x.ply===3&&x.san==='g4'));
  assert.notEqual(report.review.key_moments[0].san,updatedHistory[2].san);
  return {real_authenticated_analysis_route_cache_accepted_old_source:true,
   new_game_pgn_opposite_checkmate_and_seven_plies:true,
   stale_engine_four_plies_returned_after_new_game:true,
   freshly_requested_review_sse_done_and_cached:true,
   fresh_report_moments_proven_from_wrong_PGN:true,
   matching_source_both_controls_valid:true,
   outdated_analysis_not_modified_during_generation:true,
   no_external_model:true,release_approved:false};
 }
 assert.match(packet.qa_error||'',/old analysis did NOT survive to successful new report admission/);
 const corrected=obs.corrected_before_post;
 assert(corrected&&corrected.real_corrected_analysis_move_count===7);
 assert.equal(corrected.fresh_cached_analysis.cached,true);
 validateMoves(updatedHistory,corrected.fresh_cached_analysis.analysis.moves);
 validateMoves(updatedHistory,JSON.parse(record.moves_json));
 validateReportMoments(report.review,updatedHistory);
 assert.equal(output.report_contains_old_move_g4,false);
 assert.equal(report.review.summary,newCtrl.report.review.summary);
 return {corrected_analysis_before_admission_prevents_source_mix:true,
  deliberate_safe_control_caused_expected_benchmark_failure:true,
  source_mismatched_product_report_not_accepted_as_green:true,
  release_approved:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const clean=JSON.parse(readFileSync(join(results,'coach-admission-source.json'),'utf8'));
 const fault=JSON.parse(readFileSync(join(results,'coach-admission-source-fault.json'),'utf8'));
 const genuine=verifyAdmissionSourceEvidence(clean);
 const control=verifyAdmissionSourceEvidence(fault,{kind:'fault'});
 assert.notEqual(clean.run_id,fault.run_id);
 const scripts=[
  'scripts/review-benchmark-coach-admission-source.mjs',
  'scripts/review-benchmark-coach-admission-proof.mjs',
  'scripts/review-benchmark-coach-admission-negatives.mjs',
  'scripts/review-benchmark-coach-admission-boundary.mjs',
 ];
 const report={schema_version:1,at_utc:new Date().toISOString(),
  branch:'agent/review-benchmark-20261111',
  prior_checkpoint:'7e569cd2e93147e20e210fa9806d179e0344fed3',
  checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  pinned_backend_candidate:pins.candidate,
  new_source_run_id:clean.run_id,positive_fix_control_run_id:fault.run_id,
  independent_genuine_route_evidence:genuine,
  independent_counterfactual_control:control,
  owner_source_sha256:originalSources,
  qa_scripts_sha256:Object.fromEntries(scripts.map(s=>[s,fileSha(join(root,s))])),
  verified_defect:'fresh POST /review admits source-inconsistent, pre-existing analysis because POST /analyze reused cache on depth/scoring only',
  unrelated_safety:'POST review CAS protects changes DURING generation; this regression occurs BEFORE generator admission',
  source_provenance:'two self-authored FIDE-legal checkmates with opposite winners, genuine Stockfish depth8, signed Hono routes, disposable SQLite',
  total_stockfish_searches_per_run:2,engine_threads:1,engine_hash_mib:16,
  no_external_model:true,private_data_used:false,
  no_product_source_changes:true,release_approved:false,integration_approved:false,
  limits:['Direct QA mutation of games.pgn via isolated SQLite; no production websocket timing claim',
   'Synthetic Fool and Scholar checkmates; source analysis correctness checked by independent chess.js replay',
   'New report uses product deterministic fallback prose (no real LLM), actual SSE and production CAS',
   'A correct analysis-source correlation requires approved source identity schema and migration design',
   'No real customer data, mass engine runs, owner source changes or release certification']};
 const out=join(qa,'certification-summary-checkpoint35.json');
 writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:out,genuine,control,release_approved:false},null,2));
}
