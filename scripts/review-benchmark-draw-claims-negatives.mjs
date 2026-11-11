#!/usr/bin/env node
/** Corrupt synthetically sourced FIDE draw-claim evidence. Fail closed if
 * threefold/50-move claims are wrongly proved or 5fold/75-move forced draws
 * are silently ignored. No real games or model/engine work. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyDrawClaimEvidence} from './review-benchmark-draw-claims-proof.mjs';

const genuine=JSON.parse(readFileSync('qa/review-excellence/results/coach-draw-claims-matrix.json','utf8'));
assert.equal(verifyDrawClaimEvidence(genuine).scope_cases,85);
function alter(p,name,fn){
 const r=p.cases.find(x=>x.name===name);
 assert(r,'missing adversarial control case '+name);fn(r);
}
const bad=[
 ['falsified candidate source',p=>p.candidate_b_source='f'.repeat(40)],
 ['falsified prior SHA',p=>p.previous_checkpoint='f'.repeat(40)],
 ['falsified manifest SHA',p=>p.manifest_sha256='f'.repeat(64)],
 ['reused old run without UUID',p=>p.run_id='stale'],
 ['falsified source fixture',p=>p.fixture_id='private-game'],
 ['falsified rules source',p=>p.rules_reference='claimed draw counts as automatic'],
 ['falsified real game',p=>p.source_kind='real customer game'],
 ['false model call count',p=>p.external_model_calls=1],
 ['false Stockfish job count',p=>p.stockfish_calls=6],
 ['misleading product certification',p=>p.full_factuality_certified=true],
 ['false release green',p=>p.release_approved=true],
 ['shorten recorded 150-move control',p=>p.long_reversible_game_plies=100],
 ['hide earlier fivefold in long game',p=>p.long_game_max_repetition=5],
 ['remove one legal source',p=>p.source_game_count=16],
 ['remove one test case',p=>p.cases.pop()],
 ['invent one case',p=>p.case_count=86],
 ['rewrite result totals',p=>p.counts.rejected=25],
 ['duplicate a test case name',p=>p.cases[0].name=p.cases[1].name],
 ['remove all per-case uncertainty',p=>p.cases.forEach(r=>r.unassessed=[])],
 ['pretend all rows verified',p=>p.cases.forEach(r=>r.verdict_observed='limited_claims_passed')],
 ['repetition 3 falsely automatic',p=>alter(p,'repetition-3 / white winner',r=>{
  r.verdict_expected='rejected';r.verdict_observed='rejected';r.findings=['contradicted_terminal_draw_winner'];r.unassessed=[];
 })],
 ['repetition 4 falsely automatic',p=>alter(p,'repetition-4 / black winner',r=>{
  r.verdict_expected='rejected';r.verdict_observed='rejected';r.findings=['contradicted_terminal_draw_winner'];r.unassessed=[];
 })],
 ['repetition 3 falsely claimed proven',p=>alter(p,'repetition-3 / no statement',r=>r.automatic_draw_from_replay=true)],
 ['fivefold treated claimable',p=>alter(p,'repetition-5 / white winner',r=>r.claimable_only=true)],
 ['fivefold forced-draw error hidden',p=>alter(p,'repetition-5 / white winner',r=>{
  r.verdict_expected='not_evaluated';r.verdict_observed='not_evaluated';r.findings=[];
 })],
 ['fivefold wrong result tag hidden',p=>alter(p,'repetition-5 / no statement',r=>r.findings=[])],
 ['fivefold proper draw falsely rejected',p=>alter(p,'repetition-5-draw / no statement',r=>{
  r.verdict_expected='rejected';r.verdict_observed='rejected';r.findings=['pgn_result_conflicts_with_terminal_draw'];
 })],
 ['fivefold unknown tag falsely rejected',p=>alter(p,'repetition-5-unknown / no statement',r=>{
  r.verdict_expected='rejected';r.verdict_observed='rejected';r.findings=['pgn_result_conflicts_with_terminal_draw'];
 })],
 ['50-move claim promoted to automatic',p=>alter(p,'full-100 / white winner',r=>{
  r.verdict_expected='rejected';r.verdict_observed='rejected';r.findings=['contradicted_terminal_draw_winner'];
 })],
 ['50-move claim not logged',p=>alter(p,'full-100 / white winner',r=>r.unassessed=[])],
 ['50-move claim unavailable erroneously',p=>alter(p,'full-100 / black winner',r=>r.claimable_only=false)],
 ['149 source halfmoves falsely forced',p=>alter(p,'full-149 / white winner',r=>r.automatic_seventy_five=true)],
 ['150 source halfmoves falsely claimable',p=>alter(p,'full-150 / white winner',r=>r.claimable_only=true)],
 ['150 source halfmoves forced result hidden',p=>alter(p,'full-150 / white winner',r=>{
  r.verdict_expected='not_evaluated';r.verdict_observed='not_evaluated';r.findings=[];
 })],
 ['150 source halfmoves metadata conflict erased',p=>alter(p,'full-150 / no statement',r=>r.findings=[])],
 ['150 source halfmoves correct draw labeled wrong',p=>alter(p,'full-150-draw / no statement',r=>{
  r.verdict_expected='rejected';r.verdict_observed='rejected';r.findings=['pgn_result_conflicts_with_terminal_draw'];
 })],
 ['150 source halfmoves unspecified labeled wrong',p=>alter(p,'full-150-unknown / no statement',r=>{
  r.verdict_expected='rejected';r.verdict_observed='rejected';r.findings=['pgn_result_conflicts_with_terminal_draw'];
 })],
 ['imported FEN clock 150 falsely independent',p=>alter(p,'halfmove-150-unproven / white winner',r=>{
  r.automatic_draw_from_replay=true;r.automatic_seventy_five=true;
 })],
 ['imported FEN clock 151 falsely independent',p=>alter(p,'halfmove-151-unproven / white winner',r=>r.source_reversible_halfmoves=151)],
 ['imported FEN 100 treated automatic',p=>alter(p,'halfmove-100 / white winner',r=>{
  r.verdict_expected='rejected';r.verdict_observed='rejected';r.findings=['contradicted_terminal_draw_winner'];
 })],
 ['FEN source itself changed without hash',p=>alter(p,'halfmove-150-unproven / black winner',r=>{
  r.source_pgn=r.source_pgn.replace('149 51','0 51');
 })],
 ['unexpected source SAN modified',p=>alter(p,'repetition-3 / white winner',r=>r.source_pgn=r.source_pgn.replace('Ng8','Qe7'))],
 ['source variant hash forged',p=>alter(p,'full-150 / white winner',r=>r.source_sha256='f'.repeat(64))],
 ['source halfmove counter overwritten',p=>alter(p,'full-100 / black winner',r=>r.source_reversible_halfmoves=99)],
 ['board proof invented in repeat',p=>alter(p,'repetition-3 / black winner',r=>r.board_proven_draw=true)],
 ['board proof invented in long game',p=>alter(p,'full-150 / user black won',r=>r.board_proven_draw=true)],
 ['checkmate invented',p=>alter(p,'repetition-5 / black winner',r=>r.library_draw=false)],
 ['threefold evidence disguised',p=>alter(p,'repetition-3 / black winner',r=>r.library_threefold=false)],
 ['fifty library evidence disguised',p=>alter(p,'halfmove-100 / black winner',r=>r.library_fifty=false)],
 ['fake source length',p=>alter(p,'full-150 / white winner',r=>r.source_plies=99)],
 ['repetition count forged',p=>alter(p,'repetition-5 / white winner',r=>r.source_repetitions=4)],
 ['claimed winner changed',p=>alter(p,'full-150 / white winner',r=>r.summary='Maybe White won the game.')],
 ['partial false-green with balanced status counts',p=>{
  const a=p.cases.find(r=>r.name==='repetition-3 / white winner');
  const b=p.cases.find(r=>r.name==='repetition-5 / white winner');
  a.verdict_expected=a.verdict_observed='rejected';
  a.findings=['contradicted_terminal_draw_winner'];a.unassessed=[];
  b.verdict_expected=b.verdict_observed='not_evaluated';
  b.findings=[];b.unassessed=['nonterminal_result_not_independently_verified'];
 }],
 ['silent swap of non-gold row outcomes',p=>{
  const a=p.cases.find(r=>r.name==='halfmove-100 / user white won');
  const b=p.cases.find(r=>r.name==='full-150 / user white won');
  a.verdict_expected=a.verdict_observed='rejected';a.findings=['contradicted_terminal_draw_winner'];a.unassessed=[];
  b.verdict_expected=b.verdict_observed='not_evaluated';b.findings=[];b.unassessed=['nonterminal_result_not_independently_verified'];
 }],
];
let failed=0;
for(const [name,mutate] of bad){
 const packet=structuredClone(genuine);mutate(packet);
 assert.throws(()=>verifyDrawClaimEvidence(packet),undefined,
  'independent verifier falsely certified adversarial data: '+name);
 failed++;
}
console.log(JSON.stringify({genuine_source_cases_accepted:85,
  forged_claim_or_automatic_draw_packets_rejected:failed,
  unknown_result_not_called_false:true,unproven_FEN_move_clock_not_trusted:true,
  full_factuality_certified:false,release_approved:false}));
