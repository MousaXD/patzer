#!/usr/bin/env node
// Hostile test-only mutations to the independent race evidence packet.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyFinalSummaryRaces} from './review-benchmark-final-summary-proof.mjs';

const data=JSON.parse(readFileSync('qa/review-excellence/results/review-final-summary-races.json','utf8'));
assert.equal(verifyFinalSummaryRaces(data).in_flight_profile_language_cache_defect_proven,true);
const attacks=[
 ['wrong source SHA',x=>x.candidate_sha='0'.repeat(40)],
 ['wrong binary',x=>x.engine_sha256='0'.repeat(64)],
 ['wrong manifest',x=>x.manifest_sha256='0'.repeat(64)],
 ['faked good product verdict',x=>x.product_certified=true],
 ['loss of analysis change',x=>x.outcomes.reanalysis.new_accuracy=x.outcomes.reanalysis.original_accuracy],
 ['reanalyzed report improperly completed',x=>x.outcomes.reanalysis.stale_done=true],
 ['reanalyzed report stored',x=>x.outcomes.reanalysis.cache_null=false],
 ['wrong source SSE event',x=>x.outcomes.raw_sse.source=x.outcomes.raw_sse.source.replace('event: error','event: done')],
 ['missing source error detail',x=>x.outcomes.raw_sse.source=x.outcomes.raw_sse.source.replace('review_source_changed','generic_error')],
 ['incorrect profile language label',x=>x.outcomes.profile_change.cached_prose_language='es'],
 ['profile stale cache not reproduced',x=>x.outcomes.profile_change.stale_get=false],
 ['profile queued for auto regeneration',x=>x.outcomes.profile_change.auto_review_queued=1],
 ['wrong language in completed stream',x=>x.outcomes.raw_sse.profile=x.outcomes.raw_sse.profile.replaceAll('"language":"en"','"language":"es"')],
 ['profile stream not completed',x=>x.outcomes.raw_sse.profile=x.outcomes.raw_sse.profile.replace('event: done','event: error')],
 ['canceled SSE pretended done',x=>x.outcomes.raw_sse.cancel+='event: done\n\n'],
 ['aborted cached report',x=>x.outcomes.cancel_last_model.cache_null=false],
 ['missing response body',x=>x.outcomes.cancel_last_model.observed_stream_bytes=0],
 ['missing model calls',x=>x.outcomes.total_model_calls=8],
 ['missing final summary stage',x=>x.outcomes.stage_counts.cancel_summary=2],
 ['mock response leak',x=>x.outcomes.raw_provider_response_closures=8],
 ['false release claim',x=>x.release_approved=true]
];
for(const [label,mutate] of attacks){
 const corrupted=structuredClone(data);mutate(corrupted);
 assert.throws(()=>verifyFinalSummaryRaces(corrupted),undefined,'escaped test-only corruption '+label);
 console.log('REJECTED',label);
}
console.log(JSON.stringify({valid_evidence_accepted:1,deliberately_broken_packets_rejected:attacks.length}));
