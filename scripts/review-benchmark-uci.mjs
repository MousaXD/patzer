#!/usr/bin/env node
// Direct UCI experiment independent from Patzer's Stockfish wrapper.
// Offline, one process, pinned depth/threads/hash/MultiPV, bounded timeout.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { cpus, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { Chess } from 'chess.js';
const root=resolve(import.meta.dirname,'..');
const outDir=join(root,'qa/review-excellence/results');
mkdirSync(outDir,{recursive:true});
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return i<0?[v.slice(2),true]:[v.slice(2,i),v.slice(i+1)];}));
if(!args.engine) throw Error('Usage: node scripts/review-benchmark-uci.mjs --engine=/absolute/path');
const enginePath=realpathSync(args.engine);
const hash=createHash('sha256').update(readFileSync(enginePath)).digest('hex');
if(args.sha256 && hash!==args.sha256)throw Error('engine binary SHA256 mismatch');
const depth=Number(args.depth||8);
const trials=Number(args.trials||3);
if(!Number.isInteger(depth)||depth<4||depth>14||!Number.isInteger(trials)||trials<1||trials>5)throw Error('bounded depth 4..14 and trials 1..5');
const positions=[
 ['black_to_move_advantage','6k1/5ppp/8/8/8/8/5PPP/3Q2K1 b - - 0 1'],
 ['forced_king_reply','4k3/5p2/8/8/8/8/8/K2QR3 b - - 0 1'],
 ['promotion','7k/P7/8/8/8/8/8/K7 w - - 0 1']
].slice(0,Number(args.positions||3));
const proc=spawn(enginePath,[],{stdio:['pipe','pipe','pipe'],env:process.env});
const rl=createInterface({input:proc.stdout});
proc.stderr.resume();
const subscribers=new Set();
rl.on('line',line=>{ for(const fn of [...subscribers])fn(line); });
let died=false;
proc.on('exit',()=>{died=true;for(const fn of [...subscribers])fn('##EXIT##');});
let name='unknown';
function command(cmd,stop,ms=10000,collect=()=>{}) {
 return new Promise((res,rej)=>{
  let completed=false;
  const done=(err,line)=>{
   if(completed)return;
   completed=true; clearTimeout(timer);subscribers.delete(cb);
   if(err)rej(err);else res(line);
  };
  const cb=line=>{
   if(line==='##EXIT##') return done(Error('engine_terminated'));
   collect(line);
   if(stop(line))done(null,line);
  };
  const timer=setTimeout(()=>done(Error('UCI timeout: '+cmd)),ms);
  subscribers.add(cb);
  proc.stdin.write(cmd+'\n',err=>{if(err)done(err);});
 });
}
const before=()=> {
 let cpuTicks=null,peakRSSBytes=null;
 try {
  const stat=readFileSync('/proc/'+proc.pid+'/stat','utf8');
  const fields=stat.slice(stat.lastIndexOf(')')+2).trim().split(' ');
  cpuTicks=Number(fields[11])+Number(fields[12]);
  const status=readFileSync('/proc/'+proc.pid+'/status','utf8');
  peakRSSBytes=Number(status.match(/^VmHWM:\s+(\d+) kB/m)?.[1]||0)*1024||null;
 } catch {}
 return {cpuTicks,peakRSSBytes};
};
const report={schema_version:1,at_utc:new Date().toISOString(),
 engine_sha256:hash,engine_name:null,engine_version:null,
 engine_config:{threads:1,hash_mib:16,multipv:3,limit:'depth',depth,trials},
 environment:{platform:platform(),release:release(),cpu:cpus()[0]?.model},
 searches:[],failures:[], notes:['Direct engine-process measurements; not Node application process',
 'Search depth is an engine budget, not human-reviewed move quality']};
