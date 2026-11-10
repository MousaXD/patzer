import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { importChessComHistory, retryChessCom } from '../src/chess/chesscomHistory.js';
import type { ChessComGame } from '../src/chess/chesscom.js';

const archives = [
  'https://api.chess.com/pub/player/testuser/games/2026/01',
  'https://api.chess.com/pub/player/testuser/games/2026/02',
];
function sample(number: number, overrides: Partial<ChessComGame> = {}): ChessComGame {
  return {
    url: `https://www.chess.com/game/live/${number}`,
    pgn: `[Event "Live Chess"]\n[ECO "C20"]\n[White "testuser"]\n[Black "opponent"]\n[Result "1-0"]\n\n1. e4 e5 1-0`,
    time_control: '600', end_time: 1760000000 + number,
    rated: true, time_class: 'rapid', rules: 'chess',
    white: { username: 'testuser', rating: 1000, result: 'win' },
    black: { username: 'opponent', rating: 1000, result: 'checkmated' },
    ...overrides,
  };
}
const dbs: Database.Database[] = [];
function testDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE games (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
    source TEXT NOT NULL, external_id TEXT,
    pgn TEXT NOT NULL, white TEXT, black TEXT, result TEXT,
    time_control TEXT, time_class TEXT, end_time TEXT, user_color TEXT,
    rated INTEGER, eco TEXT, opening_name TEXT,
    UNIQUE(user_id,source,external_id)
  )`);
  dbs.push(db);
  return db;
}
afterEach(() => { while (dbs.length) dbs.pop()!.close(); });

describe('one-time Chess.com history', () => {
  it('walks all monthly archives, inserts deduplicated standard games and never modifies existing PGNs', async () => {
    const db = testDb();
    const months = new Map([
      [archives[0], [sample(1), sample(2, { rules: 'chess960' }), sample(3, { white: { username: 'other', rating: 1000, result: 'win' } })]],
      [archives[1], [sample(1), sample(4, { white: { username: 'OPPONENT', rating: 1000, result: 'agreed' }, black: { username: 'TESTUSER', rating: 1000, result: 'agreed' } })]],
    ]);
    const seen: string[] = [];
    const request = () => importChessComHistory(db, 7, 'testuser', {
      archives: async () => archives,
      month: async (url) => months.get(url)!,
      delay: async () => {},
      onMonth: ({ archive }) => { seen.push(archive); },
    });
    const first = await request();
    expect(first).toMatchObject({ archives: 2, completed: 2, imported: 2, duplicates: 1, skippedNonStandardOrInvalid: 2 });
    expect(seen).toEqual(archives);
    const saved = db.prepare('SELECT external_id, pgn, user_color, result, eco, rated FROM games ORDER BY external_id').all() as {
      external_id: string; pgn: string; user_color: string; result: string; eco: string; rated: number;
    }[];
    expect(saved.map((r) => r.external_id)).toEqual([sample(1).url, sample(4).url]);
    expect(saved[0]?.pgn).toEqual(sample(1).pgn);
    expect(saved[0]?.eco).toEqual('C20');
    expect(saved[1]?.user_color).toEqual('black');
    expect(saved[1]?.result).toEqual('draw');
    expect(saved.map((g) => g.rated)).toEqual([0, 0]);
    const again = await request();
    expect(again).toMatchObject({ imported: 0, duplicates: 3 });
    expect(db.prepare('SELECT count(*) AS n FROM games').get()).toEqual({ n: 2 });
  });

  it('resumes safely from completed months without replaying older archives', async () => {
    const db = testDb();
    const called: string[] = [];
    const result = await importChessComHistory(db, 1, 'testuser', {
      archives: async () => archives,
      month: async (url) => { called.push(url); return [sample(123)]; },
      alreadyCompleted: new Set([archives[0]]),
      delay: async () => {},
    });
    expect(called).toEqual([archives[1]]);
    expect(result).toMatchObject({ archives: 2, completed: 1, imported: 1 });
  });

  it('does not continue after a failed month and retries transient Chess.com failures', async () => {
    const db = testDb();
    let attempts = 0;
    await expect(importChessComHistory(db, 1, 'testuser', {
      archives: async () => archives,
      month: async () => { attempts++; throw new Error('chesscom_503'); },
      delay: async () => {},
    })).rejects.toThrow('chesscom_503');
    expect(attempts).toBe(5);
    expect(db.prepare('SELECT count(*) AS n FROM games').get()).toEqual({ n: 0 });
  });

  it('validates archive host and refuses malicious URL data', async () => {
    const db = testDb();
    await expect(importChessComHistory(db, 1, 'testuser', {
      archives: async () => ['https://example.com/pub/player/testuser/games/2026/02'],
    })).rejects.toThrow('invalid_archive_url');
  });

  it('backs off on a transient rate limit but propagates permanent errors', async () => {
    let n = 0;
    const delays: number[] = [];
    const result = await retryChessCom(async () => {
      if (++n < 3) throw new Error('chesscom_429');
      return 42;
    }, async (ms) => { delays.push(ms); });
    expect(result).toBe(42);
    expect(delays).toEqual([1000, 2000]);
    await expect(retryChessCom(async () => { throw new Error('invalid_username'); }, async () => {})).rejects.toThrow('invalid_username');
  });
  it('rejects cross-account, query-bearing and invalid-month archives before fetching', async () => {
    const db = testDb();
    for (const url of [
      'https://api.chess.com/pub/player/otheruser/games/2026/02',
      archives[0] + '?redirect=https://example.com',
      'https://api.chess.com/pub/player/testuser/games/2026/13',
      'https://api.chess.com.evil.example/pub/player/testuser/games/2026/02',
      'this is not a URL',
    ]) {
      let monthCalls = 0;
      await expect(importChessComHistory(db, 1, 'testuser', {
        archives: async () => [url],
        month: async () => { monthCalls++; return [sample(1)]; },
        delay: async () => {},
      })).rejects.toThrow('invalid_archive_url');
      expect(monthCalls).toBe(0);
    }
  });

  it('deduplicates repeated archive entries and skips a malformed game without dropping the month', async () => {
    const db = testDb();
    let monthCalls = 0;
    const result = await importChessComHistory(db, 1, 'testuser', {
      archives: async () => [archives[0], archives[0]],
      month: async () => { monthCalls++; return [sample(1), sample(2, { end_time: Number.MAX_VALUE })]; },
      delay: async () => {},
    });
    expect(monthCalls).toBe(1);
    expect(result).toMatchObject({ archives: 1, completed: 1, gamesFetched: 2, imported: 1, skippedNonStandardOrInvalid: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM games').get()).toEqual({ n: 1 });
  });

  it('never stores URL identifiers from lookalike Chess.com hosts', async () => {
    const db = testDb();
    const result = await importChessComHistory(db, 1, 'testuser', {
      archives: async () => [archives[0]],
      month: async () => [
        sample(1, { url: 'https://www.chess.com.evil.example/game/live/1' }),
        sample(2, { url: 'http://www.chess.com/game/live/2' }),
        sample(3),
      ],
      delay: async () => {},
    });
    expect(result).toMatchObject({ imported: 1, skippedNonStandardOrInvalid: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM games').get()).toEqual({ n: 1 });
  });

  it('skips unknown Chess.com results instead of counting them as losses', async () => {
    const db = testDb();
    const result = await importChessComHistory(db, 1, 'testuser', {
      archives: async () => [archives[0]],
      month: async () => [
        sample(1, { white: { username: 'testuser', rating: 1000, result: 'future_result_code' } }),
        sample(2),
      ],
      delay: async () => {},
    });
    expect(result).toMatchObject({ imported: 1, skippedNonStandardOrInvalid: 1 });
    const saved = db.prepare('SELECT result FROM games').all() as { result: string }[];
    expect(saved).toEqual([{ result: 'win' }]);
  });

  it('retries network timeouts and transient HTTP 408 without swallowing permanent errors', async () => {
    const delays: number[] = [];
    let attempts = 0;
    const value = await retryChessCom(async () => {
      attempts++;
      if (attempts === 1) throw new Error('chesscom_408');
      if (attempts === 2) {
        const error = new Error('Request cancelled by timeout');
        error.name = 'TimeoutError';
        throw error;
      }
      return 123;
    }, async (ms) => { delays.push(ms); });
    expect(value).toBe(123);
    expect(delays).toEqual([1000, 2000]);
  });

});
