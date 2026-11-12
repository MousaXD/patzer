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
  db.prepare("INSERT INTO profiles (user_id,display_name,chesscom_username,lichess_username) VALUES (6,'Importer','importer','importer')").run();
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
      'sort=newest&sort=oldest', 'bookmarked=1&bookmarked=0',
      'from_date=2026-02-30', 'to_date=2026-13-01', 'from_date=2026-1-01',
      'from_date=2026-01-02&to_date=2026-01-01',
      'to_date=2026-01-01&to_date=2026-01-02',
      'from_date=2026-01-01&from_date=2026-01-03',
      'from_date=9999-12-31', 'to_date=garbage',
      'opening=', 'opening=%20%20', `opening=${'A'.repeat(201)}`,
      'opening=Italian&opening=French',
      'opponent=Nepo', 'source=played&opponent=Nepo',
      'source=chesscom&opponent=', 'source=lichess&opponent=%20',
      `source=chesscom&opponent=${'a'.repeat(41)}`,
      'source=chesscom&opponent=Nepo&opponent=Hikaru']) {
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

  it('filters by inclusive UTC calendar dates without leaking other users or dropping end-of-day games', async () => {
    const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
    const ownCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(3))}`;
    const add = db.prepare(`INSERT INTO games
      (user_id, source, external_id, pgn, white, black, result, end_time, user_color)
      VALUES (3, 'imported', ?, '1. e4 e5 *', 'empty', 'opponent', 'win', ?, 'white')`);
    const ids: number[] = [];
    const dates = [
      '2025-12-31T23:59:59.999Z',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T23:59:59.999Z',
      '2026-01-02T00:00:00.000Z',
      null,
    ];
    try {
      for (const [i, ended] of dates.entries()) {
        ids.push(Number(add.run(`date-range-fixture-${i}`, ended).lastInsertRowid));
      }
      const search = (params: string) => gamesRoute.request(`/?${params}`, { headers: { Cookie: ownCookie } });
      const selected = await search('from_date=2026-01-01&to_date=2026-01-01&sort=oldest');
      expect(selected.status).toBe(200);
      const selectedData = await selected.json() as { total: number; games: {id:number}[] };
      expect(selectedData.total).toBe(2);
      expect(selectedData.games.map(game => game.id)).toEqual(ids.slice(1,3));
      expect((await (await search('from_date=2026-01-02')).json() as {total:number}).total).toBe(1);
      expect((await (await search('to_date=2025-12-31')).json() as {total:number}).total).toBe(1);
      expect((await (await search('from_date=2026-01-03')).json() as {total:number}).total).toBe(0);
    } finally {
      const remove = db.prepare('DELETE FROM games WHERE id = ? AND user_id = 3');
      for (const id of ids) remove.run(id);
    }
  });

  it('discovers only saved named openings and navigates to their exact matching games', async () => {
    const {createSession, SESSION_COOKIE_NAME} = await import('../src/auth/sessions.js');
    const asUser = (id: number) => `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(id))}`;
    const insert = db.prepare(`INSERT INTO games
      (user_id, source, external_id, pgn, white, black, result, opening_name)
      VALUES (?, 'imported', ?, '1. e4 e5 *', 'Fixture', 'Opponent', 'win', ?)`);
    const ids: number[] = [];
    try {
      for (const [i,name] of [
        'Italian Game', 'Italian Game', 'French Defense', null, '  ', 'Queen\'s Gambit',
      ].entries()) ids.push(Number(insert.run(3, `agentc-explorer-${i}`, name).lastInsertRowid));
      // Another user's game cannot affect opening counts or search results.
      ids.push(Number(insert.run(2, 'agentc-explorer-foreign', 'Italian Game').lastInsertRowid));
      const response = await gamesRoute.request('/openings', {headers:{Cookie: asUser(3)}});
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        total: 6, classified: 4, unclassified: 2,
        openings: [
          {name:'Italian Game', games:2},
          {name:'French Defense', games:1},
          {name:"Queen's Gambit", games:1},
        ],
      });
      const matching = await gamesRoute.request('/?opening=Italian%20Game&limit=40',
        {headers:{Cookie:asUser(3)}});
      expect(matching.status).toBe(200);
      const data = await matching.json() as {total:number;games:{opening_name:string;id:number}[]};
      expect(data.total).toBe(2);
      expect(data.games.map(row => row.opening_name)).toEqual(['Italian Game','Italian Game']);
      expect(data.games.every(row => ids.slice(0,2).includes(row.id))).toBe(true);
      const similar = await gamesRoute.request('/?opening=Italian', {headers:{Cookie:asUser(3)}});
      expect((await similar.json() as {total:number}).total).toBe(0);
      expect((await gamesRoute.request('/openings')).status).toBe(401);
    } finally {
      const remove = db.prepare('DELETE FROM games WHERE id = ?');
      for (const id of ids) remove.run(id);
    }
  });

  it('groups verifiable online opponents by provider and normalized username without mixing account identities', async () => {
    const {createSession, SESSION_COOKIE_NAME} = await import('../src/auth/sessions.js');
    const ownerCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(3))}`;
    const add = db.prepare(`INSERT INTO games (user_id, source, external_id, pgn, white, black, user_color, result)
      VALUES (?, ?, ?, '1. e4 e5 *', ?, ?, ?, 'win')`);
    const fixtures: Array<[number,string,string,string,string,string|null]> = [
      [3,'chesscom','agentc-rival-1','Owner','Nepo','white'],
      [3,'chesscom','agentc-rival-2','nepo ','Owner','black'],
      [3,'lichess','agentc-rival-3','Owner','Nepo','white'],
      [3,'chesscom','agentc-rival-4','Owner','Magnus','white'],
      [3,'chesscom','agentc-rival-5','Owner','Nepo',null],
      [3,'lichess','agentc-rival-6','','Owner','black'],
      [3,'pvp','agentc-rival-7','Owner','Nepo','white'],
      [2,'chesscom','agentc-rival-8','Owner','Nepo','white'],
    ];
    const ids: number[] = [];
    try {
      for (const row of fixtures) ids.push(Number(add.run(...row).lastInsertRowid));
      const response = await gamesRoute.request('/opponents', {headers:{Cookie: ownerCookie}});
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        total:6, identified:4, unidentified:2,
        opponents:[
          {source:'chesscom', name:'Nepo', games:2},
          {source:'chesscom', name:'Magnus', games:1},
          {source:'lichess', name:'Nepo', games:1},
        ],
      });
      const fromChesscom = await gamesRoute.request('/?source=chesscom&opponent=NEPO', {headers:{Cookie:ownerCookie}});
      expect(fromChesscom.status).toBe(200);
      expect((await fromChesscom.json() as {total:number;games:{id:number}[]}).games.map(g => g.id).sort())
        .toEqual(ids.slice(0,2).sort());
      const fromLichess = await gamesRoute.request('/?source=lichess&opponent=Nepo', {headers:{Cookie:ownerCookie}});
      expect((await fromLichess.json() as {total:number}).total).toBe(1);
      expect((await gamesRoute.request('/opponents')).status).toBe(401);
    } finally {
      const remove = db.prepare('DELETE FROM games WHERE id = ?');
      for (const id of ids) remove.run(id);
    }
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
    const opponents = await gamesRoute.request('/opponents', { headers: {Cookie: emptyCookie} });
    expect(opponents.status).toBe(200);
    expect(await opponents.json()).toEqual({total: 0, identified: 0, unidentified: 0, opponents: []});
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

