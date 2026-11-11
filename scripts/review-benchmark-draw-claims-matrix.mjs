#!/usr/bin/env node
/** Chess-law boundary: FIDE 9.2/9.3 *claimable* vs 9.6 automatic draws.
 * All PGNs are original deterministic synthetic fixtures. No model or engine
 * call, web request, user game or production database access. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Chess} from 'chess.js';
import {validateWrittenGameReview} from './review-benchmark-coach-claim-adapter.mjs';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence');
const outputDir=join(qa,'results');
mkdirSync(outputDir,{recursive:true});
const arg=Object.fromEntries(process.argv.slice(2).map(a=>{
 const i=a.indexOf('=');return i<0?[a.slice(2),true]:[a.slice(2,i),a.slice(i+1)];
}));
assert(Object.keys(arg).every(x=>x==='run-id'),'unexpected CLI argument');
const runId=arg['run-id']||randomUUID();
assert(/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(runId));
const hash=s=>createHash('sha256').update(s).digest('hex');
const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8');
assert.equal(hash(manifest),'2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44');
const fixture=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.license==='self-authored'&&fixture.source_kind==='synthetic');
const original=readFileSync(join(qa,'fixtures',fixture.pgn_file),'utf8');
assert.equal(hash(original),fixture.pgn_sha256);
function pgn(name,result,moves,fen){
 return [`[Event "QA ${name}"]`,
  ...(fen?['[SetUp "1"]',`[FEN "${fen}"]`]:[]),
  `[Result "${result}"]`,'',moves+' '+result].join('\n');
}
function countRepetitions(game){
 const history=game.history({verbose:true});
 const keys=history.length?[history[0].before,...history.map(x=>x.after)]:[game.fen()];
 const seen=new Map();
 let max=0;
 for(const fen of keys){
  const key=fen.split(' ').slice(0,4).join(' ');
  const n=(seen.get(key)||0)+1;seen.set(key,n);max=Math.max(max,n);
 }
 return max;
}
function makeLongReversibleGame(){
 // Choose original, deterministic legal moves, excluding checks, captures,
 // pawn moves, auto-draw repetition and insufficient material. This is a
 // synthetic *source record*, not an optimization/engine run. The real
 // recorded 100th and 150th halfmoves are required for the separate tests.
 const chess=new Chess();
 let x=1;
 const seen=new Map();const key=c=>c.fen().split(' ').slice(0,4).join(' ');
 seen.set(key(chess),1);
 const san=[];
 for(let ply=1;ply<=150;ply++){
  const eligible=[];
  for(const m of chess.moves({verbose:true})){
   if(m.piece==='p'||m.captured||m.promotion)continue;
   const next=new Chess(chess.fen());
   next.move(m.san);
   if(next.isCheck()||next.isCheckmate()||next.isStalemate()||
     next.isInsufficientMaterial()||(seen.get(key(next))||0)>=4)continue;
   eligible.push(m.san);
  }
  assert(eligible.length>0,'bounded synthetic PGN cannot reach 150 legal reversible plies');
  x=(Math.imul(x,1664525)+1013904223)>>>0;
  const choice=eligible[x%eligible.length];
  chess.move(choice);san.push(choice);
  const k=key(chess);seen.set(k,(seen.get(k)||0)+1);
 }
 assert.equal(chess.history().length,150);
 assert.equal(Number(chess.fen().split(' ')[4]),150);
 assert(Math.max(...seen.values())<5,'fivefold auto draw obscures 75-move control');
 const out=[];
 for(let i=0;i<san.length;i+=2)out.push(`${i/2+1}. ${san[i]} ${san[i+1]}`);
 return {moves:out.join(' '),maxPositionCount:Math.max(...seen.values()),san};
}
const long=makeLongReversibleGame();
const records={
 'repetition-2':pgn('twofold','1-0','Nf3 Nf6 Ng1 Ng8'),
 'repetition-3':pgn('threefold claimable','1-0',Array(2).fill('Nf3 Nf6 Ng1 Ng8').join(' ')),
 'repetition-4':pgn('fourfold claimable','1-0',Array(3).fill('Nf3 Nf6 Ng1 Ng8').join(' ')),
 'repetition-5':pgn('fivefold automatic','1-0',Array(4).fill('Nf3 Nf6 Ng1 Ng8').join(' ')),
 'repetition-5-draw':pgn('fivefold correct result','1/2-1/2',Array(4).fill('Nf3 Nf6 Ng1 Ng8').join(' ')),
 'repetition-5-unknown':pgn('fivefold unknown result','*',Array(4).fill('Nf3 Nf6 Ng1 Ng8').join(' ')),
 'halfmove-99':pgn('FEN halfmove 99','1-0','51. Ra2','8/8/8/8/8/6k1/8/R5K1 w - - 98 51'),
 'halfmove-100':pgn('FEN halfmove 100 claimable','1-0','51. Ra2','8/8/8/8/8/6k1/8/R5K1 w - - 99 51'),
 'halfmove-149':pgn('FEN halfmove 149','1-0','51. Ra2','8/8/8/8/8/6k1/8/R5K1 w - - 148 51'),
 'halfmove-150-unproven':pgn('FEN 150 not independently replayed','1-0','51. Ra2','8/8/8/8/8/6k1/8/R5K1 w - - 149 51'),
 'halfmove-151-unproven':pgn('FEN 151 not independently replayed','1-0','51. Ra2','8/8/8/8/8/6k1/8/R5K1 w - - 150 51'),
 'full-150':pgn('150 legal reversible halfmoves','1-0',long.moves),
 'full-150-draw':pgn('150 reversible halfmoves draw','1/2-1/2',long.moves),
 'full-150-unknown':pgn('150 reversible halfmoves unspecified','*',long.moves),
};
// Derive the two 149/99-prefixes from the source SAN array to avoid accidental
// move-boundary errors in the hand-assembled test PGNs.
const prefix=(count)=>{
 const lines=[];for(let i=0;i<count;i+=2)
  lines.push(`${i/2+1}. ${long.san[i]}${i+1<count?' '+long.san[i+1]:''}`);
 return lines.join(' ');
};
records['full-99']=pgn('99 reversible halfmoves', '1-0', prefix(99));
records['full-100']=pgn('100 reversible halfmoves', '1-0', prefix(100));
records['full-149']=pgn('149 reversible halfmoves', '1-0', prefix(149));

const expectedClassification={
 'repetition-2':{repeats:2,auto:false,claim:false},
 'repetition-3':{repeats:3,auto:false,claim:true},
 'repetition-4':{repeats:4,auto:false,claim:true},
 'repetition-5':{repeats:5,auto:true,claim:false},
 'repetition-5-draw':{repeats:5,auto:true,claim:false},
 'repetition-5-unknown':{repeats:5,auto:true,claim:false},
 'halfmove-99':{auto:false,claim:false},
 'halfmove-100':{auto:false,claim:true},
 'halfmove-149':{auto:false,claim:true},
 'halfmove-150-unproven':{auto:false,claim:true},
 'halfmove-151-unproven':{auto:false,claim:true},
 'full-99':{auto:false,claim:false},
 'full-100':{auto:false,claim:true},
 'full-149':{auto:false,claim:true},
 'full-150':{auto:true,claim:false},
 'full-150-draw':{auto:true,claim:false},
 'full-150-unknown':{auto:true,claim:false},
};
assert.deepEqual(Object.keys(records).sort(),Object.keys(expectedClassification).sort());
const rows=[];
for(const [source,record] of Object.entries(records)){
 const chess=new Chess();chess.loadPgn(record,{strict:true});
 const history=chess.history({verbose:true});
 const type=expectedClassification[source];
 if(type.repeats!==undefined)assert.equal(countRepetitions(chess),type.repeats,source);
 assert(!chess.isCheckmate()&&!chess.isStalemate()&&!chess.isInsufficientMaterial(),
  source+' is confounded by automatic board draw');
 const variants=[['white winner','White won the game.','white'],
  ['black winner','Black won the game.','white'],
  ['user white won','You won the game.','white'],
  ['user black won','You won the game.','black'],
  ['no statement','', 'white']];
 for(const [label,summary,userColor] of variants){
  const review={language:'en',summary,key_moments:[]};
  const check=validateWrittenGameReview({pgn:record,review,userColor});
  const explicitDecisiveTag=['1-0','0-1'].includes(chess.header().Result);
  const want=type.auto&&(summary||explicitDecisiveTag)?'rejected':'not_evaluated';
  assert.equal(check.status,want,source+'/'+label+': '+JSON.stringify(check));
  assert.equal(check.result_proven_by_mate,false);
  assert.equal(check.draw_proven_by_board,false,'board alone does not prove repetition/clock');
  assert.equal(check.automatic_draw_proven_from_source,type.auto,source);
  assert.equal(check.draw_claimable_only,type.claim,source);
  assert.equal(check.automatic_fivefold_replay,source.startsWith('repetition-5'),source);
  assert.equal(check.automatic_seventy_five_replay,source.startsWith('full-150'),source);
  if(source.startsWith('halfmove-'))assert.equal(check.max_source_reversible_halfmoves,1,
   'imported FEN history must not masquerade as replayed 150 halfmoves');
  if(source.startsWith('full-'))assert.equal(check.max_source_reversible_halfmoves,history.length,
   'history must count only recorded reversible moves');
  const reasons=check.findings.map(x=>x.reason);
  if(type.auto){
   if(summary)assert(reasons.includes('contradicted_terminal_draw_winner'),source);
   if(['1-0','0-1'].includes(chess.header().Result))
    assert(reasons.includes('pgn_result_conflicts_with_terminal_draw'),source);
  } else {
   assert.deepEqual(reasons,[],source+'/'+label);
   if(summary)assert(check.unassessed.some(x=>x.reason==='winner_not_independently_proven_from_nonterminal_pgn'));
   if(type.claim)assert(check.unassessed.some(x=>x.reason==='claimable_draw_not_automatic_without_recorded_claim'));
  }
  assert.equal(check.full_factuality_certified,false);
  rows.push({name:source+' / '+label,source,source_sha256:hash(record),
   source_pgn:record,game_result_header:chess.header().Result||null,
   source_plies:history.length,library_draw:chess.isDraw(),
   library_threefold:chess.isThreefoldRepetition(),library_fifty:chess.isDrawByFiftyMoves(),
   source_repetitions:countRepetitions(chess),
   summary,user_color:userColor,
   verdict_expected:want,verdict_observed:check.status,
   findings:reasons,unassessed:check.unassessed.map(x=>x.reason),
   automatic_draw_from_replay:check.automatic_draw_proven_from_source,
   claimable_only:check.draw_claimable_only,
   automatic_fivefold:check.automatic_fivefold_replay,
   automatic_seventy_five:check.automatic_seventy_five_replay,
   source_reversible_halfmoves:check.max_source_reversible_halfmoves,
   board_proven_draw:check.draw_proven_by_board,
   full_factuality_certified:false});
 }
}
const counts={};for(const x of rows)counts[x.verdict_observed]=(counts[x.verdict_observed]||0)+1;
const result={schema_version:1,at_utc:new Date().toISOString(),run_id:runId,
 previous_checkpoint:'cde9b81030bf64367953b865f78bd251a2461571',
 fixture_id:fixture.fixture_id,manifest_sha256:hash(manifest),
 candidate_b_source:'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87',
 source_game_count:Object.keys(records).length,
 long_reversible_game_plies:150,long_game_max_repetition:long.maxPositionCount,
 case_count:rows.length,counts,cases:rows,
 rules_reference:'FIDE Laws of Chess 2023 Arts 9.2-9.3 claimable, 9.6 fivefold/75 automatic',
 source_kind:'self-authored synthetic legal chess, no real player',
 stockfish_calls:0,external_model_calls:0,
 full_factuality_certified:false,release_approved:false};
const outfile=join(outputDir,'coach-draw-claims-matrix.json');
writeFileSync(outfile,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({file:outfile,run_id:runId,
  source_game_count:result.source_game_count,cases:rows.length,counts,
  long_reversible_game_plies:150,release_approved:false},null,2));
