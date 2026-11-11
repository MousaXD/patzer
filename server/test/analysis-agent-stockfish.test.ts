import { afterAll, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Importing StockfishEngine must never initialize a real SQLite connection.
vi.mock('../src/db.js', () => ({ getSetting: () => null }));
// config.ts otherwise creates a session-secret file at import time.
vi.mock('../src/config.js', () => ({
  config: { stockfishPathHint: undefined, projectRoot: '/unused-test-root' },
}));
import { StockfishEngine } from '../src/chess/stockfish.js';

const dir = mkdtempSync(join(tmpdir(), 'patzer-fake-uci-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function fakeUci(mode: 'normal' | 'mixed-depth' | 'mismatched-bestmove' | 'mismatched-single' | 'illegal-root' | 'invalid-second' | 'missing-second' | 'broken-continuation' | 'equal-candidates' | 'bounded-score' | 'forced-reply' | 'nonfinite-score' | 'crash-on-go' | 'crash-on-start' | 'hang-on-go' | 'slow-on-go'): string {
  const path = join(dir, mode + '.cjs');
  const lines = [
    '#!/usr/bin/env node',
    'const mode = ' + JSON.stringify(mode) + ';',
    "let input = '';",
    'let multipv = 1;',
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (data) => {",
    '  input += data;',
    '  let n;',
    "  while ((n = input.indexOf('\\n')) >= 0) {",
    '    const line = input.slice(0, n).trim();',
    '    input = input.slice(n + 1);',
    "    if (line === 'uci') {",
    "      if (mode === 'crash-on-start') process.exit(2);",
    "      process.stdout.write('id name FakeFish\\nuciok\\n');",
    "    } else if (line === 'isready') {",
    "      process.stdout.write('readyok\\n');",
    "    } else if (line.startsWith('setoption name MultiPV')) {",
    "      multipv = Number(line.split(' ').at(-1));",
    "    } else if (line.startsWith('go ')) {",
    "      if (mode === 'crash-on-go') process.exit(3);",
    "      if (mode === 'hang-on-go') continue;",
    "      if (mode === 'slow-on-go') {",
    "        setTimeout(() => {",
    "          process.stdout.write('info depth 16 multipv 1 score cp 40 pv e2e4\\n');",
    "          process.stdout.write('bestmove e2e4\\n');",
    "        }, 80);",
    "        continue;",
    "      }",
    "      if (mode === 'mismatched-bestmove') {",
    "        process.stdout.write('info depth 16 multipv 1 score cp 260 pv e2e4\\n');",
    "        process.stdout.write('info depth 16 multipv 2 score cp -80 pv d2d4\\n');",
    "        process.stdout.write('bestmove d2d4\\n');",
    "        continue;",
    "      }",
    "      if (mode === 'mismatched-single') {",
    "        process.stdout.write('info depth 16 multipv 1 score cp 260 pv e2e4\\n');",
    "        process.stdout.write('bestmove d2d4\\n');",
    "        continue;",
    "      }",
    "      if (mode === 'illegal-root') {",
    "        process.stdout.write('info depth 16 multipv 1 score cp 260 pv e2e5\\n');",
    "        process.stdout.write('bestmove e2e5\\n');",
    "        continue;",
    "      }",
    "      if (mode === 'invalid-second') {",
    "        process.stdout.write('info depth 16 multipv 1 score cp 260 pv e2e4\\n');",
    "        process.stdout.write('info depth 16 multipv 2 score cp -80 pv e7e5\\n');",
    "        process.stdout.write('info depth 16 multipv 3 score cp -120 pv b1c3\\n');",
    "        process.stdout.write('bestmove e2e4\\n');",
    "        continue;",
    "      }",
    "      if (mode === 'missing-second') {",
    "        process.stdout.write('info depth 16 multipv 1 score cp 260 pv e2e4\\n');",
    "        process.stdout.write('info depth 16 multipv 3 score cp -120 pv b1c3\\n');",
    "        process.stdout.write('bestmove e2e4\\n');",
    "        continue;",
    "      }",
    "      if (mode === 'broken-continuation') {",
    "        process.stdout.write('info depth 16 multipv 1 score cp 40 pv e2e4 e7e5 e1e3\\n');",
    "        process.stdout.write('bestmove e2e4\\n');",
    "        continue;",
    "      }",
    "      if (mode === 'equal-candidates') {",
    "        process.stdout.write('info depth 16 multipv 1 score cp 40 pv e2e4\\n');",
    "        process.stdout.write('info depth 16 multipv 2 score cp 39 pv d2d4\\n');",
    "        process.stdout.write('bestmove e2e4\\n');",
    "        continue;",
    "      }",
    "      if (mode === 'bounded-score') {",
    "        process.stdout.write('info depth 14 multipv 1 score cp 20 pv e2e4\\n');",
    "        process.stdout.write('info depth 16 multipv 1 score cp 300 lowerbound pv e2e4\\n');",
    "        process.stdout.write('info depth 16 multipv 2 score cp -80 pv d2d4\\n');",
    "        process.stdout.write('bestmove e2e4\\n');",
    "        continue;",
    "      }",
    "      if (mode === 'forced-reply') {",
    "        process.stdout.write('info depth 16 multipv 1 score cp -100 pv a8a7\\n');",
    "        process.stdout.write('info depth 16 multipv 2 score cp -100 pv a8a6\\n');",
    "        process.stdout.write('bestmove a8a7\\n');",
    "        continue;",
    "      }",
    "      if (mode === 'nonfinite-score') {",
    "        process.stdout.write('info depth 16 multipv 1 score cp NaN pv e2e4\\n');",
    "        process.stdout.write('info depth 16 multipv 2 score mate Infinity pv d2d4\\n');",
    "        process.stdout.write('bestmove e2e4\\n');",
    "        continue;",
    "      }",
    "      process.stdout.write('info depth 16 multipv 1 score cp 40 pv e2e4\\n');",
    "      if (multipv >= 2) process.stdout.write('info depth ' + (mode === 'mixed-depth' ? 15 : 16) + ' multipv 2 score cp 15 pv d2d4\\n');",
    "      process.stdout.write('bestmove e2e4\\n');",
    "    } else if (line === 'quit') {",
    "      if (mode === 'hang-on-go') continue;",
    '      process.exit(0);',
    '    }',
    '  }',
    '});',
  ];
  writeFileSync(path, lines.join('\n') + '\n', { mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// A fake, disposable UCI process exercises the actual subprocess protocol
// without touching the installed Stockfish binary or any game database.
const describeUnix = process.platform === 'win32' ? describe.skip : describe;
describeUnix('analysis-agent Stockfish subprocess lifecycle', () => {
  it('starts, handles UCI ready, parses scores and restores MultiPV', async () => {
    const engine = new StockfishEngine(fakeUci('normal'));
    try {
      await engine.start();
      expect(engine.isReady()).toBe(true);
      await engine.newGame();
      const result = await engine.evaluateMulti(START_FEN, 16, 2);
      expect(result.bestMoveUci).toBe('e2e4');
      expect(result.cp).toBe(40);
      expect(result.depth).toBe(16);
      expect(result.candidates.map((c) => c.multipv)).toEqual([1, 2]);
      const single = await engine.evaluate(START_FEN, 16);
      expect(single.cp).toBe(40);
      expect(await engine.bestMove(START_FEN, { depth: 16 })).toBe('e2e4');
    } finally {
      await engine.quit();
      await engine.quit();
    }
    expect(engine.isReady()).toBe(false);
  });

  it('does not compare candidate scores from different completed depths', async () => {
    const engine = new StockfishEngine(fakeUci('mixed-depth'));
    try {
      await engine.start();
      const result = await engine.evaluateMulti(START_FEN, 16, 3);
      expect(result.candidates.map((c) => c.multipv)).toEqual([1]);
    } finally {
      await engine.quit();
    }
  });

  it('rejects a scored root whose final bestmove contradicts rank-one evidence', async () => {
    const engine = new StockfishEngine(fakeUci('mismatched-bestmove'));
    try {
      await engine.start();
      await expect(engine.evaluateMulti(START_FEN, 16, 3)).rejects.toThrow('engine_inconsistent_pv');
    } finally {
      await engine.quit();
    }
  });

  it('rejects inconsistent or illegal roots in single-PV searches too', async () => {
    for (const mode of ['mismatched-single', 'illegal-root'] as const) {
      const engine = new StockfishEngine(fakeUci(mode));
      try {
        await engine.start();
        await expect(engine.evaluate(START_FEN, 16)).rejects.toThrow('engine_inconsistent_pv');
      } finally {
        await engine.quit();
      }
    }
  });

  it('rejects illegal UCI bestmove output before a bot or hint can use it', async () => {
    const engine = new StockfishEngine(fakeUci('illegal-root'));
    try {
      await engine.start();
      await expect(engine.bestMove(START_FEN, { depth: 8 })).rejects.toThrow('engine_illegal_bestmove');
    } finally {
      await engine.quit();
    }
  });

  it('rejects a legal move with no corresponding trustworthy scored principal variation', async () => {
    const engine = new StockfishEngine(fakeUci('nonfinite-score'));
    try {
      await engine.start();
      const result = await engine.evaluateMulti(START_FEN, 16, 3);
      expect(result.cp).toBeNull();
      expect(result.mate).toBeNull();
    } finally {
      await engine.quit();
    }
  });

  it('excludes an illegal second candidate instead of fabricating a unique best move', async () => {
    const engine = new StockfishEngine(fakeUci('invalid-second'));
    try {
      await engine.start();
      const result = await engine.evaluateMulti(START_FEN, 16, 3);
      expect(result.candidates.map((c) => c.multipv)).toEqual([1]);
      expect(result.candidates[0]?.pv).toEqual(['e2e4']);
    } finally {
      await engine.quit();
    }
  });

  it('cannot reinterpret MultiPV rank three as the missing second-best move', async () => {
    const engine = new StockfishEngine(fakeUci('missing-second'));
    try {
      await engine.start();
      const result = await engine.evaluateMulti(START_FEN, 16, 3);
      expect(result.candidates.map((c) => c.multipv)).toEqual([1]);
    } finally {
      await engine.quit();
    }
  });

  it('truncates a corrupt continuation before it can be presented as a legal line', async () => {
    const engine = new StockfishEngine(fakeUci('broken-continuation'));
    try {
      await engine.start();
      const result = await engine.evaluateMulti(START_FEN, 16, 1);
      expect(result.pv).toEqual(['e2e4', 'e7e5']);
      expect(result.candidates[0]?.pv).toEqual(['e2e4', 'e7e5']);
    } finally {
      await engine.quit();
    }
  });

  it('retains distinct equal-strength alternatives without manufacturing a large gap', async () => {
    const engine = new StockfishEngine(fakeUci('equal-candidates'));
    try {
      await engine.start();
      const result = await engine.evaluateMulti(START_FEN, 16, 3);
      expect(result.candidates.map((c) => c.multipv)).toEqual([1, 2]);
      expect(result.candidates.map((c) => c.cp)).toEqual([40, 39]);
      expect(result.candidates[0]!.cp! - result.candidates[1]!.cp!).toBe(1);
    } finally { await engine.quit(); }
  });

  it('never uses an upper/lower bound or a shallower rank to claim a unique best move', async () => {
    const engine = new StockfishEngine(fakeUci('bounded-score'));
    try {
      await engine.start();
      const result = await engine.evaluateMulti(START_FEN, 16, 3);
      expect(result.cp).toBe(20);
      expect(result.depth).toBe(14);
      expect(result.candidates.map((c) => c.multipv)).toEqual([1]);
    } finally { await engine.quit(); }
  });

  it('does not treat an impossible second candidate as an available alternative to a forced reply', async () => {
    const engine = new StockfishEngine(fakeUci('forced-reply'));
    try {
      await engine.start();
      const forcedFen = 'k6R/8/2K5/8/8/8/8/8 b - - 0 1';
      const result = await engine.evaluateMulti(forcedFen, 16, 3);
      expect(result.candidates.map((c) => c.multipv)).toEqual([1]);
      expect(result.candidates[0]?.pv).toEqual(['a8a7']);
    } finally { await engine.quit(); }
  });

  it('never treats nonfinite or incomplete UCI scores as numeric evidence', async () => {
    const engine = new StockfishEngine(fakeUci('nonfinite-score'));
    try {
      await engine.start();
      const result = await engine.evaluateMulti(START_FEN, 16, 3);
      expect(result.cp).toBeNull();
      expect(result.mate).toBeNull();
      expect(result.candidates).toEqual([]);
    } finally { await engine.quit(); }
  });

  it('rejects concurrent searches and option mutations instead of mixing UCI results', async () => {
    const engine = new StockfishEngine(fakeUci('slow-on-go'));
    try {
      await engine.start();
      const first = engine.evaluate(START_FEN, 16);
      await expect(engine.evaluate(START_FEN, 12)).rejects.toThrow('engine_busy');
      await expect(engine.evaluateMulti(START_FEN, 16, 3)).rejects.toThrow('engine_busy');
      await expect(engine.bestMove(START_FEN, { depth: 8 })).rejects.toThrow('engine_busy');
      await expect(engine.setOption('Hash', 32)).rejects.toThrow('engine_busy');
      await expect(engine.newGame()).rejects.toThrow('engine_busy');
      await expect(first).resolves.toMatchObject({ cp: 40, bestMoveUci: 'e2e4' });
      // Search admission must be released on success, without restarting.
      await expect(engine.bestMove(START_FEN, { depth: 8 })).resolves.toBe('e2e4');
    } finally {
      await engine.quit();
    }
  });

  it('keeps new-game and configuration handshakes exclusive before a search starts', async () => {
    const engine = new StockfishEngine(fakeUci('normal'));
    try {
      await engine.start();

      // A search started in the same tick must not interleave its position/go
      // commands with an outstanding ucinewgame/isready handshake.
      const reset = engine.newGame();
      await expect(engine.evaluate(START_FEN, 12)).rejects.toThrow('engine_busy');
      await expect(engine.setOption('Hash', 32)).rejects.toThrow('engine_busy');
      await expect(engine.name()).rejects.toThrow('engine_busy');
      await reset;

      const option = engine.setOption('Hash', 32);
      await expect(engine.bestMove(START_FEN, { depth: 12 })).rejects.toThrow('engine_busy');
      await option;

      // Exclusivity must be released after both control operations.
      await expect(engine.evaluate(START_FEN, 12)).resolves.toMatchObject({ cp: 40 });
      await expect(engine.name()).resolves.toBe('FakeFish');
    } finally {
      await engine.quit();
    }
  });

  it('does not accept further work on a terminated process', async () => {
    const engine = new StockfishEngine(fakeUci('normal'));
    await engine.start();
    await engine.quit();
    await expect(engine.evaluate(START_FEN, 12)).rejects.toThrow('engine_not_ready');
  });

  it('rejects promptly if the child exits while starting', async () => {
    const engine = new StockfishEngine(fakeUci('crash-on-start'));
    await expect(engine.start()).rejects.toThrow();
    expect(engine.isReady()).toBe(false);
    await engine.quit();
  });

  it('rejects promptly if the child exits mid-search', async () => {
    const engine = new StockfishEngine(fakeUci('crash-on-go'));
    await engine.start();
    await expect(engine.evaluate(START_FEN, 16)).rejects.toThrow();
    await engine.quit();
  });

  it('rejects pending search and force-kills an uncooperative child on quit', async () => {
    const engine = new StockfishEngine(fakeUci('hang-on-go'));
    await engine.start();
    const search = engine.evaluate(START_FEN, 16);
    const assertion = expect(search).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await engine.quit();
    await assertion;
    expect(engine.isReady()).toBe(false);
  });

  it('rejects newline injection before issuing any UCI command', async () => {
    const engine = new StockfishEngine(fakeUci('normal'));
    try {
      await engine.start();
      await expect(engine.evaluate(START_FEN + '\nquit', 16)).rejects.toThrow('newline');
      await expect(engine.setOption('Hash\nquit', 64)).rejects.toThrow('newline');
    } finally {
      await engine.quit();
    }
  });
});
