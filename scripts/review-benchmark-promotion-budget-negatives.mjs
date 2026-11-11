#!/usr/bin/env node
/** Sabotage independent source/prose evidence, including false green on a
 * three-rook/eight-pawn FEN and false rejection after a pawn disappears. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyPromotionBudgetEvidence} from './review-benchmark-promotion-budget-proof.mjs';

const original=JSON.parse(readFileSync('qa/review-excellence/results/coach-promotion-budget-matrix.json','utf8'));
assert.equal(verifyPromotionBudgetEvidence(original).independently_adjudicated_verdicts,108);
function row(p,name,change){
 const x=p.cases.find(z=>z.name===name);
 assert(x,'bad control did not locate '+name);
 change(x);
}
const attacks=[
 ['substitute original checkpoint',p=>p.previous_checkpoint='f'.repeat(40)],
 ['substitute Agent B',p=>p.pinned_agent_b='f'.repeat(40)],
 ['substitute manifest',p=>p.manifest_sha256='f'.repeat(64)],
 ['substitute original fixture',p=>p.original_fixture='private-game'],
 ['reused nonUUID evidence',p=>p.run_id='before'],
 ['misstate data provenance',p=>p.provenance='real user game with known outcome'],
 ['claim retrograde certification',p=>p.no_retrograde_certification=false],
 ['false external model calls',p=>p.real_model_requests=4],
 ['false engine calls',p=>p.stockfish_calls=10],
 ['unearned full factuality',p=>p.full_factuality_certified=true],
 ['unearned release',p=>p.release_approved=true],
 ['remove source fixture',p=>p.source_games=35],
 ['remove case',p=>p.cases.pop()],
 ['false case total',p=>p.case_count=107],
 ['duplicate a case',p=>p.cases[1].name=p.cases[0].name],
 ['hide rejected count',p=>p.counts.invalid_input=50],
 ['hide abstentions',p=>p.counts.not_evaluated=56],
 ['replace raw source SHA',p=>row(p,'white-8p-three-rooks / white-winner',
  r=>r.source_sha256='f'.repeat(64))],
 ['change raw PGN but keep source SHA',p=>row(p,'white-8p-three-rooks / white-winner',
  r=>r.source_pgn=r.source_pgn.replace('RRR5','RR6'))],
 ['change source pawn count',p=>row(p,'white-8p-three-rooks / white-winner',
  r=>r.pawn_count=7)],
 ['misrepresent color',p=>row(p,'black-8p-three-rooks / white-winner',
  r=>r.source_side='w')],
 ['rewrite source pieces',p=>row(p,'white-8p-three-rooks / white-winner',
  r=>r.source_pieces='RR')],
 ['change original FEN with same PGN',p=>row(p,'white-8p-three-rooks / white-winner',
  r=>r.initial_fen='7k/8/8/8/8/RRR5/PPPPPPP1/4K3 w - - 0 1')],
 ['illegal three rooks eight pawns falsely accepted',p=>row(p,'white-8p-three-rooks / white-winner',r=>{
  r.observed_status=r.expected_status='not_evaluated';
  r.findings=[];r.unassessed=['nonterminal_result_not_independently_verified'];
 })],
 ['valid three rooks seven pawns falsely rejected',p=>row(p,'white-7p-three-rooks / white-winner',r=>{
  r.observed_status=r.expected_status='invalid_input';
  r.findings=[{reason:'source_start_position_impossible',detail:'missing_pawn_promotion_budget'}];
 })],
 ['four rooks with six pawns falsely rejected',p=>row(p,'white-6p-four-rooks / white-winner',
  r=>r.observed_status='invalid_input')],
 ['3 knights 8 pawns falsely accepted',p=>row(p,'white-8p-three-knights / black-winner',
  r=>r.findings=[])],
 ['3 queens 7 pawns falsely accepted',p=>row(p,'white-7p-three-queens / black-winner',
  r=>r.observed_status='not_evaluated')],
 ['2 queens 7 pawns falsely rejected',p=>row(p,'white-7p-two-queens / no-claim',
  r=>r.expected_status='invalid_input')],
 ['2 same-color bishops 8 pawns accepted',p=>row(p,'white-8p-two-same-color-bishops / white-winner',r=>{
  r.observed_status=r.expected_status='not_evaluated';r.findings=[];
 })],
 ['2 opposite-color bishops 8 pawns refused',p=>row(p,'white-8p-two-opposite-color-bishops / white-winner',r=>{
  r.observed_status=r.expected_status='invalid_input';
  r.findings=[{reason:'source_start_position_impossible',detail:'missing_pawn_promotion_budget'}];
 })],
 ['3 same bishops 7 pawns accepted',p=>row(p,'white-7p-three-same-color-bishops / no-claim',
  r=>r.findings=[])],
 ['3 same bishops 6 pawns refused',p=>row(p,'white-6p-three-same-color-bishops / black-winner',
  r=>r.observed_status='invalid_input')],
 ['3 mixed bishops 8 pawns accepted',p=>row(p,'white-8p-three-mixed-color-bishops / no-claim',
  r=>r.observed_status='not_evaluated')],
 ['3 mixed bishops 7 pawns refused',p=>row(p,'white-7p-three-mixed-color-bishops / no-claim',
  r=>r.findings=[{reason:'source_start_position_impossible',detail:'missing_pawn_promotion_budget'}])],
 ['seven pawns insufficient for Q2R3',p=>row(p,'white-7p-two-queens-three-rooks / black-winner',
  r=>r.observed_status='not_evaluated')],
 ['six pawns enough for Q2R3',p=>row(p,'white-6p-two-queens-three-rooks / white-winner',
  r=>r.observed_status='invalid_input')],
 ['six pawns insufficient for Q3R3',p=>row(p,'white-6p-three-queens-three-rooks / white-winner',
  r=>r.findings=[])],
 ['five pawns enough for Q3R3',p=>row(p,'white-5p-three-queens-three-rooks / black-winner',
  r=>r.observed_status='invalid_input')],
 ['black same-color bishops omitted',p=>row(p,'black-8p-two-same-color-bishops / no-claim',
  r=>r.observed_status='not_evaluated')],
 ['black opposite source fabricated',p=>row(p,'black-7p-two-same-color-bishops / black-winner',
  r=>r.findings=[{reason:'source_start_position_impossible',detail:'missing_pawn_promotion_budget'}])],
 ['black three rooks omitted',p=>row(p,'black-8p-three-rooks / no-claim',
  r=>r.findings=[])],
 ['black three rooks allowed with missing pawn falsely refused',p=>row(p,'black-7p-three-rooks / no-claim',
  r=>r.expected_status='invalid_input')],
 ['false approved claim after valid FEN',p=>row(p,'black-7p-three-knights / black-winner',r=>{
  r.expected_status=r.observed_status='limited_claims_passed';
  r.verified=[{field:'summary',type:'game_result'}];
 })],
 ['invent valid game proof for incomplete PGN',p=>row(p,'white-7p-three-rooks / white-winner',r=>{
  r.verified=[{field:'summary',type:'game_result'}];
 })],
 ['remove source uncertainty',p=>row(p,'white-0p-three-queens / no-claim',r=>r.unassessed=[])],
 ['unearned individual full factuality',p=>row(p,'white-7p-three-knights / black-winner',r=>r.full_factuality_certified=true)],
 ['false strict PGN loader rejection',p=>row(p,'white-8p-three-rooks / no-claim',
  r=>r.baseline_strict_pgn_loaded=false)],
 ['swap two different PGN sources',p=>{
  const a=p.cases.find(r=>r.name==='white-8p-three-rooks / no-claim');
  const b=p.cases.find(r=>r.name==='black-7p-two-queens / no-claim');
  assert.notEqual(a.source_sha256,b.source_sha256);
  [a.source_pgn,b.source_pgn]=[b.source_pgn,a.source_pgn];
 }],
 ['balanced swap of false rejected and approved individual cases',p=>{
  const a=p.cases.find(r=>r.name==='white-8p-three-rooks / white-winner');
  const b=p.cases.find(r=>r.name==='white-7p-three-rooks / white-winner');
  a.expected_status=a.observed_status='not_evaluated';a.findings=[];
  a.unassessed=['nonterminal_result_not_independently_verified'];
  b.expected_status=b.observed_status='invalid_input';
  b.findings=[{reason:'source_start_position_impossible',detail:'missing_pawn_promotion_budget'}];
  b.unassessed=[];
 }],
];
let rejected=0;
for(const [description,mutate] of attacks){
 const bad=structuredClone(original);mutate(bad);
 assert.throws(()=>verifyPromotionBudgetEvidence(bad),undefined,
  'forged promotion-budget packet falsely green: '+description);
 rejected++;
}
console.log(JSON.stringify({genuine_108_case_packet_accepted:true,
  forged_evidence_packets_rejected:rejected,
  extra_piece_with_no_missing_pawn_false_green_blocked:true,
  correct_abstention_not_called_historically_proven:true,
  release_approved:false}));
