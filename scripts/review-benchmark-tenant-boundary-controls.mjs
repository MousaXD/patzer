#!/usr/bin/env node
/**
 * Challenge the REAL application-to-benchmark boundary, not only the report.
 * The mock model deliberately sends the other synthetic user's text, while
 * authenticated routes, chess facts, profiles and source files stay intact.
 * The model may complete, but the independent benchmark MUST refuse green.
 */
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {validateTenantConcurrencyEvidence} from './review-benchmark-tenant-proof.mjs';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const results=join(qa,'results');
const parsed=Object.fromEntries(process.argv.slice(2).map(arg=>{
 const i=arg.indexOf('=');return i<0?[arg.slice(2),true]:[arg.slice(2,i),arg.slice(i+1)];
}));
const app=realpathSync(parsed['app-root']||join(results,'worktree-coach'));
assert(app.startsWith(join(results,'worktree-')));
const engine=realpathSync(parsed.engine||join(results,'engine/unpacked/usr/games/stockfish'));
const engineSha='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
assert.equal(sha(engine),engineSha,'engine changed from independently pinned Stockfish 16');
const originalSha='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),originalSha);
const launch=fault=>{
 const runId=randomUUID();
 const args=['--import','tsx','scripts/review-benchmark-tenant-concurrency.mjs',
  '--app-root='+app,'--engine='+engine,'--engine-sha256='+engineSha,
  '--run-id='+runId];
 if(fault)args.push('--fault='+fault);
 const p=spawnSync(process.execPath,args,{
  cwd:root,encoding:'utf8',timeout:16000,maxBuffer:1024*1024,
 });
 assert.ifError(p.error);
 const output=JSON.parse(p.stdout);
 assert.equal(output.benchmark_run_id,runId,
  'raw subprocess stdout was not produced for the current QA invocation');
 return {status:p.status,output,stderr:p.stderr,runId};
};

const clean=launch(null);
assert.equal(clean.status,0,'positive run did not complete successfully: '+clean.stderr);
const cleanPacket=JSON.parse(readFileSync(join(results,'review-tenant-concurrency.json'),'utf8'));
assert.equal(cleanPacket.benchmark_run_id,clean.runId,'stale clean raw packet was reused');
const accepted=validateTenantConcurrencyEvidence(cleanPacket);
assert.equal(accepted.cross_tenant_access_denied,true);
assert.equal(clean.output.test_only_provider_fault,null);
assert.equal(clean.output.wrong_prose_cached,false);

const corrupted=launch('swap-model-output');
assert.equal(corrupted.status,1,'application-boundary corruption unexpectedly passed');
const packet=JSON.parse(readFileSync(join(results,'review-tenant-concurrency-fault-swap.json'),'utf8'));
assert.equal(packet.benchmark_run_id,corrupted.runId,'stale negative-control packet was reused');
assert.notEqual(clean.runId,corrupted.runId,'negative and positive controls shared a run identifier');
assert.equal(packet.test_only_provider_fault,'swap-model-output');
assert.equal(packet.candidate_sha,cleanPacket.candidate_sha);
assert.equal(packet.manifest_sha256,cleanPacket.manifest_sha256);
assert.equal(packet.engine_sha256,cleanPacket.engine_sha256);
assert.equal(packet.observation.calls,6);
assert.equal(packet.observation.provider_responses_closed,6);
assert.equal(packet.observation.cross_user_prose_accepted_and_cached,true,
 'fault should be observed in the real route, not presumed from a test flag');
assert.equal(corrupted.output.wrong_prose_cached,true);
// Authz is not defeated by the model's swapped text. This is an LLM-content
// validation/factuality failure, not an observed cross-tenant access breach.
assert.deepEqual(packet.observation.actual_access_status,cleanPacket.observation.actual_access_status);
assert.deepEqual(packet.observation.model_prompts,cleanPacket.observation.model_prompts);

