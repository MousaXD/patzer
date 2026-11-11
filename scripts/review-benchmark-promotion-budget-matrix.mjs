#!/usr/bin/env node
/** Self-authored synthetic PGNs. A missing pawn must fund each surplus
 * promoted piece; a second bishop on the same square color also requires
 * promotion. Necessary historical inventory checks only, not retrograde QA. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Chess} from 'chess.js';
import {validateWrittenGameReview} from './review-benchmark-coach-claim-adapter.mjs';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const results=join(qa,'results');mkdirSync(results,{recursive:true});
const opts=Object.fromEntries(process.argv.slice(2).map(s=>{
 const i=s.indexOf('=');return i<0?[s.slice(2),true]:[s.slice(2,i),s.slice(i+1)];
}));
assert(Object.keys(opts).every(k=>k==='run-id'));
const runId=opts['run-id']||randomUUID();
assert(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(runId));
const sha=s=>createHash('sha256').update(s).digest('hex');
const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8');
assert.equal(sha(manifest),'2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44');
const oldFixture=manifest.trim().split('\n').map(JSON.parse).find(f=>f.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(oldFixture?.source_kind==='synthetic'&&oldFixture.license==='self-authored');
assert.equal(sha(readFileSync(join(qa,'fixtures',oldFixture.pgn_file))),oldFixture.pgn_sha256);

const S=(name,color,pawns,pieces,expect)=>({name,color,pawns,pieces,expect});
const cases=[
 S('white-8p-three-rooks','w',8,'RRR','invalid'),
 S('white-7p-four-rooks','w',7,'RRRR','invalid'),
 S('white-8p-two-queens','w',8,'QQ','invalid'),
 S('white-7p-three-queens','w',7,'QQQ','invalid'),
 S('white-8p-three-knights','w',8,'NNN','invalid'),
 S('white-8p-two-same-color-bishops','w',8,'BB','invalid'),
 S('white-7p-three-same-color-bishops','w',7,'BBB','invalid'),
 S('white-8p-three-mixed-color-bishops','w',8,'BBC','invalid'),
 S('white-7p-two-queens-three-rooks','w',7,'QQRRR','invalid'),
 S('white-6p-three-queens-three-rooks','w',6,'QQQRRR','invalid'),
 S('black-8p-three-rooks','b',8,'RRR','invalid'),
 S('black-8p-two-queens','b',8,'QQ','invalid'),
 S('black-8p-three-knights','b',8,'NNN','invalid'),
 S('black-8p-two-same-color-bishops','b',8,'BB','invalid'),
 S('black-7p-three-same-color-bishops','b',7,'BBB','invalid'),
 S('black-7p-two-queens-three-rooks','b',7,'QQRRR','invalid'),
 S('black-6p-three-queens-three-rooks','b',6,'QQQRRR','invalid'),
 S('white-7p-three-rooks','w',7,'RRR','valid'),
 S('white-6p-four-rooks','w',6,'RRRR','valid'),
 S('white-7p-two-queens','w',7,'QQ','valid'),
 S('white-6p-three-queens','w',6,'QQQ','valid'),
 S('white-7p-three-knights','w',7,'NNN','valid'),
 S('white-7p-two-same-color-bishops','w',7,'BB','valid'),
 S('white-6p-three-same-color-bishops','w',6,'BBB','valid'),
 S('white-8p-two-opposite-color-bishops','w',8,'BC','valid'),
 S('white-7p-three-mixed-color-bishops','w',7,'BBC','valid'),
 S('white-6p-two-queens-three-rooks','w',6,'QQRRR','valid'),
 S('white-5p-three-queens-three-rooks','w',5,'QQQRRR','valid'),
 S('black-7p-three-rooks','b',7,'RRR','valid'),
 S('black-7p-two-queens','b',7,'QQ','valid'),
 S('black-7p-three-knights','b',7,'NNN','valid'),
 S('black-7p-two-same-color-bishops','b',7,'BB','valid'),
 S('black-6p-three-same-color-bishops','b',6,'BBB','valid'),
 S('black-6p-two-queens-three-rooks','b',6,'QQRRR','valid'),
 S('black-5p-three-queens-three-rooks','b',5,'QQQRRR','valid'),
 S('white-0p-three-queens','w',0,'QQQ','valid'),
];
assert.equal(cases.length,36);
assert.equal(new Set(cases.map(x=>x.name)).size,cases.length);
// For the dedicated FEN fixtures, the piece letters are placed on known
// non-attacking source squares, avoiding incidental non-moving-king check.
// The "B" bishops all occupy one color; the "C" bishop has the other.
function createFen({color,pawns,pieces}){
 const board=Array.from({length:8},()=>Array(8).fill(null));
 const put=(s,kind)=>{
  const f=s.charCodeAt(0)-97,r=Number(s[1])-1;
  assert(!board[r][f],'piece collision at '+s);
  board[r][f]=kind;
 };
 put('e1','K');put('h8','k');
 for(let i=0;i<pawns;i++)put('abcdefgh'[i]+(color==='w'?'2':'7'),
  color==='w'?'P':'p');
 const positions=color==='w'?{
  R:['a3','b3','c3','d3'],Q:['a4','b4','c4','d4'],
  N:['a3','b3','c3','d3'],B:['b1','d1','f1'],C:['c1'],
 }:{
  R:['a6','b6','c6','d6'],Q:['a5','b5','c5','d5'],
  N:['a6','b6','c6','d6'],B:['b8','d8','f8'],C:['c8'],
 };
 const cursors={R:0,Q:0,N:0,B:0,C:0};
 for(const piece of pieces){
  const list=positions[piece];
  const square=list?.[cursors[piece]++];
  assert(square,'no material placement for '+piece);
  put(square,color==='w'?(piece==='C'?'B':piece):(piece==='C'?'b':piece.toLowerCase()));
 }
 return board.map(row=>{
  let raw='',empty=0;
  for(const piece of row){
   if(!piece)empty++;
   else{if(empty)raw+=String(empty);empty=0;raw+=piece;}
  }
  if(empty)raw+=String(empty);
  return raw;
 }).reverse().join('/')+' w - - 0 1';
}
const rows=[];
for(const s of cases){
 const fen=createFen(s);
 const pgn=`[Event "QA synthetic ${s.name}"]\n[SetUp "1"]\n[FEN "${fen}"]\n[Result "*"]\n\n*`;
 const game=new Chess();game.loadPgn(pgn,{strict:true});
 assert.equal(game.fen(),fen,'strict chess reader unexpectedly normalized the FEN');
 assert.equal(game.isCheckmate(),false);
 assert.equal(game.isStalemate(),false);
 assert.equal(game.isInsufficientMaterial(),false);
 for(const [claim,summary] of [
  ['white-winner','White won the game.'],
  ['black-winner','Black won the game.'],
  ['no-claim',''],
 ]){
  const verdict=validateWrittenGameReview({pgn,
   review:{language:'en',summary,key_moments:[]}});
  const expected=s.expect==='invalid'?'invalid_input':'not_evaluated';
  assert.equal(verdict.status,expected,s.name+'/'+claim+' '+JSON.stringify(verdict));
  if(expected==='invalid_input'){
   assert.deepEqual(verdict.findings,[{reason:'source_start_position_impossible',
    detail:'missing_pawn_promotion_budget'}]);
   assert.deepEqual(verdict.verified,[]);
  }else{
   assert.deepEqual(verdict.findings,[]);
   assert(verdict.unassessed.some(x=>x.reason==='nonterminal_result_not_independently_verified'));
  }
  assert.equal(verdict.full_factuality_certified,false);
  rows.push({name:s.name+' / '+claim,source:s.name,source_sha256:sha(pgn),
   source_pgn:pgn,initial_fen:fen,pawn_count:s.pawns,source_side:s.color,
   source_pieces:s.pieces,source_expectation:s.expect,
   claim,summary,baseline_strict_pgn_loaded:true,
   expected_status:expected,observed_status:verdict.status,
   findings:verdict.findings,verified:verdict.verified,
   unassessed:verdict.unassessed.map(x=>x.reason),
   full_factuality_certified:false});
 }
}
const counts={};for(const x of rows)counts[x.observed_status]=(counts[x.observed_status]||0)+1;
const packet={schema_version:1,created_at:new Date().toISOString(),run_id:runId,
 previous_checkpoint:'f88519629491f709030caf9f595666e431e457af',
 pinned_agent_b:'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87',
 original_fixture:oldFixture.fixture_id,manifest_sha256:sha(manifest),
 source_games:cases.length,case_count:rows.length,counts,cases:rows,
 provenance:'self-authored synthetic standard-chess FEN inventory only',
 no_retrograde_certification:true,real_model_requests:0,stockfish_calls:0,
 release_approved:false,full_factuality_certified:false};
const out=join(results,'coach-promotion-budget-matrix.json');
writeFileSync(out,JSON.stringify(packet,null,2)+'\n');
console.log(JSON.stringify({file:out,run_id:runId,
 source_games:packet.source_games,case_count:packet.case_count,
 counts,release_approved:false},null,2));
