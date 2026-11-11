#!/usr/bin/env node
/**
 * Agent D — authenticated, concurrent two-user game-review experiment.
 * Different owners, opposite player colors, different language and audience.
 * Only self-authored PGN, disposable SQLite, pinned Stockfish and local mock.
 */
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
import {Hono} from 'hono';
import {Chess} from 'chess.js';

const root=resolve(import.meta.dirname,'..'),results=join(root,'qa/review-excellence/results');
mkdirSync(results,{recursive:true});
const args=Object.fromEntries(process.argv.slice(2).map(x=>{
 const i=x.indexOf('=');return i<0?[x.slice(2),true]:[x.slice(2,i),x.slice(i+1)];
}));
const app=realpathSync(args['app-root']||join(results,'worktree-coach'));
assert(app.startsWith(join(results,'worktree-')),'use detached QA candidate only');
const sha=x=>createHash('sha256').update(x).digest('hex');
const engine=realpathSync(args.engine||join(results,'engine/unpacked/usr/games/stockfish'));
assert(/^[a-f0-9]{64}$/.test(args['engine-sha256']||''),'verified binary hash required');
const engineSha=sha(readFileSync(engine));assert.equal(engineSha,args['engine-sha256']);
const manifest=readFileSync(join(root,'qa/review-excellence/manifests/manifest-v2.jsonl'),'utf8');
const entry=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(entry?.source_kind==='synthetic'&&entry.license==='self-authored');
const pgn=readFileSync(join(root,'qa/review-excellence/fixtures',entry.pgn_file),'utf8');
assert.equal(sha(pgn),entry.pgn_sha256);
const chess=new Chess();chess.loadPgn(pgn,{strict:true});
assert(chess.isCheckmate()&&chess.turn()==='w','Black must be actual winner');

const temp=mkdtempSync(join(results,'qa-two-user-'));
process.env.DB_PATH=join(temp,'synthetic-only.db');
process.env.SESSION_SECRET='qa-synthetic-session-only';
process.env.STOCKFISH_PATH=engine;
process.env.STOCKFISH_THREADS='1';
process.env.STOCKFISH_HASH='16';
process.env.ENGINE_BACKEND='local';

