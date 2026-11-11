#!/usr/bin/env node
// Attempt to make corrupted independent React test evidence appear valid.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkClientProfileEvidence} from './review-benchmark-client-profile-proof.mjs';
const root='qa/review-excellence';
const real=JSON.parse(readFileSync(root+'/certification-summary-checkpoint14.json','utf8')).evidence;
assert.equal(checkClientProfileEvidence(real).wrong_profile_metadata_accepted,true);
const faults=[
 ['fake product SHA',v=>v.candidate_sha='f'.repeat(40)],
 ['source tampered',v=>v.component_sha256='f'.repeat(64)],
 ['test suite drifted',v=>v.qa_test_sha256='f'.repeat(64)],
 ['wrong test config',v=>v.qa_config_sha256='f'.repeat(64)],
 ['missing case',v=>v.successful_cases.pop()],
 ['wrong case title',v=>v.successful_cases[0]='some unrelated passing test'],
 ['fake test coverage',v=>v.tests_passed=4],
 ['wrong locale setup',v=>v.locale_mode='real user profile in production'],
 ['hidden stale acceptance',v=>v.stale_profile_done_accepted_by_component=false],
 ['false benign behavior',v=>v.fresh_profile_done_accepted=false],
 ['malformed JSON accepted',v=>v.malformed_done_rejected=false],
 ['invented browser E2E',v=>v.has_real_browser_navigation_test=true],
 ['invented authentication',v=>v.has_real_authentication_test=true],
 ['fake product certification',v=>v.product_fully_certified=true],
 ['fake release',v=>v.release_approved=true],
 ['raw log drift',v=>v.raw_vitest_log_sha256='f'.repeat(64)],
];
for(const [name,mutate] of faults){
 const corrupted=structuredClone(real);mutate(corrupted);
 assert.throws(()=>checkClientProfileEvidence(corrupted),undefined,name+' escaped');
 console.log('REJECTED',name);
}
console.log(JSON.stringify({valid_packet_accepted:true,forged_evidence_rejected:faults.length}));
