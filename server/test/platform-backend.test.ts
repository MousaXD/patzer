import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGameId, parseGameListQuery } from '../src/routes/platformQueries.js';
import { readAnalysisMoves, readPhaseSplit } from '../src/routes/analysisData.js';

const tmp = mkdtempSync(join(tmpdir(), 'patzer-platform-fixture-'));
process.env.DB_PATH = join(tmp, 'fixture.db');
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
  db.prepare("INSERT INTO users (id,username,password_hash,role) VALUES (1,'owner','x','user')").run();
  db.prepare("INSERT INTO users (id,username,password_hash,role) VALUES (2,'other','x','user')").run();
  db.prepare("INSERT INTO users (id,username,password_hash,role) VALUES (3,'empty','x','user')").run();
  db.prepare("INSERT INTO profiles (user_id,display_name) VALUES (1,'Owner')").run();
  db.prepare("INSERT INTO profiles (user_id,display_name) VALUES (2,'Other')").run();
  db.prepare("INSERT INTO profiles (user_id,display_name) VALUES (3,'Empty')").run();
  cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;

  const game = db.prepare(`INSERT INTO games (
      id,user_id,source,external_id,pgn,white,black,result,time_class,end_time,user_color,
      bookmarked,notes,rated
    ) VALUES (?, ?, 'chesscom', ?, '1. e4 e5 *', ?, 'opponent', ?, ?, ?, 'white', ?, ?, 0)`);
  const analysis = db.prepare(`INSERT INTO analyses (
      game_id,depth,moves_json,scoring_version,accuracy_white
    ) VALUES (?,16,'[]',?,80)`);
  db.transaction(() => {
    for (let i = 1; i <= 1_200; i++) {
      game.run(i, 1, `https://www.chess.com/game/live/${i}`, 'owner',
        i % 3 === 0 ? 'win' : 'loss', i % 2 === 0 ? 'rapid' : 'blitz',
        new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
        i % 10 === 0 ? 1 : 0, i === 1 ? '40% score' : null);
      if (i % 4 === 0) analysis.run(i, SCORING_VERSION);
      else if (i % 5 === 0) analysis.run(i, SCORING_VERSION - 1);
    }
    for (let i = 1_201; i <= 1_255; i++) {
      game.run(i, 2, `https://www.chess.com/game/live/${i}`, 'other',
        'win', 'rapid', new Date(Date.UTC(2026, 1, 1) + i * 1000).toISOString(), 1, null);
    }
  })();
});

afterAll(() => {
  try { db.close(); } catch { /* not initialized */ }
  rmSync(tmp, { recursive: true, force: true });
});

const auth = { headers: { Cookie: '' } };
function get(path: string) {
  return gamesRoute.request(path, { headers: { Cookie: cookie } });
}

