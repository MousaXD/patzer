#!/usr/bin/env node
/** Two independent bounded real-Chrome/Vite/Hono/SQLite subprocesses:
 * 1. An obsolete model response after a same-game source mutation must be
 * rejected by real backend CAS but the browser must fail to cancel it.
 * 2. QA-only actual Cancel click must close the model and FAIL the "no
 * cancellation" benchmark. UUIDs bind stdout and raw source evidence. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {verifyBrowserInflightSource} from './review-benchmark-browser-inflight-proof.mjs';

const root=resolve(import.meta.dirname,'..'),results=join(root,'qa/review-excellence/results');
const cases=[];
for(const kind of ['clean','fault']){
 const runId=randomUUID();
 const args=['--import','tsx','scripts/review-benchmark-browser-inflight-source.mjs','--run-id='+runId];
 if(kind==='fault')args.push('--fault=abort-after-source-change');
 const child=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',
  timeout:40000,maxBuffer:2*1024*1024});
 assert.ifError(child.error);
 assert.equal(child.status,kind==='clean'?0:1,
  'fresh Chrome benchmark exited unexpectedly: '+child.stderr.slice(-1300));
 let stdout;
 try{stdout=JSON.parse(child.stdout);}catch{
  throw Error('real Chrome runner stdout could not be parsed: '+child.stdout.slice(-600));
 }
 const packet=JSON.parse(readFileSync(join(results,
  kind==='clean'?'browser-inflight-source.json':'browser-inflight-source-fault.json'),'utf8'));
 assert.equal(stdout.run_id,runId,'stdout was substituted with an old run');
 assert.equal(packet.run_id,runId,'raw local SQLite/Chrome evidence reused a prior run');
 assert.equal(stdout.qa_status,kind==='clean'?'pass':'fail');
 assert.equal(packet.qa_status,stdout.qa_status);
 assert.equal(stdout.qa_error,packet.qa_error);
 assert.equal(stdout.product_release_approved,false);
 const proof=verifyBrowserInflightSource(packet,{kind});
 assert.equal(packet.observations.after_change.old_model_response_still_open,true);
 assert.equal(stdout.after_refetch.new_engine_moves,7);
 if(kind==='clean'){
  assert.equal(stdout.provider_call_count,6);
  assert.equal(stdout.after_release.backend_cached_prose_null,true);
  assert.equal(stdout.after_release.ui.error,'review_source_changed');
  assert.equal(proof.backend_atomic_source_guard_rejected_old_write,true);
 }else{
  assert.equal(stdout.after_release,null);
  assert.equal(packet.observations.fault_cancel_exercised,true);
  assert.equal(proof.manual_cancel_closed_obsolete_model_connection,true);
 }
 cases.push({kind,run_id:runId,subprocess_exit:child.status,
  old_model_open_after_game_source_change:true,
  retained_old_model_after_source_change:kind==='clean',
  backend_stale_report_written:false,
  independent_proof:proof});
}
assert.notEqual(cases[0].run_id,cases[1].run_id);
console.log(JSON.stringify({
 fresh_real_chrome_scenarios:2,
 bounded_depth8_stockfish_searches_total:4,
 external_llm_calls:0,
 clean_case:cases[0],deliberate_abort_negative:cases[1],
 negative_control_exited_failure_as_required:true,
 product_release_approved:false,
},null,2));
