#!/usr/bin/env node
// Hostile, standalone checks for the *independent* natural-language verifier.
// Each corruption attacks a known literal claim, not an LLM's own labels.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { validateWrittenGameReview } from './review-benchmark-coach-claim-adapter.mjs';

const pgn=readFileSync('qa/review-excellence/fixtures/games/syn-game-fools-mate.pgn','utf8');
const end=new Chess();end.loadPgn(pgn,{strict:true});
assert(end.isCheckmate());
assert.equal(end.turn(),'w'); // Black delivered mate.
const moves=end.history({verbose:true});
const replay=new Chess();
const before=[];
for(const m of moves){before.push(replay.fen());replay.move(m);}
const moment={ply:3,side:'white',fen_before:before[2],san:moves[2].san,title:'Synthetic moment'};
const make=(summary,prose)=>({
 summary,key_moments:[{...moment,prose}],phases:{opening:null,middlegame:null,endgame:null},
 opening:null,skill_assessment:'Insufficient data to infer playing strength.',version:9,language:'en',audience:'beginner'
});
let assertions=0;
const check=(claim,expectedReasons=[])=>{
 const observed=validateWrittenGameReview({pgn,review:claim});
 const reasons=observed.findings.map(x=>x.reason);
 if(expectedReasons.length) {
  for(const reason of expectedReasons)assert(reasons.includes(reason),reason+': '+JSON.stringify(reasons));
  assert.equal(observed.status,'rejected');
 } else {
  assert.equal(observed.status,'limited_claims_passed',JSON.stringify(reasons));
  assert.equal(observed.findings.length,0);
 }
 assertions++;
};
for(const [result,piece] of [
 ['White lost the game.',"White's king is on e1."],
 ['Black won this game.',"White's pawn is on e2."],
 ['You lost this game.',"Black's king is on e8."],
 ['Your opponent won the game.',"White's pawn is on g4."],
 ['White won the game.',"White's king is on e2."]
]){
 const wanted=result==='White won the game.'?['contradicted_game_winner','contradicted_piece_location']:[];
 check(make(result,piece),wanted);
}
for(const [result,piece,reason] of [
 ['White won this game.',"White's king is on e1.",'contradicted_game_winner'],
 ['Black lost the game.',"White's king is on e1.",'contradicted_game_winner'],
 ['You won this game.',"White's king is on e1.",'contradicted_game_winner'],
 ['Your opponent lost the game.',"White's king is on e1.",'contradicted_game_winner'],
 ['White lost the game.',"White's king stands on e2.",'contradicted_piece_location'],
 ['White lost the game.',"Black's queen is on a8.",'contradicted_piece_location'],
 ['White lost the game.',"White's queen is currently located at d3.",'contradicted_piece_location'],
 ['White lost the game.',"Black's king is on e1.",'contradicted_piece_location']
])check(make(result,piece),[reason]);
// Independent verifier must not invent an outcome when the chess rules do not
// show a terminal checkmate, even if someone invents a Result header.
const unfinished='[Event "Synthetic fixture"]\n[Result "1-0"]\n\n1. e4 e5 *';
const nonterminal=validateWrittenGameReview({pgn:unfinished,review:make('White won the game.',"White's king is on e1.")});
assert(nonterminal.findings.some(x=>x.reason==='result_claim_without_terminal_proof'));
assert(nonterminal.unassessed.some(x=>x.reason==='nonterminal_result_not_independently_verified'));
assert.equal(nonterminal.result_proven_by_mate,false);
assert.equal(validateWrittenGameReview({pgn:'illegal PGN',review:make('White won the game.','')}).status,'invalid_input');
// This evaluator deliberately does NOT claim to understand equivalent prose,
// tactical causality, any other language, or learner outcomes.
const lexicalGap=validateWrittenGameReview({pgn,review:make('The side playing first was victorious.',"The white monarch sits on e2.")});
assert.equal(lexicalGap.findings.length,0,'a known out-of-scope paraphrase must be documented, not silently labeled proved');
assert.equal(lexicalGap.verified.length,0,'unrecognized claims must not generate verified evidence');
assert.equal(lexicalGap.status,'not_evaluated','unknown paraphrases are not a pass');
assert(lexicalGap.unassessed.some(x=>x.reason==='no_recognized_checkable_claims'));
assert.equal(lexicalGap.full_factuality_certified,false,'a selective lexical checker cannot certify all prose');
const unsupportedLanguage=validateWrittenGameReview({pgn,review:{...make('White won the game.', ''),language:'es'}});
assert.equal(unsupportedLanguage.status,'not_evaluated');
assert(unsupportedLanguage.unassessed.some(x=>x.reason==='language_not_supported_by_independent_checker'));
assert.equal(validateWrittenGameReview({pgn,review:{...make('White lost the game.',''),key_moments:null}}).status,'invalid_input');
console.log(JSON.stringify({verdict:'pass',independent_claim_controls:assertions+5,
 positives:4,negative_mutations:9,refused_unproven_result:true,
 known_unrecognized_paraphrase:true,scope:'finite English lexical claims, not complete prose semantics'}));
