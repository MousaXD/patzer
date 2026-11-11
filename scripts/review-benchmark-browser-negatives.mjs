#!/usr/bin/env node
/** Test-only falsifications must not turn a broken browser abort into green. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyBrowserCancellation} from './review-benchmark-browser-proof.mjs';

const actual=JSON.parse(readFileSync('qa/review-excellence/results/review-browser-abort.json','utf8'));
assert.equal(verifyBrowserCancellation(actual).real_browser_abort_fault_reached_cache,true);
const mutants=[
 ['wrong product source',x=>x.candidate_product_sha='f'.repeat(40)],
 ['wrong backend source',x=>x.candidate_backend_sha='f'.repeat(40)],
 ['wrong Stockfish executable',x=>x.stockfish_sha256='f'.repeat(64)],
 ['wrong synthetic manifest',x=>x.manifest_sha256='f'.repeat(64)],
 ['wrong fixture id',x=>x.fixture_id='SYN-GAME-NONEXISTENT'],
 ['stale uncorrelated browser run',x=>x.benchmark_run_id='invalid'],
 ['hidden QA sabotage switch',x=>x.test_only_browser_fault='disable-navigation-abort'],
 ['fabricated old Chrome',x=>x.chrome='Chromium QA mock 0'],
 ['fake product release approval',x=>x.product_release_approved=true],
 ['fake full security certification',x=>x.full_browser_security_certified=true],
 ['pretend no browser was used',x=>x.real_browser_test_executed=false],
 ['private game data falsely included',x=>x.disposable_user_data_only=false],
 ['QA reported failure hidden',x=>x.qa_verdict='fail'],
 ['QA error hidden',x=>x.qa_error='render crash'],
 ['one real test missing',x=>x.observations.scenarios.pop()],
 ['wrong scenario order',x=>x.observations.scenarios.reverse()],
 ['navigation failed to abort model',x=>x.observations.scenarios[0].provider_closed_before_release=false],
 ['navigation delivered a stale model answer',x=>x.observations.scenarios[0].provider_response_sent_after_navigation=true],
 ['navigation still cached bad data',x=>x.observations.scenarios[0].cached_after_release=true],
 ['navigation never happened',x=>x.observations.scenarios[0].browser_path='/review/1'],
 ['normal navigation secretly fault-injected',x=>x.observations.scenarios[0].test_only_unexpected_abort_bypass_count=1],
 ['manual cancel did not abort model',x=>x.observations.scenarios[1].provider_closed_before_release=false],
 ['manual cancel still cached wrong data',x=>x.observations.scenarios[1].cached_after_release=true],
 ['manual cancel not reported by UI',x=>x.observations.scenarios[1].cancellation_alert_visible=false],
 ['manual cancel left review page',x=>x.observations.scenarios[1].browser_path='/review'],
 ['logout did not abort model',x=>x.observations.scenarios[2].provider_closed_before_release=false],
 ['logout cached after unmount',x=>x.observations.scenarios[2].cached_after_release=true],
 ['logout did not redirect',x=>x.observations.scenarios[2].browser_path='/review/2'],
 ['logout left session active',x=>x.observations.scenarios[2].session_rows_after_logout=1],
 ['browser fault never hit fetch',x=>x.observations.scenarios[3].test_only_abort_bypass_count=0],
 ['browser fault provider request was canceled',x=>x.observations.scenarios[3].provider_closed_before_release=true],
 ['browser fault still not sent',x=>x.observations.scenarios[3].provider_response_sent_after_navigation=false],
 ['browser fault never cached',x=>x.observations.scenarios[3].cached_after_release=false],
 ['wrong CDP report request',x=>x.observations.network_review_requests.find(p=>p.method==='POST').url='/api/games/99/review'],
 ['reused Chrome network request ID',x=>{
  const posts=x.observations.network_review_requests.filter(r=>r.method==='POST');posts[1].requestId=posts[0].requestId;
 }],
 ['cancelled Chrome network frames omitted',x=>x.observations.network_report_failures=[]],
 ['browser React uncaught exception hidden',x=>x.observations.browser_exceptions=['Uncaught TypeError']],
 ['model response error hidden',x=>x.observations.model_errors=['mock provider disconnected']],
 ['lost model request',x=>x.observations.model_posts.pop()],
 ['changed model stage',x=>x.observations.model_posts[2].stage='moment'],
 ['model response not closed',x=>x.observations.model_closed.pop()],
 ['unreasonable timing reported',x=>x.elapsed_ms=0],
];
for(const [name,mutate] of mutants){
 const bad=structuredClone(actual);mutate(bad);
 assert.throws(()=>verifyBrowserCancellation(bad),undefined,name+' escaped');
 console.log('REJECTED',name);
}
console.log(JSON.stringify({valid_real_chrome_packet_accepted:true,
 forged_browser_packets_rejected:mutants.length}));
