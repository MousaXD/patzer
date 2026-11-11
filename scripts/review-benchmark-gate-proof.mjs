#!/usr/bin/env node
// Read ignored checkpoint-4 gate results and refuse a false-green QA report.
// This compiler never invokes an engine, database, or network service.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence'), results=join(qa,'results');
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const names=['none','drop-trace','corrupt-raw-pv','extra-legal-search','force-analysis-timeout','main','concurrent-A','concurrent-B'];
const tests=Object.fromEntries(names.map(n=>[n,JSON.parse(readFileSync(join(results,'gated5-'+n+'.log'),'utf8'))]));
const pin='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const candidate='7178e2624fb9a9a35bd84bc2dcb796a46e0f1c1e';
const baseline='51df1d852296e5f0644127a81b5ec31109c8e6c1';
const manifestHash=sha(join(qa,'manifests/manifest-v2.jsonl'));
const has=(n,reason)=>assert(tests[n].failures.some(x=>x.reason===reason),n+' missing '+reason);
for(const [name,r] of Object.entries(tests)){
 assert.equal(r.manifest_sha256,manifestHash,'manifest mismatch '+name);
 assert.equal(r.pinned_engine_sha256,pin,'engine mismatch '+name);
 assert.equal(r.requested_candidate_sha,name==='main'?baseline:candidate,'requested candidate mismatch '+name);
 if(name==='force-analysis-timeout')assert.equal(r.candidate_sha,null,'timeout expected no completed candidate evidence');
 else assert.equal(r.candidate_sha,name==='main'?baseline:candidate,'candidate evidence mismatch '+name);
 assert.equal(r.reference_kind,'benchmark-owned UCI protocol client with separate process');
 assert.equal(r.expected_analysis_searches,6);
 assert.equal(r.release_approved,false);
 assert.deepEqual([...r.tested_fixtures].sort(),['SYN-GAME-BLACK-FIRST','SYN-GAME-FORCED-REPLY'].sort());
}
for(const name of ['none','concurrent-A','concurrent-B']){
 const r=tests[name];
 assert.equal(r.scope_passed,true,name+' unexpectedly failed');
 assert.equal(r.application.errors,0);
 assert(r.application.negative_controls>=11);
 assert.equal(r.application.negative_controls,r.application.rejected_controls);
 assert.equal(r.raw_uci.errors,0);
 assert(r.raw_uci.metrics.pv_lines>=100);
 assert.equal(r.raw_uci.metrics.pv_lines,r.raw_uci.metrics.legal_pv_lines);
 assert.equal(r.raw_uci.metrics.bestmove,6);
 assert.equal(r.observed_analysis_searches,6);
}
assert.notEqual(tests['concurrent-A'].report,tests['concurrent-B'].report,'parallel runs reused a trace directory');
for(const name of ['drop-trace','corrupt-raw-pv','extra-legal-search','force-analysis-timeout','main']){
 assert.equal(tests[name].scope_passed,false,name+' unexpectedly green');
}
has('drop-trace','raw_uci_evidence_failed');
has('corrupt-raw-pv','raw_uci_evidence_failed');
assert(tests['corrupt-raw-pv'].raw_uci.errors>=1);
has('extra-legal-search','raw_uci_fixture_positions_mismatch');
assert.equal(tests['extra-legal-search'].observed_analysis_searches,7);
assert.equal(tests['extra-legal-search'].raw_uci.errors,0,'test must evade raw legality alone');
has('force-analysis-timeout','actual_application_output_failed');
assert.equal(tests['force-analysis-timeout'].application.timed_out,true);
has('main','actual_application_output_failed');
assert.equal(tests['main'].application.errors,2);
assert.equal(tests['main'].raw_uci.errors,0);
const mainPath=tests.main.report.replace(/gate-result\.json$/,'app-result.json');
const mainReport=JSON.parse(readFileSync(mainPath,'utf8'));
assert.deepEqual(mainReport.failures.map(x=>x.reason).sort(),[
 'performance_without_eligible_moves_black','rating_without_eligible_moves_black'].sort());

const report={schema_version:1,at_utc:new Date().toISOString(),
 base_benchmark_commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 gate_source_sha256:sha(join(root,'scripts/review-benchmark-gated-smoke.mjs')),
 manifest_sha256:manifestHash,fixtures:2,source_license:'self-authored',holdout_cases:0,
 engine_binary_sha256:pin,engine:'Stockfish 16',depth:8,threads:1,hash_mib:16,multipv:3,
 baseline_sha:baseline,candidate_sha:candidate,positive_runs:3,broken_controls_detected:4,
 known_baseline_failures:2,parallel_isolation_verified:true,
 evidence:Object.fromEntries(Object.entries(tests).map(([name,r])=>[name,{
  scope_passed:r.scope_passed,application_errors:r.application.errors,raw_errors:r.raw_uci.errors,
  expected_searches:r.expected_analysis_searches,observed_searches:r.observed_analysis_searches,
  test_only_corruption:r.test_only_corruption,failures:r.failures.map(x=>x.reason)
 }])),
 integration_approved:false,release_approved:false,
 remaining_gates:['No independent sealed holdout','No natural-language coaching claim validation',
  'No actual browser accessibility/usability study','No HTTP auth/isolation or multi-user load certification',
  'Stockfish 16 does not establish Stockfish 17 parity']};
const out=join(qa,'certification-summary-checkpoint4.json');
writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({written:out,candidate:report.candidate_sha,baseline:report.baseline_sha,
 positive_runs:report.positive_runs,broken_controls_detected:report.broken_controls_detected,
 known_baseline_failures:report.known_baseline_failures,source_sha256:report.gate_source_sha256},null,2));
