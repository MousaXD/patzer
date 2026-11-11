#!/usr/bin/env node
/** Verify a bounded, hand-authored claim-scope matrix independently from the
 * test runner, source-anchored to chess.js and historical LOCAL model output.
 * A correct *abstention* is not a new natural-language model certification.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Chess} from 'chess.js';
import {validateI18nEvidence} from './review-benchmark-coach-i18n-proof.mjs';
import {verifyCoachProvenanceEvidence} from './review-benchmark-coach-provenance-proof.mjs';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence'),results=join(qa,'results');
const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const fixture='SYN-GAME-FOOLS-MATE';
const manifest='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
const candidate='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const runId=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const originalI18n=JSON.parse(readFileSync(join(results,'coach-i18n-real-pipeline.json'),'utf8'));
assert.deepEqual(validateI18nEvidence(originalI18n),{
 languages_proved:5,winner_escapes:5,king_square_escapes:5,model_requests:30,certified:false});
const source=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8')
 .trim().split('\n').map(JSON.parse).find(x=>x.fixture_id===fixture);
assert(source?.source_kind==='synthetic'&&source.license==='self-authored');
const pgn=join(qa,'fixtures',source.pgn_file);
assert.equal(digest(pgn),source.pgn_sha256);
const chess=new Chess();chess.loadPgn(readFileSync(pgn,'utf8'),{strict:true});
assert(chess.isCheckmate()&&chess.turn()==='w'&&chess.header().Result==='0-1');
assert(chess.get('e1')?.type==='k'&&chess.get('e1')?.color==='w');
assert.notEqual(chess.get('e2')?.type,'k');

// Use a fixed expected table independent of the runtime matrix's recorded
// want/observed fields. Important cases are independently named and scoped.
const gold=[
 ['direct true winner','limited_claims_passed',null],
 ['direct false winner','rejected','contradicted_game_winner'],
 ['direct true king','limited_claims_passed',null],
 ['direct false king','rejected','contradicted_piece_location'],
 ['direct true you lost','limited_claims_passed',null],
 ['direct false you won','rejected','contradicted_game_winner'],
 ['perspective changed black you won','limited_claims_passed',null],
 ['perspective changed black opponent won','rejected','contradicted_game_winner'],
 ['mixed true winner + unrecognized white monarch','partial_claims_verified','unchecked_prose_remainder'],
 ['mixed true winner + unrecognized white side victor','partial_claims_verified','unchecked_prose_remainder'],
 ['mixed true winner + unrecognized first player victor','partial_claims_verified','unchecked_prose_remainder'],
 ['mixed true winner + unrecognized pedagogical conclusion','partial_claims_verified','unchecked_prose_remainder'],
 ['unsupported false implicit only','not_evaluated','no_recognized_checkable_claims'],
 ['unsupported king synonym only','not_evaluated','no_recognized_checkable_claims'],
 ['recognized king plus unrecognized king synonym','partial_claims_verified','unchecked_prose_remainder'],
 ['meta-language false that statement','partial_claims_verified','quoted_or_disavowed_result_not_assessed'],
 ['meta-language do not say','partial_claims_verified','quoted_or_disavowed_result_not_assessed'],
 ['meta-language straight quote in warning','partial_claims_verified','quoted_or_disavowed_result_not_assessed'],
 ['meta-language reported quote','partial_claims_verified','quoted_or_disavowed_result_not_assessed'],
 ['quoted false sentence only','not_evaluated','quoted_or_disavowed_result_not_assessed'],
 ['literal false sentence still rejected','rejected','contradicted_game_winner'],
 ['context warning does not shield later direct false sentence','rejected','contradicted_game_winner'],
 ['negated king lie','partial_claims_verified','quoted_or_disavowed_piece_not_assessed'],
 ['quoted king lie','partial_claims_verified','quoted_or_disavowed_piece_not_assessed'],
 ['direct false king despite earlier true quote','rejected','contradicted_piece_location'],
 ['emoji direct true','limited_claims_passed',null],
 ['emoji direct false','rejected','contradicted_game_winner'],
 ['astral + unsupported claim','partial_claims_verified','unchecked_prose_remainder'],
 ['double astral + unsupported claim','partial_claims_verified','unchecked_prose_remainder'],
 ['astral + disavowal','partial_claims_verified','quoted_or_disavowed_result_not_assessed'],
];
export function verifyCoachScopeMatrix(packet){
 assert.equal(packet.schema_version,1);
 assert(runId.test(packet.run_id||''));
 assert.equal(packet.previous_agent_d_head,'b8d50abc528a9b61ac243dfc4f351cfcc43a88bd');
 assert.equal(packet.candidate_b_sha,candidate);
 assert.equal(packet.fixture_id,fixture);
 assert.equal(packet.manifest_sha256,manifest);
 assert.equal(packet.manifest_sha256,digest(join(qa,'manifests/manifest-v2.jsonl')));
 assert.equal(packet.i18n_source_sha256,digest(join(results,'coach-i18n-real-pipeline.json')));
 assert.equal(packet.source_chess_result,'0-1');
 assert.equal(packet.source_white_king_square,'e1');
 assert.equal(packet.source_kind,'self-authored synthetic and previously pinned loopback-model literal phrases');
 assert.deepEqual(packet.independent_checked_languages,['en']);
 assert.deepEqual(packet.non_english_abstention_languages,['es','de','bg','ru']);
 assert.equal(packet.full_factuality_certified,false);
 assert.equal(packet.release_approved,false);
 assert.equal(packet.sample_count,59);
 assert(Array.isArray(packet.cases)&&packet.cases.length===59);
 assert.equal(new Set(packet.cases.map(x=>x.name)).size,59,'duplicated matrix case');
 const actualCounts={};
 for(const row of packet.cases){
  assert.equal(row.expected_status,row.observed_status,
   row.name+': the runner misreported its own positive/negative result');
  assert.equal(row.full_factuality_certified,false);
  assert(['en','es','de','bg','ru'].includes(row.language));
  assert(['white','black'].includes(row.user_color));
  assert(Number.isSafeInteger(row.verified_claims)&&row.verified_claims>=0&&row.verified_claims<=2);
  assert(Array.isArray(row.findings)&&Array.isArray(row.unassessed));
  if(row.observed_status==='rejected')assert(row.findings.length>0);
  if(row.observed_status==='not_evaluated')assert.equal(row.verified_claims,0);
  if(row.observed_status==='limited_claims_passed'){
   assert(row.verified_claims>0);
   assert.deepEqual(row.findings,[]);assert.deepEqual(row.unassessed,[]);
  }
  if(row.observed_status==='partial_claims_verified'){
   assert(row.verified_claims>0);
   assert.deepEqual(row.findings,[]);
   assert(row.unassessed.length>0);
  }
  actualCounts[row.observed_status]=(actualCounts[row.observed_status]||0)+1;
 }
 assert.deepEqual(actualCounts,{limited_claims_passed:6,rejected:11,
  partial_claims_verified:27,not_evaluated:15});
 assert.deepEqual(packet.counts,actualCounts);
 const byName=new Map(packet.cases.map(x=>[x.name,x]));
 for(const [name,status,reason] of gold){
  const row=byName.get(name);
  assert(row,'missing independently selected case '+name);
  assert.equal(row.observed_status,status,name);
  if(reason)assert([...row.findings,...row.unassessed].includes(reason),name+' omitted '+reason);
 }
 for(const language of ['en','es','de','bg','ru']){
  for(const claim of ['winner','king']){
   const row=byName.get('recorded model false '+claim+' '+language);
   assert(row,'missing recorded actual product-output case '+language+'/'+claim);
   assert.equal(row.language,language);
   const unsupported=language!=='en';
   assert.equal(row.observed_status,unsupported?'not_evaluated':'rejected');
   assert([...row.unassessed,...row.findings].includes(unsupported?
    'language_not_supported_by_independent_checker':
    claim==='winner'?'contradicted_game_winner':'contradicted_piece_location'));
   if(unsupported)assert.equal(row.verified_claims,0);
  }
  if(language!=='en'){
   const mixed=byName.get('language flag English but foreign claim '+language);
   assert(mixed&&mixed.observed_status==='partial_claims_verified');
   assert(mixed.unassessed.includes('unchecked_prose_remainder'));
   const locale=byName.get('same locale with English true statement '+language);
   assert(locale&&locale.observed_status==='not_evaluated');
   assert.equal(locale.verified_claims,0);
  }
 }
 return {independently_named_gold_cases:gold.length,
  sample_count:59,scoped_verified_count:actualCounts.limited_claims_passed,
  explicit_contradictions_rejected:actualCounts.rejected,
  partial_with_uncertainty_reported:actualCounts.partial_claims_verified,
  not_evaluated:actualCounts.not_evaluated,
  five_actual_model_output_locales_included:true,
  certified_supported_language_only:'en',
  full_factuality_certified:false,release_approved:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const packet=JSON.parse(readFileSync(join(results,'coach-scope-matrix.json'),'utf8'));
 const scoped=verifyCoachScopeMatrix(packet);
 const real=JSON.parse(readFileSync(join(results,'real-coach-faults.json'),'utf8'));
 const realProven=verifyCoachProvenanceEvidence(real);
 assert.equal(realProven.real_pipeline_false_winner_in_output,true);
 assert.equal(realProven.real_pipeline_false_king_location_in_output,true);
 assert.equal(realProven.full_factuality_certified,false);
 const paths=[
  'scripts/review-benchmark-coach-claim-adapter.mjs',
  'scripts/review-benchmark-coach-claim-negative-controls.mjs',
  'scripts/review-benchmark-coach-provenance-negatives.mjs',
  'scripts/review-benchmark-coach-provenance-proof.mjs',
  'scripts/review-benchmark-coach-scope-matrix.mjs',
  'scripts/review-benchmark-coach-scope-proof.mjs',
  'scripts/review-benchmark-coach-scope-negatives.mjs',
  'scripts/review-benchmark-coach-scope-boundary.mjs',
  'scripts/review-benchmark-real-coach-faults.mjs',
 ];
 const report={schema_version:1,at_utc:new Date().toISOString(),
  assigned_branch:'agent/review-benchmark-20261111',
  previous_head:'b8d50abc528a9b61ac243dfc4f351cfcc43a88bd',
  qa_checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  candidate_b_sha:candidate,manifest_sha256:manifest,fixture_id:fixture,
  scope_run_id:packet.run_id,
  real_coach_run_id:real.benchmark_run_id,
  original_i18n_local_model_requests:originalI18n.requests,
  new_model_requests_for_scope_matrix:0,
  scope_evidence:scoped,
  real_candidate_false_claims_remain:2,
  source_sha256:Object.fromEntries(paths.map(path=>[path,digest(join(root,path))])),
  result:{qa_scope_false_green_closed:true,
   qa_negation_quote_false_rejection_closed_for_recognized_patterns:true,
   non_english_output_explicitly_abstained:true,
   all_generated_coaching_prose_certified:false,
   product_coach_factuality_certified:false,
   release_approved:false,integration_approved:false},
  limitations:['Recognized English exact-result and owner/piece-square claims only',
   'Partial verdict explicitly identifies unchecked prose; it cannot prove the prose true/false',
   'Meta-language abstention covers only specific quotes and denial templates, not open-ended syntax',
   'Multilingual tests reuse QA-authored synthetic strings and previously pinned local model output',
   'No independent native-speaker adjudication, representative LLM model, sealed holdout or real user games',
   'Other agents source and production credentials, SQLite and releases untouched']};
 const output=join(qa,'certification-summary-checkpoint25.json');
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:output,...scoped,
  candidate_coaching_factuality_certified:false,release_approved:false},null,2));
}
