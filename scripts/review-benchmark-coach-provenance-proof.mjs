#!/usr/bin/env node
/** Agent D checkpoint 24: independent, source-anchored factuality evidence.
 * Successful QA diagnosis != a product factuality or release certification.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Chess} from 'chess.js';
import {validateWrittenGameReview} from './review-benchmark-coach-claim-adapter.mjs';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence');
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const candidateSha='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const engineSha='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const manifestSha='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
const runFormat=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fixture=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8')
 .trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.license==='self-authored'&&fixture.source_kind==='synthetic');
assert.equal(hash(join(qa,'manifests/manifest-v2.jsonl')),manifestSha);
const pgnFile=join(qa,'fixtures',fixture.pgn_file);
const pgn=readFileSync(pgnFile,'utf8');
assert.equal(hash(pgnFile),fixture.pgn_sha256);
const game=new Chess();game.loadPgn(pgn,{strict:true});
assert(game.isCheckmate()&&game.turn()==='w'&&game.header().Result==='0-1');
const moves=game.history({verbose:true});
assert.equal(moves.length,4);
assert.equal(moves[2].san,'g4');
const before=new Chess(moves[2].before),after=new Chess(moves[2].after);
assert.equal(before.get('e1')?.type,'k');assert.equal(after.get('e1')?.type,'k');
assert.notEqual(before.get('e2')?.type,'k');assert.notEqual(after.get('e2')?.type,'k');

export function verifyCoachProvenanceEvidence(raw){
 assert.equal(raw.schema_version,1);
 assert(runFormat.test(raw.benchmark_run_id||''),'real coach subprocess identity is missing');
 assert.equal(raw.candidate_sha,candidateSha);
 assert.equal(raw.engine_sha256,engineSha);
 assert.equal(raw.manifest_sha256,manifestSha);
 assert.equal(raw.fixture_id,fixture.fixture_id);
 assert(/^[0-9a-f]{40}$/.test(raw.benchmark_sha||''));
 assert.equal(raw.scope,'real buildGameReview + llm.ts with controlled local JSON provider, real analyzer Stockfish, disposable SQLite');
 assert.equal(raw.pgm_result,'0-1');
 assert.equal(raw.actual_result,'0-1');
 assert.equal(raw.replay_white_king_e1,true);
 assert.equal(raw.replay_white_king_e2,false);
 assert.equal(raw.key_moment_ply,3);
 assert.equal(raw.coach_prose_version,9);
 assert.equal(raw.candidate_factuality_certified,false);
 assert.equal(raw.false_prose_strings_are_fixture_only,true);
 assert.equal(raw.safe_flow_accepted,true);
 assert.deepEqual(raw.failures,[]);
 assert.equal(raw.requests,6);
 assert(Number.isFinite(raw.elapsed_ms)&&raw.elapsed_ms>0&&raw.elapsed_ms<10000);
 assert.deepEqual(raw.accepted_false_claims,[
  'wrong_game_winner_in_summary','wrong_piece_square_in_key_moment']);
 assert.equal(raw.attack_output.summary,'White won the game.');
 assert.equal(raw.attack_output.key_moments.length,1);
 assert.equal(raw.attack_output.key_moments[0].ply,3);
 assert.equal(raw.attack_output.key_moments[0].prose,"White's king is on e2.");
 assert.equal(raw.attack_output.key_moments[0].title,'Critical moment');
 assert.equal(raw.attack_output.opening,'Your opening accuracy was 31.8% across 4 plies.');

 const neutral=raw.independent_claim_validation.neutral;
 const hostile=raw.independent_claim_validation.hostile;
 assert.equal(neutral.status,'limited_claims_passed');
 assert.deepEqual(neutral.unassessed,[]);
 assert.equal(neutral.verified.length,2);
 assert.deepEqual(neutral.verified.map(x=>x.field),['summary','moment:0']);
 assert.deepEqual(neutral.verified.map(x=>x.type),['game_result','piece_location']);
 assert.deepEqual(neutral.verified.map(x=>x.proof),[
  'replay_checkmate','independent_source_pgn_move_replay']);
 assert.equal(hostile.status,'rejected');
 assert.deepEqual(hostile.unassessed,[]);
 assert.equal(hostile.findings.length,2);
 assert.equal(hostile.findings[0].reason,'contradicted_game_winner');
 assert.equal(hostile.findings[0].field,'summary');
 assert.equal(hostile.findings[0].claim,'White won the game');
 assert.equal(hostile.findings[0].verified_winner,'black');
 assert.equal(hostile.findings[1].reason,'contradicted_piece_location');
 assert.equal(hostile.findings[1].field,'moment:0');
 assert.equal(hostile.findings[1].claim,"White's king is on e2");
 assert.equal(hostile.findings[1].source_ply,3);

 // Recreate the *previous QA false green*: a fabricated but LEGAL position
 // with White's king on e2 and a legal g4 move at a false report ply.
 const unrelated=new Chess();
 for(const san of ['e4','e5','Ke2','Nc6'])unrelated.move(san);
 assert.equal(unrelated.get('e2')?.type,'k');
 assert.equal(unrelated.turn(),'w');
 const fakeMoment={ply:3,side:'white',san:'g4',fen_before:unrelated.fen(),
  prose:"White's king is on e2."};
 const compromised={summary:'Black won the game.',language:'en',
  key_moments:[fakeMoment],phases:{opening:null,middlegame:null,endgame:null}};
 const check=validateWrittenGameReview({pgn,review:compromised,userColor:'white'});
 assert.equal(check.status,'rejected','a legal but unrelated board falsified the actual PGN');
 assert(check.findings.some(x=>x.reason==='moment_board_conflicts_with_source_pgn'));
 assert(!check.verified.some(x=>x.type==='piece_location'),
  'the independent checker still treated the unrelated chessboard as proof');
 assert.equal(check.full_factuality_certified,false);

 const truth={...compromised,key_moments:[{...fakeMoment,
  fen_before:moves[2].before,prose:"Before the move, White's pawn is on g2."}]};
 const good=validateWrittenGameReview({pgn,review:truth});
 assert.equal(good.status,'limited_claims_passed');
 assert(good.verified.some(x=>x.proof==='independent_source_pgn_before_move'));
 const lie={...truth,key_moments:[{...truth.key_moments[0],
  prose:"Before the move, White's pawn is on g4."}]};
 const temporal=validateWrittenGameReview({pgn,review:lie});
 assert.equal(temporal.status,'rejected');
 assert(temporal.findings.some(x=>x.reason==='contradicted_temporal_piece_location'));
 assert.equal(temporal.full_factuality_certified,false);

 return {verifier_reads_recorded_real_pipeline_evidence:true, // Fresh product invocation is separately attested by the boundary runner.
  real_pipeline_false_winner_in_output:true,
  real_pipeline_false_king_location_in_output:true,
  two_true_model_controls_verified:true,
  fabricated_legal_other_game_board_rejected:true,
  false_before_move_assertion_rejected:true,
  source_replayed_without_trusting_report_fen:true,
  supported_claim_count_only:2,
  full_factuality_certified:false,
  release_approved:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const raw=JSON.parse(readFileSync(join(qa,'results/real-coach-faults.json'),'utf8'));
 const verified=verifyCoachProvenanceEvidence(raw);
 const provenanceRun=JSON.parse(execFileSync(process.execPath,
  ['scripts/review-benchmark-coach-provenance-negatives.mjs'],
  {cwd:root,encoding:'utf8'}).trim());
 assert.equal(provenanceRun.verdict,'pass');
 assert.equal(provenanceRun.independent_claim_provenance_controls,58);
 const existingRun=JSON.parse(execFileSync(process.execPath,
  ['scripts/review-benchmark-coach-claim-negative-controls.mjs'],
  {cwd:root,encoding:'utf8'}).trim());
 assert.equal(existingRun.independent_claim_controls,18);
 const ownerLogFile=join(qa,'results/checkpoint24-owner-claim-tests.log');
 const ownerLog=readFileSync(ownerLogFile,'utf8');
 assert(/Test Files\s+2 passed \(2\)/.test(ownerLog));
 assert(/Tests\s+27 passed \(27\)/.test(ownerLog));
 const sourcePaths=[
  'scripts/review-benchmark-coach-claim-adapter.mjs',
  'scripts/review-benchmark-coach-claim-negative-controls.mjs',
  'scripts/review-benchmark-coach-provenance-negatives.mjs',
  'scripts/review-benchmark-real-coach-faults.mjs',
  'scripts/review-benchmark-coach-provenance-proof.mjs',
 ];
 const report={schema_version:1,at_utc:new Date().toISOString(),
  parent_agent_d_commit:'f52f3ff3a1f1882984ef35458b90a34fa8a9dcc0',
  own_branch:'agent/review-benchmark-20261111',
  current_checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  candidate_b_sha:candidateSha,engine_sha256:engineSha,manifest_sha256:manifestSha,
  fixture_id:fixture.fixture_id,source_game_result:'0-1',
  source_white_king_square:'e1',tested_ply:3,tested_played_move:'g4',
  source_kind:'self-authored synthetic',llm_kind:'loopback controlled fake JSON vLLM',
  real_coach_run_id:raw.benchmark_run_id,real_coach_model_requests:raw.requests,
  independent_verification:verified,
  adversarial_claim_controls:provenanceRun.independent_claim_provenance_controls,
  original_claim_controls:existingRun.independent_claim_controls,
  candidate_owner_tests_passed:27,
  owner_log_sha256:hash(ownerLogFile),
  qa_source_sha256:Object.fromEntries(sourcePaths.map(path=>[path,hash(join(root,path))])),
  result:{qa_false_green_proven_closed:true,
   model_output_escapes_still_detected:2,
   candidate_factuality_certified:false,full_coach_factuality_certified:false,
   integration_approved:false,release_approved:false},
  limits:['Checker assesses only narrow English result and owner/piece/square claims',
   'Other-language output, tactical causal claims and nuanced temporal paraphrases remain unassessed',
   'Do not interpret controlled fake LLM text as real hallucination frequency',
   'One self-authored synthetic checkmate; no sealed human-reviewed benchmark',
   'Stockfish 16 depth 8, not a production engine resource/accuracy parity test',
   'No Agent B, C, A, PR #17, production SQLite or deployed model changed']};
 const destination=join(qa,'certification-summary-checkpoint24.json');
 writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:destination,
  independent_qa_controls:report.adversarial_claim_controls,
  original_controls:report.original_claim_controls,
  real_coach_model_calls:raw.requests,
  false_claims_rejected:2,
  candidate_factuality_certified:false,release_approved:false},null,2));
}
