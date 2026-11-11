#!/usr/bin/env node
// Bounded read-path comparison; synthetic aggregate-only provenance is NEVER
// submitted for engine/review generation. Run baseline and candidate separately.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
const candidate = resolve(process.argv[2]);
const scratch = mkdtempSync(join(tmpdir(), 'patzer-read-budget-'));
Object.assign(process.env, { DB_PATH: join(scratch, 'test.db'), SESSION_SECRET: 'synthetic-read-budget',
  OIDC_ISSUER: '', OIDC_CLIENT_ID: '' });
const mod = (file) => import(pathToFileURL(join(candidate, file)).href);
let db;
try {
  ({ db } = await mod('server/src/db.ts'));
  const { createSession } = await mod('server/src/auth/sessions.ts');
  const { SCORING_VERSION } = await mod('server/src/chess/classifier.ts');
  const games = (await mod('server/src/routes/games.ts')).default;
  const insights = (await mod('server/src/routes/insightsV2.ts')).default;
  db.prepare("INSERT INTO users(id,username,password_hash,role) VALUES(1,'synthetic','unused','user')").run();
  db.prepare("INSERT INTO profiles(user_id,display_name) VALUES(1,'Synthetic')").run();
  const insert = db.prepare(`INSERT INTO games(id,user_id,source,pgn,result,user_color,end_time)
    VALUES(?,1,'imported','1. e4 e5 *','win','white',?)`);
  const score = db.prepare(`INSERT INTO analyses(game_id,depth,moves_json,scoring_version,accuracy_white,
    source_hash,source_revision,analysis_generation) VALUES(?,8,'[]',?,80,'synthetic-aggregation-only',0,1)`);
  db.transaction(() => {
    for (let i = 1; i <= 20000; i++) {
      insert.run(i, new Date(1700000000000 + i * 1000).toISOString());
      if (i % 4 === 0) score.run(i, SCORING_VERSION);
    }
  })();
  const headers = { Cookie: `chess_session=${createSession(1)}` };
  const output = {};
  for (const [name, route, url] of [['library', games, '/?analyzed=1&limit=50'], ['insights', insights, '/']]) {
    const times = [];
    for (let i = 0; i < 65; i++) {
      const start = performance.now();
      const response = await route.request(url, { headers });
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(name === 'library' ? data.total : data.games_analyzed, 5000);
      if (i >= 5) times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    output[name] = { samples: times.length, p50_ms: times[29], p95_ms: times[56], max_ms: times.at(-1) };
  }
  console.log(JSON.stringify({ candidate, games: 20000, analyses: 5000, ...output }, null, 2));
} finally { db?.close(); rmSync(scratch, { recursive: true, force: true }); }
