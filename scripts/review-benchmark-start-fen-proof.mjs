#!/usr/bin/env node
/** Agent D independent boundary proof for 33 syntactically valid but not
 * necessarily reachable standard chess starts. Does not import the finite
 * claim adapter. Uses chess.js isAttacked, rather than flipping-turn isCheck.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Chess} from 'chess.js';
import {verifyCoachProvenanceEvidence} from './review-benchmark-coach-provenance-proof.mjs';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const results=join(qa,'results');
const hash=data=>createHash('sha256').update(data).digest('hex');
const hashFile=file=>hash(readFileSync(file));
const hashJSON=data=>hash(JSON.stringify(data));
const idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const manifestSha='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
const fixedInputs='50d2810a1ba4d8909e7d3fa31a35ccf776c10b533053bfb8fb6d6ac2a55476e3';
const fixedOutputs='64414e1e11dc843afd128c0b2472f59b93c899826796066394dbd35b4de8e6a4';
const fixedSources='7084b080296fd0ff9bb5de9ffc1deca0b015cb7e107e946a11960594d5ba1402';
const manifestFile=join(qa,'manifests/manifest-v2.jsonl');
assert.equal(hashFile(manifestFile),manifestSha);
const baseline=readFileSync(manifestFile,'utf8').trim().split('\n').map(JSON.parse)
 .find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(baseline?.license==='self-authored'&&baseline.source_kind==='synthetic');
assert.equal(hashFile(join(qa,'fixtures',baseline.pgn_file)),baseline.pgn_sha256);
const reasons={
 king:'king_of_side_not_to_move_in_check',
 castle:'castling_rights_without_home_king_and_rook',
 pawn:'more_than_eight_pawns_per_side',
 pieces:'more_than_sixteen_pieces_per_side',
 ep:'en_passant_target_without_previous_double_pawn_push',
};
// Frozen independently named QA gold. Source proves only NECESSARY legality
// invariants; a valid entry isn't a certification of full retrograde reach.
const gold=[
 ['invalid-adjacent-kings-white',reasons.king],
 ['invalid-adjacent-kings-black',reasons.king],
 ['invalid-checked-nonmoving-black',reasons.king],
 ['invalid-checked-nonmoving-white',reasons.king],
 ['invalid-both-kings-attacked',reasons.king],
 ['invalid-checked-nonmoving-black-with-move',reasons.king],
 ['invalid-white-kingside-rook-missing',reasons.castle],
 ['invalid-white-queenside-rook-missing',reasons.castle],
 ['invalid-black-kingside-rook-missing',reasons.castle],
 ['invalid-black-queenside-rook-missing',reasons.castle],
 ['invalid-moved-white-king-with-K-right',reasons.castle],
 ['invalid-moved-black-king-with-k-right',reasons.castle],
 ['invalid-nine-white-pawns',reasons.pawn],
 ['invalid-nine-black-pawns',reasons.pawn],
 ['invalid-seventeen-white-units',reasons.pieces],
 ['invalid-seventeen-black-units',reasons.pieces],
 ['invalid-en-passant-no-black-pawn',reasons.ep],
 ['invalid-en-passant-no-white-pawn',reasons.ep],
 ['invalid-en-passant-source-not-empty',reasons.ep],
 ['invalid-en-passant-target-occupied',reasons.ep],
 ['valid-standard-opening',null],
 ['valid-standard-start',null],
 ['valid-white-in-check',null],
 ['valid-black-in-check',null],
 ['valid-uncapturable-en-passant',null],
 ['valid-capturable-en-passant',null],
 ['valid-pinned-en-passant',null],
 ['valid-both-sides-castling',null],
 ['valid-blocked-castling',null],
 ['valid-white-eight-pawns',null],
 ['valid-black-eight-pawns',null],
 ['valid-three-white-queens-with-missing-pawns',null],
 ['valid-black-turn-no-check',null],
];
const goldMap=new Map(gold);
assert.equal(goldMap.size,33);

function independentSourceIssue(fen){
 const board=new Chess(fen);
 const all=board.board().flat().filter(Boolean);
 // Use an independent parsing/adjudication path from the tested checker:
 // locate each attackable king and use chess.js isAttacked(square,color).
 for(const color of ['w','b']){
  if(all.filter(x=>x.color===color).length>16)return reasons.pieces;
  if(all.filter(x=>x.color===color&&x.type==='p').length>8)return reasons.pawn;
 }
 const [position,turn,rights,ep]=fen.split(' ');
 assert(position&&rights&&ep&&['w','b'].includes(turn));
 for(const [flag,kingAt,rookAt,color] of [
  ['K','e1','h1','w'],['Q','e1','a1','w'],
  ['k','e8','h8','b'],['q','e8','a8','b']]){
  if(!rights.includes(flag))continue;
  if(board.get(kingAt)?.type!=='k'||board.get(kingAt)?.color!==color||
    board.get(rookAt)?.type!=='r'||board.get(rookAt)?.color!==color)
   return reasons.castle;
 }
 if(ep!=='-'){
  const rank=turn==='w'?'6':'3',pawnRank=turn==='w'?'5':'4';
  const previousRank=turn==='w'?'7':'2',enemy=turn==='w'?'b':'w';
  const mover=board.get(ep[0]+pawnRank);
  if(ep[1]!==rank||mover?.type!=='p'||mover.color!==enemy||
   board.get(ep)||board.get(ep[0]+previousRank))return reasons.ep;
 }
 const other=turn==='w'?'b':'w';
 const protectedKing=all.find(x=>x.type==='k'&&x.color===other);
 assert(protectedKing,'validated FEN lacks nonmoving king');
 if(board.isAttacked(protectedKing.square,turn))return reasons.king;
 return null;
}

export function verifySourceFENMatrix(raw){
 assert.equal(raw.schema_version,1);
 assert(idPattern.test(raw.run_id||''),'no fresh synthetic QA run identity');
 assert.equal(raw.prior_checkpoint,'8175071497ae695c4d876f02079a2c16ff7187f8');
 assert.equal(raw.pinned_candidate_b,'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87');
 assert.equal(raw.fixture_id,baseline.fixture_id);
 assert.equal(raw.manifest_sha256,manifestSha);
 assert.equal(raw.scope,
  'Necessary setup legality invariants only, not general retrograde reachability certification');
 assert.equal(raw.all_pgNs_self_authored,true);
 assert.equal(raw.external_model_calls,0);
 assert.equal(raw.stockfish_calls,0);
 assert.equal(raw.product_factuality_certified,false);
 assert.equal(raw.release_approved,false);
 assert.equal(raw.source_count,33);
 assert.equal(raw.invalid_source_count,20);
 assert.equal(raw.accepted_source_count,13);
 assert.equal(raw.case_count,99);
 assert(Array.isArray(raw.cases)&&raw.cases.length===99);
 assert.equal(new Set(raw.cases.map(x=>x.name)).size,99);
 const inputs=raw.cases.map(x=>[x.name,x.source_name,x.source_sha256,x.original_setup_fen,x.summary]);
 const outputs=raw.cases.map(x=>[x.name,x.actual_status,x.error_reason,x.error_detail,x.unassessed,x.verified_count]);
 assert.equal(hashJSON(inputs),fixedInputs,'unreviewed or swapped source inputs');
 assert.equal(hashJSON(outputs),fixedOutputs,'individual evidence packet verdicts altered');
 const sources=[...new Map(raw.cases.map(x=>[x.source_name,x.source_sha256])).entries()]
  .sort((a,b)=>a[0].localeCompare(b[0]));
 assert.equal(hashJSON(sources),fixedSources,'source identity list drift');
 const seen=new Map(),counts={};
 for(const item of raw.cases){
  assert.equal(item.source_sha256,hash(item.source_pgn));
  assert.equal(item.baseline_strict_chessjs_accepted,true);
  assert.equal(item.expected_status,item.actual_status);
  assert.equal(item.full_factuality_certified,false);
  assert(item.name.startsWith(item.source_name+' / '));
  assert(['White won the game.','Black won the game.',''].includes(item.summary));
  const game=new Chess();game.loadPgn(item.source_pgn,{strict:true});
  assert.equal(item.old_chessjs_reported_draw,game.isDraw());
  assert.equal(item.original_setup_fen,game.header().SetUp==='1'?game.header().FEN:null);
  const start=item.original_setup_fen||game.history({verbose:true})[0]?.before||game.fen();
  const issue=independentSourceIssue(start);
  assert(goldMap.has(item.source_name),'unexpected unadjudicated candidate '+item.source_name);
  assert.equal(issue,goldMap.get(item.source_name),item.source_name+' was not independently adjudicated');
  if(issue){
   assert.equal(item.source_kind,'invalid');
   assert.equal(item.actual_status,'invalid_input');
   assert.equal(item.error_reason,'source_start_position_impossible');
   assert.equal(item.error_detail,issue);
   assert.equal(item.verified_count,0);
   assert.deepEqual(item.unassessed,[]);
  }else{
   assert.equal(item.source_kind,'valid');
   assert.equal(item.actual_status,'not_evaluated');
   assert.equal(item.error_reason,null);
   assert.equal(item.error_detail,null);
   assert.equal(item.verified_count,0);
   assert(item.unassessed.includes('nonterminal_result_not_independently_verified'));
  }
  if(seen.has(item.source_name))assert.equal(seen.get(item.source_name),item.source_sha256);
  else seen.set(item.source_name,item.source_sha256);
  counts[item.actual_status]=(counts[item.actual_status]||0)+1;
 }
 assert.equal(seen.size,33);
 assert.deepEqual(counts,{invalid_input:60,not_evaluated:39});
 assert.deepEqual(raw.counts,counts);
 return {synthetic_PGNs_replayed:33,case_count:99,
  strict_loader_accepted_invalid_FEN_sources:20,
  invalid_prose_verdicts_blocked:60,
  valid_starts_not_over_rejected:39,
  separately_adjudicated_source_fixtures:gold.length,
  source_inputs_sha256:fixedInputs,
  source_outcomes_sha256:fixedOutputs,
  source_identity_sha256:fixedSources,
  complete_retrograde_legality_proven:false,
  product_factuality_certified:false,release_approved:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const packet=JSON.parse(readFileSync(join(results,'coach-start-fen-matrix.json'),'utf8'));
 const proof=verifySourceFENMatrix(packet);
 const real=JSON.parse(readFileSync(join(results,'real-coach-faults.json'),'utf8'));
 assert.equal(verifyCoachProvenanceEvidence(real).real_pipeline_false_king_location_in_output,true);
 const sources=[
  'scripts/review-benchmark-coach-claim-adapter.mjs',
  'scripts/review-benchmark-start-fen-matrix.mjs',
  'scripts/review-benchmark-start-fen-proof.mjs',
  'scripts/review-benchmark-start-fen-negatives.mjs',
  'scripts/review-benchmark-start-fen-boundary.mjs',
 ];
 const report={schema_version:1,at_utc:new Date().toISOString(),
  own_branch:'agent/review-benchmark-20261111',
  preceding_head:'8175071497ae695c4d876f02079a2c16ff7187f8',
  checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  pinned_candidate_b:'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87',
  current_run_id:packet.run_id,earlier_real_coach_run_id:real.benchmark_run_id,
  independent_evidence:proof,
  source_sha256:Object.fromEntries(sources.map(p=>[p,hashFile(join(root,p))])),
  model_requests_this_checkpoint:0,engine_searches_this_checkpoint:0,
  no_product_source_mutated:true,release_approved:false,integration_approved:false,
  limitations:['Only necessary starting-FEN legality invariants; no complete historical reachability proof',
   'Synthetic source configurations were intentionally impossible and accepted by chess.js strict PGN syntax',
   'Positive FEN examples are not independently proven reachable from standard initial chess',
   'No sealed human-labeled games, real LLM calls, production credentials, database or deployment changes',
   'Prior coach false local-model statements and profile-cache/accessibility blockers remain separate product issues']};
 const path=join(qa,'certification-summary-checkpoint29.json');
 writeFileSync(path,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:path,...proof},null,2));
}
