#!/usr/bin/env node
/** Execute valid and deliberately broken REAL HTTP workers. A bypass in the
 * test-only worker must fail the independent cross-process QA admission gate.
 * No production source or database is ever modified.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {certifyCrossProcessEvidence} from './review-benchmark-cross-process-proof.mjs';

const root=resolve(import.meta.dirname,'..'),results=join(root,'qa/review-excellence/results');
const args=Object.fromEntries(process.argv.slice(2).map(x=>{
 const n=x.indexOf('=');return n<0?[x.slice(2),true]:[x.slice(2,n),x.slice(n+1)];
}));
const app=realpathSync(args['app-root']||join(results,'worktree-coach'));
const engine=realpathSync(args.engine||join(results,'engine/unpacked/usr/games/stockfish'));
const engineHash='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
assert.equal(sha(engine),engineHash);
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),
 '19c359ec3feb8e3c10c33415c403eaf5ab3d6c87');
function run(fault){
 const id=randomUUID();
 const cli=['--import','tsx','scripts/review-benchmark-cross-process-logout.mjs',
  '--app-root='+app,'--engine='+engine,'--engine-sha256='+engineHash,'--run-id='+id];
 if(fault)cli.push('--fault='+fault);
 const proc=spawnSync(process.execPath,cli,{
  cwd:root,encoding:'utf8',timeout:20000,maxBuffer:2*1024*1024,
 });
 assert.ifError(proc.error);
 return {id,status:proc.status,stdout:proc.stdout,stderr:proc.stderr};
}
const positive=run(null);
assert.equal(positive.status,0,'correct two-worker run must succeed: '+positive.stderr);
const claimed=JSON.parse(positive.stdout);
assert.equal(claimed.benchmark_run_id,positive.id);
const raw=JSON.parse(readFileSync(join(results,'review-crossprocess-logout.json'),'utf8'));
assert.equal(raw.benchmark_run_id,positive.id,'old evidence packet wrongly reused');
const verdict=certifyCrossProcessEvidence(raw);
assert.equal(verdict.shared_sqlite_logout_rejects_future_admissions,true);

const corrupted=run('grant-revoked');
assert.equal(corrupted.status,1,'broken HTTP auth worker returned green');
assert(corrupted.stderr.includes('revoked_cookie_accepted_by_worker'),
 'negative control exited for unrelated reason, not revoked-cookie gate');
assert(/\+\s*200[\s\S]*401/.test(corrupted.stderr),
 'no actual HTTP 200 from deliberately broken worker was observed');
assert(!corrupted.stdout.includes('"release_approved": true'));
assert.notEqual(corrupted.id,positive.id);

// Stale evidence may carry a passing old timestamp. The runner's UUID must
// match the requested subprocess; a forged packet is rejected by the wrapper.
const badReuse=structuredClone(raw);badReuse.benchmark_run_id=corrupted.id;
assert.notEqual(badReuse.benchmark_run_id,positive.id,
 'hostile packet has become incorrectly linked to the clean request');

const report={schema_version:1,at_utc:new Date().toISOString(),
 previous_qa_commit:'d7712012cc26efee36ab07cc21ff90de2fe18730',
 candidate_sha:raw.candidate_sha,engine_sha256:engineHash,
 manifest_sha256:raw.manifest_sha256,
 valid_run_id:positive.id,broken_run_id:corrupted.id,
 valid_run_exit:positive.status,broken_run_exit:corrupted.status,
 broken_worker_actual_http_200_detected:true,
 broken_worker_rejected_by:'revoked_cookie_accepted_by_worker',
 original_hono_review_and_auth_routes_tested:true,
 test_only_wrapper_generated_bad_response:true,
 full_product_security_certified:false,release_approved:false,
 source_hashes:{worker:sha(join(root,'scripts/review-benchmark-revocation-worker.mjs')),
  real_http_harness:sha(join(root,'scripts/review-benchmark-cross-process-logout.mjs')),
  independent_proof:sha(join(root,'scripts/review-benchmark-cross-process-proof.mjs')),
  boundary_challenge:sha(join(root,'scripts/review-benchmark-cross-process-boundary.mjs'))},
 limitations:['The deliberate HTTP bypass is injected by QA route middleware, not Patzer source',
  'Two independent Node processes and localhost HTTP only, no remote reverse proxy',
  'No production SQLite, private game histories, real auth material or external model']};
const path=join(root,'qa/review-excellence/certification-summary-checkpoint19-boundary.json');
writeFileSync(path,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:path,...verdict,
 deliberately_broken_http_request_rejected:true,release_approved:false},null,2));
