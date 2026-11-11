#!/usr/bin/env node
/** Agent D: measured *abstention*, partial coverage and explicit claim
 * rejection on recorded synthetic multilingual coach outputs.
 * Source game and expected meanings are hand-authored finite gold. We do NOT
 * translate or claim natural-language truth outside these exact phrases.
 */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Chess} from 'chess.js';
import {validateWrittenGameReview} from './review-benchmark-coach-claim-adapter.mjs';
import {validateI18nEvidence} from './review-benchmark-coach-i18n-proof.mjs';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence'),results=join(qa,'results');
mkdirSync(results,{recursive:true});
const sha=v=>createHash('sha256').update(v).digest('hex');
const manifestFile=join(qa,'manifests/manifest-v2.jsonl');
const manifest=readFileSync(manifestFile,'utf8');
assert.equal(sha(manifest),'2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44');
const fixture=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.source_kind==='synthetic'&&fixture.license==='self-authored');
const pgn=readFileSync(join(qa,'fixtures',fixture.pgn_file),'utf8');
assert.equal(sha(pgn),fixture.pgn_sha256);
const chess=new Chess();chess.loadPgn(pgn,{strict:true});
assert(chess.isCheckmate()&&chess.turn()==='w'&&chess.header().Result==='0-1');
const moves=chess.history({verbose:true});
const scene={ply:3,side:'white',san:'g4',fen_before:moves[2].before};
assert.equal(moves[2].san,'g4');
assert.equal(new Chess(moves[2].before).get('e1')?.type,'k');
const i18nFile=join(results,'coach-i18n-real-pipeline.json');
const i18n=JSON.parse(readFileSync(i18nFile,'utf8'));
assert.deepEqual(validateI18nEvidence(i18n),{
 languages_proved:5,winner_escapes:5,king_square_escapes:5,model_requests:30,certified:false});
const goldLanguages=['en','es','de','bg','ru'];
assert.deepEqual(i18n.per_language.map(x=>x.lang),goldLanguages);
const flags=Object.fromEntries(process.argv.slice(2).map(x=>{
 const p=x.indexOf('=');return p<0?[x.slice(2),true]:[x.slice(2,p),x.slice(p+1)];
}));
assert(Object.keys(flags).every(k=>k==='run-id'),
 'unsupported QA matrix arguments');
const runId=flags['run-id']||randomUUID();
assert(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(runId));
const cases=[];
const allowed=['rejected','limited_claims_passed','partial_claims_verified','not_evaluated'];
function review(summary,moment,lang='en',userColor='white'){
 return {language:lang,summary,skill_assessment:'',opening:null,
  phases:{opening:null,middlegame:null,endgame:null},
  key_moments:[{...scene,prose:moment}],
  userColor};
}
function trial(name,{summary='Black won the game.',moment="White's king is on e1.",
 lang='en',userColor='white',want,required=[],forbidden=[],minimumVerified=0}){
 const claim=review(summary,moment,lang,userColor);
 const outcome=validateWrittenGameReview({pgn,review:claim,userColor});
 assert(allowed.includes(outcome.status));
 assert.equal(outcome.status,want,name+': unexpected claim scope '+JSON.stringify(outcome));
 const reasons=outcome.findings.map(x=>x.reason);
 const uncertain=outcome.unassessed.map(x=>x.reason);
 for(const code of required){
  assert([...reasons,...uncertain].includes(code),name+': expected '+code);
 }
 for(const code of forbidden){
  assert(![...reasons,...uncertain].includes(code),name+': must not claim '+code);
 }
 assert(outcome.verified.length>=minimumVerified,name+': expected real verified claims');
 assert.equal(outcome.full_factuality_certified,false);
 cases.push({name,language:lang,user_color:userColor,expected_status:want,
  observed_status:outcome.status,verified_claims:outcome.verified.length,
  findings:reasons,unassessed:uncertain,
  full_factuality_certified:false});
}

