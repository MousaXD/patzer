#!/usr/bin/env node
/** Fake-success and source-tampering controls for the independent genuine
 * Chrome + React Query stale prose finding. Every mutation must fail closed. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyBrowserSourceRefresh} from './review-benchmark-browser-source-proof.mjs';

const dir='qa/review-excellence/results/';
const clean=JSON.parse(readFileSync(dir+'browser-source-refresh.json','utf8'));
const fault=JSON.parse(readFileSync(dir+'browser-source-refresh-fault.json','utf8'));
assert.equal(verifyBrowserSourceRefresh(clean).stale_ai_report_still_visible_in_report_tab,true);
assert.equal(verifyBrowserSourceRefresh(fault,{kind:'fault'}).fault_correctly_rejected_as_false_green,true);
const modify=(packet,mutation)=>{
 const copy=structuredClone(packet);mutation(copy);return copy;
};
const attacks=[
 ['fake parent checkpoint',p=>p.previous_checkpoint='f'.repeat(40)],
 ['fake product source',p=>p.product_candidate_sha='f'.repeat(40)],
 ['fake backend source',p=>p.backend_candidate_sha='f'.repeat(40)],
 ['fake Stockfish',p=>p.stockfish_sha256='f'.repeat(64)],
 ['fake manifest',p=>p.manifest_sha256='f'.repeat(64)],
 ['fake fixture',p=>p.fixture_id='private game'],
 ['fake fixture hash',p=>p.fixture_sha256='f'.repeat(64)],
 ['reused run ID',p=>p.run_id='reused'],
 ['source PGN identity changed',p=>p.alternate_source_sha256='f'.repeat(64)],
 ['source PGN change removed',p=>p.alternate_source_pgn='1. e4 e5 *'],
 ['source final mate modified',p=>p.alternate_source_pgn=p.alternate_source_pgn.replace('Qxf7#','Qf3')],
 ['fabricate previously untested scenario',p=>p.scenario='just a mock frontend component'],
 ['fake model call budget',p=>p.stockfish_calls=100],
 ['fake engine depth',p=>p.engine_depth=22],
 ['fake engine threads',p=>p.engine_threads=8],
 ['fake engine hash',p=>p.engine_hash_mib=1024],
 ['false release green',p=>p.release_approved=true],
 ['false product fully certified',p=>p.product_fully_certified=true],
 ['false real user data',p=>p.self_authored_games_only=false],
 ['false Chrome integration',p=>p.local_vite_and_chrome=false],
 ['fake signed session',p=>p.auth_signed_local_session=false],
 ['fake production database',p=>p.db_disposable=false],
 ['old source digest fabricated',p=>p.observations.before.old_pgn_sha256='f'.repeat(64)],
 ['old source play length fabricated',p=>p.observations.before.old_ply_count=7],
 ['old prose marker fabricated',p=>p.observations.before.old_review_marker='MADE_UP'],
 ['old review hash malformed',p=>p.observations.before.old_review_sha256='bad'],
 ['old move analysis count changed',p=>p.observations.before.old_analysis_move_count=7],
 ['old engine depth falsified',p=>p.observations.before.old_analysis_depth=16],
 ['old accuracy unmeasured',p=>p.observations.before.old_analysis_accuracy_white=null],
 ['initial browser unmounted',p=>p.observations.initialUI.path='/dashboard'],
 ['initial old prose not shown',p=>p.observations.initialUI.oldText=false],
 ['initial report no longer selected',p=>p.observations.initialUI.reportTabSelected='false'],
 ['initial move counter wrong',p=>p.observations.initialUI.moveCount='0 / 7'],
 ['initial regenerate button invented',p=>p.observations.initialUI.writeReportAvailable=true],
 ['initial bookmark button hidden',p=>p.observations.initialUI.bookmarkButtonPresent=false],
 ['harmless bookmark never refetched',p=>p.observations.harmlessBookmark={before:1,after:1}],
 ['harmless bookmark dropped old prose',p=>p.observations.afterHarmlessUI.oldText=false],
 ['harmless bookmark changed board',p=>p.observations.afterHarmlessUI.moveCount='0 / 7'],
 ['new PGN hash fabricated',p=>p.observations.changedBackend.new_pgn_sha256='f'.repeat(64)],
 ['new move count overstated',p=>p.observations.changedBackend.new_ply_count=12],
 ['new analysis count overstated',p=>p.observations.changedBackend.new_analysis_move_count=4],
 ['new accuracy fabricated',p=>p.observations.changedBackend.new_analysis_accuracy_white='100'],
 ['new server game not received',p=>p.observations.changedBackend.real_server_new_game_pgn=false],
 ['new engine analysis not received',p=>p.observations.changedBackend.real_server_new_analysis_moves=false],
 ['backend report not null',p=>p.observations.changedBackend.real_server_cached_report_null=false],
 ['backend report HTTP error',p=>p.observations.changedBackend.server_response_status=404],
 ['bookmark failed to trigger refetch',p=>p.observations.changedBookmark={before:2,after:2}],
 ['report board failed to update',p=>p.observations.afterSourceReportUI.moveCount='0 / 4'],
 ['report old prose not shown on first refetch',p=>p.observations.afterSourceReportUI.oldText=false],
 ['moves tab never switched',p=>p.observations.afterSourceMovesUI.reportTabSelected='true'],
 ['new SAN was not displayed',p=>p.observations.afterSourceMovesUI.newMate=false],
 ['source count moved while viewing move list',p=>p.observations.afterSourceMovesUI.moveCount='0 / 4'],
 ['new source report tab never reselected',p=>p.observations.afterSourceUI.reportTabSelected='false'],
 ['old report suddenly disappeared',p=>p.observations.afterSourceUI.oldText=false],
 ['old report disappeared after resetting control',p=>p.observations.afterSourceUI.writeReportAvailable=true],
 ['refetch did not bring source moves',p=>p.observations.afterSourceUI.moveCount='0 / 4'],
 ['new source page path switched',p=>p.observations.afterSourceUI.path='/review/2'],
 ['one browser GET hidden',p=>p.observations.realGameDetailGetNetworkIds.pop()],
 ['two network requests reused identity',p=>{
  const ids=p.observations.realGameDetailGetNetworkIds;ids[2]=ids[1];
 }],
 ['new browser analysis actually stale',p=>p.observations.httpNetwork.changed_game.analysis_moves_sha256='foo'],
 ['new source game identity absent',p=>p.observations.httpNetwork.changed_game.game_pgn_sha256='f'.repeat(64)],
 ['backend returned old report',p=>p.observations.httpNetwork.changed_review.body={review:{summary:'old'}}],
 ['backend marked error',p=>p.observations.httpNetwork.changed_review.status=500],
 ['old report generated by an unknown model',p=>p.observations.httpNetwork.original_cached_review.summary='different'],
 ['old cache read had no status',p=>p.observations.httpNetwork.original_cached_review.status=null],
 ['post-navigation stale text still shown',p=>p.observations.afterHardNavigationUI.oldText=true],
 ['post-navigation wrong game count',p=>p.observations.afterHardNavigationUI.moveCount='0 / 4'],
 ['post-navigation no write button',p=>p.observations.afterHardNavigationUI.writeReportAvailable=false],
 ['post-navigation report tab missing',p=>p.observations.afterHardNavigationUI.reportTabSelected='false'],
 ['browser JS runtime exceptions hidden',p=>p.observations.browserExceptions=['Uncaught TypeError']],
 ['fake browser version',p=>p.observations.chrome_version='Chrome 120'],
 ['clean run claims to be faulted',p=>p.test_only_fault='remount-client'],
 ['clean run omitted clean terminal status',p=>p.qa_status='fail'],
 ['clean run smuggled exception',p=>p.qa_error='browser crashed'],
 ['clean run elapsed time invalid',p=>p.elapsed_ms=999999],
 ['old source appears in both states',p=>p.observations.changedBackend.new_pgn_sha256=p.observations.before.old_pgn_sha256],
 ['remove source benchmark evidence',p=>delete p.observations.changedBackend],
 ['remove Chrome network identity evidence',p=>delete p.observations.realGameDetailGetNetworkIds],
 ['remove HTTP evidence entirely',p=>delete p.observations.httpNetwork],
 ['remove post-navigation proof',p=>delete p.observations.afterHardNavigationUI],
];
const faultAttacks=[
 ['no fault switch',p=>p.test_only_fault=null],
 ['fault claimed pass',p=>p.qa_status='pass'],
 ['fault no longer triggered',p=>p.observations.remountFaultExercised=false],
 ['fault did not clear old UI',p=>p.observations.afterSourceUI.oldText=true],
 ['fault now still shows marker',p=>p.observations.failureBrowserState.oldText=true],
 ['fault error omitted',p=>p.qa_error=null],
 ['fault did not fail correct assertion',p=>p.qa_error='Different unrelated browser crash'],
 ['fault changed source not refetched',p=>p.observations.afterSourceUI.moveCount='0 / 4'],
 ['fault invents success-only navigation',p=>p.observations.afterHardNavigationUI={oldText:false}],
 ['fault invents missing HTTP record',p=>p.observations.httpNetwork={}],
 ['fault changed source PGN hash',p=>p.alternate_source_sha256='f'.repeat(64)],
 ['fault claims release green',p=>p.release_approved=true],
];
let rejectedClean=0,rejectedFault=0;
for(const [name,mutate] of attacks){
 assert.throws(()=>verifyBrowserSourceRefresh(modify(clean,mutate)),undefined,
  'falsified clean Chrome evidence incorrectly certified: '+name);
 rejectedClean++;
}
for(const [name,mutate] of faultAttacks){
 assert.throws(()=>verifyBrowserSourceRefresh(modify(fault,mutate),{kind:'fault'}),undefined,
  'falsified negative-control Chrome evidence accepted: '+name);
 rejectedFault++;
}
console.log(JSON.stringify({clean_browser_evidence_accepted:true,
 deliberate_browser_fault_rejected_as_negative:true,
 forged_clean_evidence_rejected:rejectedClean,
 forged_fault_evidence_rejected:rejectedFault,
 total_adversarial_packets_rejected:rejectedClean+rejectedFault,
 product_release_approved:false}));
