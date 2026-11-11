#!/usr/bin/env node
/** Fresh Chrome positive/negative real-application runs with UUID correlation.
 * A browser that silently ignores Cancel's AbortSignal must NEVER go green.
 */
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {readFileSync,realpathSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {proveRetryEvidence} from './review-benchmark-browser-retry-proof.mjs';

const root=resolve(import.meta.dirname,'..'),results=join(root,'qa/review-excellence/results');
const opts=Object.fromEntries(process.argv.slice(2).map(x=>{
 const n=x.indexOf('=');return n<0?[x.slice(2),true]:[x.slice(2,n),x.slice(n+1)];
}));
const frontend=realpathSync(opts['product-root']||join(results,'worktree-product-browser'));
const backend=realpathSync(opts['backend-root']||join(results,'worktree-coach'));
const engine=realpathSync(opts.engine||join(results,'engine/unpacked/usr/games/stockfish'));
const hash=x=>createHash('sha256').update(readFileSync(x)).digest('hex');
const rev=path=>execFileSync('git',['rev-parse','HEAD'],{cwd:path,encoding:'utf8'}).trim();
assert.equal(rev(frontend),'d72eaced6972c8a2ec7d8581365c45788b15a29a');
assert.equal(rev(backend),'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87');
assert.equal(hash(engine),'00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca');

const run=(fault)=>{
 const id=randomUUID();
 const params=['--import','tsx','scripts/review-benchmark-browser-retry.mjs',
  '--run-id='+id,'--backend-root='+backend,'--product-root='+frontend,
  '--engine='+engine,...(fault?['--fault='+fault]:[])];
 const proc=spawnSync(process.execPath,params,{
  cwd:root,encoding:'utf8',timeout:28000,maxBuffer:3*1024*1024,
 });
 assert.ifError(proc.error);
 let stdout;
 try{stdout=JSON.parse(proc.stdout);}catch{
  throw Error('Chrome scenario failed before emitting raw JSON: '+
   proc.stdout.slice(-650)+' stderr='+proc.stderr.slice(-1000));
 }
 assert.equal(stdout.run_id,id,'subprocess output does not match its fresh UUID');
 const packet=JSON.parse(readFileSync(join(results,
  fault==='skip-first-abort-old-last'?'review-browser-retry-fault-old-last.json':
   fault?'review-browser-retry-fault.json':'review-browser-retry.json'),'utf8'));
 assert.equal(packet.run_id,id,'stale raw result was reused');
 assert.equal(stdout.qa_verdict,packet.qa_verdict);
 return {exit:proc.status,run_id:id,packet};
};

const clean=run(null);
assert.equal(clean.exit,0,'normal real-browser Cancel and Retry was not successful');
assert.equal(proveRetryEvidence(clean.packet,'clean').valid_retry_persisted,true);
const injected=run('skip-first-abort');
assert.equal(injected.exit,1,'a broken browser abort falsely reported green');
assert.notEqual(injected.run_id,clean.run_id);
assert.equal(proveRetryEvidence(injected.packet,'fault').injected_browser_fault_rejected_as_green,true);
const late=run('skip-first-abort-old-last');
assert.equal(late.exit,1,
 'an injected uncanceled late old request was incorrectly certified as green');
assert.equal(proveRetryEvidence(late.packet,'late-old').newer_cache_survived_late_old,true);
assert.equal(new Set([clean.run_id,injected.run_id,late.run_id]).size,3);

const forged=structuredClone(injected.packet);
forged.fault=null;forged.qa_verdict='pass';forged.qa_error=null;
forged.observation.abort_bypass_count=0;
assert.throws(()=>proveRetryEvidence(forged,'clean'),
 /first.*connected|canceled.*model|accepted.*model|canceled.*old|old.*report/i,
 'a poisoned retry escaped independent green evidence inspection');
const anotherForged=structuredClone(late.packet);
anotherForged.fault=null;anotherForged.qa_verdict='pass';anotherForged.qa_error=null;
anotherForged.observation.abort_bypass_count=0;
assert.throws(()=>proveRetryEvidence(anotherForged,'clean'),
 /first.*connected|canceled.*model|accepted.*model|canceled.*old|old.*report/i,
 'faulty old-last run falsely certified as clean because its cache remained correct');

console.log(JSON.stringify({clean_exit:clean.exit,broken_exit:injected.exit,
 old_last_exit:late.exit,
 clean_run_id:clean.run_id,broken_run_id:injected.run_id,
 old_last_run_id:late.run_id,
 clean_final_cache:clean.packet.observation.final_cached_summary,
 broken_final_cache:injected.packet.observation.final_cached_summary,
 old_last_final_cache:late.packet.observation.final_cached_summary,
 broken_UI_error:injected.packet.observation.ui_error,
 real_browser_fault_detected:true,late_old_cas_protected:true,
 forged_green_rejected:true,release_approved:false},null,2));
