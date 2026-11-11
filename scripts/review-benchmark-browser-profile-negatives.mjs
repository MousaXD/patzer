#!/usr/bin/env node
/** Negative evidence controls for the *real Chrome* cross-session profile race.
 * Every corruption must be rejected without touching actual candidate code.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyBrowserProfileRace} from './review-benchmark-browser-profile-proof.mjs';
const clean=JSON.parse(readFileSync('qa/review-excellence/results/review-browser-profile-race.json','utf8'));
const fault=JSON.parse(readFileSync('qa/review-excellence/results/review-browser-profile-race-fault.json','utf8'));
assert.equal(verifyBrowserProfileRace(clean,'clean').real_browser_stale_report_reproduced,true);
assert.equal(verifyBrowserProfileRace(fault,'fault').real_http_bad_stale_response_detected,true);

const common=[
 ['candidate frontend changed',p=>p.product_sha='f'.repeat(40)],
 ['candidate backend changed',p=>p.backend_sha='f'.repeat(40)],
 ['engine pin changed',p=>p.engine_sha256='f'.repeat(64)],
 ['synthetic manifest changed',p=>p.manifest_sha256='f'.repeat(64)],
 ['different licensed fixture',p=>p.fixture_id='SYN-OTHER'],
 ['missing cryptographic run id',p=>p.run_id='old'],
 ['fake user privacy state',p=>p.synthetic_only=false],
 ['fake production database usage',p=>p.disposable_sqlite_only=false],
 ['fabricated release approval',p=>p.release_approved=true],
 ['fabricated product certification',p=>p.product_fully_certified=true],
 ['fabricated product gate pass',p=>p.product_gate_passed=true],
 ['not truly two signed sessions',p=>p.scenarios.distinct_signed_sessions=false],
 ['only one signed session',p=>p.scenarios.signed_session_count=1],
 ['unverified authenticated Settings route',p=>p.live_authenticated_settings_route=false],
 ['unchanged profile update failed',p=>p.scenarios.unchanged.settings_status=401],
 ['unchanged profile metadata wrong',p=>p.scenarios.unchanged.settings_profile.language='es'],
 ['unchanged cache wrong language',p=>p.scenarios.unchanged.cache_language='es'],
 ['unchanged cache wrong audience',p=>p.scenarios.unchanged.cache_audience='advanced'],
 ['unchanged review never cached',p=>p.scenarios.unchanged.cached_summary=null],
 ['unchanged real GET failed',p=>p.scenarios.unchanged.get_status=404],
 ['unchanged GET wrong summary',p=>p.scenarios.unchanged.get_summary='White won the game.'],
 ['unchanged report wrongly called stale',p=>p.scenarios.unchanged.get_stale=true],
 ['unchanged browser failed to display',p=>p.scenarios.unchanged.browser_renders_summary=false],
 ['original profile at admission corrupted',p=>p.scenarios.changed.source_profile_at_start.language='es'],
 ['second session profile update failed',p=>p.scenarios.changed.settings_status=500],
 ['second session actual profile not Spanish',p=>p.scenarios.changed.new_profile.language='en'],
 ['second session audience not advanced',p=>p.scenarios.changed.new_profile.audience='beginner'],
 ['changed browser never on review',p=>p.scenarios.changed.browser_path='/login'],
 ['changed old summary wrong',p=>p.scenarios.changed.cached_summary='White won.'],
 ['changed cached language incorrect',p=>p.scenarios.changed.cached_language='es'],
 ['changed cached audience incorrect',p=>p.scenarios.changed.cached_audience='advanced'],
 ['old report hidden from original browser',p=>p.scenarios.changed.browser_renders_old_summary=false],
 ['fresh GET failed',p=>p.scenarios.changed.fresh_get_status=401],
 ['automatic queue unexpectedly pending',p=>p.scenarios.changed.auto_review_queue_pending=1],
 ['unreasonable test elapsed',p=>p.elapsed_ms=0],
];
const cleanOnly=[
 ['successful run flag changed',p=>p.qa_status='fail'],
 ['clean test marked an injected fault',p=>p.test_only_fault='serve-stale-cache'],
 ['clean error hidden',p=>p.qa_error='failed'],
 ['wrong expected defect class',p=>p.verified_defect_expected=false],
 ['stale GET reported non-null prose',p=>p.scenarios.changed.stale_get_review={summary:'Black won the game.'}],
 ['fresh GET accepted stale report',p=>p.scenarios.changed.fresh_get_stale=false],
 ['test-only bad route actually ran',p=>p.scenarios.bad_http_cache_get_injected=1],
 ['old English cache remained after reload',p=>p.scenarios.after_reload_old_summary_visible=true],
 ['manual recovery never happened',p=>delete p.scenarios.recovery],
 ['recovery model wrong language',p=>p.scenarios.recovery.model_language='en'],
 ['recovery model wrong audience',p=>p.scenarios.recovery.model_audience='beginner'],
 ['recovery cache old summary',p=>p.scenarios.recovery.cached_summary='Black won the game.'],
 ['recovery cache wrong language',p=>p.scenarios.recovery.cache_language='en'],
 ['recovery cache wrong audience',p=>p.scenarios.recovery.cache_audience='beginner'],
 ['recovery GET failed',p=>p.scenarios.recovery.recovered_get_status=500],
 ['recovery GET wrong summary',p=>p.scenarios.recovery.recovered_get_summary='Black won the game.'],
 ['recovery still stale',p=>p.scenarios.recovery.recovered_get_stale=true],
 ['recovery not shown in browser',p=>p.scenarios.recovery.browser_renders_spanish=false],
 ['Spanish interface not actually shown',p=>p.scenarios.recovery.spanish_navigation_visible=false],
 ['root language correctly marked Spanish',p=>p.scenarios.recovery.document_declared_language='es'],
 ['root language on reload changed',p=>p.scenarios.after_reload_document_language='es'],
 ['browser exception concealed',p=>p.scenarios.browser_exceptions=['React crash']],
 ['mock provider error concealed',p=>p.scenarios.model_errors=['model failed']],
 ['missing model request',p=>p.scenarios.model_requests.pop()],
 ['model stage was misclassified',p=>p.scenarios.model_requests[8].stage='phase'],
 ['model language wrong',p=>p.scenarios.model_requests[8].lang='en'],
 ['model audience wrong',p=>p.scenarios.model_requests[8].audience='beginner'],
 ['model never closed',p=>p.scenarios.model_closed.pop()],
 ['model response missing',p=>p.scenarios.model_responses.pop()],
 ['model response wrong summary',p=>p.scenarios.model_responses[8].summary='Black won the game.'],
 ['missing real Chrome HTTP POST',p=>p.scenarios.browser_post_requests.pop()],
 ['reused browser request id',p=>p.scenarios.browser_post_requests[2].id=p.scenarios.browser_post_requests[1].id],
 ['mock Chrome browser version',p=>p.scenarios.chrome_version='Chrome simulator'],
];
const faultOnly=[
 ['wrong injected fault name',p=>p.test_only_fault=null],
 ['fault reports success',p=>p.qa_status='pass'],
 ['wrong negative failure reason',p=>p.qa_error='unrelated browser timeout'],
 ['fault claims release-ready behavior',p=>p.verified_defect_expected=true],
 ['bad HTTP response did not contain stale report',p=>p.scenarios.changed.stale_get_review=null],
 ['bad HTTP cache response wrong language',p=>p.scenarios.changed.stale_get_review.language='es'],
 ['fault did not issue wrong cache',p=>p.scenarios.bad_http_cache_get_injected=0],
 ['bad response nevertheless marked stale',p=>p.scenarios.changed.fresh_get_stale=true],
 ['faulty run claims manual recovery',p=>p.scenarios.recovery={cached_summary:'fake'}],
 ['truncated model history',p=>p.scenarios.debug.provider_calls.pop()],
 ['changed model history',p=>p.scenarios.debug.provider_calls[5].stage='moment'],
];

let rejected=0;
for(const [kind,original,controls] of [
 ['clean',clean,[...common,...cleanOnly]],
 ['fault',fault,[...common,...faultOnly]],
]){
 for(const [name,mutate] of controls){
  const bad=structuredClone(original);mutate(bad);
  assert.throws(()=>verifyBrowserProfileRace(bad,kind),undefined,
   kind+': '+name+' escaped the independent QA guard');
  rejected++;
 }
}
console.log(JSON.stringify({genuine_browser_race_proven:true,
 genuinely_bad_HTTP_response_detected:true,
 forged_evidence_rejected:rejected}));
