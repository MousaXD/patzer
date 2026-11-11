#!/usr/bin/env node
/** Fresh source-only FEN legality probe bound to UUID and an independently
 * adjudicated hostile evidence challenge. No engine/LLM or production data. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {verifySourceFENMatrix} from './review-benchmark-start-fen-proof.mjs';

const root=resolve(import.meta.dirname,'..'),results=join(root,'qa/review-excellence/results');
const id=randomUUID();
const fresh=spawnSync(process.execPath,
 ['scripts/review-benchmark-start-fen-matrix.mjs','--run-id='+id],
 {cwd:root,encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024});
assert.ifError(fresh.error);
assert.equal(fresh.status,0,'real source legality test failed: '+fresh.stderr.slice(-800));
let result;
try{result=JSON.parse(fresh.stdout);}catch{
 throw Error('source-runner stdout was not JSON: '+fresh.stdout.slice(-500));
}
assert.equal(result.run_id,id,'source-runner output was reused');
const evidence=JSON.parse(readFileSync(join(results,'coach-start-fen-matrix.json'),'utf8'));
assert.equal(evidence.run_id,id,'unrelated raw FEN packet was reused');
assert.equal(result.case_count,evidence.case_count);
assert.deepEqual(result.counts,evidence.counts);
assert.equal(result.release_approved,false);
const proof=verifySourceFENMatrix(evidence);
assert.equal(proof.case_count,99);
const corrupt=structuredClone(evidence);
const adjacent=corrupt.cases.find(x=>x.name==='invalid-adjacent-kings-white / white-winner');
adjacent.expected_status=adjacent.actual_status='rejected';
adjacent.error_reason='contradicted_terminal_draw_winner';
adjacent.error_detail=null;
assert.throws(()=>verifySourceFENMatrix(corrupt),undefined,
 'unreachable kings were accepted as evidence for a factual chess draw');
console.log(JSON.stringify({fresh_UUID:id,strict_chessjs_parser_accepted_all_source_fens:true,
  independently_verified_cases:99,
  invalid_cases_correctly_refused:60,
  valid_source_controls_abstained:39,
  old_invalid_kings_draw_false_accusation_rejected:true,
  full_retrograde_reachability_certified:false,release_approved:false},null,2));
