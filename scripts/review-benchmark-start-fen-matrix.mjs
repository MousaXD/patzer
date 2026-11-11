#!/usr/bin/env node
/** Independent QA source-trust challenge: syntactically parsable PGN/FEN may
 * still be incompatible with necessary standard-chess reachability rules.
 * All source positions are synthetic and privately hand-authored. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Chess} from 'chess.js';
import {validateWrittenGameReview} from './review-benchmark-coach-claim-adapter.mjs';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const results=join(qa,'results');mkdirSync(results,{recursive:true});
const options=Object.fromEntries(process.argv.slice(2).map(x=>{
 const at=x.indexOf('=');return at<0?[x.slice(2),true]:[x.slice(2,at),x.slice(at+1)];
}));
assert(Object.keys(options).every(x=>x==='run-id'),'unexpected benchmark argument');
const id=options['run-id']||randomUUID();
assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
const sha=data=>createHash('sha256').update(data).digest('hex');
const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8');
assert.equal(sha(manifest),'2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44');
const fixture=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.license==='self-authored'&&fixture.source_kind==='synthetic');
assert.equal(sha(readFileSync(join(qa,'fixtures',fixture.pgn_file))),fixture.pgn_sha256);

const t=(name,fen,kind,expectedIssue,moves='*')=>({name,fen,kind,expectedIssue,moves});
const cases=[
 // All of these PGNs are accepted by chess.js loadPgn(strict), but the
 // initial snapshot can never arise after legal standard-chess moves.
 t('invalid-adjacent-kings-white','8/8/8/8/8/8/4k3/4K3 w - - 0 1','invalid','king_of_side_not_to_move_in_check'),
 t('invalid-adjacent-kings-black','8/8/8/8/8/8/4k3/4K3 b - - 0 1','invalid','king_of_side_not_to_move_in_check'),
 t('invalid-checked-nonmoving-black','4k3/8/8/8/8/8/4R3/4K3 w - - 0 1','invalid','king_of_side_not_to_move_in_check'),
 t('invalid-checked-nonmoving-white','4k3/8/8/8/8/8/4r3/4K3 b - - 0 1','invalid','king_of_side_not_to_move_in_check'),
 t('invalid-both-kings-attacked','4k3/4R3/8/8/8/8/4r3/4K3 w - - 0 1','invalid','king_of_side_not_to_move_in_check'),
 t('invalid-checked-nonmoving-black-with-move','4k3/8/8/8/8/8/4R3/4K3 w - - 0 1','invalid','king_of_side_not_to_move_in_check','1. Re3+ *'),
 t('invalid-white-kingside-rook-missing','4k3/8/8/8/8/8/8/4K3 w K - 0 1','invalid','castling_rights_without_home_king_and_rook'),
 t('invalid-white-queenside-rook-missing','4k3/8/8/8/8/8/8/4K3 w Q - 0 1','invalid','castling_rights_without_home_king_and_rook'),
 t('invalid-black-kingside-rook-missing','4k3/8/8/8/8/8/8/4K3 b k - 0 1','invalid','castling_rights_without_home_king_and_rook'),
 t('invalid-black-queenside-rook-missing','4k3/8/8/8/8/8/8/4K3 b q - 0 1','invalid','castling_rights_without_home_king_and_rook'),
 t('invalid-moved-white-king-with-K-right','4k3/8/8/8/8/8/8/5K1R w K - 0 1','invalid','castling_rights_without_home_king_and_rook'),
 t('invalid-moved-black-king-with-k-right','5k1r/8/8/8/8/8/8/4K3 b k - 0 1','invalid','castling_rights_without_home_king_and_rook'),
 t('invalid-nine-white-pawns','4k3/8/8/8/8/P7/PPPPPPPP/4K3 w - - 0 1','invalid','more_than_eight_pawns_per_side'),
 t('invalid-nine-black-pawns','4k3/pppppppp/p7/8/8/8/8/4K3 w - - 0 1','invalid','more_than_eight_pawns_per_side'),
 t('invalid-seventeen-white-units','4k3/8/8/8/NNNNNNNN/NNNNNNNN/8/4K3 w - - 0 1','invalid','more_than_sixteen_pieces_per_side'),
 t('invalid-seventeen-black-units','4k3/nnnnnnnn/nnnnnnnn/8/8/8/8/4K3 w - - 0 1','invalid','more_than_sixteen_pieces_per_side'),
 t('invalid-en-passant-no-black-pawn','4k3/8/8/8/8/8/8/4K3 w - d6 0 1','invalid','en_passant_target_without_previous_double_pawn_push'),
 t('invalid-en-passant-no-white-pawn','4k3/8/8/8/8/8/8/4K3 b - e3 0 1','invalid','en_passant_target_without_previous_double_pawn_push'),
 t('invalid-en-passant-source-not-empty','4k3/3p4/8/3p4/8/8/8/4K3 w - d6 0 1','invalid','en_passant_target_without_previous_double_pawn_push'),
 t('invalid-en-passant-target-occupied','4k3/8/3N4/3p4/8/8/8/4K3 w - d6 0 1','invalid','en_passant_target_without_previous_double_pawn_push'),
 // The source checks must not reject legal FENs merely because the side to
 // move is in check, castling is blocked NOW, or EP cannot be captured.
 t('valid-standard-opening',null,'valid',null,'1. e4 e5 *'),
 t('valid-standard-start',null,'valid',null,'*'),
 t('valid-white-in-check','4k3/8/8/8/8/8/4r3/4K3 w - - 0 1','valid',null),
 t('valid-black-in-check','4k3/4R3/8/8/8/8/8/4K3 b - - 0 1','valid',null),
 t('valid-uncapturable-en-passant','4k1n1/8/8/3p4/8/8/4P3/4K1N1 w - d6 0 1','valid',null),
 t('valid-capturable-en-passant','4k1n1/8/8/3pP3/8/8/8/4K1N1 w - d6 0 1','valid',null),
 t('valid-pinned-en-passant','4r1nk/8/8/3pP3/8/8/8/4K1N1 w - d6 0 1','valid',null),
 t('valid-both-sides-castling','r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1','valid',null),
 t('valid-blocked-castling','r3k2r/8/8/8/8/8/8/RN2K2R w KQkq - 0 1','valid',null),
 t('valid-white-eight-pawns','4k3/8/8/8/8/8/PPPPPPPP/4K3 w - - 0 1','valid',null),
 t('valid-black-eight-pawns','4k3/pppppppp/8/8/8/8/8/4K3 w - - 0 1','valid',null),
 t('valid-three-white-queens-with-missing-pawns','4k3/8/8/8/8/QQQ5/8/4K3 w - - 0 1','valid',null),
 t('valid-black-turn-no-check','4k3/8/8/8/8/8/8/R3K3 b - - 0 1','valid',null),
];
assert.equal(new Set(cases.map(c=>c.name)).size,cases.length);
const recorded=[];
for(const s of cases){
 const pgn=s.fen?`[Event "QA ${s.name}"]\n[SetUp "1"]\n[FEN "${s.fen}"]\n[Result "*"]\n\n${s.moves}`:
  `[Event "QA ${s.name}"]\n[Result "*"]\n\n${s.moves}`;
 let chess;
 try{chess=new Chess();chess.loadPgn(pgn,{strict:true});}catch(err){
  throw Error('baseline strict chess.js did not accept intended FEN: '+s.name+' '+err.message);
 }
 // A correct independent QA test shows this was a *real* gap in the prior
 // PGN reader: even the IMPOSSIBLE sources are accepted by strict loadPgn.
 const claims=[['white-winner','White won the game.'],
  ['black-winner','Black won the game.'],['no-prose','']];
 for(const [label,summary] of claims){
  const result=validateWrittenGameReview({pgn,review:{language:'en',summary,key_moments:[]}});
  const want=s.kind==='invalid'?'invalid_input':'not_evaluated';
  assert.equal(result.status,want,s.name+'/'+label+': '+JSON.stringify(result));
  assert.equal(result.full_factuality_certified,false);
  if(s.kind==='invalid'){
   assert.deepEqual(result.findings,[{reason:'source_start_position_impossible',detail:s.expectedIssue}],
    s.name+' failed to refuse a forbidden start configuration');
   assert.equal(result.verified.length,0);
  }else{
   assert.deepEqual(result.findings,[]);
   assert(result.unassessed.some(x=>x.reason==='nonterminal_result_not_independently_verified'),
    s.name+': legal source incorrectly proved a decisive outcome');
  }
  recorded.push({name:s.name+' / '+label,source_name:s.name,
   source_kind:s.kind,source_sha256:sha(pgn),source_pgn:pgn,
   original_setup_fen:s.fen,summary,baseline_strict_chessjs_accepted:true,
   old_chessjs_reported_draw:chess.isDraw(),
   expected_status:want,actual_status:result.status,
   error_reason:result.findings[0]?.reason||null,
   error_detail:result.findings[0]?.detail||null,
   unassessed:result.unassessed.map(x=>x.reason),
   verified_count:result.verified.length,
   full_factuality_certified:false});
 }
}
const totals={};for(const item of recorded)totals[item.actual_status]=(totals[item.actual_status]||0)+1;
const evidence={schema_version:1,at_utc:new Date().toISOString(),run_id:id,
  prior_checkpoint:'8175071497ae695c4d876f02079a2c16ff7187f8',
  pinned_candidate_b:'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87',
  fixture_id:fixture.fixture_id,manifest_sha256:sha(manifest),
  source_count:cases.length,invalid_source_count:cases.filter(x=>x.kind==='invalid').length,
  accepted_source_count:cases.filter(x=>x.kind==='valid').length,
  case_count:recorded.length,counts:totals,cases:recorded,
  scope:'Necessary setup legality invariants only, not general retrograde reachability certification',
  all_pgNs_self_authored:true,external_model_calls:0,stockfish_calls:0,
  product_factuality_certified:false,release_approved:false};
const outfile=join(results,'coach-start-fen-matrix.json');
writeFileSync(outfile,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({output:outfile,run_id:id,sources:cases.length,
  invalid_sources:evidence.invalid_source_count,accepted_sources:evidence.accepted_source_count,
  case_count:recorded.length,counts:totals,release_approved:false},null,2));
