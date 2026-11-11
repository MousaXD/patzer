#!/usr/bin/env node
// Try to falsely certify corrupted app/benchmark evidence.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {certifyLimitedConcurrencyEvidence} from './review-benchmark-concurrent-proof.mjs';

const original=JSON.parse(readFileSync('qa/review-excellence/results/review-concurrent-real-route.json','utf8'));
assert.equal(certifyLimitedConcurrencyEvidence(original).stale_write_blocked,true);
const mutations=[
 ['wrong source',r=>r.candidate_sha='f'.repeat(40)],
 ['wrong engine',r=>r.engine_sha256='a'.repeat(64)],
 ['wrong fixture',r=>r.fixture_id='SYN-GAME-UNDERPROMOTION'],
 ['premature B source write missing',r=>r.observation.b_saved=false],
 ['A overwritten B',r=>r.observation.final_b_remains=false],
 ['A falsely announced completion',r=>r.observation.a_done=true],
 ['A error missing',r=>r.observation.a_stale_error=false],
 ['authenticated read failed',r=>r.observation.read_b_verbatim=false],
 ['missing cross-user denial',r=>r.observation.cross_user_post_denied=false],
 ['incomplete synthetic model request',r=>r.observation.provider_calls=5],
 ['missing stage A',r=>r.observation.provider_reply_stages.A.pop()],
 ['missing stage B',r=>r.observation.provider_reply_stages.B.pop()],
 ['reverse order not proven',r=>r.observation.release_order.reverse()],
 ['mock HTTP socket leak',r=>r.observation.provider_responses_closed=5],
 ['provider failure hidden',r=>r.observation.provider_errors=['mock-http-failed']],
 ['pretend deduplication',r=>r.concurrent_coalescing_observed=true],
 ['incorrect saved winner',r=>r.observation.final_summary=r.observation.a_summary],
 ['fake release approval',r=>r.release_approved=true]
];
for(const [label,alter] of mutations){
 const forged=structuredClone(original);alter(forged);
 assert.throws(()=>certifyLimitedConcurrencyEvidence(forged),undefined,label+' escaped');
 console.log('REJECTED',label);
}
console.log(JSON.stringify({clean_accepted:1,forged_evidence_rejected:mutations.length}));
