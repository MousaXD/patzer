/** Explicit one-time historical Chess.com catch-up.
 *
 * This path is deliberately separate from autoImport.ts, which continues to
 * synchronize only the latest 20 games every 15 minutes. The importer uses the
 * same (user_id, source, external_id) unique key and never alters game PGN,
 * ratings or previously analyzed records. Each monthly archive is committed in
 * one transaction so an interrupted run can resume safely.
 */
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { getMonth, listArchives, type ChessComGame } from './chesscom.js';
import { importOpeningMetadata } from './importOpening.js';
import { Chess } from 'chess.js';

export interface HistoryProgress {
  archive: string;
  completed: number;
  archives: number;
  fetched: number;
  added: number;
  duplicates: number;
  skipped: number;
}

export interface HistoryResult {
  archives: number;
  completed: number;
  gamesFetched: number;
  imported: number;
  duplicates: number;
  skippedNonStandardOrInvalid: number;
}

type HistoryDeps = {
  archives?: (username: string) => Promise<string[]>;
  month?: (url: string) => Promise<ChessComGame[]>;
  delay?: (ms: number) => Promise<void>;
  onMonth?: (progress: HistoryProgress) => void | Promise<void>;
  alreadyCompleted?: ReadonlySet<string>;
};

function retryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:chesscom_(?:408|425|429|500|502|503|504)|timeout|timed out|abort|network|fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT)/i.test(message) ||
    (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'));
}

export async function retryChessCom<T>(
  work: () => Promise<T>,
  delay: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await work(); }
    catch (error) {
      if (!retryable(error) || attempt >= 4) throw error;
      await delay(Math.min(1000 * 2 ** attempt, 8000));
    }
  }
}

function gameResult(game: ChessComGame, color: 'white' | 'black'): 'win' | 'draw' | 'loss' | null {
  const outcome = color === 'white' ? game.white?.result : game.black?.result;
  if (typeof outcome !== 'string') return null;
  if (outcome === 'win') return 'win';
  if (['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'].includes(outcome)) return 'draw';
  // Do not misreport a malformed, unknown or newly introduced outcome as a
  // loss. An unknown result is omitted from this one-time historical import.
  if (['checkmated', 'resigned', 'timeout', 'abandoned', 'lose', 'kingofthehill',
       'threecheck', 'bughousepartnerlose'].includes(outcome)) return 'loss';
  return null;
}

/** A game URL is an identifier, not a fetch target. Still validate the true
 * origin so lookalike domains are never stored as trusted Chess.com links. */
function validGameUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.host === 'www.chess.com' &&
      !url.username && !url.password;
  } catch { return false; }
}

function gameRow(game: ChessComGame, username: string) {
  // Chess.com payloads are not runtime-typed. Skip corrupt entries instead
  // of rolling back an entire monthly import transaction.
  if (!game || game.rules !== 'chess' || typeof game.pgn !== 'string' ||
      !game.pgn.trim() || game.pgn.length > 1_000_000 ||
      !validGameUrl(game.url) ||
      !Number.isFinite(game.end_time)) return null;
  const endDate = new Date(game.end_time * 1000);
  if (!Number.isFinite(endDate.getTime())) return null;
  const white = game.white?.username;
  const black = game.black?.username;
  if (typeof white !== 'string' || typeof black !== 'string' || !white || !black) return null;
  const lc = username.toLowerCase();
  const userColor: 'white' | 'black' | null = white.toLowerCase() === lc ? 'white' : black.toLowerCase() === lc ? 'black' : null;
  if (!userColor) return null;
  // The opening lookup can return null for both legitimate unrecognized
  // openings and malformed PGNs; validate legality independently so corrupt
  // source data never reaches the analysis or review pipeline.
  try { new Chess().loadPgn(game.pgn, { strict: false }); } catch { return null; }
  const result = gameResult(game, userColor);
  if (result === null) return null;
  const {eco, openingName} = importOpeningMetadata(game.pgn);
  return {
    externalId: game.url,
    pgn: game.pgn,
    white,
    black,
    result,
    timeControl: game.time_control ?? null,
    timeClass: ['bullet', 'blitz', 'rapid', 'daily'].includes(game.time_class) ? game.time_class : null,
    endTime: endDate.toISOString(),
    userColor,
    eco,
    openingName,
  };
}

/** Import all standard games represented in the public monthly archives.
 * The archive URLs come from Chess.com's validated listArchives() implementation.
 * Any failed month stops the job without claiming completion. Reruns dedupe.
 */
export async function importChessComHistory(
  database: SqliteDatabase,
  userId: number,
  username: string,
  deps: HistoryDeps = {},
): Promise<HistoryResult> {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !/^[a-zA-Z0-9_-]{2,40}$/.test(username)) {
    throw new Error('invalid_user');
  }
  const delay = deps.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const archives = await retryChessCom(() => (deps.archives ?? listArchives)(username), delay);
  if (!archives.length) throw new Error('no_archives');
  // Source URLs must be authentic even when an injected client is used.
  const safeArchives = [...new Set(archives.map((url) => {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error('invalid_archive_url'); }
    const match = /^\/pub\/player\/([A-Za-z0-9_-]+)\/games\/(\d{4})\/(\d{2})$/.exec(parsed.pathname);
    if (parsed.protocol !== 'https:' || parsed.host !== 'api.chess.com' ||
        parsed.username || parsed.password || parsed.search || parsed.hash ||
        !match || match[1]!.toLowerCase() !== username.toLowerCase() ||
        Number(match[3]) < 1 || Number(match[3]) > 12) {
      throw new Error('invalid_archive_url');
    }
    return url;
  }))];
  const result: HistoryResult = {
    archives: safeArchives.length, completed: 0, gamesFetched: 0, imported: 0,
    duplicates: 0, skippedNonStandardOrInvalid: 0,
  };
  const insert = database.prepare(`
    INSERT INTO games (user_id, source, external_id, pgn, white, black, result,
      time_control, time_class, end_time, user_color, rated, eco, opening_name)
    VALUES (?, 'chesscom', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(user_id, source, external_id) DO NOTHING
  `);
  const insertMonth = database.transaction((games: ChessComGame[]) => {
    let added = 0;
    let duplicates = 0;
    let skipped = 0;
    for (const game of games) {
      const row = gameRow(game, username);
      if (!row) { skipped++; continue; }
      const saved = insert.run(userId, row.externalId, row.pgn, row.white, row.black,
        row.result, row.timeControl, row.timeClass, row.endTime, row.userColor,
        row.eco, row.openingName);
      if (saved.changes) added++; else duplicates++;
    }
    return { added, duplicates, skipped };
  });
  for (const archive of safeArchives) {
    if (deps.alreadyCompleted?.has(archive)) continue;
    const games = await retryChessCom(() => (deps.month ?? getMonth)(archive), delay);
    const { added, duplicates, skipped } = insertMonth(games);
    result.completed++;
    result.gamesFetched += games.length;
    result.imported += added;
    result.duplicates += duplicates;
    result.skippedNonStandardOrInvalid += skipped;
    // Advance the user's checkpoint only after the full monthly transaction.
    await deps.onMonth?.({ archive, completed: result.completed, archives: result.archives,
      fetched: games.length, added, duplicates, skipped });
    // Sequential archive requests and a small delay avoid hammering Chess.com.
    await delay(350);
  }
  return result;
}
