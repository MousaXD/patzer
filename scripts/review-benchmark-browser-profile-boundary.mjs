#!/usr/bin/env node
/** Reproducible fresh browser control/race/recovery plus broken HTTP route.
 * Real HTTP wrong-profile cache response must make the QA experiment fail.
 */
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {realpathSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {verifyBrowserProfileRace} from './review-benchmark-browser-profile-proof.mjs';
const root=resolve(import.meta.dirname,'..'),results=join(root,'qa/review-excellence/results');
const opts=Object.fromEntries(process.argv.slice(2).map(x=>{
 const n=x.indexOf('=');return n<0?[x.slice(2),true]:[x.slice(2,n),x.slice(n+1)];
}));
const product=realpathSync(opts['product-root']||join(results,'worktree-product-browser'));
const backend=realpathSync(opts['backend-root']||join(results,'worktree-coach'));
const engine=realpathSync(opts.engine||join(results,'engine/unpacked/usr/games/stockfish'));
const rev=dir=>execFileSync('git',['rev-parse','HEAD'],{cwd:dir,encoding:'utf8'}).trim();
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
assert.equal(rev(product),'d72eaced6972c8a2ec7d8581365c45788b15a29a');
assert.equal(rev(backend),'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87');
assert.equal(sha(engine),'00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca');

function run(kind){
 const id=randomUUID();
 const argv=['--import','tsx','scripts/review-benchmark-browser-profile-race.mjs',
  '--product-root='+product,'--backend-root='+backend,'--engine='+engine,
  '--run-id='+id,...(kind==='fault'?['--fault=serve-stale-cache']:[])];
 const result=spawnSync(process.execPath,argv,{cwd:root,encoding:'utf8',
  timeout:28000,maxBuffer:3*1024*1024});
 assert.ifError(result.error);
 let out;
 try{out=JSON.parse(result.stdout);}catch{
  throw Error(kind+' browser process failed before output: '+result.stdout.slice(-500)+
   ' stderr: '+result.stderr.slice(-900));
 }
 assert.equal(out.run_id,id,'subprocess stdout came from an earlier run');
 const packet=JSON.parse(readFileSync(join(results,
  kind==='fault'?'review-browser-profile-race-fault.json':'review-browser-profile-race.json'),'utf8'));
 assert.equal(packet.run_id,id,'previous raw JSON substituted for fresh browser output');
 assert.equal(packet.qa_status,out.qa_status);
 return {exit:result.status,id,packet};
}

const genuine=run('clean');
assert.equal(genuine.exit,0,'normal Chrome defect-reproduction test did not complete');
assert.equal(verifyBrowserProfileRace(genuine.packet,'clean').product_gate_passed,false);
const broken=run('fault');
assert.equal(broken.exit,1,'bad real HTTP cache response falsely passed the QA gate');
assert.equal(verifyBrowserProfileRace(broken.packet,'fault').real_http_bad_stale_response_detected,true);
assert.notEqual(genuine.id,broken.id);
// A forged green label and a hidden fault flag must still fail because the
// actual authenticated GET JSON contains the stale English review.
const forged=structuredClone(broken.packet);
forged.qa_status='pass';forged.qa_error=null;forged.test_only_fault=null;
forged.verified_defect_expected=true;
assert.throws(()=>verifyBrowserProfileRace(forged,'clean'),undefined,
 'wrong-language real HTTP cache response falsely certified as a clean run');
console.log(JSON.stringify({normal_exit:genuine.exit,broken_exit:broken.exit,
 normal_run_id:genuine.id,broken_run_id:broken.id,
 real_browser_stale_profile_race_reproduced:true,
 real_http_bad_profile_cache_rejected:true,
 independently_forged_green_rejected:true,
 root_html_language_mismatch:genuine.packet.scenarios.recovery.document_declared_language==='en',
 product_gate_passed:false,release_approved:false},null,2));
