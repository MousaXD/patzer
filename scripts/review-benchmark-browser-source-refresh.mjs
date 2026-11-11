#!/usr/bin/env node
/** Agent D: actual Agent C GameAnalyzer + real Agent B Game Review/SQLite.
 * Prove stale client-local prose survives correct fresh game analysis AND a
 * backend {review:null} after a same-game React Query bookmark refetch.
 * Controlled --fault=remount-client is a NEGATIVE control, not product code. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createServer as tcpServer} from 'node:net';
import {realpathSync,mkdtempSync,rmSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Hono} from 'hono';
import {serve} from '@hono/node-server';
import {createServer as createViteServer} from 'vite';
import {Chess} from 'chess.js';
import {launchBrowser,within,until} from './review-benchmark-cdp.mjs';

const root=resolve(import.meta.dirname,'..');
const qa=join(root,'qa/review-excellence'),results=join(qa,'results');
mkdirSync(results,{recursive:true});
const cli=Object.fromEntries(process.argv.slice(2).map(x=>{
 const at=x.indexOf('=');return at<0?[x.slice(2),true]:[x.slice(2,at),x.slice(at+1)];
}));
assert(Object.keys(cli).every(x=>['fault','run-id','chrome'].includes(x)));
const fault=cli.fault??null;
assert(fault===null||fault==='remount-client','unsupported QA-only fault');
const runId=cli['run-id']||randomUUID();
assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId));
const product=realpathSync(join(results,'worktree-product-browser'));
const backend=realpathSync(join(results,'worktree-coach'));
const engine=realpathSync(join(results,'engine/unpacked/usr/games/stockfish'));
const productSha='d72eaced6972c8a2ec7d8581365c45788b15a29a';
const backendSha='19c359ec3feb8e3c10c33415c403eaf5ab3d6c87';
const engineSha='00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca';
const manifestSha='2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44';
const sha=x=>createHash('sha256').update(x).digest('hex');
const gitHead=dir=>execFileSync('git',['rev-parse','HEAD'],{cwd:dir,encoding:'utf8'}).trim();
assert.equal(gitHead(product),productSha);assert.equal(gitHead(backend),backendSha);
assert.equal(sha(readFileSync(engine)),engineSha);
const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8');
assert.equal(sha(manifest),manifestSha);
const fixture=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.source_kind==='synthetic'&&fixture.license==='self-authored');
const firstPgn=readFileSync(join(qa,'fixtures',fixture.pgn_file),'utf8');
assert.equal(sha(firstPgn),fixture.pgn_sha256);
const firstChess=new Chess();firstChess.loadPgn(firstPgn,{strict:true});
assert(firstChess.isCheckmate()&&firstChess.turn()==='w'&&firstChess.history().length===4);
const secondChess=new Chess();
for(const move of ['e4','e5','Qh5','Nc6','Bc4','Nf6','Qxf7#'])secondChess.move(move);
secondChess.header('Event','QA synthetic alternate White mate');
secondChess.header('Result','1-0');
const secondPgn=secondChess.pgn();
assert(secondChess.isCheckmate()&&secondChess.turn()==='b'&&secondChess.history().length===7);
assert.notEqual(sha(firstPgn),sha(secondPgn));

const scratch=mkdtempSync(join(results,'browser-source-refresh-'));
process.env.DB_PATH=join(scratch,'qa-only.sqlite');
process.env.SESSION_SECRET='qa-only-browser-source-rotating-session';
process.env.ENGINE_BACKEND='local';process.env.STOCKFISH_PATH=engine;
process.env.STOCKFISH_THREADS='1';process.env.STOCKFISH_HASH='16';
process.env.OIDC_ENABLED='false';process.env.UPDATE_CHECK_ENABLED='false';
const oldCwd=process.cwd(),started=Date.now();
let db=null,server=null,vite=null,browser=null,apiPort=null,vitePort=null,error=null;
const observed={};
const marker='QA_OLD_BLACK_WINNER_PROSE_STAYS';
const route='/review/1';
async function freePort(){
 const tcp=tcpServer();
 await within(new Promise((ok,fail)=>{tcp.once('error',fail);tcp.listen(0,'127.0.0.1',ok);}),1500,'port_bind');
 const port=tcp.address().port;
 await within(new Promise(ok=>tcp.close(ok)),1200,'port_close');
 return port;
}
function observedRequests(){return browser.events.filter(x=>
 x.method==='Network.requestWillBeSent'&&x.params?.request?.method==='GET'&&
 /\/api\/games\/1(?:\?.*)?$/.test(x.params?.request?.url||''))
 .map(x=>({id:x.params.requestId,url:x.params.request.url}));}
async function navAndClickReport(origin){
 await browser.go(origin+route);
 await browser.wait('location.pathname === "/review/1" && !!document.querySelector("#review-tab-report")',
  'real_game_analyzer_mounted',20000);
 await browser.click('#review-tab-report');
}
async function browserUI(){return browser.evalJs(`({path:location.pathname,
 oldText:document.body.innerText.includes(${JSON.stringify(marker)}),
 newMate:document.body.innerText.includes('Qxf7'),
 moveCount:document.querySelector('[data-move-transport]')?.innerText??null,
 reportTabSelected:document.querySelector('#review-tab-report')?.getAttribute('aria-selected')??null,
 writeReportAvailable:[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Write AI report')),
 bookmarkButtonPresent:!!document.querySelector('[title="Toggle bookmark"]')})`);}
async function bookmarkClick(){
 const before=observedRequests().length;
 assert.equal(await browser.evalJs(`(() => {const b=document.querySelector('[title="Toggle bookmark"]');
  if(!b)return false; b.click();return true;})()`),true);
 await until(()=>observedRequests().length>before,'real_query_refetch_network_request',5500);
 await new Promise(done=>setTimeout(done,220));
 return {before,after:observedRequests().length};
}
try{
 const {db:database}=await import(join(backend,'server/src/db.ts'));db=database;
 const {createSession}=await import(join(backend,'server/src/auth/sessions.ts'));
 const {analyzePgn,saveAnalysis}=await import(join(backend,'server/src/routes/analyze.ts'));
 const {buildGameReview}=await import(join(backend,'server/src/coach/review.ts'));
 const {saveReviewIfFresh}=await import(join(backend,'server/src/coach/reviewCache.ts'));
 const routes={
  setup:(await import(join(backend,'server/src/routes/setup.ts'))).default,
  auth:(await import(join(backend,'server/src/routes/auth.ts'))).default,
  games:(await import(join(backend,'server/src/routes/games.ts'))).default,
  review:(await import(join(backend,'server/src/routes/review.ts'))).default,
  coach:(await import(join(backend,'server/src/routes/coach.ts'))).default,
  meta:(await import(join(backend,'server/src/routes/meta.ts'))).default,
  settings:(await import(join(backend,'server/src/routes/settings.ts'))).default,
 };
 db.prepare('INSERT INTO users(id,username,password_hash,role) VALUES(?,?,?,?)')
  .run(1,'qa-browser-source-owner','qa-no-real-password','admin');
 db.prepare('INSERT INTO profiles(user_id,display_name,language,audience) VALUES(?,?,?,?)')
  .run(1,'Synthetic owner','en','beginner');
 db.prepare('INSERT INTO games(id,user_id,source,pgn,user_color,white,black,result) VALUES(?,?,?,?,?,?,?,?)')
  .run(1,1,'pvp',firstPgn,'white','QA White','QA Black','loss');
 const a1=await within(analyzePgn(firstPgn,8),20000,'bounded_first_engine_search');
 saveAnalysis(1,a1);
 const sourceRow=db.prepare('SELECT * FROM analyses WHERE game_id=1').get();
 const oldReview=await buildGameReview({pgn:firstPgn,analysis:a1,
  language:'en',audience:'beginner',userColor:'white',llmEnabled:false});
 oldReview.summary=marker+' — '+oldReview.summary;
 assert(saveReviewIfFresh(db,1,sourceRow,{pgn:firstPgn,user_color:'white',user_id:1},
  oldReview,'en','beginner'));
 observed.before={old_pgn_sha256:sha(firstPgn),old_ply_count:firstChess.history().length,
  old_review_sha256:sha(JSON.stringify(oldReview)),old_review_marker:marker,
  old_analysis_accuracy_white:a1.accuracy_white,
  old_analysis_move_count:a1.moves.length,old_analysis_depth:a1.depth};

 const app=new Hono();
 app.use('/api/*',async(c,next)=>{
  if(!['GET','HEAD'].includes(c.req.method)&&c.req.header('X-Requested-With')!=='patzer')
   return c.json({error:'csrf_required'},403);
  await next();
 });
 app.get('/api/meta/update',c=>c.json({enabled:false,updateAvailable:false}));
 for(const [path,handler] of Object.entries(routes))
  app.route('/api/'+(path==='review'?'games':path),handler);
 server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0});
 await within(new Promise((ok,fail)=>{server.once('listening',ok);server.once('error',fail);}),1500,'api_bind');
 apiPort=server.address().port;
 const signed=createSession(1);
 const ownerHeaders={Cookie:'chess_session='+signed};
 const get=async(path)=>{
  const response=await within(fetch('http://127.0.0.1:'+apiPort+path,
   {headers:ownerHeaders}),2500,'signed_local_get');
  return {status:response.status,body:await response.json()};
 };
 const getReview=()=>get('/api/games/1/review');
 const getGame=()=>get('/api/games/1');
 const firstReview=await getReview();
 assert.equal(firstReview.status,200);
 assert.equal(firstReview.body.review.summary,oldReview.summary);
 process.chdir(join(product,'web'));
 const chosen=await freePort();
 vite=await createViteServer({root:join(product,'web'),configFile:join(product,'web/vite.config.ts'),
  server:{host:'127.0.0.1',port:chosen,strictPort:true,hmr:false,
   proxy:{'/api':{target:'http://127.0.0.1:'+apiPort,changeOrigin:true}}},logLevel:'error'});
 await within(vite.listen(),12000,'vite_start');
 vitePort=vite.httpServer.address().port;
 const origin='http://127.0.0.1:'+vitePort;
 browser=await launchBrowser({chromeBinary:cli.chrome||'/usr/bin/google-chrome',
  profileDir:join(scratch,'disposable-chrome-profile')});
 await browser.send('Network.setCookie',{url:origin,name:'chess_session',value:signed,
  httpOnly:true,path:'/',sameSite:'Lax'});
 await navAndClickReport(origin);
 await browser.wait(`document.body.innerText.includes(${JSON.stringify(marker)})`,
  'original_cached_report_displayed',6500);
 const originalUI=await browserUI();
 assert.equal(originalUI.oldText,true);
 assert.equal(originalUI.bookmarkButtonPresent,true);
 observed.initialUI=originalUI;
 observed.harmlessBookmark=await bookmarkClick();
 const afterBookmark=await browserUI();
 assert.equal(afterBookmark.oldText,true,'unrelated bookmark update invalidated source report');
 assert.equal(afterBookmark.moveCount?.includes('/ 4'),true);
 observed.afterHarmlessUI=afterBookmark;
 // Simulate legitimate continued/replaced game source and a NEW engine
 // analysis, NOT an old analysis. This removes the Checkpoint-32 backend
 // stale-read path as the cause of the client-local stale prose result.
 const a2=await within(analyzePgn(secondPgn,8),20000,'bounded_second_engine_search');
 assert.equal(a2.moves.length,7);
 assert.notEqual(a1.moves.at(-1)?.uci,a2.moves.at(-1)?.uci);
 db.prepare('UPDATE games SET pgn=?,result=? WHERE id=1').run(secondPgn,'win');
 saveAnalysis(1,a2);
 db.prepare('UPDATE analyses SET prose_json=NULL WHERE game_id=1').run();
 const newAnalysis=db.prepare('SELECT * FROM analyses WHERE game_id=1').get();
 assert.equal(newAnalysis.moves_json,JSON.stringify(a2.moves));
 assert.equal(newAnalysis.prose_json,null);
 const backendNow=await getReview();
 const changedDetail=await getGame();
 assert.deepEqual(backendNow.body,{review:null});
 assert.equal(changedDetail.body.game.pgn,secondPgn);
 assert.equal(changedDetail.body.analysis.moves_json,JSON.stringify(a2.moves));
 observed.changedBackend={new_pgn_sha256:sha(secondPgn),new_ply_count:7,
  new_analysis_accuracy_white:a2.accuracy_white,
  new_analysis_move_count:a2.moves.length,
  real_server_new_game_pgn:changedDetail.body.game.pgn===secondPgn,
  real_server_new_analysis_moves:changedDetail.body.analysis.moves_json===JSON.stringify(a2.moves),
  real_server_cached_report_null:backendNow.body.review===null,
  server_response_status:backendNow.status};
 observed.changedBookmark=await bookmarkClick();
 await browser.wait(`document.querySelector('[data-move-transport]')?.innerText?.includes('/ 7')`,
  'real_react_query_refetch_new_move_count',6800);
 observed.afterSourceReportUI=await browserUI();
 assert.equal(observed.afterSourceReportUI.moveCount?.includes('/ 7'),true);
 assert.equal(observed.afterSourceReportUI.reportTabSelected,'true');
 // The actual SAN move list is located only in the Moves tab; do not claim
 // it is visible inside the Report tab. Switching tabs also independently
 // challenges whether stale React parent state survives a report remount.
 await browser.click('#review-tab-moves');
 await browser.wait(`document.body.innerText.includes('Qxf7')`,
  'real_new_PGN_SAN_visible_in_moves_tab',5000);
 observed.afterSourceMovesUI=await browserUI();
 assert.equal(observed.afterSourceMovesUI.newMate,true);
 await browser.click('#review-tab-report');
 await browser.wait(`document.querySelector('#review-tab-report')?.getAttribute('aria-selected')==='true'`,
  'report_tab_returned_after_real_source_refetch',3000);
 observed.afterSourceUI=await browserUI();
 observed.realGameDetailGetNetworkIds=observedRequests().map(x=>x.id);
 assert.equal(observed.afterSourceUI.moveCount?.includes('/ 7'),true);
 assert.equal(observed.afterSourceUI.reportTabSelected,'true');
 assert(observed.realGameDetailGetNetworkIds.length>=3,
  'initial, harmless and new-source GET did not occur on real network');
 if(fault==='remount-client'){
  // QA-only negative control: force the correctly reset UI path. Because
  // GET review now returns null, remounting this same game must clear the
  // old source report. The old UI bug assertion below MUST fail.
  await navAndClickReport(origin);
  await browser.wait(`!document.body.innerText.includes(${JSON.stringify(marker)})`,
   'negative_control_remount_clears_stale_report',6500);
  observed.remountFaultExercised=true;
  observed.afterSourceUI=await browserUI();
 }
 assert.equal(observed.afterSourceUI.oldText,true,
  'the stale report was NOT still visible; product may have been fixed');
 // Positive control: a hard navigation clears the old component state, and
 // the real now-null backend does not offer the old report to the new tab.
 await navAndClickReport(origin);
 await browser.wait(`!document.body.innerText.includes(${JSON.stringify(marker)})`,
  'hard_navigation_discarded_old_prose',6500);
 observed.afterHardNavigationUI=await browserUI();
 assert.equal(observed.afterHardNavigationUI.oldText,false);
 assert.equal(observed.afterHardNavigationUI.writeReportAvailable,true);
 assert.equal(observed.afterHardNavigationUI.moveCount?.includes('/ 7'),true);
 observed.httpNetwork={
  original_cached_review: {status:firstReview.status,summary:firstReview.body.review.summary},
  changed_review:{status:backendNow.status,body:backendNow.body},
  changed_game:{status:changedDetail.status,game_pgn_sha256:sha(changedDetail.body.game.pgn),
   analysis_moves_sha256:sha(changedDetail.body.analysis.moves_json)},
 };
 observed.browserExceptions=browser.events.filter(x=>x.method==='Runtime.exceptionThrown')
  .map(x=>x.params.exceptionDetails?.text||'runtime exception');
 assert.deepEqual(observed.browserExceptions,[]);
 observed.chrome_version=execFileSync(cli.chrome||'/usr/bin/google-chrome',['--version'],{encoding:'utf8'}).trim();
}catch(err){error=err instanceof Error?(err.stack||err.message):String(err);
 try{observed.failureBrowserState=browser?await browserUI():null;}catch(e){observed.diagnostic_failure=String(e);}
}finally{
 if(browser)await browser.dispose().catch(()=>{});
 if(vite)await within(vite.close(),3600,'vite_close').catch(()=>{});
 process.chdir(oldCwd);
 if(server){server.closeAllConnections();await within(new Promise(ok=>server.close(ok)),1900,'api_close').catch(()=>{});}
 try{db?.close();}catch{}
 rmSync(scratch,{recursive:true,force:true});
}
const packet={schema_version:1,at_utc:new Date().toISOString(),run_id:runId,
 previous_checkpoint:'29af85a72963824ba3a9308dd50afed13302a71b',
 product_candidate_sha:productSha,backend_candidate_sha:backendSha,
 stockfish_sha256:engineSha,manifest_sha256:manifestSha,
 fixture_id:fixture.fixture_id,fixture_sha256:fixture.pgn_sha256,
 alternate_source_pgn:secondPgn,alternate_source_sha256:sha(secondPgn),
 scenario:'same game route, bookmark-triggered React Query refetch, source reanalysis, null backend report',
 test_only_fault:fault,qa_status:error?'fail':'pass',qa_error:error,
 observations:observed,elapsed_ms:Date.now()-started,
 stockfish_calls:2,engine_depth:8,engine_threads:1,engine_hash_mib:16,
 local_vite_and_chrome:true,auth_signed_local_session:true,
 self_authored_games_only:true,db_disposable:true,
 product_fully_certified:false,release_approved:false};
const output=join(results,fault?'browser-source-refresh-fault.json':'browser-source-refresh.json');
writeFileSync(output,JSON.stringify(packet,null,2)+'\n');
console.log(JSON.stringify({file:output,run_id:runId,qa_status:packet.qa_status,
 source_changed:observed.changedBackend||null,initial:observed.initialUI||null,
 after_refetch:observed.afterSourceUI||null,after_navigation:observed.afterHardNavigationUI||null,
 get_requests:observed.realGameDetailGetNetworkIds?.length||null,
 qa_error:error,release_approved:false},null,2));
if(error)process.exitCode=1;
