#!/usr/bin/env node
/** Fresh isolated result classification replay; bind unique UUID to stdout,
 * raw legal PGN evidence and independent gold, rejecting a false green. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {verifyResultEvidence} from './review-benchmark-result-evidence-proof.mjs';

const root=resolve(import.meta.dirname,'..'),results=join(root,'qa/review-excellence/results');
const runId=randomUUID();
const output=spawnSync(process.execPath,
 ['scripts/review-benchmark-result-evidence-matrix.mjs','--run-id='+runId],
 {cwd:root,encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024});
assert.ifError(output.error);
assert.equal(output.status,0,
 'real PGN evidence runner failed: '+output.stderr.slice(-800));
let stdout;
try{stdout=JSON.parse(output.stdout);}catch{
 throw Error('real matrix did not return JSON: '+output.stdout.slice(-600));
}
assert.equal(stdout.run_id,runId,'subprocess stdout not tied to fresh run UUID');
const packet=JSON.parse(readFileSync(join(results,'coach-result-evidence-matrix.json'),'utf8'));
assert.equal(packet.run_id,runId,'raw evidence from earlier run reused');
assert.equal(stdout.cases,packet.case_count);
assert.deepEqual(stdout.counts,packet.counts);
const verdict=verifyResultEvidence(packet);
assert.equal(verdict.release_approved,false);
assert.equal(verdict.claim_case_count,67);
const forged=structuredClone(packet);
const bad=forged.cases.find(x=>x.name==='unfinished-white / white says won');
bad.status_expected='rejected';bad.status_observed='rejected';
bad.findings=['contradicted_game_winner'];bad.unassessed=[];
assert.throws(()=>verifyResultEvidence(forged),undefined,
 'unverified resignation-like PGN was incorrectly promoted to a contradiction');
console.log(JSON.stringify({unique_run_id:runId,
 fresh_synthetic_legal_PGNs_replayed:verdict.bounded_synthetic_games,
 independently_checked_result_claims:verdict.claim_case_count,
 legacy_false_nonterminal_rejection_blocked:true,
 release_approved:false},null,2));
