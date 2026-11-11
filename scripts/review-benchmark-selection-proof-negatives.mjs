#!/usr/bin/env node
// Test-only mutations: can a forged packet make our QA selection gate green?
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifySelectionReport} from './review-benchmark-selection-proof.mjs';

const valid=JSON.parse(readFileSync('qa/review-excellence/results/selection-negative-controls.json','utf8'));
assert.equal(verifySelectionReport(valid).zero_case_false_green_blocked,true);
const corruptions=[
 ['invented baseline',p=>p.benchmark_sha='f'.repeat(40)],
 ['wrong fixture manifest',p=>p.fixture_manifest_sha256='f'.repeat(64)],
 ['private corpus claimed',p=>p.user_data_used=true],
 ['fake holdout approval',p=>p.holdout_curated=true],
 ['fake release success',p=>p.release_certified=true],
 ['missing fixture control',p=>p.controls.pop()],
 ['empty holdout given green status',p=>p.controls[0].observed_exit=0],
 ['empty holdout counts invented',p=>p.controls[0].fixture_count=1],
 ['empty holdout incorrectly passed',p=>p.controls[0].checks_passed=1],
 ['unrecognized split falsely green',p=>p.controls[1].observed_exit=0],
 ['unvalued flag error concealed',p=>p.controls[2].error_reasons=[]],
 ['development tests did not run',p=>p.controls[3].fixture_count=0],
 ['stress tests skipped',p=>p.controls[4].checks_passed=0],
 ['all fixtures count changed',p=>p.controls[5].fixture_count=24],
 ['nested output failed',p=>p.controls[6].observed_exit=2],
 ['fixture symlink accepted',p=>p.controls[7].observed_exit=0],
 ['wrong fixture symlink error',p=>p.controls[7].error_reasons=['illegal_pv']],
 ['output symlink permitted',p=>p.controls[8].observed_exit=0],
 ['unsafe output parent concealed',p=>p.controls[9].error_reasons=[]],
 ['hardlink destroyed canary',p=>p.safe_existing_hardlink_replacement_verified=false],
 ['hardlink control lost',p=>p.controls[10].observed_exit=2],
 ['fake positive count',p=>p.valid_positive_splits=5],
 ['fake rejected count',p=>p.adversarial_inputs_rejected=7],
];
for(const [name,mutate] of corruptions){
 const forged=structuredClone(valid);mutate(forged);
 assert.throws(()=>verifySelectionReport(forged),undefined,name+' escaped');
 console.log('REJECTED',name);
}
console.log(JSON.stringify({valid_packet_accepted:true,forged_evidence_rejected:corruptions.length}));
