import { db } from '../db.js';
import { fetchRecentGames, toImportRow, type LichessGame } from './lichess.js';
import { prepareImportedOpeningEnrichment } from './importOpening.js';

export interface ImportCounts {
  imported: number;
  total: number;
  skipped: number;
  duplicates: number;
  enriched: number;
}

/** Shared by bounded imports and full-history batches. Existing game content,
 * annotations, analysis and ratings are never replaced; every batch is atomic.
 */
export function storeLichessGames(userId: number, username: string, games: LichessGame[]): ImportCounts {
  const rows = games.map((game) => toImportRow(game, username)).filter((row) => row !== null);
  const insert = db.prepare(`
    INSERT INTO games (user_id, source, external_id, pgn, white, black, result, time_control, time_class, end_time, user_color, rated, eco, opening_name)
    VALUES (?, 'lichess', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(user_id, source, external_id) DO NOTHING
  `);
  const enrichOpening = prepareImportedOpeningEnrichment(db);
  return db.transaction(() => {
    // Verify on every batch, *after* fetching and *before* writing anything.
    const linked = db.prepare('SELECT lichess_username AS username FROM profiles WHERE user_id = ?')
      .get(userId) as { username: string | null } | undefined;
    if (linked?.username?.toLowerCase() !== username.toLowerCase()) throw new Error('linked_account_changed');
    let imported = 0;
    let duplicates = 0;
    let enriched = 0;
    for (const row of rows) {
      const result = insert.run(userId, row.external_id, row.pgn, row.white, row.black, row.result,
        row.time_control, row.time_class, row.end_time, row.user_color, row.eco, row.opening_name);
      if (result.changes > 0) imported++;
      else {
        duplicates++;
        if (enrichOpening(userId, 'lichess', row.external_id, row.pgn,
          { eco: row.eco, openingName: row.opening_name })) enriched++;
      }
    }
    return { imported, total: games.length, skipped: games.length - rows.length, duplicates, enriched };
  })();
}

export async function importRecentLichessGames(userId: number, username: string, limit: number, since?: number): Promise<ImportCounts> {
  const games = await fetchRecentGames(username, { max: limit, since });
  return storeLichessGames(userId, username, games);
}
