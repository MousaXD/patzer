#!/usr/bin/env node
/** Require fresh separately executed, UUID-matched synthetic game-end replay.
 * Deliberately forge a later-mate false green and prove the verifier fails. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {verifyGameEndChronology} from './review-benchmark-game-end-chronology-proof.mjs';

const root=resolve(import.meta.dirname,'..'),results=join(root,'qa/review-excellence/results');
const id=randomUUID();
const run=spawnSync(process.execPath,
 ['scripts/review-benchmark-game-end-chronology-matrix.mjs','--run-id='+id],
 {cwd:root,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
assert.ifError(run.error);
assert.equal(run.status,0,'real source runner failed: '+run.stderr.slice(-900));
let stdout;
try{stdout=JSON.parse(run.stdout);}catch{
 throw Error('real source-runner stdout is not JSON: '+run.stdout.slice(-500));
}
assert.equal(stdout.run_id,id,'stale source stdout substituted');
const raw=JSON.parse(readFileSync(join(results,'game-end-chronology-matrix.json'),'utf8'));
assert.equal(raw.run_id,id,'unrelated ignored raw PGN evidence substituted');
assert.equal(stdout.source_count,raw.source_count);
assert.equal(stdout.case_count,raw.case_count);
assert.deepEqual(stdout.counts,raw.counts);
assert.equal(stdout.release_approved,false);
const verdict=verifyGameEndChronology(raw);
const forged=structuredClone(raw);
const laterMate=forged.cases.find(r=>r.name==='fivefold-then-mate / black-winner');
laterMate.expected_status=laterMate.observed_status='limited_claims_passed';
laterMate.issue=null;laterMate.findings=[];laterMate.verified=['game_result'];
assert.throws(()=>verifyGameEndChronology(forged),undefined,
 'later illegal mate was falsely certified after the game already ended');
console.log(JSON.stringify({fresh_source_run_id:id,
  sources_checked:verdict.synthetic_source_games,
  assertions_checked:verdict.claim_cases,
  invalid_history_claims_blocked:verdict.post_terminal_source_claims_blocked,
  injected_later_mate_false_green_rejected:true,
  release_approved:false},null,2));
