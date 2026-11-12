// Chess.com games → `games` rows. Shared by the "Import" button and any other
// caller that needs chess.com games deduped and labelled identically.

import { db } from '../db.js';
import { fetchRecentGames, type ChessComGame } from './chesscom.js';
import { Chess } from 'chess.js';

export async function importChessComGames(userId: number, username: string, limit: number): Promise<{ imported: number; total: number; skipped: number; duplicates: number }> {
  const games = await fetchRecentGames(username, limit);
  // Imported chess.com games are NEVER rated in Patzer's pool — they have their
  // own chess.com rating that lives there. Only PvP games inside Patzer count.
  const stmt = db.prepare(`
    INSERT INTO games (user_id, source, external_id, pgn, white, black, result, time_control, time_class, end_time, user_color, rated)
    VALUES (?, 'chesscom', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(user_id, source, external_id) DO NOTHING
  `);

  let imported = 0;
  let skipped = 0;
  let duplicates = 0;
  for (const game of games) {
    const row = validImportRow(game, username);
    // One malformed upstream game must never block the rest of this import,
    // invent a loss, or contaminate this user's game library.
    if (!row) { skipped++; continue; }
    const r = stmt.run(userId, row.url, row.pgn, row.white, row.black, row.result,
      row.timeControl, row.timeClass, row.endTime, row.userColor);
    if (r.changes > 0) imported++;
    else duplicates++;
  }
  return { imported, total: games.length, skipped, duplicates };
}


interface ImportRow {
  url: string;
  pgn: string;
  white: string;
  black: string;
  result: 'win' | 'draw' | 'loss' | null;
  timeControl: string | null;
  timeClass: string | null;
  endTime: string;
  userColor: 'white' | 'black';
}

function validImportRow(game: ChessComGame, username: string): ImportRow | null {
  // Public Chess.com data is not runtime-typed and an archive might contain
  // malformed or unrelated games. Validate each record before any SQL write.
  if (!game || game.rules !== 'chess' || typeof game.url !== 'string' ||
      typeof game.pgn !== 'string' || !game.pgn.trim() || game.pgn.length > 1_000_000 ||
      !Number.isFinite(game.end_time) ||
      typeof game.white?.username !== 'string' || !game.white.username ||
      typeof game.black?.username !== 'string' || !game.black.username) return null;
  try {
    const url = new URL(game.url);
    if (url.protocol !== 'https:' || url.host !== 'www.chess.com' || url.username || url.password) return null;
    // Never store corrupt PGNs: later analysis/review assumes legal chess.
    new Chess().loadPgn(game.pgn, { strict: false });
  } catch { return null; }
  const endDate = new Date(game.end_time * 1000);
  if (!Number.isFinite(endDate.getTime())) return null;
  const lc = username.toLowerCase();
  const userColor = game.white.username.toLowerCase() === lc ? 'white'
    : game.black.username.toLowerCase() === lc ? 'black' : null;
  if (!userColor) return null;

  const outcome = userColor === 'white' ? game.white.result : game.black.result;
  let result: ImportRow['result'] = null;
  if (outcome === 'win') result = 'win';
  else if (['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'].includes(outcome)) result = 'draw';
  else if (['checkmated', 'resigned', 'timeout', 'abandoned', 'lose', 'kingofthehill',
    'threecheck', 'bughousepartnerlose'].includes(outcome)) result = 'loss';
  // Unknown Chess.com outcomes are retained with result=NULL rather than
  // silently being counted as losses in lifetime win/loss statistics.
  return {
    url: game.url, pgn: game.pgn, white: game.white.username, black: game.black.username,
    result, timeControl: typeof game.time_control === 'string' ? game.time_control : null,
    timeClass: ['bullet', 'blitz', 'rapid', 'daily'].includes(game.time_class) ? game.time_class : null,
    endTime: endDate.toISOString(), userColor,
  };
}
