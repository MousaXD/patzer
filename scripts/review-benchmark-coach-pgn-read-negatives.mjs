#!/usr/bin/env node
/** Mutate real authenticated GET and changed PGN evidence. All examples are
 * synthetic QA-only JSON; real product owner branches remain untouched. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyPgnReadEvidence} from './review-benchmark-coach-pgn-read-proof.mjs';

const valid=JSON.parse(readFileSync('qa/review-excellence/results/coach-pgn-read-freshness.json','utf8'));
assert.equal(verifyPgnReadEvidence(valid).stale_unmarked_read_reproduced,true);
const trials=[
 ['wrong candidate',p=>p.source_candidate_sha='f'.repeat(40)],
 ['wrong parent',p=>p.prior_checkpoint='f'.repeat(40)],
 ['wrong fixture ID',p=>p.fixture='private-game'],
 ['wrong fixture digest',p=>p.fixture_sha256='f'.repeat(64)],
 ['wrong manifest digest',p=>p.manifest_sha256='f'.repeat(64)],
 ['invalid run UUID',p=>p.run_id='old-run'],
 ['falsified source provenance',p=>p.source_is_synthetic=false],
 ['incorrect old winner',p=>p.old_winner='white'],
 ['incorrect new winner',p=>p.new_winner='black'],
 ['fake release approval',p=>p.release_approved=true],
 ['fake product cache green',p=>p.product_cache_certified=true],
 ['change report version',p=>p.product_review_version=10],
 ['change score version',p=>p.scoring_version=10],
 ['wrong alternate source hash',p=>p.alternate_source_sha256='f'.repeat(64)],
 ['no real source PGN change',p=>p.alternate_source_sha256=p.old_pgn_sha256],
 ['no actual changed moves',p=>p.alternate_source_pgn=p.http_evidence.original_review.body.review.summary],
 ['change alternate source mating SAN',p=>p.alternate_source_pgn=p.alternate_source_pgn.replace('Qxf7#','Qf3')],
 ['change original prose hash',p=>p.original_prose_sha256='f'.repeat(64)],
 ['change marked prose hash',p=>p.marked_prose_sha256='f'.repeat(64)],
 ['remove route from code path list',p=>p.actual_code_paths.splice(2,1)],
 ['change code path label',p=>p.actual_code_paths[4]='unrelated update'],
 ['erase test limitations',p=>p.limits=[]],
 ['conceal a controlled source mutation',p=>p.limits[3]='all mutations were natural production events'],
 ['remove raw evidence',p=>delete p.http_evidence],
 ['remove original response',p=>delete p.http_evidence.original_review],
 ['remove changed response',p=>delete p.http_evidence.after_pgn_edit_review],
 ['remove score marker evidence',p=>delete p.http_evidence.after_marked_prose_pgn_edit_review],
 ['remove game-detail source evidence',p=>delete p.http_evidence.after_pgn_edit_game],
 ['swap source and restored review body',p=>{
  const h=p.http_evidence;
  [h.original_review.body,h.after_restored_pgn.body]=
   [h.after_restored_pgn.body,h.original_review.body];
 }],
 ['false authenticated anonymous access',p=>p.http_evidence.unauthenticated_review.status=200],
 ['false owner isolation',p=>p.http_evidence.other_user_review.status=200],
 ['false game-detail authentication',p=>p.http_evidence.unauthenticated_game.body={game:{}}],
 ['false game-detail owner isolation',p=>p.http_evidence.other_user_game.body={game:{}}],
 ['wrong initial auth user',p=>p.http_evidence.original_review.status=403],
 ['fake original report version',p=>p.http_evidence.original_review.body.review.version=100],
 ['fake product source summary',p=>p.http_evidence.original_review.body.review.summary='Not produced by actual no-LLM coach'],
 ['fake product source audience',p=>p.http_evidence.original_review.body.review.audience='advanced'],
 ['source note update falsely changed review',p=>p.http_evidence.harmless_metadata_review.body.review.summary='new summary'],
 ['present changed game as old PGN',p=>p.http_evidence.after_pgn_edit_game.body.game.pgn='fake'],
 ['present changed game as black-owned',p=>p.http_evidence.after_pgn_edit_game.body.game.user_color='black'],
 ['conceal reused analysis scoring version',p=>p.http_evidence.after_pgn_edit_game.body.analysis.scoring_version=1],
 ['invent different accuracy on unchanged analysis',p=>p.http_evidence.after_pgn_edit_game.body.analysis.accuracy_white=99],
 ['hide observed stale cached report',p=>p.http_evidence.after_pgn_edit_review.body.review=null],
 ['hide stale escape with stale:true',p=>p.http_evidence.after_pgn_edit_review.body.stale=true],
 ['misstate changed route HTTP status',p=>p.http_evidence.after_pgn_edit_review.status=409],
 ['replace cached report with unrelated text',p=>p.http_evidence.after_pgn_edit_review.body.review.summary='This now shows the new game'],
 ['hide correctly marked stale read escape',p=>p.http_evidence.after_marked_prose_pgn_edit_review.body.stale=true],
 ['hide report scoring marker',p=>delete p.http_evidence.after_marked_prose_pgn_edit_review.body.review.accuracy_model_version],
 ['fake scoring marker mismatch does not stale',p=>p.http_evidence.after_scoring_mismatch.body={review:{summary:'unsafe'}}],
 ['fake language mismatch does not stale',p=>p.http_evidence.after_language_mismatch.body={review:{summary:'unsafe'}}],
 ['fake audience mismatch does not stale',p=>p.http_evidence.after_audience_mismatch.body={review:{summary:'unsafe'}}],
 ['missing stale on scoring-mismatch control',p=>p.http_evidence.after_scoring_mismatch.body={review:null}],
 ['missing stale on language-mismatch control',p=>p.http_evidence.after_language_mismatch.body={review:null}],
 ['missing stale on audience-mismatch control',p=>p.http_evidence.after_audience_mismatch.body={review:null}],
 ['restored source still marked stale',p=>p.http_evidence.after_restored_pgn.body.stale=true],
 ['restored source no longer matches original',p=>p.http_evidence.after_restored_pgn.body.review.summary='not the original'],
 ['user-color perspective change hidden',p=>p.http_evidence.after_user_color_flip.body.review=null],
 ['user-color now marked stale',p=>p.http_evidence.after_user_color_flip.body.stale=true],
 ['wrong empty-cache response',p=>p.http_evidence.after_cache_cleared.body={review:{summary:'old'}}],
 ['missing original status flag',p=>p.observations.original_status=500],
 ['conceal stale unmarked read',p=>p.observations.previous_unmarked_cache_escaped_after_pgn_change=false],
 ['conceal stale marked read',p=>p.observations.previous_marked_cache_escaped_after_pgn_change=false],
 ['conceal stale colored review',p=>p.observations.previous_marked_cache_escaped_after_color_change=false],
 ['invent safe cache invalidation',p=>p.observations.changed_pgn_get_stale=true],
 ['conceal failing game-detail analysis',p=>p.observations.owner_game_detail_still_shows_previous_analysis=false],
 ['conceal positive CAS safeguard',p=>p.observations.stale_write_source_pgn_blocked=false],
 ['conceal language safeguard',p=>p.observations.language_mismatch_marked_stale=false],
 ['conceal audience safeguard',p=>p.observations.audience_mismatch_marked_stale=false],
 ['conceal scoring safeguard',p=>p.observations.scoring_marker_mismatch_marked_stale=false],
 ['fabricate a second update',p=>p.observations.pvp_pgn_update_writes=2],
 ['balanced forged false green on source and scored read',p=>{
  const h=p.http_evidence;
  h.after_pgn_edit_review.body={review:null,stale:true};
  h.after_scoring_mismatch.body={review:h.original_review.body.review};
  p.observations.changed_pgn_get_stale=true;
  p.observations.previous_unmarked_cache_escaped_after_pgn_change=false;
  p.observations.scoring_marker_mismatch_marked_stale=false;
 }],
];
let rejected=0;
for(const [name,mutate] of trials){
 const forged=structuredClone(valid);mutate(forged);
 assert.throws(()=>verifyPgnReadEvidence(forged),undefined,
  'independent proof accepted forged authenticated PGN read evidence: '+name);
 rejected++;
}
console.log(JSON.stringify({real_authenticated_route_packet_accepted:true,
  forged_source_and_GET_evidence_rejected:rejected,
  product_read_cache_staleness_demonstrated:true,
  no_product_source_mutations:true,release_approved:false}));