// Isolated English literal assertions. These provide the strict baseline:
// a clean exact sentence is limited-verified, never entire-report certified.
for(const [name,summary,moment,status,required] of [
 ['direct true winner','Black won the game.','', 'limited_claims_passed',[]],
 ['direct false winner','White won the game.','', 'rejected',['contradicted_game_winner']],
 ['direct true king','',"White's king is on e1.",'limited_claims_passed',[]],
 ['direct false king','',"White's king is on e2.",'rejected',['contradicted_piece_location']],
 ['direct true you lost','You lost the game.','', 'limited_claims_passed',[]],
 ['direct false you won','You won this game.','', 'rejected',['contradicted_game_winner']],
 ['direct true opponent won','Your opponent won the game.','','limited_claims_passed',[]],
 ['direct false opponent lost','Your opponent lost the game.','','rejected',['contradicted_game_winner']],
])trial(name,{summary,moment,want:status,required});
trial('perspective changed black you won',{summary:'You won the game.',moment:'',userColor:'black',
 want:'limited_claims_passed',minimumVerified:1});
trial('perspective changed black opponent won',{summary:'Your opponent won the game.',moment:'',userColor:'black',
 want:'rejected',required:['contradicted_game_winner']});

// Known false positives: a true literal in one span DOES NOT verify an
// unsupported false implicit winner/piece or general coaching text elsewhere.
for(const [name,suffix] of [
 ['unrecognized white monarch','The white monarch sits on e2.'],
 ['unrecognized white side victor','The white side was victorious.'],
 ['unrecognized first player victor','The side playing first was victorious.'],
 ['unrecognized checkmating color','The light-colored player delivered checkmate.'],
 ['unrecognized pedagogical conclusion','Your opening shows a 2900 Elo rating.'],
 ['unrecognized temporal reinterpretation','Before 2.g4, the white monarch sat on e2.'],
 ['unrecognized board tactics','The queen can be captured on d1 without cost.'],
])trial('mixed true winner + '+name,{summary:'Black won the game. '+suffix,moment:'',
 want:'partial_claims_verified',required:['unchecked_prose_remainder'],minimumVerified:1});
trial('unsupported false implicit only',{summary:'The side playing first was victorious.',moment:'',
 want:'not_evaluated',required:['unchecked_prose_remainder','no_recognized_checkable_claims']});
trial('unsupported king synonym only',{summary:'',moment:'The white monarch sits on e2.',
 want:'not_evaluated',required:['unchecked_prose_remainder','no_recognized_checkable_claims']});
trial('recognized king plus unrecognized king synonym',{summary:'',
 moment:"White's king is on e1. The white monarch sits on e2.",
 want:'partial_claims_verified',required:['unchecked_prose_remainder'],minimumVerified:1});
trial('true verdict but unsupported skill and board claims',{summary:'Black won the game.',
 moment:"White's king is on e1. The rook could win every pawn at once.",
 want:'partial_claims_verified',required:['unchecked_prose_remainder'],minimumVerified:2});

// Explicit meta-linguistic contexts are NOT direct claims of the game result
// or piece location. Refuse to incorrectly accuse truthful disavowals.
for(const [name,summary] of [
 ['false that statement','It is false that White won the game. Black won the game.'],
 ['wrong that statement','It was wrong that White won the game. Black won the game.'],
 ['do not say','Do not say White won the game. Black won the game.'],
 ['do not claim that','Do not claim that White won the game. Black won the game.'],
 ['never claim','Never claim White won the game. Black won the game.'],
 ['it would be incorrect','It would be incorrect to say White won the game. Black won the game.'],
 ['curly quote in warning','Do not write “White won the game.” Black won the game.'],
 ['straight quote in warning','Do not write "White won the game." Black won the game.'],
 ['reported quote','The false quote is “White won the game.” Black won the game.'],
])trial('meta-language '+name,{summary,moment:'',want:'partial_claims_verified',
 required:['quoted_or_disavowed_result_not_assessed','unchecked_prose_remainder'],
 forbidden:['contradicted_game_winner'],minimumVerified:1});
trial('quoted false sentence only',{summary:'“White won the game.”',moment:'',
 want:'not_evaluated',required:['quoted_or_disavowed_result_not_assessed']});
trial('literal false sentence still rejected',{summary:'White won the game.',moment:'',
 want:'rejected',required:['contradicted_game_winner']});
trial('context warning does not shield later direct false sentence',{
 summary:'It is false that White won the game. White won the game.',moment:'',
 want:'rejected',required:['contradicted_game_winner','quoted_or_disavowed_result_not_assessed']});
