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
  const evaluateMulti = vi.fn(async () => {
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
