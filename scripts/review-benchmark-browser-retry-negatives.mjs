#!/usr/bin/env node
/** Hostile mutations of independently verified real-Chrome retry evidence. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {proveRetryEvidence} from './review-benchmark-browser-retry-proof.mjs';

const clean=JSON.parse(readFileSync('qa/review-excellence/results/review-browser-retry.json','utf8'));
const fault=JSON.parse(readFileSync('qa/review-excellence/results/review-browser-retry-fault.json','utf8'));
const late=JSON.parse(readFileSync('qa/review-excellence/results/review-browser-retry-fault-old-last.json','utf8'));
assert.equal(proveRetryEvidence(clean,'clean').valid_retry_persisted,true);
assert.equal(proveRetryEvidence(fault,'fault').injected_browser_fault_rejected_as_green,true);
assert.equal(proveRetryEvidence(late,'late-old').newer_cache_survived_late_old,true);
const mutants=[
 ['drift backend',x=>x.backend_sha='f'.repeat(40)],
 ['drift frontend',x=>x.product_sha='f'.repeat(40)],
 ['drift engine',x=>x.engine_sha256='f'.repeat(64)],
 ['drift manifest',x=>x.manifest_sha256='f'.repeat(64)],
 ['missing fixture',x=>x.fixture_id='SYN-NOT-REAL'],
 ['malformed run id',x=>x.run_id='stale'],
 ['invent full release',x=>x.release_approved=true],
 ['invent browser certification',x=>x.whole_browser_certified=true],
 ['claim real user data',x=>x.synthetic_only=false],
 ['claim live database',x=>x.disposable_sqlite_only=false],
 ['no first generation',x=>x.observation.first_generation_started=false],
 ['no retry generation',x=>x.observation.second_generation_started=false],
 ['fake model overlap',x=>x.observation.both_model_generations_observed=false],
 ['first cache not blank',x=>x.observation.cache_before_cancel='old'],
 ['cache not blank at overlap',x=>x.observation.cache_during_overlap='old'],
 ['wrong first stage sequence',x=>x.observation.first_generation_model_sequence=4],
 ['wrong second stage sequence',x=>x.observation.second_generation_model_sequence=5],
 ['missing real second browser POST',x=>x.observation.chrome_review_post_ids.pop()],
 ['reused browser request id',x=>x.observation.chrome_review_post_ids[1]=x.observation.chrome_review_post_ids[0]],
 ['wrong LLM stage',x=>x.observation.model_calls[5].stage='moment'],
 ['wrong model generation attribution',x=>x.observation.model_calls[0].generation='second'],
 ['missing provider response',x=>x.observation.model_closed.pop()],
 ['hidden provider error',x=>x.observation.model_errors.push('aborted unexpectedly')],
 ['uncaught browser exception',x=>x.observation.browser_exceptions.push('React error')],
 ['missing synthetic local port',x=>x.observation.vite_port=0],
 ['same frontend and backend port',x=>x.observation.vite_port=x.observation.api_port],
 ['wrong localized cache audience',x=>x.observation.final_cached_audience='advanced'],
 ['wrong localized cache language',x=>x.observation.final_cached_language='es'],
 ['wrong browser version',x=>x.observation.chrome_version='Chrome simulator'],
 ['falsified elapsed time',x=>x.elapsed_ms=0],
];
const onClean=[
 ['fake QA failure hidden',x=>x.qa_verdict='fail'],
 ['unexpected QA error',x=>x.qa_error='test failed'],
 ['test-only bypass secretly enabled',x=>x.fault='skip-first-abort'],
 ['cancel did not close model',x=>x.observation.first_closed_before_release=false],
 ['canceled model accepted summary',x=>x.observation.first_model_response_sent=true],
 ['canceled old report poisoned cache',x=>x.observation.cache_after_old_release='Black won the game. FIRST GENERATION.'],
 ['replacement never delivered',x=>x.observation.second_model_response_sent=false],
 ['replacement not persisted',x=>x.observation.final_cached_summary='Black won the game. FIRST GENERATION.'],
 ['stale summary rendered',x=>x.observation.ui_contains_first=true],
 ['replacement summary missing in UI',x=>x.observation.ui_contains_second=false],
 ['retry failed in UI',x=>x.observation.ui_error='review_source_changed'],
 ['no actual CDP abort record',x=>x.observation.chrome_failed_posts=[]],
];
const onFault=[
 ['fake fault green verdict',x=>x.qa_verdict='pass'],
 ['fake clean QA error',x=>x.qa_error=null],
 ['fault flag hidden',x=>x.fault=null],
 ['fault bypass not active',x=>x.observation.abort_bypass_count=0],
 ['old model really closed',x=>x.observation.first_closed_before_release=true],
 ['old model never answered',x=>x.observation.first_model_response_sent=false],
 ['old cache never saved',x=>x.observation.cache_after_old_release=null],
 ['old cache did not win race',x=>x.observation.first_won_before_retry_completion=false],
 ['faulty retry not executed',x=>x.observation.second_model_response_sent=false],
 ['faulty UI accepted wrong old summary',x=>x.observation.ui_contains_first=true],
 ['faulty UI somehow accepted new summary',x=>x.observation.ui_contains_second=true],
 ['wrong CAS failure message',x=>x.observation.ui_error='network problem'],
 ['faked final new cache',x=>x.observation.final_cached_summary='Black won the game. SECOND GENERATION.'],
];
const onLate=[
 ['fake late-old green verdict',x=>x.qa_verdict='pass'],
 ['fake no QA abort fault',x=>x.fault=null],
 ['wrong late-old error reason',x=>x.qa_error='different failure'],
 ['bypass not active',x=>x.observation.abort_bypass_count=0],
 ['old request actually closed before reply',x=>x.observation.first_closed_before_release=true],
 ['replacement was never sent',x=>x.observation.second_model_response_sent=false],
 ['replacement failed to reach SQLite',x=>x.observation.cache_after_new_release=null],
 ['old response not delivered',x=>x.observation.first_model_response_sent=false],
 ['old reply overwrote latest data',x=>x.observation.cache_after_old_release='Black won the game. FIRST GENERATION.'],
 ['old report won the cache',x=>x.observation.first_won_before_retry_completion=true],
 ['late stale response poisoned cache',x=>x.observation.final_cached_summary='Black won the game. FIRST GENERATION.'],
 ['UI displayed canceled generation',x=>x.observation.ui_contains_first=true],
 ['UI failed to show newer generation',x=>x.observation.ui_contains_second=false],
 ['UI indicated unexpected CAS failure',x=>x.observation.ui_error='review_source_changed'],
];

let rejected=0;
for(const [kind,original,changes] of [
 ['clean',clean,[...mutants,...onClean]],
 ['fault',fault,[...mutants,...onFault]],
 ['late-old',late,[...mutants,...onLate]],
]){
 for(const [name,corrupt] of changes){
  const bad=structuredClone(original);corrupt(bad);
  assert.throws(()=>proveRetryEvidence(bad,kind),undefined,
   kind+': '+name+' falsely certified');
  rejected++;
 }
}
console.log(JSON.stringify({valid_clean_evidence_accepted:true,
 valid_broken_evidence_accepted_only_as_negative:true,
 valid_late_old_evidence_accepted_only_as_negative:true,
 forged_evidence_packets_rejected:rejected}));
