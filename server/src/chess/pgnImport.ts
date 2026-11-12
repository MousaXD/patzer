/** Explicit local PGN archive import. No external provider access or inferred
 * account identity: PGNs can describe games between arbitrary people.
 * Validate the *entire* bounded batch before taking SQLite's writer lock.
 */
import { createHash } from 'node:crypto';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { Chess } from 'chess.js';
import { importOpeningMetadata } from './importOpening.js';

export const MAX_PGN_ARCHIVE_BYTES = 4 * 1024 * 1024;
export const MAX_PGN_ARCHIVE_GAMES = 1000;
const MAX_SINGLE_PGN_BYTES = 256 * 1024;
const MAX_GAME_PLIES = 2048;

export class PgnImportError extends Error {
  constructor(public readonly code: string, public readonly gameIndex?: number) {
    super(code);
  }
}

/** Recognize standard multi-game exports through their top-level PGN tag
 * blocks. Event normally comes first, but valid exports can put Site or a
 * custom tag before it. A new header block after movetext starts a new game;
 * a following tag in the same block does not. Comments may contain
 * header-like lines; never split inside brace or semicolon comments.
 * A headerless *single* PGN remains valid.
 */
export function splitPgnArchive(input: string): string[] {
  if (!input || Buffer.byteLength(input, 'utf8') > MAX_PGN_ARCHIVE_BYTES) {
    throw new PgnImportError('pgn_too_large');
  }
  const text = input.replace(/^\uFEFF/, '').trim();
  if (!text) throw new PgnImportError('invalid_pgn', 1);
  const markers: number[] = [];
  let lastHeaderEnd: number | null = null;
  let scanAt = 0;
  let braceDepth = 0;
  let lineComment = false;
  let inTag = false;
  let inTagString = false;
  let tagEscape = false;
  // This lexer is linear in the original 4 MiB bound. It does not interpret
  // chess moves; chess.js validates every resulting whole PGN before insert.
  const header = /^\[[A-Za-z_][A-Za-z0-9_]*[ \t]+"(?:[^"\\\r\n]|\\.)*"\][ \t]*\r?$/gm;
  for (const match of text.matchAll(header)) {
    const index = match.index!;
    for (; scanAt < index; scanAt++) {
      const ch = text[scanAt];
      if (ch === '\n') { lineComment = false; continue; }
      if (lineComment) continue;
      if (braceDepth > 0) {
        if (ch === '{') braceDepth++;
        else if (ch === '}') braceDepth--;
        continue;
      }
      // A tag such as [Event "Study { session"] can contain braces or
      // semicolons as plain quoted text, not PGN comments.
      if (inTag) {
        if (inTagString) {
          if (tagEscape) tagEscape = false;
          else if (ch === '\\') tagEscape = true;
          else if (ch === '"') inTagString = false;
        } else if (ch === '"') inTagString = true;
        else if (ch === ']') inTag = false;
        continue;
      }
      if (ch === '{') braceDepth = 1;
      else if (ch === ';') lineComment = true;
      else if (ch === '[') inTag = true;
    }
    if (braceDepth === 0 && !lineComment && !inTag) {
      // PGN tags are consecutive at the start of a game. Non-whitespace
      // between two actual tags means the intervening game had movetext, so
      // the next tag begins another game even if it is not [Event ...].
      if (lastHeaderEnd === null || text.slice(lastHeaderEnd, index).trim()) {
        markers.push(index);
      }
      lastHeaderEnd = index + match[0].length;
    }
  }
  if (!markers.length) return [text];
  if (markers[0] !== 0) throw new PgnImportError('ambiguous_pgn_archive');
  if (markers.length > MAX_PGN_ARCHIVE_GAMES) throw new PgnImportError('pgn_too_many_games');
  return markers.map((pos, i) => text.slice(pos, markers[i + 1] ?? text.length).trim());
}

interface ParsedGame {
  pgn: string;
  externalId: string;
  white: string | null;
  black: string | null;
  timeControl: string | null;
  eco: string | null;
  openingName: string | null;
}

