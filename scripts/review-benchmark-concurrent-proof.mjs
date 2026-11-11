#!/usr/bin/env node
// Independent evidence verifier. This asserts the exact concurrency event
// ordering and persistence/ownership results, not merely "no error".
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {Chess} from 'chess.js';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const results=join(qa,'results');
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const candidate='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const engine='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const fixture='SYN-GAME-FOOLS-MATE';

export function certifyLimitedConcurrencyEvidence(r){
 assert.equal(r.schema_version,1);
 assert.equal(r.candidate_sha,candidate,'wrong frozen candidate');
 assert.equal(r.engine_sha256,engine,'engine identity changed');
 assert.equal(r.manifest_sha256,sha(join(qa,'manifests/manifest-v2.jsonl')),'manifest changed');
 assert.equal(r.fixture_id,fixture);
 assert.equal(r.source_rights,'self-authored synthetic; disposable SQLite and sessions');
 assert.equal(r.release_approved,false);
 assert.equal(r.overall_product_certified,false);
 assert.equal(r.correct_stale_write_cas,true);
 assert.equal(r.concurrent_coalescing_observed,false);
 const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const meta=manifest.find(x=>x.fixture_id===fixture);
 assert(meta?.license==='self-authored'&&meta?.source_kind==='synthetic');
 const pgn=join(qa,'fixtures',meta.pgn_file);
 assert.equal(sha(pgn),meta.pgn_sha256);
 const replay=new Chess();replay.loadPgn(readFileSync(pgn,'utf8'),{strict:true});
 assert.equal(replay.header().Result,'0-1');
 assert(replay.isCheckmate()&&replay.turn()==='w');
 const o=r.observation;
 for(const flag of ['b_saved','a_stale_error','final_b_remains',
  'read_b_verbatim','cross_user_get_denied','no_auth_post_denied',
  'cross_user_post_denied','b_done','same_source_both_started_without_cache',
  'error_event','duplicate_provider_work']) assert.equal(o[flag],true,'missing '+flag);
 assert.equal(o.a_done,false,'stale review announced success');
 assert.equal(o.provider_calls,6,'not all two pipelines executed');
 assert.equal(o.provider_responses_closed,6,'some provider responses leaked');
 assert.deepEqual(o.provider_errors,[]);
 assert.deepEqual(o.provider_reply_stages.A,['phase','moment','summary']);
 assert.deepEqual(o.provider_reply_stages.B,['phase','moment','summary']);
 assert.deepEqual(o.release_order,['B phase first','A phase second']);
 assert.equal(o.a_summary,'Black won this game.');
 assert.equal(o.b_summary,'Black won the game.');
 assert.equal(o.final_summary,o.b_summary);
 assert(Number.isFinite(r.elapsed_ms)&&r.elapsed_ms>0&&r.elapsed_ms<10000,
  'test did not finish under bounded time');
 return {independent_source_and_game_checks_passed:true,stale_write_blocked:true,
  two_full_model_pipelines_proven:true,avoidable_duplicate_generation_observed:true,
  full_release_certified:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const data=JSON.parse(readFileSync(join(results,'review-concurrent-real-route.json'),'utf8'));
 const conclusion=certifyLimitedConcurrencyEvidence(data);
 const packet={schema_version:1,at_utc:new Date().toISOString(),
  parent_checkpoint_commit:'2ca55efe3635deb4dc66590d201cc6c0be85bba7',
  qa_checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  own_branch:'agent/review-benchmark-20261111',candidate_sha:candidate,
  manifest_v2_sha256:data.manifest_sha256,engine_sha256:engine,
  engine:'Stockfish 16',threads:1,hash_mib:16,depth:8,
  fixture_id:fixture,source_rights:'self-authored synthetic',holdout_cases_used:0,
  real_application_scope:'two overlapping authenticated POST /api/games/:id/review SSE requests; atomic cached-prose writer',
  controlled_race:'B provider response completed before A even though A started first',
  conclusions:conclusion,observed_provider_calls:6,minimum_nonduplicated_calls:3,
  duplicate_generation_factor_in_this_experiment:2,
  observed_latency_ms:data.elapsed_ms,
  source_hashes:{harness:sha(join(root,'scripts/review-benchmark-concurrent-review.mjs')),
   verifier:sha(join(root,'scripts/review-benchmark-concurrent-proof.mjs'))},
  product_release_certified:false,integration_approved:false,
  risks:['This is one in-process two-request race, not a production throughput or load estimate',
   'Overlapping same-game generation uses twice the tested model calls but only one review is retained',
   'A single-flight/deduplication fix must not weaken CAS safety, authentication or cancel behavior',
   'Previous stale-analysis cache read and natural-language truth defects are unaffected',
   'HTTP reverse proxy/browser cancellation and Stockfish 17 parity are not tested']};
 const out=join(qa,'certification-summary-checkpoint11.json');
 writeFileSync(out,JSON.stringify(packet,null,2)+'\n');
 console.log(JSON.stringify({out,...conclusion,duplication_factor:2,release_approved:false},null,2));
}
