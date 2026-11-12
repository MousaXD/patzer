import { Hono } from 'hono';
import { parseGameId, parseGameListQuery } from './platformQueries.js';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { getPlayer } from '../chess/chesscom.js';
import { importChessComGames } from '../chess/chesscomImport.js';
import { fetchRecentGames as fetchLichessGames, toImportRow } from '../chess/lichess.js';
import { SCORING_VERSION } from '../chess/classifier.js';
import { analysisMatchesGame, type AnalysisGameSource } from '../chess/analysisSource.js';
import { Chess } from 'chess.js';
import { clearLiveBotGame, loadLiveBotGame, resumableSummary } from '../chess/liveBotGames.js';

const router = new Hono();
router.use('*', requireAuth);

router.get('/', (c) => {
  const user = c.get('user');
  const query = parseGameListQuery(new URL(c.req.url).searchParams);
  if (!query) return c.json({ error: 'invalid_input' }, 400);

  // Both queries enforce user ownership. Stale analyses are not "analyzed".
  const filters: string[] = ['g.user_id = ?'];
  const params: (string | number)[] = [user.id];
  // Lightweight revision/provenance gate for paginated summaries. A PGN edit
  // invalidates the displayed score immediately, even after a v9->v10
  // aggregation migration. Full source/PGN replay remains in GET /:id.
  const usableAnalysisSql = `a.game_id IS NOT NULL AND a.scoring_version >= ?
    AND a.source_hash IS NOT NULL AND a.source_revision = g.source_revision
    AND a.analysis_generation > 0`;
  if (query.bookmarked) filters.push('g.bookmarked = 1');
  if (query.source !== null) { filters.push('g.source = ?'); params.push(query.source); }
  if (query.timeClass !== null) { filters.push('g.time_class = ?'); params.push(query.timeClass); }
  if (query.result !== null) { filters.push('g.result = ?'); params.push(query.result); }
  if (query.analyzed !== null) {
    // Keep the positive predicates visible to SQLite's join planner. Wrapping
    // both cases in COALESCE forces a full games-side LEFT JOIN for the count.
    filters.push(query.analyzed ? `(${usableAnalysisSql})` : `COALESCE((${usableAnalysisSql}), 0) = 0`);
    params.push(SCORING_VERSION);
  }
  if (query.q) {
    // Literal substring search: percent and underscore are not wildcards.
    filters.push(`(
      instr(LOWER(COALESCE(g.white, '')), ?) > 0 OR
      instr(LOWER(COALESCE(g.black, '')), ?) > 0 OR
      instr(LOWER(COALESCE(g.opening_name, '')), ?) > 0 OR
      instr(LOWER(COALESCE(g.notes, '')), ?) > 0
    )`);
    params.push(query.q, query.q, query.q, query.q);
  }
  const joined = 'FROM games g LEFT JOIN analyses a ON a.game_id = g.id';
  const where = `WHERE ${filters.join(' AND ')}`;
  // The common unfiltered-by-analysis count needs only the user_id index;
  // avoid an unnecessary analyses lookup for every saved game.
  const countFrom = query.analyzed === null ? 'FROM games g' : joined;
  const total = db.prepare(`SELECT COUNT(*) AS n ${countFrom} ${where}`)
    .get(...params) as { n: number };
  // Never interpolate raw query parameters into ORDER BY.
  const order = query.sort === 'oldest'
    ? 'g.end_time ASC NULLS LAST, g.id ASC'
    : 'g.end_time DESC NULLS LAST, g.id DESC';
  const rows = db.prepare(`
    SELECT g.id, g.source, g.external_id, g.white, g.black, g.result, g.time_control, g.time_class,
           g.eco, g.opening_name, g.end_time, g.user_color, g.rated,
           g.user_rating_after, g.opponent_rating_after,
           g.bookmarked, g.notes, g.start_fen IS NOT NULL AS from_position,
           CASE WHEN (${usableAnalysisSql}) THEN 1 ELSE 0 END as analyzed,
           CASE WHEN (${usableAnalysisSql}) THEN a.accuracy_white ELSE NULL END as accuracy_white,
           CASE WHEN (${usableAnalysisSql}) THEN a.accuracy_black ELSE NULL END as accuracy_black,
           CASE WHEN (${usableAnalysisSql}) THEN a.performance_white ELSE NULL END as performance_white,
           CASE WHEN (${usableAnalysisSql}) THEN a.performance_black ELSE NULL END as performance_black
    ${joined} ${where}
    ORDER BY ${order}
    LIMIT ? OFFSET ?
  `).all(SCORING_VERSION, SCORING_VERSION, SCORING_VERSION, SCORING_VERSION, SCORING_VERSION,
    ...params, query.limit, query.offset) as { id: number }[];
  return c.json({
    games: rows, total: total.n,
    limit: query.limit, offset: query.offset,
    has_more: query.offset + rows.length < total.n,
  });
});

