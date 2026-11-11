import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Chess } from 'chess.js';
import {
  analysisSourceHash, analysisMatchesGame, loadAnalysisGameSource,
  persistAnalysisIfFresh, analysisMovesMatchPgn,
} from '../src/chess/analysisSource.js';
import type { AnalysisResult, AnalyzedMove } from '../src/types.js';

const fools = '1. f3 e5 2. g4 Qh4# 0-1';
const scholars = '1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0';
const equalA = '1. e4 e5 2. Nf3 Nc6 *';
const equalB = '1. d4 d5 2. c4 e6 *';
const blackFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
const blackFirst = `[SetUp "1"]\n[FEN "${blackFen}"]\n\n1... e5`;

function makeMoves(pgn: string): AnalyzedMove[] {
  const chess = new Chess();
  chess.loadPgn(pgn, { strict: false });
  const initial = chess.getHeaders().FEN;
  const replay = new Chess(initial);
  return chess.history({ verbose: true }).map((h, i) => {
    const before = replay.fen();
    replay.move(h.san);
    return {
      ply: i + 1, san: h.san, uci: h.from + h.to + (h.promotion ?? ''),
      fen_before: before, fen_after: replay.fen(), eval_before_cp: 0,
      eval_after_cp: 0, mate_before: null, mate_after: null,
      best_move_uci: null, best_move_san: null, best_pv: [],
      centipawn_loss: 0, classification: 'good',
    };
  }) as AnalyzedMove[];
}

function analysis(pgn: string): AnalysisResult {
  return {
    depth: 10, moves: makeMoves(pgn), accuracy_white: 80, accuracy_black: 80,
    estimated_elo_white: null, estimated_elo_black: null,
    performance_white: null, performance_black: null,
    opening_eco: null, opening_name: null,
    key_moments: [], phase_split: null,
  };
}

