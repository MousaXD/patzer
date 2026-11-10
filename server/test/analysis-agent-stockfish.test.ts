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

function fakeUci(mode: 'normal' | 'mixed-depth' | 'crash-on-go' | 'crash-on-start' | 'hang-on-go' | 'slow-on-go'): string {
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
