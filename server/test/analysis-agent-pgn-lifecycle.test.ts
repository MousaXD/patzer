import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AnalysisEngine } from '../src/chess/engine.js';

// This module must never load the user's real DB or create a session secret.
const mocks = vi.hoisted(() => ({
  createAnalysisEngine: vi.fn(),
}));
vi.mock('../src/db.js', () => ({
  db: { prepare: vi.fn(() => { throw new Error('unexpected database access'); }) },
  getSetting: () => null,
}));
vi.mock('../src/config.js', () => ({
  config: { stockfishPathHint: undefined, projectRoot: '/unused-test-root' },
}));
vi.mock('../src/auth/middleware.js', () => ({
  requireAuth: async () => undefined,
}));
vi.mock('../src/chess/engine.js', () => ({
  createAnalysisEngine: mocks.createAnalysisEngine,
  engineBackend: () => 'local',
}));

import { analyzePgnFull } from '../src/routes/analyze.js';

const perf = {
  score: null,
  userColor: 'white' as const,
  opponentRating: null,
  opponentRd: null,
};

function fakeEngine(options: { failStart?: boolean; failEval?: boolean } = {}) {
  const quit = vi.fn(async () => undefined);
  const start = vi.fn(async () => {
    if (options.failStart) throw new Error('injected start failure');
  });
  // Keep the real engine method signature so mock.calls includes the supplied
  // FEN for assertions (a zero-argument mock is typed as an empty tuple).
  const evaluateMulti = vi.fn(async (_fen: string, _depth: number, _n: number) => {
    if (options.failEval) throw new Error('injected search failure');
    return {
      cp: 20, mate: null, pv: ['e2e4'], bestMoveUci: 'e2e4', depth: 16,
      candidates: [{ cp: 20, mate: null, pv: ['e2e4'], multipv: 1 }],
    };
  });
  const engine: AnalysisEngine = {
    kind: 'local',
    start,
    quit,
    evaluateMulti,
    newGame: vi.fn(async () => undefined),
    setOption: vi.fn(async () => undefined),
  };
  return { engine, start, evaluateMulti, quit };
}