function fixture(pgn: string) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE games (id INTEGER PRIMARY KEY, pgn TEXT NOT NULL,
      start_fen TEXT, user_color TEXT, result TEXT, opponent_rating_before REAL,
      user_rd_before REAL, source_revision INTEGER NOT NULL DEFAULT 0,
      eco TEXT, opening_name TEXT, bookmarked INTEGER, notes TEXT);
    CREATE TABLE analyses (game_id INTEGER PRIMARY KEY, depth INTEGER,
      accuracy_white REAL, accuracy_black REAL, estimated_elo_white REAL,
      estimated_elo_black REAL, performance_white REAL, performance_black REAL,
      opening_eco TEXT, opening_name TEXT, key_moments_json TEXT,
      phase_split_json TEXT, moves_json TEXT, scoring_version INTEGER,
      source_hash TEXT, source_revision INTEGER,
      analysis_generation INTEGER NOT NULL DEFAULT 0, prose_json TEXT,
      prose_version INTEGER DEFAULT 0, prose_lang TEXT, prose_audience TEXT,
      created_at TEXT);
    CREATE TRIGGER trg_games_source_revision AFTER UPDATE OF
      pgn, start_fen, user_color, result, opponent_rating_before, user_rd_before ON games
    WHEN OLD.pgn IS NOT NEW.pgn OR OLD.start_fen IS NOT NEW.start_fen
      OR OLD.user_color IS NOT NEW.user_color OR OLD.result IS NOT NEW.result
      OR OLD.opponent_rating_before IS NOT NEW.opponent_rating_before
      OR OLD.user_rd_before IS NOT NEW.user_rd_before
    BEGIN UPDATE games SET source_revision = source_revision + 1 WHERE id = NEW.id; END;
  `);
  db.prepare('INSERT INTO games (id, pgn, user_color, result) VALUES (1, ?, ?, ?)')
    .run(pgn, 'white', null);
  const source = () => loadAnalysisGameSource(db, 1)!;
  const get = () => db.prepare('SELECT * FROM analyses WHERE game_id = 1').get() as
    { source_hash: string | null; source_revision: number | null; moves_json: string } | undefined;
  const save = (p: string, snap = source()) => persistAnalysisIfFresh(db, 1, analysis(p), snap, 9);
  return { db, source, get, save };
}

describe('Analysis source provenance and atomic persistence', () => {
  it('caches an unchanged game, including harmless notes and bookmark edits', () => {
    const f = fixture(fools);
    expect(f.save(fools)).toBe(true);
    expect(analysisMatchesGame(f.source(), f.get()!)).toBe(true);
    f.db.prepare('UPDATE games SET notes = ?, bookmarked = 1 WHERE id = 1').run('practice this');
    expect(f.source().source_revision).toBe(0);
    expect(analysisMatchesGame(f.source(), f.get()!)).toBe(true);
    f.db.close();
  });

  it('increments generation and clears prose even for an identical forced reanalysis', () => {
    const f = fixture(fools);
    expect(f.save(fools)).toBe(true);
    const first = f.db.prepare('SELECT analysis_generation FROM analyses WHERE game_id = 1')
      .get() as { analysis_generation: number };
    expect(first.analysis_generation).toBe(1);
    f.db.prepare("UPDATE analyses SET prose_json = '{\"summary\":\"old\"}' WHERE game_id = 1").run();
    expect(f.save(fools)).toBe(true);
    const next = f.db.prepare('SELECT analysis_generation, prose_json FROM analyses WHERE game_id = 1')
      .get() as { analysis_generation: number; prose_json: string | null };
    expect(next).toEqual({ analysis_generation: 2, prose_json: null });
    f.db.close();
  });

  it('rejects different PGN for the same game and the same ply count', () => {
    const f = fixture(equalA);
    expect(f.save(equalA)).toBe(true);
    f.db.prepare('UPDATE games SET pgn = ? WHERE id = 1').run(equalB);
    expect(analysisMatchesGame(f.source(), f.get()!)).toBe(false);
    expect(f.save(equalB)).toBe(true);
    expect(analysisMatchesGame(f.source(), f.get()!)).toBe(true);
    f.db.close();
  });

  it('prevents Fool\'s Mate analysis being labeled Scholar\'s Mate', () => {
    const f = fixture(fools);
    expect(f.save(fools)).toBe(true);
    f.db.prepare('UPDATE games SET pgn = ? WHERE id = 1').run(scholars);
    expect(analysisMatchesGame(f.source(), f.get()!)).toBe(false);
    f.db.close();
  });

  it('refuses obsolete work after a PGN change while the engine was running', () => {
    const f = fixture(fools);
    const captured = f.source();
    f.db.prepare('UPDATE games SET pgn = ? WHERE id = 1').run(scholars);
    expect(f.save(fools, captured)).toBe(false);
    expect(f.get()).toBeUndefined();
    f.db.close();
  });

  it('prevents ABA even when original content is restored', () => {
    const f = fixture(fools);
    const captured = f.source();
    f.db.prepare('UPDATE games SET pgn = ? WHERE id = 1').run(scholars);
    f.db.prepare('UPDATE games SET pgn = ? WHERE id = 1').run(fools);
    expect(f.source().source_revision).toBe(2);
    expect(analysisSourceHash(f.source())).toBe(analysisSourceHash(captured));
    expect(f.save(fools, captured)).toBe(false);
    expect(f.save(fools)).toBe(true);
    f.db.close();
  });

  it('fails closed on legacy rows with no provenance', () => {
    const f = fixture(fools);
    expect(f.save(fools)).toBe(true);
    f.db.prepare('UPDATE analyses SET source_hash = NULL, source_revision = NULL').run();
    expect(analysisMatchesGame(f.source(), f.get()!)).toBe(false);
    f.db.close();
  });

  it('validates Black-first FEN with legal move identity', () => {
    const f = fixture(blackFirst);
    f.db.prepare('UPDATE games SET start_fen = ? WHERE id = 1').run(blackFen);
    expect(analysisMovesMatchPgn(blackFirst, makeMoves(blackFirst))).toBe(true);
    expect(f.save(blackFirst)).toBe(true);
    expect(analysisMatchesGame(f.source(), f.get()!)).toBe(true);
    f.db.close();
  });

  it('rejects forged engine moves even with a correct current source hash', () => {
    const f = fixture(equalA);
    expect(f.save(equalA)).toBe(true);
    f.db.prepare('UPDATE analyses SET moves_json = ?').run(JSON.stringify(makeMoves(equalB)));
    expect(analysisMatchesGame(f.source(), f.get()!)).toBe(false);
    f.db.close();
  });

  it('does not admit cancelled analysis with mismatched source snapshot', () => {
    const f = fixture(fools);
    const capture = f.source();
    f.db.prepare('UPDATE games SET result = ? WHERE id = 1').run('loss');
    expect(f.save(fools, capture)).toBe(false);
    f.db.close();
  });
});
