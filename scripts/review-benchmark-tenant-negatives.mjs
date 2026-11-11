#!/usr/bin/env node
// Adversarial, test-only mutations of real two-user SSE and cache evidence.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateTenantConcurrencyEvidence} from './review-benchmark-tenant-proof.mjs';
const raw=JSON.parse(readFileSync('qa/review-excellence/results/review-tenant-concurrency.json','utf8'));
assert.equal(validateTenantConcurrencyEvidence(raw).cross_tenant_access_denied,true);
const attacks=[
 ['wrong candidate SHA',x=>x.candidate_sha='f'.repeat(40)],
 ['wrong Stockfish binary',x=>x.engine_sha256='f'.repeat(64)],
 ['tampered synthetic manifest',x=>x.manifest_sha256='f'.repeat(64)],
 ['invented release certification',x=>x.release_approved=true],
 ['invented security certification',x=>x.overall_product_security_certified=true],
 ['no unauthenticated rejection',x=>x.observation.actual_access_status.unauthenticated_post=200],
 ['GET crossed tenant boundary',x=>x.observation.actual_access_status.en_cross_user_get=200],
 ['POST crossed tenant boundary',x=>x.observation.actual_access_status.es_cross_user_post=200],
 ['SSE lacked completion',x=>x.observation.real_sse.es=x.observation.real_sse.es.replace('event: done','event: error')],
 ['swapped SSE users',x=>[x.observation.real_sse.en,x.observation.real_sse.es]=[x.observation.real_sse.es,x.observation.real_sse.en]],
 ['wrong winner from English prompt',x=>x.observation.model_prompts[5].result='you won'],
 ['wrong winner from Spanish prompt',x=>x.observation.model_prompts[3].result='perdiste'],
 ['wrong perspective in prompt',x=>x.observation.model_prompts[4].mover='the opponent'],
 ['wrong chess-side accuracy',x=>x.observation.model_prompts[3].accuracy=x.observation.white_accuracy],
 ['wrong black-owned moment',x=>x.observation.cached.es.by_user=true],
 ['cross-user summary cached',x=>x.observation.cached.en.summary='Las negras ganaron la partida.'],
 ['cross-user authenticated GET',x=>x.observation.readback.es.summary='Black won the game.'],
 ['reversed completion order unproven',x=>x.observation.provider_reply_order.reverse()],
 ['not all real model calls',x=>x.observation.calls=5],
 ['missing model provider closure',x=>x.observation.provider_responses_closed=5],
 ['unexpected provider error hidden',x=>x.observation.provider_errors=['provider failure']],
 ['lost a captured prompt',x=>x.observation.model_prompts.pop()],
 ['test claims both started uncached falsely',x=>x.observation.both_started_uncached=false],
];
for(const [name,alter] of attacks){
 const bad=structuredClone(raw);alter(bad);
 assert.throws(()=>validateTenantConcurrencyEvidence(bad),undefined,name+' escaped');
 console.log('REJECTED',name);
}
console.log(JSON.stringify({valid_packet_accepted:true,deliberately_corrupted_packets_rejected:attacks.length}));
