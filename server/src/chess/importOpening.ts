/** Derive display-only opening metadata from an already validated PGN.
 * Never invent an opening name from an ECO header alone: a mislabeled source
 * PGN must not be promoted into Patzer's own chess classification. The
 * curated opening lookup is also used by the historical Chess.com importer.
 * The original PGN and the analysis source revision are never altered here.
 */
import { lookupOpeningFromPgn } from './openings.js';

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
