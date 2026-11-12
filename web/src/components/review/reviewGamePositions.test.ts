import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { parseReviewGamePositions } from './reviewGamePositions';

describe('saved Game Review PGN replay', () => {
  it('retains the initial position and exact legal positions for a normal game', () => {
    const c = new Chess();
    c.move('e4');
    c.move('e5');
    const positions = parseReviewGamePositions(c.pgn());
    expect(positions).toHaveLength(3);
    expect(positions?.[0]?.fen).toBe(new Chess().fen());
    expect(positions?.[1]?.uci).toBe('e2e4');
    expect(positions?.[2]?.uci).toBe('e7e5');
    expect(positions?.[2]?.fen).toBe(c.fen());
  });

  it('keeps the starting side and fullmove number from a setup FEN', () => {
    const fen = '8/8/8/8/8/8/8/K6k b - - 0 12';
    const c = new Chess(fen);
    c.move('Kh2');
    c.move('Kb2');
    const positions = parseReviewGamePositions(c.pgn());
    expect(positions).toHaveLength(3);
    expect(positions?.[0]?.fen).toBe(fen);
    expect(positions?.[1]?.san).toBe('Kh2');
    expect(positions?.[2]?.fen).toBe(c.fen());
  });

  it('rejects broken PGN instead of throwing and blanking the review', () => {
    expect(parseReviewGamePositions('1. e4 impossible-move')).toBeNull();
  });

  it('distinguishes a legal PGN without moves from corrupt notation', () => {
    const positions = parseReviewGamePositions('*');
    expect(positions).toEqual([{ fen: new Chess().fen() }]);
  });
});
