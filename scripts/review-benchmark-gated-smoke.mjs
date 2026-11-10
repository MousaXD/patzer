#!/usr/bin/env node
/**
 * ONE-COMMAND raw-UCI-gated analyzer smoke, intentionally not a release/UX gate.
 *
 * Runs a bounded synthetic game through the real application with a test-only
 * UCI tee, then validates *all* raw engine PVs and bestmove replies. A good
 * application DTO cannot produce a green report without its upstream transcript.
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, unlinkSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Chess } from 'chess.js';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence');
const results=join(qa,'results');
mkdirSync(results,{recursive:true});
const args=Object.fromEntries(process.argv.slice(2).map(x=>{
 const i=x.indexOf('=');return i<0?[x.replace(/^--/,'') ,true]:[x.slice(2,i),x.slice(i+1)];
}));
function sha(file){return createHash('sha256').update(readFileSync(file)).digest('hex');}
if(!args.engine || !args['engine-sha256'])throw Error('Requires --engine=ABS_PATH and --engine-sha256=PINNED_DIGEST');
const engine=realpathSync(args.engine),binaryHash=sha(engine);
assert(/^[a-f0-9]{64}$/.test(args['engine-sha256']),'invalid SHA256 argument');
assert.equal(binaryHash,args['engine-sha256'],'engine identity mismatch');
const app=realpathSync(args['app-root']||join(results,'worktree-engine'));
const appWorktrees=join(results,'worktree-');
if(app!==root && !app.startsWith(appWorktrees))throw Error('App root must be own QA worktree or this isolated benchmark checkout');
const intendedCandidateSha=execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim();
const depth=Number(args.depth??8);
if(!Number.isInteger(depth)||depth<8||depth>12)throw Error('depth allowed 8..12');
const ids=String(args.ids||'SYN-GAME-BLACK-FIRST,SYN-GAME-FORCED-REPLY').split(',');
if(ids.length<1||ids.length>4||new Set(ids).size!==ids.length||ids.some(x=>!/^[A-Z0-9-]+$/.test(x)))throw Error('1..4 unique synthetic fixture IDs required');
const manifestPath=join(qa,'manifests/manifest-v2.jsonl');
const manifestHash=sha(manifestPath);
const manifest=readFileSync(manifestPath,'utf8').trim().split('\n').map(JSON.parse);
let plies=0;
const expectedFens=[];
for(const id of ids) {
 const fixture=manifest.find(f=>f.fixture_id===id && f.kind==='completed_game');
 if(!fixture)throw Error('Unapproved fixture ID '+id);
 if(fixture.source_kind!=='synthetic'||fixture.license!=='self-authored'||fixture.split==='holdout')throw Error('Only approved synthetic, non-holdout fixtures allowed');
 const source=join(qa,'fixtures',fixture.pgn_file);
 if(!source.startsWith(join(qa,'fixtures')+'/')||fixture.pgn_file.split('/').includes('..'))throw Error('Unsafe fixture path');
 if(sha(source)!==fixture.pgn_sha256)throw Error('Fixture changed '+id);
 const game=new Chess();
 game.loadPgn(readFileSync(source,'utf8'),{strict:true});
 const replay=new Chess(game.header().FEN||new Chess().fen());
 expectedFens.push(replay.fen());
 const history=game.history({verbose:true});
 for(const move of history) {
  replay.move({from:move.from,to:move.to,...(move.promotion?{promotion:move.promotion}:{})});
  expectedFens.push(replay.fen());
 }
 plies+=history.length;
}
if(plies>60)throw Error('Bounded certification: max 60 game plies; choose smaller public fixtures');
const mutation=args.fault||'none';
 if(!['none','drop-trace','corrupt-raw-pv','extra-legal-search','force-analysis-timeout'].includes(mutation))throw Error('Unsupported test-only fault mode');
const runDir=mkdtempSync(join(results,'raw-gate-'));
const traceDir=join(runDir,'raw-uci');
mkdirSync(traceDir,{recursive:true});
const appReport=join(runDir,'app-result.json');
const rawReport=join(runDir,'raw-result.json');
const proxy=join(root,'scripts/review-benchmark-uci-proxy.mjs');
const timeStarted=Date.now();
async function task(command,argv,env,timeoutMs=45000) {
 // `spawnSync(..., {timeout})` can kill only the direct Node runner, leaving
 // Stockfish grandchildren alive. Give each child its own POSIX process group
 // and terminate that group on timeout. No active server process is involved.
 return new Promise(resolve=>{
  let child;
  const grouped=process.platform!=='win32';
  try{child=spawn(command,argv,{cwd:root,env,stdio:['ignore','pipe','pipe'],detached:grouped});}
  catch(error){return resolve({status:null,error,stdout:'',stderr:'',timedOut:false});}
  let stdout='',stderr='',error=null,timedOut=false,settled=false,overflow=false;
  const maxBytes=2*1024*1024;
  function kill(sig) {
   try {if(grouped)process.kill(-child.pid,sig);else child.kill(sig);}catch{}
  }
  function append(part,data) {
   const text=String(data);
   if(part==='stdout')stdout+=text;else stderr+=text;
   if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>maxBytes) {
    overflow=true;kill('SIGTERM');
   }
  }
  child.stdout?.on('data',data=>append('stdout',data));
  child.stderr?.on('data',data=>append('stderr',data));
  child.on('error',e=>{error=e;});
  const timer=setTimeout(()=>{timedOut=true;kill('SIGTERM');
   setTimeout(()=>kill('SIGKILL'),500).unref();
  },timeoutMs);
  child.on('close',(status,signal)=>{
   if(settled)return;
   settled=true;clearTimeout(timer);
   resolve({status,signal,error,stdout,stderr,timedOut,overflow});
  });
 });
}
const appRun=await task(process.execPath,[
 '--import','tsx','scripts/review-benchmark-real-app.mjs',
 '--app-root='+app,'--engine='+proxy,
 '--reference-engine='+engine,'--reference-engine-sha256='+binaryHash,
 '--ids='+ids.join(','),'--games='+ids.length,'--depth='+depth,
 '--negative-controls=on','--out='+appReport
],{...process.env,ENGINE_BACKEND:'local',PATZER_BENCH_PROXY_TARGET:engine,PATZER_BENCH_PROXY_TRACE_DIR:traceDir},
 mutation==='force-analysis-timeout'?50:45000);
if(mutation==='drop-trace'){
 for(const file of readdirSync(traceDir))if(file.endsWith('.jsonl'))unlinkSync(join(traceDir,file));
} else if(mutation==='corrupt-raw-pv') {
 let mutated=false;
 for(const file of readdirSync(traceDir).filter(x=>x.endsWith('.jsonl'))) {
  const rows=readFileSync(join(traceDir,file),'utf8').trim().split('\n').map(JSON.parse);
  const base=rows.find(x=>x.direction==='engine'&&x.line.startsWith('info ')&&x.line.includes(' pv ')&&x.fen);
  if(base) {
   base.line+=' a1a8'; // intentionally impossible continuation, TEST-ONLY
   writeFileSync(join(traceDir,file),rows.map(x=>JSON.stringify(x)).join('\n')+'\n');
   mutated=true;
   break;
  }
 }
 if(!mutated)throw Error('Test-only PV corruption was not applied: no actual UCI PV found');
} else if(mutation==='extra-legal-search') {
 // Adversarial proof: adding a *fully legal* unrelated search would fool a
 // count-only audit. The exact fixture-position multiset must reject it.
 const file=readdirSync(traceDir).find(x=>x.endsWith('.jsonl')&&readFileSync(join(traceDir,x),'utf8').includes('"direction":"command"'));
 if(!file)throw Error('No real UCI trace to challenge');
 const rows=readFileSync(join(traceDir,file),'utf8').trim().split('\n').map(JSON.parse);
 const seq=Math.max(0,...rows.filter(x=>Number.isInteger(x.sequence)).map(x=>x.sequence));
 const fen=new Chess().fen();
 const injected=[
  {direction:'command',sequence:seq,fen,line:'position fen '+fen},
  {direction:'command',sequence:seq+1,fen,line:'go depth '+depth},
  {direction:'engine',sequence:seq+1,fen,line:'info depth '+depth+' multipv 1 score cp 20 pv e2e4 e7e5'},
  {direction:'engine',sequence:seq+1,fen,line:'bestmove e2e4'}
 ].map(x=>({pid:0,...x}));
 writeFileSync(join(traceDir,file),rows.concat(injected).map(x=>JSON.stringify(x)).join('\n')+'\n');
}
const traceRun=await task(process.execPath,[
 'scripts/review-benchmark-uci-trace.mjs','--dir='+traceDir,
 '--min-searches='+(plies+ids.length),'--out='+rawReport
],process.env);
let appEvidence=null,rawEvidence=null;
try{appEvidence=JSON.parse(readFileSync(appReport,'utf8'));}catch{}
try{rawEvidence=JSON.parse(readFileSync(rawReport,'utf8'));}catch{}
const failures=[];
if(appRun.error||appRun.status!==0||appRun.timedOut||appRun.overflow||!appEvidence||appEvidence.failures?.length)failures.push({
 reason:'actual_application_output_failed',code:appRun.status,timed_out:appRun.timedOut,output_overflow:appRun.overflow,error:String(appRun.error?.message||''),
 sources:appEvidence?.failures?.map(x=>x.reason)||[]});
if(traceRun.error||traceRun.status!==0||traceRun.timedOut||traceRun.overflow||!rawEvidence||rawEvidence.failures?.length)failures.push({
 reason:'raw_uci_evidence_failed',code:traceRun.status,timed_out:traceRun.timedOut,output_overflow:traceRun.overflow,error:String(traceRun.error?.message||''),
 sources:rawEvidence?.failures?.map(x=>x.reason)||[]});
if(appEvidence?.summary?.negative_rejections!==appEvidence?.summary?.negative_total ||
   !appEvidence?.summary?.negative_total)failures.push({reason:'missing_or_escaped_boundary_negative_control'});
if(appEvidence?.repo_sha && appEvidence.repo_sha!==intendedCandidateSha)failures.push({reason:'app_candidate_sha_mismatch'});
if(rawEvidence && (rawEvidence.summary.legal_pv_lines!==rawEvidence.summary.pv_lines
 ||rawEvidence.summary.search_commands < plies+ids.length
 ||rawEvidence.summary.bestmove < plies+ids.length))failures.push({reason:'insufficient_raw_uci_coverage'});
// Match the *exact* board positions actually searched, not just their count.
// This detects self-consistent extra searches, omitted final positions and
// irrelevant evidence from an unrelated run that a counting gate would pass.
let observedFens=[];
try {
 for(const file of readdirSync(traceDir).filter(x=>x.endsWith('.jsonl'))) {
  const rows=readFileSync(join(traceDir,file),'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  observedFens.push(...rows.filter(x=>x.direction==='command'&&x.line?.startsWith('go ')).map(x=>x.fen));
 }
} catch(error) {failures.push({reason:'raw_uci_positions_unreadable',detail:String(error.message||error)});}
const countFens=list=>list.reduce((m,fen)=>(m.set(fen,(m.get(fen)||0)+1),m),new Map());
const expected=countFens(expectedFens),observed=countFens(observedFens);
const missingFens=[...expected].filter(([fen,n])=>(observed.get(fen)||0)!==n);
const unexpectedFens=[...observed].filter(([fen,n])=>(expected.get(fen)||0)!==n);
if(missingFens.length||unexpectedFens.length||observedFens.length!==expectedFens.length)failures.push({
 reason:'raw_uci_fixture_positions_mismatch',expected_searches:expectedFens.length,
 observed_searches:observedFens.length,missing_positions:missingFens.length,unexpected_positions:unexpectedFens.length
});
if(mutation==='corrupt-raw-pv' && !rawEvidence?.failures?.some(x=>x.reason==='illegal_raw_uci_pv')) {
 failures.push({reason:'corrupted_raw_pv_escaped_auditor'});
}
if(mutation==='force-analysis-timeout' && !appRun.timedOut)failures.push({reason:'force_timeout_injection_did_not_trigger'});
const outcome={
 schema_version:1,
 measured_utc:new Date().toISOString(),
 current_benchmark_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 requested_candidate_sha:intendedCandidateSha,
 candidate_sha:appEvidence?.repo_sha||null,
 manifest_sha256:manifestHash,
 tested_fixtures:ids,
 expected_analysis_searches:plies+ids.length,
 observed_analysis_searches:observedFens.length,
 pinned_engine_sha256:binaryHash,
 reference_kind:'benchmark-owned UCI protocol client with separate process',
 depth,threads:1,hash_mib:16,multipv:3,
 application:{exit:appRun.status,timed_out:appRun.timedOut,signal:appRun.signal??null,score_version:appEvidence?.scoring_version??null,
   negative_controls:appEvidence?.summary?.negative_total??0,
   rejected_controls:appEvidence?.summary?.negative_rejections??0,
   errors:appEvidence?.summary?.errors??null},
 raw_uci:{exit:traceRun.status,metrics:rawEvidence?.summary||null,errors:rawEvidence?.failures?.length??null},
 duration_ms:Date.now()-timeStarted,
 test_only_corruption:mutation==='none'?null:mutation,
 certification_scope:'Offline synthetic analysis output plus raw UCI legality; NOT full product/release certification',
 scope_passed:failures.length===0,
 release_approved:false,
 failures
};
const artifact=join(runDir,'gate-result.json');
writeFileSync(artifact,JSON.stringify(outcome,null,2)+'\n');
console.log(JSON.stringify({report:artifact,...outcome},null,2));
if(failures.length)process.exitCode=1;
