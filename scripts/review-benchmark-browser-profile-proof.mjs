#!/usr/bin/env node
/** Independent verification of a real Chrome + 2-authenticated-session
 * language/audience cache race. A verified BUG is NOT a product pass. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Chess} from 'chess.js';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const product='d72eaced6972c8a2ec7d8581365c45788b15a29a';
const backend='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const engine='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const manifest='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
const idFormat=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash=f=>createHash('sha256').update(readFileSync(f)).digest('hex');
const en='Black won the game.',es='Las negras ganaron la partida.';

export function verifyBrowserProfileRace(p,kind){
 assert(['clean','fault'].includes(kind),'explicit expected evidence class required');
 assert.equal(p.schema_version,1);
 assert(idFormat.test(p.run_id||''),'browser run UUID missing');
 assert.equal(p.product_sha,product);assert.equal(p.backend_sha,backend);
 assert.equal(p.engine_sha256,engine);assert.equal(p.manifest_sha256,manifest);
 assert.equal(hash(join(qa,'manifests/manifest-v2.jsonl')),manifest);
 assert.equal(p.fixture_id,'SYN-GAME-FOOLS-MATE');
 assert.equal(p.synthetic_only,true);assert.equal(p.disposable_sqlite_only,true);
 assert.equal(p.simulated_second_session,true);
 assert.equal(p.live_authenticated_settings_route,true);
 assert.equal(p.product_gate_passed,false);
 assert.equal(p.product_fully_certified,false);
 assert.equal(p.release_approved,false);
 assert.equal(p.verified_defect_expected,kind==='clean');
 assert.equal(p.test_only_fault,kind==='fault'?'serve-stale-cache':null);
 assert.equal(p.qa_status,kind==='fault'?'fail':'pass');
 if(kind==='clean')assert.equal(p.qa_error,null);
 else assert.match(p.qa_error||'',/stale_profile_cache_served_over_real_HTTP/,
  'negative run failed for an unrelated reason');
 assert(Number.isFinite(p.elapsed_ms)&&p.elapsed_ms>0&&p.elapsed_ms<30000);
 const fixture=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8')
  .trim().split('\n').map(JSON.parse).find(x=>x.fixture_id===p.fixture_id);
 assert(fixture?.source_kind==='synthetic'&&fixture.license==='self-authored');
 const pg=join(qa,'fixtures',fixture.pgn_file);
 assert.equal(hash(pg),fixture.pgn_sha256);
 const game=new Chess();game.loadPgn(readFileSync(pg,'utf8'),{strict:true});
 assert(game.isCheckmate()&&game.turn()==='w'&&game.header().Result==='0-1');

 const s=p.scenarios;
 assert.equal(s.distinct_signed_sessions,true);
 assert.equal(s.signed_session_count,2);
 const ctrl=s.unchanged;
 assert(ctrl,'missing no-op authenticated profile-PATCH positive control');
 assert.equal(ctrl.settings_status,200);
 assert.deepEqual(ctrl.settings_profile,{language:'en',audience:'beginner'});
 assert.equal(ctrl.cache_language,'en');assert.equal(ctrl.cache_audience,'beginner');
 assert.equal(ctrl.cached_summary,en);
 assert.equal(ctrl.get_status,200);
 assert.equal(ctrl.get_summary,en);
 assert.equal(ctrl.get_stale,false);
 assert.equal(ctrl.browser_renders_summary,true);

 const changed=s.changed;
 assert(changed,'missing real HTTP profile-change race');
 assert.deepEqual(changed.source_profile_at_start,{language:'en',audience:'beginner'});
 assert.equal(changed.settings_status,200);
 assert.deepEqual(changed.new_profile,{language:'es',audience:'advanced'});
 assert.equal(changed.browser_path,'/review/2');
 assert.equal(changed.cached_summary,en);
 assert.equal(changed.cached_language,'en');
 assert.equal(changed.cached_audience,'beginner');
 assert.equal(changed.browser_renders_old_summary,true);
 assert.equal(changed.fresh_get_status,200);
 assert.equal(changed.auto_review_queue_pending,0,
  'the stale cached report unexpectedly remained in the auto-regeneration queue');

 if(kind==='fault'){
  assert.equal(changed.fresh_get_stale,false);
  assert.equal(changed.stale_get_review?.summary,en,
   'test-only HTTP bad cache was not actually returned');
  assert.equal(changed.stale_get_review?.language,'en');
  assert.equal(changed.stale_get_review?.audience,'beginner');
  assert.equal(s.bad_http_cache_get_injected,1);
  assert.equal(s.recovery,undefined,
   'broken HTTP test unexpectedly continued into successful recovery');
  assert.equal(s.debug?.provider_calls?.length,6,
   'real model work for both initial requests was not observed');
  assert.deepEqual(s.debug.provider_calls.map(x=>x.stage),
   ['phase','moment','summary','phase','moment','summary']);
  return {real_http_bad_stale_response_detected:true,
   expected_test_failure:true,release_approved:false};
 }
 assert.equal(changed.stale_get_review,null);
 assert.equal(changed.fresh_get_stale,true,
  'the real GET did not recognize the cached wrong-profile report');
 assert.equal(s.bad_http_cache_get_injected,undefined);
 assert.equal(s.after_reload_old_summary_visible,false,
  'a profile refresh still displayed stale cached English content');
 const recovered=s.recovery;
 assert(recovered,'manual recovery test never ran');
 assert.equal(recovered.model_language,'es');
 assert.equal(recovered.model_audience,'advanced');
 assert.equal(recovered.cached_summary,es);
 assert.equal(recovered.cache_language,'es');
 assert.equal(recovered.cache_audience,'advanced');
 assert.equal(recovered.recovered_get_status,200);
 assert.equal(recovered.recovered_get_summary,es);
 assert.equal(recovered.recovered_get_stale,false);
 assert.equal(recovered.browser_renders_spanish,true);
 assert.equal(recovered.spanish_navigation_visible,true,
  'Spanish content did not actually render in the React app');
 assert.equal(recovered.document_declared_language,'en',
  'document root language mismatch was not reproduced; recheck the frontend');
 assert.equal(s.after_reload_document_language,'en');
 assert.deepEqual(s.browser_exceptions,[]);
 assert.deepEqual(s.model_errors,[]);
 assert.equal(s.model_requests.length,9);
 assert.deepEqual(s.model_requests.map(x=>x.stage),[
  'phase','moment','summary','phase','moment','summary','phase','moment','summary']);
 assert.deepEqual(s.model_requests.map(x=>x.lang),[
  'en','en','en','en','en','en','es','es','es']);
 assert.deepEqual(s.model_requests.map(x=>x.audience),[
  'beginner','beginner','beginner','beginner','beginner','beginner',
  'advanced','advanced','advanced']);
 assert.equal(new Set(s.model_closed).size,9);
 assert.deepEqual(s.model_closed.slice().sort((a,b)=>a-b),[1,2,3,4,5,6,7,8,9]);
 assert.equal(s.model_responses.length,9);
 assert.deepEqual(s.model_responses.map(x=>x.id),[1,2,3,4,5,6,7,8,9]);
 assert.deepEqual(s.model_responses.map(x=>x.stage),[
  'phase','moment','summary','phase','moment','summary','phase','moment','summary']);
 assert.deepEqual(s.model_responses.map(x=>x.lang),[
  'en','en','en','en','en','en','es','es','es']);
 assert.equal(s.model_responses[2].summary,en);
 assert.equal(s.model_responses[5].summary,en);
 assert.equal(s.model_responses[8].summary,es);
 assert.deepEqual(s.browser_post_requests.map(x=>x.url),[
  '/api/games/1/review','/api/games/2/review','/api/games/2/review']);
 assert.equal(new Set(s.browser_post_requests.map(x=>x.id)).size,3);
 assert.match(s.chrome_version,/^Google Chrome 157\.0\.\d+\.\d+$/);
 return {real_browser_stale_report_reproduced:true,
  two_signed_sessions_used:true,
  authenticated_patch_proven:true,
  stale_get_recognizes_profile_mismatch:true,
  auto_review_queue_misses_stale_cache:true,
  manual_spanish_advanced_recovery_proven:true,
  spanish_UI_declares_english_root_language:true,
  model_calls_closed:9,
  product_gate_passed:false,release_approved:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const positive=JSON.parse(readFileSync(join(qa,'results/review-browser-profile-race.json'),'utf8'));
 const negative=JSON.parse(readFileSync(join(qa,'results/review-browser-profile-race-fault.json'),'utf8'));
 const observed={positive:verifyBrowserProfileRace(positive,'clean'),
  negative:verifyBrowserProfileRace(negative,'fault')};
 assert.notEqual(positive.run_id,negative.run_id);
 const report={schema_version:1,at_utc:new Date().toISOString(),
  prior_checkpoint_commit:'702bc4469e99b865990d576984a03464fcedb977',
  own_branch:'agent/review-benchmark-20261111',
  qa_checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  product_sha:product,backend_sha:backend,engine_sha256:engine,
  manifest_sha256:manifest,fixture_id:positive.fixture_id,
  chrome_version:positive.scenarios.chrome_version,
  positive_run_id:positive.run_id,negative_run_id:negative.run_id,
  expected_exits:{positive:0,negative:1},
  observed,
  source_hashes:{browser_driver:hash(join(root,'scripts/review-benchmark-cdp.mjs')),
   runner:hash(join(root,'scripts/review-benchmark-browser-profile-race.mjs')),
   proof:hash(join(root,'scripts/review-benchmark-browser-profile-proof.mjs'))},
  raw_evidence_uncommitted:true,profile_fault_only_in_disposable_QA_host:true,
  release_approved:false,integration_approved:false,
  limitations:['One synthetic account with two signed sessions and one legal four-ply PGN',
   'Real Chrome React app with Vite development proxy and authentic Hono settings/review endpoints',
   'Second session changes language/audience using authenticated PATCH rather than clicking Settings UI',
   'LLM is local fake, no production browser/account/network/deployed model',
   'The stale report and root-language mismatch are reproducible in this pinned source, not release claims',
   'No sealed gold holdout, representative performance or full accessibility assessment']};
 const destination=join(qa,'certification-summary-checkpoint23.json');
 writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({destination,observed,release_approved:false},null,2));
}
