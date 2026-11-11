#!/usr/bin/env node
/** Fresh separate-process language/quote/coverage adversarial QA evidence.
 * Correlates stdout, ignored raw JSON, source pins and independent proof.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {verifyCoachScopeMatrix} from './review-benchmark-coach-scope-proof.mjs';
import {verifyCoachProvenanceEvidence} from './review-benchmark-coach-provenance-proof.mjs';

const root=resolve(import.meta.dirname,'..');
const results=join(root,'qa/review-excellence/results');
const id=randomUUID();
const run=spawnSync(process.execPath,
 ['scripts/review-benchmark-coach-scope-matrix.mjs','--run-id='+id],
 {cwd:root,encoding:'utf8',timeout:14000,maxBuffer:1024*1024});
assert.ifError(run.error);
assert.equal(run.status,0,'bounded scope controls failed: '+run.stderr.slice(-1200));
let stdout;
try{stdout=JSON.parse(run.stdout);}catch{
 throw Error('scope matrix exited without JSON stdout: '+run.stdout.slice(-500));
}
assert.equal(stdout.run_id,id,'fresh subprocess stdout did not match its run UUID');
const packet=JSON.parse(readFileSync(join(results,'coach-scope-matrix.json'),'utf8'));
assert.equal(packet.run_id,id,'stale scope matrix output reused');
const scoped=verifyCoachScopeMatrix(packet);
assert.equal(stdout.total,scoped.sample_count);
assert.deepEqual(stdout.counts,packet.counts);
assert.equal(stdout.real_product_certified,false);
const real=JSON.parse(readFileSync(join(results,'real-coach-faults.json'),'utf8'));
assert.equal(verifyCoachProvenanceEvidence(real).real_pipeline_false_winner_in_output,true);
const forged=structuredClone(packet);
forged.cases.find(x=>x.name==='mixed true winner + unrecognized white monarch').observed_status='limited_claims_passed';
forged.cases.find(x=>x.name==='mixed true winner + unrecognized white monarch').expected_status='limited_claims_passed';
assert.throws(()=>verifyCoachScopeMatrix(forged),undefined,
 'unknown false paraphrase escaped the independent scoped-checker gate');
console.log(JSON.stringify({fresh_run_id:id,
 source_pinned_five_language_coverage:true,
 real_coach_controlled_false_prose_still_reproduced:true,
 negative_false_green_rejected:true,
 result:scoped,release_approved:false},null,2));