// Games you can walk back into: the bot game you left mid-move, and any PvP
// game with a friend that hasn't finished. Registered BEFORE `/:id` — Hono
// matches in order, and `/:id` would otherwise swallow `/live`.
//
// This is the entry point that didn't exist before v7.14.0: leaving a game and
// coming back had no route through the UI at all. You had to still have the
// original URL.
interface UnfinishedPvpRow {
  id: number; white: string; black: string; user_color: 'white' | 'black';
  time_control: string; pgn: string; last_move_at: string | null; created_at: string;
}

router.get('/live', (c) => {
  const user = c.get('user');

  // Validate before counting a result toward the 20 playable games. Applying
  // LIMIT 20 *before* checking PGNs can hide an older resumable game whenever
  // recent records contain malformed or already-finished positions. Scan in
  // bounded batches so a corrupt history cannot cause unbounded PGN parsing.
  const page = db.prepare(`
    SELECT id, white, black, user_color, time_control, pgn, last_move_at, created_at
    FROM games
    WHERE user_id = ? AND source = 'pvp' AND end_time IS NULL
      AND COALESCE(last_move_at, created_at) > datetime('now','-14 days')
    ORDER BY COALESCE(last_move_at, created_at) DESC, id DESC
    LIMIT ? OFFSET ?
  `);
  const MAX_RESULTS = 20;
  const MAX_SCANNED = 100;
  const pvp: { game_id: number; opponent: string; user_color: 'white' | 'black';
    time_control: string; ply: number; updated_at: string }[] = [];
  let scanned = 0;
  while (pvp.length < MAX_RESULTS && scanned < MAX_SCANNED) {
    const batchSize = Math.min(MAX_RESULTS, MAX_SCANNED - scanned);
    const batch = page.all(user.id, batchSize, scanned) as UnfinishedPvpRow[];
    if (!batch.length) break;
    scanned += batch.length;
    for (const row of batch) {
      let ply = 0;
      try {
        const probe = new Chess();
        if (row.pgn && row.pgn.trim()) probe.loadPgn(row.pgn, { strict: false });
        // A finished position without end_time cannot be resumed.
        if (probe.isGameOver()) continue;
        ply = probe.history().length;
      } catch {
        continue;
      }
      pvp.push({
        game_id: row.id,
        opponent: row.user_color === 'white' ? row.black : row.white,
        user_color: row.user_color,
        time_control: row.time_control,
        ply,
        updated_at: row.last_move_at ?? row.created_at,
      });
      if (pvp.length >= MAX_RESULTS) break;
    }
    if (batch.length < batchSize) break;
  }

  return c.json({ bot: resumableSummary(loadLiveBotGame(user.id)), pvp });
});

/** "Start a new one instead" — throw away the stored bot game. */
router.delete('/live/bot', (c) => {
  const user = c.get('user');
  if (!clearLiveBotGame(user.id)) return c.json({ error: 'discard_failed' }, 503);
  return c.json({ ok: true });
});

const notesSchema = z.object({ notes: z.string().max(4000) });
router.patch('/:id/notes', async (c) => {
  const user = c.get('user');
  const id = parseGameId(c.req.param('id'));
  if (id === null) return c.json({ error: 'invalid_input' }, 400);
  const body = await c.req.json().catch(() => ({}));
  const parsed = notesSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const r = db.prepare('UPDATE games SET notes = ? WHERE id = ? AND user_id = ?').run(parsed.data.notes, id, user.id);
  if (r.changes === 0) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

const bookmarkSchema = z.object({ bookmarked: z.boolean() });
router.patch('/:id/bookmark', async (c) => {
  const user = c.get('user');
  const id = parseGameId(c.req.param('id'));
  if (id === null) return c.json({ error: 'invalid_input' }, 400);
  const body = await c.req.json().catch(() => ({}));
  const parsed = bookmarkSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const r = db.prepare('UPDATE games SET bookmarked = ? WHERE id = ? AND user_id = ?').run(parsed.data.bookmarked ? 1 : 0, id, user.id);
  if (r.changes === 0) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, bookmarked: parsed.data.bookmarked });
});

