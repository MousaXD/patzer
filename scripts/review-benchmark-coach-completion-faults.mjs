#!/usr/bin/env node
/**
 * Agent D — test whether non-streaming JSON-model termination metadata is
 * honored by the real Game Review pipeline. No external models/production DB.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { Chess } from 'chess.js';

const root=resolve(import.meta.dirname,'..');
const results=join(root,'qa/review-excellence/results');mkdirSync(results,{recursive:true});
const args=Object.fromEntries(process.argv.slice(2).map(x=>{
 const i=x.indexOf('=');return i<0?[x.slice(2),true]:[x.slice(2,i),x.slice(i+1)];
}));
const candidate=realpathSync(args['app-root']??join(results,'worktree-coach'));
if(!candidate.startsWith(join(results,'worktree-')))throw Error('Only detached QA worktrees accepted');
const engine=realpathSync(args.engine??join(results,'engine/unpacked/usr/games/stockfish'));
const sha=data=>createHash('sha256').update(data).digest('hex');
const engineHash=sha(readFileSync(engine));
if(!/^[a-f0-9]{64}$/.test(args['engine-sha256']||''))throw Error('--engine-sha256 required');
assert.equal(engineHash,args['engine-sha256'],'pinned Stockfish mismatch');
const manifest=readFileSync(join(root,'qa/review-excellence/manifests/manifest-v2.jsonl'),'utf8');
const fixture=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.license==='self-authored'&&fixture.source_kind==='synthetic');
const pgn=readFileSync(join(root,'qa/review-excellence/fixtures',fixture.pgn_file),'utf8');
assert.equal(sha(pgn),fixture.pgn_sha256);
const replay=new Chess();replay.loadPgn(pgn,{strict:true});
assert(replay.isCheckmate()&&replay.turn()==='w');

const work=mkdtempSync(join(results,'coach-completion-'));
process.env.DB_PATH=join(work,'disposable.db');
process.env.SESSION_SECRET='qa-only-disposable-credential';
process.env.STOCKFISH_PATH=engine;
process.env.STOCKFISH_THREADS='1';
process.env.STOCKFISH_HASH='16';
process.env.ENGINE_BACKEND='local';

let finishReason='stop',providerCount=0;
const good={title:'QA moment',prose:'Review every move before choosing your next move.',
 what_happened:'Review every move before choosing your next move.',
 summary:'Black won the game.',
 skill_assessment:'One game is insufficient to measure playing strength.',
 opening_prose:'The opening moves are recorded.'};
const responseText='Black won the game.';
const service=createServer((req,res)=>{
 if(req.method==='GET'&&req.url==='/v1/models'){
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({data:[{id:'qa-finish-reason'}]}));return;
 }
 if(req.method==='POST'&&req.url==='/v1/chat/completions'){
  let data='';
  req.on('data',b=>{data+=b;if(data.length>100000)req.destroy();});
  req.on('end',()=>{
   try{
    const body=JSON.parse(data);
    assert.equal(body.model,'qa-finish-reason');
    assert.equal(body.stream,false);
    providerCount++;
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({choices:[{
     message:{role:'assistant',content:JSON.stringify(good)},
     finish_reason:finishReason
    }]}));
   }catch(e){res.writeHead(500).end(JSON.stringify({error:String(e)}));}
  });return;
 }
 res.writeHead(404);res.end();
});

const began=Date.now();
let db=null,restore=null;
const runs=[];
try{
 await new Promise((ok,fail)=>{service.once('error',fail);service.listen(0,'127.0.0.1',ok);});
 const {db:database,setSetting}=await import(join(candidate,'server/src/db.ts'));
 db=database;
 setSetting('llm_provider','vllm');
 setSetting('vllm_url','http://127.0.0.1:'+service.address().port);
 setSetting('vllm_model','qa-finish-reason');
 const {analyzePgn}=await import(join(candidate,'server/src/routes/analyze.ts'));
 const {buildGameReview}=await import(join(candidate,'server/src/coach/review.ts'));
 const {setCoachEngine}=await import(join(candidate,'server/src/coach/coaching.ts'));
 const previous=setCoachEngine(async()=>null);restore=()=>setCoachEngine(previous);
 const analysis=await analyzePgn(pgn,8);
 assert(analysis.key_moments.length===1,'test requires exactly one key moment');
 const inputs={pgn,analysis,userColor:'white',language:'en',audience:'beginner',llmEnabled:true};
 for(const reason of ['stop','length','content_filter']){
  const before=providerCount;
  finishReason=reason;
  const review=await buildGameReview(inputs);
  runs.push({
   provider_finish_reason:reason,
   prompt_count:providerCount-before,
   produced_summary:review.summary,
   produced_moment:review.key_moments[0]?.prose,
   ai_summary_survived:review.summary===responseText,
   ai_moment_survived:review.key_moments[0]?.prose===good.prose,
   fully_approved:false
  });
 }
}finally{
 try{restore?.();}catch{}
 try{db?.close();}catch{}
 await new Promise(done=>service.close(done));
 rmSync(work,{recursive:true,force:true});
}
assert.equal(runs.length,3);
assert(runs.every(r=>r.prompt_count===3),'real pipeline did not request 3 outputs per review');
assert(runs[0].ai_summary_survived&&runs[0].ai_moment_survived,'normal complete response must pass');
const out={
 schema_version:1,at_utc:new Date().toISOString(),
 candidate_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:candidate,encoding:'utf8'}).trim(),
 manifest_sha256:sha(manifest),engine_sha256:engineHash,
 fixture:'SYN-GAME-FOOLS-MATE',provider:'localhost QA vLLM facade',
 source:'self-authored synthetic',depth:8,
 test_rationale:'A provider signal of incomplete/filtered output must not be ignored merely because the bytes parse as JSON.',
 cases:runs,
 length_accepted_by_real_review:runs[1].ai_summary_survived&&runs[1].ai_moment_survived,
 content_filter_accepted_by_real_review:runs[2].ai_summary_survived&&runs[2].ai_moment_survived,
 total_requests:providerCount,duration_ms:Date.now()-began,
 notes:['The mock intentionally returns valid JSON even on token-limit/content-filter termination',
 'No real model outputs, user games, external requests, credentials or production SQLite',
 'Acceptance of finish_reason=length demonstrates missing completion-provenance verification',
 'No change to the candidate; a zero exit confirms only the QA experiment completed'],
 product_completion_certified:false,release_approved:false
};
const path=join(results,'coach-completion-real-pipeline.json');
writeFileSync(path,JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({report:path,source:out.candidate_sha,requests:out.total_requests,
 cases:runs.map(({provider_finish_reason,ai_summary_survived,ai_moment_survived})=>({provider_finish_reason,ai_summary_survived,ai_moment_survived})),
 length_accepted:out.length_accepted_by_real_review,content_filter_accepted:out.content_filter_accepted_by_real_review,
 duration_ms:out.duration_ms},null,2));
