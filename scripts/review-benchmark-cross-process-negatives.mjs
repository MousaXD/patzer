#!/usr/bin/env node
/** Test-only forged evidence cannot produce false cross-process green. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {certifyCrossProcessEvidence} from './review-benchmark-cross-process-proof.mjs';
const actual=JSON.parse(readFileSync('qa/review-excellence/results/review-crossprocess-logout.json','utf8'));
assert.equal(certifyCrossProcessEvidence(actual).shared_sqlite_logout_rejects_future_admissions,true);
const mutants=[
 ['candidate drift',p=>p.candidate_sha='f'.repeat(40)],
 ['engine drift',p=>p.engine_sha256='f'.repeat(64)],
 ['fixture manifest drift',p=>p.manifest_sha256='f'.repeat(64)],
 ['fake release approval',p=>p.release_approved=true],
 ['fake full security coverage',p=>p.overall_authentication_certified=true],
 ['QA bypass switch hidden',p=>p.qa_test_only_http_fault='grant-revoked'],
 ['stale raw packet missing run ID',p=>p.benchmark_run_id=null],
 ['not different process',p=>p.observations.worker_pids[1]=p.observations.worker_pids[0]],
 ['not different HTTP sockets',p=>p.observations.worker_ports[1]=p.observations.worker_ports[0]],
 ['no initial authentication',p=>p.observations.pre_logout_get[0]=401],
 ['pre-admitted request not opened',p=>p.observations.pre_admitted_post_status=401],
 ['model not actually pending',p=>p.observations.model_final_held_at_logout=false],
 ['cache already present before logout',p=>p.observations.cache_null_when_logout_started=false],
 ['logout never succeeded',p=>p.observations.logout_status=500],
 ['logout cookie not expired',p=>p.observations.cookie_expired=false],
 ['SQLite session not deleted',p=>p.observations.session_rows_after_logout=1],
 ['old GET allowed on worker A',p=>p.observations.old_cookie_statuses[0]=200],
 ['old POST allowed on worker A',p=>p.observations.old_cookie_statuses[1]=200],
 ['old GET allowed on worker B',p=>p.observations.old_cookie_statuses[2]=200],
 ['old POST allowed on worker B',p=>p.observations.old_cookie_statuses[3]=200],
 ['tampered cookie signature accepted',p=>p.observations.tampered_cookie_statuses[1]=200],
 ['old in-flight SSE completed with error',p=>p.observations.pre_admitted_sse=p.observations.pre_admitted_sse.replace('event: done','event: error')],
 ['different review language in real SSE',p=>p.observations.pre_admitted_sse=p.observations.pre_admitted_sse.replace('"language":"en"','"language":"es"')],
 ['wrong actual winner',p=>p.observations.pre_admitted_sse=p.observations.pre_admitted_sse.replace('Black won the game.','White won the game.')],
 ['wrong by-user chess ownership',p=>p.observations.pre_admitted_sse=p.observations.pre_admitted_sse.replace('"by_user":true','"by_user":false')],
 ['cache not persisted',p=>p.observations.cache_written_after_logout=false],
 ['fresh session only works in one process',p=>p.observations.fresh_cookie_statuses[1]=401],
 ['different cached text across processes',p=>p.observations.new_cookie_summaries[0]='White won the game.'],
 ['LLM call dropped',p=>p.observations.model_calls=2],
 ['model response never closed',p=>p.observations.provider_closed=2],
 ['incomplete stage sequence',p=>p.observations.model_stages.pop()],
 ['model provider error hidden',p=>p.observations.model_errors=['unexpected provider error']],
 ['fake cancellation policy',p=>p.in_flight_cancel_policy='must_abort'],
 ['false timing evidence',p=>p.elapsed_ms=0],
];
for(const [name,mutate] of mutants){
 const forged=structuredClone(actual);mutate(forged);
 assert.throws(()=>certifyCrossProcessEvidence(forged),undefined,name+' escaped');
 console.log('REJECTED',name);
}
console.log(JSON.stringify({genuine_packet_accepted:true,
 forged_evidence_rejected:mutants.length}));
