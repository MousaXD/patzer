/** Derive display-only opening metadata from an already validated PGN.
 * Never invent an opening name from an ECO header alone: a mislabeled source
 * PGN must not be promoted into Patzer's own chess classification. The
 * curated opening lookup is also used by the historical Chess.com importer.
 * The original PGN and the analysis source revision are never altered here.
 */
import { lookupOpeningFromPgn } from './openings.js';
import type { Database as SqliteDatabase } from 'better-sqlite3';

export interface ImportedOpening {
  eco: string | null;
  openingName: string | null;
}

export function importOpeningMetadata(pgn: string): ImportedOpening {
  const ecoHeader = /^\[ECO\s+"([A-E][0-9]{2})"\]/m.exec(pgn)?.[1] ?? null;
  const recognized = lookupOpeningFromPgn(pgn);
  const eco = ecoHeader ?? recognized?.eco ?? null;
  return { eco, openingName: recognized?.eco === eco ? recognized.name : null };
}

/** Enrich only a previously saved copy of the *identical* PGN. Never replace
 * a PGN, overwrite existing ECO/label, change the analysis source revision,
 * or attribute the same external game to another user. Prepare once per batch
 * so duplicate-heavy imports do not recompile the SQL on every game.
 */
export function prepareImportedOpeningEnrichment(database: SqliteDatabase) {
  const update = database.prepare(`
    UPDATE games
    SET eco = COALESCE(eco, @eco),
        opening_name = CASE
          WHEN opening_name IS NULL AND (eco IS NULL OR eco = @eco)
          THEN @openingName ELSE opening_name END
    WHERE user_id = @userId AND source = @source AND external_id = @externalId
      AND pgn = @pgn
      AND (
        (eco IS NULL AND @eco IS NOT NULL)
        OR (opening_name IS NULL AND @openingName IS NOT NULL
            AND (eco IS NULL OR eco = @eco))
      )
  `);
  return (userId: number, source: 'chesscom' | 'lichess', externalId: string,
    pgn: string, opening: ImportedOpening): boolean => {
    if (!opening.eco && !opening.openingName) return false;
    return update.run({
      userId, source, externalId, pgn,
      eco: opening.eco, openingName: opening.openingName,
    }).changes > 0;
  };
}
