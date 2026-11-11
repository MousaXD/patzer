#!/usr/bin/env node
/** Independent source-consistency certification of real combined Patzer routes.
 * No owner-source edits. Every account, game, cookie and database is synthetic.
 * Fails unless cached reports AND engine analyses agree on authoritative source.
 * Historical Checkpoints 32-35 are neither imported nor modified. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Hono } from 'hono';

const candidate = resolve(process.argv[2] || '');
assert(process.argv[2], 'Provide an explicit isolated candidate path');
const stockfish = process.env.PATZER_TEST_STOCKFISH;
assert(stockfish, 'Set PATZER_TEST_STOCKFISH to a bounded local engine');
const stockfishDigest = createHash('sha256').update(readFileSync(stockfish)).digest('hex');
const candidateSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidate, encoding: 'utf8' }).trim();
const tmp = mkdtempSync(join(tmpdir(), 'patzer-b3-fixed-'));
process.env.DB_PATH = join(tmp, 'throwaway.sqlite');
process.env.SESSION_SECRET = 'qa-ephemeral-batch3-signing-secret';
process.env.ENGINE_BACKEND = 'local';
process.env.STOCKFISH_PATH = stockfish;
process.env.STOCKFISH_THREADS = '1';
process.env.STOCKFISH_HASH = '16';
process.env.OIDC_ENABLED = 'false';
process.env.NODE_ENV = 'test';
const mod = (path) => import(pathToFileURL(join(candidate, path)).href);
const A = '1. f3 e5 2. g4 Qh4# 0-1';
const B = '1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0';
const P = '1. e4 e5 2. Nf3 Nc6 *';
const Q = '1. d4 d5 2. Nf3 Nf6 *';
assert.equal(P.length, Q.length, 'same-byte-length PGN attack fixture must really match');
const cases = [];
let db;
const check = (name, success, detail = {}) => {
  cases.push({ name, pass: !!success, detail });
  return !!success;
};
const parseSSE = (raw) => [...raw.matchAll(/^event:\s*([^\r\n]+)[\s\S]*?^data:\s*([^\r\n]+)/gm)]
  .map(([, name, data]) => ({ name, data }));
try {
  ({ db } = await mod('server/src/db.ts'));
  const { createSession } = await mod('server/src/auth/sessions.ts');
  const analyzeRoute = (await mod('server/src/routes/analyze.ts')).default;
  const gameRoute = (await mod('server/src/routes/games.ts')).default;
  const reviewRoute = (await mod('server/src/routes/review.ts')).default;
  const api = new Hono();
  api.route('/api/analyze', analyzeRoute);
  api.route('/api/games', gameRoute);
  api.route('/api/games', reviewRoute);
  for (const id of [1, 2]) {
    db.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(id, `qa-user-${id}`, 'synthetic-do-not-use', 'user');
    db.prepare('INSERT INTO profiles (user_id, display_name, language, audience) VALUES (?, ?, ?, ?)')
      .run(id, `Synthetic ${id}`, 'en', 'beginner');
  }
  db.prepare("INSERT INTO games(id,user_id,source,pgn,user_color,result) VALUES(1,1,'imported',?,'white','loss')").run(A);
  db.prepare("INSERT INTO games(id,user_id,source,pgn,user_color,result) VALUES(2,1,'imported',?,'white',NULL)").run(P);
  const owner = 'chess_session=' + createSession(1);
  const other = 'chess_session=' + createSession(2);
  const request = async (path, { method = 'GET', cookie = owner, body } = {}) => {
    const headers = cookie ? { Cookie: cookie } : {};
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['X-Requested-With'] = 'patzer';
    }
    if (method === 'POST' && body === undefined) headers['X-Requested-With'] = 'patzer';
    const response = await api.request('http://127.0.0.1' + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await response.text();
    let json = null;
    try { json = JSON.parse(raw); } catch { /* SSE payload */ }
    return { status: response.status, json, raw, events: parseSSE(raw) };
  };
  const detail = (id = 1, cookie = owner) => request(`/api/games/${id}`, { cookie });
  const report = (id = 1, cookie = owner) => request(`/api/games/${id}/review`, { cookie });
  const generate = (id = 1, cookie = owner) => request(`/api/games/${id}/review`, { method: 'POST', cookie });
  const analyze = (id = 1) => request('/api/analyze', { method: 'POST', body: { game_id: id, depth: 8, force: false } });
  const getRow = (id = 1) => db.prepare('SELECT source_hash, source_revision, analysis_generation, prose_json FROM analyses WHERE game_id=?').get(id);
  const revision = () => db.prepare('SELECT source_revision FROM games WHERE id=1').get().source_revision;
  const initial = await analyze();
  assert.equal(initial.status, 200, `Initial analysis failed: ${initial.raw}`);
  assert.equal(initial.json.cached, false);
  const firstReport = await generate();
  assert.equal(firstReport.status, 200, firstReport.raw);
  assert.match(firstReport.raw, /event: done/, 'Normal fresh review must succeed');
  const initiallyFresh = await report();
  assert(initiallyFresh.json?.review?.source_integrity, 'Normal cached review was not stamped');
  check('normal fresh cached review and matching engine', (await detail()).json.analysis_stale === false);
  const generationAtStart = getRow().analysis_generation;
  const revisionAtStart = revision();
  db.prepare('UPDATE games SET notes=?, bookmarked=? WHERE id=1').run('qa harmless note', 1);
  check('notes/bookmark do not invalidate cache',
    revision() === revisionAtStart && (await report()).json?.review?.source_integrity === initiallyFresh.json.review.source_integrity);
  const anonymous = await report(1, '');
  const crossUserGet = await report(1, other);
  const crossUserPost = await generate(1, other);
  check('review account isolation', anonymous.status === 401 && crossUserGet.status === 404 && crossUserPost.status === 404,
    { anonymous: anonymous.status, cross_user_get: crossUserGet.status, cross_user_post: crossUserPost.status });

  db.prepare('UPDATE games SET pgn=?, result=? WHERE id=1').run(B, 'win');
  const detailB = await detail();
  const reportB = await report();
  const postB = await generate();
  check('A to B invalidates engine, GET prose, and new POST',
    detailB.json?.analysis_stale === true && detailB.json?.analysis === null &&
    reportB.json?.review === null && reportB.json?.stale === true &&
    postB.status === 409 && !postB.raw.includes('event: done'),
    { engine_stale: detailB.json?.analysis_stale, review_stale: reportB.json?.stale, post: postB.status });
  db.prepare('UPDATE games SET pgn=?, result=? WHERE id=1').run(A, 'loss');
  const abaRevision = revision();
  const detailAba = await detail();
  const reportAba = await report();
  const postAba = await generate();
  const listAba = await request('/api/games?limit=20');
  const listed = listAba.json?.games?.find((g) => g.id === 1);
  check('ABA authoritative engine revision', abaRevision === revisionAtStart + 2 && detailAba.json?.analysis_stale === true,
    { first: revisionAtStart, restored: abaRevision, engine_stale: detailAba.json?.analysis_stale });
  check('ABA cached GET fails closed', reportAba.json?.review === null && reportAba.json?.stale === true,
    { status: reportAba.status, stale: reportAba.json?.stale, resurrected: !!reportAba.json?.review });
  check('ABA new report POST refuses old evidence', postAba.status === 409 && !postAba.raw.includes('event: done'),
    { status: postAba.status, emitted_done: postAba.raw.includes('event: done') });
  check('ABA list does not advertise stale analysis', listed?.analyzed === 0 || listed?.analyzed === false,
    { list_analyzed: listed?.analyzed, list_accuracy_white: listed?.accuracy_white });

  const reanalyzed = await analyze();
  const validNewRow = getRow();
  const afterRecoveryGet = await report();
  const regenerated = await generate();
  const afterRecovery = await report();
  check('reanalysis refreshes revision/generation and clears old prose',
    reanalyzed.status === 200 && reanalyzed.json?.cached === false &&
    validNewRow.source_revision === abaRevision && validNewRow.analysis_generation > generationAtStart &&
    afterRecoveryGet.json?.review === null,
    { cached: reanalyzed.json?.cached, new_analysis_revision: validNewRow.source_revision,
      generation_before: generationAtStart, generation_after: validNewRow.analysis_generation });
  check('regeneration restores verified current report', regenerated.status === 200 &&
    regenerated.raw.includes('event: done') && !!afterRecovery.json?.review &&
    (await detail()).json?.analysis_stale === false,
    { status: regenerated.status, persisted: !!afterRecovery.json?.review });

  const legacyRow = getRow();
  db.prepare('UPDATE analyses SET prose_json=? WHERE game_id=1').run('{"summary":"legacy with no source identity"}');
  const legacy = await report();
  check('unmarked legacy cached prose fails closed', legacy.json?.review === null && legacy.json?.stale === true,
    { stale: legacy.json?.stale });
  db.prepare('UPDATE analyses SET prose_json=? WHERE game_id=1').run(legacyRow.prose_json);

  const equalInitial = await analyze(2);
  assert.equal(equalInitial.status, 200, equalInitial.raw);
  db.prepare('UPDATE games SET pgn=? WHERE id=2').run(Q);
  const equalOld = await detail(2);
  const equalUpdated = await analyze(2);
  const equalDetail = await detail(2);
  check('same-byte-length and equal-ply different PGN forces fresh engine analysis',
    equalOld.json?.analysis_stale === true && equalUpdated.json?.cached === false &&
    equalDetail.json?.analysis_stale === false && equalDetail.json?.analysis?.moves_json !== undefined,
    { pgn_bytes: P.length, cached: equalUpdated.json?.cached, stale_before: equalOld.json?.analysis_stale,
      stale_after: equalDetail.json?.analysis_stale });
  // An analysis can be deliberately regenerated for the SAME PGN and settings.
  // An earlier report still in flight must not sneak across the newer analysis
  // generation. created_at has whole-second precision; this checks the real
  // product CAS, without stubbing the DB or modifying any owner implementation.
  const { analyzePgn, saveAnalysis } = await mod('server/src/routes/analyze.ts');
  const { loadAnalysisGameSource } = await mod('server/src/chess/analysisSource.ts');
  const { buildGameReview } = await mod('server/src/coach/review.ts');
  const { saveReviewIfFresh } = await mod('server/src/coach/reviewCache.ts');
  const sameGame = db.prepare(`SELECT pgn,user_color,user_id,result,start_fen,
    opponent_rating_before,user_rd_before,source_revision AS current_source_revision
    FROM games WHERE id=2`).get();
  const sameSource = loadAnalysisGameSource(db, 2);
  const sameAnalysis = await analyzePgn(Q, 8);
  const oldProse = await buildGameReview({ pgn: Q, analysis: sameAnalysis,
    language: 'en', audience: 'beginner', userColor: 'white', llmEnabled: false });
  // Establish that this complete snapshot is admitted before the race. Without
  // this control a missing game field could make every CAS return false.
  const admitted = db.prepare('SELECT * FROM analyses WHERE game_id=2').get();
  assert.equal(saveReviewIfFresh(db, 2, admitted, sameGame, oldProse, 'en', 'beginner', true), true);
  assert((await report(2)).json?.review, 'Positive CAS control must be readable');
  assert.equal(saveAnalysis(2, sameAnalysis, sameSource), true);
  let beforeGeneration;
  let afterGeneration;
  let equalTimestamp = false;
  for (let attempt = 0; attempt < 3 && !equalTimestamp; attempt++) {
    beforeGeneration = db.prepare('SELECT * FROM analyses WHERE game_id=2').get();
    assert.equal(saveAnalysis(2, sameAnalysis, sameSource), true);
    afterGeneration = db.prepare('SELECT * FROM analyses WHERE game_id=2').get();
    equalTimestamp = beforeGeneration.created_at === afterGeneration.created_at;
  }
  assert(equalTimestamp, 'Could not construct the real same-second analysis-generation race');
  assert.equal(afterGeneration.analysis_generation, beforeGeneration.analysis_generation + 1);
  assert.equal(afterGeneration.source_revision, beforeGeneration.source_revision);
  assert.equal(afterGeneration.moves_json, beforeGeneration.moves_json);
  const oldGenerationAccepted = saveReviewIfFresh(db, 2, beforeGeneration, sameGame,
    oldProse, 'en', 'beginner', true);
  const generationRead = await report(2);
  check('old-generation report CAS and GET fail closed after same-source reanalysis',
    oldGenerationAccepted === false && generationRead.json?.review === null,
    { generation_before: beforeGeneration.analysis_generation,
      generation_after: afterGeneration.analysis_generation,
      same_second: equalTimestamp, old_generation_accepted: oldGenerationAccepted,
      old_prose_visible: !!generationRead.json?.review });
  db.prepare('UPDATE analyses SET source_hash=NULL,source_revision=NULL,analysis_generation=0 WHERE game_id=2').run();
  check('legacy NULL engine provenance cannot generate or expose a report',
    (await detail(2)).json?.analysis_stale === true &&
    (await report(2)).json?.stale === true && (await generate(2)).status === 409);
  const output = {
    schema_version: 1,
    candidate_sha: candidateSha,
    stockfish_sha256: stockfishDigest,
    bounded_engine_depth: 8,
    cases,
    pass: cases.filter((item) => item.pass).length,
    fail: cases.filter((item) => !item.pass).length,
    release_certified: cases.every((item) => item.pass),
  };
  console.log(JSON.stringify(output, null, 2));
  assert.equal(output.fail, 0, `Release NO-GO: ${output.fail} fixed-behavior assertions failed`);
} finally {
  try { db?.close(); } catch { /* no connection */ }
  rmSync(tmp, { recursive: true, force: true });
}
