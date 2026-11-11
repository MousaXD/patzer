#!/usr/bin/env node
/** Independent proof for actual two-process HTTP session revocation evidence.
 * Confirms real SSE and PGN facts, not just optimistic runner verdict flags.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {Chess} from 'chess.js';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const target='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const bin='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const fixtureDigest='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
const validRunId=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function certifyCrossProcessEvidence(packet){
 assert.equal(packet.schema_version,1);
 assert.equal(packet.candidate_sha,target,'wrong independently frozen candidate');
 assert.equal(packet.engine_sha256,bin,'engine changed');
 assert.equal(packet.manifest_sha256,fixtureDigest,'manifest identity changed');
 assert.equal(sha(join(qa,'manifests/manifest-v2.jsonl')),fixtureDigest,'manifest bytes changed');
 assert.equal(packet.fixture_id,'SYN-GAME-FOOLS-MATE');
 assert.equal(packet.rights,'self-authored synthetic chess, fake sessions and disposable WAL SQLite only');
 assert.equal(packet.qa_test_only_http_fault,null,'test-only bypass was enabled');
 assert(validRunId.test(packet.benchmark_run_id||''),'missing unique run identity');
 assert.equal(packet.in_flight_cancel_policy,'unspecified');
 assert.equal(packet.cross_process_new_request_revocation_passed,true);
 assert.equal(packet.pre_admitted_stream_continues,true);
 assert.equal(packet.release_approved,false);
 assert.equal(packet.overall_authentication_certified,false);

 const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8').trim()
  .split('\n').map(JSON.parse);
 const entry=manifest.find(x=>x.fixture_id===packet.fixture_id);
 assert(entry?.source_kind==='synthetic'&&entry.license==='self-authored');
 const fixture=join(qa,'fixtures',entry.pgn_file);
 assert.equal(sha(fixture),entry.pgn_sha256,'synthetic PGN source bytes changed');
 const chess=new Chess();chess.loadPgn(readFileSync(fixture,'utf8'),{strict:true});
 assert(chess.isCheckmate()&&chess.turn()==='w'&&chess.header().Result==='0-1',
  'independent chess truth must be checkmate delivered by Black');
 const o=packet.observations;
 assert(Array.isArray(o.worker_pids)&&o.worker_pids.length===2);
 assert(o.worker_pids.every(n=>Number.isSafeInteger(n)&&n>0));
 assert.notEqual(o.worker_pids[0],o.worker_pids[1],
  'not demonstrably independent processes');
 assert(Array.isArray(o.worker_ports)&&o.worker_ports.length===2);
 assert(o.worker_ports.every(n=>Number.isSafeInteger(n)&&n>0&&n<=65535));
 assert.notEqual(o.worker_ports[0],o.worker_ports[1],
  'not demonstrably different loopback HTTP sockets');
 assert.deepEqual(o.pre_logout_get,[200,200],
  'both processes did not authenticate the initial session');
 assert.equal(o.pre_admitted_post_status,200);
 assert.equal(o.model_final_held_at_logout,true,'test did not overlap an unfinished AI review');
 assert.equal(o.cache_null_when_logout_started,true,'cache was not actually pending at logout');
 assert.equal(o.logout_status,200);
 assert.equal(o.logout_acknowledged,true);
 assert.equal(o.cookie_expired,true);
 assert.equal(o.session_rows_after_logout,0,'shared session row remained');
 assert.deepEqual(o.old_cookie_statuses,[401,401,401,401],
  'revoked cookie must not authenticate GET/POST on either process');
 assert.deepEqual(o.tampered_cookie_statuses,[401,401],
  'a corrupted cookie signature must not grant access on either process');

 assert(typeof o.pre_admitted_sse==='string'&&o.pre_admitted_sse.includes('event: progress'),
  'missing actual streamed progress');
 const done=[...o.pre_admitted_sse.matchAll(/(?:^|\n)event: done\r?\ndata: ([^\r\n]+)/g)];
 assert.equal(done.length,1,'exactly one actual stream completion required');
 assert(!o.pre_admitted_sse.includes('event: error'),'in-flight review emitted a terminal error');
 const review=JSON.parse(done[0][1])?.review;
 assert(review&&typeof review==='object','actual SSE lacks review object');
 assert.equal(review.summary,'Black won the game.');
 assert.equal(review.language,'en');assert.equal(review.audience,'beginner');
 assert.equal(review.key_moments?.[0]?.ply,3);
 assert.equal(review.key_moments?.[0]?.side,'white');
 assert.equal(review.key_moments?.[0]?.by_user,true);
 assert.equal(o.pre_admitted_stream_done,true);
 assert.equal(o.cache_written_after_logout,true);
 assert.equal(o.new_session_count,1);
 assert.deepEqual(o.fresh_cookie_statuses,[200,200],
  'fresh session did not work on both processes after revocation');
 assert.deepEqual(o.new_cookie_summaries,[review.summary,review.summary],
  'fresh session did not retrieve same cached review from both processes');
 assert.equal(o.model_calls,3);
 assert.equal(o.provider_closed,3,'model response lifecycle incomplete');
 assert.deepEqual(o.model_stages,['phase','moment','summary']);
 assert.deepEqual(o.model_errors,[]);
 assert(Number.isFinite(packet.elapsed_ms)&&packet.elapsed_ms>0&&packet.elapsed_ms<18000);
 return {separate_processes_and_http_sockets_confirmed:true,
  shared_sqlite_logout_rejects_future_admissions:true,
  previously_admitted_review_completes:true,
  fresh_session_works_on_both_workers:true,
  independent_negative_cookie_controls_passed:true,
  policy_for_canceling_inflight_work:'not established',
  full_authentication_certified:false,release_approved:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const file=join(qa,'results/review-crossprocess-logout.json');
 const raw=JSON.parse(readFileSync(file,'utf8'));
 const result=certifyCrossProcessEvidence(raw);
 const report={schema_version:1,at_utc:new Date().toISOString(),
  parent_qa_commit:'d7712012cc26efee36ab07cc21ff90de2fe18730',
  qa_checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  own_branch:'agent/review-benchmark-20261111',
  candidate_sha:target,stockfish_sha256:bin,stockfish_version:'16',
  depth:8,threads:1,hash_mib:16,
  manifest_sha256:fixtureDigest,fixture_id:raw.fixture_id,
  qa_run_id:raw.benchmark_run_id,raw_evidence_uncommitted:true,
  verdict:result,
  source_hashes:{worker:sha(join(root,'scripts/review-benchmark-revocation-worker.mjs')),
   harness:sha(join(root,'scripts/review-benchmark-cross-process-logout.mjs')),
   verifier:sha(join(root,'scripts/review-benchmark-cross-process-proof.mjs'))},
  integration_approved:false,release_approved:false,
  limitations:['Real HTTP over distinct local Node processes and shared synthetic SQLite WAL only',
   'Minimal route mounting omits global CSRF/CORS and browser identity-provider behavior',
   'In-flight request cancellation after logout has no specified product contract',
   'No production DB or data, remote model, cross-machine deployment or sealed holdout']};
 const dest=join(qa,'certification-summary-checkpoint19.json');
 writeFileSync(dest,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:dest,...result},null,2));
}
