#!/usr/bin/env node
/** Adversarial integrity controls for the 67-case nonterminal/draw/checkmate
 * proof. Mutated local JSON only; no product, game, engine or model changes. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyResultEvidence} from './review-benchmark-result-evidence-proof.mjs';
const correct=JSON.parse(readFileSync('qa/review-excellence/results/coach-result-evidence-matrix.json','utf8'));
assert.equal(verifyResultEvidence(correct).claim_case_count,67);
function rowChange(p,name,fn){const r=p.cases.find(x=>x.name===name);assert(r,name);fn(r);}
const modifications=[
 ['replace candidate source',x=>x.pinned_candidate_b='f'.repeat(40)],
 ['tamper fixture',x=>x.fixture_id='private-user-game'],
 ['tamper synthetic manifest',x=>x.manifest_sha256='f'.repeat(64)],
 ['tamper source fixture pin',x=>x.fixture_sha256='f'.repeat(64)],
 ['tamper old checkpoint',x=>x.parent_checkpoint='f'.repeat(40)],
 ['tamper run identity',x=>x.run_id='old-evidence-packet'],
 ['false release approval',x=>x.release_approved=true],
 ['false full factuality',x=>x.full_factuality_certified=true],
 ['fabricated model provider',x=>x.external_model_requests=5],
 ['fabricated Stockfish work',x=>x.stockfish_requests=8],
 ['switch real data label',x=>x.source_kind='actual customer game'],
 ['remove one game source',x=>x.source_count=14],
 ['remove one case',x=>x.cases.pop()],
 ['change case count',x=>x.case_count=66],
 ['invent extra result count',x=>x.counts.rejected=25],
 ['duplicate case',x=>x.cases[0].name=x.cases[1].name],
 ['mutate unchecked source chess PGN',x=>rowChange(x,'unfinished-white / white says won',r=>r.source_pgn=r.source_pgn.replace('Nc6','Qh4#'))],
 ['mutate PGN SHA without changing PGN',x=>rowChange(x,'unfinished-white / white says won',r=>r.source_sha256='f'.repeat(64))],
 ['change PGN header with forged source hash',x=>rowChange(x,'stalemate-white / White won the game.',r=>{
   r.source_pgn=r.source_pgn.replace('[Result "1-0"]','[Result "1/2-1/2"]');
   r.source_sha256='f'.repeat(64);
 })],
 ['turn nonterminal into terminal in metadata',x=>rowChange(x,'unfinished-white / white says won',r=>r.source_terminal=true)],
 ['turn stalemate into checkmate in metadata',x=>rowChange(x,'stalemate-draw / White won the game.',r=>r.source_checkmate=true)],
 ['turn insufficient draw into undecided in metadata',x=>rowChange(x,'insufficient-unknown / Black won the game.',r=>r.source_draw=false)],
 ['false board proof on nonterminal',x=>rowChange(x,'unfinished-black / black says won',r=>r.mate_proved=true)],
 ['hide genuine mate proof',x=>rowChange(x,'mate correct tag / black won',r=>r.mate_proved=false)],
 ['hide proven stalemate',x=>rowChange(x,'stalemate-white / White won the game.',r=>r.draw_proved=false)],
 ['fake header result',x=>rowChange(x,'stalemate-white / White won the game.',r=>r.header_result='1/2-1/2')],
 ['fake user perspective',x=>rowChange(x,'unfinished-black / black POV you won',r=>r.user_color='white')],
 ['wrong source SAN',x=>rowChange(x,'stalemate correct header / legal last-move queen',r=>r.moment.san='Qa6')],
 ['wrong source FEN',x=>rowChange(x,'insufficient unknown header / legal black first move',r=>r.moment.fen_before='8/8/8/8/8/8/8/K6k w - - 0 1')],
 ['false positive on unproven white resignation',x=>rowChange(x,'unfinished-white / white says won',r=>{
   r.status_expected='limited_claims_passed';r.status_observed='limited_claims_passed';r.verified=['game_result'];r.unassessed=[];
 })],
 ['false accusation against opposing winner in resignation',x=>rowChange(x,'unfinished-white / black says won',r=>{
   r.status_expected='rejected';r.status_observed='rejected';r.findings=['contradicted_game_winner'];r.unassessed=[];
 })],
 ['fake proof of undeclared resignation winner',x=>rowChange(x,'unfinished-unknown / white says lost',r=>r.verified=['game_result'])],
 ['wrongly reject nonterminal result as an invented proof gap',x=>rowChange(x,'unfinished-black / black POV you won',r=>r.findings=['result_claim_without_terminal_proof'])],
 ['lose unassessed reason',x=>rowChange(x,'unfinished-unknown / white POV opponent lost',r=>r.unassessed=[])],
 ['change unexplained early anchor result',x=>rowChange(x,'unfinished white header / correct board, no winner',r=>r.status_observed='limited_claims_passed')],
 ['erase genuine board evidence',x=>rowChange(x,'unfinished black header / claimed winner plus correct board',r=>r.verified=[])],
 ['erase independently contradicted king',x=>rowChange(x,'unfinished draw header / claimed winner plus fake king',r=>r.findings=[])],
 ['treat missing checkmate metadata as a lie',x=>rowChange(x,'mate unknown tag / black proved by board',r=>{
   r.status_observed='rejected';r.status_expected='rejected';r.findings=['pgn_result_conflicts_with_mate'];r.verified=[];
 })],
 ['invent proof in checkmate case',x=>rowChange(x,'mate correct tag / false white win',r=>r.verified=['game_result'])],
 ['erase genuine conflicting checkmate tag',x=>rowChange(x,'mate-wrong-white / no prose still mismatched metadata',r=>r.findings=[])],
 ['draw falsely treated as unknown',x=>rowChange(x,'stalemate-draw / White won the game.',r=>{
   r.status_expected='not_evaluated';r.status_observed='not_evaluated';r.findings=[];r.unassessed=['nonterminal_result_not_independently_verified'];
 })],
 ['false decisive draw header silently accepted',x=>rowChange(x,'stalemate-white / no claim but false decisive header',r=>r.findings=[])],
 ['unspecified draw header falsely rejected',x=>rowChange(x,'stalemate-unknown / no claim, valid or unknown header',r=>{
   r.status_expected='rejected';r.status_observed='rejected';r.findings=['pgn_result_conflicts_with_terminal_draw'];
 })],
 ['custom insufficient material result wrong',x=>rowChange(x,'insufficient-white / no claim but false decisive header',r=>r.findings=[])],
 ['legal custom black first move not proven',x=>rowChange(x,'insufficient unknown header / legal black first move',r=>r.verified=[])],
 ['aggregate-preserving swap of two not-gold outcomes',x=>{
   const a=x.cases.find(r=>r.name==='unfinished-draw / white says won');
   const b=x.cases.find(r=>r.name==='stalemate-unknown / Black won the game.');
   [a.status_expected,a.status_observed,a.findings,a.unassessed]=
    ['rejected','rejected',['contradicted_terminal_draw_winner'],[]];
   [b.status_expected,b.status_observed,b.findings,b.unassessed]=
    ['not_evaluated','not_evaluated',[],['nonterminal_result_not_independently_verified']];
 }],
 ['replace a non-gold source claim without altering aggregate totals',x=>rowChange(x,
  'unfinished-draw / white says won',r=>r.summary='Maybe White won the game.')],
 ['substitute all not-evaluated with missing reasons',x=>x.cases.filter(r=>r.status_observed==='not_evaluated').forEach(r=>r.unassessed=[])],
];
let rejected=0;
for(const [label,edit] of modifications){
 const corrupted=structuredClone(correct);edit(corrupted);
 assert.throws(()=>verifyResultEvidence(corrupted),undefined,
  'independent release blocker accepted forged evidence: '+label);
 rejected++;
}
console.log(JSON.stringify({real_67_case_source_packet_accepted:true,
 tampered_evidence_packets_rejected:rejected,
 nonterminal_unknown_outcomes_not_promoted_to_contradictions:true,
 terminal_draw_winner_contradictions_preserved:true,
 release_approved:false}));
