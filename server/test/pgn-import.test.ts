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

  it('supports one headerless PGN and separates explicitly tagged games without Event', () => {
    const db = fixture();
    expect(importPgnArchive(db, 1, '1. e4 e5 *')).toEqual({total:1,imported:1,duplicates:0});
    expect(() => importPgnArchive(db, 1, `${one}\n\n${invalid}`))
      .toThrowError(new PgnImportError('invalid_pgn',2));
    const first='[White "One"]\n\n1. e4 e5 *';
    const second='[White "Two"]\n\n1. d4 d5 *';
    expect(importPgnArchive(db, 1, `${first}\n\n${second}`))
      .toEqual({total:2,imported:2,duplicates:0});
    expect(db.prepare('SELECT pgn FROM games WHERE user_id=1 ORDER BY id').all())
      .toEqual([{pgn:'1. e4 e5 *'},{pgn:first},{pgn:second}]);
    // No header boundary means a concatenated archive is still ambiguous;
    // do not save the first game and silently discard the second.
    expect(() => importPgnArchive(db, 1,'1. e4 e5 *\n\n1. d4 d5 *')).toThrow(PgnImportError);
    expect(db.prepare('SELECT COUNT(*) AS n FROM games').get()).toEqual({n:3});
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

  it('accepts standard PGNs whose valid headers precede Event, without losing a game or altering the PGN', () => {
    const db = fixture();
    const siteFirst = '[Site "Online Chess"]\n[Event "Rated Rapid"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 1-0';
    const customFirst = '[StudyId "session-42"]\n[Event "Study Game"]\n[White "Chris"]\n[Black "Daria"]\n\n1. d4 d5 0-1';
    expect(splitPgnArchive(siteFirst)).toEqual([siteFirst]);
    expect(splitPgnArchive(`${siteFirst}\n\n${two}\n\n${customFirst}`))
      .toEqual([siteFirst, two, customFirst]);
    expect(importPgnArchive(db, 1, `${siteFirst}\n\n${two}\n\n${customFirst}`))
      .toEqual({total:3,imported:3,duplicates:0});
    expect(db.prepare('SELECT pgn FROM games WHERE user_id=1 ORDER BY id').all())
      .toEqual([{pgn:siteFirst},{pgn:two},{pgn:customFirst}]);
    expect(importPgnArchive(db, 1, `${siteFirst}\n\n${two}\n\n${customFirst}`))
      .toEqual({total:3,imported:0,duplicates:3});
  });

  it('keeps recognizable bounded player metadata for long Unicode names and preserves the original PGN', () => {
    const db=fixture();
    const longName='José-'+'棋'.repeat(145)+'-LastPart';
    const pg=`[Event "Lengthy names"]\n[White "${longName}"]\n[Black "Bob"]\n\n1. e4 e5 *`;
    expect(importPgnArchive(db,1,pg)).toEqual({total:1,imported:1,duplicates:0});
    const stored=db.prepare('SELECT white,black,pgn FROM games WHERE user_id=1').get() as {white:string|null;black:string|null;pgn:string};
    expect(stored.white).toBe(Array.from(longName).slice(0,119).join('')+'…');
    expect(stored.black).toBe('Bob');
    expect(stored.pgn).toBe(pg);
    expect(importPgnArchive(db,1,pg)).toEqual({total:1,imported:0,duplicates:1});
  });

  it('ignores tag-like lines inside comments, but recognizes the next real reordered header block', () => {
    const annotated='[Event "Annotated"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 {These are just notes:\n[Site "Not a new game"]\n[Event "Also not a game"]\nStill one game.} e5 1-0';
    const siteFirst = '[Site "Real new game"]\n[Event "Round Two"]\n[White "Chris"]\n[Black "Daria"]\n\n1. d4 d5 0-1';
    expect(splitPgnArchive(`${annotated}\n\n${siteFirst}`)).toEqual([annotated,siteFirst]);
    expect(() => splitPgnArchive('Unexpected preamble\n'+siteFirst))
      .toThrowError(new PgnImportError('ambiguous_pgn_archive'));
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

  it('accepts explicit standard SetUp 0 and setup-like lines in comments, but rejects real custom setups', () => {
    const db=fixture();
    const standard='[Event "Ordinary game"]\n[SetUp "0"]\n[Variant "Standard"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 *';
    const annotated='[Event "Annotated"]\n[White "Chris"]\n[Black "Dana"]\n\n1. d4 {These are examples, not headers:\n[SetUp "1"]\n[FEN "8/8/8/8/8/8/8/8 w - - 0 1"]\nContinue the normal game.} d5 *';
    expect(importPgnArchive(db,1,`${standard}\n\n${annotated}`))
      .toEqual({total:2,imported:2,duplicates:0});
    expect(db.prepare('SELECT pgn FROM games ORDER BY id').all())
      .toEqual([{pgn:standard},{pgn:annotated}]);

    const custom='[Event "Custom"]\n[SetUp "1"]\n[White "A"]\n[Black "B"]\n\n1. e4 e5 *';
    const declaredFen='[Event "FEN present"]\n[SetUp "0"]\n[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]\n\n1. e4 e5 *';
    const malformedSetup='[Event "Invalid setup"]\n[SetUp "perhaps"]\n\n1. e4 e5 *';
    for (const pgn of [custom,declaredFen,malformedSetup]) {
      expect(() => importPgnArchive(db,1,pgn))
        .toThrowError(new PgnImportError('unsupported_pgn_position',1));
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM games').get()).toEqual({n:2});
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