const profiles={
 en:{user_id:1,game_id:1,lang:'en',audience:'beginner',color:'white',
  summary:'Black won the game.',prose:'Review every move before choosing your next move.'},
 es:{user_id:2,game_id:2,lang:'es',audience:'advanced',color:'black',
  summary:'Las negras ganaron la partida.',prose:'Revisa las jugadas antes de continuar.'},
};
const held=[],messages=[],replies=[];
let pending=true,requests=0,closures=0,db=null;
const providerErrors=[];
function parsePrompt(body){
 assert.equal(body.model,'qa-two-user-provider');
 const user=body.messages?.find(x=>x.role==='user')?.content;
 assert.equal(typeof user,'string','no actual generated prompt');
 const i=user.indexOf('FACTS:\n'),j=user.indexOf('\n\nTASK:',i);
 assert(i>=0&&j>i,'missing verifiable FACTS block');
 const facts=JSON.parse(user.slice(i+'FACTS:\n'.length,j));
 const profile=profiles[facts.lang];
 assert(profile,'unknown user language in actual model prompt');
 assert.equal(facts.audience,profile.audience,'cross-user audience leaked into prompt');
 const stage=/"summary"\s*:\s*string/.test(user)?'summary':
  /"what_happened"\s*:\s*string/.test(user)?'moment':'phase';
 return {lang:facts.lang,audience:facts.audience,stage,
  result:stage==='summary'?facts.result:null,
  accuracy:typeof facts.your_accuracy==='number'?facts.your_accuracy:null,
  mover:stage==='moment'?facts.moment?.who_moved??null:null};
}
const send=(res,data)=>{
 const profile=profiles[data.lang];
 replies.push({lang:data.lang,stage:data.stage});
 res.writeHead(200,{'content-type':'application/json'});
 res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({
  title:'QA moment',what_happened:profile.prose,prose:profile.prose,
  summary:profile.summary,opening_prose:'The opening was recorded.',
  skill_assessment:'A single game cannot determine playing strength.'
 })}}]}));
};
const provider=createServer((req,res)=>{
 if(req.method==='GET'&&req.url==='/v1/models'){
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({data:[{id:'qa-two-user-provider'}]}));return;
 }
 if(req.method==='POST'&&req.url==='/v1/chat/completions'){
  let body='';
  req.on('data',x=>{body+=x;if(body.length>100000)req.destroy();});
  req.on('end',()=>{
   try{
    const info=parsePrompt(JSON.parse(body));
    requests++;messages.push(info);res.on('close',()=>closures++);
    if(pending&&info.stage==='phase'&&held.length<2){held.push({res,...info});return;}
    if(pending)throw Error('unexpected follow-up request before both first calls were held');
    send(res,info);
   }catch(e){providerErrors.push(String(e));res.writeHead(500).end(String(e));}
  });return;
 }
 res.writeHead(404).end('mock-not-configured');
});
function bounded(p,ms,label){let timer;return Promise.race([p,new Promise((_,reject)=>{
 timer=setTimeout(()=>reject(Error(label+'_timeout')),ms);
})]).finally(()=>clearTimeout(timer));}
async function until(fn,label){
 return bounded((async()=>{while(!fn())await new Promise(resolve=>setTimeout(resolve,5));})(),2800,label);
}
const started=Date.now(),observed={};
try{
 await bounded(new Promise((ok,fail)=>{provider.once('error',fail);provider.listen(0,'127.0.0.1',ok);}),1500,'mock_start');
 const {db:database,setSetting}=await import(join(app,'server/src/db.ts'));db=database;
 setSetting('llm_provider','vllm');
 setSetting('vllm_url','http://127.0.0.1:'+provider.address().port);
 setSetting('vllm_model','qa-two-user-provider');
 const {analyzePgn,saveAnalysis}=await import(join(app,'server/src/routes/analyze.ts'));
 const {createSession}=await import(join(app,'server/src/auth/sessions.ts'));
 const route=(await import(join(app,'server/src/routes/review.ts'))).default;
 const api=new Hono();api.route('/api/games',route);
 for(const p of Object.values(profiles)){
  db.prepare('INSERT INTO users(id,username,password_hash,role) VALUES(?,?,?,?)')
   .run(p.user_id,'qa-synthetic-'+p.lang,'not-real-credentials','user');
  db.prepare('INSERT INTO profiles(user_id,display_name,language,audience) VALUES(?,?,?,?)')
   .run(p.user_id,'QA synthetic '+p.lang,p.lang,p.audience);
  db.prepare('INSERT INTO games(id,user_id,source,pgn,user_color) VALUES(?,?,?,?,?)')
   .run(p.game_id,p.user_id,'imported',pgn,p.color);
 }
 const analysis=await analyzePgn(pgn,8);
 assert(analysis.key_moments.length===1&&analysis.key_moments[0]?.side==='white');
 saveAnalysis(1,analysis);saveAnalysis(2,analysis);
 const tokens={en:createSession(1),es:createSession(2)};
 const cookie=lang=>({Cookie:'chess_session='+tokens[lang]});
 const req=(id,options)=>api.request('http://localhost/api/games/'+id+'/review',options);
 const access_status={unauthenticated_post:(await req(1,{method:'POST'})).status};
 assert.equal(access_status.unauthenticated_post,401);
 for(const lang of ['en','es']){
  const other=lang==='en'?'es':'en';
  access_status[lang+'_cross_user_get']=(await req(profiles[other].game_id,{headers:cookie(lang)})).status;
  access_status[lang+'_cross_user_post']=(await req(profiles[other].game_id,{method:'POST',headers:cookie(lang)})).status;
  assert.equal(access_status[lang+'_cross_user_get'],404);
  assert.equal(access_status[lang+'_cross_user_post'],404);
 }
 const start=async lang=>{
  const r=await bounded(req(profiles[lang].game_id,{method:'POST',headers:cookie(lang)}),3200,lang+'_open');
  assert.equal(r.status,200);return {body:r.text()}; // keep pending promise boxed, not adopted
 };
 const {body:enBody}=await start('en');
 await until(()=>held.length===1,'en_held');assert.equal(held[0].lang,'en');
 const {body:esBody}=await start('es');
 await until(()=>held.length===2,'es_held');assert.equal(held[1].lang,'es');
 assert.equal(db.prepare('SELECT count(*) AS n FROM analyses WHERE prose_json IS NOT NULL').get().n,0);
 pending=false;
 send(held[1].res,held[1]);
 const esSse=await bounded(esBody,6500,'es_first');
 assert(esSse.includes('event: done')&&!esSse.includes('event: error'));
 const getRow=id=>db.prepare('SELECT prose_json,prose_lang,prose_audience FROM analyses WHERE game_id=?').get(id);
 assert.equal(getRow(1).prose_json,null,'English report should still be pending');
 send(held[0].res,held[0]);
 const enSse=await bounded(enBody,6500,'en_second');
 assert(enSse.includes('event: done')&&!enSse.includes('event: error'));
 observed.cached={};observed.readback={};
 for(const [lang,p] of Object.entries(profiles)){
  const row=getRow(p.game_id);assert(row.prose_json,'own review was not persisted');
  const saved=JSON.parse(row.prose_json);
  observed.cached[lang]={language:row.prose_lang,audience:row.prose_audience,
   summary:saved.summary,by_user:saved.key_moments?.[0]?.by_user??null};
  assert.equal(row.prose_lang,p.lang);assert.equal(row.prose_audience,p.audience);
  assert.equal(saved.summary,p.summary);
  const response=await req(p.game_id,{headers:cookie(lang)});
  assert.equal(response.status,200);
  const actual=await response.json();
  observed.readback[lang]={language:actual.review?.language,
   audience:actual.review?.audience,summary:actual.review?.summary,stale:actual.stale??false};
  assert.deepEqual(observed.readback[lang],{language:p.lang,
   audience:p.audience,summary:p.summary,stale:false});
 }
 assert.equal(observed.cached.en.by_user,true);
 assert.equal(observed.cached.es.by_user,false);
 const enSummary=messages.find(x=>x.lang==='en'&&x.stage==='summary');
 const esSummary=messages.find(x=>x.lang==='es'&&x.stage==='summary');
 assert(enSummary&&esSummary,'both profile-specific summary prompts missing');
 assert.equal(enSummary.result,'you lost','English White should have lost');
 assert(esSummary.result&&esSummary.result!==enSummary.result,'Spanish Black should have won');
 assert.equal(enSummary.accuracy,analysis.accuracy_white);
 assert.equal(esSummary.accuracy,analysis.accuracy_black);
 assert.deepEqual(messages.filter(x=>x.lang==='en').map(x=>x.stage),['phase','moment','summary']);
 assert.deepEqual(messages.filter(x=>x.lang==='es').map(x=>x.stage),['phase','moment','summary']);
 assert.equal(requests,6);assert.equal(closures,6);assert.deepEqual(providerErrors,[]);
 observed.unauthenticated_post_denied=true;
 observed.cross_tenant_get_and_post_denied=true;
 observed.actual_access_status=access_status;
 observed.both_started_uncached=true;
 observed.real_sse={en:enSse,es:esSse};
 observed.model_prompts=messages;
 observed.provider_reply_order=replies;
 observed.calls=requests;observed.provider_responses_closed=closures;
 observed.provider_errors=providerErrors;
 observed.white_accuracy=analysis.accuracy_white;
 observed.black_accuracy=analysis.accuracy_black;
}finally{
 try{db?.close();}catch{}
 provider.closeAllConnections();
 await bounded(new Promise(r=>provider.close(r)),1500,'close_provider').catch(()=>{});
 rmSync(temp,{recursive:true,force:true});
}
const packet={schema_version:1,at_utc:new Date().toISOString(),
 candidate_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),
 engine_sha256:engineSha,manifest_sha256:sha(manifest),fixture_id:entry.fixture_id,
 rights:'QA-authored synthetic chess, fake users and disposable database',
 scope:'real Hono Game Review SSE with two concurrent different user owners and opposing colors/locales',
 observation:observed,elapsed_ms:Date.now()-started,
 tested_tenants_isolated:true,overall_product_security_certified:false,release_approved:false,
 limits:['One in-process dual-request run with synthetic owners, one shared PGN and localhost mock model',
  'No real reverse proxy, remote LLM, browser login or cross-process stress',
  'Only this single Game Review endpoint and two userColor/profile combinations were challenged']};
const output=join(results,'review-tenant-concurrency.json');
writeFileSync(output,JSON.stringify(packet,null,2)+'\n');
console.log(JSON.stringify({report:output,candidate:packet.candidate_sha,
 cached:observed.cached,prompt_summaries:messages.filter(x=>x.stage==='summary'),
 total_model_calls:requests,closed_provider_requests:closures,elapsed_ms:packet.elapsed_ms},null,2));
