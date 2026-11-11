#!/usr/bin/env node
// Independent compiler for a real React GameReportPanel consumer challenge.
// The Spanish test locale is mocked; there is no authenticated live browser.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence');
const product=join(qa,'results/worktree-product-latest');
const logFile=join(qa,'results/client-stale-profile-ui.log');
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const candidate='ee4b61168ce61ac615e8efa77bc5ae56698ac5cf';
const component='c3c033be05df83ef230b85542c906ae6321d88fa5169705cd00e8eaeceb49ddb';
const testcase='c9ee2d03310e5a7bd04cdab00106795c479e6db24942bab95d690fcb66a78199';
const config='b28a2b77e42b113ed02e897429d354d19aa28969b8976a091e7363214783346b';
const labels=[
 'renders a completed old-English beginner response despite Spanish UI context',
 'also renders a matching Spanish advanced response as a positive control',
 'rejects malformed done payloads rather than falsely calling them completed',
];

export function checkClientProfileEvidence(e){
 assert.equal(e.schema_version,1);
 assert.equal(e.candidate_sha,candidate,'not the frozen Agent C commit');
 assert.equal(e.component_sha256,component,'consumer source changed');
 assert.equal(e.qa_test_sha256,testcase,'adversarial test implementation changed');
 assert.equal(e.qa_config_sha256,config,'test runtime configuration changed');
 assert.equal(e.locale_mode,'controlled Spanish i18n mock, not a logged-in user profile');
 assert.equal(e.tests_passed,3);
 assert.equal(e.test_files_passed,1);
 assert.deepEqual(e.successful_cases,labels);
 assert.equal(e.stale_profile_done_accepted_by_component,true);
 assert.equal(e.fresh_profile_done_accepted,true);
 assert.equal(e.malformed_done_rejected,true);
 assert.equal(e.has_real_browser_navigation_test,false);
 assert.equal(e.has_real_authentication_test,false);
 assert.equal(e.release_approved,false);
 assert.equal(e.product_fully_certified,false);
 assert.equal(sha(join(product,'web/src/components/GameReportPanel.tsx')),component,
  'latest tested Agent C component no longer matches');
 assert.equal(sha(join(root,'scripts/review-benchmark-client-stale-profile.test.tsx')),testcase);
 assert.equal(sha(join(qa,'vitest.qa.config.mts')),config);
 const log=readFileSync(logFile,'utf8');
 assert(/Test Files\s+1 passed \(1\)/.test(log),'QA test file did not pass');
 assert(/Tests\s+3 passed \(3\)/.test(log),'all three independent controls must pass');
 for(const label of labels)assert(log.includes(label),'one hostile/positive test was not executed');
 assert.equal(e.raw_vitest_log_sha256,sha(logFile),'source evidence log changed');
 return {tested_real_react_component:true,wrong_profile_metadata_accepted:true,
  correct_profile_metadata_accepted:true,malformed_payload_rejected:true,
  general_browser_or_release_certified:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const worktreeSha=execFileSync('git',['-C',product,'rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 assert.equal(worktreeSha,candidate,'unexpected Agent C HEAD');
 const raw=readFileSync(logFile,'utf8');
 const observed={schema_version:1,candidate_sha:worktreeSha,component_sha256:sha(join(product,'web/src/components/GameReportPanel.tsx')),
  qa_test_sha256:sha(join(root,'scripts/review-benchmark-client-stale-profile.test.tsx')),
  qa_config_sha256:sha(join(qa,'vitest.qa.config.mts')),
  locale_mode:'controlled Spanish i18n mock, not a logged-in user profile',
  tests_passed:3,test_files_passed:1,successful_cases:labels,
  stale_profile_done_accepted_by_component:true,fresh_profile_done_accepted:true,malformed_done_rejected:true,
  has_real_browser_navigation_test:false,has_real_authentication_test:false,
  release_approved:false,product_fully_certified:false,
  raw_vitest_log_sha256:sha(logFile)};
 assert(/Tests\s+3 passed \(3\)/.test(raw));
 const checks=checkClientProfileEvidence(observed);
 const upstreamLogFile=join(qa,'results/client-product-existing-stream-tests.log');
 const upstreamLog=readFileSync(upstreamLogFile,'utf8');
 assert(/Tests\s+6 passed \(6\)/.test(upstreamLog),
  'Agent C original stream test suite must pass on pinned product SHA');
 const report={schema_version:1,at_utc:new Date().toISOString(),
  parent_checkpoint_commit:'cc33a7a0ffda977fe37edc078594e8ccf397a8c8',
  own_branch:'agent/review-benchmark-20261111',
  own_checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  candidate_product_sha:candidate,
  controlled_react_component:'web/src/components/GameReportPanel.tsx',
  source_hashes:{component,qa_test:testcase,qa_config:config},
  evidence:observed,verification:checks,
  agent_c_existing_stream_tests_passed:6,
  upstream_unit_log_sha256:sha(upstreamLogFile),
  link_to_backend_qa:'Checkpoint 12 language and Checkpoint 13 audience races demonstrate the SSE can contain stale profile metadata',
  interpretation:'component accepts a structurally valid SSE done payload without comparing its language/audience to an active profile',
  no_actual_browser_navigation:true,no_private_user_data:true,no_production_changes:true,
  integration_approved:false,release_approved:false,
  limits:['Only one mocked Spanish-locale React component, no full authenticated page/browser navigation',
   'No simulated actual profile store: GameReportPanel does not receive audience as a prop',
   'The report must not be used to assert frequency or effect of a real hosted model',
   'Backend should own source provenance; frontend could avoid displaying mismatched generation results as defense in depth']};
 const output=join(qa,'certification-summary-checkpoint14.json');
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:output,...checks,release_approved:false},null,2));
}
