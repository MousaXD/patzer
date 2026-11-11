import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { analysisMatchesPgn, reviewSourceDigest } from '../src/coach/reviewSource.js';
import type { ReviewCacheSource, ReviewCacheGame } from '../src/coach/reviewCache.js';

const fool = '1. f3 e5 2. g4 Qh4#';
const scholar = '1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#';

function evidence(pgn: string): string {
  const board = new Chess();
  board.loadPgn(pgn);
  const history = board.history({ verbose: true });
  const replay = new Chess();
  return JSON.stringify(history.map((m, i) => {
    const before = replay.fen();
    replay.move(m.san);
    return { ply: i + 1, san: m.san, uci: `${m.from}${m.to}${m.promotion ?? ''}`,
      fen_before: before, fen_after: replay.fen() };
  }));
}

const original: ReviewCacheSource = {
  depth: 8, scoring_version: 9, moves_json: evidence(fool),
  key_moments_json: null, phase_split_json: null, accuracy_white: 31.8,
  accuracy_black: 100, estimated_elo_white: null, estimated_elo_black: null,
  performance_white: null, performance_black: null, opening_eco: null,
  opening_name: null, prose_json: null, prose_version: 0,
  prose_lang: null, prose_audience: null,
};
const game: ReviewCacheGame = { pgn: fool, user_color: 'white', user_id: 1 };

describe('AI report source evidence', () => {
  it('accepts precisely matching legal move/FEN evidence', () => {
    expect(analysisMatchesPgn(fool, evidence(fool))).toBe(true);
    expect(analysisMatchesPgn(scholar, evidence(scholar))).toBe(true);
  });
  it('rejects Fool analysis attached to Scholar PGN before generation', () => {
    expect(analysisMatchesPgn(scholar, evidence(fool))).toBe(false);
  });
  it('rejects equal-length distinct PGNs and corrupted FENs', () => {
    expect(analysisMatchesPgn('1. e4 e5 2. Nf3 Nc6', evidence('1. d4 d5 2. c4 e6'))).toBe(false);
    const broken = JSON.parse(evidence(fool));
    broken[1].fen_after = broken[0].fen_after;
    expect(analysisMatchesPgn(fool, JSON.stringify(broken))).toBe(false);
  });
  it('rejects malformed and legacy incomplete analysis evidence', () => {
    expect(analysisMatchesPgn(fool, '{')).toBe(false);
    expect(analysisMatchesPgn(fool, '[{"san":"f3"}]')).toBe(false);
  });
  it('changes identity for exact PGN, evidence, ownership, perspective and scoring', () => {
    const digest = reviewSourceDigest(game, original);
    expect(reviewSourceDigest({ ...game, pgn: scholar }, original)).not.toBe(digest);
    expect(reviewSourceDigest({ ...game, user_id: 2 }, original)).not.toBe(digest);
    expect(reviewSourceDigest({ ...game, user_color: 'black' }, original)).not.toBe(digest);
    expect(reviewSourceDigest(game, { ...original, scoring_version: 10 })).not.toBe(digest);
    expect(reviewSourceDigest(game, { ...original, moves_json: evidence(scholar) })).not.toBe(digest);
    expect(reviewSourceDigest(game, { ...original, accuracy_white: 31.9 })).not.toBe(digest);
    expect(reviewSourceDigest(game, { ...original, prose_json: '{"other":"review"}' })).toBe(digest);
  });
  it('does not bind unrelated bookmark/notes metadata', () => {
    expect(reviewSourceDigest({ ...game }, original)).toBe(reviewSourceDigest(game, original));
  });
});