describe('analysis-agent PGN lifecycle', () => {
  beforeEach(() => mocks.createAnalysisEngine.mockReset());

  it('rejects oversized PGN input before allocating an engine', async () => {
    await expect(analyzePgnFull('a'.repeat(256_001), 16, perf))
      .rejects.toThrow('pgn_too_large');
    expect(mocks.createAnalysisEngine).not.toHaveBeenCalled();
  });

  it('rejects invalid PGN before allocating an engine', async () => {
    await expect(analyzePgnFull('1. e5 Qh4', 16, perf))
      .rejects.toThrow('invalid_pgn');
    expect(mocks.createAnalysisEngine).not.toHaveBeenCalled();
  });

  it('quits a child even if it fails during startup', async () => {
    const fake = fakeEngine({ failStart: true });
    mocks.createAnalysisEngine.mockReturnValue(fake.engine);
    await expect(analyzePgnFull('1. e4', 16, perf))
      .rejects.toThrow('injected start failure');
    expect(fake.quit).toHaveBeenCalledTimes(1);
  });

  it('quits a child if a position search fails during an otherwise valid PGN', async () => {
    const fake = fakeEngine({ failEval: true });
    mocks.createAnalysisEngine.mockReturnValue(fake.engine);
    await expect(analyzePgnFull('1. e4', 16, perf))
      .rejects.toThrow('injected search failure');
    expect(fake.evaluateMulti).toHaveBeenCalledTimes(1);
    expect(fake.quit).toHaveBeenCalledTimes(1);
  });

  it('keeps a valid game analysis when the engine supplies an illegal optional PV', async () => {
    const fake = fakeEngine();
    fake.evaluateMulti.mockImplementation(async () => ({
      cp: 20, mate: null, pv: ['a1a1'], bestMoveUci: 'h9h9', depth: 16,
      candidates: [{ cp: 20, mate: null, pv: ['a1a1'], multipv: 1 }],
    }));
    mocks.createAnalysisEngine.mockReturnValue(fake.engine);

    const result = await analyzePgnFull('1. e4', 16, perf);
    expect(result.moves).toHaveLength(1);
    expect(result.moves[0]).toMatchObject({ best_move_uci: null, best_move_san: null, best_pv: [] });
    expect(fake.quit).toHaveBeenCalledTimes(1);
  });

  it('scores a FEN-started game where Black makes the first recorded move', async () => {
    const fake = fakeEngine();
    mocks.createAnalysisEngine.mockReturnValue(fake.engine);
    const startingFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
    const pgn = `[SetUp "1"]\n[FEN "${startingFen}"]\n\n1... e5`;

    const result = await analyzePgnFull(pgn, 16, { ...perf, userColor: 'black' });
    expect(fake.evaluateMulti.mock.calls[0]?.[0]).toBe(startingFen);
    expect(result.moves).toHaveLength(1);
    expect(result.moves[0]).toMatchObject({ uci: 'e7e5', fen_before: startingFen });
    expect(result.moves[0]?.fen_after).toContain(' w ');
    expect(fake.quit).toHaveBeenCalledTimes(1);
  });

  it('attributes phase ACPL to the actual mover for a Black-first FEN game', async () => {
    const fake = fakeEngine();
    const scores = [0, 300, -40, 200, -100, 0];
    fake.evaluateMulti.mockImplementation(async () => {
      const cp = scores[fake.evaluateMulti.mock.calls.length - 1] ?? 0;
      return {
        cp, mate: null, pv: [], bestMoveUci: 'e2e4', depth: 16,
        candidates: [{ cp, mate: null, pv: [], multipv: 1 }],
      };
    });
    mocks.createAnalysisEngine.mockReturnValue(fake.engine);

    // A legal, off-book setup with Black to move; ply 1 is Black, not White.
    const fen = 'rnbqkbnr/2pppppp/pp6/8/7P/1P5R/P1PPPPP1/RNBQKBN1 b Qkq - 1 3';
    const pgn = `[SetUp "1"]\n[FEN "${fen}"]\n\n3... e5 4. Bb2 Nc6 5. c4 Nf6`;
    const result = await analyzePgnFull(pgn, 16, perf);
    expect(result.moves).toHaveLength(5);
    expect(result.moves.every((m) => m.classification !== 'book' && m.classification !== 'forced')).toBe(true);

    const acplFor = (turn: 'w' | 'b') => {
      const losses = result.moves.filter((m) => m.fen_before.split(' ')[1] === turn)
        .map((m) => m.centipawn_loss);
      return Math.round(losses.reduce((sum, value) => sum + value, 0) / losses.length);
    };
    expect(acplFor('w')).not.toBe(acplFor('b'));
    expect(result.phase_split?.opening?.acpl_white).toBe(acplFor('w'));
    expect(result.phase_split?.opening?.acpl_black).toBe(acplFor('b'));
  });

  it('does not double-count opening and endgame phases in an endgame-start PGN', async () => {
    const fake = fakeEngine();
    mocks.createAnalysisEngine.mockReturnValue(fake.engine);
    const fen = 'k7/8/8/8/8/8/8/4K2R w - - 0 40';
    const pgn = `[SetUp "1"]\n[FEN "${fen}"]\n\n40. Rh8+ Kb7 41. Rh7+ Kb6 42. Rh6+ Kc5`;

    const result = await analyzePgnFull(pgn, 16, perf);
    expect(result.moves).toHaveLength(6);
    expect(result.phase_split?.opening).toBeNull();
    expect(result.phase_split?.middlegame).toBeNull();
    expect(result.phase_split?.endgame).toMatchObject({ from_ply: 1, to_ply: 6 });
  });

  it('does not publish a completed score if the request aborts at the final ply', async () => {
    const controller = new AbortController();
    const fake = fakeEngine();
    fake.evaluateMulti.mockImplementation(async () => {
      if (fake.evaluateMulti.mock.calls.length === 2) controller.abort();
      return {
        cp: 20, mate: null, pv: ['e2e4'], bestMoveUci: 'e2e4', depth: 16,
        candidates: [{ cp: 20, mate: null, pv: ['e2e4'], multipv: 1 }],
      };
    });
    mocks.createAnalysisEngine.mockReturnValue(fake.engine);
    await expect(analyzePgnFull('1. e4', 16, perf, controller.signal))
      .rejects.toThrow('analysis_cancelled');
    expect(fake.quit).toHaveBeenCalled();
  });

  it('does not return a result when the request aborts during final engine teardown', async () => {
    const controller = new AbortController();
    const fake = fakeEngine();
    fake.quit.mockImplementation(async () => { controller.abort(); });
    mocks.createAnalysisEngine.mockReturnValue(fake.engine);

    await expect(analyzePgnFull('1. e4', 16, perf, controller.signal))
      .rejects.toThrow('analysis_cancelled');
    expect(fake.quit).toHaveBeenCalled();
  });

  it('never launches a search on an already-cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = fakeEngine();
    mocks.createAnalysisEngine.mockReturnValue(fake.engine);
    await expect(analyzePgnFull('1. e4', 16, perf, controller.signal))
      .rejects.toThrow('analysis_cancelled');
    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.quit).toHaveBeenCalledTimes(1);
  });
});
