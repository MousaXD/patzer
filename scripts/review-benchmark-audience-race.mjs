#!/usr/bin/env node
/**
 * Agent D — independent real-route audience provenance experiment.
 * One approved synthetic chess game in a disposable SQLite with test-only
 * profile changes and loopback model. Never imports live service state.
 *
 * Case 1: same audience throughout held final response (positive control).
 * Case 2: beginner -> advanced while final response is pending (race).
 * Case 3: fresh manual request under advanced audience (recovery control).
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
import {Hono} from 'hono';
import {Chess} from 'chess.js';

const root=resolve(import.meta.dirname,'..'),results=join(root,'qa/review-excellence/results');
mkdirSync(results,{recursive:true});
const argv=Object.fromEntries(process.argv.slice(2).map(arg=>{
 const i=arg.indexOf('=');return i<0?[arg.slice(2),true]:[arg.slice(2,i),arg.slice(i+1)];
}));
const app=realpathSync(argv['app-root']??join(results,'worktree-coach'));
assert(app.startsWith(join(results,'worktree-')),'only disposable detached candidate worktrees');
const engine=realpathSync(argv.engine??join(results,'engine/unpacked/usr/games/stockfish'));
const sha=data=>createHash('sha256').update(data).digest('hex');
assert(/^[a-f0-9]{64}$/.test(argv['engine-sha256']||''),'engine pin mandatory');
const engineHash=sha(readFileSync(engine));
assert.equal(engineHash,argv['engine-sha256'],'engine drift');
const manifest=readFileSync(join(root,'qa/review-excellence/manifests/manifest-v2.jsonl'),'utf8');
const meta=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert.equal(meta?.source_kind,'synthetic');
assert.equal(meta?.license,'self-authored');
const pgn=readFileSync(join(root,'qa/review-excellence/fixtures',meta.pgn_file),'utf8');
assert.equal(sha(pgn),meta.pgn_sha256);
const chess=new Chess();chess.loadPgn(pgn,{strict:true});
assert(chess.isCheckmate()&&chess.turn()==='w');
const scratch=mkdtempSync(join(results,'audience-race-'));
process.env.DB_PATH=join(scratch,'only-disposable.db');
process.env.SESSION_SECRET='local-qa-only';
process.env.ENGINE_BACKEND='local';process.env.STOCKFISH_PATH=engine;
process.env.STOCKFISH_THREADS='1';process.env.STOCKFISH_HASH='16';
let mode='hold_control', db=null;
const held=[],events=[];
let requests=0,responsesClosed=0;
const mockOutput={title:'QA lesson',prose:'Review the played moves.',
 what_happened:'Review the played moves.',summary:'Black won the game.',
 skill_assessment:'One game cannot prove playing strength.',
 opening_prose:'The opening was recorded.'};
const classify=input=>{
 const prompt=input?.messages?.at(-1)?.content||'';
 return prompt.includes('Schema: { "summary"')?'summary':prompt.includes('what_happened')?'moment':'phase';
};
const respond=res=>{
 res.writeHead(200,{'content-type':'application/json'});
 res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(mockOutput)}}]}));
};
const llm=createServer((req,res)=>{
 if(req.method==='GET'&&req.url==='/v1/models'){
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({data:[{id:'qa-audience-race'}]}));return;
 }
 if(req.method==='POST'&&req.url==='/v1/chat/completions'){
  let input='';
  req.on('data',chunk=>{input+=chunk;if(input.length>100000)req.destroy();});
  req.on('end',()=>{
   try{
    const json=JSON.parse(input);assert.equal(json.model,'qa-audience-race');
    requests++;
    res.on('close',()=>{responsesClosed++;});
    const stage=classify(json);
    events.push({mode,stage});
    if(mode.startsWith('hold_') && stage==='summary')held.push({mode,res});
    else respond(res);
   }catch(error){res.writeHead(500).end(String(error));}
  });return;
 }
 res.writeHead(404).end('not a provider');
});
function timed(promise,ms,label){
 let timer;
 return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+'_timeout')),ms);})])
  .finally(()=>clearTimeout(timer));
}
async function until(predicate,label){
 await timed((async()=>{while(!predicate())await new Promise(done=>setTimeout(done,5));})(),3200,label);
}
const started=Date.now(),outcome={};
try {
 await timed(new Promise((ok,fail)=>{llm.once('error',fail);llm.listen(0,'127.0.0.1',ok);}),1500,'mock_start');
 const {db:database,setSetting}=await import(join(app,'server/src/db.ts'));db=database;
 setSetting('llm_provider','vllm');
 setSetting('vllm_url','http://127.0.0.1:'+llm.address().port);
 setSetting('vllm_model','qa-audience-race');
 const {analyzePgn,saveAnalysis}=await import(join(app,'server/src/routes/analyze.ts'));
 const {createSession}=await import(join(app,'server/src/auth/sessions.ts'));
 const route=(await import(join(app,'server/src/routes/review.ts'))).default;
 const api=new Hono();api.route('/api/games',route);
 db.prepare('INSERT INTO users(id,username,password_hash,role) VALUES (?,?,?,?)')
  .run(1,'synthetic-qa','not-real-auth','user');
 db.prepare('INSERT INTO profiles(user_id,display_name,language,audience) VALUES (?,?,?,?)')
  .run(1,'Synthetic QA','en','beginner');
 for(let id=1;id<=2;id++)db.prepare('INSERT INTO games(id,user_id,source,pgn,user_color) VALUES(?,?,?,?,?)')
  .run(id,1,'imported',pgn,'white');
 const analysis=await analyzePgn(pgn,8);
 for(let id=1;id<=2;id++)saveAnalysis(id,analysis);
 const cookie=createSession(1),headers={Cookie:'chess_session='+cookie};
 const row=id=>db.prepare('SELECT prose_json,prose_lang,prose_audience FROM analyses WHERE game_id=?').get(id);
 const auto=id=>db.prepare('SELECT count(*) AS n FROM analyses WHERE game_id=? AND prose_json IS NULL').get(id).n;
 const get=async(id)=>{const res=await api.request('http://localhost/api/games/'+id+'/review',{headers});assert.equal(res.status,200);return res.json();};
 const post=async id=>{
  const res=await timed(api.request('http://localhost/api/games/'+id+'/review',{method:'POST',headers}),3500,'open_sse');
  assert.equal(res.status,200);
  return {body:res.text()};
 };
 // No change: save the originally requested beginner report.
 const {body:controlBody}=await post(1);
 await until(()=>held.some(x=>x.mode==='hold_control'),'control_summary');
 assert.equal(row(1).prose_json,null);
 mode='instant';
 respond(held.find(x=>x.mode==='hold_control').res);
 const controlSse=await timed(controlBody,4500,'control_complete');
 const controlGet=await get(1);
 outcome.same_audience={
  emitted_done:controlSse.includes('event: done'),
  cached_audience:row(1).prose_audience,
  get_delivered_beginner:controlGet.review?.audience==='beginner',
  was_not_marked_stale:controlGet.stale===undefined,
  auto_pending:auto(1),sse:controlSse
 };
 assert(outcome.same_audience.emitted_done&&outcome.same_audience.get_delivered_beginner);
 assert.equal(outcome.same_audience.auto_pending,0);
 // Change preferred audience while summary awaits the model.
 mode='hold_audience';
 const {body:changedBody}=await post(2);
 await until(()=>held.some(x=>x.mode==='hold_audience'),'changed_summary');
 assert.equal(row(2).prose_json,null);
 db.prepare('UPDATE profiles SET audience=? WHERE user_id=1').run('advanced');
 mode='instant';
 respond(held.find(x=>x.mode==='hold_audience').res);
 const changedSse=await timed(changedBody,4500,'changed_complete');
 const changedGet=await get(2);
 outcome.audience_changed={
  before:'beginner',after:'advanced',
  emitted_done:changedSse.includes('event: done'),
  delivered_old_audience:changedSse.includes('"audience":"beginner"'),
  cache_written:row(2).prose_json!==null,
  cached_audience:row(2).prose_audience,
  got_stale_result:changedGet.review===null&&changedGet.stale===true,
  auto_pending:auto(2),sse:changedSse
 };
 assert(outcome.audience_changed.emitted_done);
 assert(outcome.audience_changed.delivered_old_audience);
 assert.equal(outcome.audience_changed.cached_audience,'beginner');
 assert(outcome.audience_changed.got_stale_result);
 assert.equal(outcome.audience_changed.auto_pending,0);
 // Manual retry is a useful control: can the owner recover without a migration?
 const {body:recoveryBody}=await post(2);
 const recoverySse=await timed(recoveryBody,4500,'recovery_complete');
 const recoveredGet=await get(2);
 outcome.manual_recovery={
  emitted_done:recoverySse.includes('event: done'),
  delivered_new_audience:recoverySse.includes('"audience":"advanced"'),
  cached_audience:row(2).prose_audience,
  get_delivered_advanced:recoveredGet.review?.audience==='advanced',
  auto_pending:auto(2),sse:recoverySse
 };
 assert(outcome.manual_recovery.emitted_done);
 assert(outcome.manual_recovery.delivered_new_audience);
 assert.equal(outcome.manual_recovery.cached_audience,'advanced');
 assert(outcome.manual_recovery.get_delivered_advanced);
 outcome.requests=requests;
 outcome.closed_provider_responses=responsesClosed;
 outcome.request_stages=events;
 assert.equal(requests,9,'expected three 3-call real review pipelines');
 assert.equal(responsesClosed,9,'unexpected pending provider requests');
 assert.deepEqual(events.map(x=>x.stage),Array(3).fill(['phase','moment','summary']).flat());
}finally{
 try{db?.close();}catch{}
 llm.closeAllConnections();
 await timed(new Promise(ok=>llm.close(ok)),1400,'close_mock').catch(()=>{});
 rmSync(scratch,{recursive:true,force:true});
}
const packet={
 schema_version:1,at_utc:new Date().toISOString(),
 candidate_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),
 manifest_sha256:sha(manifest),engine_sha256:engineHash,fixture_id:meta.fixture_id,
 provenance:'QA-authored synthetic game, fake account, disposable DB, local mock only',
 scope:'real authenticated Game Review SSE held at last provider response; profile audience changes',
 data:outcome,elapsed_ms:Date.now()-started,
 same_audience_positive_passed:true,
 in_flight_audience_stale_cache_reproduced:true,
 manual_advanced_audience_recovery_passed:true,
 release_approved:false,product_certified:false,
 limitations:['Only controlled audience beginner to advanced, one synthetic PGN, local fake model',
 'Profile modified through disposable SQLite; real settings/UI not driven',
 'Does not prove natural model responses, general learner benefit or production incidence']
};
const path=join(results,'review-audience-race.json');
writeFileSync(path,JSON.stringify(packet,null,2)+'\n');
console.log(JSON.stringify({file:path,candidate:packet.candidate_sha,same_audience:outcome.same_audience.cached_audience,
 changed:outcome.audience_changed.cached_audience,queue:outcome.audience_changed.auto_pending,
 manually_recovered:outcome.manual_recovery.get_delivered_advanced,requests,ms:packet.elapsed_ms},null,2));
