#!/usr/bin/env node
/**
 * Independent evidence validation for a real, authenticated, cancelable SSE
 * Game Review run. A successful scoped test says only this path worked for
 * the disposable fixture, NOT that all cancellation races are safe.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {Chess} from 'chess.js';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence');
const results=join(qa,'results');
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const engine='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const coach='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';

export function validateCancelReport(r){
 assert.equal(r.schema_version,1);
 assert.equal(r.candidate_sha,coach,'candidate changed');
 assert.equal(r.engine_sha256,engine,'wrong Stockfish');
 assert.equal(r.manifest_sha256,sha(join(qa,'manifests/manifest-v2.jsonl')),'manifest drift');
 assert.equal(r.fixture_id,'SYN-GAME-FOOLS-MATE');
 assert.equal(r.source_rights,'self-authored synthetic; synthetic users and disposable SQLite');
 const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const entry=manifest.find(x=>x.fixture_id===r.fixture_id);
 assert(entry?.license==='self-authored' && entry?.source_kind==='synthetic');
 const pgnFile=join(qa,'fixtures',entry.pgn_file);
 assert.equal(sha(pgnFile),entry.pgn_sha256);
 const board=new Chess();board.loadPgn(readFileSync(pgnFile,'utf8'),{strict:true});
 assert(board.isCheckmate()&&board.turn()==='w','must prove Black wins from independent PGN');
 assert.equal(r.cancellation_safe_on_tested_path,true);
 assert.equal(r.release_approved,false);
 assert.equal(r.product_cancellation_fully_certified,false);
 const c=r.results;
 assert.equal(c.aborted_sse_closed,true,'the signal did not actually close SSE');
 assert.equal(c.aborted_request_cache_absent,true,'aborted review persisted');
 assert.equal(c.aborted_before_any_model_reply,true,'the mock returned an early reply');
 assert.equal(c.provider_posts_when_canceled,1,'the abort happened at an unexpected point');
 assert.equal(c.aborted_sse_emitted_done,false,'an aborted stream falsely claimed completion');
 assert(Number.isInteger(c.aborted_sse_body_bytes)&&c.aborted_sse_body_bytes>0,
  'no evidence that a real SSE progress event was observed');
 assert.equal(c.success_sse_has_done,true,'successful control never completed');
 assert.equal(c.success_cache_written,true,'successful control did not persist');
 assert.equal(c.success_read_shows_written_review,true,'successful GET could not read cached review');
 assert.equal(c.success_summary,'Black won the game.');
 assert.equal(c.provider_total_posts,4,'unexpected model call count');
 assert.equal(r.localhost_provider_responses_closed,4,'possible abandoned loopback response');
 assert(Number.isFinite(r.elapsed_ms)&&r.elapsed_ms>0&&r.elapsed_ms<10000,
  'bounded test timing invalid');
 return {real_aborted_post_not_cached:true,real_successful_post_cached:true,
  source_provenance_valid:true,model_requests:4,comprehensive_release_certification:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const observed=JSON.parse(readFileSync(join(results,'coach-cancellation-real-route.json'),'utf8'));
 const verified=validateCancelReport(observed);
 const unitLog=readFileSync(join(results,'coach-cancellation-upstream-unit.log'),'utf8');
 assert(/Tests\s+\d+ passed \(\d+\)/.test(unitLog),
  'existing Agent B cancellation-oriented unit test results are missing');
 const report={
  schema_version:1,at_utc:new Date().toISOString(),
  parent_checkpoint_commit:'8a8a7489c6410da9412d9de0c61234da25ad1198',
  own_qa_git_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  source_candidate_sha:coach,engine_sha256:engine,
  manifest_v2_sha256:observed.manifest_sha256,fixture_id:observed.fixture_id,
  synthetic_only:true,
  experiment:verified,
  outcome:{tested_cancellation_path_passed:true,
   broader_product_cancellation_certified:false,release_approved:false},
  source_hashes:{
   runner:sha(join(root,'scripts/review-benchmark-coach-cancellation.mjs')),
   proof:sha(join(root,'scripts/review-benchmark-coach-cancellation-proof.mjs'))
  },
  remaining_risks:[
   'One aborted synthetic request followed by one successful request; no load/parallel test',
   'Mock provider and Hono in-process SSE only; not a real reverse proxy/client-network disconnect',
   'No public-user or production SQLite data; no external model',
   'A canceled request at a different stage (final write, another model, cache invalidation) requires independent tests',
   'Stockfish 16 not shown equivalent to deployed Stockfish 17'
  ]
 };
 const path=join(qa,'certification-summary-checkpoint10.json');
 writeFileSync(path,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({output:path,...verified,full_certification:false},null,2));
}
