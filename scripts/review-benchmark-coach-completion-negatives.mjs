#!/usr/bin/env node
/** Test-only corruptions that must be rejected by the *QA evidence compiler*. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCompletionEvidence } from './review-benchmark-coach-completion-proof.mjs';

const original=JSON.parse(readFileSync('qa/review-excellence/results/coach-completion-real-pipeline.json','utf8'));
assert.deepEqual(validateCompletionEvidence(original),{
 completed_positive_accepted:1,unsafe_terminations_accepted:2,real_model_calls:9,
 candidate_completion_certified:false
});
const cases=[
 ['wrong candidate source',x=>{x.candidate_sha='a'.repeat(40);}],
 ['wrong engine executable',x=>{x.engine_sha256='a'.repeat(64);}],
 ['changed fixture manifest',x=>{x.manifest_sha256='a'.repeat(64);}],
 ['false good product verdict',x=>{x.product_completion_certified=true;}],
 ['omitted provider request',x=>{x.total_requests=8;}],
 ['changed termination flag',x=>{x.cases[1].provider_finish_reason='stop';}],
 ['length output not seen',x=>{x.cases[1].ai_summary_survived=false;}],
 ['filtered output not seen',x=>{x.cases[2].ai_moment_survived=false;}],
 ['mismatched injected text',x=>{x.cases[2].produced_summary='The game is unknown.';}],
 ['missing key moment request',x=>{x.cases[0].prompt_count=2;}],
 ['invented release approval',x=>{x.release_approved=true;}]
];
for(const [label,mutate] of cases){
 const changed=structuredClone(original);
 mutate(changed);
 assert.throws(()=>validateCompletionEvidence(changed),undefined,label+' failed to invalidate source');
 console.log('REJECTED',label);
}
console.log(JSON.stringify({valid_positive_packet_accepted:true,bad_evidence_packets_rejected:cases.length}));
