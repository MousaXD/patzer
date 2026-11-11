#!/usr/bin/env node
/**
 * Independent evidence compiler for Agent D's OWN fail-closed fixture gate.
 * Do not call a successful negative-control experiment a product certificate.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence');
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const manifest='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
const parentSha='389b9b5b2a539bb6be7f6e041786ba0bc953a99d';
const expected=[
 ['empty_holdout_must_fail',1,0,0,['empty_requested_split']],
 ['unknown_split_must_fail',1,0,0,['invalid_requested_split','empty_requested_split']],
 ['unvalued_split_must_fail',1,0,0,['invalid_requested_split','empty_requested_split']],
 ['development_cases_must_run',0,15,15,[]],
 ['stress_cases_must_run',0,10,10,[]],
 ['all_cases_must_run',0,25,25,[]],
 ['nested_output_inside_results_allowed',0,15,15,[]],
 ['fixture_symlink_outside_corpus_must_fail',1,1,0,['unsafe_fixture_path']],
 ['output_file_symlink_must_not_overwrite_canary',2,null,null,['unsafe_output_path']],
 ['output_parent_symlink_must_not_escape',2,null,null,['unsafe_output_path']],
 ['existing_output_hardlink_must_not_overwrite_source',0,15,15,[]],
];

export function verifySelectionReport(p){
 assert.equal(p.schema_version,1);
 assert.equal(p.benchmark_sha,parentSha,'not the frozen baseline QA checkout');
 assert.equal(p.fixture_manifest_sha256,manifest);
 assert.equal(sha(join(qa,'manifests/manifest-v2.jsonl')),manifest,'source fixture manifest changed');
 assert.equal(p.scope,'benchmark selection fail-closed and synthetic input/output symlink containment');
 assert.equal(p.user_data_used,false,'no private corpus was approved');
 assert.equal(p.holdout_curated,false,'holdout was not independently curated');
 assert.equal(p.release_certified,false);
 assert.equal(p.valid_positive_splits,4);
 assert.equal(p.adversarial_inputs_rejected,6);
 assert.equal(p.safe_existing_hardlink_replacement_verified,true);
 assert(Array.isArray(p.controls)&&p.controls.length===expected.length,
  'not every hostile or positive control ran');
 for(let i=0;i<expected.length;i++){
  const [name,exit,count,pass,reasons]=expected[i];
  const actual=p.controls[i];
  assert.equal(actual.name,name,'test order/identity changed');
  assert.equal(actual.expected_exit,exit,'negative-control expected status changed');
  assert.equal(actual.observed_exit,exit,'control returned the wrong status');
  assert.deepEqual(actual.error_reasons,reasons,'wrong failure reason');
  if(count!==null){
   assert.equal(actual.fixture_count,count,'did not really execute intended fixture cohort');
   assert.equal(actual.checks_passed,pass,'reported success inconsistent with executed cohort');
  }
 }
 return {positive_controls:5,negative_controls:6,
  zero_case_false_green_blocked:true,
  untrusted_fixture_symlink_blocked:true,
  output_symlink_escape_blocked:true,
  hardlink_destination_does_not_truncate_original:true,
  holdout_certified:false,release_approved:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const rawFile=join(qa,'results/selection-negative-controls.json');
 const raw=JSON.parse(readFileSync(rawFile,'utf8'));
 const checks=verifySelectionReport(raw);
 const report={schema_version:1,at_utc:new Date().toISOString(),
  prior_qa_branch_head:parentSha,
  checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  own_branch:'agent/review-benchmark-20261111',
  manifest_v2_sha256:manifest,
  source_sha256:{runner:sha(join(root,'scripts/review-benchmark.mjs')),
   hostile_controls:sha(join(root,'scripts/review-benchmark-selection-negative-controls.mjs')),
   compiler:sha(join(root,'scripts/review-benchmark-selection-proof.mjs'))},
  synthetic_only:true,source_result:raw,
  controlled_verdict:checks,
  known_remaining_gaps:['Not a sealed holdout or real-app scoring correctness gate',
   'Output and fixture containment tested with local synthetic paths, not a hostile concurrent filesystem actor',
   'Hard-link proof uses a disposable in-repo canary, not any live database',
   'Symlink test creation may require additional permissions on Windows',
   'The benchmark selection runner itself is not a Stockfish or real-model performance test'],
  release_approved:false,integration_approved:false};
 const path=join(qa,'certification-summary-checkpoint15.json');
 writeFileSync(path,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:path,...checks},null,2));
}
