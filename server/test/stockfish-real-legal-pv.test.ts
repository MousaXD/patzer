import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { Chess } from 'chess.js';

// Opt-in bounded binary test: PATZER_TEST_STOCKFISH=/absolute/path/to/stockfish
// No database or session-secret may be opened by importing the adapter.
vi.mock('../src/db.js', () => ({ getSetting: () => null }));
vi.mock('../src/config.js', () => ({
  config: { stockfishPathHint: process.env.PATZER_TEST_STOCKFISH, projectRoot: '/unused-test-root' },
}));
import { StockfishEngine } from '../src/chess/stockfish.js';
import { ChessApiEngine } from '../src/chess/engine.js';
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
  { name: 'only one legal Black reply', fen: 'k6R/8/2K5/8/8/8/8/8 b - - 0 1' },
  { name: 'White has a forced mate in one', fen: '7k/7p/5KQ1/8/8/8/8/8 w - - 0 1' },
  { name: 'Black has a forced mate in one', fen: '8/8/8/8/8/5kq1/7P/7K b - - 0 1' },
  { name: 'White is checkmated', fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3' },
  { name: 'Black is checkmated', fen: '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1' },
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
        if (entry.name.includes('forced mate in one')) {
          expect(result.mate, entry.name).toBe(1);
          // The same side-to-move mate translates to opposite White POV
          // depending on which player is making the move.
          const expectedWhiteCp = board.turn() === 'w' ? 9_990 : -9_990;
          expect(normalizeEval(result.cp, result.mate, board.turn()), entry.name).toBe(expectedWhiteCp);
        }
        if (board.moves().length === 1) {
          expect(result.candidates, entry.name).toHaveLength(1);
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

  it('starts and stays on the local engine when a legal EP capture is in the first position', async () => {
    let hostedCalls = 0;
    const engine = new ChessApiEngine(async () => {
      hostedCalls++;
      throw new Error('unexpected hosted request');
    });
    const startFen = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
    try {
      await engine.start();
      await engine.setOption('Threads', 1);
      await engine.setOption('Hash', 16);
      await engine.newGame();
      const first = await engine.evaluateMulti(startFen, 8, 2);
      expect(first.bestMoveUci).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
      const next = new Chess(startFen);
      next.move('exd6');
      const second = await engine.evaluateMulti(next.fen(), 8, 2);
      expect(second.cp !== null || second.mate !== null).toBe(true);
      expect(hostedCalls).toBe(0);
    } finally { await engine.quit(); }
  }, 20_000);

  it('uses only local evaluations if the very first remote request fails twice', async () => {
    let hostedCalls = 0;
    const engine = new ChessApiEngine(async () => {
      hostedCalls++;
      throw new Error('offline hosted provider (synthetic)');
    });
    try {
      await engine.start();
      await engine.setOption('Threads', 1);
      await engine.setOption('Hash', 16);
      await engine.newGame();
      const first = await engine.evaluateMulti(new Chess().fen(), 8, 2);
      const second = await engine.evaluateMulti('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', 8, 2);
      expect(first.cp !== null || first.mate !== null).toBe(true);
      expect(second.cp !== null || second.mate !== null).toBe(true);
      expect(hostedCalls).toBe(2);
    } finally { await engine.quit(); }
  }, 20_000);

  it('does not release hosted-session exclusivity before its local fallback search settles', async () => {
    const engine = new ChessApiEngine(async () => { throw new Error('hosted should not be contacted'); });
    const fen = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let restoreSpy: () => void = () => {};
    try {
      await engine.start();
      await engine.setOption('Threads', 1);
      await engine.setOption('Hash', 16);
      await engine.newGame();
      // Warm the local fallback with a legal en-passant position.
      await engine.evaluateMulti(fen, 8, 1);
      const spy = vi.spyOn(StockfishEngine.prototype, 'evaluateMulti').mockImplementationOnce(async () => {
        await gate;
        return { cp: 0, mate: null, depth: 8, bestMoveUci: 'e5d6', pv: ['e5d6'],
          candidates: [{ cp: 0, mate: null, pv: ['e5d6'], multipv: 1 }] };
      });
      restoreSpy = () => spy.mockRestore();
      const pending = engine.evaluateMulti(fen, 8, 1);
      await expect(engine.setOption('Hash', 16)).rejects.toThrow('engine_busy');
      await expect(engine.newGame()).rejects.toThrow('engine_busy');
      release();
      await pending;
    } finally {
      release();
      restoreSpy();
      await engine.quit();
    }
  }, 20_000);

  it('accepts independent completed searches at different depths without requiring identical best moves', async () => {
    const engine = new StockfishEngine(enginePath!);
    const positions = [
      new Chess().fen(),
      'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
      '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
    ];
    await engine.start();
    try {
      await engine.setOption('Threads', 1);
      await engine.setOption('Hash', 16);
      for (const fen of positions) {
        const legal = new Chess(fen).moves({ verbose: true });
        for (const depth of [6, 8, 10]) {
          await engine.newGame();
          const result = await engine.evaluateMulti(fen, depth, 3);
          expect(result.depth, `${fen} depth ${depth}`).toBeGreaterThanOrEqual(1);
          expect(result.cp !== null || result.mate !== null, `${fen} depth ${depth}`).toBe(true);
          expect(legal.some((move) => move.from + move.to + (move.promotion ?? '') === result.bestMoveUci), `${fen} depth ${depth}`).toBe(true);
          expect(result.candidates.map((candidate) => candidate.multipv), `${fen} depth ${depth}`)
            .toEqual(result.candidates.map((_, index) => index + 1));
          for (const candidate of result.candidates) {
            const position = new Chess(fen);
            for (const uci of candidate.pv) {
              expect(() => position.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }), `${fen} depth ${depth}`).not.toThrow();
            }
          }
        }
      }
    } finally { await engine.quit(); }
  }, 20_000);
});
