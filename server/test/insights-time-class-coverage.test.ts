import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'patzer-time-class-coverage-'));
process.env.DB_PATH = join(scratch, 'time-class.db');

let db: typeof import('../src/db.js')['db'];
let route: { request: (url: string, init?: RequestInit) => Response | Promise<Response> };
let cookie: string;

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  const { SCORING_VERSION } = await import('../src/chess/classifier.js');
  route = (await import('../src/routes/insightsV2.js')).default;
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  db.prepare("INSERT INTO users (id,username,password_hash,role) VALUES (1,'me','x','user'), (2,'another','x','user')").run();
  db.prepare("INSERT INTO profiles (user_id,display_name) VALUES (1,'Me'), (2,'Another')").run();
  cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;
  const game = db.prepare(`INSERT INTO games
    (id, user_id, source, pgn, white, black, result, end_time, user_color, time_class)
    VALUES (?, ?, 'chesscom', 'PGN', 'Me', 'Opponent', ?, ?, ?, ?)`);
  game.run(1, 1, 'win', '2026-11-01T12:00:00Z', 'white', 'rapid');
  game.run(2, 1, 'loss', '2026-11-02T12:00:00Z', 'black', 'rapid');
  game.run(3, 1, 'unknown', '2026-11-03T12:00:00Z', null, 'rapid');
  game.run(4, 1, 'draw', '2026-11-04T12:00:00Z', 'white', null);
  game.run(5, 2, 'win', '2026-11-05T12:00:00Z', 'white', 'rapid');
  // NULL and the literal 'other' are one displayed group, not two groups that
  // may overwrite each other when converted into response-object keys.
  game.run(6, 1, 'win', '2026-11-06T12:00:00Z', 'white', 'other');

  const analysis = db.prepare(`INSERT INTO analyses
    (game_id, depth, moves_json, scoring_version, accuracy_white, accuracy_black,
     source_hash, source_revision, analysis_generation)
    VALUES (?, 16, '[]', ?, ?, ?, 'fixture-source-hash', 0, 1)`);
  analysis.run(1, SCORING_VERSION, 74.5, null); // measured personal accuracy
  analysis.run(2, SCORING_VERSION, null, null); // analyzed, but not measured
  analysis.run(3, SCORING_VERSION, 92, null);   // unknown player side: not personal accuracy
  analysis.run(5, SCORING_VERSION, 99, null);   // another account: never included
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(scratch, { recursive: true, force: true });
});

describe('Insights time-class accuracy coverage', () => {
  it('counts accuracy only for current analyses with a measured player-side score', async () => {
    const res = await route.request('/', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const result = await res.json() as {
      games_total: number;
      time_class_stats: Record<string, {
        games: number; wins: number; draws: number; losses: number;
        analyzed_games: number; accuracy_games: number; avg_accuracy: number | null;
      }>;
    };
    expect(result.games_total).toBe(5);
    expect(result.time_class_stats.rapid).toEqual({
      games: 3, wins: 1, draws: 0, losses: 1,
      analyzed_games: 3, accuracy_games: 1, avg_accuracy: 74.5,
    });
    expect(result.time_class_stats.other).toEqual({
      games: 2, wins: 1, draws: 1, losses: 0,
      analyzed_games: 0, accuracy_games: 0, avg_accuracy: null,
    });
  });
});
