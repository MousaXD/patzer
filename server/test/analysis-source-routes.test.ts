import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Real Hono + authenticated disposable SQLite + actual local Stockfish.
// Explicitly opt in to the bounded engine run, rather than invoking any
// hosted engine or touching a real user's database in CI.
const enginePath = process.env.PATZER_TEST_STOCKFISH;
const engineAvailable = !!enginePath && existsSync(enginePath);
const suite = engineAvailable ? describe : describe.skip;
const tmp = mkdtempSync(join(tmpdir(), 'patzer-analysis-source-http-'));
process.env.DB_PATH = join(tmp, 'source-http.sqlite');
process.env.ENGINE_BACKEND = 'local';
if (engineAvailable) process.env.STOCKFISH_PATH = enginePath;
const fools = '1. f3 e5 2. g4 Qh4# 0-1';
const scholars = '1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0';
const altFour = '1. e4 e5 2. Nf3 Nc6 *';

suite('actual authenticated Hono engine-source cache, bounded Stockfish depth 8', () => {
  let db: typeof import('../src/db.js')['db'];
  let analyze: (path: string, init?: RequestInit) => Response | Promise<Response>;
  let games: (path: string, init?: RequestInit) => Response | Promise<Response>;
  let cookie: string;
  let otherCookie: string;
  let stockfish: typeof import('../src/chess/stockfish.js')['StockfishEngine'];
  const source = (id: number) => db.prepare('SELECT source_hash, source_revision, moves_json FROM analyses WHERE game_id = ?')
    .get(id) as { source_hash: string | null; source_revision: number | null; moves_json: string } | undefined;

  beforeAll(async () => {
    ({ db } = await import('../src/db.js'));
    const sessions = await import('../src/auth/sessions.js');
    analyze = (await import('../src/routes/analyze.js')).default.request.bind(
      (await import('../src/routes/analyze.js')).default,
    );
    games = (await import('../src/routes/games.js')).default.request.bind(
      (await import('../src/routes/games.js')).default,
    );
    stockfish = (await import('../src/chess/stockfish.js')).StockfishEngine;
    db.prepare("INSERT INTO users (id,username,password_hash,role) VALUES (1,'source_owner','x','user')").run();
    db.prepare("INSERT INTO users (id,username,password_hash,role) VALUES (2,'source_other','x','user')").run();
    db.prepare("INSERT INTO profiles (user_id,display_name) VALUES (1,'Source Owner')").run();
    db.prepare("INSERT INTO profiles (user_id,display_name) VALUES (2,'Source Other')").run();
    cookie = `${sessions.SESSION_COOKIE_NAME}=${encodeURIComponent(sessions.createSession(1))}`;
    otherCookie = `${sessions.SESSION_COOKIE_NAME}=${encodeURIComponent(sessions.createSession(2))}`;
    const insert = db.prepare(
      "INSERT INTO games (id,user_id,source,external_id,pgn,user_color,result) VALUES (?,1,'imported',? ,?,'white',NULL)",
    );
    insert.run(1, 'qa-source-1', fools);
    insert.run(2, 'qa-source-2', altFour);
    insert.run(3, 'qa-source-race', fools);
    insert.run(4, 'qa-source-aba', fools);
  });

  afterAll(() => {
    try { db?.close(); } catch { /* nothing to close */ }
    rmSync(tmp, { recursive: true, force: true });
  });

  const post = (id: number, headers?: Record<string, string>, force = false) =>
    analyze('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(headers ?? { Cookie: cookie }) },
      body: JSON.stringify({ game_id: id, depth: 8, force }),
    });

  it('rejects nonowners and unauthenticated engine/game accesses', async () => {
    expect((await post(1, {})).status).toBe(401);
    expect((await post(1, { Cookie: otherCookie })).status).toBe(404);
    expect((await games('/1', { headers: { Cookie: otherCookie } })).status).toBe(404);
  });

  it('returns a genuine valid cache hit for unchanged source', async () => {
    const fresh = await post(1);
    expect(fresh.status).toBe(200);
    expect(await fresh.json()).toMatchObject({ cached: false });
    expect(JSON.parse(source(1)!.moves_json)).toHaveLength(4);
    expect(source(1)!.source_hash).toMatch(/^[a-f0-9]{64}$/);
    const cached = await post(1);
    expect(cached.status).toBe(200);
    expect(await cached.json()).toMatchObject({ cached: true });
    const game = await games('/1', { headers: { Cookie: cookie } });
    expect((await game.json() as { analysis_stale: boolean }).analysis_stale).toBe(false);
  }, 60_000);

  it('same game, different PGN rejects the old cache and persists new evidence', async () => {
    const oldRevision = source(1)!.source_revision!;
    db.prepare('UPDATE games SET pgn = ? WHERE id = 1').run(scholars);
    const staleGame = await games('/1', { headers: { Cookie: cookie } });
    expect((await staleGame.json() as { analysis_stale: boolean; analysis: unknown }))
      .toMatchObject({ analysis_stale: true, analysis: null });
    const listing = await games('/?limit=10', { headers: { Cookie: cookie } });
    const listed = (await listing.json()) as { games: {
      id: number; analyzed: number; accuracy_white: number | null;
    }[] };
    expect(listed.games.find((item) => item.id === 1)).toMatchObject({
      analyzed: 0, accuracy_white: null,
    });
    const staleFiltered = await games('/?analyzed=0&limit=10', { headers: { Cookie: cookie } });
    expect(((await staleFiltered.json()) as { games: { id: number }[] }).games.some((item) => item.id === 1))
      .toBe(true);
    const result = await post(1);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ cached: false });
    expect(JSON.parse(source(1)!.moves_json)).toHaveLength(7);
    expect(source(1)!.source_revision).toBe(oldRevision + 1);
    const freshFiltered = await games('/?analyzed=1&limit=10', { headers: { Cookie: cookie } });
    expect(((await freshFiltered.json()) as { games: { id: number }[] }).games.some((item) => item.id === 1))
      .toBe(true);
  }, 60_000);

  it('same ply count in another game never qualifies as an old cache hit', async () => {
    const first = await post(2);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ cached: false });
    db.prepare('UPDATE games SET pgn = ? WHERE id = 2').run('1. d4 d5 2. c4 e6 *');
    const second = await post(2);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ cached: false });
    expect(JSON.parse(source(2)!.moves_json)[0].san).toBe('d4');
  }, 60_000);

  it('legacy NULL source identity never counts as a cache hit', async () => {
    db.prepare('UPDATE analyses SET source_hash = NULL, source_revision = NULL WHERE game_id = 2').run();
    const staleGame = await games('/2', { headers: { Cookie: cookie } });
    expect((await staleGame.json() as { analysis_stale: boolean }).analysis_stale).toBe(true);
    const repaired = await post(2);
    expect(repaired.status).toBe(200);
    expect(await repaired.json()).toMatchObject({ cached: false });
    expect(source(2)!.source_hash).not.toBeNull();
  }, 60_000);

  it.each([
    ['simple mutation', 3, false],
    ['ABA mutation', 4, true],
  ] as const)('rejects real in-flight Stockfish work after %s', async (_name, id, aba) => {
    let signalEntered!: () => void;
    let signalRelease!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const release = new Promise<void>((resolve) => { signalRelease = resolve; });
    const original = stockfish.prototype.evaluateMulti;
    let first = true;
    const spy = vi.spyOn(stockfish.prototype, 'evaluateMulti').mockImplementation(async function (
      this: InstanceType<typeof stockfish>, fen, depth, lines,
    ) {
      if (first) {
        first = false;
        signalEntered();
        await release;
      }
      return original.call(this, fen, depth, lines);
    });
    try {
      const inflight = post(id);
      await entered; // guaranteed the old PGN was captured before mutation
      db.prepare('UPDATE games SET pgn = ? WHERE id = ?').run(scholars, id);
      if (aba) db.prepare('UPDATE games SET pgn = ? WHERE id = ?').run(fools, id);
      signalRelease();
      const rejected = await inflight;
      expect(rejected.status).toBe(409);
      expect(await rejected.json()).toMatchObject({ error: 'analysis_source_changed', stale: true });
      expect(source(id)).toBeUndefined();
      expect((await games(`/${id}`, { headers: { Cookie: cookie } })).status).toBe(200);
    } finally {
      signalRelease();
      spy.mockRestore();
    }
    if (aba) {
      const repaired = await post(id);
      expect(repaired.status).toBe(200);
      expect(await repaired.json()).toMatchObject({ cached: false });
    }
  }, 60_000);
});
