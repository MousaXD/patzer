#!/usr/bin/env node
/** Run production Hono analysis/review routes in two fresh disposable Node
 * processes, each with bounded Stockfish. A corrected-analysis QA counter-
 * factual must FAIL the source-mismatch reproduction. Bind stdout and raw
 * JSON to fresh UUIDs and replay independently before any green checkpoint. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {verifyAdmissionSourceEvidence} from './review-benchmark-coach-admission-proof.mjs';

const root=resolve(import.meta.dirname,'..'),results=join(root,'qa/review-excellence/results');
const checks=[];
for(const kind of ['clean','fault']){
 const runId=randomUUID();
 const argv=['--import','tsx','scripts/review-benchmark-coach-admission-source.mjs','--run-id='+runId];
 if(kind==='fault')argv.push('--fault=correct-source-analysis-before-review');
 const child=spawnSync(process.execPath,argv,{cwd:root,encoding:'utf8',
  timeout:35000,maxBuffer:3*1024*1024});
 assert.ifError(child.error);
 assert.equal(child.status,kind==='clean'?0:1,
  'fresh real Hono route source admission test exited incorrectly: '+child.stderr.slice(-1000));
 let stdout;
 try{stdout=JSON.parse(child.stdout);}catch{
  throw Error('fresh Hono test output is not JSON: '+child.stdout.slice(-450));
 }
 const packet=JSON.parse(readFileSync(join(results,
  kind==='clean'?'coach-admission-source.json':'coach-admission-source-fault.json'),'utf8'));
 assert.equal(stdout.run_id,runId,'stdout belongs to a stale source analysis');
 assert.equal(packet.run_id,runId,'raw SQLite/Hono evidence belongs to a stale run');
 assert.equal(stdout.qa_status,kind==='clean'?'pass':'fail');
 assert.equal(packet.qa_status,stdout.qa_status);
 assert.equal(stdout.errors,packet.qa_error);
 assert.equal(stdout.product_release_approved,false);
 const verdict=verifyAdmissionSourceEvidence(packet,{kind});
 assert.equal(stdout.old_analysis_cache_hit,true);
 assert.equal(stdout.old_analysis_plies,4);
 if(kind==='clean'){
  assert.equal(stdout.new_report_plies,4);
  assert.equal(stdout.stale_old_moment_in_new_report,true);
  assert.equal(stdout.cas_accepted_new_report,true);
  assert.equal(verdict.fresh_report_moments_proven_from_wrong_PGN,true);
 }else{
  assert.equal(stdout.new_report_plies,7);
  assert.equal(stdout.stale_old_moment_in_new_report,false);
  assert.equal(verdict.corrected_analysis_before_admission_prevents_source_mix,true);
 }
 checks.push({kind,run_id:runId,subprocess_exit:child.status,
  old_analysis_hit_before_counterfactual:true,
  mismatched_old_report_admitted:kind==='clean',
  positive_source_correction_proven:kind==='fault',
  proof:verdict});
}
assert.notEqual(checks[0].run_id,checks[1].run_id);
console.log(JSON.stringify({fresh_real_Hono_SSE_subprocesses:2,
  independent_source_evidence_verified:true,
  synthetic_depth8_stockfish_searches_total:4,
  hosted_model_requests:0,
  observed_defect:checks[0],
  expected_failure_counterfactual:checks[1],
  product_release_approved:false},null,2));
