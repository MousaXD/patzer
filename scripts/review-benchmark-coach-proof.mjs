#!/usr/bin/env node
// Compile a narrow, *failing product* coach factuality packet from disposable
// independent QA runs. A passing harness is not a green product certificate.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence');
const raw=JSON.parse(readFileSync(join(qa,'results/real-coach-faults.json'),'utf8'));
const prior=JSON.parse(readFileSync(join(qa,'results/real-coach-faults-4f7a2b1.json'),'utf8'));
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const pinnedAgentB='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const previouslyTestedB='4f7a2b1039661874eee82bd5bcc1333abbaedb26';
const pinnedEngine='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const manifestHash=sha(join(qa,'manifests/manifest-v2.jsonl'));
assert.equal(raw.candidate_sha,pinnedAgentB);
assert.equal(prior.candidate_sha,previouslyTestedB);
assert.deepEqual(prior.accepted_false_claims.slice().sort(),[
 'wrong_game_winner_in_summary','wrong_piece_square_in_key_moment'].sort());
assert.deepEqual(prior.independent_claim_validation.hostile.findings.map(x=>x.reason).sort(),[
 'contradicted_game_winner','contradicted_piece_location'].sort());
assert.equal(raw.engine_sha256,pinnedEngine);
assert.equal(raw.manifest_sha256,manifestHash);
assert.equal(raw.fixture_id,'SYN-GAME-FOOLS-MATE');
assert.equal(raw.pgm_result,'0-1');
assert.equal(raw.actual_result,'0-1');
assert.equal(raw.replay_white_king_e1,true);
assert.equal(raw.replay_white_king_e2,false);
assert.equal(raw.candidate_factuality_certified,false);
assert.equal(raw.independent_claim_validation.neutral.status,'partial_claims_verified');
assert(raw.independent_claim_validation.neutral.unassessed.some(x=>x.reason==='unchecked_prose_remainder'),
 'independent QA cannot claim all safe model prose was fact checked');
assert.equal(raw.independent_claim_validation.neutral.verified.length,2);
assert.equal(raw.independent_claim_validation.hostile.status,'rejected');
assert.deepEqual(raw.independent_claim_validation.hostile.findings.map(x=>x.reason).sort(),[
 'contradicted_game_winner','contradicted_piece_location'].sort());
assert.deepEqual(raw.accepted_false_claims.sort(),[
 'wrong_game_winner_in_summary','wrong_piece_square_in_key_moment'].sort());
assert.equal(raw.requests,6);
assert.deepEqual(raw.failures,[]);
const tests=execFileSync(process.execPath,['scripts/review-benchmark-coach-claim-negative-controls.mjs'],{cwd:root,encoding:'utf8'});
const verdict=JSON.parse(tests.trim().split('\n').at(-1));
assert.equal(verdict.verdict,'pass');
assert.equal(verdict.independent_claim_controls,18);
assert.equal(verdict.known_unrecognized_paraphrase,true);
const unitLog=readFileSync(join(qa,'results/supplemental-coach-unit.log'),'utf8');
assert(/Tests\s+27 passed \(27\)/.test(unitLog),'supplementary Agent B test evidence is missing');
const src={
 adapter:'scripts/review-benchmark-coach-claim-adapter.mjs',
 controlled_provider:'scripts/review-benchmark-real-coach-faults.mjs',
 negative_controls:'scripts/review-benchmark-coach-claim-negative-controls.mjs'
};
const packet={
 schema_version:1,at_utc:new Date().toISOString(),
 checkpoint_parent:'1962bf0eda14d48c073ad669df85bc29ef3db858',
 qa_branch:'agent/review-benchmark-20261111',
 benchmark_checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 candidate_b_sha:pinnedAgentB,
 candidate_b_prior_verified_sha:previouslyTestedB,
 candidate_versions_independently_replayed:2,
 candidate_prose_version:raw.coach_prose_version,
 engine_sha256:pinnedEngine,engine_name:'Stockfish 16',
 analyzer_depth:8,threads:1,hash_mib:16,
 manifest_v2_sha256:manifestHash,
 fixture_id:raw.fixture_id,fixture_source:'self-authored synthetic; no user game history',
 actual_game_result:'0-1',actual_white_king_square:'e1',
 llm_source:'loopback-only deliberately fabricated JSON responses, NOT a live provider',
 llm_requests_accepted:raw.requests,
 independent_adapter_checks:verdict.independent_claim_controls,
 verified_true_controls:2,
 controlled_false_statements_passed_candidate:[
  {surface:'game_review.summary',claim:'White won the game.',reason:'contradicted_game_winner',source:'terminal legal replay'},
  {surface:'game_review.key_moments[0].prose',claim:"White's king is on e2.",reason:'contradicted_piece_location',source:'FEN + actual played-move replay'}
 ],
 independent_verifier_rejected_false_statements:2,
 existing_agent_b_targeted_tests_passed:27,
 result:{product_factuality_certified:false,controlled_escapes_detected:true,qa_harness_controls_passed:true,
    release_approved:false,integrator_must_block_unqualified_factuality_claims:true},
 source_sha256:Object.fromEntries(Object.values(src).map(f=>[f,sha(join(root,f))])),
 known_limitations:[
  'Not an actual LLM hallucination frequency measurement; the local mock deliberately supplied false text',
  'Independent checker validates narrow explicit English winner and owner-piece-square assertions only',
  'Equivalent paraphrases, arbitrary tactical causality, forced lines beyond direct legal proof, other languages and pedagogy remain unassessed',
  'Shared chess.js rules library is independently replayed but not a separately implemented chess-rules engine',
  'Existing agent tests pass despite these missing adversarial examples; no source code in Agent B was modified',
  'No sealed holdout, human adjudication or production-equivalent Stockfish 17 tests'
 ]
};
const path=join(qa,'certification-summary-checkpoint6.json');
writeFileSync(path,JSON.stringify(packet,null,2)+'\n');
console.log(JSON.stringify({report:path,candidate:pinnedAgentB,controlled_product_escapes:2,independent_qa_rejections:2,negative_controls:verdict.independent_claim_controls,unit_tests:27,product_certified:false},null,2));
