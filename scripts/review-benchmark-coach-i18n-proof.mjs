#!/usr/bin/env node
/**
 * Independent compiler for a finite five-language hostile real-review probe.
 * No access to other agents' source or external model. This module intentionally
 * does NOT certify general natural-language factuality or released behavior.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {Chess} from 'chess.js';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence');
const results=join(qa,'results');
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const candidate='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const engine='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const expectedPhrases={
 en:['White won the game.',"White's king is on e2."],
 es:['Las blancas ganaron la partida.','El rey blanco está en e2.'],
 de:['Weiß hat die Partie gewonnen.','Der weiße König steht auf e2.'],
 bg:['Белите спечелиха партията.','Белият цар е на e2.'],
 ru:['Белые выиграли партию.','Белый король стоит на e2.']
};
export function validateI18nEvidence(report) {
 assert.equal(report.candidate_sha,candidate,'the report is not from tested frozen candidate');
 assert.equal(report.engine_sha256,engine,'Stockfish executable identity mismatch');
 assert.equal(report.manifest_sha256,sha(join(qa,'manifests/manifest-v2.jsonl')),'manifest changed');
 assert.equal(report.fixture_id,'SYN-GAME-FOOLS-MATE','unapproved fixture');
 assert.equal(report.requests,30,'not all real LLM transport calls were exercised');
 assert.equal(report.product_factuality_certified,false);
 assert.equal(report.release_approved,false);
 const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const meta=manifest.find(x=>x.fixture_id===report.fixture_id);
 assert.equal(meta.source_kind,'synthetic');
 assert.equal(meta.license,'self-authored');
 const pgnPath=join(qa,'fixtures',meta.pgn_file);
 assert.equal(sha(pgnPath),meta.pgn_sha256);
 const game=new Chess();game.loadPgn(readFileSync(pgnPath,'utf8'),{strict:true});
 assert.equal(game.header().Result,'0-1','not an independently proven Black win');
 assert(game.isCheckmate() && game.turn()==='w','must be replay-verified Black checkmate');
 assert.equal(game.get('e1')?.type,'k');
 assert.equal(game.get('e1')?.color,'w');
 assert.notEqual(game.get('e2')?.type,'k');
 const languages=Object.keys(expectedPhrases);
 assert.deepEqual([...report.languages_tested].sort(),[...languages].sort());
 assert.equal(report.per_language.length,languages.length,'not every language reached real review pipeline');
 const unique=new Set();
 for(const row of report.per_language){
  assert(languages.includes(row.lang),'unexpected language '+row.lang);
  assert(!unique.has(row.lang),'duplicated language');
  unique.add(row.lang);
  const [summary,prose]=expectedPhrases[row.lang];
  assert.equal(row.generated_summary,summary,'actual consumer did not return the injected winner');
  assert.equal(row.generated_moment,prose,'actual consumer did not return the injected king-square assertion');
  assert.deepEqual(row.source_truth,{winner:'black',white_king_square:'e1'});
  assert.deepEqual(row.test_only_assertions,{winner:'white',white_king_square:'e2'});
  assert.equal(row.true_summary_accepted,true,'benign winner phrase falsely blocked');
  assert.equal(row.true_king_square_accepted,true,'benign king-square falsely blocked');
  assert.equal(row.false_winner_accepted,true,'this snapshot did not reproduce the frozen winner escape');
  assert.equal(row.false_king_square_accepted,true,'this snapshot did not reproduce the frozen square escape');
  assert.equal(row.consumer_factuality_certified,false);
 }
 assert.equal(report.observed_false_winner_escapes,5);
 assert.equal(report.observed_false_square_escapes,5);
 return {languages_proved:languages.length,winner_escapes:5,king_square_escapes:5,model_requests:30,certified:false};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const observed=JSON.parse(readFileSync(join(results,'coach-i18n-real-pipeline.json'),'utf8'));
 const counts=validateI18nEvidence(observed);
 const report={
  schema_version:1,at_utc:new Date().toISOString(),
  agent_d_parent_sha:'4f45aa25306de22f628f97d31105b058a175a941',
  benchmark_git_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  candidate_sha:candidate,verified_engine_sha256:engine,
  manifest_v2_sha256:observed.manifest_sha256,
  fixture_id:observed.fixture_id,
  source_kind:'self-authored synthetic',
  text_source:'10 QA-authored, deliberately false short sentences injected through a local mock LLM',
  positive_control_claims:10,corruptions_accepted_by_real_review:10,
  counts,
  evidence:observed.per_language.map(x=>({language:x.lang,
   false_winner_prose:x.generated_summary,
   false_king_prose:x.generated_moment,
   winner_escape:x.false_winner_accepted,
   king_square_escape:x.false_king_square_accepted
  })),
  source_hashes:{
   runner:sha(join(root,'scripts/review-benchmark-coach-i18n-faults.mjs'))
  },
  result:{candidate_factuality_certified:false,scoped_qa_attack_reproduced:true,
   release_approved:false,integration_approved:false},
  limitations:[
   'Only 10 deliberately injected sentences over five supported languages, not measured LLM error rate',
   'Manually written sample translations; no independent native-speaker/human adjudication or sealed holdout',
   'The independent gold is board/winner truth plus the explicit test-phrase meaning; no general language understanding',
   'Candidate code was not modified; owner/integrator must decide remediation and cache invalidation',
   'No coach pedagogical helpfulness or translated content robustness beyond these controlled claims'
  ]
 };
 const output=join(qa,'certification-summary-checkpoint8.json');
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({out:output,...counts,release_approved:false},null,2));
}
