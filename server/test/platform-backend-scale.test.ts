import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Scale check is intentionally a temporary fixture database; never point this
// suite at an installed Patzer database or run any network import/engine job.
const tmp = mkdtempSync(join(tmpdir(), 'patzer-platform-scale-'));
process.env.DB_PATH = join(tmp, 'scale.db');
let db: typeof import('../src/db.js')['db'];
let gamesRoute: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let insightsRoute: typeof gamesRoute;
let cookie: string;

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  const { SCORING_VERSION } = await import('../src/chess/classifier.js');
  gamesRoute = (await import('../src/routes/games.js')).default;
  insightsRoute = (await import('../src/routes/insightsV2.js')).default;
  db.prepare("INSERT INTO users (id,username,password_hash,role) VALUES (1,'scale_owner','x','user')").run();
  db.prepare("INSERT INTO users (id,username,password_hash,role) VALUES (2,'scale_other','x','user')").run();
  db.prepare("INSERT INTO profiles (user_id,display_name) VALUES (1,'Scale Owner')").run();
  db.prepare("INSERT INTO profiles (user_id,display_name) VALUES (2,'Scale Other')").run();
  cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;
  const game = db.prepare(`
    INSERT INTO games (user_id,source,external_id,pgn,white,black,result,
      time_class,end_time,user_color,rated,bookmarked)
    VALUES (?, 'chesscom', ?, '1. e4 e5 *', ?, 'opponent', ?,
      ?, ?, 'white', 0, ?)
  `);
  const analysis = db.prepare(`
    INSERT INTO analyses (game_id,depth,moves_json,scoring_version,accuracy_white,
      source_hash,source_revision,analysis_generation)
    VALUES (?,16,'[]',?,83,'synthetic-scale-provenance',0,1)
  `);
  const origin = Date.UTC(2025, 0, 1);
  db.transaction(() => {
    for (let i = 1; i <= 20_000; i++) {
      const saved = game.run(1, `https://www.chess.com/game/live/${i}`, 'scale_owner',
        i % 3 === 0 ? 'win' : 'loss', i % 2 === 0 ? 'rapid' : 'blitz',
        new Date(origin + i * 1000).toISOString(), i % 10 === 0 ? 1 : 0);
      if (i % 4 === 0) analysis.run(Number(saved.lastInsertRowid), SCORING_VERSION);
      else if (i % 5 === 0) analysis.run(Number(saved.lastInsertRowid), SCORING_VERSION - 1);
    }
    for (let i = 1; i <= 700; i++) {
      game.run(2, `https://www.chess.com/game/live/other-${i}`, 'scale_other',
        'win', 'rapid', new Date(origin + (21_000 + i) * 1000).toISOString(), 0);
    }
  })();
});

afterAll(() => {
  try { db.close(); } catch { /* not initialized */ }
  rmSync(tmp, { recursive: true, force: true });
});

async function list(path: string) {
  const response = await gamesRoute.request(path, { headers: { Cookie: cookie } });
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    total: number; limit: number; offset: number; has_more: boolean;
    games: { id: number; analyzed: number; accuracy_white: number | null; white: string }[];
  }>;
}

describe('20,000-game isolated API regression', () => {
  it('preserves total, stable ordering, page cap and other-user isolation', async () => {
    const first = await list('/?limit=50');
    expect(first).toMatchObject({ total: 20_000, limit: 50, offset: 0, has_more: true });
    expect(first.games).toHaveLength(50);
    expect(first.games.every((g) => g.white === 'scale_owner')).toBe(true);

    const last = await list('/?limit=50&offset=19950');
    expect(last).toMatchObject({ total: 20_000, offset: 19_950, has_more: false });
    expect(last.games).toHaveLength(50);
    expect(new Set([...first.games, ...last.games].map((g) => g.id)).size).toBe(100);
    const missing = await list('/?limit=50&offset=20000');
    expect(missing).toMatchObject({ total: 20_000, has_more: false, games: [] });
    const oldest = await list('/?sort=oldest&limit=1');
    expect(oldest.games[0]?.id).toBe(last.games.at(-1)?.id);
  });

  it('filters current-version analyses and returns null for stale/unscored games', async () => {
    const analyzed = await list('/?analyzed=1&limit=1');
    expect(analyzed.total).toBe(5_000);
    expect(analyzed.games[0]?.analyzed).toBe(1);
    expect(analyzed.games[0]?.accuracy_white).toBe(83);
    const missing = await list('/?analyzed=0&limit=1');
    expect(missing.total).toBe(15_000);
    expect(missing.games[0]?.analyzed).toBe(0);
    expect(missing.games[0]?.accuracy_white).toBeNull();
    const rapid = await list('/?time_class=rapid&limit=1');
    expect(rapid.total).toBe(10_000);
  });

  it('computes all-game totals separately from analyzed-game totals', async () => {
    const response = await insightsRoute.request('/', { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    const data = await response.json() as {
      games_total: number; games_eligible: number; games_analyzed: number;
      time_class_stats: Record<string, { games: number; analyzed_games: number; avg_accuracy: number | null }>;
    };
    expect(data).toMatchObject({ games_total: 20_000, games_eligible: 20_000, games_analyzed: 5_000 });
    expect(data.time_class_stats.rapid).toMatchObject({ games: 10_000, analyzed_games: 5_000, avg_accuracy: 83 });
    expect(data.time_class_stats.blitz).toMatchObject({ games: 10_000, analyzed_games: 0, avg_accuracy: null });
  });
});
