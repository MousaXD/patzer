#!/usr/bin/env node
/** Independent chess, provenance, HTTP and cache verification for the REAL
 * Chrome phase/moment cancellation benchmark. A fault is evidence of a
 * benchmark failure, never an alternate path to a green release verdict.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Chess} from 'chess.js';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const product='d72eaced6972c8a2ec7d8581365c45788b15a29a';
const backend='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const engine='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const manifest='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha=filename=>createHash('sha256').update(readFileSync(filename)).digest('hex');
const first='Black won the game. FIRST EARLY GENERATION.';
const second='Black won the game. SECOND EARLY GENERATION.';
const expected={
 clean:{phase:['phase','phase','moment','summary'],
  moment:['phase','moment','phase','moment','summary']},
 fault:{phase:['phase','phase','moment','summary','moment','summary'],
  moment:['phase','moment','phase','moment','summary','summary']},
};

export function verifyEarlyStageCancellation(packet,kind){
 assert(kind==='clean'||kind==='fault','explicit evidence type required');
 assert.equal(packet.schema_version,1);
 assert(uuid.test(packet.run_id||''),'missing unique subprocess run identity');
 assert.equal(packet.frontend_sha,product);assert.equal(packet.backend_sha,backend);
 assert.equal(packet.engine_sha256,engine);assert.equal(packet.manifest_sha256,manifest);
 assert.equal(sha(join(qa,'manifests/manifest-v2.jsonl')),manifest);
 assert.equal(packet.fixture_id,'SYN-GAME-FOOLS-MATE');
 assert.equal(packet.synthetic_only,true);assert.equal(packet.disposable_database_only,true);
 assert.equal(packet.release_approved,false);assert.equal(packet.full_security_certified,false);
 assert.equal(packet.fault,kind==='fault'?'suppress-first-controller-abort':null);
 assert.equal(packet.qa_verdict,kind==='fault'?'fail':'pass');
 assert.equal(packet.incomplete_scenario,null,'an incomplete run cannot pass this evidence checker');
 if(kind==='clean')assert.equal(packet.qa_error,null);
 else assert.match(packet.qa_error||'',/qa_injected_early_abort_kept_canceled_request_alive/);
 assert.match(packet.chrome_version,/^Google Chrome 157\.0\.\d+\.\d+$/);
 assert(Number.isFinite(packet.elapsed_ms)&&packet.elapsed_ms>0&&packet.elapsed_ms<25000);
 const fixtures=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8')
  .trim().split('\n').map(JSON.parse);
 const fixture=fixtures.find(x=>x.fixture_id===packet.fixture_id);
 assert(fixture?.source_kind==='synthetic'&&fixture.license==='self-authored');
 const pgn=join(qa,'fixtures',fixture.pgn_file);
 assert.equal(sha(pgn),fixture.pgn_sha256);
 const chess=new Chess();chess.loadPgn(readFileSync(pgn,'utf8'),{strict:true});
 assert(chess.isCheckmate()&&chess.turn()==='w'&&chess.header().Result==='0-1');
 assert(Array.isArray(packet.scenarios)&&packet.scenarios.length===2,
  'both real browser phases are required in one Chrome process');
 const [phase,moment]=packet.scenarios;
 assert.equal(phase.game_id,1);assert.equal(phase.held_stage,'phase');
 assert.equal(moment.game_id,2);assert.equal(moment.held_stage,'moment');
 const allRequestIds=[];
 let totalCalls=0;
 for(const s of [phase,moment]){
  const stage=s.held_stage;
  assert.equal(s.fixture_id,packet.fixture_id);
  assert.equal(s.first_stage_sequence,stage==='phase'?1:2);
  assert.deepEqual(s.initial_stages,stage==='phase'?['phase']:['phase','moment']);
  assert.equal(s.bypass_count,kind==='fault'?1:0);
  assert.equal(s.abort_calls_swallowed,kind==='fault'?1:0,
   'fault did not suppress the actual first AbortController.abort call');
  assert.equal(s.old_closed_before_release,kind==='clean',
   'original canceled request was not in the expected HTTP state');
  assert.equal(s.old_response_sent,kind==='fault');
  assert.equal(s.old_summary_requests_after_release,kind==='fault'?1:0,
   'old phase/moment generation did not advance through real summary step');
  assert.equal(s.old_cache_before_retry_completion,kind==='fault'?first:null,
   'old generation incorrectly appeared in SQLite before retry completed');
  assert.equal(s.replacement_response_sent,true);
  assert.equal(s.final_cached_summary,kind==='fault'?first:second);
  assert.equal(s.cached_language,'en');assert.equal(s.cached_audience,'beginner');
  assert.equal(s.ui_shows_old,kind==='fault',
   'actual GameReportPanel did not match persisted stale/new generation');
  assert.equal(s.ui_shows_new,kind==='clean');
  if(kind==='fault')assert.match(s.ui_error||'',/review_source_changed/);
  else assert.equal(s.ui_error,null);
  assert.deepEqual(s.calls.map(x=>x.stage),expected[kind][stage]);
  assert.deepEqual(s.calls.map(x=>x.sequence),
   s.calls.map((_,i)=>i+1));
  assert.equal(new Set(s.closed).size,s.calls.length,'unclosed local model connection');
  assert(s.closed.every(n=>Number.isSafeInteger(n)&&n>=1&&n<=s.calls.length));
  assert.deepEqual(s.errors,[],'mock provider returned errors');
  assert(Array.isArray(s.chrome_post_ids)&&s.chrome_post_ids.length===2,
   'real Chrome did not send two distinct POSTs to this same game');
  assert(s.chrome_post_ids.every(x=>typeof x==='string'&&x.length>3));
  assert.equal(new Set(s.chrome_post_ids).size,2);
  allRequestIds.push(...s.chrome_post_ids);
  assert(Array.isArray(s.chrome_failed_posts));
  if(kind==='clean')assert(s.chrome_failed_posts.some(x=>x.canceled&&
   x.error==='net::ERR_ABORTED'),
   'normal early-stage Cancel did not register a real Chrome aborted request');
  totalCalls+=s.calls.length;
 }
 assert.equal(new Set(allRequestIds).size,4,
  'Chrome request identifiers were reused across the phase/moment cases');
 assert.equal(totalCalls,kind==='fault'?12:9);
 return {real_chrome_phase_cancel_retry_certified:kind==='clean',
  real_chrome_moment_cancel_retry_certified:kind==='clean',
  broken_first_controller_detected:kind==='fault',
  actual_stale_cache_and_UI_detected:kind==='fault',
  distinct_game_requests:4,local_model_requests:totalCalls,
  synthetic_only:true,product_release_approved:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const clean=JSON.parse(readFileSync(join(qa,'results/review-early-retry.json'),'utf8'));
 const fault=JSON.parse(readFileSync(join(qa,'results/review-early-retry-fault.json'),'utf8'));
 const findings={clean:verifyEarlyStageCancellation(clean,'clean'),
  negative:verifyEarlyStageCancellation(fault,'fault')};
 assert.notEqual(clean.run_id,fault.run_id);
 const report={schema_version:1,at_utc:new Date().toISOString(),
  prior_qa_commit:'9ac537f811346eb26842a2971e8e1e1739031a9f',
  current_qa_checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  branch:'agent/review-benchmark-20261111',
  product_sha:product,backend_sha:backend,stockfish_sha256:engine,
  manifest_sha256:manifest,fixture_id:clean.fixture_id,
  stockfish_version:'16',engine_depth:8,engine_threads:1,engine_hash_mib:16,
  chrome_version:clean.chrome_version,
  clean_run_id:clean.run_id,fault_run_id:fault.run_id,
  expected_process_exits:{clean:0,fault:1},
  verified_findings:findings,
  source_hashes:{runner:sha(join(root,'scripts/review-benchmark-browser-early-retry.mjs')),
   proof:sha(join(root,'scripts/review-benchmark-browser-early-proof.mjs'))},
  raw_evidence_not_committed:true,no_product_files_changed:true,
  sealed_holdout_used:false,integration_approved:false,release_approved:false,
  limitations:['Two early-stage holds of a four-ply self-authored synthetic game',
   'Original React, Hono and real Chrome but local Vite and a loopback simulated model',
   'QA-injected abort suppression is not evidence that the default product is broken',
   'No load, browser accessibility, deployed reverse proxy or actual user history']};
 const destination=join(qa,'certification-summary-checkpoint22.json');
 writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({destination,findings,release_approved:false},null,2));
}