const clockTicks=Number(execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'}).trim())||100;
try{
 await command('uci',s=>s==='uciok',10000,line=>{if(line.startsWith('id name '))name=line.slice(8);});
 report.engine_name=name;
 report.engine_version=name.match(/Stockfish\s+([\d.]+)/)?.[1]||'unreported';
 await command('isready',s=>s==='readyok');
 for(const [option,value] of [['Threads',1],['Hash',16],['MultiPV',3]]){
  proc.stdin.write('setoption name '+option+' value '+value+'\n');
 }
 await command('isready',s=>s==='readyok');
 for(const [id,fen] of positions){
  for(let trial=1;trial<=trials;trial++){
   proc.stdin.write('ucinewgame\n');
   await command('isready',s=>s==='readyok');
   proc.stdin.write('position fen '+fen+'\n');
   const info=new Map();
   const prior=before();
   const start=performance.now();
   let bestmove=null;
   const final=await command('go depth '+depth,s=>s.startsWith('bestmove '),20000,line=>{
    if(!line.startsWith('info depth '))return;
    const rank=Number(line.match(/\bmultipv (\d+)\b/)?.[1]||1);
    const reachedDepth=Number(line.match(/\bdepth (\d+)\b/)?.[1]||0);
    const scoreKind=line.match(/\bscore (cp|mate) (-?\d+)\b/);
    if(!scoreKind || line.includes(' lowerbound') || line.includes(' upperbound'))return;
    const tokens=line.match(/\bpv (.+)$/)?.[1]?.split(/\s+/)||[];
    info.set(rank,{rank,depth:reachedDepth,score_kind:scoreKind[1],score:Number(scoreKind[2]),
     nodes:Number(line.match(/\bnodes (\d+)\b/)?.[1]||0),
     nps:Number(line.match(/\bnps (\d+)\b/)?.[1]||0),
     engine_time_ms:Number(line.match(/\btime (\d+)\b/)?.[1]||0),pv:tokens});
   });
   bestmove=final.split(' ')[1];
   const elapsed_ms=Math.round(performance.now()-start);
   const after=before();
   const variation=info.get(1);
   if(!variation || variation.depth<depth)report.failures.push({id,trial,reason:'insufficient_depth'});
   const legal=new Chess(fen);
   if(bestmove && bestmove!=='(none)'){
    try{if(!legal.move({from:bestmove.slice(0,2),to:bestmove.slice(2,4),...(bestmove.length===5?{promotion:bestmove[4]}:{})}))throw Error('bad');}
    catch{report.failures.push({id,trial,reason:'illegal_bestmove'});}
   }
   for(const candidate of info.values()){
    const pvBoard=new Chess(fen);
    for(const u of candidate.pv){
     try{if(!pvBoard.move({from:u.slice(0,2),to:u.slice(2,4),...(u.length===5?{promotion:u[4]}:{})}))throw Error('bad');}
     catch{report.failures.push({id,trial,reason:'illegal_pv',rank:candidate.rank});break;}
    }
   }
   report.searches.push({id,trial,bestmove,elapsed_ms,
    engine_cpu_ms:(prior.cpuTicks!==null&&after.cpuTicks!==null)?Math.round((after.cpuTicks-prior.cpuTicks)/clockTicks*1000):null,
    engine_peak_rss_bytes:after.peakRSSBytes,lines:Array.from(info.values()).sort((a,b)=>a.rank-b.rank)});
  }
 }
 const perPosition={};
 for(const [id] of positions) {
  const group=report.searches.filter(x=>x.id===id), scores=group.map(x=>x.lines[0]?.score).filter(Number.isFinite);
  perPosition[id]={n:group.length,score_range: scores.length?Math.max(...scores)-Math.min(...scores):null,
   distinct_best_moves:[...new Set(group.map(x=>x.bestmove))],
   mean_elapsed_ms:Math.round(group.reduce((n,x)=>n+x.elapsed_ms,0)/group.length)};
 }
 report.summary={searches:report.searches.length,per_position:perPosition,failures:report.failures.length};
} finally {
 try{proc.stdin.write('quit\n');}catch{}
 const done=new Promise(resolve=>proc.once('exit',resolve));
 await Promise.race([done,new Promise(resolve=>setTimeout(resolve,1000))]);
 if(!died)proc.kill('SIGKILL');
}
const dest=resolve(args.out||join(outDir,'uci-reference.json'));
if(!dest.startsWith(outDir+'/'))throw Error('output must be in ignored QA results');
writeFileSync(dest,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({engine_sha256:report.engine_sha256,name:report.engine_name,config:report.engine_config,summary:report.summary,first_samples:report.searches.slice(0,2),report_path:dest},null,2));
if(report.failures.length)process.exitCode=1;
