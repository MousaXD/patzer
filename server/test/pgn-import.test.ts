import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { importPgnArchive, MAX_PGN_ARCHIVE_BYTES, PgnImportError, splitPgnArchive } from '../src/chess/pgnImport.js';

const one = '[Event "One"]\n[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 1-0';
const two = '[Event "Two"]\n[White "Chris"]\n[Black "Daria"]\n[Result "0-1"]\n\n1. d4 d5 0-1';
const invalid = '[Event "Corrupted"]\n[White "A"]\n[Black "B"]\n\n1. e4 e9 *';
const dbs: Database.Database[] = [];
function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE games (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, source TEXT NOT NULL,
    external_id TEXT NOT NULL, pgn TEXT NOT NULL, white TEXT, black TEXT,
    result TEXT, time_control TEXT, end_time TEXT, user_color TEXT, rated INTEGER,
    eco TEXT, opening_name TEXT, bookmarked INTEGER DEFAULT 0, notes TEXT,
    source_revision INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, source, external_id)
  )`);
  dbs.push(db);
  return db;
}
afterEach(() => { while (dbs.length) dbs.pop()!.close(); });

describe('explicit local PGN archive import', () => {
  it('saves every game without inventing ownership, results or missing dates; retry deduplicates', () => {
    const db = fixture();
    expect(importPgnArchive(db, 1, `${one}\n\n${two}`)).toEqual({total:2,imported:2,duplicates:0});
    const saved = db.prepare(`SELECT user_id,source,external_id,pgn,white,black,result,end_time,user_color,
      eco,opening_name,rated FROM games ORDER BY id`).all() as Record<string,unknown>[];
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({user_id:1,source:'imported',pgn:one,white:'Alice',black:'Bob',
      result:null,end_time:null,user_color:null,eco:'C20',opening_name:"King's Pawn Game",rated:0});
    expect(saved[1]).toMatchObject({user_id:1,source:'imported',pgn:two,white:'Chris',black:'Daria',
      result:null,end_time:null,user_color:null,eco:'D00',opening_name:"Queen's Pawn Game",rated:0});
    expect(String(saved[0].external_id)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(importPgnArchive(db, 1, `${one}\n\n${two}`)).toEqual({total:2,imported:0,duplicates:2});
    expect(importPgnArchive(db, 2, `${one}\n\n${two}`)).toEqual({total:2,imported:2,duplicates:0});
    expect(db.prepare('SELECT COUNT(*) AS n FROM games').get()).toEqual({n:4});
  });

  it('supports one headerless PGN and refuses disguised concatenated games', () => {
    const db = fixture();
    expect(importPgnArchive(db, 1, '1. e4 e5 *')).toEqual({total:1,imported:1,duplicates:0});
    expect(() => importPgnArchive(db, 1, `${one}\n\n${invalid}`))
      .toThrowError(new PgnImportError('invalid_pgn',2));
    expect(() => importPgnArchive(db, 1,
      '[White "One"]\n\n1. e4 e5 *\n\n[White "Two"]\n\n1. d4 d5 *'))
      .toThrow(PgnImportError);
    expect(db.prepare('SELECT COUNT(*) AS n FROM games').get()).toEqual({n:1});
  });

  it('never treats an Event tag quoted inside a multiline move comment as a new game', () => {
    const db = fixture();
    const annotated = `[Event "Commented"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 {This is only a study note:\n[Event "Not a separate game"]\nThe variation still belongs to Alice.} e5 1-0`;
    expect(splitPgnArchive(annotated)).toEqual([annotated]);
    expect(splitPgnArchive(`${annotated}\n\n${two}`)).toEqual([annotated,two]);
    expect(importPgnArchive(db,1,`${annotated}\n\n${two}`))
      .toEqual({total:2,imported:2,duplicates:0});
    expect(db.prepare('SELECT pgn FROM games WHERE user_id = 1 ORDER BY id').all())
      .toEqual([{pgn:annotated},{pgn:two}]);
  });

  it('does not mistake literal comment delimiters in PGN header values for actual comments', () => {
    const db=fixture();
    const unusualHeader = '[Event "Study { Session; notes"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 *';
    const crlf = unusualHeader.replace(/\n/g,'\r\n');
    expect(splitPgnArchive(`${crlf}\r\n\r\n${two}`)).toEqual([crlf,two]);
    expect(importPgnArchive(db,1,`${crlf}\r\n\r\n${two}`))
      .toEqual({total:2,imported:2,duplicates:0});
    expect(db.prepare('SELECT pgn FROM games WHERE user_id=1 ORDER BY id').all())
      .toEqual([{pgn:crlf},{pgn:two}]);
  });

  it('rejects mixed valid/corrupt files atomically with the failing game index', () => {
    const db = fixture();
    try { importPgnArchive(db, 1, `${one}\n\n${invalid}`); }
    catch (e) { expect(e).toMatchObject({code:'invalid_pgn',gameIndex:2}); }
    expect(db.prepare('SELECT COUNT(*) AS n FROM games').get()).toEqual({n:0});
  });

  it('does not save custom-start or unsupported chess variants as standard games', () => {
    const db = fixture();
    const fromPosition = `[Event "Position"]\n[SetUp "1"]\n[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]\n\n1. e4 e5 *`;
    const variant = '[Event "Variant"]\n[Variant "Chess960"]\n\n1. e4 e5 *';
    for (const pg of [fromPosition, variant]) {
      expect(() => importPgnArchive(db, 1, pg)).toThrowError(new PgnImportError('unsupported_pgn_position',1));
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM games').get()).toEqual({n:0});
  });

  it('rejects ambiguous archives, oversized input and excessive game counts rather than truncating', () => {
    expect(() => splitPgnArchive('prefix\n' + one)).toThrowError(new PgnImportError('ambiguous_pgn_archive'));
    expect(() => splitPgnArchive('é'.repeat(MAX_PGN_ARCHIVE_BYTES / 2 + 1)))
      .toThrowError(new PgnImportError('pgn_too_large'));
    expect(() => splitPgnArchive(`${one}\n\n`.repeat(1001)))
      .toThrowError(new PgnImportError('pgn_too_many_games'));
  });

  it('rolls back earlier inserts if a later SQLite statement fails', () => {
    const db = fixture();
    db.exec(`CREATE TRIGGER synthetic_pgn_failure BEFORE INSERT ON games
      WHEN NEW.white = 'Chris' BEGIN SELECT RAISE(ABORT, 'synthetic_failure'); END`);
    expect(() => importPgnArchive(db, 1, `${one}\n\n${two}`)).toThrow(/synthetic_failure/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM games').get()).toEqual({n:0});
  });
});
