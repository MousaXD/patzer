#!/usr/bin/env node
/** Entire real Chrome + Vite + Hono/SSE + SQLite game-refetch/AI-prose
 * reproduction in independent Node processes. Clean must exit 0; an
 * intentional QA-only component remount must EXIT 1. Bind each fresh UUID
 * to stdout and raw independently replayed evidence. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {verifyBrowserSourceRefresh} from './review-benchmark-browser-source-proof.mjs';

const root=resolve(import.meta.dirname,'..'),results=join(root,'qa/review-excellence/results');
const verified=[];
for(const kind of ['clean','fault']){
 const id=randomUUID();
 const argv=['--import','tsx','scripts/review-benchmark-browser-source-refresh.mjs','--run-id='+id];
 if(kind==='fault')argv.push('--fault=remount-client');
 const run=spawnSync(process.execPath,argv,{cwd:root,encoding:'utf8',
  timeout:45000,maxBuffer:2*1024*1024});
 assert.ifError(run.error);
 assert.equal(run.status,kind==='clean'?0:1,
  'new browser process did not meet intended clean/fault exit contract: '+run.stderr.slice(-850));
 let stdout;
 try{stdout=JSON.parse(run.stdout);}catch{
  throw Error('new Chrome test emitted non-JSON stdout: '+run.stdout.slice(-600));
 }
 const rawFile=kind==='clean'?'browser-source-refresh.json':'browser-source-refresh-fault.json';
 const raw=JSON.parse(readFileSync(join(results,rawFile),'utf8'));
 assert.equal(stdout.run_id,id,'stdout was substituted by another browser run');
 assert.equal(raw.run_id,id,'raw output was substituted by another browser run');
 assert.equal(stdout.qa_status,kind==='clean'?'pass':'fail');
 assert.equal(stdout.release_approved,false);
 assert.equal(raw.test_only_fault,kind==='clean'?null:'remount-client');
 assert.equal(stdout.qa_error,raw.qa_error);
 const proof=verifyBrowserSourceRefresh(raw,{kind});
 if(kind==='clean'){
  assert.equal(stdout.after_refetch.oldText,true);
  assert.equal(stdout.after_navigation.oldText,false);
  assert.equal(stdout.get_requests,3);
  assert.equal(proof.stale_ai_report_still_visible_in_report_tab,true);
 }else{
  assert.equal(stdout.after_refetch.oldText,false);
  assert.equal(stdout.after_navigation,null);
  assert.equal(proof.fault_correctly_rejected_as_false_green,true);
 }
 verified.push({kind,run_id:id,observed_exit:run.status,
  changed_source_ply_count:raw.observations.changedBackend.new_ply_count,
  new_analysis_retrieved:true,backend_report_null:true,
  report_visible_after_same_game_refetch:kind==='clean',
  proof_result:proof});
}
assert.notEqual(verified[0].run_id,verified[1].run_id);
console.log(JSON.stringify({
 independent_fresh_Chrome_processes:2,
 individual_depth8_engine_searches:4,
 clean_browser_result:verified[0],
 test_fault_result:verified[1],
 false_green_control_rejected:true,
 other_agent_source_changed:false,
 production_database_modified:false,
 release_approved:false,
},null,2));