describe('platform API with 1,200 isolated synthetic games plus another user', () => {
  it('paginates deterministically, reports total separately and respects boundaries', async () => {
    const first = await get('/?limit=80');
    expect(first.status).toBe(200);
    const data = await first.json() as { total: number; limit: number; offset: number; has_more: boolean; games: { id: number }[] };
    expect(data).toMatchObject({ total: 1200, limit: 80, offset: 0, has_more: true });
    expect(data.games).toHaveLength(80);
    expect(data.games[0]?.id).toBe(1200);
    const last = await get('/?limit=80&offset=1160');
    const finalPage = await last.json() as typeof data;
    expect(finalPage).toMatchObject({ total: 1200, limit: 80, offset: 1160, has_more: false });
    expect(finalPage.games).toHaveLength(40);
    expect(finalPage.games.at(-1)?.id).toBe(1);
    const beyond = await get('/?offset=1200');
    expect((await beyond.json() as typeof data).games).toHaveLength(0);
    const oldest = await get('/?sort=oldest&limit=1');
    expect((await oldest.json() as typeof data).games[0]?.id).toBe(1);
  });

  it('applies structured filters and current-version analysis coverage', async () => {
    const response = await get('/?source=chesscom&time_class=rapid&result=win&analyzed=1&limit=200');
    const data = await response.json() as { total: number; games: { analyzed: number }[] };
    expect(data.total).toBe(100);
    expect(data.games).toHaveLength(100);
    expect(data.games.every((g) => g.analyzed === 1)).toBe(true);
    const without = await get('/?analyzed=0&bookmarked=1');
    expect((await without.json() as typeof data).total).toBe(60);
    const literal = await get('/?q=%25');
    expect((await literal.json() as typeof data).total).toBe(1);
  });

  it('rejects negative, non-finite, ambiguous and unbounded query parameters', async () => {
    for (const query of ['limit=-1', 'limit=NaN', 'limit=1.5',
      'offset=-2', 'offset=1000001', 'sort=random()', 'analyzed=maybe',
      'source=other', 'limit=Infinity', 'limit=1&limit=2',
      'sort=newest&sort=oldest', 'bookmarked=1&bookmarked=0']) {
      const response = await get('/?' + query);
      expect(response.status, query).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_input' });
    }
    const countOnly = await get('/?limit=0');
    const countOnlyData = await countOnly.json() as { total: number; games: unknown[] };
    expect(countOnlyData).toMatchObject({ total: 1200, games: [] });
    const capped = await get('/?limit=201');
    const data = await capped.json() as { limit: number; games: unknown[] };
    expect(data.limit).toBe(200);
    expect(data.games).toHaveLength(200);
    const bigLimit = await get('/?limit=10000000000');
    const big = await bigLimit.json() as { limit: number; games: unknown[] };
    expect(big.limit).toBe(200);
    expect(big.games).toHaveLength(200);
    expect(parseGameId('NaN')).toBeNull();
    expect(parseGameId('0')).toBeNull();
    expect(parseGameId('99999999999999999')).toBeNull();
    expect(parseGameListQuery(new URLSearchParams('limit=NaN'))).toBeNull();
  });

  it('never reveals or edits games from another user', async () => {
    expect((await gamesRoute.request('/', auth)).status).toBe(401);
    expect((await get('/1201')).status).toBe(404);
    expect((await get('/NaN')).status).toBe(400);
    expect((await gamesRoute.request('/1201/notes', {
      method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'must not write' }),
    })).status).toBe(404);
    expect((await gamesRoute.request('/1201', {
      method: 'DELETE', headers: { Cookie: cookie },
    })).status).toBe(404);
    const row = db.prepare('SELECT notes FROM games WHERE id = 1201').get() as { notes: string | null };
    expect(row.notes).toBeNull();
  });

  it('uses numeric zeros and empty groups for accounts without games', async () => {
    const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
    const emptyCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(3))}`;
    const emptyGames = await gamesRoute.request('/', { headers: { Cookie: emptyCookie } });
    expect(emptyGames.status).toBe(200);
    expect(await emptyGames.json()).toMatchObject({
      total: 0, games: [], limit: 50, offset: 0, has_more: false,
    });
    const emptyInsights = await insightsRoute.request('/', { headers: { Cookie: emptyCookie } });
    expect(emptyInsights.status).toBe(200);
    expect(await emptyInsights.json()).toMatchObject({
      games_total: 0, games_eligible: 0, games_analyzed: 0,
      opening_repertoire: [], time_class_stats: {},
    });
  });

  it('distinguishes saved games from current engine-analyzed games in Insights', async () => {
    const response = await insightsRoute.request('/', { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    const data = await response.json() as {
      games_total: number; games_eligible: number; games_analyzed: number;
      time_class_stats: Record<string, { games: number; analyzed_games: number; avg_accuracy: number | null }>;
      opening_repertoire: unknown[];
    };
    expect(data).toMatchObject({ games_total: 1200, games_eligible: 1200, games_analyzed: 300 });
    expect(data.time_class_stats.rapid).toMatchObject({ games: 600, analyzed_games: 300, avg_accuracy: 80 });
    expect(data.time_class_stats.blitz).toMatchObject({ games: 600, analyzed_games: 0, avg_accuracy: null });
  });
});

describe('defensive analysis metric decoding', () => {
  it('tolerates corrupt caches without throwing and ignores invalid moves', () => {
    expect(readAnalysisMoves('{broken')).toEqual([]);
    expect(readAnalysisMoves('{"not":"an array"}')).toEqual([]);
    expect(readAnalysisMoves(JSON.stringify([
      { ply: 1, san: 'e4', classification: 'good', fen_after: '8/8/8/8/8/8/8/8', centipawn_loss: 0 },
      { ply: 2, san: 'bad', classification: 'unknown', fen_after: 'invalid', centipawn_loss: 0 },
    ]))).toHaveLength(1);
    expect(readPhaseSplit('{broken')).toBeNull();
    expect(readPhaseSplit('{"opening":{"from_ply":1,"to_ply":14,"accuracy_white":85,"accuracy_black":75}}')?.opening?.accuracy_white).toBe(85);
  });
});