const summaries={
 en:{expected:'Black won the game.',actual:'Las negras ganaron la partida.'},
 es:{expected:'Las negras ganaron la partida.',actual:'Black won the game.'},
};
for(const [lang,item] of Object.entries(summaries)){
 const packetText=packet.observation.real_sse[lang];
 const match=packetText.match(/(?:^|\n)event: done\r?\ndata: ([^\r\n]+)/);
 assert(match,'real route did not emit done while consuming mismatched model text');
 const realDone=JSON.parse(match[1]).review;
 assert.equal(realDone.summary,item.actual,'wrong-language summary did not reach real SSE');
 assert.equal(packet.observation.cached[lang].summary,item.actual,
  'wrong-language text did not enter the actual SQLite cache');
 assert.equal(packet.observation.readback[lang].summary,item.actual,
  'authenticated GET did not return the mismatched cached text');
 assert.notEqual(item.actual,item.expected);
}

// Hostile re-labeling: set every packet flag to the same green claims as a
// genuine clean run. The independent verifier still MUST reject the actual
// SSE content, before it even checks these flags.
const forgedGreen=structuredClone(packet);
forgedGreen.test_only_provider_fault=null;
forgedGreen.tested_tenants_isolated=true;
forgedGreen.observation.provider_payload_swapped=false;
forgedGreen.observation.cross_user_prose_accepted_and_cached=false;
const reject=(evidence,label)=>{
 assert.throws(()=>validateTenantConcurrencyEvidence(evidence),
  /incorrect recipient-specific review summary in real SSE/,
  label+': corrupt REAL output escaped the independent verifier');
};
reject(forgedGreen,'forged green claims');

const fakeCache=structuredClone(forgedGreen);
for(const [lang,x] of Object.entries(summaries)){
 fakeCache.observation.cached[lang].summary=x.expected;
 fakeCache.observation.readback[lang].summary=x.expected;
}
reject(fakeCache,'correct-looking database but bad actual SSE');

const fixedSse=structuredClone(forgedGreen);
for(const [lang,x] of Object.entries(summaries)){
 fixedSse.observation.real_sse[lang]=fixedSse.observation.real_sse[lang].replace(
  JSON.stringify(x.actual).slice(1,-1),JSON.stringify(x.expected).slice(1,-1));
 const patched=JSON.parse(fixedSse.observation.real_sse[lang]
  .match(/(?:^|\n)event: done\r?\ndata: ([^\r\n]+)/)[1]).review;
 assert.equal(patched.summary,x.expected,'SSE-only forgery failed to change the actual wire payload');
}
// The cache still contains the other user's text; a green wire record alone
// must not be sufficient when persisted output is corrupt.
assert.throws(()=>validateTenantConcurrencyEvidence(fixedSse),
 /cross-user cached review mismatch/,
 'forged SSE hides a broken stored review');

const report={
 schema_version:1,at_utc:new Date().toISOString(),
 previous_agent_d_head:'f1e6755f743391430c7ab073305b2093eec59311',
 candidate_sha:originalSha,engine_sha256:engineSha,
 fixture_manifest_sha256:packet.manifest_sha256,
 self_authored_chess_only:true,disposable_database_only:true,
 actual_real_route_fault:'swap-model-output',
 positive_run_exit:clean.status,negative_run_exit:corrupted.status,
 clean_authenticated_reviews_certified:2,
 clean_benchmark_run_id:clean.runId,negative_benchmark_run_id:corrupted.runId,
 corrupt_authenticated_reviews_rejected:2,
 corrupt_provider_reports_were_cached:2,
 independently_rejected_forged_green_packets:3,
 factual_result:'Both users received the other language\'s summary from the deliberately corrupt model; valid account ownership checks remained enforced.',
 not_an_authentication_bypass:true,
 product_release_approved:false,overall_quality_certified:false,
 source_sha256:{runner:sha(join(root,'scripts/review-benchmark-tenant-concurrency.mjs')),
  verifier:sha(join(root,'scripts/review-benchmark-tenant-proof.mjs')),
  boundary_controls:sha(join(root,'scripts/review-benchmark-tenant-boundary-controls.mjs'))},
 limitations:['This is a synthetic and deliberately incorrect mock-model output, not an observed live-LLM rate',
  'Two parallel requests, two fixed profile languages, one legal synthetic PGN only',
  'The benchmark expects known mock strings; human-language assessment and sealed holdout remain absent',
  'Successful detection does not make Patzer\'s model text safe and is not a release certificate'],
};
const dest=join(qa,'certification-summary-checkpoint17.json');
writeFileSync(dest,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:dest,negative_run_exit:corrupted.status,
  corruption_reached_real_cache:true,forged_green_proof_rejections:3,
  product_release_approved:false},null,2));
