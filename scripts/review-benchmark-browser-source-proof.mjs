#!/usr/bin/env node
/** Independent Chrome source-freshness certificate (not a product pass).
 * Replays both synthetic PGNs, binds detached React/backend source hashes,
 * checks real browser-refetch/CDP and authenticated null-cache evidence, then
 * demands a deliberate QA-only remount fault fail rather than falsely pass. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {Chess} from 'chess.js';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const results=join(qa,'results');
const sha=s=>createHash('sha256').update(s).digest('hex');
const hashFile=file=>sha(readFileSync(file));
const pgnSha='13f1a0fa95e0a4acfd77168159c38ccc514f3b60d083945bbb49f2913524196e';
const newPgnSha='4151d00e4760b3075a15a1f87e1b28c2bce8995b21cf4534fc360f8ee89bb45e';
const engineSha='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const manifestSha='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
const backSha='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const frontSha='d72eaced6972c8a2ec7d8581365c45788b15a29a';
const codeDigests={
 'web/src/pages/GameAnalyzer.tsx':'17ffb273f13c97444f44141aaa2ca79bf236cfebe4bf09bfc0edf4dbecb1440c',
 'web/src/components/GameReportPanel.tsx':'c3c033be05df83ef230b85542c906ae6321d88fa5169705cd00e8eaeceb49ddb',
 'server/src/routes/review.ts':'21e0a25f00418d7c1749b6089ed6d685ad1cb4f752e28bf5af16f9fa752442d0',
 'server/src/routes/analyze.ts':'ccfe50080f298fc0cdc25848b1f62f77f2bcb28bd36947af5b874b504d6f4b3d',
};
const frontend=realpathSync(join(results,'worktree-product-browser'));
const backend=realpathSync(join(results,'worktree-coach'));
assert(relative(results,frontend).startsWith('worktree-')&&relative(results,backend).startsWith('worktree-'));
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:frontend,encoding:'utf8'}).trim(),frontSha);
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:backend,encoding:'utf8'}).trim(),backSha);
for(const [path,hash] of Object.entries(codeDigests))
 assert.equal(hashFile(join(path.startsWith('web/')?frontend:backend,path)),hash);
assert.equal(hashFile(join(results,'engine/unpacked/usr/games/stockfish')),engineSha);
const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8');
assert.equal(sha(manifest),manifestSha);
const fixture=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert.equal(fixture.license,'self-authored');assert.equal(fixture.source_kind,'synthetic');
const source=readFileSync(join(qa,'fixtures',fixture.pgn_file),'utf8');
assert.equal(sha(source),pgnSha);assert.equal(fixture.pgn_sha256,pgnSha);
const first=new Chess();first.loadPgn(source,{strict:true});
assert(first.isCheckmate()&&first.turn()==='w'&&first.history().length===4);
const idFormat=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const marker='QA_OLD_BLACK_WINNER_PROSE_STAYS';
function assertUI(ui,{expectedCount,oldText,reportTab,moveVisible=null,writeReport=null}){
 assert(ui&&typeof ui==='object');
 assert.equal(ui.path,'/review/1');
 assert.equal(ui.moveCount,`0 / ${expectedCount}`);
 assert.equal(ui.oldText,oldText);
 assert.equal(ui.reportTabSelected,reportTab?'true':'false');
 assert.equal(ui.bookmarkButtonPresent,true);
 if(moveVisible!==null)assert.equal(ui.newMate,moveVisible);
 if(writeReport!==null)assert.equal(ui.writeReportAvailable,writeReport);
}
function verifyStatic(packet,kind){
 assert.equal(packet.schema_version,1);
 assert(idFormat.test(packet.run_id||''));
 assert.equal(packet.previous_checkpoint,'29af85a72963824ba3a9308dd50afed13302a71b');
 assert.equal(packet.product_candidate_sha,frontSha);
 assert.equal(packet.backend_candidate_sha,backSha);
 assert.equal(packet.stockfish_sha256,engineSha);
 assert.equal(packet.manifest_sha256,manifestSha);
 assert.equal(packet.fixture_id,fixture.fixture_id);
 assert.equal(packet.fixture_sha256,pgnSha);
 assert.equal(packet.alternate_source_sha256,newPgnSha);
 assert.equal(sha(packet.alternate_source_pgn),newPgnSha);
 const later=new Chess();later.loadPgn(packet.alternate_source_pgn,{strict:true});
 assert(later.isCheckmate()&&later.turn()==='b'&&later.history().length===7);
 assert.equal(packet.scenario,
  'same game route, bookmark-triggered React Query refetch, source reanalysis, null backend report');
 assert.equal(packet.test_only_fault,kind==='clean'?null:'remount-client');
 assert.equal(packet.qa_status,kind==='clean'?'pass':'fail');
 assert.equal(packet.release_approved,false);
 assert.equal(packet.product_fully_certified,false);
 assert.equal(packet.stockfish_calls,2);
 assert.equal(packet.engine_depth,8);
 assert.equal(packet.engine_threads,1);
 assert.equal(packet.engine_hash_mib,16);
 assert.equal(packet.local_vite_and_chrome,true);
 assert.equal(packet.auth_signed_local_session,true);
 assert.equal(packet.self_authored_games_only,true);
 assert.equal(packet.db_disposable,true);
 assert.equal(typeof packet.elapsed_ms,'number');
 assert(packet.elapsed_ms>=0&&packet.elapsed_ms<45000,'unbounded Chrome/engine job');
 const ob=packet.observations;
 assert(ob&&typeof ob==='object');
 assert.equal(ob.before.old_pgn_sha256,pgnSha);
 assert.equal(ob.before.old_ply_count,4);
 assert.equal(ob.before.old_review_marker,marker);
 assert(/^[a-f0-9]{64}$/.test(ob.before.old_review_sha256));
 assert.equal(ob.before.old_analysis_move_count,4);
 assert.equal(ob.before.old_analysis_depth,8);
 assert(Number.isFinite(ob.before.old_analysis_accuracy_white));
 assertUI(ob.initialUI,{expectedCount:4,oldText:true,reportTab:true,writeReport:false});
 assertUI(ob.afterHarmlessUI,{expectedCount:4,oldText:true,reportTab:true,writeReport:false});
 assert.deepEqual(ob.harmlessBookmark,{before:1,after:2});
 assert.equal(ob.changedBackend.new_pgn_sha256,newPgnSha);
 assert.equal(ob.changedBackend.new_ply_count,7);
 assert.equal(ob.changedBackend.new_analysis_move_count,7);
 assert(Number.isFinite(ob.changedBackend.new_analysis_accuracy_white));
 assert.equal(ob.changedBackend.real_server_new_game_pgn,true);
 assert.equal(ob.changedBackend.real_server_new_analysis_moves,true);
 assert.equal(ob.changedBackend.real_server_cached_report_null,true);
 assert.equal(ob.changedBackend.server_response_status,200);
 assert.deepEqual(ob.changedBookmark,{before:2,after:3});
 assertUI(ob.afterSourceReportUI,{expectedCount:7,oldText:true,reportTab:true,writeReport:false});
 assertUI(ob.afterSourceMovesUI,{expectedCount:7,oldText:false,reportTab:false,moveVisible:true});
 assert(Array.isArray(ob.realGameDetailGetNetworkIds)&&ob.realGameDetailGetNetworkIds.length===3);
 assert.equal(new Set(ob.realGameDetailGetNetworkIds).size,3,
  'missing unique browser network GETs proving actual React Query refresh');
 if(kind==='clean'){
  assert.deepEqual(ob.httpNetwork.changed_review,{status:200,body:{review:null}},
   'backend was not demonstrably clean of stale report after game change');
  assert.equal(ob.httpNetwork.changed_game.status,200);
  assert.equal(ob.httpNetwork.changed_game.game_pgn_sha256,newPgnSha);
  assert(/^[a-f0-9]{64}$/.test(ob.httpNetwork.changed_game.analysis_moves_sha256));
  assert.equal(ob.httpNetwork.original_cached_review.status,200);
  assert(ob.httpNetwork.original_cached_review.summary.startsWith(marker));
  assert(ob.httpNetwork.original_cached_review.summary.includes('Your accuracy was'));
  assert.deepEqual(ob.browserExceptions,[]);
  assert(/^Google Chrome 157\./.test(ob.chrome_version),'unexpected browser provenance');
 }else{
  // A deliberately failing run stops before success-only end-of-run capture.
  // Never fabricate those observations; require them to be absent instead.
  assert.equal(ob.httpNetwork,undefined);
  assert.equal(ob.browserExceptions,undefined);
  assert.equal(ob.chrome_version,undefined);
 }
 return ob;
}

export function verifyBrowserSourceRefresh(packet,{kind='clean'}={}){
 assert(['clean','fault'].includes(kind));
 const ob=verifyStatic(packet,kind);
 if(kind==='clean'){
  assert.equal(packet.qa_error,null);
  assert.equal(ob.remountFaultExercised,undefined);
  assertUI(ob.afterSourceUI,{expectedCount:7,oldText:true,reportTab:true,writeReport:false});
  assertUI(ob.afterHardNavigationUI,{expectedCount:7,oldText:false,reportTab:true,writeReport:true});
  assert.equal(ob.failureBrowserState,undefined);
  return {actual_react_board_updated_after_query_refetch:true,
   distinct_signed_game_detail_GETs:ob.realGameDetailGetNetworkIds.length,
   new_San_move_visible_in_moves_tab:true,
   stale_ai_report_still_visible_in_report_tab:true,
   backend_report_was_null:true,
   full_navigation_cleared_stale_ui:true,
   owner_product_fixed:false,release_approved:false};
 }
 assert.match(packet.qa_error||'',/stale report was NOT still visible/);
 assert.equal(ob.remountFaultExercised,true);
 assertUI(ob.afterSourceUI,{expectedCount:7,oldText:false,reportTab:true,writeReport:true});
 assert.equal(ob.afterHardNavigationUI,undefined);
 assertUI(ob.failureBrowserState,{expectedCount:7,oldText:false,reportTab:true,writeReport:true});
 return {fault_correctly_rejected_as_false_green:true,
  browser_would_remove_stale_prose_after_forced_remount:true,
  release_approved:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const clean=JSON.parse(readFileSync(join(results,'browser-source-refresh.json'),'utf8'));
 const fault=JSON.parse(readFileSync(join(results,'browser-source-refresh-fault.json'),'utf8'));
 const cleanProof=verifyBrowserSourceRefresh(clean);
 const faultProof=verifyBrowserSourceRefresh(fault,{kind:'fault'});
 assert.notEqual(clean.run_id,fault.run_id);
 const scripts=[
  'scripts/review-benchmark-browser-source-refresh.mjs',
  'scripts/review-benchmark-browser-source-proof.mjs',
  'scripts/review-benchmark-browser-source-negatives.mjs',
  'scripts/review-benchmark-browser-source-boundary.mjs',
 ];
 const out={schema_version:1,at_utc:new Date().toISOString(),
  assigned_branch:'agent/review-benchmark-20261111',
  prior_checkpoint:'29af85a72963824ba3a9308dd50afed13302a71b',
  current_checkout:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  product_candidate_sha:frontSha,backend_candidate_sha:backSha,
  clean_browser_run_id:clean.run_id,fault_browser_run_id:fault.run_id,
  independent_real_chrome_evidence:cleanProof,
  independently_rejected_fault:faultProof,
  pinned_owner_source_sha256:codeDigests,
  qa_script_sha256:Object.fromEntries(scripts.map(s=>[s,hashFile(join(root,s))])),
  product_bug:'already-mounted GameAnalyzer keeps AI prose after same-game React Query refetch with new PGN, new engine analysis and null backend report',
  test_scope:'one synthetic game changed to a distinct opposite-winner game, read-only owner React and Hono via real Chrome 157',
  stockfish_searches_per_run:2,depth:8,threads:1,hash_mib:16,
  external_llm_calls:0,production_database_calls:0,real_users:0,
  no_owner_code_modified:true,release_approved:false,integration_approved:false,
  limitations:['The visible prose contains a deliberately injected synthetic QA marker; actual review object is built by owner code without external LLM',
   'Two independently bounded Stockfish depth-8 game analyses per Chrome process, no mass search',
   'The cache is explicitly cleared by QA SQL after source change; this is a controlled backend-safe state used to isolate the React state bug',
   'React Query refetch initiated by genuine bookmark mutation, not a production real-time push event',
   'No inference about live frequency, user demographics, rollout, sealed holdout or final release correctness']};
 const file=join(qa,'certification-summary-checkpoint33.json');
 writeFileSync(file,JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({report:file,...cleanProof,fault_rejected:true},null,2));
}
