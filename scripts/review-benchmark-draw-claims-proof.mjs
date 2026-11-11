#!/usr/bin/env node
/** Agent D independent FIDE-9 draw-claim verdict proof. Does NOT import the
 * tested finite English claim adapter or its draw classification helpers.
 * This proves only the bounded synthetic legal PGNs and expected abstention. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Chess} from 'chess.js';
import {verifyCoachProvenanceEvidence} from './review-benchmark-coach-provenance-proof.mjs';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const results=join(qa,'results');
const sha=v=>createHash('sha256').update(v).digest('hex');
const fileSha=file=>sha(readFileSync(file));
const dataSha=obj=>sha(JSON.stringify(obj));
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const manifestSha='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
const fixedInputs='695afe1cfd54a2914154aaecc4c9c52da99b913073b69c1f41f69499381ad641';
const fixedOutcomes='a5b9e163693e98cc0eca4217ee2e92ff6220f04d5d6c91fe658cdf6c8bb1e5de';
const fixedSourceList='1538a53b72af487c0137e18a2721fdb99232a38494ae77c4abbe3532a68b4dc8';
const manifestFile=join(qa,'manifests/manifest-v2.jsonl');
assert.equal(fileSha(manifestFile),manifestSha);
const fixture=readFileSync(manifestFile,'utf8').trim().split('\n').map(JSON.parse)
 .find(f=>f.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.source_kind==='synthetic'&&fixture.license==='self-authored');
assert.equal(fileSha(join(qa,'fixtures',fixture.pgn_file)),fixture.pgn_sha256);
const goldSources={
 'repetition-2':[4,2,4,false,false,'1-0'],
 'repetition-3':[8,3,8,false,true,'1-0'],
 'repetition-4':[12,4,12,false,true,'1-0'],
 'repetition-5':[16,5,16,true,false,'1-0'],
 'repetition-5-draw':[16,5,16,true,false,'1/2-1/2'],
 'repetition-5-unknown':[16,5,16,true,false,'*'],
 'halfmove-99':[1,1,1,false,false,'1-0'],
 'halfmove-100':[1,1,1,false,true,'1-0'],
 'halfmove-149':[1,1,1,false,true,'1-0'],
 'halfmove-150-unproven':[1,1,1,false,true,'1-0'],
 'halfmove-151-unproven':[1,1,1,false,true,'1-0'],
 'full-99':[99,2,99,false,false,'1-0'],
 'full-100':[100,2,100,false,true,'1-0'],
 'full-149':[149,2,149,false,true,'1-0'],
 'full-150':[150,2,150,true,false,'1-0'],
 'full-150-draw':[150,2,150,true,false,'1/2-1/2'],
 'full-150-unknown':[150,2,150,true,false,'*'],
};
const goldCases=[
 ['repetition-3 / white winner','not_evaluated','claimable_draw_not_automatic_without_recorded_claim'],
 ['repetition-4 / black winner','not_evaluated','claimable_draw_not_automatic_without_recorded_claim'],
 ['repetition-5 / white winner','rejected','contradicted_terminal_draw_winner'],
 ['repetition-5 / no statement','rejected','pgn_result_conflicts_with_terminal_draw'],
 ['repetition-5-draw / no statement','not_evaluated',null],
 ['repetition-5-unknown / black winner','rejected','contradicted_terminal_draw_winner'],
 ['halfmove-99 / white winner','not_evaluated',null],
 ['halfmove-100 / white winner','not_evaluated','claimable_draw_not_automatic_without_recorded_claim'],
 ['halfmove-149 / black winner','not_evaluated','claimable_draw_not_automatic_without_recorded_claim'],
 ['halfmove-150-unproven / white winner','not_evaluated','claimable_draw_not_automatic_without_recorded_claim'],
 ['halfmove-151-unproven / no statement','not_evaluated','claimable_draw_not_automatic_without_recorded_claim'],
 ['full-99 / white winner','not_evaluated',null],
 ['full-100 / white winner','not_evaluated','claimable_draw_not_automatic_without_recorded_claim'],
 ['full-149 / black winner','not_evaluated','claimable_draw_not_automatic_without_recorded_claim'],
 ['full-150 / white winner','rejected','contradicted_terminal_draw_winner'],
 ['full-150 / no statement','rejected','pgn_result_conflicts_with_terminal_draw'],
 ['full-150-draw / no statement','not_evaluated',null],
 ['full-150-unknown / user black won','rejected','contradicted_terminal_draw_winner'],
];

export function verifyDrawClaimEvidence(packet){
 assert.equal(packet.schema_version,1);
 assert(uuid.test(packet.run_id||''),'missing bounded fresh QA run identifier');
 assert.equal(packet.previous_checkpoint,'cde9b81030bf64367953b865f78bd251a2461571');
 assert.equal(packet.manifest_sha256,manifestSha);
 assert.equal(packet.fixture_id,fixture.fixture_id);
 assert.equal(packet.candidate_b_source,'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87');
 assert.equal(packet.rules_reference,
  'FIDE Laws of Chess 2023 Arts 9.2-9.3 claimable, 9.6 fivefold/75 automatic');
 assert.equal(packet.source_kind,'self-authored synthetic legal chess, no real player');
 assert.equal(packet.stockfish_calls,0);
 assert.equal(packet.external_model_calls,0);
 assert.equal(packet.long_reversible_game_plies,150);
 assert(packet.long_game_max_repetition<5);
 assert.equal(packet.release_approved,false);
 assert.equal(packet.full_factuality_certified,false);
 assert.equal(packet.source_game_count,17);
 assert.equal(packet.case_count,85);
 assert(Array.isArray(packet.cases)&&packet.cases.length===85);
 assert.equal(new Set(packet.cases.map(x=>x.name)).size,85);
 const inputs=packet.cases.map(r=>[r.name,r.source,r.source_sha256,r.summary,r.user_color]);
 const outcomes=packet.cases.map(r=>[r.name,r.verdict_observed,r.findings,r.unassessed,
  r.automatic_draw_from_replay,r.claimable_only,r.automatic_fivefold,
  r.automatic_seventy_five,r.source_reversible_halfmoves,r.board_proven_draw]);
 assert.equal(dataSha(inputs),fixedInputs,'recorded 85 synthetic cases/input identities changed');
 assert.equal(dataSha(outcomes),fixedOutcomes,'individual verdict changed while totals could stay constant');
 const groupedSources=[...new Map(packet.cases.map(r=>[r.source,r.source_sha256])).entries()]
  .sort((a,b)=>a[0].localeCompare(b[0]));
 assert.equal(dataSha(groupedSources),fixedSourceList,
  'independent source PGN variants were swapped');
 const sourceSet=new Map(),counts={},byName=new Map();
 for(const row of packet.cases){
  assert.equal(row.verdict_expected,row.verdict_observed,row.name);
  assert.equal(row.full_factuality_certified,false);
  assert.equal(row.board_proven_draw,false,'these scenarios do not include stalemate/dead boards');
  assert(['white','black'].includes(row.user_color));
  assert(typeof row.summary==='string');
  assert(Array.isArray(row.findings)&&Array.isArray(row.unassessed));
  assert.equal(row.source_sha256,sha(row.source_pgn),row.name);
  const pg=new Chess();pg.loadPgn(row.source_pgn,{strict:true});
  assert.equal(pg.header().Result,row.game_result_header);
  assert.equal(pg.history().length,row.source_plies);
  assert.equal(pg.isDraw(),row.library_draw);
  assert.equal(pg.isThreefoldRepetition(),row.library_threefold);
  assert.equal(pg.isDrawByFiftyMoves(),row.library_fifty);
  assert(!pg.isCheckmate()&&!pg.isStalemate()&&!pg.isInsufficientMaterial());
  const annotated=pg.history({verbose:true});
  const positions=[annotated[0].before,...annotated.map(m=>m.after)];
  const occurrence=new Map();let max=0;
  for(const fen of positions){
   const k=fen.split(' ').slice(0,4).join(' ');
   const n=(occurrence.get(k)||0)+1;occurrence.set(k,n);max=Math.max(max,n);
  }
  assert.equal(max,row.source_repetitions);
  const streak=annotated.reduce((n,m)=>m.piece==='p'||m.captured?0:n+1,0);
  assert.equal(streak,row.source_reversible_halfmoves);
  const sourceGold=goldSources[row.source];
  assert(sourceGold,'missing trusted gold source '+row.source);
  assert.deepEqual([row.source_plies,row.source_repetitions,row.source_reversible_halfmoves,
   row.automatic_draw_from_replay,row.claimable_only,row.game_result_header],sourceGold,
   row.name+' contradicted independent, finite chess-law adjudication');
  assert.equal(row.automatic_fivefold,max>=5);
  assert.equal(row.automatic_seventy_five,streak>=150);
  const shouldAuto=max>=5||streak>=150;
  assert.equal(row.automatic_draw_from_replay,shouldAuto);
  const isDecisive=['1-0','0-1'].includes(row.game_result_header);
  const shouldReject=shouldAuto&&(row.summary.length>0||isDecisive);
  assert.equal(row.verdict_observed,shouldReject?'rejected':'not_evaluated',row.name);
  if(shouldAuto){
   if(row.summary)assert(row.findings.includes('contradicted_terminal_draw_winner'));
   if(isDecisive)assert(row.findings.includes('pgn_result_conflicts_with_terminal_draw'));
   assert.equal(row.claimable_only,false);
  }else{
   assert.deepEqual(row.findings,[]);
   if(row.summary)assert(row.unassessed.includes('winner_not_independently_proven_from_nonterminal_pgn'));
   if(row.claimable_only)assert(row.unassessed.includes('claimable_draw_not_automatic_without_recorded_claim'));
  }
  if(row.source.startsWith('halfmove-')){
   assert.equal(row.source_plies,1);
   assert.equal(row.source_reversible_halfmoves,1,
    'imported FEN move clock incorrectly treated as full 75-move history');
  }
  byName.set(row.name,row);
  counts[row.verdict_observed]=(counts[row.verdict_observed]||0)+1;
  if(!sourceSet.has(row.source))sourceSet.set(row.source,row.source_sha256);
  else assert.equal(sourceSet.get(row.source),row.source_sha256);
 }
 assert.equal(sourceSet.size,17);
 assert.deepEqual(counts,{not_evaluated:59,rejected:26});
 assert.deepEqual(packet.counts,counts);
 for(const [name,status,reason] of goldCases){
  const row=byName.get(name);
  assert(row,'separate gold name missing '+name);
  assert.equal(row.verdict_observed,status,name);
  if(reason)assert([...row.findings,...row.unassessed].includes(reason),name+' missing '+reason);
 }
 return {legal_source_games:17,scope_cases:85,separately_named_gold_controls:goldCases.length,
  claimable_or_unverified_cases_abstained:59,
  automatic_draw_claims_or_metadata_conflicts_rejected:26,
  longest_independently_replayed_halfmove_streak:150,
  independent_inputs_sha256:fixedInputs,
  independent_outputs_sha256:fixedOutcomes,
  independent_source_list_sha256:fixedSourceList,
  product_certified:false,release_approved:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const packet=JSON.parse(readFileSync(join(results,'coach-draw-claims-matrix.json'),'utf8'));
 const scoped=verifyDrawClaimEvidence(packet);
 const real=JSON.parse(readFileSync(join(results,'real-coach-faults.json'),'utf8'));
 assert.equal(verifyCoachProvenanceEvidence(real).real_pipeline_false_winner_in_output,true);
 const files=[
  'scripts/review-benchmark-coach-claim-adapter.mjs',
  'scripts/review-benchmark-draw-claims-matrix.mjs',
  'scripts/review-benchmark-draw-claims-proof.mjs',
  'scripts/review-benchmark-draw-claims-negatives.mjs',
  'scripts/review-benchmark-draw-claims-boundary.mjs',
 ];
 const report={schema_version:1,at_utc:new Date().toISOString(),
  own_branch:'agent/review-benchmark-20261111',
  preceding_head:'cde9b81030bf64367953b865f78bd251a2461571',
  candidate_b_sha:'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87',
  checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  recorded_test_run_id:packet.run_id,
  prior_real_coach_run_id:real.benchmark_run_id,
  independently_verified_scoped_evidence:scoped,
  source_sha256:Object.fromEntries(files.map(f=>[f,fileSha(join(root,f))])),
  no_model_calls:true,no_stockfish_jobs:true,synthetic_QA_only:true,
  product_coach_factuality_certified:false,integration_approved:false,release_approved:false,
  remaining_limits:['FIDE source rules 2023 Art 9.2/9.3/9.6, not independently adjudicated event claims',
   '50-move/threefold claims require recorded external claim or adjudication evidence',
   'FEN halfmove counter is not independent evidence of 150 fully played halfmoves',
   'The lexical factuality checker remains English-only and finite, not a semantic model',
   'No human-labeled sealed holdout, hosted LLM, production DB or real users',
   'This changes only Agent D QA, not backend sources or PR #17']};
 const destination=join(qa,'certification-summary-checkpoint28.json');
 writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:destination,...scoped},null,2));
}
