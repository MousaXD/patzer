#!/usr/bin/env node
// Replays public synthetic completed games through production analyzePgnFull in a *disposable* DB.
// Not an HTTP/auth/UX certification. No production records, network backends, or LLM.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus, platform, release, totalmem, tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { join, resolve, relative } from 'node:path';
import { Chess } from 'chess.js';
import { execFileSync } from 'node:child_process';
import { validateAppAnalysis } from './review-benchmark-app-adapter.mjs';
import { ReferenceUci } from './review-benchmark-reference-uci.mjs';

const root = resolve(import.meta.dirname, '..');
const benchDir=join(root,'qa/review-excellence');
const args=Object.fromEntries(process.argv.slice(2).map(a=>{ const x=a.indexOf('='); return x<0 ? [a.slice(2),true]:[a.slice(2,x),a.slice(x+1)]; }));
const sha=data=>createHash('sha256').update(data).digest('hex');
const resultsDir=join(benchDir,'results');
mkdirSync(resultsDir,{recursive:true});
const engineArg=args.engine || process.env.PATZER_BENCH_ENGINE;
if(!engineArg){ console.error('Requires --engine=/absolute/path/to/stockfish; no auto-detection of production engine');process.exit(2); }
const enginePath=realpathSync(engineArg);
assert(enginePath.startsWith('/') && enginePath!== '/usr/bin/true','explicit valid engine path required');
const binBytes=readFileSync(enginePath);
const engineHash=sha(binBytes);
const referencePath=realpathSync(args['reference-engine'] || enginePath);
const referenceHash=sha(readFileSync(referencePath));
if(args['reference-engine-sha256']&&referenceHash!==args['reference-engine-sha256'])throw Error('Reference engine hash mismatch');
if(args['engine-sha256'] && args['engine-sha256']!==engineHash) throw Error('Engine identity mismatch: expected '+args['engine-sha256']+' observed '+engineHash);
const depth=Number(args.depth || 8);
if (!Number.isInteger(depth) || depth<8 || depth>12) throw Error('Benchmark depth must be 8..12');
const referenceCount=Number(args['reference-plies']??2);
if(!Number.isInteger(referenceCount)||referenceCount<0||referenceCount>4) throw Error('reference-plies must be an integer 0..4');
if(args['negative-controls']!==undefined&&!['on','off'].includes(args['negative-controls'])) throw Error('negative-controls must be on or off');
const runBoundaryMutations=args['negative-controls']!=='off';
const take=Number(args.games || 2);
if(!Number.isInteger(take)||take<1||take>12) throw Error('Benchmark games must be 1..12');
const appRoot=realpathSync(args['app-root'] || root);
const manifestFile=resolve(args.manifest || join(benchDir,'manifests/manifest-v2.jsonl'));
if(!manifestFile.startsWith(join(benchDir,'manifests')+'/')) throw Error('manifest must be a checked-in QA manifest');
const manifestBytes=readFileSync(manifestFile);
const ids=args.ids ? new Set(args.ids.split(',')) : null;
const entries=manifestBytes.toString('utf8').trim().split('\n').map(JSON.parse)
 .filter(e=>e.kind==='completed_game' && (ids ? ids.has(e.fixture_id) : e.split==='dev')).slice(0,take);
if(ids && entries.length!==ids.size) throw Error('Requested fixture ID not found');
if(!entries.length) throw Error('no eligible dev games');
const workspace=mkdtempSync(join(resultsDir,'disposable-'));
const report={ schema_version:2, stamp_utc:new Date().toISOString(),
 repo_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:appRoot,encoding:'utf8'}).trim(),
 harness_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 manifest_sha256:sha(manifestBytes), scoring_version:null,
 engine:{path_type:'explicit_local',sha256:engineHash,name:null,threads:1,hash_mib:16,multipv:3,requested_depth:depth,limit_type:'depth',limit_value:depth,actual_depths:[]},
 reference_engine:{sha256:referenceHash,name:null,protocol_client:'benchmark_owned_independent_uci',kind:referencePath===enginePath?'same_binary_separate_process':'independent_binary'},
 environment:{node:process.version,platform:platform(),release:release(),cpu:cpus()[0]?.model,logical_cpus:cpus().length,total_mem:totalmem()},
 dataset:entries.map(e=>e.fixture_id),fixtures:[],negative_controls:[],failures:[],perf:{},caveats: [
 'Synthetic dev fixtures only: no independent holdout, no human coaching judgments',
 'Direct real analyzePgnFull invocation (not HTTP route, authentication, persistence, or browser)',
 'Independent benchmark UCI client uses a pinned engine/depth; matching engine opinions are not absolute chess truth'
 ] };
