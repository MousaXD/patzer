import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import type { AnalyzedMove } from '../../types';
import { parseReviewGamePositions } from './reviewGamePositions';
import { practiceCandidates } from './practiceCandidates';

function fixture(fen?: string) {
  const game = new Chess(fen);
  if (fen) game.setHeader('SetUp', '1');
  if (fen) game.setHeader('FEN', fen);
  game.move(fen ? 'Kh2' : 'e4');
  if (!fen) game.move('e5');
  return parseReviewGamePositions(game.pgn())!;
}

describe('safe practice selection from a complete original PGN', () => {
  it('does not leak SAN, evaluated score or preferred move, and skips stale/missing plies', () => {
    const replay = fixture();
    const first = { ply: 1, uci: replay[1]?.uci, fen_before: replay[0]?.fen,
      fen_after: replay[1]?.fen, classification: 'mistake', best_move_san: 'd4',
      eval_after_cp: -200 } as AnalyzedMove;
    const second = { ...first, ply: 2, classification: 'blunder' as const, uci: 'g7g6' };
    expect(practiceCandidates(replay, [first, second])).toEqual([{ ply: 1, side: 'white', moveNumber: 1 }]);
    expect(JSON.stringify(practiceCandidates(replay, [first]))).not.toContain('d4');
    expect(practiceCandidates(replay, [{ ...first, fen_before: 'old' }])).toEqual([]);
    expect(practiceCandidates(replay, [{ ...first, classification: 'book' }])).toEqual([]);
    expect(practiceCandidates(replay, undefined)).toEqual([]);
  });
  it('uses absolute move numbers and actual mover for Black-first imported games', () => {
    const replay = fixture('8/8/8/8/8/8/8/K6k b - - 0 12');
    expect(practiceCandidates(replay, [{
      ply: 1, classification: 'miss', uci: replay[1]?.uci,
      fen_before: replay[0]?.fen, fen_after: replay[1]?.fen,
    } as AnalyzedMove])).toEqual([{ ply: 1, side: 'black', moveNumber: 12 }]);
  });
});
