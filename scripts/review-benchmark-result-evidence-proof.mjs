#!/usr/bin/env node
/** Independent evidence verifier: no import of the QA claim adapter or
 * tested product's claim lexicons. Legal PGN source truth via chess.js, an
 * independently enumerated subset of gold, and fixed per-row commitments. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Chess} from 'chess.js';
import {verifyCoachProvenanceEvidence} from './review-benchmark-coach-provenance-proof.mjs';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const results=join(qa,'results');
const shaData=x=>createHash('sha256').update(x).digest('hex');
const shaJson=x=>shaData(JSON.stringify(x));
const shaFile=path=>shaData(readFileSync(path));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const manifestSha='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
// The original bare-kings fixture illegally continued after automatic dead
// material at ply zero. This pinned revision captures White's final bishop
// on ply 1 (K+B vs K+N -> K vs K+N), first creating a dead position there.
const frozenInput='a429eac78b3b67971898c6faf6ed096aef377f7a1851448937ceacea91f59e9a';
const frozenOutput='eabb33e02a59744c02ea098a579598db9d267a546cc71a98c5637bd1ace81a7d';
const frozenSource='9a3d05fbc2e299b73afe6b0a039bf65fe80d5e09e7391b77c32dbb0edb713ffc';
const manifestFile=join(qa,'manifests/manifest-v2.jsonl');
assert.equal(shaFile(manifestFile),manifestSha);
const fixture=readFileSync(manifestFile,'utf8').trim().split('\n').map(JSON.parse)
 .find(f=>f.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.license==='self-authored'&&fixture.source_kind==='synthetic');
const fixtureFile=join(qa,'fixtures',fixture.pgn_file);
assert.equal(shaFile(fixtureFile),fixture.pgn_sha256);
const fixedPGN=new Chess();fixedPGN.loadPgn(readFileSync(fixtureFile,'utf8'),{strict:true});
assert(fixedPGN.isCheckmate()&&fixedPGN.turn()==='w'&&fixedPGN.header().Result==='0-1');

// Separately hand-adjudicated high-signal samples, distinct from the matrix
// code's expected_status field and without importing its helper functions.
const gold=[
 ['unfinished-white / white says won','not_evaluated','winner_not_independently_proven_from_nonterminal_pgn'],
 ['unfinished-white / black says won','not_evaluated','winner_not_independently_proven_from_nonterminal_pgn'],
 ['unfinished-black / black POV you won','not_evaluated','winner_not_independently_proven_from_nonterminal_pgn'],
 ['unfinished-draw / white says lost','not_evaluated','winner_not_independently_proven_from_nonterminal_pgn'],
 ['unfinished-unknown / white POV opponent lost','not_evaluated','winner_not_independently_proven_from_nonterminal_pgn'],
 ['unfinished white header / correct board, no winner','partial_claims_verified','nonterminal_result_not_independently_verified'],
 ['unfinished black header / claimed winner plus correct board','partial_claims_verified','winner_not_independently_proven_from_nonterminal_pgn'],
 ['unfinished draw header / claimed winner plus fake king','rejected','contradicted_piece_location'],
 ['unfinished unspecified / conditional imagined win','not_evaluated','hypothetical_or_conditional_result_not_assessed'],
 ['mate correct tag / black won','limited_claims_passed',null],
 ['mate correct tag / false white win','rejected','contradicted_game_winner'],
 ['mate unknown tag / black proved by board','limited_claims_passed',null],
 ['mate unknown tag / false white rejected by board','rejected','contradicted_game_winner'],
 ['mate-wrong-white / correct black win but false header','rejected','pgn_result_conflicts_with_mate'],
 ['mate-wrong-draw / no prose still mismatched metadata','rejected','pgn_result_conflicts_with_mate'],
 ['stalemate-draw / White won the game.','rejected','contradicted_terminal_draw_winner'],
 ['stalemate-draw / Black won the game.','rejected','contradicted_terminal_draw_winner'],
 ['stalemate-unknown / White won the game.','rejected','contradicted_terminal_draw_winner'],
 ['stalemate-white / White won the game.','rejected','contradicted_terminal_draw_winner'],
 ['stalemate-black / Black won the game.','rejected','contradicted_terminal_draw_winner'],
 ['insufficient-draw / White won the game.','rejected','contradicted_terminal_draw_winner'],
 ['insufficient-unknown / Black won the game.','rejected','contradicted_terminal_draw_winner'],
 ['insufficient-white / White won the game.','rejected','contradicted_terminal_draw_winner'],
 ['stalemate-white / no claim but false decisive header','rejected','pgn_result_conflicts_with_terminal_draw'],
 ['stalemate-black / no claim but false decisive header','rejected','pgn_result_conflicts_with_terminal_draw'],
 ['insufficient-white / no claim but false decisive header','rejected','pgn_result_conflicts_with_terminal_draw'],
 ['stalemate-draw / no claim, valid or unknown header','not_evaluated',null],
 ['stalemate-unknown / no claim, valid or unknown header','not_evaluated',null],
 ['insufficient-draw / no claim, valid or unknown header','not_evaluated',null],
 ['insufficient-unknown / no claim, valid or unknown header','not_evaluated',null],
 ['stalemate correct header / legal last-move queen','partial_claims_verified',null],
 ['insufficient unknown header / legal black first move','partial_claims_verified',null],
];

export function verifyResultEvidence(packet){
 assert.equal(packet.schema_version,1);
 assert(uuid.test(packet.run_id||''),'missing fresh source-run UUID');
 assert.equal(packet.parent_checkpoint,'6537ed5180fa9f5df289013d1ced29e60719d04d');
 assert.equal(packet.pinned_candidate_b,'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87');
 assert.equal(packet.fixture_id,fixture.fixture_id);
 assert.equal(packet.fixture_sha256,fixture.pgn_sha256);
 assert.equal(packet.manifest_sha256,manifestSha);
 assert.equal(packet.source_kind,
  'self-authored synthetic checkmates, nonterminal games, stalemates and insufficient-material endings');
 assert.equal(packet.source_count,15);
 assert.equal(packet.case_count,67);
 assert.equal(packet.external_model_requests,0);
 assert.equal(packet.stockfish_requests,0);
 assert.equal(packet.full_factuality_certified,false);
 assert.equal(packet.release_approved,false);
 assert(Array.isArray(packet.cases)&&packet.cases.length===67);
 assert.equal(new Set(packet.cases.map(x=>x.name)).size,67);
 const input=packet.cases.map(x=>[x.name,x.source,x.source_sha256,x.summary,x.moment,x.user_color]);
 const outcome=packet.cases.map(x=>[x.name,x.status_observed,x.verified,x.findings,
  x.unassessed,x.mate_proved,x.draw_proved]);
 assert.equal(shaJson(input),frozenInput,'hand-authored input/source variants changed');
 assert.equal(shaJson(outcome),frozenOutput,'per-case outcomes changed despite aggregate count');
 const groupedSources=[...new Map(packet.cases.map(x=>[x.source,x.source_sha256])).entries()]
  .sort((a,b)=>a[0].localeCompare(b[0]));
 assert.equal(shaJson(groupedSources),frozenSource,'source variant identity drift');
 const actualCounts={},actualSources=new Map();
 for(const row of packet.cases){
  assert.equal(row.status_expected,row.status_observed,
   'matrix self-expectation mismatch '+row.name);
  assert.equal(shaData(row.source_pgn),row.source_sha256,
   'unanchored source PGN for '+row.name);
  assert(row.source_pgn.startsWith('[Event '));
  assert(['white','black'].includes(row.user_color));
  assert(typeof row.summary==='string');
  assert(row.moment===null||typeof row.moment==='object');
  assert.equal(row.full_factuality_certified,false);
  assert(Array.isArray(row.verified)&&Array.isArray(row.findings)&&Array.isArray(row.unassessed));
  assert(['rejected','not_evaluated','limited_claims_passed','partial_claims_verified']
   .includes(row.status_observed));
  const game=new Chess();game.loadPgn(row.source_pgn,{strict:true});
  assert.equal(row.header_result,game.header().Result||null);
  assert.equal(row.source_terminal,game.isGameOver());
  assert.equal(row.source_checkmate,game.isCheckmate());
  assert.equal(row.source_draw,game.isDraw());
  assert.equal(row.draw_proved,game.isDraw());
  assert.equal(row.mate_proved,game.isCheckmate());
  if(row.moment){
   const recorded=game.history({verbose:true});
   const m=recorded[row.moment.ply-1];
   assert(m&&m.before===row.moment.fen_before&&m.san===row.moment.san,
    'moment FEN/SAN did not match recorded move');
   assert.equal(row.moment.side,m.color==='w'?'white':'black');
  }
  if(row.status_observed==='rejected')assert(row.findings.length>0);
  if(row.status_observed==='not_evaluated')assert.equal(row.verified.length,0);
  if(row.status_observed==='limited_claims_passed'){
   assert(row.verified.length>0);assert.deepEqual(row.findings,[]);
   assert.deepEqual(row.unassessed,[]);
  }
  if(row.status_observed==='partial_claims_verified'){
   assert(row.verified.length>0);assert.deepEqual(row.findings,[]);
   assert(row.unassessed.length>0);
  }
  actualCounts[row.status_observed]=(actualCounts[row.status_observed]||0)+1;
  if(!actualSources.has(row.source))actualSources.set(row.source,row.source_sha256);
  else assert.equal(actualSources.get(row.source),row.source_sha256);
  const isUnfinished=row.source.startsWith('unfinished-');
  const explicitWin=row.source.endsWith('-white')||row.source.endsWith('-black');
  if(isUnfinished){
   assert(!game.isGameOver(),'nonterminal name describes a drawn/mated board');
   assert(row.unassessed.includes('nonterminal_result_not_independently_verified'),
    'nonterminal source wrongly treated as a proven outcome');
   assert(!row.findings.includes('contradicted_game_winner'),
    'unknown resignation outcome was falsely contradicted');
  }
  if(row.source.startsWith('stalemate-')||row.source.startsWith('insufficient-')){
   assert(game.isDraw());
   assert(!row.findings.includes('nonterminal_result_not_independently_verified'));
   const mismatch=row.findings.includes('pgn_result_conflicts_with_terminal_draw');
   assert.equal(mismatch,explicitWin,
    'unspecified/valid draw metadata mischaracterized as explicit conflict');
  }
  if(row.source==='mate-unknown'){
   assert(!row.findings.includes('pgn_result_conflicts_with_mate'),
    'checkmate with unknown result mischaracterized as a result-tag lie');
  }
 }
 assert.equal(actualSources.size,15);
 assert.deepEqual(packet.counts,actualCounts);
 assert.deepEqual(actualCounts,{not_evaluated:37,partial_claims_verified:4,
  rejected:24,limited_claims_passed:2});
 const byName=new Map(packet.cases.map(x=>[x.name,x]));
 for(const [name,status,reason] of gold){
  const row=byName.get(name);
  assert(row,'independent gold sample omitted: '+name);
  assert.equal(row.status_observed,status,name);
  if(reason)assert([...row.findings,...row.unassessed].includes(reason),
   'missing independently adjudicated finding '+name+'/'+reason);
 }
 return {bounded_synthetic_games:15,claim_case_count:67,
  independently_named_gold_cases:gold.length,
  not_evaluated_cases:37,
  source_or_claim_contradictions_rejected:24,
  partially_verified_cases:4,
  directly_verified_cases:2,
  individual_input_sha256:frozenInput,
  individual_outcome_sha256:frozenOutput,
  product_coach_factuality_certified:false,release_approved:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const packet=JSON.parse(readFileSync(join(results,'coach-result-evidence-matrix.json'),'utf8'));
 const proof=verifyResultEvidence(packet);
 const earlierReal=JSON.parse(readFileSync(join(results,'real-coach-faults.json'),'utf8'));
 assert.equal(verifyCoachProvenanceEvidence(earlierReal).real_pipeline_false_winner_in_output,true);
 const ownScripts=[
  'scripts/review-benchmark-coach-claim-adapter.mjs',
  'scripts/review-benchmark-coach-claim-negative-controls.mjs',
  'scripts/review-benchmark-result-evidence-matrix.mjs',
  'scripts/review-benchmark-result-evidence-proof.mjs',
  'scripts/review-benchmark-result-evidence-negatives.mjs',
  'scripts/review-benchmark-result-evidence-boundary.mjs',
 ];
 const report={schema_version:1,at_utc:new Date().toISOString(),
  prior_checkpoint_head:'6537ed5180fa9f5df289013d1ced29e60719d04d',
  own_branch:'agent/review-benchmark-20261111',
  qa_checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  pinned_candidate_b:'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87',
  fixture_id:fixture.fixture_id,manifest_sha256:manifestSha,
  result_matrix_run_id:packet.run_id,
  prior_real_coach_run_id:earlierReal.benchmark_run_id,
  independent_result_proof:proof,
  source_sha256:Object.fromEntries(ownScripts.map(p=>[p,shaFile(join(root,p))])),
  synthetic_QA_only:true,real_model_calls_this_checkpoint:0,
  no_product_files_modified:true,release_approved:false,integration_approved:false,
  limits:['PGN-only replay cannot prove human resignation, time forfeit or agreed draw',
   'Terminal checkmate/draw board-state claims are chess.js oracles, not real game adjudications',
   'Only explicit finite English winner/owner-piece-square claims are checked',
   'No real user games, sealed human holdout, external LLM, production database or load assessment',
   'Other owner source branches and PR #17 remain untouched']};
 const outfile=join(qa,'certification-summary-checkpoint27.json');
 writeFileSync(outfile,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:outfile,...proof,release_approved:false},null,2));
}
