#!/usr/bin/env node
/**
 * Fresh real-Chrome positive and adversarial executions. The deliberate
 * broken-browser execution must have actual wrong app/cache evidence and
 * a nonzero QA exit. A stale green raw packet cannot substitute for either.
 */
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {verifyBrowserCancellation} from './review-benchmark-browser-proof.mjs';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence'),results=join(qa,'results');
const args=Object.fromEntries(process.argv.slice(2).map(x=>{
 const i=x.indexOf('=');return i<0?[x.slice(2),true]:[x.slice(2,i),x.slice(i+1)];
}));
const backend=realpathSync(args['backend-root']||join(results,'worktree-coach'));
const product=realpathSync(args['product-root']||join(results,'worktree-product-browser'));
const engine=realpathSync(args.engine||join(results,'engine/unpacked/usr/games/stockfish'));
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const engineHash='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
assert.equal(hash(engine),engineHash);
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:backend,encoding:'utf8'}).trim(),
 '19c359ec3feb8e3c10c33415c403eaf5ab3d6c87');
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:product,encoding:'utf8'}).trim(),
 'd72eaced6972c8a2ec7d8581365c45788b15a29a');

function actualChromeRun(fault){
 const runId=randomUUID();
 const cmd=['--import','tsx','scripts/review-benchmark-browser-abort.mjs',
  '--backend-root='+backend,'--product-root='+product,'--engine='+engine,
  '--run-id='+runId,...(fault?['--fault='+fault]:[])];
 const proc=spawnSync(process.execPath,cmd,{
  cwd:root,encoding:'utf8',timeout:39000,maxBuffer:3*1024*1024,
 });
 assert.ifError(proc.error);
 let stdout;
 try{stdout=JSON.parse(proc.stdout);}catch{
  throw Error('browser subprocess did not produce parseable QA stdout: '+
   proc.stdout.slice(-900)+'; stderr='+proc.stderr.slice(-1200));
 }
 assert.equal(stdout.benchmark_run_id,runId,
  'browser stdout does not match the current unique subprocess invocation');
 const rawPath=join(results,fault?'review-browser-abort-fault.json':'review-browser-abort.json');
 const raw=JSON.parse(readFileSync(rawPath,'utf8'));
 assert.equal(raw.benchmark_run_id,runId,
  'an earlier raw browser packet was reused as evidence for a fresh run');
 assert.equal(stdout.qa_verdict,raw.qa_verdict);
 return {runId,status:proc.status,stdout,raw,
  stderr:proc.stderr.slice(-1800)};
}

const genuine=actualChromeRun(null);
assert.equal(genuine.status,0,
 'correct Chrome navigation/manual cancel/logout unexpectedly failed: '+genuine.stdout.error);
assert.equal(genuine.raw.test_only_browser_fault,null);
const accepted=verifyBrowserCancellation(genuine.raw);
assert.equal(accepted.browser_report_navigation_abort_proven,true);
assert.equal(accepted.browser_explicit_cancel_button_abort_proven,true);
assert.equal(accepted.browser_logout_abort_proven,true);

const sabotage=actualChromeRun('disable-navigation-abort');
assert.equal(sabotage.status,1,
 'injected incorrect real-browser cancellation somehow exited green');
assert.equal(sabotage.raw.test_only_browser_fault,'disable-navigation-abort');
assert.notEqual(sabotage.runId,genuine.runId);
assert.equal(sabotage.raw.qa_verdict,'fail');
assert.match(sabotage.raw.qa_error||'',
 /real_internal_navigation: the real model request stayed active/,
 'QA should report the actual incorrect cancellation behavior, not a setup failure');
const nav=sabotage.raw.observations.scenarios[0];
assert.equal(nav.scenario,'real_internal_navigation');
assert.equal(nav.browser_path,'/review');
assert.equal(nav.test_only_unexpected_abort_bypass_count,1);
assert.equal(nav.provider_closed_before_release,false,
 'test-only fault did not keep the local model connection alive');
assert.equal(nav.provider_response_sent_after_navigation,true,
 'test-only corrupt model response did not reach real route');
assert.equal(nav.cached_after_release,true,
 'test-only incorrect report did not enter actual disposable SQLite');
const network=sabotage.raw.observations.network_review_requests.filter(x=>x.method==='POST');
assert.equal(network[0]?.url,'/api/games/1/review',
 'no actual Chrome Game Review POST participated in the broken trial');
assert.equal(sabotage.raw.candidate_product_sha,genuine.raw.candidate_product_sha);
assert.equal(sabotage.raw.candidate_backend_sha,genuine.raw.candidate_backend_sha);
assert.equal(sabotage.raw.stockfish_sha256,genuine.raw.stockfish_sha256);
assert.equal(sabotage.raw.manifest_sha256,genuine.raw.manifest_sha256);

// Even a forged green verdict with the QA-only switch hidden cannot pass
// independent verification because the real model/cache evidence is wrong.
const lies=structuredClone(sabotage.raw);
lies.qa_verdict='pass';lies.qa_error=null;lies.test_only_browser_fault=null;
assert.throws(()=>verifyBrowserCancellation(lies),
 /real model request stayed active|navigation\/logout did not abort pending|actual.*aborted|normal.*abort/i,
 'a forged green result escaped independent browser evidence validation');

const report={schema_version:1,at_utc:new Date().toISOString(),
  parent_agent_d_commit:'7cb32dc50b860467bab361f3728c65dad91ed881',
  candidate_product_sha:genuine.raw.candidate_product_sha,
  candidate_backend_sha:genuine.raw.candidate_backend_sha,
  engine_sha256:engineHash,manifest_sha256:genuine.raw.manifest_sha256,
  chrome_version:genuine.raw.chrome,
  clean_browser_run_id:genuine.runId,faulty_browser_run_id:sabotage.runId,
  clean_exit:genuine.status,broken_exit:sabotage.status,
  actual_application_stale_report_written_under_fault:true,
  independent_verifier_rejected_forged_green:true,
  test_only_fault:'browser fetch AbortSignal removed only for the normal game-1 review POST',
  no_product_source_modified:true,only_synthetic_disposable_data_used:true,
  source_hashes:{browser_harness:hash(join(root,'scripts/review-benchmark-browser-abort.mjs')),
   independent_proof:hash(join(root,'scripts/review-benchmark-browser-proof.mjs')),
   adversarial_boundary:hash(join(root,'scripts/review-benchmark-browser-boundary.mjs'))},
  no_full_browser_security_certification:true,release_approved:false,
  limits:['Only a fresh isolated Chrome 157 profile, local Vite proxy and Hono route subset',
   'Browser-side fault exists only inside QA session; not present in Patzer frontend source',
   'This proves the test detects one actual incorrect cancellation, not every browser/network failure',
   'No production SQLite, remote model, actual account or sealed human-adjudicated holdout']};
const destination=join(qa,'certification-summary-checkpoint20-boundary.json');
writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:destination,clean_exit:genuine.status,
  faulty_exit:sabotage.status,clean_run_id:genuine.runId,
  fault_run_id:sabotage.runId,
  injected_report_reached_real_cache:true,
  independent_verifier_rejected_forged_green:true,
  product_release_approved:false},null,2));
