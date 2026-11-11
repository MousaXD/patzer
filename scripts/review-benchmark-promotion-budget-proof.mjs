#!/usr/bin/env node
/** Separate source-inventory oracle. Does not import Agent D's tested claim
 * adapter or its FEN checks. Three frozen SHA commitments bind all source
 * games, all individual inputs and all verdicts (not just totals). */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Chess} from 'chess.js';
import {verifyCoachProvenanceEvidence} from './review-benchmark-coach-provenance-proof.mjs';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const results=join(qa,'results');
const sha=s=>createHash('sha256').update(s).digest('hex');
const shaFile=p=>sha(readFileSync(p));
const shaJson=o=>sha(JSON.stringify(o));
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const manifestSHA='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
const fixedInputs='b3fb98bcdd97f6813aa42cf19b57f9915d1e23adcdf1e9bc7ac8ec1d791f59b2';
const fixedOutcomes='710f33666f833b2ef45ac79bd92c2db44b20ffe33e59ac682ed25bbcce072a3d';
const fixedSources='f4f7b9131352cddc24ef450e21755bbe451a8d9e9b2a2fe981065e8151a5aa0c';
const manifestFile=join(qa,'manifests/manifest-v2.jsonl');
assert.equal(shaFile(manifestFile),manifestSHA);
const fixture=readFileSync(manifestFile,'utf8').trim().split('\n').map(JSON.parse)
 .find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.license==='self-authored'&&fixture.source_kind==='synthetic');
assert.equal(shaFile(join(qa,'fixtures',fixture.pgn_file)),fixture.pgn_sha256);

// Hand-adjudicated finite source fixtures: [name, pawn count, minimum
// independent promotions needed, is source historically impossible by this
// invariant]. Keep this gold inventory independent of the matrix builder.
const gold=[
 ['white-8p-three-rooks',8,1,true],
 ['white-7p-four-rooks',7,2,true],
 ['white-8p-two-queens',8,1,true],
 ['white-7p-three-queens',7,2,true],
 ['white-8p-three-knights',8,1,true],
 ['white-8p-two-same-color-bishops',8,1,true],
 ['white-7p-three-same-color-bishops',7,2,true],
 ['white-8p-three-mixed-color-bishops',8,1,true],
 ['white-7p-two-queens-three-rooks',7,2,true],
 ['white-6p-three-queens-three-rooks',6,3,true],
 ['black-8p-three-rooks',8,1,true],
 ['black-8p-two-queens',8,1,true],
 ['black-8p-three-knights',8,1,true],
 ['black-8p-two-same-color-bishops',8,1,true],
 ['black-7p-three-same-color-bishops',7,2,true],
 ['black-7p-two-queens-three-rooks',7,2,true],
 ['black-6p-three-queens-three-rooks',6,3,true],
 ['white-7p-three-rooks',7,1,false],
 ['white-6p-four-rooks',6,2,false],
 ['white-7p-two-queens',7,1,false],
 ['white-6p-three-queens',6,2,false],
 ['white-7p-three-knights',7,1,false],
 ['white-7p-two-same-color-bishops',7,1,false],
 ['white-6p-three-same-color-bishops',6,2,false],
 ['white-8p-two-opposite-color-bishops',8,0,false],
 ['white-7p-three-mixed-color-bishops',7,1,false],
 ['white-6p-two-queens-three-rooks',6,2,false],
 ['white-5p-three-queens-three-rooks',5,3,false],
 ['black-7p-three-rooks',7,1,false],
 ['black-7p-two-queens',7,1,false],
 ['black-7p-three-knights',7,1,false],
 ['black-7p-two-same-color-bishops',7,1,false],
 ['black-6p-three-same-color-bishops',6,2,false],
 ['black-6p-two-queens-three-rooks',6,2,false],
 ['black-5p-three-queens-three-rooks',5,3,false],
 ['white-0p-three-queens',0,2,false],
];
const bySource=new Map(gold.map(([name,pawns,promotions,invalid])=>
 [name,{pawns,promotions,invalid}]));
