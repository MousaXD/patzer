import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { Chess } from 'chess.js';

// Opt-in bounded binary test: PATZER_TEST_STOCKFISH=/absolute/path/to/stockfish
// No database or session-secret may be opened by importing the adapter.
vi.mock('../src/db.js', () => ({ getSetting: () => null }));
vi.mock('../src/config.js', () => ({ config: { stockfishPathHint: undefined, projectRoot: '/unused-test-root' } }));
import { StockfishEngine } from '../src/chess/stockfish.js';
import { normalizeEval } from '../src/chess/classifier.js';

const enginePath = process.env.PATZER_TEST_STOCKFISH;
const withBinary = enginePath && existsSync(enginePath) ? describe : describe.skip;
const cases = [
  { name: 'initial position', fen: new Chess().fen() },
  { name: 'Black first in a custom FEN', fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1' },
  { name: 'castling available', fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' },
  { name: 'legal en passant', fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1' },
  { name: 'pinned en passant forbidden', fen: '4r1k1/8/8/3pP3/8/8/8/4K3 w - d6 0 1' },
  { name: 'underpromotion is possible', fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1' },
  { name: 'checkmate', fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3' },
  { name: 'stalemate', fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' },
] as const;

withBinary('real Stockfish 17+ (opt-in, depth 8, one thread)', () => {
  it('keeps best moves, candidate ranks, PVs, mates and side-to-move perspective coherent', async () => {
    const engine = new StockfishEngine(enginePath!);
    await engine.start();
    try {
      await engine.setOption('Threads', 1);
      await engine.setOption('Hash', 16);
      await engine.newGame();
      for (const entry of cases) {
        const board = new Chess(entry.fen);
        const result = await engine.evaluateMulti(entry.fen, 8, 3);
        expect(result.cp !== null || result.mate !== null, entry.name).toBe(true);
        if (board.isCheckmate()) {
          expect(result.mate, entry.name).toBe(0);
          expect(result.bestMoveUci, entry.name).toBeNull();
          expect(result.candidates, entry.name).toEqual([]);
          expect(normalizeEval(result.cp, result.mate, board.turn()), entry.name)
            .toBe(board.turn() === 'w' ? -10_000 : 10_000);
          continue;
        }
        if (board.isStalemate()) {
          expect(result.cp, entry.name).toBe(0);
          expect(result.bestMoveUci, entry.name).toBeNull();
          continue;
        }
        expect(result.bestMoveUci, entry.name).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
        const best = result.bestMoveUci!;
        expect(() => new Chess(entry.fen).move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] }), entry.name)
          .not.toThrow();
        expect(result.candidates.map((c) => c.multipv), entry.name)
          .toEqual(result.candidates.map((_, index) => index + 1));
        if (result.candidates.length) expect(result.candidates[0]?.pv[0], entry.name).toBe(best);
        for (const candidate of result.candidates) {
          const replay = new Chess(entry.fen);
          for (const move of candidate.pv) {
            expect(() => replay.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] }), entry.name)
              .not.toThrow();
          }
        }
      }
    } finally {
      await engine.quit();
    }
  }, 20_000);
});
