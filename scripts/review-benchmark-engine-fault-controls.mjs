#!/usr/bin/env node
// Attacks the *production analyzer's UCI boundary* with a disposable fake engine.
// The real reference engine is deliberately a DIFFERENT pinned executable.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
let buffer='';
let current=new Chess().fen();
let pvCount=1;
const mode=process.env.PATZER_BENCH_FAULT_MODE||'bad-eval';
const out=s=>process.stdout.write(s+'\\n');
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
    const score=mode==='fake-mate'?'mate 1':'cp 700';
    out('info depth 8 multipv '+rank+' score '+score+' pv '+move);
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
 ['fake-mate','false_mate_in_one']
];
let passed=0;
const audit=[];
try{
 for(const [mode,expected] of cases){
  const output=join(temp,mode+'.json');
  const run=spawnSync(process.execPath,['--import','tsx','scripts/review-benchmark-real-app.mjs',
   '--engine='+path,'--reference-engine='+reference,'--reference-engine-sha256='+refHash,
   '--ids=SYN-GAME-BLACK-FIRST','--games=1','--depth=8','--out='+output],
  {cwd:root,encoding:'utf8',env:{...process.env,PATZER_BENCH_FAULT_MODE:mode},timeout:30000});
  if(run.error)throw run.error;
  if(run.status!==1)throw Error(mode+' did not fail (exit '+run.status+'): '+run.stderr+' '+run.stdout.slice(-1200));
  const report=JSON.parse(readFileSync(output,'utf8'));
  const reasons=report.failures.map(x=>x.reason);
  assert(reasons.includes(expected),mode+' missing '+expected+': '+JSON.stringify(reasons));
  passed++;
  audit.push({mode,expected,verified:true,observed:reasons});
  console.log('REJECTED real analyzer '+mode+' -> '+expected);
 }
 const proof={schema_version:1,reference_sha256:refHash,controls:cases.length,rejected:passed,results:audit,source:'live analyzer against disposable malicious UCI process'};
 writeFileSync(join(scratch,'fault-engine-summary.json'),JSON.stringify(proof,null,2)+'\n');
 console.log('PASS: '+passed+'/'+cases.length+' fake UCI engine corruptions rejected by independent reference');
} finally {
 rmSync(temp,{recursive:true,force:true});
}
