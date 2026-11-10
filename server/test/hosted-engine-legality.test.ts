import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { ChessApiEngine, hasLegalEnPassant, parseChessApiResponse, strictFen } from '../src/chess/engine.js';

describe('hosted engine chess legality', () => {
  const start = new Chess().fen();

  it('rejects syntactically valid but illegal best moves', () => {
    expect(() => parseChessApiResponse({ move: 'e2e5', centipawns: 0 }, start)).toThrow('illegal best move');
    expect(() => parseChessApiResponse({ move: 'e7e5', centipawns: 0 }, start)).toThrow('illegal best move');
  });

  it('never returns illegal continuation moves', () => {
    const result = parseChessApiResponse({ move: 'e2e4', centipawns: 30, continuationArr: ['e7e5', 'e1e3', 'g8f6'] }, start);
    expect(result.pv).toEqual(['e2e4', 'e7e5']);
  });

  it('accepts legal promotions and rejects a promotion without its suffix', () => {
    const fen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
    expect(parseChessApiResponse({ move: 'a7a8n', mate: 2 }, fen).bestMoveUci).toBe('a7a8n');
    expect(() => parseChessApiResponse({ move: 'a7a8', centipawns: 20 }, fen)).toThrow('illegal best move');
  });

  it('normalizes Black-to-move scores without changing the legal first move', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const result = parseChessApiResponse({ move: 'e7e5', centipawns: -120, depth: 16 }, fen);
    expect(result.cp).toBe(120);
    expect(result.bestMoveUci).toBe('e7e5');
    expect(result.depth).toBe(16);
  });

  it('accepts a legal castle and rejects a castle through attacked squares', () => {
    expect(parseChessApiResponse({ move: 'e1g1', centipawns: 0 }, '4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1').pv).toEqual(['e1g1']);
    expect(() => parseChessApiResponse({ move: 'e1g1', centipawns: 0 }, '4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1')).toThrow('illegal best move');
  });

  it('does not ask a hosted engine to evaluate a dead draw with legal king moves', async () => {
    let hostedCalls = 0;
    const engine = new ChessApiEngine(async () => {
      hostedCalls++;
      return { ok: true, status: 200, json: async () => ({ move: 'e1e2', centipawns: 300, depth: 12 }) };
    });
    const result = await engine.evaluateMulti('4k3/8/8/8/8/8/8/4K3 w - - 0 1', 12, 2);
    expect(hostedCalls).toBe(0);
    expect(result).toMatchObject({ cp: 0, mate: null, bestMoveUci: null, depth: 0 });
    await engine.quit();
  });

  it('recognizes an available en-passant capture for either side, not merely a target field', () => {
    const white = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
    const black = '4k3/8/8/8/3Pp3/8/8/4K3 b - d3 0 1';
    expect(hasLegalEnPassant(white)).toBe(true);
    expect(hasLegalEnPassant(black)).toBe(true);
    expect(strictFen(white)).not.toBe(white);
    expect(hasLegalEnPassant('4k3/8/8/3p4/8/8/8/4K3 w - d6 0 1')).toBe(false);
  });

  it('does not send a hosted request when legal en-passant would be lost', async () => {
    let called = false;
    const engine = new ChessApiEngine(async () => { called = true; throw new Error('unexpected API call'); });
    // No fake remote response is acceptable for a position with a legal EP move.
    // Local Stockfish may be unavailable in CI; either result is safe.
    try { await engine.evaluateMulti('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 5, 1); } catch { /* local binary absent */ }
    expect(called).toBe(false);
    await engine.quit();
  });
});
