#!/usr/bin/env node
/** Fail-closed adversarial evidence controls against false gold FEN/PGN
 * acceptance, invented source legality, and summary-level row substitutions.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifySourceFENMatrix} from './review-benchmark-start-fen-proof.mjs';

const original=JSON.parse(readFileSync('qa/review-excellence/results/coach-start-fen-matrix.json','utf8'));
assert.equal(verifySourceFENMatrix(original).case_count,99);
const edit=(packet,name,callback)=>{
 const row=packet.cases.find(x=>x.name===name);
 assert(row,'missing test case '+name);
 callback(row);
};
const attacks=[
 ['fake preceding HEAD',x=>x.prior_checkpoint='f'.repeat(40)],
 ['fake frozen Agent B',x=>x.pinned_candidate_b='f'.repeat(40)],
 ['fake original manifest SHA',x=>x.manifest_sha256='f'.repeat(64)],
 ['fake originating PGN',x=>x.fixture_id='user-private-game'],
 ['fake historical run ID',x=>x.run_id='last run'],
 ['false release approved',x=>x.release_approved=true],
 ['false product factuality approved',x=>x.product_factuality_certified=true],
 ['fabricate model calls',x=>x.external_model_calls=1],
 ['fabricate engine calls',x=>x.stockfish_calls=1],
 ['disguise real customer PGN as synthetic',x=>x.all_pgNs_self_authored=false],
 ['false unrestricted FEN certification',x=>x.scope='all possible chess positions certified'],
 ['drop one of 33 sources',x=>x.source_count=32],
 ['fake number invalid sources',x=>x.invalid_source_count=19],
 ['fake number valid sources',x=>x.accepted_source_count=14],
 ['drop one assertion',x=>x.cases.pop()],
 ['fake sample count',x=>x.case_count=98],
 ['duplicate a control',x=>x.cases[0].name=x.cases[1].name],
 ['counterfeit status summary',x=>x.counts.invalid_input=59],
 ['source SHA mismatch',x=>edit(x,'invalid-adjacent-kings-white / white-winner',r=>r.source_sha256='f'.repeat(64))],
 ['replace source PGN with a different legal start',x=>edit(x,'invalid-adjacent-kings-white / white-winner',r=>{
  r.source_pgn=r.source_pgn.replace('4k3/4K3','4k3/4K2R');
 })],
 ['replace setup tag without source hash',x=>edit(x,'valid-white-in-check / white-winner',r=>r.original_setup_fen='4k3/8/8/8/8/8/8/4K3 w - - 0 1')],
 ['swap source PGN between two controls',x=>{
  // A previous mutation accidentally chose two rows from the SAME source;
  // exchanging identical PGNs cannot falsify any evidence and is not a
  // meaningful negative control. Deliberately swap DIFFERENT source games.
  const a=x.cases.find(r=>r.name==='invalid-adjacent-kings-white / white-winner');
  const b=x.cases.find(r=>r.name==='valid-white-in-check / white-winner');
  assert.notEqual(a.source_sha256,b.source_sha256);
  [a.source_pgn,b.source_pgn]=[b.source_pgn,a.source_pgn];
 }],
 ['strict loader result misreported',x=>edit(x,'invalid-checked-nonmoving-black / white-winner',r=>r.baseline_strict_chessjs_accepted=false)],
 ['wrong result side to move',x=>edit(x,'valid-white-in-check / white-winner',r=>r.summary='Black won the game.')],
 ['wrong correct source label',x=>edit(x,'valid-capturable-en-passant / white-winner',r=>r.source_kind='invalid')],
 ['invalid FEN falsely marked as good',x=>edit(x,'invalid-adjacent-kings-white / white-winner',r=>{
  r.expected_status='not_evaluated';r.actual_status='not_evaluated';
  r.error_reason=null;r.error_detail=null;r.unassessed=['nonterminal_result_not_independently_verified'];
 })],
 ['invalid FEN incorrectly labeled as chess draw',x=>edit(x,'invalid-adjacent-kings-white / white-winner',r=>{
  r.expected_status='rejected';r.actual_status='rejected';r.error_reason='contradicted_terminal_draw_winner';r.error_detail=null;
 })],
 ['valid checked mover treated impossible',x=>edit(x,'valid-white-in-check / white-winner',r=>{
  r.expected_status='invalid_input';r.actual_status='invalid_input';r.error_reason='source_start_position_impossible';r.error_detail='king_of_side_not_to_move_in_check';r.unassessed=[];
 })],
 ['valid Black checked mover treated impossible',x=>edit(x,'valid-black-in-check / white-winner',r=>{
  r.expected_status='invalid_input';r.actual_status='invalid_input';r.error_reason='source_start_position_impossible';r.error_detail='king_of_side_not_to_move_in_check';r.unassessed=[];
 })],
 ['ghost castle called legitimate',x=>edit(x,'invalid-black-kingside-rook-missing / black-winner',r=>{
  r.expected_status='not_evaluated';r.actual_status='not_evaluated';r.error_reason=r.error_detail=null;
 })],
 ['valid blocked castle flagged',x=>edit(x,'valid-blocked-castling / white-winner',r=>{
  r.expected_status='invalid_input';r.actual_status='invalid_input';r.error_reason='source_start_position_impossible';r.error_detail='castling_rights_without_home_king_and_rook';r.unassessed=[];
 })],
 ['legal pinned en passant flagged',x=>edit(x,'valid-pinned-en-passant / white-winner',r=>r.error_detail='en_passant_target_without_previous_double_pawn_push')],
 ['ghost en passant promoted to positive',x=>edit(x,'invalid-en-passant-no-black-pawn / white-winner',r=>r.error_reason=null)],
 ['nine white pawns accepted',x=>edit(x,'invalid-nine-white-pawns / white-winner',r=>r.actual_status='not_evaluated')],
 ['17 black pieces accepted',x=>edit(x,'invalid-seventeen-black-units / white-winner',r=>r.actual_status='not_evaluated')],
 ['false language-wide certification',x=>edit(x,'valid-standard-opening / white-winner',r=>r.full_factuality_certified=true)],
 ['invent verified claim on invalid source',x=>edit(x,'invalid-adjacent-kings-black / black-winner',r=>r.verified_count=1)],
 ['invent verified claim on valid nonterminal source',x=>edit(x,'valid-uncapturable-en-passant / black-winner',r=>r.verified_count=1)],
 ['erase uncertainty on valid nonterminal source',x=>edit(x,'valid-standard-start / black-winner',r=>r.unassessed=[])],
 ['unselected verdict swap preserving totals',x=>{
  const a=x.cases.find(r=>r.name==='invalid-checked-nonmoving-black-with-move / no-prose');
  const b=x.cases.find(r=>r.name==='valid-black-turn-no-check / no-prose');
  [a.expected_status,a.actual_status,a.error_reason,a.error_detail,a.unassessed]=
   ['not_evaluated','not_evaluated',null,null,['nonterminal_result_not_independently_verified']];
  [b.expected_status,b.actual_status,b.error_reason,b.error_detail,b.unassessed]=
   ['invalid_input','invalid_input','source_start_position_impossible','king_of_side_not_to_move_in_check',[]];
 }],
 ['fraudulent source SHA in non-gold extra',x=>edit(x,
  'valid-three-white-queens-with-missing-pawns / no-prose',r=>r.source_sha256='f'.repeat(64))],
];
let rejected=0;
for(const [name,mutate] of attacks){
 const forged=structuredClone(original);mutate(forged);
 assert.throws(()=>verifySourceFENMatrix(forged),undefined,'false green accepted: '+name);
 rejected++;
}
console.log(JSON.stringify({genuine_99_case_packet_accepted:true,
  forged_evidence_packets_rejected:rejected,
  impossible_starting_chess_positions_not_trusted:true,
  product_factuality_certified:false,release_approved:false}));
