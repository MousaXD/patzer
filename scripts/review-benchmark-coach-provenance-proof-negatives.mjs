#!/usr/bin/env node
/** Attack the checkpoint 24 independent evidence proof, not product data. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyCoachProvenanceEvidence} from './review-benchmark-coach-provenance-proof.mjs';
const raw=JSON.parse(readFileSync('qa/review-excellence/results/real-coach-faults.json','utf8'));
assert.equal(verifyCoachProvenanceEvidence(raw).false_before_move_assertion_rejected,true);
const changed=[
 ['unverified fake runner UUID',x=>x.benchmark_run_id='reused'],
 ['candidate SHA swapped',x=>x.candidate_sha='a'.repeat(40)],
 ['engine SHA swapped',x=>x.engine_sha256='f'.repeat(64)],
 ['manifest SHA swapped',x=>x.manifest_sha256='f'.repeat(64)],
 ['different fixture',x=>x.fixture_id='SYN-UNKNOWN'],
 ['not the real coach pipeline',x=>x.scope='test-only checker not real product'],
 ['chess event result forged',x=>x.actual_result='1-0'],
 ['PGN result forged',x=>x.pgm_result='1-0'],
 ['king e1 not actually proven',x=>x.replay_white_king_e1=false],
 ['king e2 incorrectly treated as true',x=>x.replay_white_king_e2=true],
 ['wrong selected ply',x=>x.key_moment_ply=2],
 ['wrong coach prose version',x=>x.coach_prose_version=99],
 ['falsely certify app',x=>x.candidate_factuality_certified=true],
 ['fake text not synthetic',x=>x.false_prose_strings_are_fixture_only=false],
 ['positive control no longer passed',x=>x.safe_flow_accepted=false],
 ['provider errors present',x=>x.failures.push('model failed')],
 ['missing request',x=>x.requests=5],
 ['stalled uncontrolled duration',x=>x.elapsed_ms=20000],
 ['missing false winner escape',x=>x.accepted_false_claims.shift()],
 ['missing false piece escape',x=>x.accepted_false_claims.pop()],
 ['fake positive neutral result',x=>x.independent_claim_validation.neutral.status='not_evaluated'],
 ['neutral result proof altered',x=>x.independent_claim_validation.neutral.verified[0].proof='model_claim'],
 ['neutral piece proof altered',x=>x.independent_claim_validation.neutral.verified[1].proof='model_fen'],
 ['neutral verified not actually supported',x=>x.independent_claim_validation.neutral.verified.pop()],
 ['neutral unassessed coverage forged',x=>x.independent_claim_validation.neutral.unassessed.push({reason:'missing'})],
 ['hostile false claims labeled pass',x=>x.independent_claim_validation.hostile.status='limited_claims_passed'],
 ['winner contradiction hidden',x=>x.independent_claim_validation.hostile.findings.shift()],
 ['piece contradiction hidden',x=>x.independent_claim_validation.hostile.findings.pop()],
 ['incorrect winner claim field',x=>x.independent_claim_validation.hostile.findings[0].field='opening'],
 ['piece contradiction forged as winner',x=>x.independent_claim_validation.hostile.findings[1].reason='contradicted_game_winner'],
 ['piece contradiction from wrong ply',x=>x.independent_claim_validation.hostile.findings[1].source_ply=1],
 ['hostile result no longer black',x=>x.independent_claim_validation.hostile.findings[0].verified_winner='white'],
 ['hostile returned unassessed data',x=>x.independent_claim_validation.hostile.unassessed.push({reason:'none'})],
 ['model wrong winner not actually in summary',x=>x.attack_output.summary='Black won the game.'],
 ['model false piece text never surfaced',x=>x.attack_output.key_moments[0].prose="White's king is on e1."],
 ['wrong model moment ply',x=>x.attack_output.key_moments[0].ply=2],
 ['removed model moment output',x=>x.attack_output.key_moments=[]],
 ['generated opening differs',x=>x.attack_output.opening='incorrect opening'],
];
let rejected=0;
for(const [name,mutate] of changed){
 const sample=structuredClone(raw);mutate(sample);
 assert.throws(()=>verifyCoachProvenanceEvidence(sample),undefined,
  'false evidence not rejected: '+name);
 rejected++;
}
console.log(JSON.stringify({genuine_pipeline_evidence_passes_independent_QA:true,
 falsified_real_coach_evidence_packets_rejected:rejected,
 full_factuality_certified:false,release_approved:false}));
