/**
 * Independent, benchmark-owned UCI referee.
 *
 * Deliberately imports NO Patzer engine, analysis, classification, cache or
 * database module. This prevents a candidate's Stockfish wrapper bug from
 * contaminating both the tested analysis and its reference evaluator.
 */
import { spawn } from 'node:child_process';
import { Chess } from 'chess.js';

export class ReferenceUci {
 constructor(binary) {
  if(typeof binary!=='string'||!binary.startsWith('/'))throw Error('reference binary must be an absolute path');
  this.binary=binary;
  this.proc=null;
  this.buffer='';
  this.listeners=new Set();
  this.engineName='unknown';
  this.dead=true;
 }
 async start() {
  if(this.proc)throw Error('reference already started');
  const child=spawn(this.binary,[],{stdio:['pipe','pipe','pipe']});
  this.proc=child;
  this.dead=false;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>{
   this.buffer+=chunk;
   let index;
   while((index=this.buffer.indexOf('\n'))>=0) {
    const line=this.buffer.slice(0,index).replace(/\r$/,'');
    this.buffer=this.buffer.slice(index+1);
    for(const fn of [...this.listeners])fn(line);
   }
   if(this.buffer.length>65536){
    for(const fn of [...this.listeners])fn('#ABNORMAL_BUFFER');
    child.kill('SIGKILL');
   }
  });
  child.stderr.resume();
  child.on('error',()=>{this.dead=true;for(const fn of [...this.listeners])fn('#ENGINE_EXIT');});
  child.on('exit',()=>{this.dead=true;for(const fn of [...this.listeners])fn('#ENGINE_EXIT');});
  try{
   await this.command('uci',line=>line==='uciok',line=>{
    if(line.startsWith('id name '))this.engineName=line.slice('id name '.length);
   });
   await this.command('isready',line=>line==='readyok');
  } catch(error) {await this.quit();throw error;}
 }
 async command(cmd,done,each=()=>{},timeoutMs=15000) {
  if(!this.proc||this.dead)throw Error('reference_engine_terminated');
  if(/[\r\n]/.test(cmd))throw Error('UCI newline injection rejected');
  return new Promise((resolve,reject)=>{
   let settled=false;
   const cleanup=()=>{if(timer)clearTimeout(timer);this.listeners.delete(onLine);};
   const finish=(error,line)=>{
    if(settled)return;
    settled=true;cleanup();if(error)reject(error);else resolve(line);
   };
   const onLine=line=>{
    if(line==='#ENGINE_EXIT'||line==='#ABNORMAL_BUFFER')return finish(Error('reference_engine_terminated'));
    try{each(line);if(done(line))finish(null,line);}catch(error){finish(error);}
   };
   const timer=setTimeout(()=>finish(Error('reference_engine_timeout')),timeoutMs);
   this.listeners.add(onLine);
   this.proc.stdin.write(cmd+'\n',error=>{if(error)finish(error);});
  });
 }
 async send(cmd) {
  if(!this.proc||this.dead)throw Error('reference_engine_terminated');
  if(/[\r\n]/.test(cmd))throw Error('UCI newline injection rejected');
  return new Promise((resolve,reject)=>this.proc.stdin.write(cmd+'\n',error=>error?reject(error):resolve()));
 }
 async configure({threads=1,hashMb=16,multipv=3}={}) {
  for(const [name,value] of [['Threads',threads],['Hash',hashMb],['MultiPV',multipv],['Skill Level',20]]){
   if(!Number.isInteger(value)||value<1||value>512)throw Error('unapproved UCI option value');
   await this.send('setoption name '+name+' value '+value);
  }
  await this.command('isready',line=>line==='readyok');
 }
 async newGame() {
  // Only one benchmark search at a time; ucinewgame has no ack until isready.
  await this.send('ucinewgame');
  await this.command('isready',line=>line==='readyok');
 }
 async evaluateMulti(fen,depth,n=3) {
  if(/[\r\n]/.test(fen))throw Error('FEN contains newline');
  new Chess(fen);
  if(!Number.isInteger(depth)||depth<1||depth>20)throw Error('reference depth out of bounds');
  if(!Number.isInteger(n)||n<1||n>8)throw Error('reference lines out of bounds');
  await this.configure({threads:1,hashMb:16,multipv:n});
  await this.send('position fen '+fen);
  const byRank=new Map();
  const final=await this.command('go depth '+depth,line=>line.startsWith('bestmove '),line=>{
   if(!line.startsWith('info ')||line.startsWith('info string')||/\b(?:lowerbound|upperbound)\b/.test(line))return;
   const dp=Number(line.match(/\bdepth (\d+)\b/)?.[1]||0);
   const rank=Number(line.match(/\bmultipv (\d+)\b/)?.[1]||1);
   const score=line.match(/\bscore (cp|mate) (-?\d+)\b/);
   const pv=line.match(/\bpv (.*)$/)?.[1]?.trim().split(/\s+/)||[];
   if(!score||!Number.isInteger(dp)||!Number.isInteger(rank)||rank<1||rank>n)return;
   const prev=byRank.get(rank);
   if(!prev||dp>=prev.depth)byRank.set(rank,{
    depth:dp,cp:score[1]==='cp'?Number(score[2]):null,
    mate:score[1]==='mate'?Number(score[2]):null,pv,multipv:rank
   });
  },20000);
  const first=byRank.get(1);
  const candidates=[...byRank.values()].filter(x=>x.multipv===1||x.depth===first?.depth).sort((a,b)=>a.multipv-b.multipv);
  const move=final.split(' ')[1];
  return {
   cp:first?.cp??null,mate:first?.mate??null,pv:first?.pv??[],
   depth:first?.depth??0,bestMoveUci:move==='(none)'?null:move,
   candidates
  };
 }
 async quit() {
  const proc=this.proc;
  if(!proc)return;
  this.proc=null;
  if(!this.dead) {
   try{proc.stdin.write('stop\nquit\n');}catch{}
   await Promise.race([
    new Promise(resolve=>proc.once('exit',resolve)),
    new Promise(resolve=>setTimeout(resolve,500))
   ]);
   if(proc.exitCode===null&&proc.signalCode===null)proc.kill('SIGKILL');
  }
  this.dead=true;
  this.listeners.clear();
 }
}
