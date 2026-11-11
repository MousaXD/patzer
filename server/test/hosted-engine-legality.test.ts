import { describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';

// The hosted adapter imports the local Stockfish fallback, which imports DB
// and config at module load. Neither a real SQLite DB nor a session-secret
// belongs in a deterministic chess-protocol unit test.
vi.mock('../src/db.js', () => ({ getSetting: () => null }));
vi.mock('../src/config.js', () => ({
  config: { stockfishPathHint: undefined, projectRoot: '/unused-test-root' },
}));
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

  it('does not silently promote an invalid continuation missing the promotion suffix', () => {
    const fen = '4k3/P7/8/8/8/8/8/4K3 b - - 0 1';
    // Black's legal king move is followed by an apparently valid but
    // underspecified White promotion. The UCI continuation must stop there.
    const result = parseChessApiResponse({
      move: 'e8e7', centipawns: 0, continuationArr: ['a7a8'],
    }, fen);
    expect(result.pv).toEqual(['e8e7']);
  });

  it('accepts legal promotions and rejects a promotion without its suffix', () => {
    const fen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
    expect(parseChessApiResponse({ move: 'a7a8n', mate: 2 }, fen).bestMoveUci).toBe('a7a8n');
    expect(() => parseChessApiResponse({ move: 'a7a8', centipawns: 20 }, fen)).toThrow('illegal best move');
  });

  it('rejects promotion suffixes on ordinary moves and truncates such malformed PVs', () => {
    // chess.js silently ignores promotion: 'q' for an ordinary e2-e4 move;
    // the UCI suffix itself is still invalid and must be rejected.
    expect(() => parseChessApiResponse({ move: 'e2e4q', centipawns: 20 }, start))
      .toThrow('illegal best move');
    const result = parseChessApiResponse({
      move: 'e2e4', centipawns: 20, continuationArr: ['e7e5q', 'g1f3'],
    }, start);
    expect(result.pv).toEqual(['e2e4']);
  });

  it('rejects zero/fractional mate claims in positions that have legal moves', () => {
    for (const mate of [0, -0, 1.5, -2.5, '0', 'Infinity']) {
      expect(() => parseChessApiResponse({ move: 'e2e4', mate }, start), String(mate))
        .toThrow('chessapi: no score');
    }
  });

  it('rejects malformed declared depths instead of reporting impossible search budgets', () => {
    for (const depth of [-1, 2.5, 'NaN', 'Infinity', 1e308]) {
      expect(() => parseChessApiResponse({ move: 'e2e4', centipawns: 30, depth }, start), String(depth))
        .toThrow('chessapi: invalid depth');
    }
    expect(parseChessApiResponse({ move: 'e2e4', centipawns: 30 }, start).depth).toBe(0);
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

  it('does not switch to local Stockfish mid-review after a hosted score was already used', async () => {
    let calls = 0;
    const engine = new ChessApiEngine(async () => {
      calls++;
      return { ok: true, status: 200, json: async () => ({ move: 'e2e4', centipawns: 0, depth: 12 }) };
    });
    try {
      await engine.evaluateMulti(start, 12, 1);
      await expect(engine.evaluateMulti('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 12, 1))
        .rejects.toThrow('chessapi_source_change');
      expect(calls).toBe(1);
    } finally { await engine.quit(); }
  });

  it('does not silently change engines when a later hosted evaluation fails', async () => {
    let calls = 0;
    const engine = new ChessApiEngine(async () => {
      if (++calls > 1) throw new Error('injected hosted failure');
      return { ok: true, status: 200, json: async () => ({ move: 'e2e4', centipawns: 0, depth: 12 }) };
    });
    try {
      await engine.evaluateMulti(start, 12, 1);
      const next = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
      await expect(engine.evaluateMulti(next, 12, 1)).rejects.toThrow('chessapi_source_change');
      expect(calls).toBe(3); // original success, two bounded attempts
    } finally { await engine.quit(); }
  });

  it('rejects parallel position evaluations on the same hosted engine session', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const engine = new ChessApiEngine(async () => {
      await gate;
      return { ok: true, status: 200, json: async () => ({ move: 'e2e4', centipawns: 10 }) };
    });
    try {
      const first = engine.evaluateMulti(start, 12, 1);
      await expect(engine.evaluateMulti(start, 12, 1)).rejects.toThrow('engine_busy');
      release();
      await first;
    } finally { release(); await engine.quit(); }
  });

  it('cancels an in-flight hosted request on quit and never retries an abandoned evaluation', async () => {
    let calls = 0;
    let wasAborted = false;
    const engine = new ChessApiEngine(async (_url, init) => {
      calls++;
      return new Promise((_resolve, reject) => {
        const signal = init.signal!;
        if (signal.aborted) return reject(new Error('request_aborted'));
        signal.addEventListener('abort', () => {
          wasAborted = true;
          reject(new Error('request_aborted'));
        }, { once: true });
      });
    });
    const pending = engine.evaluateMulti(start, 16, 3);
    // Attach the rejection expectation before shutdown to avoid an unhandled
    // rejection even when cancellation resolves in the same microtask.
    const rejected = expect(pending).rejects.toThrow('engine_terminated');
    await engine.quit();
    await rejected;
    expect(wasAborted).toBe(true);
    expect(calls).toBe(1);
    await expect(engine.evaluateMulti(start, 16, 3)).rejects.toThrow('engine_not_ready');
  });

  it('keeps options and game reset exclusive while hosted evaluation is pending', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const engine = new ChessApiEngine(async () => {
      await gate;
      return { ok: true, status: 200, json: async () => ({ move: 'e2e4', centipawns: 20, depth: 10 }) };
    });
    try {
      const pending = engine.evaluateMulti(start, 10, 2);
      await expect(engine.setOption('Hash', 32)).rejects.toThrow('engine_busy');
      await expect(engine.newGame()).rejects.toThrow('engine_busy');
      release();
      await pending;
      await expect(engine.newGame()).resolves.toBeUndefined();
    } finally { release(); await engine.quit(); }
  });

  it('normalizes both colors of White-perspective mate results into side-to-move scores', () => {
    const fenBlack = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    expect(parseChessApiResponse({ move: 'e7e5', mate: 3 }, fenBlack).mate).toBe(-3);
    expect(parseChessApiResponse({ move: 'e7e5', mate: -3 }, fenBlack).mate).toBe(3);
    expect(parseChessApiResponse({ move: 'e2e4', mate: 3 }, start).mate).toBe(3);
    expect(() => parseChessApiResponse({ move: 'e2e4', mate: 'NaN' }, start))
      .toThrow('chessapi: no score');
  });
});
