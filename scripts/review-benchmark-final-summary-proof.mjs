#!/usr/bin/env node
// Independently audits the real Game Review SSE, persisted cache and model
// completion evidence from three synthetic last-response races. A passing QA
// verification still means the product contains the documented profile race.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {Chess} from 'chess.js';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const resultPath=join(qa,'results/review-final-summary-races.json');
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const candidate='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const binary='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const fixture='SYN-GAME-FOOLS-MATE';
const events=s=>[...s.matchAll(/(?:^|\r?\n)event: ([^\r\n]+)/g)].map(x=>x[1]);

export function verifyFinalSummaryRaces(r){
 assert.equal(r.schema_version,1);
 assert.equal(r.candidate_sha,candidate,'wrong app candidate');
 assert.equal(r.engine_sha256,binary,'wrong executable');
 assert.equal(r.manifest_sha256,sha(join(qa,'manifests/manifest-v2.jsonl')),'fixture set changed');
 assert.equal(r.fixture_id,fixture);
 assert.equal(r.rights,'self-authored synthetic, disposable SQLite, synthetic profile, local mock only');
 assert.equal(r.release_approved,false);
 assert.equal(r.product_certified,false);
 const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const metadata=manifest.find(x=>x.fixture_id===fixture);
 assert(metadata?.source_kind==='synthetic'&&metadata.license==='self-authored');
 const source=join(qa,'fixtures',metadata.pgn_file);
 assert.equal(sha(source),metadata.pgn_sha256);
 const game=new Chess();game.loadPgn(readFileSync(source,'utf8'),{strict:true});
 assert.equal(game.header().Result,'0-1');
 assert(game.isCheckmate()&&game.turn()==='w','independent checkmate outcome missing');
 const o=r.outcomes;
 assert(o.raw_sse&&typeof o.raw_sse.source==='string'&&typeof o.raw_sse.profile==='string'&&typeof o.raw_sse.cancel==='string');
 const s=events(o.raw_sse.source),p=events(o.raw_sse.profile),c=events(o.raw_sse.cancel);
 assert(s.includes('progress')&&s.includes('error')&&!s.includes('done'),
  'reanalyzed stale result did not produce an error rather than done');
 assert(o.raw_sse.source.includes('review_source_changed'),'expected actual error detail absent');
 assert(p.includes('progress')&&p.includes('done')&&!p.includes('error'),
  'profile-change response did not claim completion');
 assert(o.raw_sse.profile.includes('"language":"en"'),
  'actual completed profile-change stream did not contain prior English language');
 assert(c.includes('progress')&&!c.includes('done'),
  'aborted final response did not close without done');
 assert.equal(o.raw_sse.cancel.length,o.cancel_last_model.observed_stream_bytes);
 assert(o.raw_sse.cancel.length>0);
 const re=o.reanalysis;
 assert(Number.isFinite(re.original_accuracy)&&Number.isFinite(re.new_accuracy));
 assert(Math.abs((re.original_accuracy-re.new_accuracy)-20)<0.001,
  'the source change was not the expected synthetic reanalysis mutation');
 assert.equal(re.stale_done,false);assert.equal(re.stale_error,true);
 assert.equal(re.cache_null,true);
 assert.equal(re.pending_autoreview_queue,1);
 const pr=o.profile_change;
 assert.equal(pr.old_language,'en');assert.equal(pr.new_language,'es');
 assert.equal(pr.emitted_done,true);assert.equal(pr.cached_prose_language,'en');
 assert.equal(pr.old_language_cache_saved,true);
 assert.equal(pr.stale_get,true);assert.equal(pr.auto_review_queued,0);
 assert.equal(pr.delivered_old_language_in_sse,true);
 const ca=o.cancel_last_model;
 assert.equal(ca.summary_request_reached,true);assert.equal(ca.sse_closed,true);
 assert.equal(ca.done_emitted,false);assert.equal(ca.cache_null,true);
 assert.equal(ca.pending_autoreview_queue,1);
 assert.equal(o.total_model_calls,9);
 assert.equal(o.raw_provider_response_closures,9);
 assert.deepEqual(o.stage_counts,{source_change:3,profile_change:3,cancel_summary:3});
 assert.equal(r.reanalysis_cas_protected,true);
 assert.equal(r.midflight_profile_language_race_reproduced,true);
 assert.equal(r.final_summary_cancel_safe,true);
 assert(Number.isFinite(r.elapsed_ms)&&r.elapsed_ms>0&&r.elapsed_ms<10000);
 return {reanalyzed_source_race_blocked:true,
  in_flight_profile_language_cache_defect_proven:true,
  last_model_request_cancellation_protected:true,model_calls:9,
  full_product_certified:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const observed=JSON.parse(readFileSync(resultPath,'utf8'));
 const verdict=verifyFinalSummaryRaces(observed);
 const report={schema_version:1,at_utc:new Date().toISOString(),
  previous_qa_checkpoint:'22c2b175a7233e99ed909f0bead9c8e6c8023fb9',
  qa_checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  branch:'agent/review-benchmark-20261111',candidate_sha:candidate,
  fixture_manifest_v2_sha256:observed.manifest_sha256,engine_sha256:binary,
  engine:'Stockfish 16',analysis_depth:8,threads:1,hash_mib:16,
  fixture_id:fixture,synthetic_source_only:true,
  real_application_scope:'three authenticated SSE Game Review requests held at final JSON provider response',
  results:verdict,
  failure_requiring_owner_remediation:'profile_language_change_during_generation_caches_old_language_and_skips_auto_regeneration',
  preserved_protections:['analysis_change_prevents_stale_cache_write',
   'final_model_request_cancel_does_not_persist_review'],
  source_hashes:{runner:sha(join(root,'scripts/review-benchmark-final-summary-races.mjs')),
   verifier:sha(join(root,'scripts/review-benchmark-final-summary-proof.mjs'))},
  integration_approved:false,release_approved:false,
  limitations:['One in-process synthetic game per scenario, no real network proxy or external LLM',
   'Profile language was changed only in disposable SQLite and the changed language was observed after completion',
   'Cancellation was during the final model request, not inside the synchronous DB commit instruction',
   'No sealed holdout, real model hallucination prevalence, real-browser study or Stockfish 17 parity']};
 const dest=join(qa,'certification-summary-checkpoint12.json');
 writeFileSync(dest,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({out:dest,...verdict,release_approved:false},null,2));
}
