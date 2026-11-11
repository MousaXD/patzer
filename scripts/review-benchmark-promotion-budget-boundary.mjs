#!/usr/bin/env node
/** Fresh source-only reproduction, bind stdout/raw UUID, then inject the
 * exact false green that originally accepted 3 rooks with 8 present pawns. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {verifyPromotionBudgetEvidence} from './review-benchmark-promotion-budget-proof.mjs';

const root=resolve(import.meta.dirname,'..'),results=join(root,'qa/review-excellence/results');
const id=randomUUID();
const run=spawnSync(process.execPath,
 ['scripts/review-benchmark-promotion-budget-matrix.mjs','--run-id='+id],
 {cwd:root,encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024});
assert.ifError(run.error);
assert.equal(run.status,0,'real promotion source runner failed: '+run.stderr.slice(-900));
let stdout;
try{stdout=JSON.parse(run.stdout);}catch{
 throw Error('fresh promotion budget runner stdout not JSON '+run.stdout.slice(-400));
}
assert.equal(stdout.run_id,id,'source stdout from old run was supplied');
const packet=JSON.parse(readFileSync(join(results,'coach-promotion-budget-matrix.json'),'utf8'));
assert.equal(packet.run_id,id,'raw source inventory packet from old run was supplied');
assert.equal(stdout.source_games,packet.source_games);
assert.equal(stdout.case_count,packet.case_count);
assert.deepEqual(stdout.counts,packet.counts);
assert.equal(stdout.release_approved,false);
const proof=verifyPromotionBudgetEvidence(packet);
assert.equal(proof.independently_adjudicated_verdicts,108);
const forgery=structuredClone(packet);
const error=forgery.cases.find(r=>r.name==='white-8p-three-rooks / white-winner');
error.expected_status=error.observed_status='not_evaluated';
error.findings=[];error.unassessed=['nonterminal_result_not_independently_verified'];
assert.throws(()=>verifyPromotionBudgetEvidence(forgery),undefined,
 'no missing pawns cannot explain White having an extra rook');
console.log(JSON.stringify({fresh_source_run_id:id,
  source_games_verified:proof.independent_synthetic_source_cases,
  distinct_claims_verified:proof.independently_adjudicated_verdicts,
  impossible_source_claims_refused:proof.impossible_piece_inventories_blocked,
  necessary_only_positive_abstentions:proof.insufficient_evidence_abstentions,
  forged_no_pawn_promotion_false_green_rejected:true,
  full_retrograde_reachability_certified:false,release_approved:false},null,2));
