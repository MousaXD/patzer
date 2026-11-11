#!/usr/bin/env node
/** Source game ENDS when its first automatic terminal state occurs. Strict
 * chess.js PGN loading still accepts many post-fivefold/75/dead-position SAN
 * moves. Test QA must refuse later checkmate claims and fabricated outcomes.
 * Original synthetic games, no real users, Stockfish, or external model. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Chess} from 'chess.js';
import {validateWrittenGameReview} from './review-benchmark-coach-claim-adapter.mjs';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const results=join(qa,'results');mkdirSync(results,{recursive:true});
const args=Object.fromEntries(process.argv.slice(2).map(x=>{
 const at=x.indexOf('=');return at<0?[x.slice(2),true]:[x.slice(2,at),x.slice(at+1)];
}));
assert(Object.keys(args).every(x=>x==='run-id'));
const runId=args['run-id']||randomUUID();
assert(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(runId));
const sha=s=>createHash('sha256').update(s).digest('hex');
const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8');
assert.equal(sha(manifest),'2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44');
const fixture=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.source_kind==='synthetic'&&fixture.license==='self-authored');
assert.equal(sha(readFileSync(join(qa,'fixtures',fixture.pgn_file))),fixture.pgn_sha256);
const pgn=(title,moves,fen=null,result='*')=>[
 `[Event "QA ${title}"]`,
 ...(fen?['[SetUp "1"]',`[FEN "${fen}"]`]:[]),
 `[Result "${result}"]`,'',moves?moves+' '+result:result,
].join('\n');

const knights='Nf3 Nf6 Ng1 Ng8';
const cycle=n=>Array(n).fill(knights).join(' ');
const fauxMate='f3 e5 g4 Qh4#';
const foolMoves='1. f3 e5 2. g4 Qh4#';
const deadStart='8/8/8/8/8/8/8/K6k w - - 0 1';
const captureStart='8/8/5n2/8/8/6k1/7B/4K3 b - - 0 1';
const stalemateStart='k7/8/2K5/1Q6/8/8/8/8 w - - 0 1';
const stalemateEnd='k7/8/1QK5/8/8/8/8/8 b - - 0 1';
const mateBoard=new Chess();for(const san of ['f3','e5','g4','Qh4#'])mateBoard.move(san);
assert(mateBoard.isCheckmate());

function longReversibleSan(){
 const board=new Chess();let seed=1;
 const key=c=>c.fen().split(' ').slice(0,4).join(' ');
 const positions=new Map([[key(board),1]]);
 const out=[];
 for(let ply=1;ply<=150;ply++){
  const candidates=[];
  for(const m of board.moves({verbose:true})){
   if(m.piece==='p'||m.captured||m.promotion)continue;
   const next=new Chess(board.fen());next.move(m.san);
   if(next.isCheck()||next.isCheckmate()||next.isStalemate()||
    next.isInsufficientMaterial()||(positions.get(key(next))||0)>=4)continue;
   candidates.push(m.san);
  }
  assert(candidates.length>0,'bounded 150-ply synthetic sequence failed');
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  const san=candidates[seed%candidates.length];board.move(san);out.push(san);
  const k=key(board);positions.set(k,(positions.get(k)||0)+1);
 }
 assert.equal(board.history().length,150);
 assert.equal(board.fen().split(' ')[4],'150');
 assert(Math.max(...positions.values())<5);
 const beyond=[];
 for(let i=0;i<2;i++){
  const move=board.moves().find(s=>s==='Ne6')||board.moves()[0];
  assert(move,'chess.js refused post-75 legal continuation; no bug to reproduce');
  board.move(move);beyond.push(move);
 }
 return {out,beyond};
}
const long=longReversibleSan();
const formatMoves=arr=>{
 const turns=[];
 for(let i=0;i<arr.length;i+=2)turns.push(`${i/2+1}. ${arr[i]}${arr[i+1]?' '+arr[i+1]:''}`);
 return turns.join(' ');
};

// Hard-coded, reviewed type and FIRST termination (ply zero is meaningful).
// Unlike an end-position-only oracle, the earliest prior terminal state
// disqualifies an entire PGN even if a later checkmate is syntactically legal.
const sources=[
 {name:'fools-mate',moves:foolMoves,type:'mate'},
 {name:'mate-from-fen',moves:'',fen:mateBoard.fen(),type:'mate'},
 {name:'threefold-then-mate',moves:cycle(2)+' '+fauxMate,type:'mate'},
 {name:'fourfold-then-mate',moves:cycle(3)+' '+fauxMate,type:'mate'},
 {name:'threefold-then-quiet',moves:cycle(2)+' f3',type:'unfinished'},
 {name:'fourfold-then-quiet',moves:cycle(3)+' f3',type:'unfinished'},
 {name:'fivefold-exact',moves:cycle(4),type:'draw'},
 {name:'fivefold-unknown-result',moves:cycle(4),type:'draw'},
 {name:'fivefold-plus-quiet',moves:cycle(4)+' f3',type:'invalid',first:16,kind:'fivefold_repetition',later:1},
 {name:'fivefold-plus-two',moves:cycle(4)+' f3 e5',type:'invalid',first:16,kind:'fivefold_repetition',later:2},
 {name:'fivefold-then-mate',moves:cycle(4)+' '+fauxMate,type:'invalid',first:16,kind:'fivefold_repetition',later:4},
 {name:'sixfold-then-mate',moves:cycle(5)+' '+fauxMate,type:'invalid',first:16,kind:'fivefold_repetition',later:8},
 {name:'seventy-five-exact',moves:formatMoves(long.out),type:'draw'},
 {name:'seventy-five-unknown-result',moves:formatMoves(long.out),type:'draw'},
 {name:'seventy-five-plus-one',moves:formatMoves([...long.out,long.beyond[0]]),type:'invalid',first:150,kind:'seventy_five_move_rule',later:1},
 {name:'seventy-five-plus-two',moves:formatMoves([...long.out,...long.beyond]),type:'invalid',first:150,kind:'seventy_five_move_rule',later:2},
 {name:'dead-initial-exact',moves:'',fen:deadStart,type:'draw'},
 {name:'dead-initial-plus-one',moves:'1. Ka2',fen:deadStart,type:'invalid',first:0,kind:'dead_position',later:1},
 {name:'dead-capture-exact',moves:'1... Kxh2',fen:captureStart,type:'draw'},
 {name:'dead-capture-plus-one',moves:'1... Kxh2 2. Kf2',fen:captureStart,type:'invalid',first:1,kind:'dead_position',later:1},
 {name:'stalemate-exact',moves:'1. Qb6',fen:stalemateStart,type:'draw'},
 {name:'stalemate-initial-exact',moves:'',fen:stalemateEnd,type:'draw'},
];
assert.equal(new Set(sources.map(x=>x.name)).size,sources.length);
const cases=[];
for(const source of sources){
 const sourcePGN=pgn(source.name,source.moves,source.fen);
 const chess=new Chess();chess.loadPgn(sourcePGN,{strict:true});
 const history=chess.history();
 if(source.first!==undefined)assert(history.length>=source.first+source.later,
  'post-terminal sample missing its claimed subsequent SAN');
 for(const [claim,summary,userColor] of [
  ['white-winner','White won the game.','white'],
  ['black-winner','Black won the game.','white'],
  ['black-perspective','You won the game.','black'],
  ['no-claim','','white'],
 ]){
  const result=validateWrittenGameReview({pgn:sourcePGN,
   review:{language:'en',summary,key_moments:[]},userColor});
  const expected=source.type==='invalid'?'invalid_input':
   source.type==='mate'?(summary===''?'not_evaluated':
    claim==='white-winner'?'rejected':'limited_claims_passed'):
   source.type==='draw'?(summary?'rejected':'not_evaluated'):'not_evaluated';
  assert.equal(result.status,expected,source.name+'/'+claim+' '+JSON.stringify(result));
  let issue=null;
  if(source.type==='invalid'){
   assert.equal(result.findings.length,1);
   issue=result.findings[0];
   assert.deepEqual(issue,{reason:'source_continues_after_automatic_game_end',
    first_ending_ply:source.first,ending_kind:source.kind,later_moves:source.later});
   assert.deepEqual(result.verified,[]);
   assert.deepEqual(result.unassessed,[]);
  }else if(source.type==='mate'){
   assert(chess.isCheckmate());
   assert(!result.findings.some(x=>x.reason==='source_continues_after_automatic_game_end'));
  }else if(source.type==='draw'){
   assert(!chess.isCheckmate());
   assert(result.automatic_draw_proven_from_source);
  }else{
   assert(result.unassessed.some(x=>x.reason==='nonterminal_result_not_independently_verified'));
   assert.deepEqual(result.findings,[]);
  }
  assert.equal(result.full_factuality_certified,false);
  cases.push({name:source.name+' / '+claim,source:source.name,
   source_sha256:sha(sourcePGN),source_pgn:sourcePGN,
   source_type:source.type,plies:history.length,
   expected_first_ending_ply:source.first??null,
   expected_first_ending_kind:source.kind??null,
   expected_later_moves:source.later??null,
   claim,summary,user_color:userColor,
   expected_status:expected,observed_status:result.status,
   issue:issue||null,findings:result.findings.map(x=>x.reason),
   verified:result.verified.map(x=>x.type),
   unassessed:result.unassessed.map(x=>x.reason),
   full_factuality_certified:false});
 }
}
const counts={};for(const x of cases)counts[x.observed_status]=(counts[x.observed_status]||0)+1;
const packet={schema_version:1,at_utc:new Date().toISOString(),run_id:runId,
 prior_checkpoint:'1c9b07a334b1d9deda86473569f97e8d824ce66e',
 pinned_candidate_b:'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87',
 manifest_sha256:sha(manifest),fixture_id:fixture.fixture_id,
 case_count:cases.length,source_count:sources.length,counts,cases,
 chronology_contract:'first automatic terminal game position must be last recorded source position',
 original_synthetic_PGNs:true,real_model_calls:0,stockfish_calls:0,
 full_factuality_certified:false,release_approved:false};
const outfile=join(results,'game-end-chronology-matrix.json');
writeFileSync(outfile,JSON.stringify(packet,null,2)+'\n');
console.log(JSON.stringify({file:outfile,run_id:runId,source_count:sources.length,
 case_count:cases.length,counts,release_approved:false},null,2));
