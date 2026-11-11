#!/usr/bin/env node
/** Independent source- and wire-grounded proof of real Chrome cancel/retry.
 * A faulty browser run may be valid *negative evidence*, but is never green.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {Chess} from 'chess.js';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const product='d72eaced6972c8a2ec7d8581365c45788b15a29a';
const backend='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const engine='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const manifest='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash=filename=>createHash('sha256').update(readFileSync(filename)).digest('hex');
const first='Black won the game. FIRST GENERATION.';
const second='Black won the game. SECOND GENERATION.';
const sequence=['phase','moment','summary','phase','moment','summary'];

export function proveRetryEvidence(r,kind){
 assert(['clean','fault','late-old'].includes(kind),
  'verifier must know which independent browser trial to certify');
 assert.equal(r.schema_version,1);
 assert(uuid.test(r.run_id),'missing independent run UUID');
 assert.equal(r.product_sha,product);assert.equal(r.backend_sha,backend);
 assert.equal(r.engine_sha256,engine);assert.equal(r.manifest_sha256,manifest);
 assert.equal(hash(join(qa,'manifests/manifest-v2.jsonl')),manifest);
 assert.equal(r.fixture_id,'SYN-GAME-FOOLS-MATE');
 assert.equal(r.synthetic_only,true);assert.equal(r.disposable_sqlite_only,true);
 assert.equal(r.release_approved,false);assert.equal(r.whole_browser_certified,false);
 const item=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8')
  .trim().split('\n').map(JSON.parse).find(x=>x.fixture_id===r.fixture_id);
 assert(item?.source_kind==='synthetic'&&item.license==='self-authored');
 const file=join(qa,'fixtures',item.pgn_file);
 assert.equal(hash(file),item.pgn_sha256);
 const position=new Chess();position.loadPgn(readFileSync(file,'utf8'),{strict:true});
 assert(position.isCheckmate()&&position.turn()==='w'&&position.header().Result==='0-1');
 assert.equal(r.fault,kind==='clean'?null:
  kind==='fault'?'skip-first-abort':'skip-first-abort-old-last');
 assert.equal(r.qa_verdict,kind==='clean'?'pass':'fail');
 if(kind==='clean')assert.equal(r.qa_error,null);
 else if(kind==='fault')assert.match(r.qa_error||'',
  /canceled_first_generation_poisoned_retry_cache/);
 else assert.match(r.qa_error||'',
  /test_only_uncanceled_old_request_CAS_preserved_new_report/);
 const o=r.observation;
 assert.equal(o.first_generation_started,true);
 assert.equal(o.second_generation_started,true);
 assert.equal(o.both_model_generations_observed,true);
 assert.equal(o.cache_before_cancel,null);
 assert.equal(o.cache_during_overlap,null,
  'the replacement did not start while the first report remained unresolved');
 assert.equal(o.first_generation_model_sequence,3);
 assert.equal(o.second_generation_model_sequence,6);
 assert(Array.isArray(o.chrome_review_post_ids)&&o.chrome_review_post_ids.length===2);
 assert(o.chrome_review_post_ids.every(x=>typeof x==='string'&&x.length>3));
 assert.equal(new Set(o.chrome_review_post_ids).size,2,
  'Chrome did not send two independent actual HTTP report POSTs');
 assert.deepEqual(o.model_calls.map(x=>x.stage),sequence);
 assert.deepEqual(o.model_calls.map(x=>x.generation),[
  'first','first','first','second','second','second']);
 assert.deepEqual(o.model_calls.map(x=>x.sequence),[1,2,3,4,5,6]);
 assert.equal(new Set(o.model_closed).size,6,'mock model responses leaked');
 assert(o.model_closed.every(x=>Number.isSafeInteger(x)&&x>=1&&x<=6));
 assert.deepEqual(o.model_errors,[]);
 assert.deepEqual(o.browser_exceptions,[]);
 assert.match(o.chrome_version,/^Google Chrome 157\.0\.\d+\.\d+$/);
 assert(Number.isSafeInteger(o.vite_port)&&o.vite_port>0);
 assert(Number.isSafeInteger(o.api_port)&&o.api_port>0);
 assert.notEqual(o.vite_port,o.api_port);
 assert.equal(o.final_cached_language,'en');
 assert.equal(o.final_cached_audience,'beginner');
 assert(Number.isFinite(r.elapsed_ms)&&r.elapsed_ms>0&&r.elapsed_ms<20000);
 if(kind==='clean'){
  assert.equal(o.abort_bypass_count,0);
  assert.equal(o.first_closed_before_release,true,
   'normally canceled first model connection remained open');
  assert.equal(o.first_model_response_sent,false,
   'the canceled old request still accepted a model response');
  assert.equal(o.cache_after_old_release,null,
   'old response persisted before the replacement completed');
  assert.equal(o.first_won_before_retry_completion,false);
  assert.equal(o.second_model_response_sent,true);
  assert.equal(o.final_cached_summary,second,
   'newly retried generation was not persisted');
  assert.equal(o.ui_contains_second,true,'actual React review UI did not update');
  assert.equal(o.ui_contains_first,false,'stale canceled review reached React UI');
  assert.equal(o.ui_error,null,'normal retry displayed an error');
  assert(o.chrome_failed_posts.some(x=>x.canceled&&x.error==='net::ERR_ABORTED'),
   'Chrome did not actually abort any request');
 }else if(kind==='fault'){
  assert.equal(o.abort_bypass_count,1);
  assert.equal(o.first_closed_before_release,false,
   'test fault did not keep first model request connected');
  assert.equal(o.first_model_response_sent,true,
   'old request did not actually receive a model response after cancel');
  assert.equal(o.cache_after_old_release,first,
   'old response did not actually contaminate SQLite before retry completed');
  assert.equal(o.first_won_before_retry_completion,true);
  assert.equal(o.second_model_response_sent,true);
  assert.equal(o.final_cached_summary,first,
   'old report did not retain the cache after the replacement');
  assert.equal(o.ui_contains_first,false,
   'the UI unexpectedly displayed its own canceled answer');
  assert.equal(o.ui_contains_second,false,
   'the replacement report apparently succeeded despite the recorded CAS conflict');
  assert.match(o.ui_error||'',/review_source_changed/,
   'the real source CAS conflict did not reach the React UI');
 }else{
  assert.equal(o.abort_bypass_count,1);
  assert.equal(o.first_closed_before_release,false,
   'late-old control failed to keep canceled request connected');
  assert.equal(o.second_model_response_sent,true);
  assert.equal(o.cache_after_new_release,second,
   'fresh report did not actually win the cache first');
  assert.equal(o.first_model_response_sent,true,
   'old response was not injected after the new one completed');
  assert.equal(o.cache_after_old_release,second,
   'late canceled review overwrote a newer cached report');
  assert.equal(o.first_won_before_retry_completion,false);
  assert.equal(o.final_cached_summary,second,
   'late old response eventually poisoned cache');
  assert.equal(o.ui_contains_first,false);
  assert.equal(o.ui_contains_second,true);
  assert.equal(o.ui_error,null);
 }
 return {real_Chrome_two_POSTs:true,model_requests:6,
  first_report_won_cache:kind==='fault',
  valid_retry_persisted:kind==='clean',
  newer_cache_survived_late_old:kind==='late-old',
  injected_browser_fault_rejected_as_green:kind!=='clean',
  full_release_approved:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const clean=JSON.parse(readFileSync(join(qa,'results/review-browser-retry.json'),'utf8'));
 const fault=JSON.parse(readFileSync(join(qa,'results/review-browser-retry-fault.json'),'utf8'));
 const late=JSON.parse(readFileSync(join(qa,'results/review-browser-retry-fault-old-last.json'),'utf8'));
 const verified={normal:proveRetryEvidence(clean,'clean'),
  old_first_fault:proveRetryEvidence(fault,'fault'),
  old_last_fault:proveRetryEvidence(late,'late-old')};
 assert.equal(new Set([clean.run_id,fault.run_id,late.run_id]).size,3);
 const report={schema_version:1,at_utc:new Date().toISOString(),
  previous_qa_head:'26f6a486fb12e650af35f4806284cc2dc2937556',
  qa_checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  branch:'agent/review-benchmark-20261111',product_sha:product,backend_sha:backend,
  engine_sha256:engine,manifest_sha256:manifest,fixture_id:clean.fixture_id,
  clean_run_id:clean.run_id,fault_run_id:fault.run_id,
  late_old_run_id:late.run_id,
  chrome_version:clean.observation.chrome_version,
  results:verified,expected_clean_exit:0,expected_fault_exit:1,
  expected_late_old_exit:1,
  source_hashes:{runner:hash(join(root,'scripts/review-benchmark-browser-retry.mjs')),
   verifier:hash(join(root,'scripts/review-benchmark-browser-retry-proof.mjs'))},
  no_production_source_modified:true,synthetic_only:true,
  release_approved:false,integration_approved:false,
  limitations:['One synthetic game and two overlapping local-model generations per Chrome test',
   'A deliberately broken fetch is QA-only and not an observed production regression',
   'No sealed holdout, externally deployed model, browser accessibility or production reverse proxy',
   'Positive cancellation is not a guarantee that all conceivable network race orders are safe'],
 };
 const destination=join(qa,'certification-summary-checkpoint21.json');
 writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:destination,results:verified,
  product_release_approved:false},null,2));
}
