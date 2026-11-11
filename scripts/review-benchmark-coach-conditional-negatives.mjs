#!/usr/bin/env node
/** Corrupt bounded modal/conditional QA evidence to ensure unknown claims
 * cannot be promoted into a factuality or release approval by a false flag. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyCoachConditionalMatrix} from './review-benchmark-coach-conditional-proof.mjs';
const pristine=JSON.parse(readFileSync('qa/review-excellence/results/coach-conditional-matrix.json','utf8'));
assert.equal(verifyCoachConditionalMatrix(pristine).total_cases,68);
function change(p,name,fn){
 const row=p.cases.find(x=>x.name===name);
 assert(row,'unknown mutation fixture '+name);fn(row);
}
const mutations=[
 ['wrong candidate',x=>x.candidate_b_sha='f'.repeat(40)],
 ['fake prior checkpoint',x=>x.previous_checkpoint='f'.repeat(40)],
 ['wrong fixture',x=>x.fixture_id='CUSTOMER-1'],
 ['false manifest',x=>x.manifest_sha256='f'.repeat(64)],
 ['false PGN hash',x=>x.pgn_sha256='f'.repeat(64)],
 ['not synthetic',x=>x.source_kind='private game data'],
 ['fake run id',x=>x.run_id='stale-certificate'],
 ['promised full certification',x=>x.full_factuality_certified=true],
 ['false release approved',x=>x.release_approved=true],
 ['model calls fabricated',x=>x.actual_LLM_calls=1],
 ['engine calls fabricated',x=>x.stockfish_calls=1],
 ['removed entire case',x=>x.cases.pop()],
 ['fake count',x=>x.sample_count=67],
 ['fabricated count',x=>x.counts.not_evaluated=50],
 ['duplicate case name',x=>x.cases[0].name=x.cases[1].name],
 ['unsupported color',x=>change(x,'perspective black hypothetical win',r=>r.user_color='neither')],
 ['pretend verifier certified full prose',x=>change(x,'false result if',r=>r.full_factuality_certified=true)],
 ['false conditional winner rejected',x=>change(x,'false result if',r=>{r.expected_status='rejected';r.observed_status='rejected';r.findings=['contradicted_game_winner'];})],
 ['false conditional winner fully verified',x=>change(x,'false result suppose',r=>{r.expected_status='limited_claims_passed';r.observed_status='limited_claims_passed';r.verified_count=1;r.verified_types=['game_result'];r.unassessed=[];})],
 ['actual hypothetical question marked contradiction',x=>change(x,'false result closing question',r=>{r.expected_status='rejected';r.observed_status='rejected';r.findings=['contradicted_game_winner'];})],
 ['true conditional wrongly called a proof',x=>change(x,'true result conditional true if',r=>{r.expected_status='limited_claims_passed';r.observed_status='limited_claims_passed';r.verified_count=1;r.verified_types=['game_result'];r.unassessed=[];})],
 ['another true maybe falsely verified',x=>change(x,'true result conditional true maybe',r=>r.verified_count=1)],
 ['missing modal reason for conditional',x=>change(x,'false result trailing only if',r=>r.unassessed=[])],
 ['lost hypothetical result reason',x=>change(x,'false result imagine',r=>r.unassessed=['unchecked_prose_remainder'])],
 ['wrong conditional conclusion',x=>change(x,'false result if',r=>r.summary='White won the game.')],
 ['wrong source modal sample text',x=>change(x,'false result if',r=>r.summary='If White won the game, which team?')],
 ['unrecognized modal row treated pure',x=>change(x,'separate sentence direct then false antecedent',r=>{r.expected_status='limited_claims_passed';r.observed_status='limited_claims_passed';r.unassessed=[];})],
 ['mixed modal row unassessed only',x=>change(x,'separate sentence direct then question',r=>{r.expected_status='not_evaluated';r.observed_status='not_evaluated';r.verified_count=0;r.verified_types=[];})],
 ['same sentence condition incorrectly verified',x=>change(x,'same sentence conditional governs both',r=>{r.expected_status='partial_claims_verified';r.observed_status='partial_claims_verified';r.verified_count=1;r.verified_types=['game_result'];})],
 ['second same-sentence lie treated direct',x=>change(x,'same sentence conditional governs antecedent and second false',r=>{r.expected_status='rejected';r.observed_status='rejected';r.findings=['contradicted_game_winner'];})],
 ['wrong hypothetical king rejected',x=>change(x,'conditional piece if false',r=>{r.expected_status='rejected';r.observed_status='rejected';r.findings=['contradicted_piece_location'];})],
 ['real king hypothetical called proof',x=>change(x,'conditional piece if true',r=>{r.expected_status='limited_claims_passed';r.observed_status='limited_claims_passed';r.verified_count=1;r.verified_types=['piece_location'];r.unassessed=[];})],
 ['wrong modal piece assertion skipped report',x=>change(x,'conditional piece suppose false',r=>r.unassessed=[])],
 ['wrong model piece actually true',x=>change(x,'conditional piece suppose false',r=>r.moment="Suppose White's king is on e1.")],
 ['hypothetical king fake location credited',x=>change(x,'conditional piece imagine false',r=>r.verified_count=1)],
 ['false direct winner hidden',x=>change(x,'direct contrast direct White false',r=>{r.expected_status='not_evaluated';r.observed_status='not_evaluated';r.findings=[];r.unassessed=['hypothetical_or_conditional_result_not_assessed'];})],
 ['true direct winner invented as false',x=>change(x,'direct contrast direct Black true',r=>{r.expected_status='rejected';r.observed_status='rejected';r.findings=['contradicted_game_winner'];r.verified_count=0;r.verified_types=[];})],
 ['true direct king not verified',x=>change(x,'direct contrast direct actual king',r=>r.verified_count=0)],
 ['direct wrong king not flagged',x=>change(x,'direct contrast direct fake king',r=>r.findings=[])],
 ['direct wrong pawn not flagged',x=>change(x,'direct contrast direct fake pawn',r=>r.findings=[])],
 ['direct contradiction after question ignored',x=>change(x,'direct contradiction after question',r=>{r.expected_status='not_evaluated';r.observed_status='not_evaluated';r.findings=[];})],
 ['subsequent direct truth swallowed',x=>change(x,'direct truth after question',r=>r.verified_count=0)],
 ['subsequent fake king hidden',x=>change(x,'direct contradiction after hypothetical piece',r=>r.findings=[])],
 ['conditional piece later true hidden',x=>change(x,'direct truth after hypothetical piece',r=>r.verified_count=0)],
 ['random loss of all unassessed',x=>x.cases.forEach(r=>r.unassessed=[])],
 ['random all claims marked verified',x=>x.cases.forEach(r=>r.verified_count=1)],
 ['aggregate-preserving swap of two previously unselected test outcomes',x=>{
  const a=x.cases.find(r=>r.name==='false result hypothetical qualifier');
  const b=x.cases.find(r=>r.name==='separate sentence direct then true antecedent');
  [a.expected_status,a.observed_status,a.verified_count,a.verified_types]=
   ['partial_claims_verified','partial_claims_verified',1,['game_result']];
  [b.expected_status,b.observed_status,b.verified_count,b.verified_types]=
   ['not_evaluated','not_evaluated',0,[]];
 }],
 ['benign-looking text substitution in an otherwise unselected input',x=>change(x,
  'false result hypothetical qualifier',r=>r.summary='Hypothetically White won that game.')],
];
let rejected=0;
for(const [name,mutate] of mutations){
 const x=structuredClone(pristine);mutate(x);
 assert.throws(()=>verifyCoachConditionalMatrix(x),undefined,'forge not detected: '+name);
 rejected++;
}
console.log(JSON.stringify({valid_68_case_packet_accepted:true,
 hostile_evidence_mutations_rejected:rejected,
 hypothetical_unsupported_claims_not_promoted_to_factuality:true,
 release_approved:false},null,2));
