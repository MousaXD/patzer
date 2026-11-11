#!/usr/bin/env node
/** Independent, deliberately small English conditional / hypothetical coach
 * factuality challenge. An assertion under an explicit modal/conditional
 * frame is not a fact about the played PGN; abstain rather than rejecting or
 * positively verifying it. All games/prose are synthetic; no model calls. */
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Chess} from 'chess.js';
import {validateWrittenGameReview} from './review-benchmark-coach-claim-adapter.mjs';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const results=join(qa,'results');mkdirSync(results,{recursive:true});
const args=Object.fromEntries(process.argv.slice(2).map(x=>{
 const i=x.indexOf('=');return i<0?[x.slice(2),true]:[x.slice(2,i),x.slice(i+1)];
}));
assert(Object.keys(args).every(k=>k==='run-id'),'unapproved CLI flags');
const runId=args['run-id']||randomUUID();
assert(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(runId));
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const manifestFile=join(qa,'manifests/manifest-v2.jsonl');
assert.equal(sha(manifestFile),'2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44');
const fixture=readFileSync(manifestFile,'utf8').trim().split('\n').map(JSON.parse)
 .find(f=>f.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.source_kind==='synthetic'&&fixture.license==='self-authored');
const pgnFile=join(qa,'fixtures',fixture.pgn_file);
assert.equal(sha(pgnFile),fixture.pgn_sha256);
const pgn=readFileSync(pgnFile,'utf8');
const game=new Chess();game.loadPgn(pgn,{strict:true});
assert(game.isCheckmate()&&game.turn()==='w'&&game.header().Result==='0-1');
const move=game.history({verbose:true})[2];
assert.equal(move.san,'g4');
const momentBase={ply:3,side:'white',fen_before:move.before,san:'g4'};
const resultsByCase=[];
const modalResult='hypothetical_or_conditional_result_not_assessed';
const modalPiece='hypothetical_or_conditional_piece_not_assessed';

function trial(name,{summary='',moment='',userColor='white',status,verified=0,
   reason=null,forbidden=[],uncertainRemainder=null}){
 const review={language:'en',summary,skill_assessment:'',opening:null,
  phases:{opening:null,middlegame:null,endgame:null},
  key_moments:[{...momentBase,prose:moment}]};
 const r=validateWrittenGameReview({pgn,review,userColor});
 assert.equal(r.status,status,name+' unexpected verdict '+JSON.stringify(r));
 assert.equal(r.verified.length,verified,name+' verified an imagined fact');
 const reasons=r.unassessed.map(x=>x.reason),findings=r.findings.map(x=>x.reason);
 if(reason)assert([...reasons,...findings].includes(reason),name+' did not record '+reason);
 for(const f of forbidden)assert(![...reasons,...findings].includes(f),name+' wrong reason '+f);
 if(uncertainRemainder!==null){
  assert.equal(reasons.includes('unchecked_prose_remainder'),uncertainRemainder,name+' unexpected unassessed span');
 }
 assert.equal(r.full_factuality_certified,false);
 resultsByCase.push({name,summary,moment,user_color:userColor,
  expected_status:status,observed_status:r.status,
  verified_count:r.verified.length,
  verified_types:r.verified.map(x=>x.type),
  findings,unassessed:reasons,
  full_factuality_certified:false});
}

