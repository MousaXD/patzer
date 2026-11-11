#!/usr/bin/env node
/** Independently replays source SAN and FIDE *first* automatic end, without
 * importing Agent D's claim adapter. Uses a frozen source/gold inventory and
 * SHA-sealed per-case results to prevent aggregate-preserving false greens. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Chess} from 'chess.js';
import {verifyCoachProvenanceEvidence} from './review-benchmark-coach-provenance-proof.mjs';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const results=join(qa,'results');
const sha=data=>createHash('sha256').update(data).digest('hex');
const fileSHA=p=>sha(readFileSync(p));
const jsonSHA=obj=>sha(JSON.stringify(obj));
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const manifestSHA='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
const expectedInputsSHA='227409f9a69b1a27a46d13eb4430bd5473d8cc1daef5827dfb5e6fa4dccd057c';
const expectedOutcomesSHA='694972fff4db41381b7442e775cc485a1d92142b29eeefadde19c6245da51368';
const expectedSourcesSHA='c890e854d7df167a0d311232948ee859df7bf85f127ec9bf5838baa786706b6c';
const manifestFile=join(qa,'manifests/manifest-v2.jsonl');
assert.equal(fileSHA(manifestFile),manifestSHA);
const fixture=readFileSync(manifestFile,'utf8').trim().split('\n').map(JSON.parse)
 .find(r=>r.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.license==='self-authored'&&fixture.source_kind==='synthetic');
assert.equal(fileSHA(join(qa,'fixtures',fixture.pgn_file)),fixture.pgn_sha256);

// Hand-checked chronological chess gold, including the exact first terminal
// ply even when later moves end in checkmate. "null" = not automatically
// ended from source history. A legal terminal at the LAST ply is permitted.
const goldSource=[
 ['fools-mate','mate',4,'checkmate',4],
 ['mate-from-fen','mate',0,'checkmate',0],
 ['threefold-then-mate','mate',12,'checkmate',12],
 ['fourfold-then-mate','mate',16,'checkmate',16],
 ['threefold-then-quiet','unfinished',null,null,9],
 ['fourfold-then-quiet','unfinished',null,null,13],
 ['fivefold-exact','draw',16,'fivefold_repetition',16],
 ['fivefold-unknown-result','draw',16,'fivefold_repetition',16],
 ['fivefold-plus-quiet','invalid',16,'fivefold_repetition',17],
 ['fivefold-plus-two','invalid',16,'fivefold_repetition',18],
 ['fivefold-then-mate','invalid',16,'fivefold_repetition',20],
 ['sixfold-then-mate','invalid',16,'fivefold_repetition',24],
 ['seventy-five-exact','draw',150,'seventy_five_move_rule',150],
 ['seventy-five-unknown-result','draw',150,'seventy_five_move_rule',150],
 ['seventy-five-plus-one','invalid',150,'seventy_five_move_rule',151],
 ['seventy-five-plus-two','invalid',150,'seventy_five_move_rule',152],
 ['dead-initial-exact','draw',0,'dead_position',0],
 ['dead-initial-plus-one','invalid',0,'dead_position',1],
 ['dead-capture-exact','draw',1,'dead_position',1],
 ['dead-capture-plus-one','invalid',1,'dead_position',2],
 ['stalemate-exact','draw',1,'stalemate',1],
 ['stalemate-initial-exact','draw',0,'stalemate',0],
];
const gold=new Map(goldSource.map(([name,type,ply,kind,moves])=>
 [name,{type,ply,kind,moves}]));
assert.equal(gold.size,22);

function firstTerminalWithSAN(pgn){
 // Distinct implementation from tested adapter: walk source SAN in a single
 // mutable Chess, record each completed position, and apply the ordering
 // checkmate > forced static draw > fivefold > 150 reversible halfmoves.
 const decoded=new Chess();decoded.loadPgn(pgn,{strict:true});
 const srcMoves=decoded.history({verbose:true});
 const firstFen=decoded.header().SetUp==='1'&&decoded.header().FEN?
  decoded.header().FEN:new Chess().fen();
 const play=new Chess(firstFen);
 const visits=new Map();let streak=0,first=null,max=0;
 for(let ply=0;ply<=srcMoves.length;ply++){
  if(ply){
   const expected=srcMoves[ply-1];
   const played=play.move(expected.san);
   assert.equal(played.san,expected.san,'independent SAN replay drift');
   assert.equal(play.fen(),expected.after,'independent source after-position drift');
   streak=played.piece==='p'||played.captured?0:streak+1;
  }
  // None of these bounded chronology fixtures has castling or EP ambiguity
  // on a repeated position. Separate checkpoint 28 tests cover that case.
  const positionKey=play.fen().split(' ').slice(0,4).join(' ');
  const repeat=(visits.get(positionKey)||0)+1;
  visits.set(positionKey,repeat);max=Math.max(max,repeat);
  const kind=play.isCheckmate()?'checkmate':
   play.isStalemate()?'stalemate':
   play.isInsufficientMaterial()?'dead_position':
   repeat>=5?'fivefold_repetition':
   streak>=150?'seventy_five_move_rule':null;
  if(kind&&!first)first={ply,kind};
 }
 return {first,moves:srcMoves.length,checkmate:play.isCheckmate(),
  maximumRepetitions:max,sourceHalfmovesSinceLastReset:streak};
}

export function verifyGameEndChronology(packet){
 assert.equal(packet.schema_version,1);
 assert(uuid.test(packet.run_id||''),'missing fresh source proof UUID');
 assert.equal(packet.prior_checkpoint,'1c9b07a334b1d9deda86473569f97e8d824ce66e');
 assert.equal(packet.pinned_candidate_b,'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87');
 assert.equal(packet.fixture_id,fixture.fixture_id);
 assert.equal(packet.manifest_sha256,manifestSHA);
 assert.equal(packet.chronology_contract,
  'first automatic terminal game position must be last recorded source position');
 assert.equal(packet.original_synthetic_PGNs,true);
 assert.equal(packet.real_model_calls,0);
 assert.equal(packet.stockfish_calls,0);
 assert.equal(packet.full_factuality_certified,false);
 assert.equal(packet.release_approved,false);
 assert.equal(packet.source_count,22);
 assert.equal(packet.case_count,88);
 assert(Array.isArray(packet.cases)&&packet.cases.length===88);
 assert.equal(new Set(packet.cases.map(r=>r.name)).size,88);
 const inputs=packet.cases.map(r=>
  [r.name,r.source,r.source_sha256,r.claim,r.summary,r.user_color]);
 const outcomes=packet.cases.map(r=>
  [r.name,r.observed_status,r.issue,r.findings,r.verified,r.unassessed]);
 assert.equal(jsonSHA(inputs),expectedInputsSHA,'synthetic test inputs have changed');
 assert.equal(jsonSHA(outcomes),expectedOutcomesSHA,
  'individual per-case verdict changed, perhaps while preserving aggregate totals');
 const sources=[...new Map(packet.cases.map(r=>[r.source,r.source_sha256])).entries()]
  .sort((a,b)=>a[0].localeCompare(b[0]));
 assert.equal(jsonSHA(sources),expectedSourcesSHA,'different PGNs supplied for the 22 fixed sources');
 const count={},perSource=new Map();
 for(const row of packet.cases){
  assert.equal(row.expected_status,row.observed_status,row.name);
  assert(row.name.startsWith(row.source+' / '));
  assert.equal(row.source_sha256,sha(row.source_pgn),'PGN digest does not match raw source');
  assert.equal(row.full_factuality_certified,false);
  assert(['white','black'].includes(row.user_color));
  assert(['white-winner','black-winner','black-perspective','no-claim'].includes(row.claim));
  assert(['White won the game.','Black won the game.','You won the game.',''].includes(row.summary));
  assert(Array.isArray(row.findings)&&Array.isArray(row.verified)&&Array.isArray(row.unassessed));
  assert(gold.has(row.source),'unexpected source in supposedly frozen legal fixture set');
  const goldInfo=gold.get(row.source);
  assert.equal(row.source_type,goldInfo.type);
  if(!perSource.has(row.source)){
   perSource.set(row.source,{sha:row.source_sha256,
    replay:firstTerminalWithSAN(row.source_pgn)});
  }else assert.equal(perSource.get(row.source).sha,row.source_sha256);
  const observed=perSource.get(row.source).replay;
  assert.equal(row.plies,observed.moves);
  assert.equal(observed.moves,goldInfo.moves,
   'source SAN length differs from independent hand-adjudicated gold');
  assert.deepEqual(observed.first,goldInfo.ply===null?null:
   {ply:goldInfo.ply,kind:goldInfo.kind},
   'first automatic game end differs from independent chronological gold');
  if(goldInfo.type==='invalid'){
   assert(observed.first&&observed.first.ply<observed.moves,
    'forged invalid source actually ended on final recorded move');
   assert.equal(row.observed_status,'invalid_input');
   assert.deepEqual(row.issue,{
    reason:'source_continues_after_automatic_game_end',
    first_ending_ply:goldInfo.ply,
    ending_kind:goldInfo.kind,later_moves:goldInfo.moves-goldInfo.ply});
   assert.equal(row.expected_first_ending_ply,goldInfo.ply);
   assert.equal(row.expected_first_ending_kind,goldInfo.kind);
   assert.equal(row.expected_later_moves,goldInfo.moves-goldInfo.ply);
   assert.deepEqual(row.findings,['source_continues_after_automatic_game_end']);
   assert.deepEqual(row.verified,[]);
   assert.deepEqual(row.unassessed,[]);
  }else{
   assert(!observed.first||observed.first.ply===observed.moves,
    'valid source has SAN after first automatic game end');
   assert.equal(row.issue,null);
   assert.equal(row.expected_first_ending_ply,null);
   assert.equal(row.expected_first_ending_kind,null);
   assert.equal(row.expected_later_moves,null);
   if(goldInfo.type==='mate'){
    assert(observed.checkmate,'mate not in legal last or initial position');
    const expected=row.claim==='white-winner'?'rejected':
     row.claim==='no-claim'?'not_evaluated':'limited_claims_passed';
    assert.equal(row.observed_status,expected);
    if(row.claim==='white-winner')assert(row.findings.includes('contradicted_game_winner'));
    if(expected==='limited_claims_passed')assert.deepEqual(row.verified,['game_result']);
   }else if(goldInfo.type==='draw'){
    assert(!observed.checkmate);
    const expected=row.claim==='no-claim'?'not_evaluated':'rejected';
    assert.equal(row.observed_status,expected);
    if(expected==='rejected')assert(row.findings.includes('contradicted_terminal_draw_winner'));
   }else{
    assert.equal(goldInfo.type,'unfinished');
    assert.equal(row.observed_status,'not_evaluated');
    assert(!observed.checkmate&&!observed.first);
    assert(row.unassessed.includes('nonterminal_result_not_independently_verified'));
   }
  }
  count[row.observed_status]=(count[row.observed_status]||0)+1;
 }
 assert.equal(perSource.size,22);
 assert.deepEqual(count,{rejected:28,limited_claims_passed:8,
  not_evaluated:20,invalid_input:32});
 assert.deepEqual(packet.counts,count);
 return {synthetic_source_games:22,claim_cases:88,
  independently_hand_adjudicated_sources:gold.size,
  post_terminal_source_claims_blocked:32,
  legal_games_correctly_rejected_for_false_result:28,
  legal_limited_winner_proofs:8,
  honest_unassessed_cases:20,
  source_inputs_sha256:expectedInputsSHA,
  individual_outcomes_sha256:expectedOutcomesSHA,
  source_identity_sha256:expectedSourcesSHA,
  production_engine_certified:false,full_factuality_certified:false,
  release_approved:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const raw=JSON.parse(readFileSync(join(results,'game-end-chronology-matrix.json'),'utf8'));
 const checked=verifyGameEndChronology(raw);
 const real=JSON.parse(readFileSync(join(results,'real-coach-faults.json'),'utf8'));
 assert.equal(verifyCoachProvenanceEvidence(real).real_pipeline_false_winner_in_output,true);
 const scripts=[
  'scripts/review-benchmark-coach-claim-adapter.mjs',
  'scripts/review-benchmark-result-evidence-matrix.mjs',
  'scripts/review-benchmark-result-evidence-proof.mjs',
  'scripts/review-benchmark-game-end-chronology-matrix.mjs',
  'scripts/review-benchmark-game-end-chronology-proof.mjs',
  'scripts/review-benchmark-game-end-chronology-negatives.mjs',
  'scripts/review-benchmark-game-end-chronology-boundary.mjs',
 ];
 const report={schema_version:1,at_utc:new Date().toISOString(),
  assigned_branch:'agent/review-benchmark-20261111',
  prior_checkpoint_sha:'1c9b07a334b1d9deda86473569f97e8d824ce66e',
  current_checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  frozen_candidate_b:'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87',
  fresh_source_run_id:raw.run_id,
  prior_real_coach_evidence_run_id:real.benchmark_run_id,
  independent_chronology_evidence:checked,
  script_sha256:Object.fromEntries(scripts.map(s=>[s,fileSHA(join(root,s))])),
  corrected_older_legal_dead_position_fixture:true,
  older_checkpoint27_synthetic_insufficient_source_evidence_superseded:true,
  real_model_calls:0,stockfish_calls:0,no_real_private_PGNs:true,
  other_agent_source_edits:0,release_approved:false,integration_approved:false,
  limitations:['Only 22 self-authored synthetic sources; eight intentionally invalid continued games',
   'Automatic game end follows source chess.js board oracle plus independently counted repetitions/halfmoves',
   'This does not prove full retrograde reachability, arbiters, draw claims, or complete coaching prose',
   'The older checkpoint27 bare-kings continuation was corrected and its evidence digests updated',
   'No product source, migrations, live service, user games, real LLM, or deployed Stockfish modified']};
 const path=join(qa,'certification-summary-checkpoint30.json');
 writeFileSync(path,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:path,...checked},null,2));
}
