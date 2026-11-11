#!/usr/bin/env node
/** Challenge early-stage certification with corrupt TEST-ONLY evidence; the
 * actual broken real-browser run is independently exercised by the boundary.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyEarlyStageCancellation} from './review-benchmark-browser-early-proof.mjs';

const clean=JSON.parse(readFileSync('qa/review-excellence/results/review-early-retry.json','utf8'));
const fault=JSON.parse(readFileSync('qa/review-excellence/results/review-early-retry-fault.json','utf8'));
assert.equal(verifyEarlyStageCancellation(clean,'clean').real_chrome_phase_cancel_retry_certified,true);
assert.equal(verifyEarlyStageCancellation(fault,'fault').actual_stale_cache_and_UI_detected,true);
const corruptions=[
 ['wrong frontend source',p=>p.frontend_sha='f'.repeat(40)],
 ['wrong backend source',p=>p.backend_sha='f'.repeat(40)],
 ['Stockfish drift',p=>p.engine_sha256='f'.repeat(64)],
 ['manifest drift',p=>p.manifest_sha256='f'.repeat(64)],
 ['different fixture',p=>p.fixture_id='SYN-UNLICENSED-GAME'],
 ['stale run packet',p=>p.run_id='old-qa-packet'],
 ['invent full certification',p=>p.full_security_certified=true],
 ['invent release approval',p=>p.release_approved=true],
 ['private data substitution',p=>p.synthetic_only=false],
 ['production DB substituted',p=>p.disposable_database_only=false],
 ['fake browser version',p=>p.chrome_version='Headless-Chrome-Mock'],
 ['hide incomplete experiment',p=>p.incomplete_scenario={game_id:1}],
 ['first scenario missing',p=>p.scenarios.shift()],
 ['second scenario wrong order',p=>p.scenarios.reverse()],
 ['wrong first game id',p=>p.scenarios[0].game_id=99],
 ['wrong second game id',p=>p.scenarios[1].game_id=99],
 ['misreported phase vs moment',p=>p.scenarios[0].held_stage='moment'],
 ['wrong stage fixture',p=>p.scenarios[1].fixture_id='SYN-CHANGED'],
 ['wrong first provider sequence',p=>p.scenarios[0].first_stage_sequence=9],
 ['wrong moment provider sequence',p=>p.scenarios[1].first_stage_sequence=9],
 ['fake initial stage',p=>p.scenarios[0].initial_stages=['summary']],
 ['first browser fault count changed',p=>p.scenarios[0].bypass_count=1-p.scenarios[0].bypass_count],
 ['second browser fault count changed',p=>p.scenarios[1].bypass_count=1-p.scenarios[1].bypass_count],
 ['first ignored abort count changed',p=>p.scenarios[0].abort_calls_swallowed=1-p.scenarios[0].abort_calls_swallowed],
 ['second ignored abort count changed',p=>p.scenarios[1].abort_calls_swallowed=1-p.scenarios[1].abort_calls_swallowed],
 ['first model termination forged',p=>p.scenarios[0].old_closed_before_release=!p.scenarios[0].old_closed_before_release],
 ['second model termination forged',p=>p.scenarios[1].old_closed_before_release=!p.scenarios[1].old_closed_before_release],
 ['old phase response forged',p=>p.scenarios[0].old_response_sent=!p.scenarios[0].old_response_sent],
 ['old moment response forged',p=>p.scenarios[1].old_response_sent=!p.scenarios[1].old_response_sent],
 ['old summary continuation forged',p=>p.scenarios[0].old_summary_requests_after_release=8],
 ['moment summary continuation forged',p=>p.scenarios[1].old_summary_requests_after_release=8],
 ['cache before retry changed',p=>p.scenarios[0].old_cache_before_retry_completion='unknown'],
 ['moment cache before retry changed',p=>p.scenarios[1].old_cache_before_retry_completion='unknown'],
 ['replacement summary never sent',p=>p.scenarios[0].replacement_response_sent=false],
 ['replacement summary 2 never sent',p=>p.scenarios[1].replacement_response_sent=false],
 ['phase cached summary falsified',p=>p.scenarios[0].final_cached_summary='White won the game.'],
 ['moment cached summary falsified',p=>p.scenarios[1].final_cached_summary='White won the game.'],
 ['wrong cached language',p=>p.scenarios[0].cached_language='es'],
 ['wrong cached audience',p=>p.scenarios[1].cached_audience='expert'],
 ['old report unexpectedly visible',p=>p.scenarios[0].ui_shows_old=!p.scenarios[0].ui_shows_old],
 ['moment old report visibility flipped',p=>p.scenarios[1].ui_shows_old=!p.scenarios[1].ui_shows_old],
 ['new report visibility flipped',p=>p.scenarios[0].ui_shows_new=!p.scenarios[0].ui_shows_new],
 ['moment new report visibility flipped',p=>p.scenarios[1].ui_shows_new=!p.scenarios[1].ui_shows_new],
 ['wrong UI error',p=>p.scenarios[0].ui_error='different error'],
 ['wrong second UI error',p=>p.scenarios[1].ui_error='different error'],
 ['lost first stage model',p=>p.scenarios[0].calls.shift()],
 ['lost key moment model',p=>p.scenarios[1].calls.pop()],
 ['incorrect model stage',p=>p.scenarios[0].calls[0].stage='summary'],
 ['wrong model sequence',p=>p.scenarios[1].calls[1].sequence=88],
 ['model response still live',p=>p.scenarios[0].closed.pop()],
 ['moment model response still live',p=>p.scenarios[1].closed.pop()],
 ['provider error hidden',p=>p.scenarios[0].errors.push('LLM failure')],
 ['lost Chrome HTTP request',p=>p.scenarios[0].chrome_post_ids.pop()],
 ['reused Chrome HTTP request',p=>p.scenarios[1].chrome_post_ids[1]=p.scenarios[1].chrome_post_ids[0]],
 ['unreasonable benchmark wall time',p=>p.elapsed_ms=0],
];
let rejected=0;
for(const [kind,original] of [['clean',clean],['fault',fault]]){
 for(const [name,change] of corruptions){
  const forged=structuredClone(original);change(forged);
  assert.throws(()=>verifyEarlyStageCancellation(forged,kind),undefined,
   kind+': '+name+' unexpectedly certified green');
  rejected++;
 }
 const wrongFlags=structuredClone(original);
 wrongFlags.qa_verdict=kind==='clean'?'fail':'pass';
 assert.throws(()=>verifyEarlyStageCancellation(wrongFlags,kind));rejected++;
 const wrongPolicy=structuredClone(original);
 wrongPolicy.fault=kind==='clean'?'suppress-first-controller-abort':null;
 assert.throws(()=>verifyEarlyStageCancellation(wrongPolicy,kind));rejected++;
 const wrongError=structuredClone(original);
 wrongError.qa_error=kind==='clean'?'setup failed':null;
 assert.throws(()=>verifyEarlyStageCancellation(wrongError,kind));rejected++;
}
console.log(JSON.stringify({clean_packet_accepted:true,
 faulty_packet_accepted_only_as_negative:true,
 test_only_corruptions_rejected:rejected}));
