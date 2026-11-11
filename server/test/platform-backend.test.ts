import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGameId, parseGameListQuery } from '../src/routes/platformQueries.js';
import { Chess } from 'chess.js';
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
  db.prepare("INSERT INTO users (id,username,password_hash,role) VALUES (4,'calendar','x','user')").run();
  db.prepare("INSERT INTO users (id,username,password_hash,role) VALUES (5,'unknown_side','x','user')").run();
  db.prepare("INSERT INTO users (id,username,password_hash,role) VALUES (6,'importer','x','user')").run();
  db.prepare("INSERT INTO profiles (user_id,display_name) VALUES (1,'Owner')").run();
  db.prepare("INSERT INTO profiles (user_id,display_name) VALUES (2,'Other')").run();
  db.prepare("INSERT INTO profiles (user_id,display_name) VALUES (3,'Empty')").run();
  db.prepare("INSERT INTO profiles (user_id,display_name) VALUES (4,'Calendar')").run();
  db.prepare("INSERT INTO profiles (user_id,display_name) VALUES (5,'Unknown side')").run();
  db.prepare("INSERT INTO profiles (user_id,display_name) VALUES (6,'Importer')").run();
  cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;

  const game = db.prepare(`INSERT INTO games (
      id,user_id,source,external_id,pgn,white,black,result,time_class,end_time,user_color,
      bookmarked,notes,rated
    ) VALUES (?, ?, 'chesscom', ?, '1. e4 e5 *', ?, 'opponent', ?, ?, ?, 'white', ?, ?, 0)`);
  const analysis = db.prepare(`INSERT INTO analyses (
      game_id,depth,moves_json,scoring_version,accuracy_white,
      source_hash,source_revision,analysis_generation
    ) VALUES (?,16,'[]',?,80,'synthetic-list-provenance',0,1)`);
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

describe('platform backend edge-case protection', () => {
  it('does not allow malformed recent PvP records to hide an older playable game', async () => {
    const insert = db.prepare(`INSERT INTO games (user_id, source, pgn, white, black,
      time_control, user_color, created_at)
      VALUES (1, 'pvp', ?, 'owner', 'opponent', '600+0', 'white', ?)`);
    const ids: number[] = [];
    try {
      const old = insert.run('1. e4 e5 *', new Date(Date.now() - 86_400_000).toISOString());
      ids.push(Number(old.lastInsertRowid));
      for (let i = 0; i < 20; i++) {
        const invalid = insert.run(`invalid pgn token ${i}`, new Date(Date.now() - 3_600_000 + i * 1000).toISOString());
        ids.push(Number(invalid.lastInsertRowid));
      }
      const response = await get('/live');
      expect(response.status).toBe(200);
      const body = await response.json() as { pvp: { game_id: number }[] };
      expect(body.pvp.map((game) => game.game_id)).toContain(ids[0]);
    } finally {
      const remove = db.prepare('DELETE FROM games WHERE id = ? AND user_id = 1');
      for (const id of ids) remove.run(id);
    }
  });

  it('only includes the last 365 calendar days in the activity heatmap', async () => {
    const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
    const session = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(4))}`;
    const insert = db.prepare(`INSERT INTO games (user_id, source, external_id, pgn,
      white, black, result, end_time, user_color)
      VALUES (4, 'chesscom', ?, '1. e4 e5 *', 'calendar', 'opponent', 'win', ?, 'white')`);
    const today = new Date().toISOString();
    insert.run('today', today);
    insert.run('future', new Date(Date.now() + 7 * 86_400_000).toISOString());
    insert.run('old', new Date(Date.now() - 400 * 86_400_000).toISOString());
    const response = await insightsRoute.request('/', { headers: { Cookie: session } });
    expect(response.status).toBe(200);
    const data = await response.json() as { activity_heatmap: { day: string; games: number; wins: number }[] };
    expect(data.activity_heatmap).toEqual([{ day: today.slice(0, 10), games: 1, wins: 1 }]);
  });

  it('does not invent a player side or personalized accuracy for games with unknown color', async () => {
    const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
    const { SCORING_VERSION } = await import('../src/chess/classifier.js');
    const session = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(5))}`;
    const gameId = Number(db.prepare(`INSERT INTO games (user_id, source, pgn, white, black,
      result, end_time, user_color)
      VALUES (5, 'imported', '1. e4 e5 *', 'unknown_side', 'opponent', 'loss',
        '2026-01-01T00:00:00Z', NULL)`).run().lastInsertRowid);
    db.prepare(`INSERT INTO analyses (game_id, depth, scoring_version, accuracy_white,
      accuracy_black, moves_json, phase_split_json, source_hash, source_revision, analysis_generation)
      VALUES (?, 16, ?, 42, 77, ?, ?, 'synthetic-unknown-side', 0, 1)`).run(
      gameId, SCORING_VERSION,
      JSON.stringify([{ ply: 1, san: 'e4', fen_after: '8/8/8/8/8/8/8/8', classification: 'blunder', centipawn_loss: 400 }]),
      JSON.stringify({ opening: { from_ply: 1, to_ply: 14, accuracy_white: 42, accuracy_black: 77 } }),
    );
    const response = await insightsRoute.request('/', { headers: { Cookie: session } });
    expect(response.status).toBe(200);
    const data = await response.json() as {
      games_analyzed: number; move_quality: { counts: Record<string, number> };
      accuracy_trend: unknown[]; phase_accuracy: { opening: number };
    };
    expect(data.games_analyzed).toBe(1);
    expect(data.move_quality.counts.blunder).toBe(0);
    expect(data.accuracy_trend).toEqual([]);
    expect(data.phase_accuracy.opening).toBe(0);
  });
});

