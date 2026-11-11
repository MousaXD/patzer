#!/usr/bin/env node
/** Verify real-route logout timing with independent SSE and chess evidence.
 * Do not infer a logout cancellation policy from request-auth admission.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {Chess} from 'chess.js';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const source='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const engine='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const manifest='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';

export function verifyLogoutInFlight(p){
 assert.equal(p.schema_version,1);
 assert.equal(p.candidate_sha,source);
 assert.equal(p.engine_sha256,engine);
 assert.equal(p.manifest_sha256,manifest);
 assert.equal(sha(join(qa,'manifests/manifest-v2.jsonl')),manifest);
 assert.equal(p.fixture_id,'SYN-GAME-FOOLS-MATE');
 assert.equal(p.rights,'self-authored chess, disposable SQLite, synthetic sessions, loopback-only model');
 assert.equal(p.full_security_certified,false);
 assert.equal(p.release_approved,false);
 assert.equal(p.logout_should_cancel_existing_stream_policy,'unspecified');
 const entry=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8').trim().split('\n')
  .map(JSON.parse).find(e=>e.fixture_id===p.fixture_id);
 assert(entry?.source_kind==='synthetic'&&entry.license==='self-authored');
 const pg=join(qa,'fixtures',entry.pgn_file);
 assert.equal(sha(pg),entry.pgn_sha256);
 const chess=new Chess();chess.loadPgn(readFileSync(pg,'utf8'),{strict:true});
 assert(chess.isCheckmate()&&chess.turn()==='w'&&chess.header().Result==='0-1');
 const x=p.observations;
 assert.equal(x.session_rows_before_logout,1);
 assert.equal(x.admitted_review_http_status,200);
 assert.equal(x.final_model_response_held_at_logout,true);
 assert.equal(x.cache_was_null_at_logout,true);
 assert.equal(x.real_logout_status,200,'did not actually call success logout route');
 assert.equal(x.real_logout_ok,true);
 assert.equal(x.logout_cookie_cleared,true,'the logout cookie was not deleted');
 assert.equal(x.session_rows_after_logout,0,'old user session still in disposable DB');
 assert.equal(x.revoked_get_status,401,'reused revoked cookie retrieved review');
 assert.equal(x.revoked_post_status,401,'reused revoked cookie generated review');
 const s=x.existing_request_sse;
 assert(typeof s==='string'&&s.includes('event: progress'),'missing in-flight review SSE');
 const done=[...s.matchAll(/(?:^|\n)event: done\r?\ndata: ([^\r\n]+)/g)];
 assert.equal(done.length,1,'pre-admitted request did not finish once');
 assert(!s.includes('event: error'));
 const review=JSON.parse(done[0][1])?.review;
 assert(review&&typeof review==='object');
 assert.equal(review.summary,'Black won the game.');
 assert.equal(review.language,'en');assert.equal(review.audience,'beginner');
 assert.equal(x.existing_request_emitted_done,true);
 assert.equal(x.existing_request_emitted_error,false);
 assert.equal(x.cached_after_logout,true);
 assert.equal(x.new_session_rows,1,'post-logout test reauthorization did not create a valid session');
 assert.equal(x.new_session_get_status,200);
 assert.equal(x.new_session_cached_summary,review.summary);
 assert.equal(x.model_calls,3);
 assert.equal(x.model_responses_closed,3);
 assert.deepEqual(x.model_stages,['phase','moment','summary']);
 assert.equal(p.all_new_requests_denied,true);
 assert.equal(p.pre_admitted_stream_continued,true);
 assert(Number.isFinite(p.elapsed_ms)&&p.elapsed_ms>0&&p.elapsed_ms<15000);
 return {logout_completed:true,revoked_cookie_rejected_for_new_requests:true,
  previously_admitted_review_completed_after_logout:true,
  persisted_review_access_requires_new_session:true,
  policy_for_canceling_inflight_request:'not determined',
  release_approved:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const r=JSON.parse(readFileSync(join(qa,'results/review-logout-inflight.json'),'utf8'));
 const result=verifyLogoutInFlight(r);
 const report={schema_version:1,at_utc:new Date().toISOString(),
  previous_agent_d_head:'122b1fae66840a1d46940be81c4e004ac63a4beb',
  current_qa_checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  branch:'agent/review-benchmark-20261111',source_sha:source,
  engine_sha256:engine,engine_version:'Stockfish 16',threads:1,hash_mib:16,depth:8,
  fixture_manifest_sha256:manifest,fixture_id:r.fixture_id,
  synthetic_only:true,tests_real_authenticated_logout_route:true,
  observed_result:result,
  evidence_sha256:{runner:sha(join(root,'scripts/review-benchmark-logout-inflight.mjs')),
   verifier:sha(join(root,'scripts/review-benchmark-logout-proof.mjs'))},
  no_release_approval:true,security_cancellation_policy_unresolved:true,
  scope_limitations:['One fake account and one in-process Hono flow, not a browser session',
   'After logout, original admitted request continues; no requirement that it must abort was found in the route',
   'No real proxy timing, third-party model, production data, or sealed holdout']};
 const dest=join(qa,'certification-summary-checkpoint18.json');
 writeFileSync(dest,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:dest,...result},null,2));
}
