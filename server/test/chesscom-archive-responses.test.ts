import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { fetchRecentGames, getMonth, listArchives } from '../src/chess/chesscom.js';
import { importChessComHistory } from '../src/chess/chesscomHistory.js';

const root = 'https://api.chess.com/pub/player/testuser/games/';
const jan = `${root}2026/01`;
const feb = `${root}2026/02`;

function stubApi(answers: Record<string, unknown>) {
  const visited: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    visited.push(url);
    if (!(url in answers)) throw new Error(`unexpected_mock_request:${url}`);
    return new Response(JSON.stringify(answers[url]), {status: 200});
  }));
  return visited;
}
afterEach(() => vi.unstubAllGlobals());

describe('Chess.com archive response completeness', () => {
  it('refuses a partly invalid archive list instead of dropping a month silently', async () => {
    const bad = 'https://evil.example/pub/player/testuser/games/2026/02';
    stubApi({
      'https://api.chess.com/pub/player/testuser/games/archives': {archives: [jan,bad]},
    });
    await expect(listArchives('testuser')).rejects.toThrow(/invalid_archive_url|chesscom_invalid_response/);
  });

  it.each([
    {archives: [jan, `${root}2026/00`]},
    {archives: [jan, `${root}2026/13`]},
    {archives: [jan, `${root}2026/02?unexpected=true`]},
    {archives: [jan, 'https://api.chess.com/pub/player/otheruser/games/2026/02']},
    {archives: [jan, 'https://api.chess.com.evil.example/pub/player/testuser/games/2026/02']},
    {archives: [jan, null]},
    {archives: null},
    {somethingElse: [jan]},
  ])('rejects unusable archive-list payloads so history cannot be reported as complete', async (reply) => {
    stubApi({'https://api.chess.com/pub/player/testuser/games/archives': reply});
    await expect(listArchives('testuser')).rejects.toThrow(/invalid_archive_url|chesscom_invalid_response/);
  });

  it('does not turn a missing, null or malformed monthly games array into zero games', async () => {
    for (const body of [{somethingElse:[]}, {games:null}, {games:{}}, {games:[null]}]) {
      stubApi({[jan]: body});
      await expect(getMonth(jan)).rejects.toThrow(/chesscom_invalid_response/);
      vi.unstubAllGlobals();
    }
  });

  it('accepts a real empty month and deduplicates/sorts validated archive URLs', async () => {
    const visited = stubApi({
      'https://api.chess.com/pub/player/testuser/games/archives': {archives: [feb,jan,feb]},
      [jan]: {games: []},
      [feb]: {games: []},
    });
    await expect(listArchives('testuser')).resolves.toEqual([jan,feb]);
    await expect(getMonth(jan)).resolves.toEqual([]);
    await expect(fetchRecentGames('testuser',20)).resolves.toEqual([]);
    expect(visited.slice(-2)).toEqual([feb,jan]);
  });

  it('stops the full-history catch-up on a corrupt month without rolling back earlier completed months', async () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE games (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, source TEXT NOT NULL,
      external_id TEXT NOT NULL, pgn TEXT NOT NULL, white TEXT, black TEXT,
      result TEXT, time_control TEXT, time_class TEXT, end_time TEXT,
      user_color TEXT, rated INTEGER, eco TEXT, opening_name TEXT,
      UNIQUE(user_id, source, external_id)
    )`);
    const completed: string[] = [];
    stubApi({
      'https://api.chess.com/pub/player/testuser/games/archives': {archives: [jan,feb]},
      [jan]: {games: [{
        url: 'https://www.chess.com/game/live/381',
        pgn: '[White "testuser"]\n[Black "opponent"]\n[Result "1-0"]\n\n1. e4 e5 1-0',
        rules: 'chess', end_time: 1760000000, time_control: '600', time_class: 'rapid',
        white: {username: 'testuser', result: 'win'},
        black: {username: 'opponent', result: 'resigned'},
      }]},
      // No games property: a broken upstream response, not an empty archive.
      [feb]: {error: 'truncated_archive'},
    });
    try {
      await expect(importChessComHistory(db,1,'testuser',{
        delay: async () => {}, onMonth: p => { completed.push(p.archive); },
      })).rejects.toThrow('chesscom_invalid_response');
      expect(completed).toEqual([jan]);
      expect(db.prepare('SELECT external_id FROM games WHERE user_id = 1').all())
        .toEqual([{external_id:'https://www.chess.com/game/live/381'}]);
    } finally {db.close();}
  });
});