// This first cohort would have been false *rejections* before the fix.
const falseResultAntecedents=[
 ['if', 'If White won the game, the result would be different.'],
 ['suppose', 'Suppose White won the game.'],
 ['suppose that', 'Suppose that White won the game.'],
 ['imagine', 'Imagine White won the game.'],
 ['imagine a world', 'Imagine a world where White won the game.'],
 ['assume that', 'Assume that White won the game.'],
 ['assuming', 'Assuming White won the game, what follows?'],
 ['pretend', 'Pretend White won the game.'],
 ['consider', 'Consider White won the game.'],
 ['what if', 'What if White won the game?'],
 ['hypothetical qualifier', 'Hypothetically White won the game.'],
 ['possibly', 'Possibly White won the game.'],
 ['maybe', 'Maybe White won the game.'],
 ['perhaps', 'Perhaps White won the game.'],
 ['allegedly', 'Allegedly White won the game.'],
 ['were it true', 'Were it true that White won the game, then what?'],
 ['interior if', 'The result would be different if White won the game.'],
 ['even if', 'Even if White won the game, this would be hypothetical.'],
 ['closing question', 'White won the game?'],
 ['trailing if', 'White won the game if Black resigned.'],
 ['trailing comma if', 'White won the game, if Black resigned.'],
 ['trailing dash if', 'White won the game — if Black resigned.'],
 ['trailing unless', 'White won the game unless the referee disagreed.'],
 ['trailing only if', 'White won the game only if Black resigned.'],
 ['trailing provided', 'White won the game provided that Black resigned.'],
 ['trailing parenthetical', 'White won the game (if Black resigned).'],
];
for(const [name,summary] of falseResultAntecedents){
 trial('false result '+name,{summary,status:'not_evaluated',verified:0,
  reason:modalResult,forbidden:['contradicted_game_winner']});
}

// Previously a direct true clause inside an explicit conditional could be
// misreported as a proved *product* fact, rather than an imagined antecedent.
for(const [name,summary] of [
 ['true if','If Black won the game, it would follow from checkmate.'],
 ['true suppose','Suppose Black won the game.'],
 ['true maybe','Maybe Black won the game.'],
 ['true imagine','Imagine Black won the game.'],
 ['true question','Black won the game?'],
 ['true trailing if','Black won the game if White misplayed.'],
 ['true only if','Black won the game only if White blundered.'],
])trial('true result conditional '+name,{summary,status:'not_evaluated',verified:0,reason:modalResult});

// A separate preceding direct sentence can still be checked. In contrast,
// multiple antecedents within the same conditional frame remain unassessed.
for(const [name,summary] of [
 ['direct then false antecedent','Black won the game. If White won the game, the lesson would differ.'],
 ['direct then true antecedent','Black won the game. Suppose Black won the game.'],
 ['direct then question','Black won the game. What if White won the game?'],
 ['direct then speculative maybe','Black won the game. Maybe White won the game.'],
 ['direct then hypothetical essay','Black won the game. Imagine a world where White won the game.'],
])trial('separate sentence '+name,{summary,status:'partial_claims_verified',
 verified:1,reason:modalResult,forbidden:['contradicted_game_winner']});
for(const [name,summary] of [
 ['conditional governs both','If White won the game, Black won the game too.'],
 ['conditional governs antecedent and second false','If Black won the game, White won the game too.'],
])trial('same sentence '+name,{summary,status:'not_evaluated',
 verified:0,reason:modalResult,forbidden:['contradicted_game_winner']});

// All of these are hypotheticals on the actual recorded g4 position, even
// where the hypothetical square happens to agree with legal game state.
for(const [name,moment] of [
 ['if false','If White\'s king is on e2, then the analysis would change.'],
 ['suppose false','Suppose White\'s king is on e2.'],
 ['imagine false','Imagine White\'s king is on e2.'],
 ['assume false','Assume that White\'s king is on e2.'],
 ['what if false','What if White\'s king is on e2?'],
 ['perhaps false','Perhaps White\'s king is on e2.'],
 ['interior if false','The evaluation would differ if White\'s king is on e2.'],
 ['trailing if false','White\'s king is on e2 if it moves from e1.'],
 ['trailing comma if false','White\'s king is on e2, if it moved from e1.'],
 ['if true','If White\'s king is on e1, the move may work.'],
 ['suppose true','Suppose White\'s king is on e1.'],
 ['true conditional question','White\'s king is on e1?'],
])trial('conditional piece '+name,{moment,status:'not_evaluated',
 verified:0,reason:modalPiece,forbidden:['contradicted_piece_location']});

