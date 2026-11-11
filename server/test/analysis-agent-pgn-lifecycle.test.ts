import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AnalysisEngine } from '../src/chess/engine.js';
import type { EngineMultiEval } from '../src/chess/stockfish.js';

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
  const evaluateMulti = vi.fn(async (_fen: string, _depth: number, _n: number): Promise<EngineMultiEval> => {
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

  it('does not invent a game rating when only opening-book moves are available', async () => {
    const fake = fakeEngine();
    mocks.createAnalysisEngine.mockReturnValue(fake.engine);
    const result = await analyzePgnFull('1. e4 e5', 16, {
      ...perf, score: 1, opponentRating: 1600,
    });
    expect(result.moves.map((m) => m.classification)).toEqual(['book', 'book']);
    expect(result.accuracy_white).toBe(0);
    expect(result.accuracy_black).toBe(0);
    expect(result.estimated_elo_white).toBeNull();
    expect(result.estimated_elo_black).toBeNull();
    expect(result.performance_white).toBeNull();
    expect(result.performance_black).toBeNull();
  });

  it('does not estimate a rating from a single unavoidable reply in a Black-first FEN', async () => {
    const fake = fakeEngine();
    mocks.createAnalysisEngine.mockReturnValue(fake.engine);
    const fen = 'k6R/8/2K5/8/8/8/8/8 b - - 0 1';
    const pgn = `[SetUp "1"]\n[FEN "${fen}"]\n\n1... Ka7`;
    const result = await analyzePgnFull(pgn, 16, { ...perf, userColor: 'black', score: 0 });
    expect(result.moves[0]?.classification).toBe('forced');
    expect(result.estimated_elo_white).toBeNull();
    expect(result.estimated_elo_black).toBeNull();
    expect(result.performance_black).toBeNull();
  });

  it('uses the same 300cp ACPL cap in phases as in whole-game strength estimates', async () => {
    const fake = fakeEngine();
    fake.evaluateMulti.mockImplementation(async () => {
      // First pair flips a mate evaluation from White-winning to Black-winning.
      // This is a deliberate malformed-engine negative-control for ACPL math,
      // not a claim that Stockfish would return these values for this game.
      const index = fake.evaluateMulti.mock.calls.length - 1;
      const mate = index === 0 || index === 1 ? 3 : null;
      return { cp: mate === null ? 0 : null, mate, pv: [],
        bestMoveUci: 'e2e4', depth: 16,
        candidates: [{ cp: mate === null ? 0 : null, mate, pv: [], multipv: 1 }] };
    });
    mocks.createAnalysisEngine.mockReturnValue(fake.engine);
    const fen = 'k7/8/8/8/8/8/8/4K2R w - - 0 40';
    const pgn = `[SetUp "1"]\n[FEN "${fen}"]\n\n40. Rh8+ Kb7 41. Rh7+ Kb6 42. Rh6+ Kc5`;
    const result = await analyzePgnFull(pgn, 16, perf);
    const whiteEligible = result.moves.filter((m) => m.fen_before.split(' ')[1] === 'w'
      && m.classification !== 'book' && m.classification !== 'forced');
    expect(whiteEligible.some((m) => m.centipawn_loss === 1000)).toBe(true);
    const expected = Math.round(whiteEligible.reduce((sum, m) => sum + Math.min(m.centipawn_loss, 300), 0) / whiteEligible.length);
    expect(result.phase_split?.endgame?.acpl_white).toBe(expected);
  });

  it('scores a completed threefold draw using the recorded game history, not FEN-only engine output', async () => {
    const fake = fakeEngine();
    fake.evaluateMulti.mockImplementation(async () => ({
      cp: 250, mate: null, bestMoveUci: 'g1f3', pv: ['g1f3'], depth: 16,
      candidates: [{ cp: 250, mate: null, pv: ['g1f3'], multipv: 1 }],
    }));
    mocks.createAnalysisEngine.mockReturnValue(fake.engine);
    const pgn = '[Result "1/2-1/2"]\n\n1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 1/2-1/2';
    const result = await analyzePgnFull(pgn, 16, perf);
    expect(result.moves).toHaveLength(8);
    expect(result.moves[7]?.eval_after_cp).toBe(0);
    expect(result.moves[7]?.mate_after).toBeNull();
    // Starting position plus seven non-terminal positions. No Stockfish call
    // is allowed to override an actual claimed terminal threefold draw.
    expect(fake.evaluateMulti).toHaveBeenCalledTimes(8);
  });

  it('does not treat an unclaimed repetition in an unfinished PGN as a forced draw', async () => {
    const fake = fakeEngine();
    fake.evaluateMulti.mockImplementation(async () => ({
      cp: 250, mate: null, bestMoveUci: 'g1f3', pv: ['g1f3'], depth: 16,
      candidates: [{ cp: 250, mate: null, pv: ['g1f3'], multipv: 1 }],
    }));
    mocks.createAnalysisEngine.mockReturnValue(fake.engine);
    const result = await analyzePgnFull('1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 *', 16, perf);
    expect(result.moves[7]?.eval_after_cp).toBe(250);
    expect(fake.evaluateMulti).toHaveBeenCalledTimes(9);
  });

  it('rejects missing final engine evidence after an unclaimed threefold repetition', async () => {
    const fake = fakeEngine();
    fake.evaluateMulti.mockImplementation(async () => {
      if (fake.evaluateMulti.mock.calls.length === 9) {
        return { cp: null, mate: null, bestMoveUci: null, pv: [], depth: 0, candidates: [] };
      }
      return { cp: 250, mate: null, bestMoveUci: 'g1f3', pv: ['g1f3'], depth: 16,
        candidates: [{ cp: 250, mate: null, pv: ['g1f3'], multipv: 1 }] };
    });
    mocks.createAnalysisEngine.mockReturnValue(fake.engine);
    // A third repetition may be claimed, but the game explicitly remains
    // unfinished. No score is evidence of engine failure, NOT a 0cp draw.
    const pgn = '1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 *';
    await expect(analyzePgnFull(pgn, 16, perf)).rejects.toThrow('engine_invalid_score');
    expect(fake.evaluateMulti).toHaveBeenCalledTimes(9);
    expect(fake.quit).toHaveBeenCalledTimes(1);
  });

  it('never reinterprets a missing checkmate-terminal score as a drawn game', async () => {
    const fake = fakeEngine();
    fake.evaluateMulti.mockImplementation(async () => {
      if (fake.evaluateMulti.mock.calls.length === 5) {
        return { cp: null, mate: null, bestMoveUci: null, pv: [], depth: 0, candidates: [] };
      }
      return { cp: 25, mate: null, bestMoveUci: 'e2e4', pv: [], depth: 16,
        candidates: [{ cp: 25, mate: null, pv: [], multipv: 1 }] };
    });
    mocks.createAnalysisEngine.mockReturnValue(fake.engine);
    await expect(analyzePgnFull('1. f3 e5 2. g4 Qh4# 0-1', 16, perf))
      .rejects.toThrow('engine_invalid_score');
    expect(fake.evaluateMulti).toHaveBeenCalledTimes(5);
    expect(fake.quit).toHaveBeenCalledTimes(1);
  });

  it('honors a claimed 50-move-rule draw at the end of a custom-FEN game', async () => {
    const fake = fakeEngine();
    fake.evaluateMulti.mockImplementation(async () => ({
      cp: 200, mate: null, bestMoveUci: 'h1h8', pv: [], depth: 16,
      candidates: [{ cp: 200, mate: null, pv: [], multipv: 1 }],
    }));
    mocks.createAnalysisEngine.mockReturnValue(fake.engine);
    const fen = 'k7/8/8/8/8/8/8/4K2R w - - 99 40';
    const pgn = `[SetUp "1"]\n[FEN "${fen}"]\n[Result "1/2-1/2"]\n\n40. Rh8+ 1/2-1/2`;
    const result = await analyzePgnFull(pgn, 16, perf);
    // White POV of a zero score may be -0 because the turn is Black; both
    // representations mean an exact draw and serialize to 0 in JSON.
    expect(Math.abs(result.moves[0]!.eval_after_cp!)).toBe(0);
    expect(result.moves[0]?.fen_after.split(' ')[4]).toBe('100');
    expect(fake.evaluateMulti).toHaveBeenCalledTimes(1);
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

  it('excludes forced moves from phase ACPL just as full-game scoring does', async () => {
    const fake = fakeEngine();
    const scores = [0, 300, -40, 200, -100, 0, 200];
    fake.evaluateMulti.mockImplementation(async () => {
      const cp = scores[fake.evaluateMulti.mock.calls.length - 1] ?? 0;
      return {
        cp, mate: null, pv: [], bestMoveUci: 'e2e4', depth: 16,
        candidates: [{ cp, mate: null, pv: [], multipv: 1 }],
      };
    });
    mocks.createAnalysisEngine.mockReturnValue(fake.engine);
    const fen = 'k6R/8/2K5/8/8/8/8/8 b - - 0 1';
    const pgn = `[SetUp "1"]\n[FEN "${fen}"]\n\n1... Ka7 2. Rh7+ Kb8 3. Rh8+ Ka7 4. Rh7+`;
    const result = await analyzePgnFull(pgn, 16, perf);
    const blackMoves = result.moves.filter((m) => m.fen_before.split(' ')[1] === 'b');
    expect(blackMoves.map((m) => m.classification)).toEqual(['forced', expect.not.stringMatching(/^forced$/), 'forced']);
    const chosenMoves = blackMoves.filter((m) => m.classification !== 'book' && m.classification !== 'forced');
    const expectedAcpl = Math.round(chosenMoves.reduce((sum, m) => sum + m.centipawn_loss, 0) / chosenMoves.length);
    expect(result.phase_split?.endgame?.acpl_black).toBe(expectedAcpl);
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
