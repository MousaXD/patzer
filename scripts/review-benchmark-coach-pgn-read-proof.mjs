#!/usr/bin/env node
/** Independent, fail-closed inspector for the real GET /review cached-source
 * mismatch. Does not import the report-route or its CAS. PGNs are replayed
 * separately; raw authenticated HTTP responses are required (not flags). */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {Chess} from 'chess.js';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const results=join(qa,'results');
const sha=v=>createHash('sha256').update(v).digest('hex');
const fileSha=p=>sha(readFileSync(p));
const candidate=realpathSync(join(results,'worktree-coach'));
assert(relative(results,candidate).startsWith('worktree-'));
const candidateSHA='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:candidate,encoding:'utf8'}).trim(),candidateSHA);
const sourceDigests={
 'server/src/routes/review.ts':'21e0a25f00418d7c1749b6089ed6d685ad1cb4f752e28bf5af16f9fa752442d0',
 'server/src/routes/games.ts':'576863e5a1fdc9125d7f23ed7d88fe08d744a84ff456ca69e5639261f83ce5eb',
 'server/src/coach/reviewCache.ts':'72aba2c3883feb2534fd8fd252f0eed9189eaccc46911141ac3943256019912b',
 'server/src/ws/play.ts':'7d17d20aa58dba2684d40acab1d7f42f8b5a2f54f38b38a329555f5fb3ae9839',
};
for(const [path,digest] of Object.entries(sourceDigests))
 assert.equal(fileSha(join(candidate,path)),digest,'owner source drift; do not certify stale source');
const ws=readFileSync(join(candidate,'server/src/ws/play.ts'),'utf8');
assert(ws.includes('UPDATE games SET white_time_ms = ?, black_time_ms = ?, last_move_at = ?, pgn = ?'));
const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8');
const manifestSha='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
assert.equal(sha(manifest),manifestSha);
const fixture=manifest.trim().split('\n').map(JSON.parse)
 .find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.source_kind==='synthetic'&&fixture.license==='self-authored');
const oldPgn=readFileSync(join(qa,'fixtures',fixture.pgn_file),'utf8');
assert.equal(sha(oldPgn),fixture.pgn_sha256);
const oldGame=new Chess();oldGame.loadPgn(oldPgn,{strict:true});
assert(oldGame.isCheckmate()&&oldGame.turn()==='w');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function sameJSON(a,b){return JSON.stringify(a)===JSON.stringify(b);}