process.env.DB_PATH=join(workspace,'benchmark.db');
process.env.SESSION_SECRET='disposable-benchmark-only-no-credentials';
process.env.STOCKFISH_PATH=enginePath;
process.env.ENGINE_BACKEND='local';
process.env.STOCKFISH_THREADS='1';
process.env.STOCKFISH_HASH='16';
let db;
try {
 const { analyzePgn }=await import(join(appRoot,'server/src/routes/analyze.ts'));
 const { SCORING_VERSION }=await import(join(appRoot,'server/src/chess/classifier.ts'));
 ({db}=await import(join(appRoot,'server/src/db.ts')));
 report.scoring_version=SCORING_VERSION;
 // These handshakes and the referee analysis use benchmark-owned UCI code,
 // not the candidate's StockfishEngine wrapper. This prevents a shared bug in
 // the candidate from silently contaminating both the candidate and referee.
 for(const [path,key] of [[enginePath,'engine'],[referencePath,'reference_engine']]) {
  const identity=new ReferenceUci(path);
  try{await identity.start();report[key].name=identity.engineName;}
  finally{await identity.quit();}
 }
 const started=performance.now();
 const cpuStart=process.cpuUsage();
 const initRSS=process.memoryUsage().rss;
 let verifiedNegative=0;
 for(const e of entries) {
  const filename=resolve(benchDir,'fixtures',e.pgn_file);
  if(!relative(join(benchDir,'fixtures'),filename)||relative(join(benchDir,'fixtures'),filename).startsWith('..')) throw Error('illegal path');
  const pgn=readFileSync(filename,'utf8');
  if(sha(pgn)!==e.pgn_sha256)throw Error('fixture SHA mismatch '+e.fixture_id);
  const begun=performance.now();
  const result=await analyzePgn(pgn,depth);
  const appElapsed=Math.round(performance.now()-begun);
  // Reanalyse selected source positions with a separately initialized engine.
  // Do not reuse the application's reported score as the reference.
  const independent={byPly:{}};
  const referee=new ReferenceUci(referencePath);
  const referenceStart=performance.now();
  try {
   await referee.start();
   await referee.configure({threads:1,hashMb:16,multipv:3});
   const probe=new Chess();
   probe.loadPgn(pgn,{strict:true});
   for(let ply=1;ply<=Math.min(referenceCount,result.moves.length);ply++) {
    const fen=result.moves[ply-1].fen_before;
    const standalone=new Chess(fen);
    if(standalone.isGameOver())continue;
    await referee.newGame();
    const value=await referee.evaluateMulti(fen,depth,3);
    if(value.depth<depth) report.failures.push({fixture_id:e.fixture_id,ply,reason:'reference_depth_not_reached'});
    const legalPv=new Chess(fen);
    for(const u of value.pv){
     let m=null;
     try {m=legalPv.move({from:u.slice(0,2),to:u.slice(2,4),...(u.length===5?{promotion:u[4]}:{})});}catch{}
     if(!m){report.failures.push({fixture_id:e.fixture_id,ply,reason:'reference_engine_illegal_pv'});break;}
    }
    independent.byPly[ply]={cp: value.cp === null ? null : value.cp*(standalone.turn()==='w'?1:-1),mate:value.mate,depth:value.depth,best_move:value.bestMoveUci};
   }
  } finally {await referee.quit();}
  const issues=validateAppAnalysis(pgn,result,{fixtureId:e.fixture_id,reference:independent});
  report.fixtures.push({fixture:e.fixture_id,move_count:result.moves.length,depth:result.depth,accuracy_white:result.accuracy_white,accuracy_black:result.accuracy_black,estimated_elo_white:result.estimated_elo_white,estimated_elo_black:result.estimated_elo_black,performance_white:result.performance_white,performance_black:result.performance_black,classification_histogram:Object.fromEntries([...new Set(result.moves.map(m=>m.classification))].sort().map(c=>[c,result.moves.filter(m=>m.classification===c).length])),app_elapsed_ms:appElapsed,reference_elapsed_ms:Math.round(performance.now()-referenceStart),reference_positions:independent.byPly,issues});
  report.engine.actual_depths.push(result.depth);
  report.failures.push(...issues);
  // Corrupt *actual application output* at the boundary, not isolated hand-written objects.
  if(runBoundaryMutations && verifiedNegative===0) {
    const variants=[
      ['illegal_best_move',o=>{o.moves[0].best_move_uci='a1a8';},'illegal_best_uci'],
      ['illegal_pv',o=>{o.moves[0].best_pv=['illegal-san'];},'illegal_pv_san'],
      ['stale_fen',o=>{o.moves[0].fen_before=o.moves[0].fen_after;},'stale_fen_before'],
      ['reversed_single_eval',o=>{o.moves[0].eval_before_cp=-(o.moves[0].eval_before_cp??0);o.moves[0].eval_after_cp=-(o.moves[0].eval_after_cp??0)+100;},'eval_chain_break'],
      ['reversed_entire_game',o=>{for(const m of o.moves){m.eval_before_cp=-(m.eval_before_cp??0);m.eval_after_cp=-(m.eval_after_cp??0);m.mate_before=m.mate_before===null?null:-m.mate_before;m.mate_after=m.mate_after===null?null:-m.mate_after;}},'reference_evaluation_side_mismatch'],
      ['false_classification',o=>{o.moves[0].classification='forced';},'false_forced_classification'],
      ['invented_coach_mate',o=>{o.coach_claims=[{ply:1,type:'forced_mate',pv_uci:['e2e4','e7e5'],winner:'w',status:'supported'}];},'unsupported_forced_mate_claim'],
      ['unsupported_claim_type',o=>{o.coach_claims=[{ply:1,type:'unknown_llm_prose_claim',status:'supported'}];},'unverifiable_coach_claim_type'],
      ['all_evaluations_removed',o=>{for(const m of o.moves){m.eval_before_cp=null;m.eval_after_cp=null;}},'missing_or_invalid_eval_cp']
    ];
    // Whole-game sign inversion requires an independent non-zero reference.
    const independentSignProven=Object.values(independent.byPly).some(r=>Math.abs(r.cp??0)>=80 || r.mate);
    for(const [name,mutate,expected] of variants){
      if(name==='reversed_entire_game' && !independentSignProven){
       report.negative_controls.push({name,rejected:null,reason:['insufficient_independent_reference'],status:'not_tested'});
       continue;
      }
      const corrupted=structuredClone(result); mutate(corrupted);
      const found=validateAppAnalysis(pgn,corrupted,{fixtureId:e.fixture_id,reference:independent});
      // A corrupted input only proves detection when the *same* failure did
      // not exist in the valid output. Otherwise negative controls can lie.
      const rejected=!issues.some(x=>x.reason===expected)
        && JSON.stringify(corrupted)!==JSON.stringify(result)
        && found.some(x=>x.reason===expected);
      report.negative_controls.push({name,rejected,reason:found.map(x=>x.reason)});
      if(!rejected)report.failures.push({fixture_id:e.fixture_id,reason:'negative_control_escaped:'+name});
    }
    verifiedNegative++;
  }
  // A dedicated mutation attacks the exact zero-evidence rating bug. A main
  // baseline already exhibiting the bug must fail, not falsely earn credit
  // for rejecting a mutation to a value it already returned.
  for(const [color,suffix] of (runBoundaryMutations ? [['w','white'],['b','black']] : [])) {
    const eligible=result.moves.filter(m=>m.fen_before.split(' ')[1]===color
      && !['book','forced'].includes(m.classification)).length;
    if(eligible!==0 || issues.length)continue;
    const corrupted=structuredClone(result);
    corrupted['estimated_elo_'+suffix]=2880;
    corrupted['performance_'+suffix]=2880;
    const found=validateAppAnalysis(pgn,corrupted,{fixtureId:e.fixture_id,reference:independent});
    const a='rating_without_eligible_moves_'+suffix;
    const b='performance_without_eligible_moves_'+suffix;
    const rejected=found.some(f=>f.reason===a)&&found.some(f=>f.reason===b);
    report.negative_controls.push({name:'inflated_zero_evidence_rating_'+suffix,rejected,reason:found.map(x=>x.reason)});
    if(!rejected)report.failures.push({fixture_id:e.fixture_id,reason:'negative_control_escaped:inflated_zero_evidence_rating_'+suffix});
  }
 }
 report.perf.elapsed_ms=Math.round(performance.now()-started);
 report.perf.node_cpu_us=process.cpuUsage(cpuStart);
 report.perf.node_rss_start_bytes=initRSS;
 report.perf.node_rss_end_bytes=process.memoryUsage().rss;
 report.perf.node_max_rss_bytes=process.resourceUsage().maxRSS*1024;
 report.perf.note='Node process CPU/RSS only; engine runs in child processes, wall time includes engine work.';
 report.summary={games:report.fixtures.length,plies:report.fixtures.reduce((n,c)=>n+c.move_count,0),negative_rejections:report.negative_controls.filter(v=>v.rejected).length,negative_total:report.negative_controls.filter(v=>v.rejected!==null).length,unverified_controls:report.negative_controls.filter(v=>v.rejected===null).length,errors:report.failures.length};
} finally {
 try {db?.close();} catch {}
 rmSync(workspace,{recursive:true,force:true});
}
const target=resolve(args.out || join(resultsDir,'real-app-baseline.json'));
if(!target.startsWith(resultsDir+'/')) throw Error('output must live inside ignored results');
writeFileSync(target,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({path:target,repo_sha:report.repo_sha,scoring_version:report.scoring_version,engine:report.engine,summary:report.summary,fixtures:report.fixtures,negative_controls:report.negative_controls,perf:report.perf,failures:report.failures},null,2));
if(report.failures.length)process.exitCode=1;