describe('manual Chess.com import resilience', () => {
  const monthUrl = 'https://api.chess.com/pub/player/importer/games/2026/01';
  const sample = (id: number, overrides: Record<string, unknown> = {}) => ({
    url: `https://www.chess.com/game/live/${id}`,
    pgn: '[Event "Live Chess"]\n[White "importer"]\n[Black "opponent"]\n\n1. e4 e5 *',
    time_control: '600', end_time: 1760000000 + id,
    rated: true, rules: 'chess', time_class: 'rapid',
    white: { username: 'importer', rating: 1200, result: 'win' },
    black: { username: 'opponent', rating: 1200, result: 'checkmated' },
    ...overrides,
  });
  function mockFetch(monthGames: unknown[], onProfile?: () => Promise<void>) {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      let data: unknown;
      if (url.pathname === '/pub/player/importer') {
        await onProfile?.();
        data = { username: 'importer' };
      } else if (url.pathname === '/pub/player/importer/games/archives') {
        data = { archives: [monthUrl] };
      } else if (url.href === monthUrl) {
        data = { games: monthGames };
      } else {
        throw new Error(`unexpected test fetch: ${url.href}`);
      }
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
  }
  async function postImport() {
    const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
    return gamesRoute.request('/import/chesscom', {
      method: 'POST', headers: { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(6))}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'importer', limit: 20 }),
    });
  }

  it('preserves unknown results without recording false losses and skips malformed or cross-user games', async () => {
    mockFetch([
      sample(99001),
      sample(99002, { white: { username: 'importer', rating: 1200, result: 'future_outcome' } }),
      sample(99003, { end_time: Number.MAX_VALUE }),
      sample(99004, { white: { username: 'somebody_else', rating: 1200, result: 'win' } }),
      sample(99005, { pgn: 'this is not legal PGN' }),
    ]);
    try {
      const response = await postImport();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ imported: 2, total: 5 });
      expect(db.prepare('SELECT external_id, result FROM games WHERE user_id = 6 ORDER BY external_id').all()).toEqual([
        { external_id: 'https://www.chess.com/game/live/99001', result: 'win' },
        { external_id: 'https://www.chess.com/game/live/99002', result: null },
      ]);
    } finally { vi.unstubAllGlobals(); }
  });

  it('bounds concurrent manual imports per user and releases the slot after completion', async () => {
    let release = () => {};
    let entered = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    mockFetch([], async () => { entered(); await gate; });
    try {
      const first = postImport();
      await started;
      const duplicate = await postImport();
      expect(duplicate.status).toBe(429);
      expect(await duplicate.json()).toEqual({ error: 'import_in_progress' });
      release();
      expect((await first).status).toBe(200);
      expect((await postImport()).status).toBe(200);
    } finally { release(); vi.unstubAllGlobals(); }
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
    expect(readAnalysisMoves(JSON.stringify([
      { ply: 1, san: 'e4', classification: 'good', fen_after: '8/8/8/8/8/8/8/8', centipawn_loss: -30 },
      { ply: 2, san: 'e5', classification: 'good', fen_after: '8/8/8/8/8/8/8/8', centipawn_loss: 20, eval_before_cp: 'invalid' },
      { ply: 2, san: 'e5', classification: 'blunder', fen_after: '8/8/8/8/8/8/8/8', centipawn_loss: 500 },
    ]))).toMatchObject([{ ply: 2, eval_before_cp: null }]);
    expect(readPhaseSplit('{broken')).toBeNull();
    expect(readPhaseSplit('{"opening":{"from_ply":1,"to_ply":14,"accuracy_white":85,"accuracy_black":75}}')?.opening?.accuracy_white).toBe(85);
    expect(readPhaseSplit('{"opening":{"from_ply":1,"to_ply":14,"accuracy_white":180,"accuracy_black":75}}')?.opening).toBeNull();
  });
});


