import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { saveReviewIfFresh, type ReviewCacheGame, type ReviewCacheSource } from '../src/coach/reviewCache.js';
import { REVIEW_PROSE_VERSION } from '../src/coach/review.js';

// Disposable, purely in-memory SQLite. This tests the *same conditional SQL*
// the manual Game Review and auto-review worker call after awaiting the LLM.
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE games (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, pgn TEXT NOT NULL, user_color TEXT, result TEXT);
  CREATE TABLE profiles (user_id INTEGER PRIMARY KEY, language TEXT NOT NULL, audience TEXT NOT NULL);
  CREATE TABLE analyses (
    game_id INTEGER PRIMARY KEY, depth INTEGER NOT NULL, scoring_version INTEGER NOT NULL,
    created_at TEXT,
    moves_json TEXT NOT NULL, key_moments_json TEXT, phase_split_json TEXT,
    accuracy_white REAL, accuracy_black REAL,
    estimated_elo_white REAL, estimated_elo_black REAL,
    performance_white REAL, performance_black REAL,
    opening_eco TEXT, opening_name TEXT,
    prose_json TEXT, prose_version INTEGER NOT NULL DEFAULT 0, prose_lang TEXT, prose_audience TEXT
  );
`);

const game: ReviewCacheGame = { pgn: '[Result "1-0"] 1.e4', user_color: 'white', user_id: 1, result: 'win' };
const original: ReviewCacheSource = {
  created_at: '2026-11-11 00:00:00',
  scoring_version: 10, depth: 16, moves_json: '[{"san":"e4"}]',
  key_moments_json: null, phase_split_json: null,
  accuracy_white: 85, accuracy_black: 62,
  estimated_elo_white: null, estimated_elo_black: 1000,
  performance_white: null, performance_black: null,
  opening_eco: 'C20', opening_name: 'King\'s Pawn', prose_json: null,
  prose_version: 0, prose_lang: null, prose_audience: null,
};
const proposedReview = { version: REVIEW_PROSE_VERSION, summary: 'Position checked.', language: 'en' };

beforeEach(() => {
  db.exec('DELETE FROM analyses; DELETE FROM games; DELETE FROM profiles;');
  db.prepare('INSERT INTO games (id, user_id, pgn, user_color, result) VALUES (1, ?, ?, ?, ?)')
    .run(game.user_id, game.pgn, game.user_color, game.result);
  db.prepare('INSERT INTO profiles (user_id, language, audience) VALUES (1, ?, ?)').run('en', 'beginner');
  db.prepare(`INSERT INTO analyses
    (game_id, created_at, scoring_version, depth, moves_json, key_moments_json, phase_split_json,
     accuracy_white, accuracy_black, estimated_elo_white, estimated_elo_black,
     performance_white, performance_black, opening_eco, opening_name, prose_json)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(original.created_at, original.scoring_version, original.depth, original.moves_json,
      original.key_moments_json, original.phase_split_json,
      original.accuracy_white, original.accuracy_black,
      original.estimated_elo_white, original.estimated_elo_black,
      original.performance_white, original.performance_black,
      original.opening_eco, original.opening_name, original.prose_json);
});
afterAll(() => db.close());

const save = (source: ReviewCacheSource = original, sourceGame: ReviewCacheGame = game) =>
  saveReviewIfFresh(db, 1, source, sourceGame, proposedReview, 'en', 'beginner');

const cache = () => db.prepare('SELECT prose_json, prose_version, prose_lang, prose_audience FROM analyses WHERE game_id = 1').get() as
  { prose_json: string | null; prose_version: number; prose_lang: string | null; prose_audience: string | null };

describe('written Game Review atomic compare-and-swap cache', () => {
  it('writes a review only when its recorded game and complete source analysis are unchanged', () => {
    expect(save()).toBe(true);
    expect(JSON.parse(cache().prose_json!)).toEqual(proposedReview);
    expect(cache()).toMatchObject({ prose_version: REVIEW_PROSE_VERSION, prose_lang: 'en', prose_audience: 'beginner' });
  });

  it.each([
    ['scoring_version', 11],
    ['created_at', '2026-11-11 00:00:01'],
    ['depth', 18],
    ['moves_json', '[{"san":"d4"}]'],
    ['key_moments_json', '[{"ply":1}]'],
    ['phase_split_json', '{"opening":1}'],
    ['accuracy_white', 90],
    ['accuracy_black', 45],
    ['estimated_elo_white', 1100],
    ['estimated_elo_black', null],
    ['performance_white', 1500],
    ['performance_black', 1200],
    ['opening_eco', 'D00'],
    ['opening_name', 'Queen\'s Pawn'],
  ] as const)('refuses a stale report if %s changed while it was generated', (column, newValue) => {
    // Column names are static test-controlled input, never user data.
    db.prepare(`UPDATE analyses SET ${column} = ? WHERE game_id = 1`).run(newValue);
    expect(save()).toBe(false);
    expect(cache().prose_json).toBeNull();
  });

  it('never overwrites a newer concurrent review, even if its analysis has not changed', () => {
    const newer = '{"summary":"another request finished"}';
    db.prepare('UPDATE analyses SET prose_json = ?, prose_version = ? WHERE game_id = 1').run(newer, REVIEW_PROSE_VERSION);
    expect(save()).toBe(false);
    expect(cache().prose_json).toBe(newer);
  });

  it.each([
    ['prose_version', 7],
    ['prose_lang', 'ru'],
    ['prose_audience', 'advanced'],
  ] as const)('does not overwrite a concurrent cache metadata change: %s', (field, newValue) => {
    // Even an empty/unchanged prose_json can acquire new provenance while
    // the model request is pending. That update must not be lost.
    db.prepare(`UPDATE analyses SET ${field} = ? WHERE game_id = 1`).run(newValue);
    expect(save()).toBe(false);
    expect(cache().prose_json).toBeNull();
  });

  it.each([
    ['pgn', '[Result "0-1"] 1.d4'],
    ['user_color', 'black'],
    ['user_id', 2],
    ['result', 'loss'],
  ] as const)('rejects a stale result when the game %s changes', (column, value) => {
    db.prepare(`UPDATE games SET ${column} = ? WHERE id = 1`).run(value);
    expect(save()).toBe(false);
    expect(cache().prose_json).toBeNull();
  });

  it('treats null source fields as real evidence, not unconditional wildcards', () => {
    const current = { ...original, accuracy_white: null, opening_name: null };
    db.prepare('UPDATE analyses SET accuracy_white = NULL, opening_name = NULL WHERE game_id = 1').run();
    expect(save(original)).toBe(false);
    expect(save(current)).toBe(true);
  });

  it('does not overwrite an obsolete language/audience while a report is generating', () => {
    db.prepare('UPDATE profiles SET language = ? WHERE user_id = 1').run('de');
    expect(save()).toBe(false);
    db.prepare('UPDATE profiles SET language = ?, audience = ? WHERE user_id = 1').run('en', 'advanced');
    expect(save()).toBe(false);
  });
});
