#!/usr/bin/env node
/**
 * Freeze the third hostile-audit checkpoint without rewriting historical
 * Batch 2 evidence. Consumes ONLY files created under ignored QA results.
 * Refuses inconsistent manifests, engine provenance, or claimed green controls.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence'), results=join(qa,'results');
const read=filename=>JSON.parse(readFileSync(join(results,filename),'utf8'));
const sha=filename=>createHash('sha256').update(readFileSync(join(root,filename))).digest('hex');
const manifestV1=sha('qa/review-excellence/manifests/manifest-v1.jsonl');
const manifestV2=sha('qa/review-excellence/manifests/manifest-v2.jsonl');
const fixtureReport=read('checkpoint-v2.json');
const fixtureHash=fixtureReport.source_fixture_manifest_sha256;
assert.equal(fixtureHash,manifestV2,'25-fixture run used mismatched manifest');
assert.deepEqual(fixtureReport.metrics,{checks_passed:25,failed_checks:0,game_plies:147});
const names=['main','engine','coach','product','v10'];
const apps=Object.fromEntries(names.map(name=>[name,read('checkpoint3-'+name+'.json')]));
const main=apps.main;
const requiredSha='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
for(const [name,r] of Object.entries(apps)){
 assert.equal(r.manifest_sha256,manifestV2,'candidate manifest mismatch '+name);
 assert.equal(r.reference_engine.protocol_client,'benchmark_owned_independent_uci','reference coupled to application '+name);
 assert.equal(r.reference_engine.sha256,requiredSha,'reference engine identity drift '+name);
 assert.equal(r.engine.sha256,requiredSha,'application engine identity drift '+name);
 assert.equal(r.engine.requested_depth,8,'candidate depth mismatch '+name);
 assert.deepEqual(r.dataset,main.dataset,'candidate dataset mismatch '+name);
 assert.equal(r.summary.negative_total,r.summary.negative_rejections,'mutant not rejected '+name);
 assert.equal(r.summary.unverified_controls,0,'mutant was not run '+name);
}
const requiredErrors=['rating_without_eligible_moves_black','performance_without_eligible_moves_black'];
for(const name of ['main','coach','product','v10']){
 for(const reason of requiredErrors)assert(apps[name].failures.some(x=>x.reason===reason),name+' missing known baseline failure '+reason);
}
assert.equal(apps.engine.summary.errors,0,'Agent A still fails independent zero-evidence gate');
const sourceForced=apps.engine.fixtures.find(f=>f.fixture==='SYN-GAME-FORCED-REPLY');
assert(sourceForced && sourceForced.estimated_elo_black==null && sourceForced.performance_black==null,'Agent A no-evidence output not null');
const malicious=read('fault-engine-summary.json');
assert.equal(malicious.reference_sha256,requiredSha);
assert.equal(malicious.controls,4);
assert.equal(malicious.rejected,4);
assert(malicious.results.every(x=>x.verified===true));
assert(malicious.results.some(x=>x.mode==='illegal-continuation'&&x.application_dto_passed&&x.observed.includes('illegal_raw_uci_pv')),'missing proof that sanitized DTO hid broken raw PV');
const raw=read('uci-proxy-raw-audit-v2.json');
assert.equal(raw.failures.length,0);
assert(raw.summary.search_commands>=6 && raw.summary.bestmove>=6 && raw.summary.pv_lines>=100);
assert.equal(raw.summary.legal_pv_lines,raw.summary.pv_lines,'positive raw transcript contained illegal PV');
const transcriptNegative=execFileSync(process.execPath,['scripts/review-benchmark-uci-trace-negative-controls.mjs'],{cwd:root,encoding:'utf8'});
assert(transcriptNegative.includes('"corruptions_rejected":8'),'raw transcript negative tests not run');
const report={
 schema_version:3,
 timestamp_utc:new Date().toISOString(),
 author:'Agent D benchmark QA; no live service or user game data',
 own_branch:'agent/review-benchmark-20261111',
 base_benchmark_commit:'4f2b2756e1026cc369681816d6e7f19bc7344b9d',
 manifests:{v1_sha256:manifestV1,v2_sha256:manifestV2,fixtures:25,plies:147,holdout_count:0,provenance:'self-authored synthetic'},
 engine:{binary_name:main.reference_engine.name,sha256:requiredSha,version_does_not_equate_to_deployed_stockfish17:true,
  threads:1,hash_mib:16,requested_depth:8,reference_protocol_client:'benchmark_owned_independent_uci'},
 tool_hashes:Object.fromEntries(['scripts/review-benchmark-app-adapter.mjs','scripts/review-benchmark-real-app.mjs','scripts/review-benchmark-reference-uci.mjs','scripts/review-benchmark-engine-fault-controls.mjs','scripts/review-benchmark-uci-proxy.mjs','scripts/review-benchmark-uci-trace.mjs'].map(f=>[f,sha(f)])),
 candidate_verdicts:Object.fromEntries(names.map(name=>{
  const r=apps[name];
  const f=r.fixtures.find(x=>x.fixture==='SYN-GAME-FORCED-REPLY');
  return [name,{sha:r.repo_sha,scoring_version:r.scoring_version,games:r.summary.games,plies:r.summary.plies,
   actual_failures:r.failures,negative_rejections:r.summary.negative_rejections,
   negative_total:r.summary.negative_total,
   forced_only_estimated_elo_black:f?.estimated_elo_black,
   forced_only_performance_black:f?.performance_black,
   elapsed_ms:r.perf.elapsed_ms}];
 })),
 fake_engine_controls:{total:malicious.controls,rejected:malicious.rejected,
  hidden_illegal_continuation_dto_passed:true,
  results:malicious.results.map(({mode,expected,application_dto_passed,verified})=>({mode,expected,application_dto_passed,verified}))},
 raw_uci_positive:{...raw.summary,failures:raw.failures.length},
 raw_uci_negative:{one_good_accepted:true,malicious_mutations_rejected:8},
 integration_approval:false,
 open_gates:['No sealed holdout or adjudicated accuracy labels','No actual AI natural-language teaching truth evaluation',
  'UI browser accessibility and retry end-to-end not certified','No integrated HTTP/auth/concurrency proof',
  'Stockfish 16 reference is not Stockfish 17 equivalence','Raw UCI tee must be included for upstream legality certification']
};
const out=join(qa,'certification-summary-checkpoint3.json');
writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({path:out,engine:report.engine,manifest:report.manifests,candidate_errors:Object.fromEntries(names.map(n=>[n,report.candidate_verdicts[n].actual_failures.length])),raw:report.raw_uci_positive,mutants:report.fake_engine_controls.total},null,2));
