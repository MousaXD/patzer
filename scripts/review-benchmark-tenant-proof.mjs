#!/usr/bin/env node
/**
 * Independent verifier for two-user real Game Review SSE/caching experiment.
 * Chess truth, wire frames, model-prompt facts, persisted labels and actual
 * cross-user HTTP statuses are checked separately from the test runner flags.
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
const expected={
 en:{language:'en',audience:'beginner',summary:'Black won the game.',by_user:true,
  result:'you lost',mover:'you'},
 es:{language:'es',audience:'advanced',summary:'Las negras ganaron la partida.',by_user:false,
  result:'ganaste',mover:'el rival'},
};
const stages=['phase','moment','summary'];
function readReviewFromSse(s){
 assert(typeof s==='string'&&s.includes('event: progress'),'missing authentic SSE progress');
 const done=[...s.matchAll(/(?:^|\n)event: done\r?\ndata: ([^\r\n]+)/g)];
 assert.equal(done.length,1,'exactly one genuine done event required');
 assert(!s.includes('event: error'),'failed review was not a completed success');
 const review=JSON.parse(done[0][1])?.review;
 assert(review&&typeof review==='object','SSE lacks actual review payload');
 return review;
}
export function validateTenantConcurrencyEvidence(r){
 assert.equal(r.schema_version,1);
 assert.equal(r.candidate_sha,source,'not the pinned backend candidate');
 assert.equal(r.engine_sha256,engine,'Stockfish binary changed');
 assert.equal(r.manifest_sha256,manifest,'fixture manifest digest mismatch');
 assert.equal(sha(join(qa,'manifests/manifest-v2.jsonl')),manifest,'fixture manifest bytes changed');
 assert.equal(r.fixture_id,'SYN-GAME-FOOLS-MATE');
 assert.equal(r.rights,'QA-authored synthetic chess, fake users and disposable database');
 assert.equal(r.overall_product_security_certified,false);
 assert.equal(r.release_approved,false);
 const entry=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8').trim()
  .split('\n').map(JSON.parse).find(x=>x.fixture_id===r.fixture_id);
 assert(entry?.source_kind==='synthetic'&&entry.license==='self-authored');
 const pgnFile=join(qa,'fixtures',entry.pgn_file);
 assert.equal(sha(pgnFile),entry.pgn_sha256);
 const chess=new Chess();chess.loadPgn(readFileSync(pgnFile,'utf8'),{strict:true});
 assert.equal(chess.header().Result,'0-1','independent PGN result Black win missing');
 assert(chess.isCheckmate()&&chess.turn()==='w','Black must have delivered checkmate');
 const o=r.observation;
 assert.equal(o.unauthenticated_post_denied,true);
 assert.equal(o.cross_tenant_get_and_post_denied,true);
 assert.equal(o.both_started_uncached,true);
 assert.deepEqual(o.actual_access_status,{
  unauthenticated_post:401,en_cross_user_get:404,en_cross_user_post:404,
  es_cross_user_get:404,es_cross_user_post:404,
 });
 assert.equal(o.calls,6,'missing model requests');
 assert.equal(o.provider_responses_closed,6,'unclosed provider request');
 assert.deepEqual(o.provider_errors,[]);
 assert(Number.isFinite(o.white_accuracy)&&o.white_accuracy>=0&&o.white_accuracy<=100);
 assert(Number.isFinite(o.black_accuracy)&&o.black_accuracy>=0&&o.black_accuracy<=100);
 assert.equal(o.model_prompts.length,6,'not every real LLM FACTS request captured');
 assert.deepEqual(o.model_prompts.map(x=>x.lang),['en','es','es','es','en','en'],
  'model prompt ordering not the deliberately controlled overlap');
 assert.deepEqual(o.provider_reply_order,[
  {lang:'es',stage:'phase'},{lang:'es',stage:'moment'},{lang:'es',stage:'summary'},
  {lang:'en',stage:'phase'},{lang:'en',stage:'moment'},{lang:'en',stage:'summary'},
 ],'reversed completion order not proven');
 for(const [lang,want] of Object.entries(expected)){
  const model=o.model_prompts.filter(x=>x.lang===lang);
  assert.deepEqual(model.map(x=>x.stage),stages,'not a complete actual model pipeline for '+lang);
  assert(model.every(x=>x.audience===want.audience),'incorrect per-user prompt audience');
  assert.equal(model[1].mover,want.mover,'opponent and player ownership mixed up');
  assert.equal(model[2].result,want.result,'game-result perspective inconsistent with PGN truth');
  const accuracy=lang==='en'?o.white_accuracy:o.black_accuracy;
  assert.equal(model[0].accuracy,accuracy);
  assert.equal(model[2].accuracy,accuracy);
  const wire=readReviewFromSse(o.real_sse?.[lang]);
  assert.equal(wire.language,want.language);
  assert.equal(wire.audience,want.audience);
  assert.equal(wire.summary,want.summary,'incorrect recipient-specific review summary in real SSE');
  assert.equal(wire.phases?.opening?.accuracy,accuracy);
  assert.equal(wire.key_moments?.[0]?.side,'white');
  assert.equal(wire.key_moments?.[0]?.ply,3);
  assert.equal(wire.key_moments?.[0]?.by_user,want.by_user);
  assert.deepEqual(o.cached[lang],{
   language:want.language,audience:want.audience,
   summary:want.summary,by_user:want.by_user,
  },'cross-user cached review mismatch');
  assert.deepEqual(o.readback[lang],{
   language:want.language,audience:want.audience,summary:want.summary,stale:false,
  },'authenticated GET leaked a different review');
 }
 // These self-reported flags are checked AFTER independent, chess-derived
 // SSE and cache proof. A forged `green` flag cannot mask a bad wire payload.
 assert.equal(r.test_only_provider_fault,null,'test-only corruption not a certifiable clean run');
 assert.equal(r.tested_tenants_isolated,true);
 assert.equal(o.provider_payload_swapped,false);
 assert.equal(o.cross_user_prose_accepted_and_cached,false);
 assert(Number.isFinite(r.elapsed_ms)&&r.elapsed_ms>0&&r.elapsed_ms<15000);
 return {both_tenant_sse_payloads_correct:true,
  per_tenant_cached_review_isolated:true,
  model_prompt_perspectives_isolated:true,
  cross_tenant_access_denied:true,
  local_model_requests:6,
  whole_application_security_certified:false};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const path=join(qa,'results/review-tenant-concurrency.json');
 const raw=JSON.parse(readFileSync(path,'utf8'));
 const checked=validateTenantConcurrencyEvidence(raw);
 const report={schema_version:1,at_utc:new Date().toISOString(),
  previous_qa_checkpoint:'710381f2c6ec047a0947cc999825c53afd6ddb16',
  current_qa_checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  branch:'agent/review-benchmark-20261111',candidate_sha:source,
  engine_sha256:engine,engine_version:'Stockfish 16',threads:1,hash_mib:16,depth:8,
  fixture_id:raw.fixture_id,fixture_manifest_sha256:manifest,
  synthetic_only:true,holdout_games_used:0,
  scope:'authenticated real Game Review SSE concurrent user ownership, separate game rows',
  independent_verdict:checked,
  test_result:{source_isolation_passed:true,real_model_calls:6,
   full_product_releasability:false},
  source_sha256:{harness:sha(join(root,'scripts/review-benchmark-tenant-concurrency.mjs')),
   verifier:sha(join(root,'scripts/review-benchmark-tenant-proof.mjs'))},
  uncommitted_raw_evidence:true,integration_approved:false,release_approved:false,
  limitations:['Two users, one synthetic Fool\'s Mate PGN and a single in-process Hono route',
   'No real browser login, reverse proxy, 10,000-game library or cross-process worker',
   'The fake model is controlled to make per-user contamination visible; this does not measure real LLM reliability',
   'All other endpoints and actual production sessions remain untested']};
 const output=join(qa,'certification-summary-checkpoint16.json');
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:output,...checked,release_approved:false},null,2));
}
