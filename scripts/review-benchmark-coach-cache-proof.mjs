#!/usr/bin/env node
/**
 * Fail-closed checkpoint-7 evidence compiler. The script never touches SQLite,
 * an LLM, Stockfish or a network service. It only accepts the *real* QA-route
 * experiment logs created inside our ignored disposable results directory.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const results=join(qa,'results');
const data=JSON.parse(readFileSync(join(results,'coach-cache-real-route.json'),'utf8'));
const broken=JSON.parse(readFileSync(join(results,'coach-cache-negative-fixed.json'),'utf8'));
const errorLog=readFileSync(join(results,'cache-negative-fixed.log'),'utf8');
const currentUnitLog=readFileSync(join(results,'cache-race-unit.log'),'utf8');
const expectedCandidate='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const expectedManifest='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
const expectedEngine='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
for(const r of [data,broken]){
 assert.equal(r.source_candidate_sha,expectedCandidate);
 assert.equal(r.engine_sha256,expectedEngine);
 assert.equal(r.manifest_sha256,expectedManifest);
 assert.equal(r.fixture,'SYN-GAME-FOOLS-MATE');
 assert.equal(r.release_approved,false);
 assert.equal(r.product_cache_certified,false);
 assert.equal(r.scoped_cache_passed,false);
 assert.equal(r.attacks.real_reanalysis_stale_prose_escaped,true);
 assert.equal(r.attacks.controlled_scoring_migration_stale_prose_escaped,true);
 assert.equal(r.checks.auto_review_queue_after_reanalysis,0,
   'stale row was present in the auto-review worklist unexpectedly');
 assert.equal(r.checks.prose_retained_after_reanalysis,true);
 assert.equal(r.checks.generated_review_has_scoring_marker,false);
 assert.notEqual(r.checks.old_accuracy_white,r.checks.new_accuracy_white);
 assert.deepEqual(Object.values(r.controls),Array(Object.keys(r.controls).length).fill(true));
 assert.equal(Object.keys(r.controls).length,8);
}
assert.equal(data.expectation,'reproduce');
assert.equal(broken.expectation,'fixed');
assert(errorLog.includes('cache behavior differs from pinned expectation'),
  'negative certification control did not reject falsely safe cache');
assert(/Tests\s+22 passed \(22\)/.test(currentUnitLog),
  'Targeted Agent B cache tests were not rerun or did not pass');
const runner='scripts/review-benchmark-coach-cache-race.mjs';
const payload={
 schema_version:1,
 at_utc:new Date().toISOString(),
 parent_benchmark_commit:'d86a9f9fc4649c7c14a9de220fb5b58f59d3d238',
 benchmark_checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 branch:'agent/review-benchmark-20261111',candidate_sha:expectedCandidate,
 engine_sha256:expectedEngine,engine:'Stockfish 16',depth:8,threads:1,hash_mib:16,
 fixture:'SYN-GAME-FOOLS-MATE',manifest_sha256:expectedManifest,
 fixture_data_rights:'self-authored synthetic',sealed_holdout_used:false,
 real_code_paths:['analyzePgn','saveAnalysis','buildGameReview','saveReviewIfFresh',
   'authenticated GET /:id/review'],
 discovered_defects:[
  'real_reanalysis_retains_and_serves_old_review',
  'controlled_scoring_version_change_accepts_unmarked_old_review',
  'auto_review_skips_non_null_stale_prose'
 ],
 known_protective_controls:{
  other_user_denied:true,
  unauthenticated_denied:true,
  marked_version_mismatch_rejected:true,
  marked_version_match_accepted:true,
  changed_language_rejected:true,
  null_cache_not_served:true,
  in_flight_stale_write_rejected:true
 },
 positive_controls_verified:8,
 existing_agent_b_cache_unit_tests_passed:22,
 negative_safe_certification_rejected:true,
 historical_verdict:'real candidate contains stale cache defect; a 0 exit on the reproduce command proves the *attack*, not the product',
 benchmark_runner_sha256:sha(join(root,runner)),
 evidence:{initial_white_accuracy:data.checks.old_accuracy_white,
  reanalyzed_white_accuracy:data.checks.new_accuracy_white,
  old_cached_review_sha256:data.checks.generated_review_sha256,
  prose_version:data.checks.prose_version,
  marker_absent:!data.checks.generated_review_has_scoring_marker,
  autoreview_pending:0,
  cache_escapes:data.attacks},
 product_cache_certified:false,release_approved:false,
 integration_approved:false,
 known_gaps:[
  'Only a disposable four-ply Fool\'s Mate synthetic PGN; not a statistical workload',
  'Scoring-version-only update is a controlled test mutation, not evidence of a deployed migration',
  'Real saveAnalysis reanalysis path demonstrated with a changed accuracy field',
  'Policy-fix requires coordination with Agent B, Agent A and PR #17 scoring/backfill; do not edit their source',
  'No latency/concurrency or multi-user load SLO validation beyond authenticated ownership controls'
 ]
};
const path=join(qa,'certification-summary-checkpoint7.json');
writeFileSync(path,JSON.stringify(payload,null,2)+'\n');
console.log(JSON.stringify({created:path,qa_positive_controls:8,stale_cache_escapes:3,
  false_safe_certification_blocked:true,source_candidate_sha:expectedCandidate,
  release_approved:false},null,2));
