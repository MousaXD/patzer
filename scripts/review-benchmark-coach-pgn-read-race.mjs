#!/usr/bin/env node
/** Agent D: real authenticated GET cached Game Review after real PvP-style PGN
 * persistence changes the game source without changing its stored analysis.
 * Uses owner route, SQLite schema, generated no-LLM product prose and CAS;
 * no product source changes, actual WebSocket, live game or production DB. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync,mkdirSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {Chess} from 'chess.js';
import {Hono} from 'hono';

const root=resolve(import.meta.dirname,'..'),qa=join(root,'qa/review-excellence');
const outputDir=join(qa,'results');mkdirSync(outputDir,{recursive:true});
const args=Object.fromEntries(process.argv.slice(2).map(s=>{
 const i=s.indexOf('=');return i<0?[s.slice(2),true]:[s.slice(2,i),s.slice(i+1)];
}));
assert(Object.keys(args).every(x=>x==='run-id'||x==='candidate'),
 'unrecognized QA-only argument');
const runId=args['run-id']||randomUUID();
assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId));
const sha=d=>createHash('sha256').update(d).digest('hex');
const candidate=realpathSync(args.candidate||join(outputDir,'worktree-coach'));
assert(relative(outputDir,candidate).startsWith('worktree-')&&
 relative(outputDir,candidate).split('/').length===1,
 'candidate must be an isolated detached QA worktree');
const candidateSHA=execFileSync('git',['rev-parse','HEAD'],{cwd:candidate,encoding:'utf8'}).trim();
assert.equal(candidateSHA,'19c359ec3feb8e3c10c33415c403eaf5ab3d6c87');
const manifest=readFileSync(join(qa,'manifests/manifest-v2.jsonl'),'utf8');
assert.equal(sha(manifest),'2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44');
const fixture=manifest.trim().split('\n').map(JSON.parse)
 .find(x=>x.fixture_id==='SYN-GAME-FOOLS-MATE');
assert(fixture?.source_kind==='synthetic'&&fixture.license==='self-authored');
const oldPgn=readFileSync(join(qa,'fixtures',fixture.pgn_file),'utf8');
assert.equal(sha(oldPgn),fixture.pgn_sha256);
const oldChess=new Chess();oldChess.loadPgn(oldPgn,{strict:true});
assert(oldChess.isCheckmate()&&oldChess.turn()==='w');
const newChess=new Chess();
for(const move of ['e4','e5','Qh5','Nc6','Bc4','Nf6','Qxf7#'])newChess.move(move);
newChess.header('Event','QA synthetic opposite winner');newChess.header('Result','1-0');
const newPgn=newChess.pgn();
assert(newChess.isCheckmate()&&newChess.turn()==='b');
assert.notEqual(sha(newPgn),sha(oldPgn));
const websocketSource=readFileSync(join(candidate,'server/src/ws/play.ts'),'utf8');
assert(websocketSource.includes('UPDATE games SET white_time_ms = ?, black_time_ms = ?, last_move_at = ?, pgn = ?')&&
 websocketSource.includes('WHERE external_id = ?'),
 'tested production-equivalent PvP PGN persistence SQL no longer exists');

const tmp=mkdtempSync(join(outputDir,'pgn-read-freshness-'));
process.env.DB_PATH=join(tmp,'qa-only.db');
process.env.SESSION_SECRET='qa-source-freshness-throwaway-secret';
process.env.NODE_ENV='test';process.env.OIDC_ENABLED='false';
let db=null;
try{
 const {db:database}=await import(join(candidate,'server/src/db.ts'));
 db=database;
 const {createSession}=await import(join(candidate,'server/src/auth/sessions.ts'));
 const {buildGameReview,REVIEW_PROSE_VERSION}=await import(join(candidate,'server/src/coach/review.ts'));
 const {saveReviewIfFresh}=await import(join(candidate,'server/src/coach/reviewCache.ts'));
 const {SCORING_VERSION}=await import(join(candidate,'server/src/chess/classifier.ts'));
 const reviewRouter=(await import(join(candidate,'server/src/routes/review.ts'))).default;
 const gameRouter=(await import(join(candidate,'server/src/routes/games.ts'))).default;
 const api=new Hono();api.route('/api/games',gameRouter);api.route('/api/games',reviewRouter);
 for(let i=1;i<=2;i++){
  db.prepare('INSERT INTO users(id,username,password_hash,role) VALUES(?,?,?,?)')
   .run(i,'qa-user-'+i,'qa-not-a-credential','user');
  db.prepare('INSERT INTO profiles(user_id,display_name,language,audience) VALUES (?,?,?,?)')
   .run(i,'Synthetic '+i,'en','beginner');
 }
 const gameExternalId='qa-pvp-external-id';
 db.prepare('INSERT INTO games(id,user_id,source,external_id,pgn,user_color) VALUES (?,?,?,?,?,?)')
  .run(1,1,'pvp',gameExternalId,oldPgn,'white');
 db.prepare('INSERT INTO analyses(game_id,depth,scoring_version,moves_json,accuracy_white,accuracy_black) VALUES(?,?,?,?,?,?)')
  .run(1,8,SCORING_VERSION,'[]',16,92);
 const analysis={depth:8,accuracy_white:16,accuracy_black:92,
  estimated_elo_white:null,estimated_elo_black:null,
  performance_white:null,performance_black:null,
  opening_eco:null,opening_name:null,phase_split:null,key_moments:[],moves:[]};
 const review=await buildGameReview({pgn:oldPgn,analysis,language:'en',audience:'beginner',
  userColor:'white',llmEnabled:false});
 assert.equal(review.version,REVIEW_PROSE_VERSION);
 assert.equal(review.language,'en');
 const initial=db.prepare('SELECT * FROM analyses WHERE game_id=1').get();
 const oldSource={pgn:oldPgn,user_color:'white',user_id:1};
 const firstSave=saveReviewIfFresh(db,1,initial,oldSource,review,'en','beginner');
 assert.equal(firstSave,true,'product CAS refused initial correct synthetic report');
 const tokenOwner=createSession(1),tokenOther=createSession(2);
 const auth=cookie=>({Cookie:'chess_session='+cookie});
 const get=async(cookie)=>{
  const r=await api.request('http://localhost/api/games/1/review',{headers:auth(cookie)});
  return {status:r.status,body:await r.json()};
 };
 const getGame=async(cookie)=>{
  const r=await api.request('http://localhost/api/games/1',{headers:auth(cookie)});
  return {status:r.status,body:await r.json()};
 };
 const noAuth=await get('');
 const wrongUser=await get(tokenOther);
 assert.equal(noAuth.status,401);
 assert.equal(wrongUser.status,404);
 const original=await get(tokenOwner);
 assert.equal(original.status,200);
 assert.deepEqual(original.body.review,review);
 const originalDetail=await getGame(tokenOwner);
 assert.equal(originalDetail.status,200);
 assert.equal(originalDetail.body.game.pgn,oldPgn);
 assert.equal(originalDetail.body.analysis.accuracy_white,16);
 // User-visible notes and bookmarks update the game row but do not change
 // review evidence; these are legitimate cache hits, not false staleness.
 db.prepare('UPDATE games SET notes = ?, bookmarked = ? WHERE id=1')
  .run('qa-note-only',1);
 const harmless=await get(tokenOwner);
 assert.deepEqual(harmless.body.review,review);
 // Equivalent to the real persistPvpClocks() SQL, on disposable records only.
 const pvpUpdate=db.prepare(`UPDATE games
  SET white_time_ms = ?, black_time_ms = ?, last_move_at = ?, pgn = ?
  WHERE external_id = ?`).run(120_000,120_000,'2026-01-01T00:00:00.000Z',
    newPgn,gameExternalId);
 assert.equal(pvpUpdate.changes,1);
 const fromDb=db.prepare('SELECT pgn FROM games WHERE id=1').get();
 assert.equal(fromDb.pgn,newPgn);
 const changed=await get(tokenOwner);
 const changedGame=await getGame(tokenOwner);
 assert.equal(changed.status,200);
 assert.equal(changedGame.status,200);
 assert.equal(changedGame.body.game.pgn,newPgn);
 assert.equal(changedGame.body.analysis.accuracy_white,16);
 const unmarkedEscaped=JSON.stringify(changed.body.review)===JSON.stringify(review)&&
  changed.body.stale!==true;
 const oldWriterAccepted=saveReviewIfFresh(db,1,initial,oldSource,review,'en','beginner');
 assert.equal(oldWriterAccepted,false,'product CAS accepted original snapshot after PGN change');
 // Scoring-version marker is a documented partial mitigation. A correctly
 // matching marker MUST NOT be mistaken for PGN freshness.
 const markedReview={...review,accuracy_model_version:SCORING_VERSION};
 db.prepare('UPDATE analyses SET prose_json=? WHERE game_id=1')
  .run(JSON.stringify(markedReview));
 const markedAfterPgn=await get(tokenOwner);
 const markedEscaped=JSON.stringify(markedAfterPgn.body.review)===JSON.stringify(markedReview)&&
  markedAfterPgn.body.stale!==true;
 db.prepare('UPDATE analyses SET prose_json=? WHERE game_id=1')
  .run(JSON.stringify({...markedReview,accuracy_model_version:SCORING_VERSION-1}));
 const staleScoring=await get(tokenOwner);
 assert.equal(staleScoring.body.review,null);
 assert.equal(staleScoring.body.stale,true);
 db.prepare('UPDATE analyses SET prose_json=? WHERE game_id=1')
  .run(JSON.stringify(markedReview));
 db.prepare("UPDATE profiles SET language='ru' WHERE user_id=1").run();
 const languageChanged=await get(tokenOwner);
 assert.equal(languageChanged.body.review,null);
 assert.equal(languageChanged.body.stale,true);
 db.prepare("UPDATE profiles SET language='en',audience='advanced' WHERE user_id=1").run();
 const audienceChanged=await get(tokenOwner);
 assert.equal(audienceChanged.body.review,null);
 assert.equal(audienceChanged.body.stale,true);
 db.prepare("UPDATE profiles SET language='en',audience='beginner' WHERE user_id=1").run();
 // Restore original PGN while keeping source analysis unchanged: a genuinely
 // matching original game still returns the cached prose.
 db.prepare('UPDATE games SET pgn=? WHERE id=1').run(oldPgn);
 const restored=await get(tokenOwner);
 assert.deepEqual(restored.body.review,markedReview);
 // Different user-color changes generated prose orientation but GET doesn't
 // validate the color either (independent of PGN and scoring markers).
 db.prepare("UPDATE games SET user_color='black' WHERE id=1").run();
 const flipped=await get(tokenOwner);
 const colorEscaped=JSON.stringify(flipped.body.review)===JSON.stringify(markedReview)&&
  flipped.body.stale!==true;
 const colorOldWriterAccepted=saveReviewIfFresh(db,1,initial,oldSource,review,'en','beginner');
 assert.equal(colorOldWriterAccepted,false);
 db.prepare('UPDATE analyses SET prose_json=NULL WHERE game_id=1').run();
 const empty=await get(tokenOwner);
 assert.equal(empty.body.review,null);
 const cleanNoAuth=await getGame('');
 const cleanOther=await getGame(tokenOther);
 assert.equal(cleanNoAuth.status,401);
 assert.equal(cleanOther.status,404);
 const evidence={schema_version:1,at_utc:new Date().toISOString(),run_id:runId,
  prior_checkpoint:'5566180bd6196880a64f6a3cc71938b13769f7d7',
  source_candidate_sha:candidateSHA,manifest_sha256:sha(manifest),
  fixture:fixture.fixture_id,fixture_sha256:fixture.pgn_sha256,
  alternate_source_pgn:newPgn,alternate_source_sha256:sha(newPgn),
  old_pgn_sha256:sha(oldPgn),old_winner:'black',new_winner:'white',
  original_prose_sha256:sha(JSON.stringify(review)),
  marked_prose_sha256:sha(JSON.stringify(markedReview)),
  product_review_version:REVIEW_PROSE_VERSION,
  scoring_version:SCORING_VERSION,source_is_synthetic:true,
  actual_code_paths:['buildGameReview','saveReviewIfFresh','GET /api/games/:id/review',
   'GET /api/games/:id','persistPvpClocks-equivalent SQLite source UPDATE'],
  observations:{
   no_auth_status:noAuth.status,other_user_status:wrongUser.status,
   no_auth_detail_status:cleanNoAuth.status,other_user_detail_status:cleanOther.status,
   original_status:original.status,original_cache_matches:JSON.stringify(original.body.review)===JSON.stringify(review),
   harmless_notes_and_bookmark_preserve_cache:JSON.stringify(harmless.body.review)===JSON.stringify(review),
   pvp_pgn_update_writes: pvpUpdate.changes,
   owner_game_detail_shows_changed_pgn:changedGame.body.game.pgn===newPgn,
   owner_game_detail_still_shows_previous_analysis:changedGame.body.analysis.accuracy_white===16,
   changed_pgn_get_status:changed.status,changed_pgn_get_stale:changed.body.stale===true,
   previous_unmarked_cache_escaped_after_pgn_change:unmarkedEscaped,
   previous_marked_cache_escaped_after_pgn_change:markedEscaped,
   stale_write_source_pgn_blocked:oldWriterAccepted===false,
   stale_write_source_color_blocked:colorOldWriterAccepted===false,
   previous_marked_cache_escaped_after_color_change:colorEscaped,
   scoring_marker_mismatch_marked_stale:staleScoring.body.stale===true,
   language_mismatch_marked_stale:languageChanged.body.stale===true,
   audience_mismatch_marked_stale:audienceChanged.body.stale===true,
   restored_source_cache_matches:JSON.stringify(restored.body.review)===JSON.stringify(markedReview),
   null_cache_not_returned:empty.body.review===null,
  },
  // Retain actual body evidence rather than trusting only self-reported flags.
  // All game/profile/session data in these bodies was generated inside this
  // run's throwaway database. Never serialize cookies or session tokens.
  http_evidence:{
   unauthenticated_review:noAuth,
   other_user_review:wrongUser,
   unauthenticated_game:cleanNoAuth,
   other_user_game:cleanOther,
   original_review:original,
   harmless_metadata_review:harmless,
   after_pgn_edit_review:changed,
   after_pgn_edit_game:{status:changedGame.status,
    body:{game:{pgn:changedGame.body.game.pgn,
     user_color:changedGame.body.game.user_color},
     analysis:{accuracy_white:changedGame.body.analysis.accuracy_white,
      scoring_version:changedGame.body.analysis.scoring_version}}},
   after_marked_prose_pgn_edit_review:markedAfterPgn,
   after_scoring_mismatch:staleScoring,
   after_language_mismatch:languageChanged,
   after_audience_mismatch:audienceChanged,
   after_restored_pgn:restored,
   after_user_color_flip:flipped,
   after_cache_cleared:empty,
  },
  product_cache_certified:false,release_approved:false,
  limits:['The PGN persistence uses exact PvP SQL on a disposable DB; a live browser websocket is not invoked',
   'Only one synthetic owner game and one synthetic isolated non-owner; not a statistical production survey',
   'Plausible game source mutation after a cached review; not a claim that every game is analyzed while in progress',
   'User-color mutation is a controlled source edit; no product endpoint directly flips imported game perspective',
   'No actual Stockfish analysis or hosted model: buildGameReview used deterministic fallback']};
 const outfile=join(outputDir,'coach-pgn-read-freshness.json');
 writeFileSync(outfile,JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({file:outfile,run_id:runId,
  src_candidate_sha:candidateSHA,
  observations:evidence.observations,
  release_approved:false},null,2));
}finally{
 try{db?.close();}catch{}
 rmSync(tmp,{recursive:true,force:true});
}
