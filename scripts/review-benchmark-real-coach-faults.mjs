#!/usr/bin/env node
/**
 * Agent D independent real-coach consumer attack.
 *
 * Analyze an approved synthetic PGN in a fresh disposable SQLite database,
 * then run Agent B's actual buildGameReview() and llm.ts against a strictly
 * loopback-only fake vLLM endpoint. No external LLM or private game data.
 *
 * This is an adversarial diagnostic: a successful injection is a *failure*
 * of coach factuality, not a passing release gate. No Agent B code is edited.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { Chess } from 'chess.js';
import { join, resolve } from 'node:path';
import { validateWrittenGameReview } from './review-benchmark-coach-claim-adapter.mjs';

const root=resolve(import.meta.dirname,'..');
const resultsDir=join(root,'qa/review-excellence/results');
mkdirSync(resultsDir,{recursive:true});
const args=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return i<0?[x.slice(2),true]:[x.slice(2,i),x.slice(i+1)];}));
const runId=args['run-id']||randomUUID();
assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId),
 'invalid local benchmark run identifier');
const appRoot=realpathSync(args['app-root']??join(resultsDir,'worktree-coach'));
if(!appRoot.startsWith(join(resultsDir,'worktree-')+'/') && !appRoot.startsWith(join(resultsDir,'worktree-')))
 throw Error('Candidate must be a detached QA worktree');
const sha=b=>createHash('sha256').update(b).digest('hex');
const manifestPath=join(root,'qa/review-excellence/manifests/manifest-v2.jsonl');
const manifests=readFileSync(manifestPath,'utf8').trim().split('\n').map(JSON.parse);
const fixture=manifests.find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture&&fixture.source_kind==='synthetic'&&fixture.license==='self-authored');
const pgnPath=join(root,'qa/review-excellence/fixtures',fixture.pgn_file);
const pgn=readFileSync(pgnPath,'utf8');
assert.equal(sha(pgn),fixture.pgn_sha256);
const engine=realpathSync(args.engine || join(resultsDir,'engine/unpacked/usr/games/stockfish'));
const engineHash=sha(readFileSync(engine));
if(!args['engine-sha256']||!/^[0-9a-f]{64}$/.test(args['engine-sha256']))
 throw Error('Expected --engine-sha256=PINNED_64_DIGIT_DIGEST before executing any analysis');
assert.equal(engineHash,args['engine-sha256'],'engine executable not the approved binary');
const work=mkdtempSync(join(resultsDir,'real-coach-fault-'));
process.env.DB_PATH=join(work,'coach.db');
process.env.ENGINE_BACKEND='local';
process.env.STOCKFISH_PATH=engine;
process.env.STOCKFISH_THREADS='1';
process.env.STOCKFISH_HASH='16';
process.env.SESSION_SECRET='only-a-disposable-test-not-a-live-session';

const response={
 title:'Critical moment',
 prose:"White's king is on e2.",
 what_happened:"White's king is on e2.",
 summary:'White won the game.',
 skill_assessment:'One game does not prove a rating.',
 opening_prose:'The moves were recorded.'
};
const safeResponse={
 title:'Critical moment',
 prose:"White's king is on e1.",
 what_happened:"White's king is on e1.",
 summary:'White lost this game.',
 skill_assessment:'One game does not prove a rating.',
 opening_prose:'The opening moves were recorded.'
};
let payload=safeResponse;
let requestCount=0;
const requests=[];
const server=createServer((req,res)=>{
 const url=req.url||'';
 if(req.method==='GET'&&url==='/v1/models'){
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({data:[{id:'qa-hostile-mock'}]}));return;
 }
 if(req.method==='POST'&&url==='/v1/chat/completions'){
  let body='';
  req.on('data',chunk=>{body+=chunk;if(body.length>100000)req.destroy();});
  req.on('end',()=>{
   try{
    const input=JSON.parse(body);
    assert.equal(input.model,'qa-hostile-mock');
    requestCount++;
    requests.push({prompt_length:JSON.stringify(input.messages).length,kind:input.messages?.at(-1)?.content?.slice(-90)||''});
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify(payload)},finish_reason:'stop'}]}));
   }catch(error){res.writeHead(500);res.end(JSON.stringify({error:String(error)}));}
  });
  return;
 }
 res.writeHead(404);res.end('not-a-real-llm');
});
let db=null,restoreCoachEngine=null;
const began=Date.now();
const report={
 schema_version:1,
 benchmark_run_id:runId,
 scope:'real buildGameReview + llm.ts with controlled local JSON provider, real analyzer Stockfish, disposable SQLite',
 at_utc:new Date().toISOString(),
 benchmark_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 candidate_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:appRoot,encoding:'utf8'}).trim(),
 engine_sha256:engineHash,
 fixture_id:fixture.fixture_id,manifest_sha256:sha(readFileSync(manifestPath)),
 pgm_result:'0-1',
 accepted_false_claims:[],
 requests:0,elapsed_ms:null,
 candidate_factuality_certified:false,
 failures:[],
 limitations:['Local fake vLLM injects pre-selected false text; no actual AI model or network provider used',
 'Only one synthetic game, English language; this demonstrates escapes, not model hallucination incidence',
 'No assertions of general coaching correctness or human learning']
};
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const url='http://127.0.0.1:'+server.address().port;
 const {db:conn,setSetting}=await import(join(appRoot,'server/src/db.ts'));
 db=conn;
 setSetting('llm_provider','vllm');
 setSetting('vllm_url',url);
 setSetting('vllm_model','qa-hostile-mock');
 const {analyzePgn}=await import(join(appRoot,'server/src/routes/analyze.ts'));
 const {buildGameReview,REVIEW_PROSE_VERSION}=await import(join(appRoot,'server/src/coach/review.ts'));
 const {setCoachEngine}=await import(join(appRoot,'server/src/coach/coaching.ts'));
 const {screenCoachProse,momentEvidence,screenUnanchoredProse}=await import(join(appRoot,'server/src/coach/claims.ts'));
 const originalCoachEngine=setCoachEngine(async()=>null);
 restoreCoachEngine=()=>setCoachEngine(originalCoachEngine);
 const game=new Chess();game.loadPgn(pgn,{strict:true});
 assert.equal(game.header().Result,'0-1');
 const analysis=await analyzePgn(pgn,8);
 assert(analysis.key_moments.length>0,'no actual key moments in synthetic analyzed game');
 const moment=analysis.key_moments.find(m=>m.side==='white') || analysis.key_moments[0];
 const before=new Chess(moment.fen_before);
 assert.equal(before.get('e1')?.type,'k');
 assert.equal(before.get('e1')?.color,'w');
 assert.notEqual(before.get('e2')?.type,'k','the false sentence must not be true');
 const after=new Chess(moment.fen_before);after.move(moment.san);
 assert.notEqual(after.get('e2')?.type,'k','after the played move e2 is still not the king');
 assert.equal(after.get('e1')?.type,'k');
 assert.equal(screenCoachProse(response.prose,momentEvidence(moment.fen_before,moment.san,moment.best_san,moment.best_pv),'en').accepted,true,'model text must demonstrate accepted screen miss');
 assert.equal(screenUnanchoredProse(response.summary,'en'),true,'summary false result must bypass screen');
 const inputs={analysis,pgn,language:'en',audience:'beginner',userColor:'white',llmEnabled:true};
 payload=safeResponse;
 const safe=await buildGameReview(inputs);
 assert(safe.key_moments.length>0);
 assert(safe.summary.includes(safeResponse.summary),'neutral summary must traverse real pipeline');
 assert(safe.key_moments.some(m=>m.prose.includes(safeResponse.prose)),'neutral moment must traverse real pipeline');
 const safeCheck=validateWrittenGameReview({pgn,review:safe,userColor:'white'});
 assert.equal(safeCheck.findings.length,0,'true control unexpectedly rejected');
 assert(safeCheck.verified.some(v=>v.type==='game_result'),'positive result claim was not checked');
 assert(safeCheck.verified.some(v=>v.type==='piece_location'),'positive piece location was not checked');
 payload=response;
 const attack=await buildGameReview(inputs);
 const attackCheck=validateWrittenGameReview({pgn,review:attack,userColor:'white'});
 assert(attackCheck.findings.some(f=>f.reason==='contradicted_game_winner'&&f.field==='summary'),
   'wrong game winner escaped independent checker');
 assert(attackCheck.findings.some(f=>f.reason==='contradicted_piece_location'&&f.field==='moment:0'),
   'wrong king square escaped independent checker');
 report.independent_claim_validation={
  neutral:{status:safeCheck.status,verified:safeCheck.verified,unassessed:safeCheck.unassessed},
  hostile:{status:attackCheck.status,findings:attackCheck.findings,unassessed:attackCheck.unassessed},
  scope:attackCheck.scope
 };
 report.actual_result=game.header().Result;
 report.replay_white_king_e1=true;
 report.replay_white_king_e2=false;
 report.key_moment_ply=moment.ply;
 report.coach_prose_version=REVIEW_PROSE_VERSION;
 report.safe_flow_accepted=true;
 report.attack_output={
  summary:attack.summary,
  key_moments:attack.key_moments.map(m=>({ply:m.ply,prose:m.prose,title:m.title})),
  opening:attack.phases.opening?.prose||null
 };
 report.accepted_false_claims=[
  ...(attack.summary.includes(response.summary)?['wrong_game_winner_in_summary']:[]),
  ...(attack.key_moments.some(m=>m.prose.includes(response.prose))?['wrong_piece_square_in_key_moment']:[]),
  ...(attack.phases.opening?.prose.includes(response.prose)?['wrong_piece_square_in_opening_phase']:[])
 ];
 report.requests=requestCount;
 report.elapsed_ms=Date.now()-began;
 report.false_prose_strings_are_fixture_only=true;
 if(report.accepted_false_claims.length<2)report.failures.push('attack_did_not_demonstrate_two_distinct_surface_escapes');
} finally {
 try{restoreCoachEngine?.();}catch{}
 try{db?.close();}catch{}
 await new Promise(resolve=>server.close(resolve));
 rmSync(work,{recursive:true,force:true});
}
const filename=join(resultsDir,'real-coach-faults.json');
writeFileSync(filename,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({file:filename,benchmark_run_id:runId,source:report.candidate_sha,accepted_false_claims:report.accepted_false_claims,
  request_count:report.requests,ms:report.elapsed_ms,failures:report.failures,output:report.attack_output},null,2));
// This diagnostic returns 0 if the *false claim injection test succeeds*;
// report.accepted_false_claims is evidence of a product defect, not a pass.
if(report.failures.length)process.exitCode=1;