/** Check only the PGN's initial tag section, not header-looking lines inside
 * later move comments. chess.js can normalize away a declared FEN/SetUp tag
 * when it matches the standard start, so normalized getHeaders() alone is
 * insufficient for our explicit custom-position safety check.
 */
function declaredPositionHeaders(pgn: string): {hasFen: boolean; nonStandardSetup: boolean} {
  let hasFen = false;
  let nonStandardSetup = false;
  for (const rawLine of pgn.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^\[([A-Za-z_][A-Za-z0-9_]*)[ \t]+"((?:[^"\\]|\\.)*)"\]$/.exec(line);
    if (!match) break; // Movetext begins: later [FEN] examples are just comments.
    if (match[1] === 'FEN') hasFen = true;
    if (match[1] === 'SetUp' && match[2] !== '0') nonStandardSetup = true;
  }
  return {hasFen, nonStandardSetup};
}

function parsedGame(pgn: string, index: number): ParsedGame {
  if (!pgn || Buffer.byteLength(pgn, 'utf8') > MAX_SINGLE_PGN_BYTES) {
    throw new PgnImportError('pgn_game_too_large', index);
  }
  const chess = new Chess();
  try { chess.loadPgn(pgn, { strict: false }); }
  catch { throw new PgnImportError('invalid_pgn', index); }
  const headers = chess.getHeaders();
  if (chess.history().length === 0 || chess.history().length > MAX_GAME_PLIES) {
    throw new PgnImportError('invalid_pgn', index);
  }
  // A declared SetUp "0" is an ordinary standard game, not a custom start.
  // Reject actual FEN/setup headers without rejecting tag-shaped examples
  // inside annotated move comments.
  const declaredPosition = declaredPositionHeaders(pgn);
  if ((headers.Variant && !['standard', 'chess'].includes(headers.Variant.toLowerCase())) ||
      declaredPosition.hasFen || declaredPosition.nonStandardSetup ||
      (headers.SetUp && headers.SetUp !== '0') || headers.FEN) {
    throw new PgnImportError('unsupported_pgn_position', index);
  }
  const name = (v: string | undefined) => {
    const value = v?.trim();
    if (!value || value === '?') return null;
    // Do not discard a real, potentially international player name because
    // its header is long. Bound the materialized list metadata without
    // splitting a Unicode character, and leave the full original PGN intact.
    const chars = Array.from(value);
    return chars.length <= 120 ? value : `${chars.slice(0,119).join('')}…`;
  };
  const opening = importOpeningMetadata(pgn);
  return {
    pgn,
    externalId: `sha256:${createHash('sha256').update(pgn, 'utf8').digest('hex')}`,
    white: name(headers.White),
    black: name(headers.Black),
    timeControl: name(headers.TimeControl)?.slice(0, 64) ?? null,
    eco: opening.eco,
    openingName: opening.openingName,
  };
}

export function importPgnArchive(database: SqliteDatabase, userId: number, input: string):
  { total: number; imported: number; duplicates: number } {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new PgnImportError('invalid_input');
  const chunks = splitPgnArchive(input);
  if (chunks.length > MAX_PGN_ARCHIVE_GAMES) throw new PgnImportError('pgn_too_many_games');
  const parsed = chunks.map((pgn, i) => parsedGame(pgn, i + 1));
  const insert = database.prepare(`
    INSERT INTO games (user_id,source,external_id,pgn,white,black,result,time_control,
      end_time,user_color,rated,eco,opening_name)
    VALUES (?, 'imported', ?, ?, ?, ?, NULL, ?, NULL, NULL, 0, ?, ?)
    ON CONFLICT(user_id,source,external_id) DO NOTHING
  `);
  return database.transaction(() => {
    let imported = 0;
    for (const game of parsed) {
      imported += insert.run(userId, game.externalId, game.pgn, game.white, game.black,
        game.timeControl, game.eco, game.openingName).changes;
    }
    return {total: parsed.length, imported, duplicates: parsed.length - imported};
  })();
}
