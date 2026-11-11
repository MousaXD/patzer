#!/usr/bin/env node
// Independent auditor for real authenticated audience-profile/cache races.
// A passing hostile experiment proves a candidate defect, NOT release safety.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {Chess} from 'chess.js';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const result=join(qa,'results/review-audience-race.json');
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const candidate='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const engine='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
function eventPayload(raw,type){
 assert(typeof raw==='string'&&raw.length>0,'missing real SSE response');
 const matched=[...raw.matchAll(/(?:^|\r?\n)event:\s*([^\r\n]+)\r?\ndata:\s*([^\r\n]*)/g)];
 const events=matched.map(x=>({type:x[1],data:x[2]}));
 assert(events.some(x=>x.type==='progress'),'no real SSE progress proof');
 assert.equal(events.filter(x=>x.type===type).length,1,'expected terminal event missing/duplicated');
 assert(!events.some(x=>x.type==='error'),'unexpected terminal error');
 const p=events.find(x=>x.type===type);
 assert(p,'terminal event missing');
 const decoded=JSON.parse(p.data);
 assert(decoded&&typeof decoded==='object'&&decoded.review,'missing generated review');
 return decoded.review;
}
export function verifyAudienceEvidence(packet){
 assert.equal(packet.schema_version,1);
 assert.equal(packet.candidate_sha,candidate,'app SHA mismatch');
 assert.equal(packet.engine_sha256,engine,'engine executable mismatch');
 assert.equal(packet.manifest_sha256,sha(join(qa,'manifests/manifest-v2.jsonl')),'fixture manifest drift');
 assert.equal(packet.fixture_id,'SYN-GAME-FOOLS-MATE');
 assert.equal(packet.provenance,'QA-authored synthetic game, fake account, disposable DB, local mock only');
 assert.equal(packet.same_audience_positive_passed,true);
 assert.equal(packet.in_flight_audience_stale_cache_reproduced,true);
 assert.equal(packet.manual_advanced_audience_recovery_passed,true);
 assert.equal(packet.release_approved,false);
 assert.equal(packet.product_certified,false);
 const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const fixture=manifest.find(x=>x.fixture_id===packet.fixture_id);
 assert(fixture?.source_kind==='synthetic'&&fixture.license==='self-authored');
 const pgn=join(qa,'fixtures',fixture.pgn_file);
 assert.equal(sha(pgn),fixture.pgn_sha256,'PGN content changed');
 const board=new Chess();board.loadPgn(readFileSync(pgn,'utf8'),{strict:true});
 assert(board.isCheckmate()&&board.turn()==='w'&&board.header().Result==='0-1');
 const o=packet.data;
 const control=eventPayload(o.same_audience.sse,'done');
 assert.equal(control.audience,'beginner');
 assert.equal(o.same_audience.emitted_done,true);
 assert.equal(o.same_audience.cached_audience,'beginner');
 assert.equal(o.same_audience.get_delivered_beginner,true);
 assert.equal(o.same_audience.was_not_marked_stale,true);
 assert.equal(o.same_audience.auto_pending,0);
 const race=eventPayload(o.audience_changed.sse,'done');
 assert.equal(race.audience,'beginner','stale model output did not reach real route');
 assert.equal(o.audience_changed.before,'beginner');
 assert.equal(o.audience_changed.after,'advanced');
 assert.equal(o.audience_changed.emitted_done,true);
 assert.equal(o.audience_changed.delivered_old_audience,true);
 assert.equal(o.audience_changed.cached_audience,'beginner');
 assert.equal(o.audience_changed.cache_written,true);
 assert.equal(o.audience_changed.got_stale_result,true);
 assert.equal(o.audience_changed.auto_pending,0,'automatic review did not skip this stale row');
 const recovery=eventPayload(o.manual_recovery.sse,'done');
 assert.equal(recovery.audience,'advanced');
 assert.equal(o.manual_recovery.emitted_done,true);
 assert.equal(o.manual_recovery.delivered_new_audience,true);
 assert.equal(o.manual_recovery.cached_audience,'advanced');
 assert.equal(o.manual_recovery.get_delivered_advanced,true);
 assert.equal(o.manual_recovery.auto_pending,0);
 assert.equal(o.requests,9,'three real model pipelines not proven');
 assert.equal(o.closed_provider_responses,9,'mock response leaked or missing');
 assert.deepEqual(o.request_stages.map(x=>x.stage),
  ['phase','moment','summary','phase','moment','summary','phase','moment','summary']);
 assert.deepEqual(o.request_stages.map(x=>x.mode),
  ['hold_control','hold_control','hold_control',
   'hold_audience','hold_audience','hold_audience','instant','instant','instant']);
 assert(Number.isFinite(packet.elapsed_ms)&&packet.elapsed_ms>0&&packet.elapsed_ms<15000);
 return {positive_no_change_accepted:true,audience_profile_race_exposed:true,
  manual_recovery_works:true,test_only_model_posts:9,product_releasable:false};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const payload=JSON.parse(readFileSync(result,'utf8'));
 const evidence=verifyAudienceEvidence(payload);
 const report={
  schema_version:1,created_utc:new Date().toISOString(),
  prior_checkpoint_commit:'132b462cede69982f0a520cc051e62eb4212a0da',
  agent_d_checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  branch:'agent/review-benchmark-20261111',
  candidate_sha:candidate,stockfish_sha256:engine,stockfish_version:'16',threads:1,hash_mib:16,depth:8,
  manifest_sha256:payload.manifest_sha256,fixture_id:payload.fixture_id,holdout_cases:0,
  source_kind:'self-authored synthetic',
  test_scope:'real authenticated Hono review SSE + DB cache under in-flight profile audience mutation',
  findings:evidence,
  root_cause:'atomic cache writer does not confirm current profile audience; null-only auto queue skips stale non-null prose',
  prior_language_race_connection:'checkpoint12 same missing profile provenance',
  raw_app_sse_records_uncommitted:true,
  source_hashes:{runner:sha(join(root,'scripts/review-benchmark-audience-race.mjs')),
   verifier:sha(join(root,'scripts/review-benchmark-audience-proof.mjs'))},
  release_approved:false,integration_approved:false,
  limitations:['One hand-controlled audience transition on an approved four-ply game',
   'SSE and cache are authentic source paths; profile changed only via disposable DB',
   'No human pedagogy or multi-user load certification; no external model or production records',
   'No browser rendering assertion is made from server-only SSE evidence',
   'Stockfish 16 only; no released Stockfish 17 equivalence']};
 const dest=join(qa,'certification-summary-checkpoint13.json');
 writeFileSync(dest,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:dest,...evidence,release_approved:false},null,2));
}
