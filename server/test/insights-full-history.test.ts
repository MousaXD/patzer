import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'patzer-full-stats-'));
process.env.DB_PATH = join(tmp, 'stats.db');
let db: typeof import('../src/db.js')['db'];
let route: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let oldRoute: typeof route;
let cookie: string;

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  const { SCORING_VERSION } = await import('../src/chess/classifier.js');
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  route = (await import('../src/routes/insightsV2.js')).default;
  oldRoute = (await import('../src/routes/insights.js')).default;
  db.prepare("INSERT INTO users (id,username,password_hash,role) VALUES (1,'stats','x','user')").run();
  db.prepare("INSERT INTO profiles (user_id,display_name) VALUES (1,'Stats')").run();
  cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;
  const game = db.prepare(`INSERT INTO games (id,user_id,source,external_id,pgn,white,black,result,end_time,user_color,time_class,eco,opening_name,rated)
    VALUES (?,1,'chesscom',?,'PGN','stats','other','win',?,'white','rapid','C20','Kings Pawn',0)`);
  const analysis = db.prepare(`INSERT INTO analyses (game_id, depth, moves_json, scoring_version, accuracy_white)
    VALUES (?,16,?,?,88)`);
  const writeAll = db.transaction(() => {
    for (let i = 1; i <= 260; i++) {
      game.run(i,`https://www.chess.com/game/live/${i}`, new Date(Date.UTC(2026,0,1,0,i)).toISOString());
      // Oldest move was brilliant. The old 200-game limit would exclude it.
      if (i <= 230) analysis.run(i, JSON.stringify([{ ply: 1, classification: i===1?'brilliant':'good', san:'e4', fen_after:'8/8/8/8/8/8/8/8 w - - 0 1', centipawn_loss:0 }]),SCORING_VERSION);
    }
  });
  writeAll();
});
afterAll(() => { try { db.close(); } catch { /* noop */ } rmSync(tmp, { recursive: true, force: true }); });

describe('complete-history Insights aggregates', () => {
  it('counts all saved games for time class and openings, even without Stockfish analysis', async () => {
    const res = await route.request('/', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const json = await res.json() as {
      games_total: number;
      games_analyzed: number;
      time_class_stats: Record<string, { games: number; wins: number }>;
      opening_repertoire: { eco: string; played: number; wins: number; avg_accuracy: number | null }[];
      move_quality: { counts: Record<string, number> };
      accuracy_trend: unknown[];
    };
    expect(json.games_total).toBe(260);
    expect(json.time_class_stats.rapid).toMatchObject({ games: 260, wins: 260 });
    expect(json.opening_repertoire[0]).toMatchObject({ eco: 'C20', played: 260, wins: 260, avg_accuracy: 88 });
    expect(json.games_analyzed).toBe(230);
    expect(json.move_quality.counts.brilliant).toBe(1);
    expect(json.move_quality.counts.good).toBe(229);
    expect(json.accuracy_trend).toHaveLength(50);
  });
  it('does not truncate even when an old optional limit=1 query parameter is supplied', async () => {
    const res = await route.request('/?limit=1', { headers: { Cookie: cookie } });
    const json = await res.json() as { games_analyzed: number; time_class_stats: Record<string, { games: number }> };
    expect(json.games_analyzed).toBe(230);
    expect(json.time_class_stats.rapid?.games).toBe(260);
  });
  it('Review list caps visible rows but reports the true collection size', async () => {
    const gamesRoute = (await import('../src/routes/games.js')).default;
    const res = await gamesRoute.request('/?limit=100', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const list = await res.json() as { total: number; games: unknown[] };
    expect(list.total).toBe(260);
    expect(list.games).toHaveLength(100);
  });
  it('legacy Insights aggregates all 230 analyzed games too', async () => {
    const res = await oldRoute.request('/?limit=2', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const json = await res.json() as { games_analyzed: number };
    expect(json.games_analyzed).toBe(230);
  });
});
