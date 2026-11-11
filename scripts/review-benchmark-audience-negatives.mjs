#!/usr/bin/env node
// Deliberately forge evidence so independent QA must reject false greens.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyAudienceEvidence} from './review-benchmark-audience-proof.mjs';
const original=JSON.parse(readFileSync('qa/review-excellence/results/review-audience-race.json','utf8'));
assert.equal(verifyAudienceEvidence(original).audience_profile_race_exposed,true);
const faults=[
 ['wrong candidate SHA',v=>{v.candidate_sha='f'.repeat(40);}],
 ['wrong engine SHA',v=>{v.engine_sha256='f'.repeat(64);}],
 ['different fixture',v=>{v.fixture_id='SYN-GAME-FORCED-REPLY';}],
 ['fake certification',v=>{v.product_certified=true;}],
 ['fake release',v=>{v.release_approved=true;}],
 ['no model work',v=>{v.data.requests=8;}],
 ['provider connection leak',v=>{v.data.closed_provider_responses=8;}],
 ['source workflow was not stalled',v=>{v.data.request_stages[3].mode='instant';}],
 ['wrong model stage sequence',v=>{v.data.request_stages[5].stage='phase';}],
 ['control never cached',v=>{v.data.same_audience.cached_audience='';}],
 ['control falsely deemed stale',v=>{v.data.same_audience.was_not_marked_stale=false;}],
 ['control SSE did not finish',v=>{v.data.same_audience.sse=v.data.same_audience.sse.replace('event: done','event: error');}],
 ['old audience actually replaced',v=>{v.data.audience_changed.cached_audience='advanced';}],
 ['stale GET did not detect bad cache',v=>{v.data.audience_changed.got_stale_result=false;}],
 ['auto review would retry',v=>{v.data.audience_changed.auto_pending=1;}],
 ['missing old-audience SSE',v=>{v.data.audience_changed.sse=v.data.audience_changed.sse.replaceAll('"audience":"beginner"','"audience":"advanced"');}],
 ['stale generation errored instead of completing',v=>{v.data.audience_changed.sse=v.data.audience_changed.sse.replace('event: done','event: error');}],
 ['manual recovery did not cache new content',v=>{v.data.manual_recovery.cached_audience='beginner';}],
 ['manual recovery did not display advanced',v=>{v.data.manual_recovery.get_delivered_advanced=false;}],
 ['manual recovery SSE wrong audience',v=>{v.data.manual_recovery.sse=v.data.manual_recovery.sse.replaceAll('"audience":"advanced"','"audience":"beginner"');}],
];
for(const [name,mutate] of faults){
 const bad=structuredClone(original);mutate(bad);
 assert.throws(()=>verifyAudienceEvidence(bad),undefined,name+' escaped');
 console.log('REJECTED',name);
}
console.log(JSON.stringify({valid_packet_accepted:true,forged_packets_rejected:faults.length}));
