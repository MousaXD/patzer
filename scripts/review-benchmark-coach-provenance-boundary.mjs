#!/usr/bin/env node
/** Fresh, SHA-bound real B consumer test. Deliberate false local LLM replies
 * survive B's writer; D must detect both. A passing test is a product BLOCK.
 */
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {verifyCoachProvenanceEvidence} from './review-benchmark-coach-provenance-proof.mjs';

const root=resolve(import.meta.dirname,'..');
const results=join(root,'qa/review-excellence/results');
const args=Object.fromEntries(process.argv.slice(2).map(x=>{
 const i=x.indexOf('=');return i<0?[x.slice(2),true]:[x.slice(2,i),x.slice(i+1)];
}));
const candidate=realpathSync(args['app-root']||join(results,'worktree-coach'));
const engine=realpathSync(args.engine||join(results,'engine/unpacked/usr/games/stockfish'));
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:candidate,encoding:'utf8'}).trim(),
 '19c359ec3feb8e3c10c33415c403eaf5ab3d6c87');
assert.equal(createHash('sha256').update(readFileSync(engine)).digest('hex'),
 '00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca');
const runId=randomUUID();
const cmd=['--import','tsx','scripts/review-benchmark-real-coach-faults.mjs',
 '--app-root='+candidate,'--engine='+engine,
 '--engine-sha256=00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca',
 '--run-id='+runId];
const executed=spawnSync(process.execPath,cmd,{cwd:root,encoding:'utf8',
 timeout:25000,maxBuffer:2*1024*1024});
assert.ifError(executed.error);
assert.equal(executed.status,0,
 'genuine coach adversarial test failed before confirming actual model-output escapes: '+
 executed.stdout.slice(-800)+' stderr: '+executed.stderr.slice(-700));
let stdout;
try{stdout=JSON.parse(executed.stdout);}catch{
 throw Error('real coach runner did not produce parseable JSON: '+executed.stdout.slice(-400));
}
assert.equal(stdout.benchmark_run_id,runId,
 'real-coach stdout was not produced for this distinct run');
const raw=JSON.parse(readFileSync(join(results,'real-coach-faults.json'),'utf8'));
assert.equal(raw.benchmark_run_id,runId,
 'a previous local test packet was substituted for this real B execution');
assert.equal(stdout.source,raw.candidate_sha);
assert.equal(stdout.request_count,raw.requests);
assert.deepEqual(stdout.accepted_false_claims,raw.accepted_false_claims);
const checked=verifyCoachProvenanceEvidence(raw);
assert.equal(checked.real_pipeline_false_winner_in_output,true);
assert.equal(checked.real_pipeline_false_king_location_in_output,true);
assert.equal(checked.fabricated_legal_other_game_board_rejected,true);
assert.equal(checked.false_before_move_assertion_rejected,true);
console.log(JSON.stringify({fresh_run_id:runId,
 real_build_game_review_and_transport_executed:true,
 synthetic_fake_model_requests:raw.requests,
 controlled_wrong_winner_reached_product:true,
 controlled_wrong_king_square_reached_product:true,
 source_bound_independent_checker_rejected_both:true,
 earlier_QA_legal_board_false_green_closed:true,
 release_approved:false,candidate_factuality_certified:false},null,2));
