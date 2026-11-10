#!/usr/bin/env node
/**
 * QA-only lossless UCI tee. Used exclusively in disposable real-app runs.
 * It forwards the unmodified command and response byte streams while logging
 * each engine response with the independently received source FEN.
 * No production code, DB, application API, or provider is changed.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, writeSync, closeSync, realpathSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, join } from 'node:path';

const root=resolve(import.meta.dirname,'..');
const safeRoot=join(root,'qa/review-excellence/results');
const target=process.env.PATZER_BENCH_PROXY_TARGET;
const dir=process.env.PATZER_BENCH_PROXY_TRACE_DIR;
if(!target||!dir) {
 console.error('UCI QA proxy requires PATZER_BENCH_PROXY_TARGET and PATZER_BENCH_PROXY_TRACE_DIR');
 process.exit(2);
}
const logDir=resolve(dir);
if(!logDir.startsWith(safeRoot+'/')) {
 console.error('UCI QA proxy trace location must be under ignored qa/review-excellence/results');
 process.exit(2);
}
mkdirSync(logDir,{recursive:true});
const logFd=openSync(join(logDir,'uci-'+process.pid+'-'+randomBytes(4).toString('hex')+'.jsonl'),'wx',0o600);
const child=spawn(realpathSync(target),[],{stdio:['pipe','pipe','pipe']});
let currentFen=null,sequence=0,commands='',answers='',closed=false;
function record(item) {writeSync(logFd,JSON.stringify({pid:process.pid,...item})+'\n');}
record({direction:'metadata',engine_binary:target});
function consume(chunk,direction) {
 let buffer=(direction==='command'?commands:answers)+chunk;
 let cut;
 while((cut=buffer.indexOf('\n'))>=0) {
  const line=buffer.slice(0,cut).replace(/\r$/,'');
  buffer=buffer.slice(cut+1);
  if(direction==='command') {
   if(line.startsWith('position fen '))currentFen=line.slice('position fen '.length);
   else if(line==='position startpos')currentFen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
   if(line.startsWith('go '))sequence++;
   if(line.startsWith('position ')||line.startsWith('go ')||line.startsWith('setoption '))record({direction:'command',sequence,fen:currentFen,line});
  } else if(line.startsWith('info ')||line.startsWith('bestmove ')||line.startsWith('id name ')) {
   record({direction:'engine',sequence,fen:currentFen,line});
  }
 }
 if(direction==='command')commands=buffer;else answers=buffer;
}
process.stdin.on('data',d=>{consume(String(d),'command');if(child.stdin.writable)child.stdin.write(d);});
process.stdin.on('end',()=>{if(child.stdin.writable)child.stdin.end();});
child.stdout.on('data',d=>{consume(String(d),'engine');process.stdout.write(d);});
child.stderr.on('data',d=>process.stderr.write(d));
child.on('error',error=>{record({direction:'error',message:error.message});process.exitCode=3;});
child.on('close',(code,signal)=>{
 if(closed)return;
 closed=true;
 record({direction:'exit',code,signal});
 closeSync(logFd);
 process.exit(code==null?3:code);
});
process.on('SIGTERM',()=>{if(!closed)child.kill('SIGTERM');});
process.on('SIGINT',()=>{if(!closed)child.kill('SIGINT');});
