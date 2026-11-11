#!/usr/bin/env node
/** Adversarial JSON evidence tampering against a REAL Hono cached-analysis
 * POST followed by a new, source-mismatched review SSE. Includes a deliberate
 * corrected-analysis negative control; no owner product files are touched. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyAdmissionSourceEvidence} from './review-benchmark-coach-admission-proof.mjs';

const results='qa/review-excellence/results/';
const clean=JSON.parse(readFileSync(results+'coach-admission-source.json','utf8'));
const fault=JSON.parse(readFileSync(results+'coach-admission-source-fault.json','utf8'));
assert.equal(verifyAdmissionSourceEvidence(clean).fresh_report_moments_proven_from_wrong_PGN,true);
assert.equal(verifyAdmissionSourceEvidence(fault,{kind:'fault'}).corrected_analysis_before_admission_prevents_source_mix,true);
const o=p=>p.observations;
const controls=p=>o(p).controls;
const change=p=>o(p).after_pgn_change;
const after=p=>o(p).after_new_report;
const cases=[
 ['bad candidate',p=>p.backend_candidate_sha='f'.repeat(40)],
 ['bad engine',p=>p.engine_sha256='f'.repeat(64)],
 ['bad manifest',p=>p.manifest_sha256='f'.repeat(64)],
 ['bad fixture',p=>p.source_fixture_id='real-private-user'],
 ['bad prior checkpoint',p=>p.prior_checkpoint='f'.repeat(40)],
 ['reused/invalid run ID',p=>p.run_id='no UUID'],
 ['old game tampered',p=>p.original_pgn=p.original_pgn.replace('g4','Nf3')],
 ['old game digest tampered',p=>p.original_pgn_sha256='f'.repeat(64)],
 ['new game changed result',p=>p.updated_pgn=p.updated_pgn.replace('[Result "1-0"]','[Result "0-1"]')],
 ['new game mate replaced',p=>p.updated_pgn=p.updated_pgn.replace('Qxf7#','Qf3')],
 ['new game checksum mismatched',p=>p.updated_pgn_sha256='f'.repeat(64)],
 ['fake production users',p=>p.source_is_synthetic=false],
 ['fake live database',p=>p.sqlite_is_disposable=false],
 ['fake Hono routes',p=>p.authenticated_real_hono_routes=false],
 ['fake LLM calls',p=>p.external_llm_requests=8],
 ['increased Stockfish searches',p=>p.engine_searches=6],
 ['increased search depth',p=>p.engine_depth=20],
 ['mass engine threads',p=>p.engine_threads=8],
 ['mass engine hash',p=>p.engine_hash_mib=512],
 ['fake release approval',p=>p.product_release_approved=true],
 ['omit caveats',p=>p.caveats=[]],
 ['unbounded runtime',p=>p.elapsed_ms=600000],
 ['source-change fault hidden',p=>p.fault='correct-source-analysis-before-review'],
 ['clean report falsely marked failed',p=>p.qa_status='fail'],
 ['clean report holds fake error',p=>p.qa_error='some error'],
 ['missing source controls',p=>delete o(p).controls],
 ['missing auth controls',p=>delete o(p).owner_isolation],
 ['remove changed-game source',p=>delete o(p).after_pgn_change],
 ['remove final report evidence',p=>delete o(p).after_new_report],
 ['other user can analyze',p=>o(p).owner_isolation.foreign_analysis_status=200],
 ['anonymous can analyze',p=>o(p).owner_isolation.anonymous_analysis_status=200],
 ['other user can review POST',p=>o(p).owner_isolation.foreign_review_post_status=200],
 ['anonymous review POST allowed',p=>o(p).owner_isolation.anonymous_review_post_status=200],
 ['other user can view cached report',p=>o(p).owner_isolation.foreign_cached_get_status=200],
 ['initial cache was not hit',p=>controls(p).original.analysis.body.cached=false],
 ['correct game never cached',p=>controls(p).new_source.analysis.body.cached=false],
 ['initial analysis request failed',p=>controls(p).original.analysis.status=500],
 ['new positive control wrong status',p=>controls(p).new_source.analysis.status=500],
 ['old four moves disguised as seven',p=>controls(p).original.analysis.body.analysis.moves.push(
  {...controls(p).original.analysis.body.analysis.moves[0],ply:5})],
 ['original PGN move SAN tampered',p=>controls(p).original.analysis.body.analysis.moves[2].san='Qh5'],
 ['old analysis move UCI tampered',p=>controls(p).original.analysis.body.analysis.moves[2].uci='d1h5'],
 ['old analysis position tampered',p=>controls(p).original.analysis.body.analysis.moves[2].fen_before='fake'],
 ['new control PGN move order tampered',p=>controls(p).new_source.analysis.body.analysis.moves[2].san='g4'],
 ['new control UCI mismatched',p=>controls(p).new_source.analysis.body.analysis.moves[6].uci='d1f3'],
 ['new control final FEN wrong',p=>controls(p).new_source.analysis.body.analysis.moves[6].fen_after='fake'],
 ['missing original model done',p=>controls(p).original.report.done_count=0],
 ['missing new model done',p=>controls(p).new_source.report.done_count=0],
 ['original model error hidden',p=>controls(p).original.report.error_count=1],
 ['new model error hidden',p=>controls(p).new_source.report.error_count=1],
 ['missing original SSE events',p=>controls(p).original.report.events=[]],
 ['original SSE bytes missing',p=>delete controls(p).original.report.raw_sse],
 ['original SSE source hash forged',p=>controls(p).original.report.raw_sse_sha256='f'.repeat(64)],
 ['old SSE bytes silently edited',p=>controls(p).original.report.raw_sse=controls(p).original.report.raw_sse.replace('done','fake')],
 ['new SSE bytes missing',p=>delete controls(p).new_source.report.raw_sse],
 ['new SSE digest replaced',p=>controls(p).new_source.report.raw_sse_sha256='f'.repeat(64)],
 ['new SSE event name changed',p=>controls(p).new_source.report.events.at(-1).type='error'],
 ['new SSE review does not match payload',p=>controls(p).new_source.report.review.summary='fabricated'],
 ['old control moment SAN altered',p=>controls(p).original.report.review.key_moments[0].san='Qh5'],
 ['new control moment SAN altered',p=>controls(p).new_source.report.review.key_moments[0].san='g4'],
 ['old control moment board altered',p=>controls(p).original.report.review.key_moments[0].fen_before='wrong'],
 ['new control moment ply altered',p=>controls(p).new_source.report.review.key_moments[0].ply=3],
 ['old/new control summary deceptively identical',p=>controls(p).new_source.report.review.summary=controls(p).original.report.review.summary],
 ['game detail new PGN replaced with old',p=>change(p).game_detail.game_pgn=p.original_pgn],
 ['game detail status masked',p=>change(p).game_detail.status=500],
 ['game detail analysis rewritten new moves',p=>change(p).game_detail.stored_analysis_moves_json=JSON.stringify(controls(p).new_source.analysis.body.analysis.moves)],
 ['cached analysis falsely not cached',p=>change(p).cached_analysis_reply.body.cached=false],
 ['cached analysis failure status',p=>change(p).cached_analysis_reply.status=409],
 ['cached analysis given new source moves',p=>change(p).cached_analysis_reply.body.analysis=controls(p).new_source.analysis.body.analysis],
 ['old PGN hash swapped',p=>change(p).prior_pgn_sha256='f'.repeat(64)],
 ['new PGN hash swapped',p=>change(p).current_pgn_sha256='f'.repeat(64)],
 ['analysis row no longer original',p=>change(p).cached_analysis_row_before_review.moves_json=JSON.stringify(controls(p).new_source.analysis.body.analysis.moves)],
 ['analysis scoring version altered',p=>change(p).cached_analysis_row_before_review.scoring_version=12],
 ['analysis depth altered',p=>change(p).cached_analysis_row_before_review.depth=22],
 ['analysis row already contains prose',p=>change(p).cached_analysis_row_before_review.prose_json='{"old":true}'],
 ['new review errored',p=>after(p).sse.error_count=1],
 ['new review did not finish SSE',p=>after(p).sse.done_count=0],
 ['new review status not HTTP 200',p=>after(p).sse.status=409],
 ['new review done event faked',p=>after(p).sse.events.at(-1).type='error'],
 ['source-conflicted SSE bytes replaced',p=>after(p).sse.raw_sse='event: done\ndata: {"review":{}}\n\n'],
 ['source-conflicted SSE bytes omitted',p=>delete after(p).sse.raw_sse],
 ['source-conflicted SSE digest forged',p=>after(p).sse.raw_sse_sha256='f'.repeat(64)],
 ['new review SSE falsely points to new analysis',p=>after(p).sse.review=controls(p).new_source.report.review],
 ['new review summary falsely fixed',p=>after(p).sse.review.summary='Correctly processed the new chess game'],
 ['new review copied from old with bad ply',p=>after(p).sse.review.key_moments[0].ply=6],
 ['new review copies wrong legal SAN',p=>after(p).sse.review.key_moments[0].san='Qh5'],
 ['new review copied wrong FEN',p=>after(p).sse.review.key_moments[0].fen_before='fake'],
 ['cached GET not 200',p=>after(p).authenticated_cached_get.status=404],
 ['cached GET gives no review',p=>after(p).authenticated_cached_get.body={review:null,stale:true}],
 ['cache JSON not written',p=>after(p).final_database_row.prose_json=null],
 ['cache row changed game analysis',p=>after(p).final_database_row.moves_json=JSON.stringify(controls(p).new_source.analysis.body.analysis.moves)],
 ['cache row has changed language',p=>after(p).final_database_row.prose_lang='ru'],
 ['cache row has changed audience',p=>after(p).final_database_row.prose_audience='advanced'],
 ['cache row scored with wrong model',p=>after(p).final_database_row.scoring_version=8],
 ['new report moment evidence omitted',p=>after(p).reported_review_source_moments=[]],
 ['new report incorrectly claims no old moment',p=>after(p).report_contains_old_move_g4=false],
 ['new report incorrectly claims new third move',p=>after(p).report_contains_current_new_ply3=true],
 ['fabricate a safe mismatch rejection',p=>{
  after(p).sse.done_count=0;after(p).sse.error_count=1;
  after(p).authenticated_cached_get.body={review:null};
  after(p).report_contains_old_move_g4=false;
 }],
];
const faults=[
 ['not identified as corrected source',p=>p.fault=null],
 ['fault incorrectly marked passing',p=>p.qa_status='pass'],
 ['fault missing expected negative assertion',p=>p.qa_error='unrelated'],
 ['fault no correction evidence',p=>delete o(p).corrected_before_post],
 ['fault falsely still has old moves',p=>o(p).corrected_before_post.real_corrected_analysis_move_count=4],
 ['fault corrected cache not from current PGN',p=>o(p).corrected_before_post.fresh_cached_analysis.analysis.moves=controls(p).original.analysis.body.analysis.moves],
 ['fault report still contains old moment',p=>after(p).report_contains_old_move_g4=true],
 ['fault report not cached',p=>after(p).final_database_row.prose_json=null],
 ['fault report has wrong moment SAN',p=>after(p).sse.review.key_moments[0].san='g4'],
 ['fault report old summary used',p=>after(p).sse.review.summary=controls(p).original.report.review.summary],
 ['fault analysis not updated',p=>after(p).final_database_row.moves_json=change(p).cached_analysis_row_before_review.moves_json],
 ['fault claims release approval',p=>p.product_release_approved=true],
];
let rejectedClean=0,rejectedFault=0;
for(const [name,mutate] of cases){
 const packet=structuredClone(clean);mutate(packet);
 assert.throws(()=>verifyAdmissionSourceEvidence(packet),undefined,
  'forged genuine source-admission packet accepted: '+name);
 rejectedClean++;
}
for(const [name,mutate] of faults){
 const packet=structuredClone(fault);mutate(packet);
 assert.throws(()=>verifyAdmissionSourceEvidence(packet,{kind:'fault'}),undefined,
  'forged corrected-source counterfactual accepted: '+name);
 rejectedFault++;
}
console.log(JSON.stringify({independent_real_Hono_clean_proof_green:true,
 independent_corrected_source_control_green:true,
 forged_real_route_packets_rejected:rejectedClean,
 forged_counterfactual_packets_rejected:rejectedFault,
 total_forged_evidence_rejected:rejectedClean+rejectedFault,
 product_release_approved:false}));
