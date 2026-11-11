#!/usr/bin/env node
/**
 * Independent five-language REAL Game Review negative control.
 * All fabricated sentences are test-only, authored here; no remote LLM,
 * private games, real users, external provider or production SQLite.
 *
 * The provided short translated phrases have semantic gold labels set by QA,
 * but no human translation adjudication: don't treat these examples as a
 * sealed holdout, linguistic coverage measurement or model hallucination rate.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,realpathSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {Chess} from 'chess.js';

const root=resolve(import.meta.dirname,'..'),results=join(root,'qa/review-excellence/results');
mkdirSync(results,{recursive:true});
const args=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return i<0?[x.slice(2),true]:[x.slice(2,i),x.slice(i+1)];}));
const app=realpathSync(args['app-root']||join(results,'worktree-coach'));
if(!app.startsWith(join(results,'worktree-')))throw Error('Use only a detached QA candidate worktree');
const engine=realpathSync(args.engine||join(results,'engine/unpacked/usr/games/stockfish'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const engineSha=sha(readFileSync(engine));
if(!/^[a-f0-9]{64}$/.test(args['engine-sha256']||''))throw Error('approved --engine-sha256 required');
assert.equal(engineSha,args['engine-sha256'],'unapproved engine executable');
const manifestPath=join(root,'qa/review-excellence/manifests/manifest-v2.jsonl');
const manifest=readFileSync(manifestPath,'utf8');
const entry=manifest.trim().split('\n').map(JSON.parse).find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(entry?.source_kind==='synthetic'&&entry.license==='self-authored');
const pgn=readFileSync(join(root,'qa/review-excellence/fixtures',entry.pgn_file),'utf8');
assert.equal(sha(pgn),entry.pgn_sha256);
const chess=new Chess();chess.loadPgn(pgn,{strict:true});
assert(chess.isCheckmate()&&chess.turn()==='w','Black must be the actual winner');
const userKing='e1',falseKing='e2';
assert.equal(chess.get(userKing)?.type,'k');
assert.equal(chess.get(userKing)?.color,'w');
assert.notEqual(chess.get(falseKing)?.type,'k');

const phrases={
 en:{trueSummary:'Black won the game.',falseSummary:'White won the game.',
  trueMoment:"White's king is on e1.",falseMoment:"White's king is on e2."},
 es:{trueSummary:'Las negras ganaron la partida.',falseSummary:'Las blancas ganaron la partida.',
  trueMoment:'El rey blanco está en e1.',falseMoment:'El rey blanco está en e2.'},
 de:{trueSummary:'Schwarz hat die Partie gewonnen.',falseSummary:'Weiß hat die Partie gewonnen.',
  trueMoment:'Der weiße König steht auf e1.',falseMoment:'Der weiße König steht auf e2.'},
 bg:{trueSummary:'Черните спечелиха партията.',falseSummary:'Белите спечелиха партията.',
  trueMoment:'Белият цар е на e1.',falseMoment:'Белият цар е на e2.'},
 ru:{trueSummary:'Черные выиграли партию.',falseSummary:'Белые выиграли партию.',
  trueMoment:'Белый король стоит на e1.',falseMoment:'Белый король стоит на e2.'}
};
const work=mkdtempSync(join(results,'coach-i18n-'));
process.env.DB_PATH=join(work,'no-users.db');
process.env.SESSION_SECRET='qa-only-disposable-local';
process.env.ENGINE_BACKEND='local';
process.env.STOCKFISH_PATH=engine;
process.env.STOCKFISH_THREADS='1';
process.env.STOCKFISH_HASH='16';
const start=Date.now();
let requested=0,db=null,restoreEngine=null;
let payload={};
const service=createServer((req,res)=>{
 const url=req.url||'';
 if(req.method==='GET'&&url==='/v1/models'){
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({data:[{id:'qa-local-i18n'}]}));return;
 }
 if(req.method==='POST'&&url==='/v1/chat/completions'){
  let buffer='';
  req.on('data',b=>{buffer+=b;if(buffer.length>100000)req.destroy();});
  req.on('end',()=>{
   try{
    const data=JSON.parse(buffer);
    assert.equal(data.model,'qa-local-i18n');
    requested++;
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify(payload)},finish_reason:'stop'}]}));
   }catch(e){res.writeHead(500);res.end(JSON.stringify({error:String(e)}));}
  });return;
 }
 res.writeHead(404);res.end('not configured');
});
const rows=[];
try{
 await new Promise((resolve,reject)=>{service.once('error',reject);service.listen(0,'127.0.0.1',resolve);});
 const {db:database,setSetting}=await import(join(app,'server/src/db.ts'));
 db=database;
 setSetting('llm_provider','vllm');
 setSetting('vllm_url','http://127.0.0.1:'+service.address().port);
 setSetting('vllm_model','qa-local-i18n');
 const {analyzePgn}=await import(join(app,'server/src/routes/analyze.ts'));
 const {buildGameReview,REVIEW_PROSE_VERSION}=await import(join(app,'server/src/coach/review.ts'));
 const {setCoachEngine}=await import(join(app,'server/src/coach/coaching.ts'));
 const originalEngine=setCoachEngine(async()=>null);
 restoreEngine=()=>setCoachEngine(originalEngine);
 const analysis=await analyzePgn(pgn,8);
 assert.equal(analysis.key_moments.length,1,'expected one replay-verified key moment');
 assert.equal(analysis.key_moments[0].san,'g4');
 for(const [lang,words] of Object.entries(phrases)){
  const input={analysis,pgn,language:lang,audience:'beginner',userColor:'white',llmEnabled:true};
  const make=(summary,prose)=>({title:'QA moment',prose,what_happened:prose,summary,
   skill_assessment:'Test-only',opening_prose:'Recorded opening moves'});
  payload=make(words.trueSummary,words.trueMoment);
  const trueReview=await buildGameReview(input);
  assert(trueReview.summary.includes(words.trueSummary),lang+': harmless winner not passed');
  assert(trueReview.key_moments[0]?.prose.includes(words.trueMoment),lang+': harmless king square not passed');
  payload=make(words.falseSummary,words.falseMoment);
  const falseReview=await buildGameReview(input);
  const escapedWinner=falseReview.summary.includes(words.falseSummary);
  const escapedSquare=!!falseReview.key_moments[0]?.prose.includes(words.falseMoment);
  rows.push({lang,source_truth:{winner:'black',white_king_square:'e1'},
   test_only_assertions:{winner:'white',white_king_square:'e2'},
   true_summary_accepted:true,true_king_square_accepted:true,
   false_winner_accepted:escapedWinner,false_king_square_accepted:escapedSquare,
   generated_summary:falseReview.summary,
   generated_moment:falseReview.key_moments[0]?.prose||null,
   prose_version:REVIEW_PROSE_VERSION,
   consumer_factuality_certified:false});
 }
}finally{
 try{restoreEngine?.();}catch{}
 try{db?.close();}catch{}
 await new Promise(resolve=>service.close(resolve));
 rmSync(work,{recursive:true,force:true});
}
const report={
 schema_version:1,at_utc:new Date().toISOString(),
 candidate_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),
 engine_sha256:engineSha,manifest_sha256:sha(manifest),fixture_id:'SYN-GAME-FOOLS-MATE',
 scope:'real buildGameReview + llm.ts with localhost fake vLLM across five supported locales',
 translations:'QA-authored test-only literal claims, not human expert adjudicated',
 languages_tested:Object.keys(phrases),
 requests:requested,seconds:(Date.now()-start)/1000,
 per_language:rows,
 observed_false_winner_escapes:rows.filter(x=>x.false_winner_accepted).length,
 observed_false_square_escapes:rows.filter(x=>x.false_king_square_accepted).length,
 product_factuality_certified:false,release_approved:false,
 known_limits:['No real LLM; falsity was deliberately injected',
  'Hand-authored short translations only, not representative of natural dialogue',
  'A model may generate additional phrasing not covered by these tests',
  'The detached source is unchanged; this test demonstrates consumer acceptance']
};
const output=join(results,'coach-i18n-real-pipeline.json');
writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({file:output,candidate:report.candidate_sha,languages:report.languages_tested,
 requests:report.requests,false_winner_escapes:report.observed_false_winner_escapes,
 false_square_escapes:report.observed_false_square_escapes,seconds:report.seconds,rows:report.per_language.map(
  x=>({lang:x.lang,winner:x.false_winner_accepted,square:x.false_king_square_accepted}))},null,2));
// This diagnostic returns 0 when the *attack experiment* completes, not when
// the application has passed factuality certification.
assert.equal(rows.length,5);
assert.equal(requested,30,'test failed to exercise all actual review calls');
