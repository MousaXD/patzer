#!/usr/bin/env node
/** Hostile negative inputs for Agent D's independent cancellation proof. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateCancelReport} from './review-benchmark-coach-cancellation-proof.mjs';

const good=JSON.parse(readFileSync('qa/review-excellence/results/coach-cancellation-real-route.json','utf8'));
assert.deepEqual(validateCancelReport(good),{
 real_aborted_post_not_cached:true,real_successful_post_cached:true,
 source_provenance_valid:true,model_requests:4,comprehensive_release_certification:false
});
const attacks=[
 ['wrong agent SHA',r=>r.candidate_sha='f'.repeat(40)],
 ['unapproved binary',r=>r.engine_sha256='0'.repeat(64)],
 ['manifest digest tampered',r=>r.manifest_sha256='0'.repeat(64)],
 ['abort never closed',r=>r.results.aborted_sse_closed=false],
 ['aborted report persisted',r=>r.results.aborted_request_cache_absent=false],
 ['completion emitted after abort',r=>r.results.aborted_sse_emitted_done=true],
 ['no real SSE evidence',r=>r.results.aborted_sse_body_bytes=0],
 ['provider replied before abort',r=>r.results.aborted_before_any_model_reply=false],
 ['normal request failed',r=>r.results.success_sse_has_done=false],
 ['normal report not persisted',r=>r.results.success_cache_written=false],
 ['authenticated GET failed',r=>r.results.success_read_shows_written_review=false],
 ['unexpected model work',r=>r.results.provider_total_posts=6],
 ['request leak concealed',r=>r.localhost_provider_responses_closed=1],
 ['false full certification',r=>r.product_cancellation_fully_certified=true]
];
for(const [name,mutate] of attacks){
 const bad=structuredClone(good);mutate(bad);
 assert.throws(()=>validateCancelReport(bad),undefined,name+' escaped');
 console.log('REJECTED',name);
}
console.log(JSON.stringify({clean_positive_accepted:1,test_only_corruptions_rejected:attacks.length}));