describe('authenticated PGN archive upload', () => {
  const one = '[Event "First"]\n[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 1-0';
  const two = '[Event "Second"]\n[White "Carl"]\n[Black "Dani"]\n[Result "0-1"]\n\n1. d4 d5 0-1';
  const broken = '[Event "Broken"]\n\n1. e4 e9 *';

  async function requestUpload(userId: number, pgn: string) {
    const {createSession, SESSION_COOKIE_NAME} = await import('../src/auth/sessions.js');
    return gamesRoute.request('/import/pgn', {method:'POST', headers:{
      Cookie:`${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(userId))}`,
      'Content-Type':'application/json',
    }, body:JSON.stringify({pgn})});
  }
  function cleanup() {
    db.prepare("DELETE FROM games WHERE source = 'imported' AND external_id LIKE 'sha256:%'").run();
  }

  it('imports two saved games without inferred outcomes and isolates them to the authenticated owner', async () => {
    cleanup();
    try {
      const imported = await requestUpload(3, `${one}\n\n${two}`);
      expect(imported.status).toBe(200);
      expect(await imported.json()).toEqual({total:2, imported:2, duplicates:0});
      const saved = db.prepare("SELECT user_id,white,black,pgn,result,user_color,end_time FROM games WHERE source='imported' AND user_id=3 AND external_id LIKE 'sha256:%' ORDER BY id").all();
      expect(saved).toEqual([
        {user_id:3, white:'Alice', black:'Bob', pgn:one, result:null,user_color:null,end_time:null},
        {user_id:3, white:'Carl', black:'Dani', pgn:two, result:null,user_color:null,end_time:null},
      ]);
      expect(await (await requestUpload(3,`${one}\n\n${two}`)).json())
        .toEqual({total:2,imported:0,duplicates:2});
      expect((await (await gamesRoute.request('/?source=imported', {headers:{Cookie:cookie}})).json() as {total:number}).total).toBe(0);
      expect(await (await requestUpload(2, one)).json()).toEqual({total:1,imported:1,duplicates:0});
      expect((await (await gamesRoute.request('/?source=imported', {headers:{Cookie:cookie}})).json() as {total:number}).total).toBe(0);
    } finally { cleanup(); }
  });

  it('imports annotated PGNs without treating quoted Event tags in comments as extra games', async () => {
    cleanup();
    const annotated = '[Event "Annotated"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 {Notes include this literal line:\n[Event "Not another game"]\nStill the same game.} e5 1-0';
    try {
      const result = await requestUpload(3,`${annotated}\n\n${two}`);
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({total:2,imported:2,duplicates:0});
      expect(db.prepare("SELECT pgn FROM games WHERE source='imported' AND user_id=3 AND external_id LIKE 'sha256:%' ORDER BY id").all())
        .toEqual([{pgn:annotated},{pgn:two}]);
    } finally {cleanup();}
  });

  it('refuses malformed second games, unsafe positions and oversized uploads with no partial commits', async () => {
    cleanup();
    try {
      const brokenResponse = await requestUpload(3,`${one}\n\n${broken}`);
      expect(brokenResponse.status).toBe(422);
      expect(await brokenResponse.json()).toEqual({error:'invalid_pgn',game_index:2});
      expect(db.prepare("SELECT COUNT(*) AS n FROM games WHERE source='imported' AND user_id=3 AND external_id LIKE 'sha256:%'").get())
        .toEqual({n:0});
      const oversized = await requestUpload(3, 'e'.repeat(4*1024*1024+1));
      expect(oversized.status).toBe(413);
      expect((await oversized.json() as {error:string}).error).toMatch(/pgn_too_large|invalid_input/);
      expect(db.prepare("SELECT COUNT(*) AS n FROM games WHERE source='imported' AND user_id=3 AND external_id LIKE 'sha256:%'").get())
        .toEqual({n:0});
      const anonymous = await gamesRoute.request('/import/pgn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pgn:one})});
      expect(anonymous.status).toBe(401);
    } finally { cleanup(); }
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
  async function postImport(username = 'importer') {
    const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
    return gamesRoute.request('/import/chesscom', {
      method: 'POST', headers: { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(6))}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, limit: 20 }),
    });
  }

  it.each([
    [404, 404, 'player_not_found'],
    [429, 429, 'chesscom_rate_limited'],
    [503, 502, 'chesscom_unavailable'],
  ])('distinguishes a Chess.com profile HTTP %i from genuine missing players', async (upstream, responseStatus, code) => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ error: 'provider_error' }), { status: upstream }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const response = await postImport();
      expect(response.status).toBe(responseStatus);
      expect(await response.json()).toEqual({ error: code });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it('does not mistake network failure or a malformed profile reply for an absent player', async () => {
    for (const provider of [
      async () => { throw new TypeError('fetch failed'); },
      async () => new Response(JSON.stringify({ unrelated: 'value' }), { status: 200 }),
      async () => new Response(JSON.stringify({ username: 'different_account' }), { status: 200 }),
      async () => new Response('not valid json', { status: 200 }),
    ]) {
      vi.stubGlobal('fetch', vi.fn(provider));
      try {
        const response = await postImport();
        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ error: 'chesscom_unavailable' });
      } finally { vi.unstubAllGlobals(); }
    }
  });

  it.each(['archive_list', 'monthly_games'])('fails a malformed %s response without claiming a successful import', async (failure) => {
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://api.chess.com/pub/player/importer') {
        return new Response(JSON.stringify({username:'importer'}), {status:200});
      }
      if (url === 'https://api.chess.com/pub/player/importer/games/archives') {
        return new Response(JSON.stringify({archives: failure === 'archive_list'
          ? [monthUrl, 'https://untrusted.example/pub/player/importer/games/2026/02'] : [monthUrl]}), {status:200});
      }
      if (url === monthUrl && failure === 'monthly_games') {
        return new Response(JSON.stringify({unexpected:'truncated'}), {status:200});
      }
      throw new Error(`unexpected_mock_request:${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const before = db.prepare("SELECT count(*) AS n FROM games WHERE user_id = 6 AND source = 'chesscom'").get() as {n:number};
    try {
      const response = await postImport();
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({error:'chesscom_unavailable'});
      expect(db.prepare("SELECT count(*) AS n FROM games WHERE user_id = 6 AND source = 'chesscom'").get()).toEqual(before);
      expect(fetchSpy).toHaveBeenCalledTimes(failure === 'archive_list' ? 2 : 3);
    } finally { vi.unstubAllGlobals(); }
  });

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
      expect(await response.json()).toMatchObject({ imported: 2, total: 5, skipped: 3, duplicates: 0 });
      expect(db.prepare('SELECT external_id, result FROM games WHERE user_id = 6 ORDER BY external_id').all()).toEqual([
        { external_id: 'https://www.chess.com/game/live/99001', result: 'win' },
        { external_id: 'https://www.chess.com/game/live/99002', result: null },
      ]);
      const repeat = await postImport();
      expect(repeat.status).toBe(200);
      expect(await repeat.json()).toMatchObject({ imported: 0, total: 5, skipped: 3, duplicates: 2 });
      expect(db.prepare('SELECT count(*) AS n FROM games WHERE user_id = 6').get()).toEqual({ n: 2 });
    } finally { vi.unstubAllGlobals(); }
  });

  it('makes a recent Chess.com game searchable by its actual opening before analysis', async () => {
    const sampleId = 99521;
    const expectedUrl = sample(sampleId).url;
    mockFetch([sample(sampleId)]);
    try {
      expect((await (await postImport()).json())).toMatchObject({imported:1, total:1});
      const row = db.prepare("SELECT eco, opening_name, pgn FROM games WHERE user_id = 6 AND source = 'chesscom' AND external_id = ?")
        .get(expectedUrl) as {eco: string|null; opening_name: string|null; pgn: string};
      expect(row).toMatchObject({eco:'C20', opening_name:"King's Pawn Game", pgn:sample(sampleId).pgn});
      const {createSession,SESSION_COOKIE_NAME} = await import('../src/auth/sessions.js');
      const found = await gamesRoute.request(`/?q=${encodeURIComponent("King's Pawn")}&source=chesscom`, {
        headers:{Cookie:`${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(6))}`},
      });
      expect(found.status).toBe(200);
      expect((await found.json() as {games:{external_id:string}[]}).games.map(g => g.external_id)).toContain(expectedUrl);
    } finally {
      vi.unstubAllGlobals();
      db.prepare("DELETE FROM games WHERE user_id = 6 AND source = 'chesscom' AND external_id = ?").run(expectedUrl);
    }
  });

  it('enriches identical pre-existing Chess.com PGNs without changing any source or user data', async () => {
    const game = sample(99522);
    const id = Number(db.prepare(`INSERT INTO games
      (user_id, source, external_id, pgn, white, black, result, user_color, eco, opening_name, bookmarked, notes, source_revision)
      VALUES (6, 'chesscom', ?, ?, 'importer', 'opponent', 'win', 'white', NULL, NULL, 1, 'Keep this note', 7)`)
      .run(game.url, game.pgn).lastInsertRowid);
    mockFetch([game]);
    try {
      expect(await (await postImport()).json()).toMatchObject({imported:0,duplicates:1,enriched:1});
      expect(db.prepare(`SELECT pgn, eco, opening_name, bookmarked, notes, source_revision, result, user_color
        FROM games WHERE id = ?`).get(id)).toMatchObject({
          pgn: game.pgn, eco: 'C20', opening_name: "King's Pawn Game",
          bookmarked: 1, notes: 'Keep this note', source_revision: 7, result: 'win', user_color: 'white',
        });
      expect(await (await postImport()).json()).toMatchObject({imported:0,duplicates:1,enriched:0});
    } finally {
      vi.unstubAllGlobals();
      db.prepare('DELETE FROM games WHERE id = ?').run(id);
    }
  });

  it('does not enrich mismatched PGNs or override a conflicting stored Chess.com ECO', async () => {
    const game = sample(99523);
    const wrongPgn = '[White "importer"]\n[Black "opponent"]\n\n1. d4 d5 *';
    const insert = db.prepare(`INSERT INTO games
      (user_id, source, external_id, pgn, white, black, result, user_color, eco, opening_name)
      VALUES (6, 'chesscom', ?, ?, 'importer', 'opponent', 'win', 'white', ?, NULL)`);
    const id1 = Number(insert.run(game.url, wrongPgn, null).lastInsertRowid);
    const other = sample(99524);
    const id2 = Number(insert.run(other.url, other.pgn, 'A00').lastInsertRowid);
    mockFetch([game, other]);
    try {
      expect(await (await postImport()).json()).toMatchObject({imported:0, duplicates:2, enriched:0});
      expect(db.prepare('SELECT pgn,eco,opening_name FROM games WHERE id = ?').get(id1)).toEqual({pgn:wrongPgn, eco:null, opening_name:null});
      expect(db.prepare('SELECT pgn,eco,opening_name FROM games WHERE id = ?').get(id2)).toEqual({pgn:other.pgn, eco:'A00', opening_name:null});
    } finally {
      vi.unstubAllGlobals();
      db.prepare('DELETE FROM games WHERE id IN (?, ?)').run(id1,id2);
    }
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

  it('refuses cross-account overrides without calling external providers', async () => {
    const fetchSpy = vi.fn(async () => { throw new Error('must-not-fetch'); });
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const mismatch = await postImport('somebody_else');
      expect(mismatch.status).toBe(403);
      expect(await mismatch.json()).toEqual({ error: 'linked_account_mismatch' });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('aborts stale in-flight downloads after the account link changes', async () => {
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    mockFetch([sample(99898)], async () => { started(); await held; });
    try {
      const pending = postImport();
      await entered;
      db.prepare("UPDATE profiles SET chesscom_username = 'different_account' WHERE user_id = 6").run();
      release();
      const response = await pending;
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'linked_account_changed' });
      expect(db.prepare('SELECT count(*) AS n FROM games WHERE user_id = 6 AND external_id = ?')
        .get(sample(99898).url)).toEqual({ n: 0 });
    } finally {
      release(); vi.unstubAllGlobals();
      db.prepare("UPDATE profiles SET chesscom_username = 'importer' WHERE user_id = 6").run();
    }
  });

  it('rolls back the whole Chess.com batch on a database insertion failure', async () => {
    const badId = 99897;
    mockFetch([sample(99896), sample(badId)]);
    db.exec(`CREATE TRIGGER agentc_chesscom_failure BEFORE INSERT ON games
      WHEN NEW.user_id = 6 AND NEW.external_id = '${sample(badId).url}'
      BEGIN SELECT RAISE(ABORT, 'synthetic_import_failure'); END;`);
    try {
      const response = await postImport();
      expect(response.status).toBe(500);
      expect(db.prepare('SELECT count(*) AS n FROM games WHERE user_id = 6 AND external_id IN (?, ?)')
        .get(sample(99896).url, sample(badId).url)).toEqual({ n: 0 });
    } finally { db.exec('DROP TRIGGER agentc_chesscom_failure'); vi.unstubAllGlobals(); }
  });

  it('rolls back duplicate opening enrichment if another game in the batch fails', async () => {
    const first = sample(99895);
    const second = sample(99894);
    const id = Number(db.prepare(`INSERT INTO games
      (user_id, source, external_id, pgn, white, black, result, user_color, source_revision)
      VALUES (6, 'chesscom', ?, ?, 'importer', 'opponent', 'win', 'white', 11)`)
      .run(first.url, first.pgn).lastInsertRowid);
    db.exec(`CREATE TRIGGER agentc_chesscom_metadata_failure BEFORE INSERT ON games
      WHEN NEW.user_id = 6 AND NEW.external_id = '${second.url}'
      BEGIN SELECT RAISE(ABORT, 'synthetic_import_failure'); END;`);
    mockFetch([first, second]);
    try {
      expect((await postImport()).status).toBe(500);
      expect(db.prepare('SELECT eco,opening_name,source_revision FROM games WHERE id = ?').get(id))
        .toEqual({eco:null,opening_name:null,source_revision:11});
      expect(db.prepare('SELECT count(*) AS n FROM games WHERE user_id = 6 AND external_id = ?').get(second.url))
        .toEqual({n:0});
    } finally {
      vi.unstubAllGlobals();
      db.exec('DROP TRIGGER agentc_chesscom_metadata_failure');
      db.prepare('DELETE FROM games WHERE id = ?').run(id);
    }
  });
});

describe('manual Lichess import integrity', () => {
  const savedId = 'agentc_lc_test';
  const lichessGame = (id: string, overrides: Record<string, unknown> = {}) => ({
    id, rated: true, variant: 'standard', speed: 'blitz', createdAt: 1760000000000,
    lastMoveAt: 1760000050000, status: 'mate', winner: 'white',
    players: {
      white: { user: { name: 'importer', id: 'importer' }, rating: 1300 },
      black: { user: { name: 'opponent', id: 'opponent' }, rating: 1270 },
    },
    clock: { initial: 300, increment: 0 },
    pgn: '[Event "Lichess game"]\n[White "importer"]\n[Black "opponent"]\n\n1. e4 e5 1-0',
    ...overrides,
  });
  async function importLichess(username = 'importer') {
    const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
    return gamesRoute.request('/import/lichess', {
      method: 'POST',
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(6))}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, limit: 20 }),
    });
  }
  it('only inserts valid owned games and counts repeated imports as duplicates', async () => {
    const rows = [
      lichessGame(savedId),
      lichessGame('foreign_1234', { players: { white: { user: { id: 'foreign', name: 'foreign' } }, black: { user: { id: 'not_importer', name: 'not_importer' } } } }),
      lichessGame('corrupt_1234', { pgn: '1. e4 e5 2. nope' }),
      lichessGame('ambiguous_12', { status: 'resign', winner: undefined }),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(rows.map(row => JSON.stringify(row)).join('\n'), {status: 200})));
    try {
      expect((await (await importLichess()).json())).toMatchObject({ imported: 1, total: 4, skipped: 3, duplicates: 0 });
      expect((await (await importLichess()).json())).toMatchObject({ imported: 0, total: 4, skipped: 3, duplicates: 1 });
      expect(db.prepare("SELECT external_id, user_color, result, rated FROM games WHERE user_id = 6 AND source = 'lichess'").all())
        .toEqual([{ external_id: savedId, user_color: 'white', result: 'win', rated: 0 }]);
    } finally {
      vi.unstubAllGlobals();
      db.prepare("DELETE FROM games WHERE user_id = 6 AND source = 'lichess'").run();
    }
  });
  it('preserves a Lichess PGN while making its opening searchable without analysis', async () => {
    const game = lichessGame('agentc_lc_opening_1');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(game),{status:200})));
    try {
      expect((await (await importLichess()).json())).toMatchObject({imported:1,total:1});
      const saved = db.prepare("SELECT eco, opening_name, pgn FROM games WHERE user_id = 6 AND source = 'lichess' AND external_id = ?")
        .get(game.id) as {eco:string|null;opening_name:string|null;pgn:string};
      expect(saved).toMatchObject({eco:'C20', opening_name:"King's Pawn Game", pgn:game.pgn.trim()});
    } finally {
      vi.unstubAllGlobals();
      db.prepare("DELETE FROM games WHERE user_id = 6 AND source = 'lichess' AND external_id = ?").run(game.id);
    }
  });

  it('enriches a duplicate Lichess game only when its original PGN matches', async () => {
    const original = lichessGame('agentc_lc_duplicate_opening');
    const id = Number(db.prepare(`INSERT INTO games
      (user_id, source, external_id, pgn, white, black, result, user_color, bookmarked, notes, source_revision)
      VALUES (6, 'lichess', ?, ?, 'importer', 'opponent', 'win', 'white', 1, 'Keep note', 4)`)
      .run(original.id, original.pgn).lastInsertRowid);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(original), {status:200})));
    try {
      expect(await (await importLichess()).json()).toMatchObject({imported:0,duplicates:1,enriched:1});
      expect(db.prepare('SELECT pgn,eco,opening_name,bookmarked,notes,source_revision FROM games WHERE id = ?').get(id))
        .toEqual({pgn:original.pgn,eco:'C20',opening_name:"King's Pawn Game",bookmarked:1,notes:'Keep note',source_revision:4});
    } finally {
      vi.unstubAllGlobals();
      db.prepare('DELETE FROM games WHERE id = ?').run(id);
    }
  });
  it('rejects truncated export responses before committing any game', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`${JSON.stringify(lichessGame('partial_12'))}\n{"id":"truncated`, {status: 200})));
    try {
      const response = await importLichess();
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: 'lichess_unavailable' });
      expect(db.prepare("SELECT count(*) AS n FROM games WHERE user_id = 6 AND source = 'lichess'").get()).toEqual({ n: 0 });
    } finally { vi.unstubAllGlobals(); }
  });

  it('refuses cross-account overrides and does not call Lichess', async () => {
    const fetchSpy = vi.fn(async () => { throw new Error('must-not-fetch'); });
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const response = await importLichess('foreign');
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'linked_account_mismatch' });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('aborts an in-flight Lichess download when the linked account changes', async () => {
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async () => { started(); await held;
      return new Response(JSON.stringify(lichessGame('account_switched_123')), { status: 200 });
    }));
    try {
      const pending = importLichess();
      await entered;
      db.prepare("UPDATE profiles SET lichess_username = 'new_lichess' WHERE user_id = 6").run();
      release();
      const response = await pending;
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'linked_account_changed' });
      expect(db.prepare("SELECT count(*) AS n FROM games WHERE user_id = 6 AND source = 'lichess'").get()).toEqual({ n: 0 });
    } finally {
      release(); vi.unstubAllGlobals();
      db.prepare("UPDATE profiles SET lichess_username = 'importer' WHERE user_id = 6").run();
    }
  });

  it('rolls back all new Lichess games when an insertion fails', async () => {
    const rows = [lichessGame('agentc_good_123'), lichessGame('agentc_bad_123')];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(rows.map(row => JSON.stringify(row)).join('\n'), { status: 200 })));
    db.exec(`CREATE TRIGGER agentc_lichess_failure BEFORE INSERT ON games
      WHEN NEW.user_id = 6 AND NEW.external_id = 'agentc_bad_123'
      BEGIN SELECT RAISE(ABORT, 'synthetic_import_failure'); END;`);
    try {
      const response = await importLichess();
      expect(response.status).toBe(500);
      expect(db.prepare("SELECT count(*) AS n FROM games WHERE user_id = 6 AND source = 'lichess'").get()).toEqual({ n: 0 });
    } finally { db.exec('DROP TRIGGER agentc_lichess_failure'); vi.unstubAllGlobals(); }
  });

  it('rolls back duplicate Lichess opening enrichment when a later insertion fails', async () => {
    const first = lichessGame('agentc_lc_metadata_original');
    const second = lichessGame('agentc_lc_metadata_failure');
    const id = Number(db.prepare(`INSERT INTO games
      (user_id, source, external_id, pgn, white, black, result, user_color, source_revision)
      VALUES (6, 'lichess', ?, ?, 'importer', 'opponent', 'win', 'white', 12)`)
      .run(first.id, first.pgn).lastInsertRowid);
    db.exec(`CREATE TRIGGER agentc_lichess_metadata_failure BEFORE INSERT ON games
      WHEN NEW.user_id = 6 AND NEW.external_id = '${second.id}'
      BEGIN SELECT RAISE(ABORT, 'synthetic_import_failure'); END;`);
    vi.stubGlobal('fetch', vi.fn(async () => new Response([first,second].map(x => JSON.stringify(x)).join('\n'), {status:200})));
    try {
      expect((await importLichess()).status).toBe(500);
      expect(db.prepare('SELECT eco,opening_name,source_revision FROM games WHERE id = ?').get(id))
        .toEqual({eco:null,opening_name:null,source_revision:12});
      expect(db.prepare('SELECT count(*) AS n FROM games WHERE user_id = 6 AND external_id = ?').get(second.id))
        .toEqual({n:0});
    } finally {
      vi.unstubAllGlobals();
      db.exec('DROP TRIGGER agentc_lichess_metadata_failure');
      db.prepare('DELETE FROM games WHERE id = ?').run(id);
    }
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
