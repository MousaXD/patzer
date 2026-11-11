#!/usr/bin/env node
/** Hostile evidence mutation controls: partial/quoted/multilingual outputs
 * must NEVER become a green full-product or completely-covered verdict.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyCoachScopeMatrix} from './review-benchmark-coach-scope-proof.mjs';
const raw=JSON.parse(readFileSync('qa/review-excellence/results/coach-scope-matrix.json','utf8'));
assert.equal(verifyCoachScopeMatrix(raw).sample_count,59);
const change=(p,label,mutate)=>{
 const row=p.cases.find(x=>x.name===label);
 assert(row,'unknown adversarial row '+label);
 mutate(row);
};
const attacks=[
 ['fake source candidate',p=>p.candidate_b_sha='e'.repeat(40)],
 ['fake source game',p=>p.fixture_id='PRIVATE-GAME-1'],
 ['fake manifest',p=>p.manifest_sha256='f'.repeat(64)],
 ['fake PGN result',p=>p.source_chess_result='1-0'],
 ['fake White king position',p=>p.source_white_king_square='e2'],
 ['fake previous checkpoint',p=>p.previous_agent_d_head='f'.repeat(40)],
 ['fake full factuality approval',p=>p.full_factuality_certified=true],
 ['fake release approved',p=>p.release_approved=true],
 ['fake run identifier',p=>p.run_id='stale-run'],
 ['fake recorded five-language model source',p=>p.i18n_source_sha256='f'.repeat(64)],
 ['fake QA content source',p=>p.source_kind='real private customer data'],
 ['two supported languages claimed',p=>p.independent_checked_languages.push('es')],
 ['Spanish removed from abstention',p=>p.non_english_abstention_languages.shift()],
 ['missing results',p=>p.cases.pop()],
 ['false extra sample count',p=>p.sample_count=58],
 ['fraudulent count of partial cases',p=>p.counts.partial_claims_verified=0],
 ['duplicated case identity',p=>p.cases[0].name=p.cases[1].name],
 ['another row incorrectly certified',p=>p.cases[0].full_factuality_certified=true],
 ['unverified new language',p=>p.cases[0].language='ar'],
 ['invalid user color',p=>p.cases[0].user_color='unknown'],
 ['fabricated 40 verified claims',p=>p.cases[0].verified_claims=40],
 ['true winner becomes rejected',p=>change(p,'direct true winner',r=>r.observed_status='rejected')],
 ['false winner labeled true',p=>change(p,'direct false winner',r=>{r.observed_status='limited_claims_passed';r.expected_status=r.observed_status;r.findings=[];})],
 ['false king labeled true',p=>change(p,'direct false king',r=>{r.observed_status='limited_claims_passed';r.expected_status=r.observed_status;r.findings=[];})],
 ['false user winner unreported',p=>change(p,'direct false you won',r=>r.findings=[])],
 ['true winner now unassessed',p=>change(p,'direct true winner',r=>r.unassessed.push('unchecked_prose_remainder'))],
 ['true exact recognized claim suppressed',p=>change(p,'direct true king',r=>r.verified_claims=0)],
 ['unknown monarch treated fully verified',p=>change(p,'mixed true winner + unrecognized white monarch',r=>{r.observed_status='limited_claims_passed';r.expected_status=r.observed_status;r.unassessed=[];})],
 ['unknown first-player outcome treated fully verified',p=>change(p,'mixed true winner + unrecognized first player victor',r=>{r.observed_status='limited_claims_passed';r.expected_status=r.observed_status;r.unassessed=[];})],
 ['partial report concealed unknown prose',p=>change(p,'recognized king plus unrecognized king synonym',r=>r.unassessed=[])],
 ['partial report has fake contradiction',p=>change(p,'recognized king plus unrecognized king synonym',r=>r.findings.push('contradicted_piece_location'))],
 ['model not_evaluated credited as proof',p=>change(p,'unsupported false implicit only',r=>r.verified_claims=1)],
 ['ignored disavowal treated as false claim',p=>change(p,'meta-language false that statement',r=>{r.observed_status='rejected';r.expected_status='rejected';r.findings=['contradicted_game_winner'];})],
 ['ignored quotation treated as false claim',p=>change(p,'meta-language straight quote in warning',r=>{r.observed_status='rejected';r.expected_status='rejected';r.findings=['contradicted_game_winner'];})],
 ['quoted-only sentence credited a victory',p=>change(p,'quoted false sentence only',r=>{r.observed_status='limited_claims_passed';r.expected_status=r.observed_status;r.verified_claims=1;r.unassessed=[];})],
 ['real false statement ignored after earlier quote',p=>change(p,'context warning does not shield later direct false sentence',r=>r.findings=[])],
 ['negated king sentence treated as contradicted',p=>change(p,'negated king lie',r=>r.findings=['contradicted_piece_location'])],
 ['emoji changes verifiable truth',p=>change(p,'emoji direct true',r=>r.observed_status='not_evaluated')],
 ['emoji before disavowal causes rejection',p=>change(p,'astral + disavowal',r=>{r.observed_status='rejected';r.expected_status='rejected';r.findings=['contradicted_game_winner'];})],
 ['Spanish false winner falsely English-verified',p=>change(p,'recorded model false winner es',r=>{r.observed_status='limited_claims_passed';r.expected_status=r.observed_status;r.verified_claims=1;r.unassessed=[];})],
 ['German model king falsely verified',p=>change(p,'recorded model false king de',r=>{r.observed_status='limited_claims_passed';r.expected_status=r.observed_status;r.verified_claims=1;r.unassessed=[];})],
 ['Russian model false winner secretly verified',p=>change(p,'recorded model false winner ru',r=>r.verified_claims=1)],
 ['Bulgarian false square falsely rejected',p=>change(p,'recorded model false king bg',r=>{r.observed_status='rejected';r.expected_status='rejected';r.findings=['contradicted_piece_location'];})],
 ['Spanish locale with English words treated supported',p=>change(p,'same locale with English true statement es',r=>{r.observed_status='limited_claims_passed';r.expected_status=r.observed_status;r.verified_claims=1;r.unassessed=[];})],
 ['German claim in English locale treated fully verified',p=>change(p,'language flag English but foreign claim de',r=>{r.observed_status='limited_claims_passed';r.expected_status=r.observed_status;r.unassessed=[];})],
 ['missing Spanish output test',p=>{p.cases=p.cases.filter(r=>r.name!=='recorded model false winner es');p.sample_count--;p.counts.not_evaluated--; }],
 ['missing Bulgarian output test',p=>{p.cases=p.cases.filter(r=>r.name!=='recorded model false king bg');p.sample_count--;p.counts.not_evaluated--; }],
 ['invent new 60th test',p=>{p.cases.push({...p.cases[0],name:'new fake green scenario'});p.sample_count++;p.counts.limited_claims_passed++; }],
];
let rejected=0;
for(const [name,mutate] of attacks){
 const candidate=structuredClone(raw);mutate(candidate);
 assert.throws(()=>verifyCoachScopeMatrix(candidate),undefined,
  'independent proof allowed forged scope evidence: '+name);
 rejected++;
}
console.log(JSON.stringify({genuine_59_case_matrix_accepted:true,
 false_green_evidence_mutations_rejected:rejected,
 correct_abstention_not_promoted_to_factuality:true,
 release_approved:false},null,2));
