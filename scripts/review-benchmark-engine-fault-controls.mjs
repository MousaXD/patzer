#!/usr/bin/env node
// Attacks the *production analyzer's UCI boundary* with a disposable fake engine.
// The real reference engine is deliberately a DIFFERENT pinned executable.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Chess } from 'chess.js';
const root=resolve(import.meta.dirname,'..');
const scratch=join(root,'qa/review-excellence/results');
mkdirSync(scratch,{recursive:true});
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const i=arg.indexOf('=');return i>=0?[arg.slice(2,i),arg.slice(i+1)]:[arg.slice(2),true]}));
if(!args.reference)throw Error('Use --reference=/absolute/path/to/pinned-stockfish');
const reference=resolve(args.reference);
const refHash=createHash('sha256').update(readFileSync(reference)).digest('hex');
const temp=mkdtempSync(join(scratch,'fault-engine-'));
const path=join(temp,'fault-fish.mjs');
const code=`#!/usr/bin/env node
import { Chess } from 'chess.js';
import { appendFileSync } from 'node:fs';
let buffer='';
let current=new Chess().fen();
let pvCount=1;
const mode=process.env.PATZER_BENCH_FAULT_MODE||'bad-eval';
const out=s=>{
 if(process.env.PATZER_BENCH_UCI_LOG) appendFileSync(process.env.PATZER_BENCH_UCI_LOG,JSON.stringify({fen:current,line:s})+'\\n');
 process.stdout.write(s+'\\n');
};
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{
 buffer+=chunk;
 let at;
 while((at=buffer.indexOf('\\n'))>=0){
  const cmd=buffer.slice(0,at).trim();
  buffer=buffer.slice(at+1);
  if(cmd==='uci'){out('id name FaultFish test only');out('uciok');}
  else if(cmd==='isready')out('readyok');
  else if(cmd.startsWith('position fen '))current=cmd.slice(13);
  else if(cmd.startsWith('setoption name MultiPV value '))pvCount=Number(cmd.slice(29))||1;
  else if(cmd.startsWith('go ')){
   if(mode==='crash')process.exit(9);
   let game;
   try{game=new Chess(current);}catch{out('bestmove (none)');continue;}
   const legal=game.moves({verbose:true});
   const u=m=>m.from+m.to+(m.promotion||'');
   if(!legal.length){
    out(game.isCheckmate()?'info depth 0 multipv 1 score mate 0':'info depth 0 multipv 1 score cp 0');
    out('bestmove (none)');
    continue;
   }
   const line=mode==='illegal-pv'?'a1a8':u(legal[0]);
   for(let rank=1;rank<=Math.min(pvCount,legal.length);rank++){
    const move=rank===1?line:u(legal[rank-1]);
    const score=mode==='fake-mate'?'mate 1':mode==='illegal-continuation'?'cp '+(game.turn()==='b'?-405:405):'cp 700';
    const corruptTail=mode==='illegal-continuation'&&rank===1?' a1a8':'';
    out('info depth 8 multipv '+rank+' score '+score+' pv '+move+corruptTail);
   }
   out('bestmove '+line);
  } else if(cmd==='quit')process.exit(0);
 }
});`;
writeFileSync(path,code,{mode:0o700});
chmodSync(path,0o700);
const cases=[
 ['bad-eval','reference_evaluation_side_mismatch'],
 ['illegal-pv','missing_best_move_with_reference'],
 ['fake-mate','false_mate_in_one'],
 // The application can silently truncate an illegal second PV move while
 // retaining a legal best move. Only checking its serialized DTO is not enough.
 ['illegal-continuation','illegal_raw_uci_pv']
];
// Reproduce the previously frozen Batch 2 packet with --controls=3. The
// default four-control attack belongs to the next adversarial checkpoint.
const requestedControls=args.controls===undefined ? cases.length : Number(args.controls);
if(!Number.isInteger(requestedControls)||requestedControls<1||requestedControls>cases.length) {
 throw Error('controls must be in 1..'+cases.length);
}
function validateUciTranscript(filepath) {
 const failures=[];
 const rows=readFileSync(filepath,'utf8').trim().split('\n').map(JSON.parse);
 for(const row of rows) {
  const pv=row.line.match(/^info .+\bpv (.+)$/)?.[1];
  if(!pv)continue;
  const chess=new Chess(row.fen);
  for(const raw of pv.trim().split(/\s+/)) {
   let found=false;
   try {
    found=/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(raw)
      && Boolean(chess.move({from:raw.slice(0,2),to:raw.slice(2,4),...(raw.length===5?{promotion:raw[4]}:{})}));
   } catch {found=false;}
   if(!found) {failures.push({reason:'illegal_raw_uci_pv',fen:row.fen,move:raw});break;}
  }
 }
 return failures;
}
let passed=0;
const audit=[];
try{
 for(const [mode,expected] of cases.slice(0,requestedControls)){
  const output=join(temp,mode+'.json');
  const transcript=join(temp,mode+'.jsonl');
  const run=spawnSync(process.execPath,['--import','tsx','scripts/review-benchmark-real-app.mjs',
   '--engine='+path,'--reference-engine='+reference,'--reference-engine-sha256='+refHash,
   '--ids=SYN-GAME-BLACK-FIRST','--games=1','--depth=8','--negative-controls=off','--out='+output],
  {cwd:root,encoding:'utf8',env:{...process.env,PATZER_BENCH_FAULT_MODE:mode,PATZER_BENCH_UCI_LOG:transcript},timeout:30000});
  if(run.error)throw run.error;
  const report=JSON.parse(readFileSync(output,'utf8'));
  const dtoReasons=report.failures.map(x=>x.reason);
  const rawReasons=validateUciTranscript(transcript).map(x=>x.reason);
  const reasons=[...dtoReasons,...rawReasons];
  if(mode==='illegal-continuation') {
   // This is the adversarial point: the sanitized DTO can pass, yet the raw
   // engine made an illegal suggestion. The transcript must reject it.
   assert.equal(run.status,0,'expected sanitized DTO to hide late PV corruption');
  } else if(run.status!==1) {
   throw Error(mode+' did not fail (exit '+run.status+'): '+run.stderr+' '+run.stdout.slice(-1200));
  }
  assert(reasons.includes(expected),mode+' missing '+expected+': '+JSON.stringify(reasons));
  passed++;
  audit.push({mode,expected,verified:true,application_dto_passed:run.status===0,observed:reasons});
  console.log('REJECTED real analyzer '+mode+' -> '+expected);
 }
 const proof={schema_version:1,reference_sha256:refHash,controls:requestedControls,rejected:passed,results:audit,source:'live analyzer against disposable malicious UCI process'};
 writeFileSync(join(scratch,'fault-engine-summary.json'),JSON.stringify(proof,null,2)+'\n');
 console.log('PASS: '+passed+'/'+requestedControls+' fake UCI engine corruptions rejected by independent reference/raw legality');
} finally {
 rmSync(temp,{recursive:true,force:true});
}
