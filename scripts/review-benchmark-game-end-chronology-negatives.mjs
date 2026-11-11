#!/usr/bin/env node
/** Try forged source chronology and bogus winner proofs against independent
 * SAN-replaying certification. Never touch user data or run a real engine. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyGameEndChronology} from './review-benchmark-game-end-chronology-proof.mjs';

const pristine=JSON.parse(readFileSync('qa/review-excellence/results/game-end-chronology-matrix.json','utf8'));
assert.equal(verifyGameEndChronology(pristine).claim_cases,88);
function change(packet,name,edit){
 const row=packet.cases.find(r=>r.name===name);
 assert(row,'hostile mutation targeting a missing case: '+name);
 edit(row);
}
const injected=[
 ['fake checkpoint SHA',p=>p.prior_checkpoint='f'.repeat(40)],
 ['fake Agent B SHA',p=>p.pinned_candidate_b='f'.repeat(40)],
 ['fake manifest SHA',p=>p.manifest_sha256='f'.repeat(64)],
 ['private game identifier invented',p=>p.fixture_id='private-user-game'],
 ['invalid run UUID',p=>p.run_id='reused-evidence'],
 ['false release approval',p=>p.release_approved=true],
 ['false full factuality',p=>p.full_factuality_certified=true],
 ['invent external LLM usage',p=>p.real_model_calls=6],
 ['invent Stockfish usage',p=>p.stockfish_calls=12],
 ['claim real games',p=>p.original_synthetic_PGNs=false],
 ['weaken chronology contract',p=>p.chronology_contract='last move only'],
 ['misstate source count',p=>p.source_count=21],
 ['misstate case count',p=>p.case_count=87],
 ['drop a test case',p=>p.cases.pop()],
 ['duplicate a sample identifier',p=>p.cases[0].name=p.cases[1].name],
 ['false invalid count',p=>p.counts.invalid_input=31],
 ['false winner count',p=>p.counts.limited_claims_passed=9],
 ['changed source PGN but old hash',p=>change(p,'fivefold-then-mate / white-winner',
  r=>r.source_pgn=r.source_pgn.replace('Qh4#','Qh5'))],
 ['replace raw source hash',p=>change(p,'fivefold-plus-quiet / no-claim',
  r=>r.source_sha256='f'.repeat(64))],
 ['hide last extra move',p=>change(p,'fivefold-then-mate / black-winner',r=>r.plies=16)],
 ['hide original source identity',p=>change(p,'seventy-five-plus-one / no-claim',
  r=>r.source='seventy-five-exact')],
 ['swap two different raw PGNs',p=>{
  const a=p.cases.find(r=>r.name==='fivefold-exact / no-claim');
  const b=p.cases.find(r=>r.name==='fivefold-then-mate / no-claim');
  assert.notEqual(a.source_sha256,b.source_sha256);
  [a.source_pgn,b.source_pgn]=[b.source_pgn,a.source_pgn];
 }],
 ['post-fivefold checkmate promoted to a win',p=>change(p,'fivefold-then-mate / black-winner',r=>{
  r.observed_status=r.expected_status='limited_claims_passed';
  r.issue=null;r.findings=[];r.verified=['game_result'];
 })],
 ['post-fivefold wrong winner falsely rejected',p=>change(p,'fivefold-then-mate / white-winner',r=>{
  r.observed_status=r.expected_status='rejected';
  r.issue=null;r.findings=['contradicted_game_winner'];
 })],
 ['post-sixfold winner falsely certified',p=>change(p,'sixfold-then-mate / black-perspective',r=>{
  r.observed_status=r.expected_status='limited_claims_passed';
  r.issue=null;r.findings=[];r.verified=['game_result'];
 })],
 ['wrong first fivefold ending ply',p=>change(p,'fivefold-then-mate / black-winner',
  r=>r.issue.first_ending_ply=20)],
 ['wrong fivefold ending kind',p=>change(p,'fivefold-then-mate / black-winner',
  r=>r.issue.ending_kind='checkmate')],
 ['wrong fivefold later count',p=>change(p,'fivefold-then-mate / black-winner',
  r=>r.issue.later_moves=0)],
 ['invent different first ending in source metadata',p=>change(p,'fivefold-plus-quiet / black-winner',
  r=>r.expected_first_ending_ply=17)],
 ['wrong quiet continuation later count',p=>change(p,'fivefold-plus-two / white-winner',
  r=>r.expected_later_moves=1)],
 ['fivefold terminal game falsely invalid',p=>change(p,'fivefold-exact / no-claim',r=>{
  r.observed_status=r.expected_status='invalid_input';
  r.issue={reason:'source_continues_after_automatic_game_end',first_ending_ply:16,
   ending_kind:'fivefold_repetition',later_moves:0};
 })],
 ['claimable third repetition treated terminal',p=>change(p,'threefold-then-mate / black-winner',r=>{
  r.observed_status=r.expected_status='invalid_input';
  r.issue={reason:'source_continues_after_automatic_game_end',first_ending_ply:8,
   ending_kind:'threefold_repetition',later_moves:4};
 })],
 ['claimable fourth repetition treated terminal',p=>change(p,'fourfold-then-mate / black-winner',r=>{
  r.observed_status=r.expected_status='invalid_input';
  r.issue={reason:'source_continues_after_automatic_game_end',first_ending_ply:12,
   ending_kind:'fourfold_repetition',later_moves:4};
 })],
 ['150 move terminal falsely invalid',p=>change(p,'seventy-five-exact / no-claim',r=>{
  r.observed_status=r.expected_status='invalid_input';
  r.issue={reason:'source_continues_after_automatic_game_end',first_ending_ply:150,
   ending_kind:'seventy_five_move_rule',later_moves:0};
 })],
 ['151 move continuation falsely clean',p=>change(p,'seventy-five-plus-one / no-claim',r=>{
  r.observed_status=r.expected_status='not_evaluated';
  r.issue=null;r.findings=[];
 })],
 ['152 move continuation wrong first ply',p=>change(p,'seventy-five-plus-two / black-winner',
  r=>r.issue.first_ending_ply=152)],
 ['152 move continuation wrong later count',p=>change(p,'seventy-five-plus-two / black-winner',
  r=>r.issue.later_moves=1)],
 ['15-move false history in long game',p=>change(p,'seventy-five-plus-one / no-claim',
  r=>r.source_pgn=r.source_pgn.replace(/75\. [^ ]+ [^ ]+/,''))],
 ['initial dead game already "lost"',p=>change(p,'dead-initial-exact / white-winner',r=>{
  r.observed_status=r.expected_status='limited_claims_passed';
  r.findings=[];r.verified=['game_result'];
 })],
 ['initial dead game continued erroneously accepted',p=>change(p,'dead-initial-plus-one / white-winner',r=>{
  r.observed_status=r.expected_status='rejected';
  r.issue=null;r.findings=['contradicted_terminal_draw_winner'];
 })],
 ['dead position first ply erased',p=>change(p,'dead-initial-plus-one / no-claim',
  r=>r.issue.first_ending_ply=1)],
 ['capture ends dead position erroneously invalid',p=>change(p,'dead-capture-exact / black-winner',r=>{
  r.observed_status=r.expected_status='invalid_input';
  r.issue={reason:'source_continues_after_automatic_game_end',first_ending_ply:1,
   ending_kind:'dead_position',later_moves:0};
 })],
 ['continued dead-position source allowed',p=>change(p,'dead-capture-plus-one / black-perspective',r=>{
  r.observed_status=r.expected_status='not_evaluated';
  r.issue=null;r.findings=[];
 })],
 ['changed source PGN initial dead setup',p=>change(p,'dead-initial-exact / white-winner',r=>{
  r.source_pgn=r.source_pgn.replace('K6k','K5rk');
 })],
 ['valid stalemate at last move falsely called invalid',p=>change(p,'stalemate-exact / no-claim',r=>{
  r.observed_status=r.expected_status='invalid_input';
  r.issue={reason:'source_continues_after_automatic_game_end',first_ending_ply:1,
   ending_kind:'stalemate',later_moves:0};
 })],
 ['checkmate at last move falsely refused',p=>change(p,'fools-mate / black-winner',r=>{
  r.observed_status=r.expected_status='invalid_input';
  r.issue={reason:'source_continues_after_automatic_game_end',first_ending_ply:4,
   ending_kind:'checkmate',later_moves:0};
 })],
 ['checkmate from starting FEN falsely refused',p=>change(p,'mate-from-fen / black-winner',r=>{
  r.observed_status=r.expected_status='invalid_input';
  r.issue={reason:'source_continues_after_automatic_game_end',first_ending_ply:0,
   ending_kind:'checkmate',later_moves:0};
 })],
 ['unverified 3fold outcome called checked win',p=>change(p,'threefold-then-quiet / black-winner',r=>{
  r.observed_status=r.expected_status='limited_claims_passed';r.verified=['game_result'];
 })],
 ['unverified 4fold outcome called checked loss',p=>change(p,'fourfold-then-quiet / white-winner',r=>{
  r.observed_status=r.expected_status='rejected';r.findings=['contradicted_game_winner'];
 })],
 ['invented full prose certification',p=>change(p,'fourfold-then-mate / black-winner',
  r=>r.full_factuality_certified=true)],
 ['aggregate-preserving two-outcome swap',p=>{
  const a=p.cases.find(r=>r.name==='fivefold-then-mate / black-winner');
  const b=p.cases.find(r=>r.name==='fourfold-then-mate / black-winner');
  a.observed_status=a.expected_status='limited_claims_passed';a.issue=null;
  a.findings=[];a.verified=['game_result'];
  b.observed_status=b.expected_status='invalid_input';
  b.issue={reason:'source_continues_after_automatic_game_end',
   first_ending_ply:12,ending_kind:'fourfold_repetition',later_moves:4};
  b.findings=['source_continues_after_automatic_game_end'];b.verified=[];
 }],
];
let caught=0;
for(const [name,mutate] of injected){
 const copy=structuredClone(pristine);
 mutate(copy);
 assert.throws(()=>verifyGameEndChronology(copy),undefined,
  'independent proof accepted intentionally forged source evidence: '+name);
 caught++;
}
console.log(JSON.stringify({genuine_88_case_packet_accepted:true,
  falsified_terminal_history_packets_rejected:caught,
  fifth_repetition_overrides_later_mate:true,
  prior_dead_position_fixture_replaced:true,
  product_release_approved:false}));
