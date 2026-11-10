#!/usr/bin/env node
// Bounded, disposable lifecycle and synthetic SQLite load probes (not HTTP/browser).
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { resolve, join } from 'node:path';
import { Chess } from 'chess.js';
import { execFileSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const base=join(root,'qa/review-excellence/results');
mkdirSync(base,{recursive:true});
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const i=arg.indexOf('=');return i<0?[arg.slice(2),true]:[arg.slice(2,i),arg.slice(i+1)];}));
if(!args.engine)throw Error('Use --engine=path/to/stockfish');
const engine=realpathSync(args.engine);
const sha=createHash('sha256').update(readFileSync(engine)).digest('hex');
if(args.sha256&&args.sha256!==sha)throw Error('engine hash mismatch');
const work=mkdtempSync(join(base,'disposable-lifecycle-'));
process.env.DB_PATH=join(work,'test.db');
process.env.SESSION_SECRET='testing-only-no-secret';
process.env.STOCKFISH_PATH=engine;
process.env.ENGINE_BACKEND='local';
process.env.STOCKFISH_THREADS='1';
process.env.STOCKFISH_HASH='16';
let db;
const cases=[];
async function test(name,fn){
 const begin=performance.now();
 try{const detail=await fn();cases.push({name,ok:true,ms:Math.round(performance.now()-begin),detail:detail||null});}
 catch(error){cases.push({name,ok:false,ms:Math.round(performance.now()-begin),error:String(error.message||error)});}
}
try{
 const { StockfishEngine }=await import('../server/src/chess/stockfish.ts');
 const { analyzePgnFull }=await import('../server/src/routes/analyze.ts');
 ({db}=await import('../server/src/db.ts'));
 const testPgn=readFileSync(join(root,'qa/review-excellence/fixtures/games/syn-game-castling.pgn'),'utf8');
 const perf={score:null,userColor:'white',opponentRating:null,opponentRd:null};
 await test('aborted_before_engine_start',async()=>{
   const ctl=new AbortController();
   ctl.abort();
   await assert.rejects(analyzePgnFull(testPgn,12,perf,ctl.signal),/analysis_cancelled/);
 });
 await test('abort_active_analysis',async()=>{
   const ctl=new AbortController();
   const started=performance.now();
   const job=analyzePgnFull(testPgn,12,perf,ctl.signal);
   const t=setTimeout(()=>ctl.abort(),60);
   try {
     await assert.rejects(job,/analysis_cancelled/);
     const ms=performance.now()-started;
     assert(ms<5000,'abort exceeded 5s: '+ms);
     return {aborted_within_ms:Math.round(ms)};
   } finally {clearTimeout(t);}
 });
 await test('same_engine_concurrent_search_rejected',async()=>{
   const e=new StockfishEngine(engine);
   try{
     await e.start();
     await e.setOption('Threads','1');
     await e.setOption('Hash','16');
     const first=e.evaluateMulti(new Chess().fen(),12,3);
     await assert.rejects(e.evaluateMulti(new Chess().fen(),12,3),/engine_busy/);
     const result=await first;
     assert(result.depth>=8,'depth <8');
     return {first_depth:result.depth};
   } finally {await e.quit();}
 });
 await test('missing_engine_binary',async()=>{
   const e=new StockfishEngine(join(work,'no-such-binary'));
   await assert.rejects(e.start(),/ENOENT|spawn|EPIPE|engine_terminated/);
   await e.quit();
 });
 await test('engine_crash_during_search',async()=>{
   const fake=join(work,'crash.mjs');
   const content=`#!/usr/bin/env node
let b='';process.stdin.setEncoding('utf8');
process.stdin.on('data',d=>{b+=d;let n;while((n=b.indexOf('\\n'))>=0){const c=b.slice(0,n).trim();b=b.slice(n+1);
if(c==='uci')process.stdout.write('id name CrashFish\\nuciok\\n');
else if(c==='isready')process.stdout.write('readyok\\n');
else if(c.startsWith('go '))process.exit(7);
else if(c==='quit')process.exit(0);
}});`;
   writeFileSync(fake,content,{mode:0o700});chmodSync(fake,0o700);
   const e=new StockfishEngine(fake);
   const started=performance.now();
   try{
     await e.start();
     await assert.rejects(e.evaluateMulti(new Chess().fen(),8,3),/engine_terminated|engine/);
     assert(performance.now()-started<4000,'crash handling too slow');
   } finally {await e.quit();}
 });
 await test('synthetic_library_2000_10000',async()=>{
   const userId=Number(db.prepare("INSERT INTO users(username,password_hash,role) VALUES (?,?,?)").run('bench-only','synthetic-not-usable','user').lastInsertRowid);
   const insert=db.prepare("INSERT INTO games(user_id,source,external_id,pgn,white,black,result,time_control,end_time,user_color) VALUES (?,'imported',?,?,'Synthetic White','Synthetic Black','*','600','2026-11-11','white')");
   const entries=[];
   const pgn=readFileSync(join(root,'qa/review-excellence/fixtures/games/syn-game-fools-mate.pgn'),'utf8');
   for(const goal of [2000,10000]) {
     const begin=performance.now();
     const lo=entries.length;
     db.transaction(()=>{for(let i=lo;i<goal;i++)insert.run(userId,'synthetic-'+i,pgn);})();
     const write_ms=Math.round(performance.now()-begin);
     const t=performance.now();
     const rows=db.prepare('SELECT id FROM games WHERE user_id=? ORDER BY end_time DESC,id DESC LIMIT 50 OFFSET ?').all(userId,goal-50);
     const read_ms=performance.now()-t;
     assert(rows.length===50);
     const count=db.prepare('SELECT count(*) AS n FROM games WHERE user_id=?').get(userId).n;
     assert(count===goal);
     entries.push(...Array.from({length:goal-lo},()=>null));
     cases.push({name:'library_size_'+goal,ok:true,ms:write_ms,detail:{read_ms:Math.round(read_ms*1000)/1000,rows:goal}});
   }
   return {scope:'SQLite indexed pagination microprobe, not HTTP/React UI'};
 });
} finally {
 try{db?.close();}catch{}
 rmSync(work,{recursive:true,force:true});
}
const results={schema_version:1,date_utc:new Date().toISOString(),repo_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 engine_sha256:sha,scoring_version:'not_measured',cases,
 evidence_scope:'Disposable live-function cancellation/engine protocol + synthetic SQL load; does not certify HTTP admission or UI',
 failures:cases.filter(c=>!c.ok)};
const dest=join(base,'lifecycle.json');
writeFileSync(dest,JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
if(results.failures.length)process.exitCode=1;
