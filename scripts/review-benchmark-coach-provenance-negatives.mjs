#!/usr/bin/env node
/**
 * Independent false-green adversarial controls for the Agent D chess-prose
 * verifier itself. Source PGN is trusted after legal replay; the AI report's
 * otherwise-legal FEN, SAN, ply and side are NOT authoritative.
 * No production routes, DB, Stockfish work, user data or remote model.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Chess} from 'chess.js';
import {validateWrittenGameReview} from './review-benchmark-coach-claim-adapter.mjs';

const pgn=readFileSync('qa/review-excellence/fixtures/games/syn-game-fools-mate.pgn','utf8');
const game=new Chess();game.loadPgn(pgn,{strict:true});
assert(game.isCheckmate()&&game.turn()==='w');
const moves=game.history({verbose:true});
assert.equal(moves.length,4);
assert.equal(moves[2].san,'g4');
assert.equal(moves[2].color,'w');
const normal={ply:3,side:'white',san:'g4',fen_before:moves[2].before,
 prose:"White's king is on e1."};
const review=(changes={},moment=normal)=>({version:9,language:'en',audience:'beginner',
 summary:'Black won the game.',skill_assessment:'A single game is not a rating.',
 opening:null,phases:{opening:null,middlegame:null,endgame:null},
 key_moments:[structuredClone(moment)],...changes});
const observe=(r,p=pgn,who='white')=>validateWrittenGameReview({pgn:p,review:r,userColor:who});
let observed=0;
function allowed(name,r,opts={}){
 const result=observe(r,opts.pgn??pgn,opts.userColor??'white');
 assert.equal(result.status,'partial_claims_verified',name+': '+JSON.stringify(result.findings));
 assert(result.unassessed.some(x=>x.reason==='unchecked_prose_remainder'&&x.field==='skill_assessment'),
  'scoped claim pass concealed unassessed instructional prose');
 assert.equal(result.findings.length,0,name);
 assert.equal(result.full_factuality_certified,false,name);
 if(opts.proof)assert(result.verified.some(v=>v.proof===opts.proof),name+' lacks expected independent proof');
 observed++;
 return result;
}
function rejected(name,r,reason,opts={}){
 const result=observe(r,opts.pgn??pgn,opts.userColor??'white');
 assert.equal(result.status,'rejected',name+': '+JSON.stringify(result));
 assert(result.findings.some(f=>f.reason===reason),name+': reason '+reason+' missing '+JSON.stringify(result.findings));
 assert.equal(result.full_factuality_certified,false,name);
 if(opts.noPieceProof)assert(!result.verified.some(v=>v.type==='piece_location'),name+': unsafe board proof issued');
 observed++;
 return result;
}
function unassessed(name,r,reason,opts={}){
 const result=observe(r,opts.pgn??pgn,opts.userColor??'white');
 assert.equal(result.status,'not_evaluated',name+': '+JSON.stringify(result));
 assert(result.unassessed.some(x=>x.reason===reason),name+': missing unassessed reason');
 assert.equal(result.verified.length,0,name);
 assert.equal(result.full_factuality_certified,false,name);
 observed++;
 return result;
}

// Positive identity controls: no false rejection of real author-provided
// candidate moment positions, SAN, ply, mover or legal PGN continuation.
allowed('source verified king e1',review(),{proof:'independent_source_pgn_move_replay'});
allowed('source verified black king e8',review({}, {...normal,prose:"Black's king is on e8."}));
allowed('source verified pawn before AND after',review({}, {...normal,prose:"White's pawn is on g4."}));
allowed('source perspective black winner',review({summary:'You won this game.'}),{userColor:'black'});
allowed('all four plies sourced',review({key_moments:moves.map((m,i)=>({
 ply:i+1,side:m.color==='w'?'white':'black',san:m.san,fen_before:m.before,
 prose:'White lost this game.',
 }))}));

// A complete, valid alternative chess game places the WHITE king on e2.
// A previous verifier trusted the forged FEN and pronounced its board claim
// correct despite the actual Fool's Mate king always remaining on e1.
const alternative=new Chess();
for(const san of ['e4','e5','Ke2','Nc6'])alternative.move(san);
assert.equal(alternative.get('e2')?.type,'k');
assert.equal(alternative.get('e2')?.color,'w');
assert.equal(alternative.turn(),'w');
const fabricated={...normal,fen_before:alternative.fen(),
 prose:"White's king is on e2."};
const oldFalseGreen=rejected('fabricated legal unrelated game state',review({},fabricated),
 'moment_board_conflicts_with_source_pgn',{noPieceProof:true});
assert(oldFalseGreen.verified.some(x=>x.type==='game_result'));

const identityMutations=[
 ['wrong legal FEN while false claim',m=>{m.fen_before=alternative.fen();m.prose="White's king is on e2.";},'moment_board_conflicts_with_source_pgn'],
 ['FEN from first ply',m=>{m.fen_before=moves[0].before;},'moment_board_conflicts_with_source_pgn'],
 ['FEN from final ply',m=>{m.fen_before=moves[3].before;},'moment_board_conflicts_with_source_pgn'],
 ['FEN from after current move',m=>{m.fen_before=moves[2].after;},'moment_board_conflicts_with_source_pgn'],
 ['FEN with different move clock',m=>{m.fen_before=m.fen_before.replace(/ 0 2$/,' 7 2');},'moment_board_conflicts_with_source_pgn'],
 ['FEN invalid despite correct SAN',m=>{m.fen_before='not-a-FEN';},'moment_board_conflicts_with_source_pgn'],
 ['FEN omitted',m=>{delete m.fen_before;},'moment_board_conflicts_with_source_pgn'],
 ['FEN empty',m=>{m.fen_before='';},'moment_board_conflicts_with_source_pgn'],
 ['SAN changed to legal alternative',m=>{m.san='e4';},'moment_move_conflicts_with_source_pgn'],
 ['SAN changed to actual move of other ply',m=>{m.san='f3';},'moment_move_conflicts_with_source_pgn'],
 ['SAN arbitrarily illegal',m=>{m.san='Qa8#';},'moment_move_conflicts_with_source_pgn'],
 ['SAN omitted',m=>{delete m.san;},'moment_move_conflicts_with_source_pgn'],
 ['SAN blank',m=>{m.san='';},'moment_move_conflicts_with_source_pgn'],
 ['wrong mover color',m=>{m.side='black';},'moment_side_conflicts_with_source_pgn'],
 ['mover color omitted',m=>{delete m.side;},'moment_side_conflicts_with_source_pgn'],
 ['mover side nonsense',m=>{m.side='pink';},'moment_side_conflicts_with_source_pgn'],
 ['move ply off by one',m=>{m.ply=2;},'moment_side_conflicts_with_source_pgn'],
 ['ply zero',m=>{m.ply=0;},'moment_ply_out_of_source_range'],
 ['negative ply',m=>{m.ply=-1;},'moment_ply_out_of_source_range'],
 ['ply exceeds PGN length',m=>{m.ply=5;},'moment_ply_out_of_source_range'],
 ['numeric string ply',m=>{m.ply='3';},'moment_ply_out_of_source_range'],
 ['fractional ply',m=>{m.ply=3.5;},'moment_ply_out_of_source_range'],
 ['NaN ply',m=>{m.ply=NaN;},'moment_ply_out_of_source_range'],
 ['infinite ply',m=>{m.ply=Infinity;},'moment_ply_out_of_source_range'],
 ['undefined ply',m=>{delete m.ply;},'moment_ply_out_of_source_range'],
 ['null moment',()=>{},'moment_ply_out_of_source_range'],
];
for(const [name,mutate,reason] of identityMutations){
 const m=structuredClone(normal);
 mutate(m);
 const r=review({},name==='null moment'?null:m);
 rejected(name,r,reason,{noPieceProof:true});
}
rejected('report with one true and one fake moment',review({
 key_moments:[structuredClone(normal),structuredClone(fabricated)],
}),'moment_board_conflicts_with_source_pgn');
rejected('source mate result contradicted',review({summary:'White won the game.'}),
 'contradicted_game_winner');

// Time-sensitive assertions must be checked against the *explicitly chosen*
// side of the independently recorded move, never either adjacent position.
const temporal=[
 ['wrong pawn before g4',"Before the move, White's pawn is on g4.",'contradicted_temporal_piece_location'],
 ['wrong pawn after g4',"After the move, White's pawn is on g2.",'contradicted_temporal_piece_location'],
 ['wrong king before',"Before the move, White's king is on e2.",'contradicted_temporal_piece_location'],
 ['wrong king after',"After the move, White's king is on e2.",'contradicted_temporal_piece_location'],
 ['wrong pawn with this move',"Before this move: White's pawn is on g4.",'contradicted_temporal_piece_location'],
 ['wrong pawn with played move',"After the played move: White's pawn is on g2.",'contradicted_temporal_piece_location'],
 ['wrong pawn after prior sentence',"An earlier move occurred. After the move, White's pawn is on g2.",'contradicted_temporal_piece_location'],
];
for(const [name,prose,reason] of temporal)
 rejected(name,review({}, {...normal,prose}),reason);
for(const [name,prose,time] of [
 ['right pawn before',"Before the move, White's pawn is on g2.",'before'],
 ['right pawn after',"After the move, White's pawn is on g4.",'after'],
 ['right pawn with played prefix',"After this played move: White's pawn is on g4.",'after'],
 ['right pawn with other prefix',"Before that move: White's pawn is on g2.",'before'],
])allowed(name,review({}, {...normal,prose}),{proof:'independent_source_pgn_'+time+'_move'});
const mixed=rejected('two time claims with one false',review({}, {...normal,
 prose:"Before the move, White's pawn is on g4. After the move, White's pawn is on g4.",
}),'contradicted_temporal_piece_location');
assert(mixed.verified.some(x=>x.proof==='independent_source_pgn_after_move'));

// Do not smuggle unrecognized temporal wording through as a verified claim.
for(const [name,prose] of [
 ['move number temporal phrase',"Before 2.g4, White's pawn is on g4."],
 ['another temporal object',"After the capture, White's pawn is on g4."],
 ['time antecedent ambiguous',"Before choosing, White's king is on e1."],
])unassessed(name,review({summary:''},{...normal,prose}),
 'unsupported_temporal_piece_reference');
unassessed('unrecognized piece synonym',review({summary:''},{...normal,
 prose:'The white monarch sits on e2.'}),'no_recognized_checkable_claims');

// Chess.js supports custom set-up/FEN games where the first mover is BLACK.
// A parity-based ply heuristic would incorrectly treat ply 1 as White.
const blackPgn='[Event "QA synthetic black-to-move"]\n[SetUp "1"]\n[FEN "8/8/8/8/8/8/8/K6k b - - 0 1"]\n[Result "*"]\n\n1... Kh2 *';
const blackGame=new Chess();blackGame.loadPgn(blackPgn,{strict:true});
const bm=blackGame.history({verbose:true})[0];
assert.equal(bm.color,'b');assert.equal(bm.san,'Kh2');
const blackMoment={ply:1,side:'black',fen_before:bm.before,san:'Kh2',
 prose:"Before the move, Black's king is on h1."};
allowed('black-to-move FEN start before',review({summary:''},blackMoment),
 {pgn:blackPgn,proof:'independent_source_pgn_before_move'});
allowed('black-to-move FEN start after',review({summary:''},{...blackMoment,
 prose:"After the move, Black's king is on h2."}),
 {pgn:blackPgn,proof:'independent_source_pgn_after_move'});
rejected('black-to-move FEN with fabricated White side',review({summary:''},{...blackMoment,side:'white'}),
 'moment_side_conflicts_with_source_pgn',{pgn:blackPgn,noPieceProof:true});
rejected('black-to-move FEN with incorrect temporal pawn',review({summary:''},{...blackMoment,
 prose:"After the move, Black's king is on h1."}),
 'contradicted_temporal_piece_location',{pgn:blackPgn});

const unsupported=observe(review({language:'es',summary:'White won the game.'}));
assert.equal(unsupported.status,'not_evaluated');
assert.equal(unsupported.full_factuality_certified,false);
observed++;
for(const [name,input] of [
 ['missing review',null],
 ['missing moments',{...review(),key_moments:null}],
]){
 const verdict=observe(input);
 assert.equal(verdict.status,'invalid_input',name);
 assert.equal(verdict.full_factuality_certified,false,name);
 observed++;
}
const malformed=observe(review(),'illegal PGN');
assert.equal(malformed.status,'invalid_input');
assert.equal(malformed.full_factuality_certified,false);
observed++;
console.log(JSON.stringify({verdict:'pass',
 independent_claim_provenance_controls:observed,
 synthetic_result:'0-1',source_bound_position_proofs:true,
 unrelated_legal_board_false_green_rejected:true,
 explicit_temporal_claim_false_green_rejected:true,
 black_to_move_custom_start_covered:true,
 unsupported_temporal_grammar_abstained:true,
 unsupported_language_not_certified:true,
 full_factuality_certified:false,product_release_approved:false}));