// Clarify POV: the exact "you" and "opponent" expressions must not be
// evaluated as factual merely because a hypothetically asserted side won.
for(const [name,userColor,summary] of [
 ['white hypothetical win','white','If You won the game, what changed?'],
 ['white hypothetical loss','white','Suppose Your opponent lost this game.'],
 ['black hypothetical win','black','If You won this game, that would be notable.'],
 ['black hypothetical loss','black','Perhaps Your opponent won the game.'],
])trial('perspective '+name,{summary,userColor,status:'not_evaluated',
 verified:0,reason:modalResult,forbidden:['contradicted_game_winner']});

// Guard against over-abstention: direct unambiguous lies still *fail*, and
// direct recorded truths still have exactly one narrow independent proof.
for(const [name,summary,moment,status,reason] of [
 ['direct White false','White won the game.','','rejected','contradicted_game_winner'],
 ['direct Black true','Black won the game.','','limited_claims_passed',null],
 ['direct White lost','White lost this game.','','limited_claims_passed',null],
 ['direct Black lost','Black lost the game.','','rejected','contradicted_game_winner'],
 ['direct fake king','','White\'s king is on e2.','rejected','contradicted_piece_location'],
 ['direct actual king','','White\'s king is on e1.','limited_claims_passed',null],
 ['direct fake pawn','','White\'s pawn is on h8.','rejected','contradicted_piece_location'],
 ['direct actual pawn','','White\'s pawn is on g4.','limited_claims_passed',null],
])trial('direct contrast '+name,{summary,moment,status,verified:status==='limited_claims_passed'?1:0,
  reason,forbidden:[modalResult,modalPiece]});

// Question and direct assertion in the same review: only direct spans may
// count as proof; a fake separate direct sentence must still be rejected.
trial('direct contradiction after question',{summary:'What if White won the game? White won the game.',
 status:'rejected',verified:0,reason:'contradicted_game_winner'});
trial('direct truth after question',{summary:'What if White won the game? Black won the game.',
 status:'partial_claims_verified',verified:1,reason:modalResult});
trial('direct contradiction after hypothetical piece',{moment:
  'Suppose White\'s king is on e2. White\'s king is on e2.',
 status:'rejected',verified:0,reason:'contradicted_piece_location'});
trial('direct truth after hypothetical piece',{moment:
  'Suppose White\'s king is on e2. White\'s king is on e1.',
 status:'partial_claims_verified',verified:1,reason:modalPiece});

const counts={};for(const row of resultsByCase)counts[row.observed_status]=(counts[row.observed_status]||0)+1;
const report={schema_version:1,at_utc:new Date().toISOString(),run_id:runId,
  previous_checkpoint:'d75a77c1377b482b39e80b3329fb826ef5938aed',
  candidate_b_sha:'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87',
  manifest_sha256:sha(manifestFile),pgn_sha256:sha(pgnFile),fixture_id:fixture.fixture_id,
  source_kind:'self-authored synthetic four-ply Black checkmate',
  sample_count:resultsByCase.length,counts,cases:resultsByCase,
  checker_scope:'literal English conditionals and hypotheticals are abstained, only direct assertion verified',
  actual_LLM_calls:0,stockfish_calls:0,full_factuality_certified:false,
  release_approved:false,limitations:[
   'Finite explicit English modal/conditional triggers only; no natural language entailment',
   'Only one synthetic Fool\'s Mate, not a sealed human-adjudicated holdout',
   'No product source, user browser, real LLM, production data or live network',
   'Model-provided factual false claims in frozen backend remain a separate product blocker'
  ]};
const output=join(results,'coach-conditional-matrix.json');
writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,run_id:runId,samples:resultsByCase.length,counts,
  test_result:'pass',full_factuality_certified:false,release_approved:false},null,2));