assert.equal(bySource.size,36);

function independentNeededPromotions(game,color){
 // Independent of claim adapter: enumerate square-colored bishops from raw
 // board rows. Even a pair of bishops on one color needs a promoted bishop
 // since a native bishop can never change square color.
 const amounts={p:0,q:0,r:0,n:0,b:0,one:0,other:0};
 const squares=game.board();
 for(let row=0;row<8;row++)for(let col=0;col<8;col++){
  const piece=squares[row][col];
  if(piece?.color!==color)continue;
  if(piece.type in amounts)amounts[piece.type]++;
  if(piece.type==='b')amounts[(row+col)&1?'one':'other']++;
 }
 const required=Math.max(0,amounts.q-1)+Math.max(0,amounts.r-2)+
  Math.max(0,amounts.n-2)+Math.max(0,amounts.one-1)+
  Math.max(0,amounts.other-1);
 return {pawns:amounts.p,required};
}

export function verifyPromotionBudgetEvidence(packet){
 assert.equal(packet.schema_version,1);
 assert(uuid.test(packet.run_id||''),'no fresh QA source run identity');
 assert.equal(packet.previous_checkpoint,'f88519629491f709030caf9f595666e431e457af');
 assert.equal(packet.pinned_agent_b,'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87');
 assert.equal(packet.original_fixture,fixture.fixture_id);
 assert.equal(packet.manifest_sha256,manifestSHA);
 assert.equal(packet.provenance,'self-authored synthetic standard-chess FEN inventory only');
 assert.equal(packet.no_retrograde_certification,true);
 assert.equal(packet.real_model_requests,0);
 assert.equal(packet.stockfish_calls,0);
 assert.equal(packet.release_approved,false);
 assert.equal(packet.full_factuality_certified,false);
 assert.equal(packet.source_games,36);
 assert.equal(packet.case_count,108);
 assert(Array.isArray(packet.cases)&&packet.cases.length===108);
 assert.equal(new Set(packet.cases.map(r=>r.name)).size,108);
 const inputs=packet.cases.map(r=>
  [r.name,r.source,r.source_sha256,r.pawn_count,r.source_side,r.source_pieces,r.claim,r.summary]);
 const outcomes=packet.cases.map(r=>
  [r.name,r.observed_status,r.findings,r.verified,r.unassessed]);
 assert.equal(shaJson(inputs),fixedInputs,'source input substitution detected');
 assert.equal(shaJson(outcomes),fixedOutcomes,'individual claim verdict substitution detected');
 const sourceList=[...new Map(packet.cases.map(r=>[r.source,r.source_sha256])).entries()]
  .sort((a,b)=>a[0].localeCompare(b[0]));
 assert.equal(shaJson(sourceList),fixedSources,'36 source game identities changed');
 const seen=new Map(),counts={};
 for(const row of packet.cases){
  assert(row.name.startsWith(row.source+' / '));
  assert.equal(sha(row.source_pgn),row.source_sha256);
  assert.equal(row.full_factuality_certified,false);
  assert(row.baseline_strict_pgn_loaded===true);
  assert(['white-winner','black-winner','no-claim'].includes(row.claim));
  assert(['White won the game.','Black won the game.',''].includes(row.summary));
  assert.equal(row.source_side,row.source.startsWith('white-')?'w':'b');
  const g=new Chess();g.loadPgn(row.source_pgn,{strict:true});
  assert.equal(g.history().length,0);
  assert.equal(g.header().SetUp,'1');
  assert.equal(g.header().FEN,row.initial_fen);
  assert.equal(g.fen(),row.initial_fen);
  assert(!g.isStalemate()&&!g.isCheckmate()&&!g.isInsufficientMaterial());
  const goldRecord=bySource.get(row.source);
  assert(goldRecord,'unknown synthetic source treated as certified');
  const source=independentNeededPromotions(g,row.source_side);
  assert.equal(source.pawns,goldRecord.pawns,row.source);
  assert.equal(row.pawn_count,source.pawns,row.source);
  assert.equal(source.required,goldRecord.promotions,row.source);
  assert.equal(source.required>8-source.pawns,goldRecord.invalid,row.source);
  const expected=goldRecord.invalid?'invalid_input':'not_evaluated';
  assert.equal(row.source_expectation,goldRecord.invalid?'invalid':'valid');
  assert.equal(row.expected_status,expected);
  assert.equal(row.observed_status,expected);
  assert(Array.isArray(row.findings)&&Array.isArray(row.verified)&&Array.isArray(row.unassessed));
  if(goldRecord.invalid){
   assert.deepEqual(row.findings,[{reason:'source_start_position_impossible',
    detail:'missing_pawn_promotion_budget'}]);
   assert.deepEqual(row.verified,[]);
  }else{
   assert.deepEqual(row.findings,[]);
   assert.deepEqual(row.verified,[]);
   assert(row.unassessed.includes('nonterminal_result_not_independently_verified'));
  }
  if(seen.has(row.source))assert.equal(seen.get(row.source),row.source_sha256);
  else seen.set(row.source,row.source_sha256);
  counts[row.observed_status]=(counts[row.observed_status]||0)+1;
 }
 assert.equal(seen.size,36);
 assert.deepEqual(counts,{invalid_input:51,not_evaluated:57});
 assert.deepEqual(packet.counts,counts);
 return {independent_synthetic_source_cases:36,
  independently_adjudicated_verdicts:108,
  impossible_piece_inventories_blocked:51,
  insufficient_evidence_abstentions:57,
  independently_enumerated_source_gold:gold.length,
  input_sha256:fixedInputs,outcome_sha256:fixedOutcomes,
  source_sha256:fixedSources,
  full_retrograde_certified:false,
  product_coach_certified:false,release_approved:false};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const packet=JSON.parse(readFileSync(join(results,'coach-promotion-budget-matrix.json'),'utf8'));
 const checked=verifyPromotionBudgetEvidence(packet);
 const real=JSON.parse(readFileSync(join(results,'real-coach-faults.json'),'utf8'));
 assert.equal(verifyCoachProvenanceEvidence(real).real_pipeline_false_king_location_in_output,true);
 const files=[
  'scripts/review-benchmark-coach-claim-adapter.mjs',
  'scripts/review-benchmark-promotion-budget-matrix.mjs',
  'scripts/review-benchmark-promotion-budget-proof.mjs',
  'scripts/review-benchmark-promotion-budget-negatives.mjs',
  'scripts/review-benchmark-promotion-budget-boundary.mjs',
 ];
 const report={schema_version:1,created_at:new Date().toISOString(),
  prior_head:'f88519629491f709030caf9f595666e431e457af',
  branch:'agent/review-benchmark-20261111',
  checkout_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  pinned_candidate_b:'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87',
  new_run_id:packet.run_id,prior_real_coach_run_id:real.benchmark_run_id,
  independent_scoped_result:checked,
  source_sha256:Object.fromEntries(files.map(f=>[f,shaFile(join(root,f))])),
  no_real_users_or_db:true,external_model_calls:0,stockfish_calls:0,
  no_product_files_mutated:true,release_approved:false,integration_approved:false,
  limitations:['Necessary promotion inventory only, not full retrograde chess proof',
   'Positive FEN cases mean not contradicted by this test, not historically reachable',
   'Bishops are color-bound, but castling and EP history require additional independent evidence',
   'Synthetic custom FEN inventory and explicit English result assertions only',
   'No real customers, live LLM, sealed human holdout, production DB or changes to other agents']};
 const out=join(qa,'certification-summary-checkpoint31.json');
 writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:out,...checked},null,2));
}
