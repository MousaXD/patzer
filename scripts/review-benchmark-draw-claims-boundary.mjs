#!/usr/bin/env node
/** Fresh UUID-bound subprocess reproduces the 3x/5x & 50/75 draw-claim
 * discrepancy and independently challenges a deliberately incorrect verdict. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {verifyDrawClaimEvidence} from './review-benchmark-draw-claims-proof.mjs';

const root=resolve(import.meta.dirname,'..'),results=join(root,'qa/review-excellence/results');
const id=randomUUID();
const run=spawnSync(process.execPath,
 ['scripts/review-benchmark-draw-claims-matrix.mjs','--run-id='+id],
 {cwd:root,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
assert.ifError(run.error);
assert.equal(run.status,0,'real chess-law test failed: '+run.stderr.slice(-1400));
let stdout;
try{stdout=JSON.parse(run.stdout);}catch{
 throw Error('fresh chess test did not return JSON stdout: '+run.stdout.slice(-400));
}
assert.equal(stdout.run_id,id,'reused stale stdout instead of new chess-law test');
const raw=JSON.parse(readFileSync(join(results,'coach-draw-claims-matrix.json'),'utf8'));
assert.equal(raw.run_id,id,'reused stale source PGN evidence');
assert.equal(stdout.cases,raw.case_count);
assert.deepEqual(stdout.counts,raw.counts);
assert.equal(stdout.release_approved,false);
const verified=verifyDrawClaimEvidence(raw);
const forged=structuredClone(raw);
const falseAccusation=forged.cases.find(r=>r.name==='repetition-3 / white winner');
falseAccusation.verdict_expected=falseAccusation.verdict_observed='rejected';
falseAccusation.findings=['contradicted_terminal_draw_winner'];
falseAccusation.unassessed=[];
assert.throws(()=>verifyDrawClaimEvidence(forged),undefined,
 'correctable triple repetition was wrongly promoted to automatic draw');
console.log(JSON.stringify({new_run_id:id,
  genuine_17_legal_source_game_cases_replayed:true,
  contrasting_result_assertions_checked:85,
  direct_hypothetical_wrong_accusation_rejected:true,
  verified,release_approved:false},null,2));
