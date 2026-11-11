#!/usr/bin/env node
/** Fresh isolated QA-only modal matrix with UUID-bound runtime source truth,
 * independently challenged against fixed gold and a corrupted packet. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {verifyCoachConditionalMatrix} from './review-benchmark-coach-conditional-proof.mjs';
const root=resolve(import.meta.dirname,'..'),results=join(root,'qa/review-excellence/results');
const id=randomUUID();
const r=spawnSync(process.execPath,
 ['scripts/review-benchmark-coach-conditional-matrix.mjs','--run-id='+id],
 {cwd:root,encoding:'utf8',timeout:13000,maxBuffer:2*1024*1024});
assert.ifError(r.error);
assert.equal(r.status,0,'matrix did not complete: '+r.stderr.slice(-1200));
let output;
try{output=JSON.parse(r.stdout);}catch{
 throw Error('fresh scope matrix did not produce stdout evidence: '+r.stdout.slice(-500));
}
assert.equal(output.run_id,id,'subprocess stdout not from fresh test');
assert.equal(output.test_result,'pass');
const packet=JSON.parse(readFileSync(join(results,'coach-conditional-matrix.json'),'utf8'));
assert.equal(packet.run_id,id,'stale raw packet substituted for fresh QA test');
assert.deepEqual(output.counts,packet.counts);
const independent=verifyCoachConditionalMatrix(packet);
assert.equal(output.samples,independent.total_cases);
assert.equal(output.full_factuality_certified,false);
const fake=structuredClone(packet);
const conditional=fake.cases.find(x=>x.name==='false result if');
conditional.observed_status='rejected';conditional.expected_status='rejected';
conditional.findings=['contradicted_game_winner'];
assert.throws(()=>verifyCoachConditionalMatrix(fake),undefined,
 'independent audit accepted an imagined chess win as a real contradiction');
console.log(JSON.stringify({real_fresh_subprocess_id:id,
 independent_scoped_factuality_proof:true,
 forged_false_negative_rejected:true,...independent},null,2));
