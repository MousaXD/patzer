#!/usr/bin/env node
// Checkpoint 5: independently verify that every reported mutation was really
// exercised on an applicable game, or rejected as a coverage gap.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root=resolve(import.meta.dirname,'..'), qa=join(root,'qa/review-excellence');
const resultDir=join(qa,'results');
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const cases=['default','special','mates','forced','extra','illegal','main'];
const results=Object.fromEntries(cases.map(n=>[n,JSON.parse(readFileSync(join(resultDir,'gated7-'+n+'.log'),'utf8'))]));
const app=n=>JSON.parse(readFileSync(results[n].report.replace('gate-result.json','app-result.json'),'utf8'));
const manifestHash=sha(join(qa,'manifests/manifest-v2.jsonl'));
const engineHash='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const agentSha='7178e2624fb9a9a35bd84bc2dcb796a46e0f1c1e';
const baselineSha='51df1d852296e5f0644127a81b5ec31109c8e6c1';
for(const [name,r] of Object.entries(results)) {
 assert.equal(r.manifest_sha256,manifestHash,name+' manifest drift');
 assert.equal(r.pinned_engine_sha256,engineHash,name+' engine drift');
 assert.equal(r.requested_candidate_sha,name==='main'?baselineSha:agentSha,name+' candidate drift');
 assert.equal(r.candidate_sha,name==='main'?baselineSha:agentSha,name+' output source drift');
 assert.equal(r.release_approved,false);
 assert.equal(r.application.score_version,9);
 assert.equal(r.reference_kind,'benchmark-owned UCI protocol client with separate process');
}
for(const name of ['default','special','mates']) {
 const r=results[name];
 assert.equal(r.scope_passed,true,name+' should be clean');
 assert.equal(r.application.errors,0);
 assert.equal(r.application.unverified_controls,0,name+' was not fully challenged');
 assert.equal(r.application.negative_controls,r.application.rejected_controls);
 assert(r.application.negative_controls>=10);
 assert.equal(r.raw_uci.errors,0);
 assert(r.raw_uci.metrics.pv_lines>0);
 assert.equal(r.raw_uci.metrics.pv_lines,r.raw_uci.metrics.legal_pv_lines);
 assert.equal(r.expected_analysis_searches,r.observed_analysis_searches);
}
const mutation=(name,type)=>app(name).negative_controls.find(x=>x.name===type);
for(const name of ['default','special','mates']) {
 const m=mutation(name,'best_move_marked_mistake');
 assert.equal(m?.rejected,true,name+' failed to reject a best-move misclassification');
 assert(m.reason.includes('played_best_move_labeled_error'));
}
assert.equal(mutation('special','best_move_marked_mistake').fixture_id,'SYN-GAME-UNDERPROMOTION',
 'special cohort did not advance to second suitable fixture');
assert.equal(results.forced.scope_passed,false);
assert.equal(results.forced.application.errors,0,'forced game itself should not be defective');
assert.equal(results.forced.raw_uci.errors,0);
assert.equal(results.forced.application.unverified_controls,3);
assert(results.forced.failures.some(x=>x.reason==='unverified_boundary_negative_control'));
for(const name of ['extra','illegal','main'])assert.equal(results[name].scope_passed,false);
assert(results.extra.failures.some(x=>x.reason==='raw_uci_fixture_positions_mismatch'));
assert.equal(results.extra.raw_uci.errors,0,'legal extra search must fool standalone legality');
assert(results.illegal.failures.some(x=>x.reason==='raw_uci_evidence_failed'));
assert(results.illegal.raw_uci.errors>0);
assert.equal(results.main.application.errors,2);
assert.equal(results.main.raw_uci.errors,0);
assert.deepEqual(app('main').failures.map(x=>x.reason).sort(),[
 'performance_without_eligible_moves_black','rating_without_eligible_moves_black'].sort());

const report={schema_version:1,at_utc:new Date().toISOString(),
 parent_checkpoint_commit:'bb10992feb14d8105b9d443f81b2979f6342dee0',
 benchmark_current_commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 fixture_manifest_sha256:manifestHash,source_kind:'self-authored synthetic',holdout_count:0,
 pinned_engine_sha256:engineHash,engine:'Stockfish 16',depth:8,threads:1,hash_mib:16,multipv:3,
 baseline_sha:baselineSha,agent_a_sha:agentSha,
 source_hashes:Object.fromEntries([
 'scripts/review-benchmark-app-adapter.mjs','scripts/review-benchmark-real-app.mjs',
 'scripts/review-benchmark-gated-smoke.mjs'
 ].map(p=>[p,sha(join(root,p))])),
 findings:{
  original_false_green:'best UCI move g7g6 relabeled mistake, previously accepted',
  best_move_label_mutant_detected_in_three_cohorts:true,
  mutation_scheduling_uses_first_applicable_game_across_cohort:true,
  forced_only_cohort_unverified_and_rejected:3,
  main_has_verified_no_evidence_elo_defect:true,
  raw_uci_controls_still_reject_bad_evidence:true
 },
 gated_results:Object.fromEntries(Object.entries(results).map(([name,r])=>[name,{
  candidate_sha:r.candidate_sha,scope_passed:r.scope_passed,checked_games:r.tested_fixtures,
  application_controls_rejected:r.application.rejected_controls,
  application_unverified:r.application.unverified_controls,app_failures:r.application.errors,
  raw_pvs:r.raw_uci.metrics?.pv_lines??null,raw_failures:r.raw_uci.errors,
  failure_reasons:r.failures.map(x=>x.reason)
 }])),
 integration_approved:false,release_approved:false,
 remaining_gaps:['No sealed holdout','No independently rated model accuracy improvement',
  'No live coach natural language factuality evidence','No real browser learning/accessibility tasks',
  'No authenticated service or multi-user load certification','Stockfish 16 only']};
const destination=join(qa,'certification-summary-checkpoint5.json');
writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({destination,candidate:agentSha,positive_cohorts:3,
 negatives_rejected:2,incomplete_cohort_correctly_blocked:true,
 adapter_sha256:report.source_hashes['scripts/review-benchmark-app-adapter.mjs']},null,2));
