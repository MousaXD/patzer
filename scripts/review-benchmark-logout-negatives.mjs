#!/usr/bin/env node
// Deliberately forged test-only authorization/cancellation evidence.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyLogoutInFlight} from './review-benchmark-logout-proof.mjs';
const clean=JSON.parse(readFileSync('qa/review-excellence/results/review-logout-inflight.json','utf8'));
assert.equal(verifyLogoutInFlight(clean).revoked_cookie_rejected_for_new_requests,true);
const attacks=[
 ['candidate identity',r=>r.candidate_sha='f'.repeat(40)],
 ['Stockfish identity',r=>r.engine_sha256='f'.repeat(64)],
 ['manifest identity',r=>r.manifest_sha256='f'.repeat(64)],
 ['fake release approval',r=>r.release_approved=true],
 ['no original session',r=>r.observations.session_rows_before_logout=0],
 ['no admitted review',r=>r.observations.admitted_review_http_status=401],
 ['no pending final-model response',r=>r.observations.final_model_response_held_at_logout=false],
 ['review already cached before logout',r=>r.observations.cache_was_null_at_logout=false],
 ['fake full security certification',r=>r.full_security_certified=true],
 ['fabricated strict cancellation policy',r=>r.logout_should_cancel_existing_stream_policy='must_abort'],
 ['logout handler returned server error',r=>r.observations.real_logout_status=500],
 ['cookie not cleared',r=>r.observations.logout_cookie_cleared=false],
 ['session remained live',r=>r.observations.session_rows_after_logout=1],
 ['old GET cookie still allowed',r=>r.observations.revoked_get_status=200],
 ['old POST cookie still allowed',r=>r.observations.revoked_post_status=200],
 ['fake SSE done',r=>r.observations.existing_request_sse=r.observations.existing_request_sse.replace('event: done','event: error')],
 ['wrong old review language',r=>r.observations.existing_request_sse=r.observations.existing_request_sse.replace('"language":"en"','"language":"es"')],
 ['missing cache after logout',r=>r.observations.cached_after_logout=false],
 ['new session reused old rejected cookie',r=>r.observations.new_session_get_status=401],
 ['different new-session cached summary',r=>r.observations.new_session_cached_summary='White won the game.'],
 ['missing model response',r=>r.observations.model_responses_closed=2],
 ['wrong model stage',r=>r.observations.model_stages[2]='moment'],
 ['falsified preadmitted stream outcome',r=>r.pre_admitted_stream_continued=false],
 ['falsified new request denial',r=>r.all_new_requests_denied=false],
];
for(const [name,mutate] of attacks){
 const forged=structuredClone(clean);mutate(forged);
 assert.throws(()=>verifyLogoutInFlight(forged),undefined,name+' escaped');
 console.log('REJECTED',name);
}
console.log(JSON.stringify({valid_packet_accepted:true,forged_packets_rejected:attacks.length}));
