#!/usr/bin/env node
/** Try forged positive/negative evidence against independently replayed
 * Chrome/Hono/SQLite source-conflict proof. Never modify product fixtures. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyBrowserInflightSource} from './review-benchmark-browser-inflight-proof.mjs';

const path='qa/review-excellence/results/';
const clean=JSON.parse(readFileSync(path+'browser-inflight-source.json','utf8'));
const fault=JSON.parse(readFileSync(path+'browser-inflight-source-fault.json','utf8'));
assert.equal(verifyBrowserInflightSource(clean).backend_atomic_source_guard_rejected_old_write,true);
assert.equal(verifyBrowserInflightSource(fault,{kind:'fault'}).manual_cancel_closed_obsolete_model_connection,true);
const attacks=[
 ['wrong pinned frontend',x=>x.product_sha='f'.repeat(40)],
 ['wrong pinned backend',x=>x.backend_sha='f'.repeat(40)],
 ['wrong engine digest',x=>x.stockfish_sha256='f'.repeat(64)],
 ['wrong manifest digest',x=>x.manifest_sha256='f'.repeat(64)],
 ['wrong fixture identity',x=>x.fixture_id='user_game'],
 ['wrong source fixture digest',x=>x.fixture_sha256='f'.repeat(64)],
 ['incorrect previous checkpoint',x=>x.previous_checkpoint='f'.repeat(40)],
 ['reused no UUID',x=>x.run_id='old-evidence'],
 ['fake new PGN digest',x=>x.new_pgn_sha256='f'.repeat(64)],
 ['replace new PGN with old source',x=>x.new_pgn='1. f3 e5 2. g4 Qh4#'],
 ['replace new PGN mate SAN',x=>x.new_pgn=x.new_pgn.replace('Qxf7#','Qf3')],
 ['incorrect control summary',x=>x.control_summary='fake'],
 ['incorrect old game summary',x=>x.model_summary_for_old_game='fake'],
 ['fake release green',x=>x.product_release_approved=true],
 ['fake integration certification',x=>x.full_integration_certified=true],
 ['external model was really used',x=>x.external_model_requests=1],
 ['production user material',x=>x.synthetic_game_only=false],
 ['production DB leak',x=>x.disposable_db=false],
 ['no browser proof',x=>x.live_chrome_with_react=false],
 ['wrong Stockfish depth',x=>x.engine_depth=16],
 ['mass Stockfish workers',x=>x.engine_threads=16],
 ['mass hash',x=>x.engine_hash_mib=512],
 ['unbounded engine jobs',x=>x.stockfish_searches=200],
 ['hide scope limits',x=>x.limits=[]],
 ['old source PGN false hash',x=>x.observations.before_change.old_pgn_sha256='f'.repeat(64)],
 ['old source ply count false',x=>x.observations.before_change.old_plies=7],
 ['old provider not held',x=>x.observations.before_change.old_model_response_still_open=false],
 ['held wrong model request',x=>x.observations.before_change.old_model_id=3],
 ['control cached wrong text',x=>x.observations.control.cached_summary='old instead'],
 ['control GET wrong text',x=>x.observations.control.http_report_summary='old instead'],
 ['control was never posted',x=>x.observations.control.network_posts=0],
 ['control still busy after success',x=>x.observations.control.ui.progress=true],
 ['control wrong game',x=>x.observations.control.ui.path='/review/2'],
 ['control false UI',x=>x.observations.control.ui.hasGood=false],
 ['control error hidden',x=>x.observations.control.ui.error='fake error'],
 ['initial old model request aborted',x=>x.observations.before_change.ui.canceled=true],
 ['initial old model already completed',x=>x.observations.before_change.ui.progress=false],
 ['initial old model wrong game',x=>x.observations.before_change.ui.path='/review/1'],
 ['initial old model wrong board length',x=>x.observations.before_change.ui.moveCount='0 / 7'],
 ['game PGN not actually changed',x=>x.observations.after_change.real_game_pgn_updated=false],
 ['analysis not actually changed',x=>x.observations.after_change.real_analysis_updated=false],
 ['new source PGN hash incorrect',x=>x.observations.after_change.new_pgn_sha256='f'.repeat(64)],
 ['new plies did not change',x=>x.observations.after_change.new_plies=4],
 ['new analysis move count incorrect',x=>x.observations.after_change.new_engine_moves=4],
 ['PGN refetch never happened',x=>x.observations.after_change.actual_game_detail_GETs.pop()],
 ['duplicate GET request ID',x=>x.observations.after_change.actual_game_detail_GETs[1]=x.observations.after_change.actual_game_detail_GETs[0]],
 ['new game response status fabricated',x=>x.observations.after_change.real_http_game_detail.status=304],
 ['new game response is old PGN',x=>x.observations.after_change.real_http_game_detail.game_pgn='1. f3 e5 2. g4 Qh4#'],
 ['new analysis record omitted',x=>x.observations.after_change.real_http_game_detail.analysis_moves_json='[]'],
 ['new analysis UCI corrupted',x=>{
  const d=x.observations.after_change.real_http_game_detail;
  const moves=JSON.parse(d.analysis_moves_json);moves[0].uci='b1c3';d.analysis_moves_json=JSON.stringify(moves);
 }],
 ['new analysis row contains fewer moves',x=>{
  const d=x.observations.after_change.real_http_game_detail;
  const moves=JSON.parse(d.analysis_moves_json);moves.pop();d.analysis_moves_json=JSON.stringify(moves);
 }],
 ['browser auto-canceled obsolete model',x=>x.observations.after_change.old_model_response_still_open=false],
 ['browser not busy after source change',x=>x.observations.after_change.ui.progress=false],
 ['browser old board remained',x=>x.observations.after_change.ui.moveCount='0 / 4'],
 ['browser left review tab',x=>x.observations.after_change.ui.reportTab='false'],
 ['old prose already rendered',x=>x.observations.after_change.ui.hasOld=true],
 ['browser old input winner shown',x=>x.observations.after_change.ui.hasGood=true],
 ['browser showed error too early',x=>x.observations.after_change.ui.error='review_source_changed'],
 ['falsify new source refresh',x=>x.observations.after_change.read_new_moves=false],
 ['old model failed to send',x=>x.observations.old_response_sent=false],
 ['completion incorrectly saved old prose',x=>x.observations.after_release.backend_cached_prose_null=false],
 ['fake backend GET returns old report',x=>x.observations.after_release.backend_get.body={review:{summary:'old'}}],
 ['fake backend GET marked stale',x=>x.observations.after_release.backend_get.body={review:null,stale:true}],
 ['old response not sent to fake model',x=>x.observations.after_release.old_model_response_sent=false],
 ['user-facing raw conflict concealed',x=>x.observations.after_release.ui.error='Report generation cancelled'],
 ['front end swallowed conflict silently',x=>x.observations.after_release.ui.error=null],
 ['stale prose reached UI',x=>x.observations.after_release.ui.hasOld=true],
 ['stale source never stopped spinner',x=>x.observations.after_release.ui.progress=true],
 ['frontend presented old source ply count',x=>x.observations.after_release.ui.moveCount='0 / 4'],
 ['new write got old PGN',x=>x.observations.after_release.saved_source_pgn_sha256='f'.repeat(64)],
 ['new write got old analysis',x=>x.observations.after_release.saved_analysis_moves_sha256='f'.repeat(64)],
 ['backend model request left open',x=>x.observations.after_release.provider_request_closed=false],
 ['both Chrome POSTs share id',x=>x.observations.after_release.chrome_post_requests[1].id=x.observations.after_release.chrome_post_requests[0].id],
 ['second POST wrong game id',x=>x.observations.after_release.chrome_post_requests[1].url='/api/games/1/review'],
 ['fake extra Chrome POST',x=>x.observations.after_release.chrome_post_requests.push({id:'fake',url:'/api/games/2/review'})],
 ['model missed summary',x=>x.observations.after_release.provider_calls[5].stage='phase'],
 ['model missed moment',x=>x.observations.after_release.provider_calls[4].stage='phase'],
 ['model calls fabricated',x=>x.observations.after_release.provider_calls.push({id:7,stage:'summary'})],
 ['model had an error',x=>x.observations.after_release.provider_errors.push('error')],
 ['browser threw',x=>x.observations.after_release.browser_exceptions.push('TypeError')],
 ['unearned original clean success',x=>x.qa_status='fail'],
 ['clean run claims a fault',x=>x.test_only_fault='abort-after-source-change'],
 ['clean run hides error',x=>x.qa_error='unknown'],
 ['remove backend evidence entirely',x=>delete x.observations.after_release],
 ['remove HTTP game-detail evidence',x=>delete x.observations.after_change.real_http_game_detail],
 ['remove Chrome network evidence',x=>delete x.observations.after_release.chrome_post_requests],
];
const faultAttacks=[
 ['claim no manual fault',x=>x.test_only_fault=null],
 ['claim manual fault passed',x=>x.qa_status='pass'],
 ['remove actual cancelled marker',x=>x.observations.after_fault_cancel.canceled=false],
 ['after manual abort model is open',x=>x.observations.fault_cancel_model_connection_closed=false],
 ['manual abort did not execute',x=>x.observations.fault_cancel_exercised=false],
 ['manual abort cached an old report',x=>x.observations.fault_cancel_backend_cache_still_null=false],
 ['falsified error reason',x=>x.qa_error='Completely unrelated failure'],
 ['manual abort did not stop spinner',x=>x.observations.after_fault_cancel.progress=true],
 ['manual abort shows source conflict not cancel',x=>x.observations.after_fault_cancel.error='review_source_changed'],
 ['manual abort had produced old prose',x=>x.observations.after_fault_cancel.hasOld=true],
 ['manual abort source mismatched',x=>x.observations.after_fault_cancel.moveCount='0 / 4'],
 ['manual abort falsely completed provider',x=>x.observations.old_response_sent=true],
 ['manual abort incorrectly captured success output',x=>x.observations.after_release={}],
 ['manual abort fake green',x=>x.product_release_approved=true],
];
let cleanRejected=0,faultRejected=0;
for(const [name,mutate] of attacks){
 const p=structuredClone(clean);mutate(p);
 assert.throws(()=>verifyBrowserInflightSource(p),undefined,
  'forged clean in-flight Chrome evidence accepted: '+name);
 cleanRejected++;
}
for(const [name,mutate] of faultAttacks){
 const p=structuredClone(fault);mutate(p);
 assert.throws(()=>verifyBrowserInflightSource(p,{kind:'fault'}),undefined,
  'forged manual-cancel Chrome control accepted: '+name);
 faultRejected++;
}
console.log(JSON.stringify({independent_clean_evidence_verified:true,
 independent_manual_cancel_evidence_verified:true,
 forged_clean_packets_rejected:cleanRejected,
 forged_fault_packets_rejected:faultRejected,
 total_adversarial_rejections:cleanRejected+faultRejected,
 no_product_release_claimed:true}));