describe('Black-first position analytics regression', () => {
  it('attributes Insights v1 mistakes to the actual mover, not odd/even ply parity', async () => {
    const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
    const { SCORING_VERSION } = await import('../src/chess/classifier.js');
    const legacyInsights = (await import('../src/routes/insights.js')).default;
    db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES (7, 'fen_black', 'x', 'user')").run();
    db.prepare("INSERT INTO profiles (user_id, display_name) VALUES (7, 'FEN Black')").run();

    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
    const gameId = Number(db.prepare(`
      INSERT INTO games (user_id, source, external_id, pgn, white, black,
        result, user_color, start_fen, end_time, rated)
      VALUES (7, 'played', 'fen-black-first', '*', 'opponent', 'fen_black',
        'loss', 'black', ?, '2026-11-01T00:00:00Z', 0)
    `).run(fen).lastInsertRowid);
    const chess = new Chess(fen);
    const sanMoves = ['e5', 'e4', 'Nf6', 'Nc3', 'Nc6', 'Nf3', 'd5', 'd3', 'Bc5', 'Be2'];
    const moves = sanMoves.map((san, index) => {
      const before = chess.fen();
      const move = chess.move(san);
      expect(move, san).not.toBeNull();
      return {
        ply: index + 1, san, fen_before: before, fen_after: chess.fen(),
        classification: index % 2 === 0 ? 'blunder' : 'good',
        centipawn_loss: index % 2 === 0 ? 250 : 0,
      };
    });
    db.prepare(`INSERT INTO analyses
      (game_id, depth, scoring_version, moves_json, source_hash, source_revision, analysis_generation)
      VALUES (?, 16, ?, ?, 'synthetic-black-first', 0, 1)`)
      .run(gameId, SCORING_VERSION, JSON.stringify(moves));

    const cookie7 = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(7))}`;
    const response = await legacyInsights.request('/', { headers: { Cookie: cookie7 } });
    expect(response.status).toBe(200);
    const data = await response.json() as {
      games_analyzed: number; weak_spots: { key: string; count: number }[];
    };
    expect(data.games_analyzed).toBe(1);
    expect(data.weak_spots.find((spot) => spot.key === 'hung_pieces')?.count).toBe(5);
  });
});