export function verifyPgnReadEvidence(packet){
 assert.equal(packet.schema_version,1);
 assert(UUID.test(packet.run_id||''),'missing unique fresh source-run identifier');
 assert.equal(packet.prior_checkpoint,'5566180bd6196880a64f6a3cc71938b13769f7d7');
 assert.equal(packet.source_candidate_sha,candidateSHA);
 assert.equal(packet.manifest_sha256,manifestSha);
 assert.equal(packet.fixture,fixture.fixture_id);
 assert.equal(packet.fixture_sha256,fixture.pgn_sha256);
 assert.equal(packet.old_pgn_sha256,sha(oldPgn));
 assert.equal(packet.source_is_synthetic,true);
 assert.equal(packet.old_winner,'black');
 assert.equal(packet.new_winner,'white');
 assert.equal(packet.product_cache_certified,false);
 assert.equal(packet.release_approved,false);
 assert.equal(packet.product_review_version,9);
 assert.equal(packet.scoring_version,9);
 const changedPgn=new Chess();changedPgn.loadPgn(packet.alternate_source_pgn,{strict:true});
 assert(changedPgn.isCheckmate()&&changedPgn.turn()==='b',
  'claimed changed source must prove White checkmate by legal replay');
 assert.equal(changedPgn.header().Result,'1-0');
 assert.equal(packet.alternate_source_sha256,sha(packet.alternate_source_pgn));
 assert.notEqual(packet.old_pgn_sha256,packet.alternate_source_sha256,
  'test did not actually change the game PGN');
 assert.deepEqual(packet.actual_code_paths,[
  'buildGameReview','saveReviewIfFresh','GET /api/games/:id/review',
  'GET /api/games/:id','persistPvpClocks-equivalent SQLite source UPDATE']);
 const expectedLimitFragments=[
  'disposable DB','one synthetic owner game','Plausible game source mutation',
  'controlled source edit','No actual Stockfish analysis'];
 assert(Array.isArray(packet.limits)&&packet.limits.length===5);
 for(const fragment of expectedLimitFragments)
  assert(packet.limits.some(s=>s.includes(fragment)),'missing evidence scope limit: '+fragment);
 const h=packet.http_evidence;
 assert(h&&typeof h==='object'&&!Array.isArray(h));
 const keys=['unauthenticated_review','other_user_review','unauthenticated_game','other_user_game',
  'original_review','harmless_metadata_review','after_pgn_edit_review','after_pgn_edit_game',
  'after_marked_prose_pgn_edit_review','after_scoring_mismatch','after_language_mismatch',
  'after_audience_mismatch','after_restored_pgn','after_user_color_flip','after_cache_cleared'];
 assert.deepEqual(Object.keys(h),keys,'HTTP evidence omitted, reordered or invented a scenario');
 for(const [name,expectedStatus,expectedError] of [
  ['unauthenticated_review',401,'unauthorized'],
  ['other_user_review',404,'not_found'],
  ['unauthenticated_game',401,'unauthorized'],
  ['other_user_game',404,'not_found'],
 ]){
  assert.equal(h[name].status,expectedStatus,name);
  assert.deepEqual(h[name].body,{error:expectedError});
 }
 const success=['original_review','harmless_metadata_review','after_pgn_edit_review',
  'after_pgn_edit_game','after_marked_prose_pgn_edit_review','after_scoring_mismatch',
  'after_language_mismatch','after_audience_mismatch','after_restored_pgn',
  'after_user_color_flip','after_cache_cleared'];
 for(const name of success)assert.equal(h[name].status,200,name+' did not return HTTP 200');
 const original=h.original_review.body.review;
 assert(original&&typeof original==='object');
 assert.equal(original.version,packet.product_review_version);
 assert.equal(original.language,'en');assert.equal(original.audience,'beginner');
 assert.equal(typeof original.summary,'string');
 assert(original.summary.includes('16.0%'),'real product builder was not exercised');
 assert.equal(packet.original_prose_sha256,sha(JSON.stringify(original)));
 assert(sameJSON(h.harmless_metadata_review.body.review,original),
  'non-source notes/bookmark update unexpectedly invalidated cache');
 assert(sameJSON(h.after_pgn_edit_review.body.review,original),
  'historical QA attack no longer reproduces; do not claim it does');
 assert.equal(h.after_pgn_edit_review.body.stale,undefined,
  'PGN source change is now recognized; QA must update expected verdict');
 const g=h.after_pgn_edit_game.body;
 assert(g&&g.game&&g.analysis);
 assert.equal(g.game.pgn,packet.alternate_source_pgn);
 assert.equal(g.game.user_color,'white');
 assert.equal(g.analysis.accuracy_white,16);
 assert.equal(g.analysis.scoring_version,packet.scoring_version);
 const marked=h.after_marked_prose_pgn_edit_review.body.review;
 assert(marked&&typeof marked==='object');
 assert.equal(marked.accuracy_model_version,packet.scoring_version,
  'matching score marker must be present to test its insufficiency for PGN changes');
 assert.equal(packet.marked_prose_sha256,sha(JSON.stringify(marked)));
 assert(sameJSON(marked,{...original,accuracy_model_version:packet.scoring_version}));
 assert.equal(h.after_marked_prose_pgn_edit_review.body.stale,undefined,
  'source PGN was actually recognized by marked review read');
 for(const name of ['after_scoring_mismatch','after_language_mismatch',
  'after_audience_mismatch']){
  assert.deepEqual(h[name].body,{review:null,stale:true},
   name+' existing cache-bypass positive control failed');
 }
 assert.deepEqual(h.after_restored_pgn.body,{review:marked},
  'restored matching game-source wrongly treated as stale');
 assert.deepEqual(h.after_user_color_flip.body,{review:marked},
  'user perspective mismatch was recognized; QA must update expected verdict');
 assert.deepEqual(h.after_cache_cleared.body,{review:null});
 const O=packet.observations;
 assert(O&&typeof O==='object');
 const expected={
  no_auth_status:401,other_user_status:404,
  no_auth_detail_status:401,other_user_detail_status:404,
  original_status:200,original_cache_matches:true,
  harmless_notes_and_bookmark_preserve_cache:true,
  pvp_pgn_update_writes:1,
  owner_game_detail_shows_changed_pgn:true,
  owner_game_detail_still_shows_previous_analysis:true,
  changed_pgn_get_status:200,changed_pgn_get_stale:false,
  previous_unmarked_cache_escaped_after_pgn_change:true,
  previous_marked_cache_escaped_after_pgn_change:true,
  stale_write_source_pgn_blocked:true,
  stale_write_source_color_blocked:true,
  previous_marked_cache_escaped_after_color_change:true,
  scoring_marker_mismatch_marked_stale:true,
  language_mismatch_marked_stale:true,
  audience_mismatch_marked_stale:true,
  restored_source_cache_matches:true,
  null_cache_not_returned:true,
 };
 assert.deepEqual(O,expected,
  'reported attack flags contradict independently required real route outcomes');
 return {
  real_authenticated_review_and_game_routes_exercised:true,
  source_PGN_changed_between_opposite_winners:true,
  stale_unmarked_read_reproduced:true,
  stale_scoring_marked_read_reproduced:true,
  stale_color_perspective_read_reproduced_under_controlled_mutation:true,
  game_detail_kept_old_analysis_after_PGN_update:true,
  CAS_guard_blocked_outdated_new_write:true,
  positive_metadata_and_ownership_controls_passed:true,
  independent_candidate_file_sha256:sourceDigests,
  synthetic_test_only:true,product_cache_certified:false,release_approved:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const raw=JSON.parse(readFileSync(join(results,'coach-pgn-read-freshness.json'),'utf8'));
 const verdict=verifyPgnReadEvidence(raw);
 const scripts=['scripts/review-benchmark-coach-pgn-read-race.mjs',
  'scripts/review-benchmark-coach-pgn-read-proof.mjs',
  'scripts/review-benchmark-coach-pgn-read-negatives.mjs',
  'scripts/review-benchmark-coach-pgn-read-boundary.mjs'];
 const report={schema_version:1,at_utc:new Date().toISOString(),
  branch:'agent/review-benchmark-20261111',
  prior_checkpoint:'5566180bd6196880a64f6a3cc71938b13769f7d7',
  benchmark_checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  pinned_candidate_b:candidateSHA,source_run_id:raw.run_id,
  independent_evidence:verdict,
  script_sha256:Object.fromEntries(scripts.map(x=>[x,fileSha(join(root,x))])),
  scoped_failure:'read_endpoint_does_not_invalidate_old_prose_when_game_pgn_changes',
  advisory_only:true,external_model_calls:0,stockfish_calls:0,
  no_owner_product_source_mutated:true,
  release_approved:false,integration_approved:false,
  limits:['One synthetic PvP-style game and one isolated non-owner, not production incidence measurement',
   'The PGN update executes production-equivalent SQL on disposable SQLite, not a live websocket',
   'Game-source edits do not prove every live game already has a review before a move arrives',
   'Existing scoring-marked prose still escapes PGN change; no accepted product source fix was applied',
   'No private customer games, hosted model, Stockfish workload, migrations or production configuration']};
 const path=join(qa,'certification-summary-checkpoint32.json');
 writeFileSync(path,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:path,...verdict},null,2));
}
