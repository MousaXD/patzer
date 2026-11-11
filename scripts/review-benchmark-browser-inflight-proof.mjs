#!/usr/bin/env node
/** Independently attest a held REAL Chrome/Hono SSE report across a same-
 * game source change. Verify PGNs, route source hashes, actual game-detail
 * response and report CAS outcome. No imports from owner code. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Chess} from 'chess.js';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const results=join(qa,'results');
const sha=x=>createHash('sha256').update(x).digest('hex');
const fileSHA=p=>sha(readFileSync(p));
const stable={
 product:'d72eaced6972c8a2ec7d8581365c45788b15a29a',
 backend:'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87',
 engine:'00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca',
 manifest:'2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44',
 oldPgn:'13f1a0fa95e0a4acfd77168159c38ccc514f3b60d083945bbb49f2913524196e',
 newPgn:'5b2742da5ae594182a680bb7984ed0a752892bb293f4062e2350cb2af0200c74',
 newMoves:'6fcf5ec12010db4857cdd5b36ab22c8a09d3a43b93009945454ebffad5b87084',
};
const ownerPaths={
 'web/src/pages/GameAnalyzer.tsx':{
  where:'product',sha:'17ffb273f13c97444f44141aaa2ca79bf236cfebe4bf09bfc0edf4dbecb1440c'},
 'web/src/components/GameReportPanel.tsx':{
  where:'product',sha:'c3c033be05df83ef230b85542c906ae6321d88fa5169705cd00e8eaeceb49ddb'},
 'server/src/routes/review.ts':{
  where:'backend',sha:'21e0a25f00418d7c1749b6089ed6d685ad1cb4f752e28bf5af16f9fa752442d0'},
 'server/src/coach/reviewCache.ts':{
  where:'backend',sha:'72aba2c3883feb2534fd8fd252f0eed9189eaccc46911141ac3943256019912b'},
};
const frontend=realpathSync(join(results,'worktree-product-browser'));
const backend=realpathSync(join(results,'worktree-coach'));
for(const [dir,want] of [[frontend,stable.product],[backend,stable.backend]]){
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:dir,encoding:'utf8'}).trim(),want);
}
for(const [name,entry] of Object.entries(ownerPaths)){
 const dir=entry.where==='product'?frontend:backend;
 assert.equal(fileSHA(join(dir,name)),entry.sha,'owner file changed: '+name);
}
assert.equal(fileSHA(join(results,'engine/unpacked/usr/games/stockfish')),stable.engine);
const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8');
assert.equal(sha(manifest),stable.manifest);
const fixture=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.license==='self-authored'&&fixture.source_kind==='synthetic');
const oldPgn=readFileSync(join(qa,'fixtures',fixture.pgn_file),'utf8');
assert.equal(sha(oldPgn),stable.oldPgn);
assert.equal(fixture.pgn_sha256,stable.oldPgn);
const original=new Chess();original.loadPgn(oldPgn,{strict:true});
assert(original.isCheckmate()&&original.turn()==='w'&&original.history().length===4);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const good='QA_CONTROL_BLACK_WON',obsolete='QA_OLD_BLACK_WON_AFTER_SOURCE_CHANGED';
function browserState(s,{path,plies,progress,error=null,canceled=false,old=false,control=false,button=false}){
 assert(s&&typeof s==='object');
 assert.equal(s.path,'/review/'+path);
 assert.equal(s.moveCount,`0 / ${plies}`);
 assert.equal(s.reportTab,'true');
 assert.equal(s.progress,progress);
 assert.equal(s.error,error);
 assert.equal(s.canceled,canceled);
 assert.equal(s.hasOld,old);
 assert.equal(s.hasGood,control);
 assert.equal(s.writeButton,button);
}
function sharedEvidence(packet,type){
 assert.equal(packet.schema_version,1);
 assert(UUID.test(packet.run_id||''),'invalid fresh browser run UUID');
 assert.equal(packet.previous_checkpoint,'a59edb0d1f2ecf645ea01151ad1f5850e2e13482');
 assert.equal(packet.product_sha,stable.product);
 assert.equal(packet.backend_sha,stable.backend);
 assert.equal(packet.stockfish_sha256,stable.engine);
 assert.equal(packet.manifest_sha256,stable.manifest);
 assert.equal(packet.fixture_id,fixture.fixture_id);
 assert.equal(packet.fixture_sha256,fixture.pgn_sha256);
 assert.equal(packet.new_pgn_sha256,stable.newPgn);
 assert.equal(sha(packet.new_pgn),stable.newPgn);
 const change=new Chess();change.loadPgn(packet.new_pgn,{strict:true});
 assert(change.isCheckmate()&&change.turn()==='b'&&change.history().length===7);
 assert.equal(change.header().Result,'1-0');
 assert.equal(packet.model_summary_for_old_game,obsolete);
 assert.equal(packet.control_summary,good);
 assert.equal(packet.test_only_fault,type==='clean'?null:'abort-after-source-change');
 assert.equal(packet.qa_status,type==='clean'?'pass':'fail');
 assert.equal(packet.product_release_approved,false);
 assert.equal(packet.full_integration_certified,false);
 assert.equal(packet.engine_depth,8);
 assert.equal(packet.engine_threads,1);
 assert.equal(packet.engine_hash_mib,16);
 assert.equal(packet.stockfish_searches,2);
 assert.equal(packet.external_model_requests,0);
 assert.equal(packet.synthetic_game_only,true);
 assert.equal(packet.disposable_db,true);
 assert.equal(packet.live_chrome_with_react,true);
 assert(packet.elapsed_ms>0&&packet.elapsed_ms<45000,'unbounded or missing Chrome timing');
 assert(Array.isArray(packet.limits)&&packet.limits.length===5);
 const o=packet.observations;
 assert(o&&typeof o==='object');
 browserState(o.control_before,{path:1,plies:4,progress:true});
 assert.equal(o.control.cached_summary,good);
 assert.equal(o.control.http_report_summary,good);
 assert.equal(o.control.network_posts,1);
 browserState(o.control.ui,{path:1,plies:4,progress:false,control:true});
 assert.equal(o.before_change.old_model_response_still_open,true);
 assert.equal(o.before_change.old_model_id,6);
 assert.equal(o.before_change.old_pgn_sha256,stable.oldPgn);
 assert.equal(o.before_change.old_plies,4);
 browserState(o.before_change.ui,{path:2,plies:4,progress:true});
 assert.equal(o.after_change.old_model_response_still_open,true,
  'real model request was already closed on same-game PGN change');
 browserState(o.after_change.ui,{path:2,plies:7,progress:true});
 assert.equal(o.after_change.read_new_moves,true);
 assert.equal(o.after_change.new_pgn_sha256,stable.newPgn);
 assert.equal(o.after_change.new_plies,7);
 assert.equal(o.after_change.new_engine_moves,7);
 assert.equal(o.after_change.real_game_pgn_updated,true);
 assert.equal(o.after_change.real_analysis_updated,true);
 const actual=o.after_change.real_http_game_detail;
 assert(actual&&actual.status===200);
 assert.equal(actual.game_pgn,packet.new_pgn);
 const stored=JSON.parse(actual.analysis_moves_json);
 assert(Array.isArray(stored)&&stored.length===7);
 const moves=change.history({verbose:true});
 for(let i=0;i<stored.length;i++){
  assert.equal(stored[i].ply,i+1);
  assert.equal(stored[i].uci,moves[i].from+moves[i].to+(moves[i].promotion||''),
   'new analysis does not correspond to independently replayed new source');
 }
 assert.equal(sha(actual.analysis_moves_json),stable.newMoves);
 assert(Array.isArray(o.after_change.actual_game_detail_GETs));
 assert.equal(o.after_change.actual_game_detail_GETs.length,2);
 assert.equal(new Set(o.after_change.actual_game_detail_GETs).size,2);
 return o;
}
export function verifyBrowserInflightSource(packet,{kind='clean'}={}){
 assert(['clean','fault'].includes(kind));
 const o=sharedEvidence(packet,kind);
 if(kind==='clean'){
  assert.equal(packet.qa_error,null);
  assert.equal(o.fault_cancel_exercised,undefined);
  assert.equal(o.old_response_sent,true);
  const a=o.after_release;
  assert(a&&typeof a==='object');
  browserState(a.ui,{path:2,plies:7,progress:false,error:'review_source_changed',button:true});
  assert.deepEqual(a.backend_get,{status:200,body:{review:null}},
   'backend erroneously returned a stale report after changing source');
  assert.equal(a.old_model_response_sent,true);
  assert.equal(a.backend_cached_prose_null,true);
  assert.equal(a.saved_source_pgn_sha256,stable.newPgn);
  assert.equal(a.saved_analysis_moves_sha256,stable.newMoves);
  assert.equal(a.provider_request_closed,true);
  assert(Array.isArray(a.chrome_post_requests)&&a.chrome_post_requests.length===2);
  assert.deepEqual(a.chrome_post_requests.map(x=>x.url),[
   '/api/games/1/review','/api/games/2/review']);
  assert.equal(new Set(a.chrome_post_requests.map(x=>x.id)).size,2);
  assert.deepEqual(a.provider_calls,Array.from({length:6},(_,i)=>({
   id:i+1,stage:['phase','moment','summary'][i%3]})));
  assert.deepEqual(a.provider_errors,[]);
  assert.deepEqual(a.browser_exceptions,[]);
  assert.equal(o.after_fault_cancel,undefined);
  return {actual_chrome_and_authenticated_Hono:true,
   same_game_refetch_while_model_summary_held:true,
   obsolete_model_connection_remained_active:true,
   old_model_result_finished_after_source_change:true,
   backend_atomic_source_guard_rejected_old_write:true,
   frontend_displayed_raw_source_conflict_error:true,
   stale_ai_prose_not_written_or_rendered:true,
   control_unchanged_game_stored_report:true,
   real_model_calls:0,release_approved:false};
 }
 assert.match(packet.qa_error||'',/outdated model request was already terminated or aborted/);
 assert.equal(o.fault_cancel_exercised,true);
 assert.equal(o.fault_cancel_model_connection_closed,true);
 assert.equal(o.fault_cancel_backend_cache_still_null,true);
 browserState(o.after_fault_cancel,{path:2,plies:7,progress:false,
  error:'Report generation cancelled. You can try again.',canceled:true,button:true});
 assert.equal(o.old_response_sent,false);
 assert.equal(o.after_release,undefined);
 assert.equal(o.failure_state?.canceled,true);
 return {manual_cancel_closed_obsolete_model_connection:true,
  deliberate_cancel_provoked_expected_benchmark_failure:true,
  would_not_count_clean_as_repaired:true,
  release_approved:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const clean=JSON.parse(readFileSync(join(results,'browser-inflight-source.json'),'utf8'));
 const fault=JSON.parse(readFileSync(join(results,'browser-inflight-source-fault.json'),'utf8'));
 const cleanProof=verifyBrowserInflightSource(clean);
 const faultProof=verifyBrowserInflightSource(fault,{kind:'fault'});
 assert.notEqual(clean.run_id,fault.run_id);
 const scripts=[
  'scripts/review-benchmark-browser-inflight-source.mjs',
  'scripts/review-benchmark-browser-inflight-proof.mjs',
  'scripts/review-benchmark-browser-inflight-negatives.mjs',
  'scripts/review-benchmark-browser-inflight-boundary.mjs',
 ];
 const summary={schema_version:1,at_utc:new Date().toISOString(),
  branch:'agent/review-benchmark-20261111',
  preceding_commit:'a59edb0d1f2ecf645ea01151ad1f5850e2e13482',
  local_head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  pinned_backend:stable.backend,pinned_product:stable.product,
  clean_run_id:clean.run_id,negative_control_run_id:fault.run_id,
  independent_chrome_source_conflict_proof:cleanProof,
  independent_manual_abort_control:faultProof,
  source_pins:Object.fromEntries(Object.entries(ownerPaths).map(([k,v])=>[k,v.sha])),
  script_sha256:Object.fromEntries(scripts.map(s=>[s,fileSHA(join(root,s))])),
  observed_product_gap:'Same-game source reanalysis does not abort already running frontend model work; eventual error exposes raw review_source_changed',
  observed_correct_guard:'Actual Hono CAS prevents old model summary from being persisted or rendered after game PGN/analysis changed',
  real_llm_calls:0,stockfish_searches_per_browser_run:2,engine_depth:8,
  production_data_used:false,owner_source_modified:false,
  release_approved:false,integration_approved:false,
  limitations:['Synthetic same-game PGN replacement and saved analysis via isolated DB, not a live websocket',
   'Fake local vLLM-compatible provider with final response held; no real model billing',
   'Two low-depth single-thread Stockfish searches per subprocess; no mass benchmark',
   'UI triggers actual bookmark/refetch, not proof of real-time PvP state subscription',
   'No claim of arbitrary SSE events, public production incident frequency, sealed human ground-truth or release readiness']};
 const file=join(qa,'certification-summary-checkpoint34.json');
 writeFileSync(file,JSON.stringify(summary,null,2)+'\n');
 console.log(JSON.stringify({file,clean:cleanProof,fault:faultProof,release_approved:false},null,2));
}