router.get('/:id', (c) => {
  const user = c.get('user');
  const id = parseGameId(c.req.param('id'));
  if (id === null) return c.json({ error: 'invalid_input' }, 400);
  const game = db.prepare('SELECT * FROM games WHERE id = ? AND user_id = ?').get(id, user.id) as AnalysisGameSource | undefined;
  if (!game) return c.json({ error: 'not_found' }, 404);
  const analysis = db.prepare('SELECT * FROM analyses WHERE game_id = ?').get(id) as
    | { scoring_version: number; source_hash: string | null; source_revision: number | null; analysis_generation: number; moves_json: string }
    | undefined;
  // Legacy cached prose is retained until the user explicitly reanalyzes.
  // Opening a migrated game must not silently replace its historical cache.
  const unverified = !!analysis && (!analysis.source_hash || analysis.source_revision === null
    || analysis.analysis_generation < 1);
  const stale = !!(analysis && (analysis.scoring_version < SCORING_VERSION ||
    analysis.analysis_generation < 1 ||
    !analysisMatchesGame(game, analysis)));
  return c.json({
    game,
    analysis: stale ? null : analysis,
    analysis_stale: stale,
    analysis_unverified: unverified,
  });
});

router.delete('/:id', (c) => {
  const user = c.get('user');
  const id = parseGameId(c.req.param('id'));
  if (id === null) return c.json({ error: 'invalid_input' }, 400);
  const r = db.prepare('DELETE FROM games WHERE id = ? AND user_id = ?').run(id, user.id);
  if (r.changes === 0) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

const importSchema = z.object({
  username: z.string().trim().regex(/^[A-Za-z0-9_-]{2,40}$/).optional(),
  limit: z.number().int().min(1).max(200).default(20),
});

// Limit one manual Chess.com import per user, including the initial profile lookup.
// Automatic background sync keeps its existing independent schedule.
const chesscomImportsRunning = new Set<number>();

router.post('/import/chesscom', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const username = parsed.data.username ?? user.profile.chesscom_username;
  if (!username) return c.json({ error: 'no_chesscom_username' }, 400);

  if (chesscomImportsRunning.has(user.id)) return c.json({ error: 'import_in_progress' }, 429);
  chesscomImportsRunning.add(user.id);
  try {
    const player = await getPlayer(username);
    if (!player) return c.json({ error: 'player_not_found' }, 404);
    return c.json(await importChessComGames(user.id, username, parsed.data.limit));
  } finally {
    chesscomImportsRunning.delete(user.id);
  }
});

const lichessImportSchema = z.object({
  username: z.string().trim().regex(/^[A-Za-z0-9_-]{2,30}$/).optional(),
  limit: z.number().int().min(1).max(200).default(20),
  // Only games that ended after this moment (ms since epoch).
  since: z.number().int().positive().optional(),
});

// Requests to Lichess go out one at a time for the whole server, so one
// account may only have one import waiting — a user clicking "Import" over and
// over must not hold up everyone else's.
const lichessImportsRunning = new Set<number>();

router.post('/import/lichess', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = lichessImportSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const username = parsed.data.username ?? user.profile.lichess_username;
  if (!username) return c.json({ error: 'no_lichess_username' }, 400);
  if (lichessImportsRunning.has(user.id)) return c.json({ error: 'import_in_progress' }, 429);

  let games;
  lichessImportsRunning.add(user.id);
  try {
    games = await fetchLichessGames(username, { max: parsed.data.limit, since: parsed.data.since });
  } catch (e) {
    const code = (e as Error).message;
    if (code === 'not_found') return c.json({ error: 'player_not_found' }, 404);
    if (code === 'rate_limited') return c.json({ error: 'lichess_rate_limited' }, 429);
    if (code === 'invalid_username') return c.json({ error: 'invalid_input' }, 400);
    return c.json({ error: 'lichess_unavailable' }, 502);
  } finally {
    lichessImportsRunning.delete(user.id);
  }

  // Same rules as the chess.com importer: never rated in Patzer's pool, and
  // the (user, source, external_id) key makes a re-import a no-op.
  const stmt = db.prepare(`
    INSERT INTO games (user_id, source, external_id, pgn, white, black, result, time_control, time_class, end_time, user_color, rated)
    VALUES (?, 'lichess', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(user_id, source, external_id) DO NOTHING
  `);
  let imported = 0;
  let skipped = 0;
  for (const g of games) {
    const row = toImportRow(g, username);
    if (!row) { skipped++; continue; }
    const r = stmt.run(user.id, row.external_id, row.pgn, row.white, row.black, row.result,
      row.time_control, row.time_class, row.end_time, row.user_color);
    if (r.changes > 0) imported++;
  }

  return c.json({ imported, total: games.length, skipped });
});

export default router;