for(const [name,moment] of [
 ['negated king lie',"It is false that White's king is on e2. White's king is on e1."],
 ['quoted king lie',"Do not claim “White's king is on e2.” White's king is on e1."],
])trial(name,{summary:'',moment,want:'partial_claims_verified',
 required:['quoted_or_disavowed_piece_not_assessed'],
 forbidden:['contradicted_piece_location'],minimumVerified:1});
trial('direct false king despite earlier true quote',{summary:'',
 moment:"Do not claim “White's king is on e2.” White's king is on e2.",
 want:'rejected',required:['quoted_or_disavowed_piece_not_assessed','contradicted_piece_location']});

// Unicode-before-match regression: JavaScript regex offsets are UTF-16
// code units, not Unicode code points. A preceding emoji must not make the
// checker miss an unsupported trailing prose span.
for(const [name,summary,status] of [
 ['emoji direct true','♟️ Black won the game.','limited_claims_passed'],
 ['emoji direct false','♟️ White won the game.','rejected'],
 ['astral + unsupported claim','🧠 Black won the game. The white monarch sits on e2.','partial_claims_verified'],
 ['double astral + unsupported claim','🎯🏆 Black won the game. The light side was victorious.','partial_claims_verified'],
 ['astral + disavowal','💡 It is false that White won the game. Black won the game.','partial_claims_verified'],
])trial(name,{summary,moment:'',want:status,
 required:status==='rejected'?['contradicted_game_winner']:
  status==='partial_claims_verified'?['unchecked_prose_remainder']:[]});

// Source-gated multilingual test: earlier REAL Agent B candidate produced
// ten QA-injected false literal outputs in five locales. The *independent*
// checker currently supports ENGLISH only. No non-English text is silently
// promoted to verified, regardless of embedding English tokens inside it.
for(const row of i18n.per_language){
 const unknown=row.lang!=='en';
 trial('recorded model false winner '+row.lang,{summary:row.generated_summary,moment:'',lang:row.lang,
  want:unknown?'not_evaluated':'rejected',
  required:unknown?['language_not_supported_by_independent_checker']:['contradicted_game_winner']});
 trial('recorded model false king '+row.lang,{summary:'',moment:row.generated_moment,lang:row.lang,
  want:unknown?'not_evaluated':'rejected',
  required:unknown?['language_not_supported_by_independent_checker']:['contradicted_piece_location']});
 if(unknown){
  trial('same locale with English true statement '+row.lang,{summary:
   row.generated_summary+' Black won the game.',moment:row.generated_moment,lang:row.lang,
   want:'not_evaluated',required:['language_not_supported_by_independent_checker']});
  trial('language flag English but foreign claim '+row.lang,{summary:'Black won the game. '+row.generated_summary,
   moment:row.generated_moment,lang:'en',want:'partial_claims_verified',
   required:['unchecked_prose_remainder'],minimumVerified:1});
 }
}
const counts={};for(const row of cases)counts[row.observed_status]=(counts[row.observed_status]||0)+1;
const report={schema_version:1,at_utc:new Date().toISOString(),run_id:runId,
 previous_agent_d_head:'b8d50abc528a9b61ac243dfc4f351cfcc43a88bd',
 candidate_b_sha:'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87',
 manifest_sha256:sha(manifest),fixture_id:fixture.fixture_id,
 i18n_source_sha256:sha(readFileSync(i18nFile)),
 source_chess_result:'0-1',source_white_king_square:'e1',
 sample_count:cases.length,counts,cases,
 source_kind:'self-authored synthetic and previously pinned loopback-model literal phrases',
 independent_checked_languages:['en'],non_english_abstention_languages:['es','de','bg','ru'],
 full_factuality_certified:false,release_approved:false,
 limits:['Only literal claims from approved QA source; no independent native-speaker adjudication',
  'The recorded five-language source is a previous bounded real-review probe, not new model calls',
  'Unrecognized prose and quotation/negation context are NOT proven true or false',
  'No real deployment model, real user game, private data or sealed independent holdout']};
const out=join(results,'coach-scope-matrix.json');
writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output:out,run_id:runId,total:cases.length,counts,
 five_locales_observed:true,unknown_prose_reported:true,
 false_meta_rejections_prevented:true,real_product_certified:false},null,2));
