#!/usr/bin/env node
/** Fresh real Chrome 157 vs deliberate QA-only failed cancel on both early
 * stages. Correlate UUIDs and fail on setup-related negative-test failures.
 */
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {readFileSync,realpathSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {verifyEarlyStageCancellation} from './review-benchmark-browser-early-proof.mjs';

const root=resolve(import.meta.dirname,'..'),results=join(root,'qa/review-excellence/results');
const flags=Object.fromEntries(process.argv.slice(2).map(x=>{
 const n=x.indexOf('=');return n<0?[x.slice(2),true]:[x.slice(2,n),x.slice(n+1)];
}));
const product=realpathSync(flags['product-root']||join(results,'worktree-product-browser'));
const backend=realpathSync(flags['backend-root']||join(results,'worktree-coach'));
const engine=realpathSync(flags.engine||join(results,'engine/unpacked/usr/games/stockfish'));
const rev=dir=>execFileSync('git',['rev-parse','HEAD'],{cwd:dir,encoding:'utf8'}).trim();
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
assert.equal(rev(product),'d72eaced6972c8a2ec7d8581365c45788b15a29a');
assert.equal(rev(backend),'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87');
assert.equal(sha(engine),'00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca');

function run(type){
 const id=randomUUID();
 const args=['--import','tsx','scripts/review-benchmark-browser-early-retry.mjs',
  '--run-id='+id,'--product-root='+product,'--backend-root='+backend,
  '--engine='+engine,
  ...(type==='fault'?['--fault=suppress-first-controller-abort']:[])];
 const exec=spawnSync(process.execPath,args,{
  cwd:root,encoding:'utf8',timeout:25000,maxBuffer:3*1024*1024});
 assert.ifError(exec.error);
 let out;
 try{out=JSON.parse(exec.stdout);}catch{
  throw Error('Chrome '+type+' failed before JSON evidence: '+
   exec.stdout.slice(-600)+' / '+exec.stderr.slice(-700));
 }
 assert.equal(out.run_id,id,'subprocess stdout not linked to fresh test UUID');
 const packet=JSON.parse(readFileSync(join(results,
  type==='fault'?'review-early-retry-fault.json':'review-early-retry.json'),'utf8'));
 assert.equal(packet.run_id,id,'old raw evidence reused for new test');
 assert.equal(packet.qa_verdict,out.qa_verdict);
 return {run_id:id,exit:exec.status,packet};
}
const clean=run('clean');
assert.equal(clean.exit,0,'the genuine browser cancellation run failed unexpectedly');
const good=verifyEarlyStageCancellation(clean.packet,'clean');
assert.equal(good.real_chrome_phase_cancel_retry_certified,true);
assert.equal(good.real_chrome_moment_cancel_retry_certified,true);
const bad=run('fault');
assert.equal(bad.exit,1,'a browser that suppressed the real abort method returned green');
const proof=verifyEarlyStageCancellation(bad.packet,'fault');
assert.equal(proof.actual_stale_cache_and_UI_detected,true);
assert.notEqual(bad.run_id,clean.run_id);
const forged=structuredClone(bad.packet);
forged.fault=null;forged.qa_verdict='pass';forged.qa_error=null;
for(const s of forged.scenarios){s.bypass_count=0;s.abort_calls_swallowed=0;}
assert.throws(()=>verifyEarlyStageCancellation(forged,'clean'),
 /request was not|original canceled request|old model|expected HTTP|expected.*state/i,
 'broken early-stage cancellation passed forged green evidence');
console.log(JSON.stringify({clean_exit:clean.exit,fault_exit:bad.exit,
 clean_run_id:clean.run_id,fault_run_id:bad.run_id,
 clean_replacement_persisted:good.real_chrome_phase_cancel_retry_certified&&
  good.real_chrome_moment_cancel_retry_certified,
 faulty_real_cache_contamination:proof.actual_stale_cache_and_UI_detected,
 injected_abort_suppression_detected:true,forged_green_rejected:true,
 release_approved:false},null,2));
