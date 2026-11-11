#!/usr/bin/env node
/** Separate, source-bound adjudicator for the finite QA-only modal matrix.
 * Its selected expected outcomes are NOT read from matrix expected_status. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Chess} from 'chess.js';
import {verifyCoachProvenanceEvidence} from './review-benchmark-coach-provenance-proof.mjs';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const results=join(qa,'results');
const sha=filename=>createHash('sha256').update(readFileSync(filename)).digest('hex');
const runId=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const shaObject=data=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
// These two fixed, canonical gold fingerprints come from the separately
// designed 68-case hand-authored fixture. Named gold controls still check
// semantics; the fingerprints prevent OTHER, non-enumerated rows from having
// their statuses swapped while preserving the aggregate verdict counts.
const fixtureInputSha='48b7f801293ecba0aa8e808fe53f9bc8b5dce2a1ff5d83607eb634cad3d6b5f6';
const fixtureOutcomeSha='779f1b61907696f5f73cff6f076f2633741558ae8e700a12b36549de888d74d5';
const manifestFile=join(qa,'manifests/manifest-v2.jsonl');
const manifestSha='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
assert.equal(sha(manifestFile),manifestSha);
const fixture=readFileSync(manifestFile,'utf8').trim().split('\n').map(JSON.parse)
 .find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.source_kind==='synthetic'&&fixture.license==='self-authored');
const pgnFile=join(qa,'fixtures',fixture.pgn_file);
assert.equal(sha(pgnFile),fixture.pgn_sha256);
const chess=new Chess();chess.loadPgn(readFileSync(pgnFile,'utf8'),{strict:true});
assert(chess.header().Result==='0-1'&&chess.isCheckmate()&&chess.turn()==='w');
const third=chess.history({verbose:true})[2];
assert.equal(third.san,'g4');
assert.equal(new Chess(third.before).get('e1')?.type,'k');
assert.notEqual(new Chess(third.before).get('e2')?.type,'k');

const resultCondition='hypothetical_or_conditional_result_not_assessed';
const pieceCondition='hypothetical_or_conditional_piece_not_assessed';
// Hard-coded secondary adjudication for representative controls, independent
// of user-supplied or runtime matrix expected-status metadata.
const reference=[
 ['false result if','not_evaluated',resultCondition,0],
 ['false result suppose','not_evaluated',resultCondition,0],
 ['false result imagine','not_evaluated',resultCondition,0],
 ['false result assume that','not_evaluated',resultCondition,0],
 ['false result what if','not_evaluated',resultCondition,0],
 ['false result maybe','not_evaluated',resultCondition,0],
 ['false result perhaps','not_evaluated',resultCondition,0],
 ['false result allegedly','not_evaluated',resultCondition,0],
 ['false result interior if','not_evaluated',resultCondition,0],
 ['false result closing question','not_evaluated',resultCondition,0],
 ['false result trailing if','not_evaluated',resultCondition,0],
 ['false result trailing dash if','not_evaluated',resultCondition,0],
 ['false result trailing unless','not_evaluated',resultCondition,0],
 ['false result trailing only if','not_evaluated',resultCondition,0],
 ['true result conditional true if','not_evaluated',resultCondition,0],
 ['true result conditional true maybe','not_evaluated',resultCondition,0],
 ['true result conditional true question','not_evaluated',resultCondition,0],
 ['separate sentence direct then false antecedent','partial_claims_verified',resultCondition,1],
 ['separate sentence direct then question','partial_claims_verified',resultCondition,1],
 ['separate sentence direct then speculative maybe','partial_claims_verified',resultCondition,1],
 ['same sentence conditional governs both','not_evaluated',resultCondition,0],
 ['same sentence conditional governs antecedent and second false','not_evaluated',resultCondition,0],
 ['conditional piece if false','not_evaluated',pieceCondition,0],
 ['conditional piece suppose false','not_evaluated',pieceCondition,0],
 ['conditional piece imagine false','not_evaluated',pieceCondition,0],
 ['conditional piece what if false','not_evaluated',pieceCondition,0],
 ['conditional piece perhaps false','not_evaluated',pieceCondition,0],
 ['conditional piece trailing if false','not_evaluated',pieceCondition,0],
 ['conditional piece if true','not_evaluated',pieceCondition,0],
 ['conditional piece true conditional question','not_evaluated',pieceCondition,0],
 ['perspective white hypothetical win','not_evaluated',resultCondition,0],
 ['perspective black hypothetical loss','not_evaluated',resultCondition,0],
 ['direct contrast direct White false','rejected','contradicted_game_winner',0],
 ['direct contrast direct Black true','limited_claims_passed',null,1],
 ['direct contrast direct White lost','limited_claims_passed',null,1],
 ['direct contrast direct Black lost','rejected','contradicted_game_winner',0],
 ['direct contrast direct fake king','rejected','contradicted_piece_location',0],
 ['direct contrast direct actual king','limited_claims_passed',null,1],
 ['direct contrast direct fake pawn','rejected','contradicted_piece_location',0],
 ['direct contrast direct actual pawn','limited_claims_passed',null,1],
 ['direct contradiction after question','rejected','contradicted_game_winner',0],
 ['direct truth after question','partial_claims_verified',resultCondition,1],
 ['direct contradiction after hypothetical piece','rejected','contradicted_piece_location',0],
 ['direct truth after hypothetical piece','partial_claims_verified',pieceCondition,1],
];

export function verifyCoachConditionalMatrix(packet){
 assert.equal(packet.schema_version,1);
 assert(runId.test(packet.run_id||''),'no new cryptographic subprocess identity');
 assert.equal(packet.previous_checkpoint,'d75a77c1377b482b39e80b3329fb826ef5938aed');
 assert.equal(packet.candidate_b_sha,'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87');
 assert.equal(packet.manifest_sha256,manifestSha);
 assert.equal(packet.pgn_sha256,sha(pgnFile));
 assert.equal(packet.fixture_id,fixture.fixture_id);
 assert.equal(packet.source_kind,'self-authored synthetic four-ply Black checkmate');
 assert.equal(packet.actual_LLM_calls,0);
 assert.equal(packet.stockfish_calls,0);
 assert.equal(packet.full_factuality_certified,false);
 assert.equal(packet.release_approved,false);
 assert.equal(packet.sample_count,68);
 assert(Array.isArray(packet.cases)&&packet.cases.length===68);
 assert.equal(new Set(packet.cases.map(x=>x.name)).size,68,'repeated test case substituted');
 const inputRows=packet.cases.map(r=>[r.name,r.summary,r.moment,r.user_color]);
 const outcomeRows=packet.cases.map(r=>[r.name,r.observed_status,r.verified_count,
  r.verified_types,r.findings,r.unassessed]);
 assert.equal(shaObject(inputRows),fixtureInputSha,
  'the 68 independent fixture inputs/order have changed');
 assert.equal(shaObject(outcomeRows),fixtureOutcomeSha,
  'a changed or swapped result escaped the aggregate counts');
 const counts={};
 for(const row of packet.cases){
  assert.equal(row.expected_status,row.observed_status,
   'runner output does not agree with its own expected verdict: '+row.name);
  assert.equal(row.full_factuality_certified,false);
  assert.equal(row.user_color==='white'||row.user_color==='black',true);
  assert(typeof row.summary==='string'&&typeof row.moment==='string');
  assert(['not_evaluated','partial_claims_verified','limited_claims_passed','rejected']
   .includes(row.observed_status));
  assert(Number.isSafeInteger(row.verified_count)&&row.verified_count>=0&&row.verified_count<=2);
  assert(Array.isArray(row.verified_types)&&row.verified_types.length===row.verified_count);
  assert(Array.isArray(row.findings)&&Array.isArray(row.unassessed));
  if(row.observed_status==='not_evaluated')assert.equal(row.verified_count,0);
  if(row.observed_status==='limited_claims_passed'){
   assert(row.verified_count>0);assert.deepEqual(row.findings,[]);
   assert.deepEqual(row.unassessed,[]);
  }
  if(row.observed_status==='partial_claims_verified'){
   assert(row.verified_count>0);assert(row.unassessed.length>0);
   assert.deepEqual(row.findings,[]);
  }
  if(row.observed_status==='rejected')assert(row.findings.length>0);
  counts[row.observed_status]=(counts[row.observed_status]||0)+1;
 }
 assert.deepEqual(counts,{not_evaluated:51,partial_claims_verified:7,
  rejected:6,limited_claims_passed:4});
 assert.deepEqual(packet.counts,counts);
 const index=new Map(packet.cases.map(x=>[x.name,x]));
 for(const [name,expected,reason,n] of reference){
  const row=index.get(name);
  assert(row,'independent gold reference case missing: '+name);
  assert.equal(row.observed_status,expected,name);
  assert.equal(row.verified_count,n,name);
  if(reason)assert([...row.unassessed,...row.findings].includes(reason),
   name+' has no independently recorded reason '+reason);
 }
 const falseClaim=index.get('false result if');
 assert.equal(falseClaim.summary,'If White won the game, the result would be different.');
 const direct=index.get('direct contrast direct White false');
 assert.equal(direct.summary,'White won the game.');
 assert.equal(direct.findings.includes('contradicted_game_winner'),true);
 const fakePiece=index.get('conditional piece suppose false');
 assert.equal(fakePiece.moment,"Suppose White's king is on e2.");
 const truePiece=index.get('direct contrast direct actual king');
 assert.equal(truePiece.moment,"White's king is on e1.");
 return {total_cases:68,independent_named_gold_cases:reference.length,
  all_test_inputs_sha256:fixtureInputSha,all_scoped_outcomes_sha256:fixtureOutcomeSha,
  genuine_direct_assertions_rejected:6,
  hypothetical_modal_claims_abstained:51,
  mixed_verified_and_modal_unassessed:7,
  direct_literal_truth_narrowly_verified:4,
  product_coach_factuality_certified:false,release_approved:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const raw=JSON.parse(readFileSync(join(results,'coach-conditional-matrix.json'),'utf8'));
 const checked=verifyCoachConditionalMatrix(raw);
 const knownProduct=JSON.parse(readFileSync(join(results,'real-coach-faults.json'),'utf8'));
 assert.equal(verifyCoachProvenanceEvidence(knownProduct).real_pipeline_false_winner_in_output,true);
 const files=[
  'scripts/review-benchmark-coach-claim-adapter.mjs',
  'scripts/review-benchmark-coach-conditional-matrix.mjs',
  'scripts/review-benchmark-coach-conditional-proof.mjs',
  'scripts/review-benchmark-coach-conditional-negatives.mjs',
  'scripts/review-benchmark-coach-conditional-boundary.mjs',
 ];
 const report={schema_version:1,at_utc:new Date().toISOString(),
  own_branch:'agent/review-benchmark-20261111',
  prior_head:'d75a77c1377b482b39e80b3329fb826ef5938aed',
  current_checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  candidate_b_sha:raw.candidate_b_sha,fixture_id:raw.fixture_id,
  manifest_sha256:manifestSha,
  current_qa_run_id:raw.run_id,prior_real_coach_run_id:knownProduct.benchmark_run_id,
  source_hashes:Object.fromEntries(files.map(file=>[file,sha(join(root,file))])),
  scope_verification:checked,
  raw_evidence_ignored:true,full_factuality_certified:false,
  product_release_approved:false,integration_approved:false,
  limitations:['One four-ply self-authored game; finite explicit English modal claims only',
   'Only standalone and specified sentence-local conditionals; no general language model or logical entailment',
   'No new external model, real user games, production database, sealed human holdout or deployment',
   'Older backend accepts the two previously injected false claims; this checkpoint fixes only QA interpretation']};
 const destination=join(qa,'certification-summary-checkpoint26.json');
 writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:destination,...checked},null,2));
}
