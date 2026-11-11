#!/usr/bin/env node
/** Agent D independent adjudication of CHECKMATE vs DRAW vs nonterminal
 * PGN Result metadata. Synthetic chess only; never certify resignations
 * merely because an unauthenticated Result header says who won. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Chess} from 'chess.js';
import {validateWrittenGameReview} from './review-benchmark-coach-claim-adapter.mjs';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence'),results=join(qa,'results');
mkdirSync(results,{recursive:true});
const args=Object.fromEntries(process.argv.slice(2).map(x=>{
 const i=x.indexOf('=');return i<0?[x.slice(2),true]:[x.slice(2,i),x.slice(i+1)];
}));
assert(Object.keys(args).every(x=>x==='run-id'),'unsupported local-only CLI argument');
const runId=args['run-id']||randomUUID();
assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId));
const sha=v=>createHash('sha256').update(v).digest('hex');
const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8');
assert.equal(sha(manifest),'2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44');
const fixture=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.source_kind==='synthetic'&&fixture.license==='self-authored');
const originalPgn=readFileSync(join(qa,'fixtures',fixture.pgn_file),'utf8');
assert.equal(sha(originalPgn),fixture.pgn_sha256);

const makePgn=(title,result,movetext,setup)=>[
 `[Event "QA ${title}"]`,
 ...(setup?['[SetUp "1"]',`[FEN "${setup}"]`]:[]),
 `[Result "${result}"]`,'',movetext+' '+result,
].join('\n');
const openingMoves='1. f3 e5 2. g4 Nc6';
const mateMoves='1. f3 e5 2. g4 Qh4#';
const stSetup='k7/8/2K5/1Q6/8/8/8/8 w - - 0 1';
// The prior version started with two bare kings and then played Kh2: that
// "legal" SAN passed chess.js but the game was already dead at ply zero.
// Here Black's king captures the last White bishop on a real legal move,
// leaving K+N vs K insufficient material for the first time at the end.
const imSetup='8/8/5n2/8/8/6k1/7B/4K3 b - - 0 1';
const sources={
 'mate-correct':originalPgn,
 'mate-unknown':makePgn('checkmate unknown header','*',mateMoves),
 'mate-wrong-white':makePgn('checkmate wrong winner','1-0',mateMoves),
 'mate-wrong-draw':makePgn('checkmate wrong draw','1/2-1/2',mateMoves),
 'unfinished-white':makePgn('nonterminal declared white win','1-0',openingMoves),
 'unfinished-black':makePgn('nonterminal declared black win','0-1',openingMoves),
 'unfinished-draw':makePgn('nonterminal declared draw','1/2-1/2',openingMoves),
 'unfinished-unknown':makePgn('nonterminal unknown','*',openingMoves),
 'stalemate-draw':makePgn('legal move to stalemate','1/2-1/2','1. Qb6',stSetup),
 'stalemate-unknown':makePgn('stalemate with unknown header','*','1. Qb6',stSetup),
 'stalemate-white':makePgn('stalemate with false white winner','1-0','1. Qb6',stSetup),
 'stalemate-black':makePgn('stalemate with false black winner','0-1','1. Qb6',stSetup),
 'insufficient-draw':makePgn('capture ends in insufficient material','1/2-1/2','1... Kxh2',imSetup),
 'insufficient-unknown':makePgn('capture ends in insufficient material unspecified','*','1... Kxh2',imSetup),
 'insufficient-white':makePgn('capture ends in insufficient material false white winner','1-0','1... Kxh2',imSetup),
};
const parsed=new Map();
for(const [kind,pgn] of Object.entries(sources)){
 const game=new Chess();game.loadPgn(pgn,{strict:true});
 assert(game.history().length>=1,'source must contain a legal move');
 const terminal=game.isGameOver(),mate=game.isCheckmate(),draw=game.isDraw();
 if(kind.startsWith('mate-'))assert(mate&&!draw&&terminal);
 else if(kind.startsWith('unfinished-'))assert(!terminal&&!mate&&!draw);
 else if(kind.startsWith('stalemate-'))assert(game.isStalemate()&&draw&&terminal);
 else assert(game.isInsufficientMaterial()&&draw&&terminal);
 parsed.set(kind,{game,terminal,mate,draw});
}

const rows=[];
function trial(name,kind,{summary='',moment=null,userColor='white',status,reason=null,
    mustNot=[],minVerified=0,mateProved=null,drawProved=null}){
 const {game,terminal,mate,draw}=parsed.get(kind);
 const move=game.history({verbose:true});
 const anchor=moment?{
  ...{ply:moment.ply,side:move[moment.ply-1].color==='w'?'white':'black',
   san:move[moment.ply-1].san,fen_before:move[moment.ply-1].before},
  prose:moment.prose,
 }:null;
 const review={language:'en',summary,opening:null,skill_assessment:'',
  phases:{opening:null,middlegame:null,endgame:null},key_moments:anchor?[anchor]:[]};
 const actual=validateWrittenGameReview({pgn:sources[kind],review,userColor});
 assert.equal(actual.status,status,name+' wrong verdict '+JSON.stringify(actual));
 assert(actual.verified.length>=minVerified,name+': positive source evidence missing');
 assert.equal(actual.result_proven_by_mate,mateProved??mate,name+' checkmate proof incorrect');
 assert.equal(actual.draw_proven_by_board,drawProved??draw,name+' board draw proof incorrect');
 assert.equal(actual.full_factuality_certified,false,name+' full certification forbidden');
 const reasons=actual.findings.map(x=>x.reason),uncertain=actual.unassessed.map(x=>x.reason);
 if(reason)assert([...reasons,...uncertain].includes(reason),
  name+': expected reason '+reason+' missing '+JSON.stringify(actual));
 for(const forbidden of mustNot)assert(![...reasons,...uncertain].includes(forbidden),
  name+': wrongful reason '+forbidden);
 rows.push({name,source:kind,source_pgn:sources[kind],source_sha256:sha(sources[kind]),
  header_result:game.header().Result||null,source_terminal:terminal,
  source_checkmate:mate,source_draw:draw,
  user_color:userColor,summary,moment:anchor,
  status_expected:status,status_observed:actual.status,
  verified:actual.verified.map(x=>x.type),
  findings:reasons,unassessed:uncertain,
  mate_proved:actual.result_proven_by_mate,
  draw_proved:actual.draw_proven_by_board,
  full_factuality_certified:false});
}
const nonterminal='winner_not_independently_proven_from_nonterminal_pgn';
const falseWinner='contradicted_terminal_draw_winner';
const headerMismatch='pgn_result_conflicts_with_terminal_draw';
// A PGN result on a nonterminal board may reflect resignation/time/agreement.
// Do not use its metadata to "prove" any winner and do not call a contrary
// literal a contradiction on the strength of that header.
for(const kind of ['unfinished-white','unfinished-black','unfinished-draw','unfinished-unknown']){
 for(const [label,summary,color] of [
  ['white says won','White won the game.','white'],
  ['black says won','Black won the game.','white'],
  ['white says lost','White lost this game.','white'],
  ['black says lost','Black lost the game.','white'],
  ['white POV you won','You won the game.','white'],
  ['black POV you won','You won the game.','black'],
  ['white POV opponent lost','Your opponent lost this game.','white'],
  ['black POV opponent won','Your opponent won the game.','black'],
 ])trial(kind+' / '+label,kind,{summary,userColor:color,status:'not_evaluated',reason:nonterminal,
  mustNot:['contradicted_game_winner','result_claim_without_terminal_proof']});
}
// Chessboard occupancy is still provable when the game's RESIGNATION outcome
// is not. Do not sacrifice independent board checks in an attempt to abstain.
trial('unfinished white header / correct board, no winner','unfinished-white',{
 moment:{ply:3,prose:"White's king is on e1."},status:'partial_claims_verified',
 minVerified:1,reason:'nonterminal_result_not_independently_verified'});
trial('unfinished black header / claimed winner plus correct board','unfinished-black',{
 summary:'White won the game.',moment:{ply:3,prose:"White's king is on e1."},
 status:'partial_claims_verified',minVerified:1,reason:nonterminal});
trial('unfinished draw header / claimed winner plus fake king','unfinished-draw',{
 summary:'White won the game.',moment:{ply:3,prose:"White's king is on e2."},
 status:'rejected',reason:'contradicted_piece_location',
 mustNot:['contradicted_game_winner']});
trial('unfinished unspecified / conditional imagined win','unfinished-unknown',{
 summary:'If White won the game, what would change?',
 status:'not_evaluated',reason:'hypothetical_or_conditional_result_not_assessed',
 mustNot:['contradicted_game_winner']});

// A legally checkmated king is independently provable even if PGN Result is
// omitted. Explicit WRONG 1-0 or draw metadata remains a source conflict.
trial('mate correct tag / black won','mate-correct',{
 summary:'Black won the game.',status:'limited_claims_passed',minVerified:1});
trial('mate correct tag / false white win','mate-correct',{
 summary:'White won the game.',status:'rejected',reason:'contradicted_game_winner'});
trial('mate unknown tag / black proved by board','mate-unknown',{
 summary:'Black won the game.',status:'limited_claims_passed',minVerified:1,
 mustNot:['pgn_result_conflicts_with_mate']});
trial('mate unknown tag / false white rejected by board','mate-unknown',{
 summary:'White won the game.',status:'rejected',reason:'contradicted_game_winner',
 mustNot:['pgn_result_conflicts_with_mate']});
for(const kind of ['mate-wrong-white','mate-wrong-draw']){
 trial(kind+' / correct black win but false header',kind,{
  summary:'Black won the game.',status:'rejected',reason:'pgn_result_conflicts_with_mate',
  minVerified:1});
 trial(kind+' / no prose still mismatched metadata',kind,{
  status:'rejected',reason:'pgn_result_conflicts_with_mate'});
}

// Legal boards independently prove an actual DRAW. Unlike resignation-like
// results, a literal winner is now demonstrably wrong. '*' is unspecified,
// not an explicitly lying result; wrong decisive headers get a separate
// PGN source-integrity contradiction even with no claim.
for(const kind of ['stalemate-draw','stalemate-unknown','stalemate-white','stalemate-black',
 'insufficient-draw','insufficient-unknown','insufficient-white']){
 for(const summary of ['White won the game.','Black won the game.']){
  trial(kind+' / '+summary,kind,{summary,status:'rejected',reason:falseWinner,
   mustNot:['winner_not_independently_proven_from_nonterminal_pgn']});
 }
}
for(const kind of ['stalemate-white','stalemate-black','insufficient-white']){
 trial(kind+' / no claim but false decisive header',kind,{
  status:'rejected',reason:headerMismatch});
}
for(const kind of ['stalemate-draw','stalemate-unknown','insufficient-draw','insufficient-unknown']){
 trial(kind+' / no claim, valid or unknown header',kind,{
  status:'not_evaluated',mustNot:[headerMismatch,'pgn_result_conflicts_with_mate']});
}
trial('stalemate correct header / legal last-move queen','stalemate-draw',{
 moment:{ply:1,prose:"After the move, White's queen is on b6."},
 status:'partial_claims_verified',minVerified:1,mustNot:[headerMismatch]});
trial('insufficient unknown header / legal black first move','insufficient-unknown',{
 moment:{ply:1,prose:"After the move, Black's king is on h2."},
 status:'partial_claims_verified',minVerified:1,mustNot:[headerMismatch]});

const counts={};for(const row of rows)counts[row.status_observed]=(counts[row.status_observed]||0)+1;
const report={schema_version:1,at_utc:new Date().toISOString(),run_id:runId,
 parent_checkpoint:'6537ed5180fa9f5df289013d1ced29e60719d04d',
 pinned_candidate_b:'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87',
 fixture_id:fixture.fixture_id,fixture_sha256:fixture.pgn_sha256,
 manifest_sha256:sha(manifest),
 source_kind:'self-authored synthetic checkmates, nonterminal games, stalemates and insufficient-material endings',
 source_count:Object.keys(sources).length,case_count:rows.length,counts,cases:rows,
 external_model_requests:0,stockfish_requests:0,
 full_factuality_certified:false,release_approved:false,
 limitations:['PGN Result and Termination metadata cannot independently prove resignation, clock loss or agreement',
  'Only a small finite English literal claim checker and chess.js source replay',
  'No sealed independently labeled human holdout or deployed stockfish/model',
  'Synthetic chess only; candidate source is read-only, no production DB/user games']};
const outfile=join(results,'coach-result-evidence-matrix.json');
writeFileSync(outfile,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output:outfile,run_id:runId,source_count:report.source_count,
 cases:report.case_count,counts,release_approved:false},null,2));
