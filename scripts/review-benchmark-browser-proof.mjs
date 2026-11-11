#!/usr/bin/env node
/**
 * Independent auditor for Agent D's actual Chrome Game Report cancellation
 * experiment. Checks browser network proof and persistent cache outcomes,
 * rather than trusting an optimistic QA verdict or disappearing UI panel.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {Chess} from 'chess.js';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const backend='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const product='d72eaced6972c8a2ec7d8581365c45788b15a29a';
const engine='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const manifestHash='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
const source='actual React GameAnalyzer + Layout/GameReportPanel in isolated Chrome, real Hono routes, Vite proxy, fake local LLM';
const runIdFormat=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const stageSeq=['phase','moment','summary','phase','moment','summary',
 'phase','moment','summary','phase','moment','summary'];

export function verifyBrowserCancellation(packet){
 assert.equal(packet.schema_version,1);
 assert.equal(packet.candidate_backend_sha,backend,'backend changed');
 assert.equal(packet.candidate_product_sha,product,'actual React product commit changed');
 assert.equal(packet.manifest_sha256,manifestHash,'fixture manifest changed');
 assert.equal(hash(join(qa,'manifests/manifest-v2.jsonl')),manifestHash);
 assert.equal(packet.stockfish_sha256,engine,'Stockfish executable changed');
 assert.equal(packet.fixture_id,'SYN-GAME-FOOLS-MATE');
 assert(runIdFormat.test(packet.benchmark_run_id||''),'missing freshly correlated browser run ID');
 assert.equal(packet.test_only_browser_fault,null,
  'a QA test-only sabotage run cannot be certified clean');
 assert.match(packet.chrome,/^Google Chrome 157\.0\.[0-9]+\.[0-9]+$/);
 assert.equal(packet.source,source,'not the stated real React/Hono/CDP experiment');
 assert.equal(packet.real_browser_test_executed,true);
 assert.equal(packet.disposable_user_data_only,true);
 assert.equal(packet.qa_verdict,'pass','a failed QA run must not certify a product');
 assert.equal(packet.qa_error,null);
 assert.equal(packet.product_release_approved,false);
 assert.equal(packet.full_browser_security_certified,false);

 const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8').trim()
  .split('\n').map(JSON.parse);
 const item=manifest.find(x=>x.fixture_id===packet.fixture_id);
 assert(item?.source_kind==='synthetic'&&item.license==='self-authored');
 const fixture=join(qa,'fixtures',item.pgn_file);
 assert.equal(hash(fixture),item.pgn_sha256,'fixture source PGN has changed');
 const chess=new Chess();chess.loadPgn(readFileSync(fixture,'utf8'),{strict:true});
 assert(chess.isCheckmate()&&chess.turn()==='w'&&chess.header().Result==='0-1');

 const obs=packet.observations;
 assert.equal(obs.backend_sha,backend);
 assert.equal(obs.product_sha,product);
 assert(Number.isSafeInteger(obs.localhost_vite_port)&&obs.localhost_vite_port>0);
 assert(Number.isSafeInteger(obs.localhost_api_port)&&obs.localhost_api_port>0);
 assert.notEqual(obs.localhost_vite_port,obs.localhost_api_port,
  'real browser and real API used the same fake socket');

 assert(Array.isArray(obs.scenarios)&&obs.scenarios.length===4,
  'missing navigation/manual-cancel/logout/negative-control scenarios');
 const [navigate,cancel,logout,broken]=obs.scenarios;
 assert.equal(navigate.scenario,'real_internal_navigation');
 assert.equal(cancel.scenario,'real_cancel_generation_button');
 assert.equal(logout.scenario,'real_layout_logout');
 assert.equal(broken.scenario,'qa_only_removed_fetch_abort_signal');
 for(const scenario of [navigate,cancel,logout]){
  assert.equal(scenario.provider_closed_before_release,true,
   'real navigation/logout did not abort pending model request');
  assert.equal(scenario.provider_response_sent_after_navigation,false,
   'model provider still accepted a response after canceled UI request');
  assert.equal(scenario.cached_after_release,false,
   'the canceled request still persisted after navigation/logout');
 }
 assert.equal(navigate.browser_path,'/review');
 assert.equal(navigate.test_only_unexpected_abort_bypass_count,0,
  'normal-navigation test was intercepted by an unexpected abort bypass');
 assert.equal(cancel.browser_path,'/review/4');
 assert.equal(cancel.cancellation_alert_visible,true,
  'the real Cancel generation action did not show the canceled state');
 assert.equal(logout.browser_path,'/login');
 assert.equal(logout.session_rows_after_logout,0);

 // A test that only checks the UI switched pages is too weak: the model can
 // keep streaming and cache stale data. The negative control intentionally
 // strips ONLY the report request AbortSignal while keeping real React state.
 assert.equal(broken.test_only_abort_bypass_count,1,
  'test-only browser fault did not hit the real report POST');
 assert.equal(broken.browser_path,'/review');
 assert.equal(broken.provider_closed_before_release,false,
  'adversarial request was already canceled, corruption not demonstrated');
 assert.equal(broken.provider_response_sent_after_navigation,true,
  'adversarial model result was never delivered');
 assert.equal(broken.cached_after_release,true,
  'adversarial model result did not reach actual application cache');

 assert(Array.isArray(obs.network_review_requests));
 const networkPosts=obs.network_review_requests.filter(x=>x.method==='POST');
 assert.deepEqual(networkPosts.map(x=>x.url),[
  '/api/games/1/review','/api/games/4/review',
  '/api/games/2/review','/api/games/3/review',
 ],'CDP did not observe real Chrome review POSTs for all four games');
 assert.equal(new Set(networkPosts.map(x=>x.requestId)).size,4,
  'same network request was reused rather than four real browser cases');
 assert(obs.network_review_requests.some(x=>x.method==='GET'),
  'no real client GET review cache probes were observed');
 const canceled=obs.network_report_failures.filter(x=>x.canceled===true&&
  x.errorText==='net::ERR_ABORTED');
 assert(canceled.length>=3,
  'Chrome network log does not show navigation/cancel/logout canceled POSTs');
 assert.deepEqual(obs.browser_exceptions,[],
  'the React app threw a runtime exception during the browser test');
 assert.deepEqual(obs.model_errors,[]);
 assert.deepEqual(obs.model_posts.map(x=>x.stage),stageSeq,
  'missing genuine staged model calls');
 assert.deepEqual(obs.model_posts.map(x=>x.sequence),[1,2,3,4,5,6,7,8,9,10,11,12]);
 assert.equal(new Set(obs.model_closed).size,12,
  'a model response leaked or the provider did not close');
 assert(obs.model_closed.every(x=>Number.isSafeInteger(x)&&x>=1&&x<=12));
 assert(Number.isFinite(packet.elapsed_ms)&&packet.elapsed_ms>0&&packet.elapsed_ms<30000);
 return {
  browser_report_navigation_abort_proven:true,
  browser_explicit_cancel_button_abort_proven:true,
  browser_logout_abort_proven:true,
  no_persisted_report_after_normal_unmount:true,
  real_browser_abort_fault_reached_cache:true,
  browser_runtime_exceptions:0,
  local_mock_model_requests:12,
  product_releasable:false,
 };
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const packet=JSON.parse(readFileSync(join(qa,'results/review-browser-abort.json'),'utf8'));
 const result=verifyBrowserCancellation(packet);
 const report={schema_version:1,at_utc:new Date().toISOString(),
  previous_agent_d_commit:'7cb32dc50b860467bab361f3728c65dad91ed881',
  current_qa_checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  own_branch:'agent/review-benchmark-20261111',
  qa_run_id:packet.benchmark_run_id,
  product_sha:product,backend_sha:backend,
  chrome_version:packet.chrome,engine_sha256:engine,engine_version:'Stockfish 16',
  manifest_sha256:manifestHash,fixture_id:packet.fixture_id,
  controlled_real_browser_scenario_count:4,
  source_paths:{product:'web/src/components/GameReportPanel.tsx',
   analyzer:'web/src/pages/GameAnalyzer.tsx',layout:'web/src/components/Layout.tsx',
   backend:'server/src/routes/review.ts'},
  source_hashes:{browser_harness:hash(join(root,'scripts/review-benchmark-browser-abort.mjs')),
   chrome_cdp_driver:hash(join(root,'scripts/review-benchmark-cdp.mjs')),
   evidence_verifier:hash(join(root,'scripts/review-benchmark-browser-proof.mjs'))},
  verified_results:result,
  raw_chrome_profile_and_database_removed:true,raw_event_evidence_uncommitted:true,
  full_browser_security_certified:false,integration_approved:false,release_approved:false,
  limitations:[
   'Real Chrome 157 headless browser, but local Vite dev proxy rather than production static bundle/reverse proxy',
   'Actual React DOM click triggers are used; full pointer accessibility and screen-reader use are separate',
   'Only navigation and logout with a held local fake-LLM summary, not real hosted model provider variability',
   'Cancellation-on-unmount is observed, not a new policy for already-admitted server work after logout',
   'Synthetic four-ply game and four local game rows; no private data or sealed holdout',
  ],
 };
 const destination=join(qa,'certification-summary-checkpoint20.json');
 writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:destination,...result,release_approved:false},null,2));
}
