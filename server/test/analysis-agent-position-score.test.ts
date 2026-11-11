import { describe, expect, it, vi } from 'vitest';
import type { AnalysisEngine } from '../src/chess/engine.js';
import type { EngineMultiEval } from '../src/chess/stockfish.js';

// No live authentication, settings, disk, game database, or network access.
const mocks = vi.hoisted(() => ({ createAnalysisEngine: vi.fn() }));
vi.mock('../src/db.js', () => ({
  db: { prepare: vi.fn(() => { throw new Error('unexpected database access'); }) },
  getSetting: () => null,
}));
vi.mock('../src/config.js', () => ({
  config: { stockfishPathHint: undefined, projectRoot: '/unused-test-root' },
}));
vi.mock('../src/auth/middleware.js', () => ({
  requireAuth: async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set('user', { id: 940001 });
    await next();
  },
}));
vi.mock('../src/chess/engine.js', () => ({
  createAnalysisEngine: mocks.createAnalysisEngine,
  engineBackend: () => 'local',
}));

import router from '../src/routes/analyze.js';

const CHECKMATE = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
const failed: EngineMultiEval = {
  cp: null, mate: null, bestMoveUci: null, pv: [], depth: 0, candidates: [],
};
const factualMate: EngineMultiEval = {
  cp: null, mate: 0, bestMoveUci: null, pv: [], depth: 0, candidates: [],
};

describe('isolated ad-hoc position engine score contract', () => {
  it('rejects missing score on checkmate and does not cache it as a valid terminal result', async () => {
    mocks.createAnalysisEngine.mockReset();
    let score = failed;
    const quit = vi.fn(async () => undefined);
    const evaluateMulti = vi.fn(async (): Promise<EngineMultiEval> => score);
    const engine: AnalysisEngine = {
      kind: 'local',
      start: async () => undefined,
      setOption: async () => undefined,
      newGame: async () => undefined,
      evaluateMulti,
      quit,
    };
    mocks.createAnalysisEngine.mockReturnValue(engine);

    const request = () => router.request('/position', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fen: CHECKMATE, depth: 16, lines: 3 }),
    });

    const invalidResponse = await request();
    expect(invalidResponse.status).toBe(503);
    expect(await invalidResponse.json()).toEqual({ error: 'engine_error' });
    score = factualMate;
    const validResponse = await request();
    expect(validResponse.status).toBe(200);
    expect(await validResponse.json()).toMatchObject({ fen: CHECKMATE, depth: 0, lines: [] });

    const cachedResponse = await request();
    expect(cachedResponse.status).toBe(200);
    expect(mocks.createAnalysisEngine).toHaveBeenCalledTimes(2);
    expect(evaluateMulti).toHaveBeenCalledTimes(2);
    expect(quit).toHaveBeenCalledTimes(2);
  });
});
