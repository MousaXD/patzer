import { Chess } from 'chess.js';
import { describe, expect, it, vi } from 'vitest';
import type { AnalysisEngine } from '../src/chess/engine.js';
import type { EngineMultiEval } from '../src/chess/stockfish.js';
import { scoreVariationMove, VariationScoringError } from '../src/chess/variationScoring.js';

function evaluation(cp: number | null, bestMoveUci: string | null, options: {
  mate?: number | null;
  alternate?: number;
  pv?: string[];
} = {}): EngineMultiEval {
  const pv = options.pv ?? (bestMoveUci ? [bestMoveUci] : []);
  return {
    cp, mate: options.mate ?? null, bestMoveUci, pv, depth: 16,
    candidates: [
      { cp, mate: options.mate ?? null, pv, multipv: 1 },
      ...(options.alternate === undefined ? [] : [{ cp: options.alternate, mate: null, pv: [], multipv: 2 }]),
    ],
  };
}

function stubEngine(evals: EngineMultiEval[]) {
  const evaluateMulti = vi.fn(async () => {
    const e = evals.shift();
    if (!e) throw new Error('missing fixture evaluation');
    return e;
  });
  const quit = vi.fn(async () => undefined);
  const start = vi.fn(async () => undefined);
  const engine = {
    kind: 'local', start, quit, evaluateMulti,
    setOption: vi.fn(async () => undefined),
    newGame: vi.fn(async () => undefined),
  } as unknown as AnalysisEngine;
  return { engine, evaluateMulti, quit, start };
}

const START = new Chess().fen();

// The only classification authority is server/src/chess/classifier.ts.
describe('variation scoring', () => {
  it('classifies engine #1 as best in ordinary opening exploration, NOT Book or Brilliant', async () => {
    const fake = stubEngine([evaluation(50, 'e2e4', { alternate: 10 }), evaluation(-50, 'e7e5')]);
    const result = await scoreVariationMove({ fen_before: START, move_uci: 'e2e4', depth: 16 }, () => fake.engine);
    expect(result.classification).toBe('best');
    expect(result.is_best).toBe(true);
    expect(result.eval_before_cp).toBe(50);
    expect(result.eval_after_cp).toBe(50);
    expect(result.san).toBe('e4');
    expect(result.to).toBe('e4');
    expect(result.best_move_san).toBe('e4');
    expect(result.source).toBe('variation');
    expect(fake.evaluateMulti).toHaveBeenCalledTimes(2);
    expect(fake.quit).toHaveBeenCalledTimes(1);
  });

  it('detects a severe alternative loss from White perspective', async () => {
    const fake = stubEngine([evaluation(0, 'e2e4', { alternate: -20 }), evaluation(500, 'e7e5')]);
    const result = await scoreVariationMove({ fen_before: START, move_uci: 'a2a3', depth: 16 }, () => fake.engine);
    expect(result.classification).toBe('blunder');
    expect(result.eval_after_cp).toBe(-500);
    expect(result.centipawn_loss).toBe(500);
    expect(result.best_move_uci).toBe('e2e4');
  });

  it('handles Black perspective without reversing the quality decision', async () => {
    const pos = new Chess(); pos.move('e4');
    const fake = stubEngine([evaluation(0, 'e7e5', { alternate: -20 }), evaluation(500, 'g1f3')]);
    const result = await scoreVariationMove({ fen_before: pos.fen(), move_uci: 'a7a6', depth: 16 }, () => fake.engine);
    expect(result.classification).toBe('blunder');
    expect(result.eval_after_cp).toBe(500); // White perspective, Black has blundered.
    expect(result.centipawn_loss).toBe(500);
    expect(result.ply).toBe(2);
  });

  it('uses the existing great-move rule only for literal engine best with >=200cp candidate gap', async () => {
    const fake = stubEngine([evaluation(210, 'e2e4', { alternate: 0 }), evaluation(-210, 'e7e5')]);
    const result = await scoreVariationMove({ fen_before: START, move_uci: 'e2e4', depth: 16, ply: 15 }, () => fake.engine);
    expect(result.classification).toBe('great');
    expect(result.candidate_count).toBe(2);
  });

  it('never claims Great from a near-best alternative', async () => {
    const fake = stubEngine([evaluation(210, 'e2e4', { alternate: 0 }), evaluation(-200, 'e7e5')]);
    const result = await scoreVariationMove({ fen_before: START, move_uci: 'd2d4', depth: 16, ply: 15 }, () => fake.engine);
    expect(['great', 'brilliant']).not.toContain(result.classification);
  });

  it('does not misclassify a continuing forced mate as a blunder', async () => {
    const fake = stubEngine([
      evaluation(null, 'e2e4', { mate: 3 }),
      evaluation(null, 'e7e5', { mate: -2 }),
    ]);
    const result = await scoreVariationMove({ fen_before: START, move_uci: 'e2e4', depth: 16, ply: 15 }, () => fake.engine);
    expect(result.centipawn_loss).toBe(0);
    expect(result.win_pct_drop).toBe(0);
    expect(result.classification).toBe('best');
  });

  it('recognizes a missed winning mate', async () => {
    const fake = stubEngine([
      evaluation(null, 'e2e4', { mate: 3 }), evaluation(0, 'e7e5'),
    ]);
    const result = await scoreVariationMove({ fen_before: START, move_uci: 'a2a3', depth: 16, ply: 15 }, () => fake.engine);
    expect(result.classification).toBe('miss');
    expect(result.mate_before).toBe(3);
  });

  it('treats checkmate as terminal without asking the engine to search an impossible continuation', async () => {
    const pos = new Chess();
    for (const san of ['f3', 'e5', 'g4']) pos.move(san);
    const fake = stubEngine([evaluation(999, 'd8h4', { mate: 1 })]);
    const result = await scoreVariationMove({ fen_before: pos.fen(), move_uci: 'd8h4', depth: 16 }, () => fake.engine);
    expect(result.terminal).toBe('checkmate');
    expect(result.classification).toBe('best');
    expect(result.eval_after_cp).toBe(-10000); // White loses; Black delivers mate.
    expect(result.depth_after).toBeNull();
    expect(fake.evaluateMulti).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid positions/moves before ever starting the engine', async () => {
    const factory = vi.fn(() => stubEngine([]).engine);
    await expect(scoreVariationMove({ fen_before: 'invalid', move_uci: 'e2e4', depth: 16 }, factory)).rejects.toMatchObject({ code: 'invalid_fen' });
    await expect(scoreVariationMove({ fen_before: START, move_uci: 'e2e5', depth: 16 }, factory)).rejects.toMatchObject({ code: 'invalid_move' });
    await expect(scoreVariationMove({ fen_before: START, move_uci: 'bad', depth: 16 }, factory)).rejects.toMatchObject({ code: 'invalid_move' });
    expect(factory).not.toHaveBeenCalled();
  });

  it('cleans up engine resources on analysis errors', async () => {
    const fake = stubEngine([evaluation(0, 'e2e4')]);
    await expect(scoreVariationMove({ fen_before: START, move_uci: 'e2e4', depth: 16 }, () => fake.engine)).rejects.toThrow('missing fixture evaluation');
    expect(fake.quit).toHaveBeenCalledOnce();
  });

  it('times out a stuck engine and calls its shutdown', async () => {
    const quit = vi.fn(async () => undefined);
    const engine = {
      kind: 'local', start: async () => undefined, quit, newGame: async () => undefined,
      setOption: async () => undefined, evaluateMulti: () => new Promise<EngineMultiEval>(() => undefined),
    } as unknown as AnalysisEngine;
    await expect(scoreVariationMove({ fen_before: START, move_uci: 'e2e4', depth: 16 }, () => engine, 5))
      .rejects.toMatchObject({ code: 'engine_timeout' } satisfies Partial<VariationScoringError>);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('does not infer a Great move from missing MultiPV rank one', async () => {
    const pre = evaluation(210, 'e2e4');
    pre.candidates = [
      { cp: 210, mate: null, pv: ['e2e4'], multipv: 2 },
      { cp: 0, mate: null, pv: [], multipv: 3 },
    ];
    const fake = stubEngine([pre, evaluation(-210, 'e7e5')]);
    const result = await scoreVariationMove({ fen_before: START, move_uci: 'e2e4', depth: 16, ply: 15 }, () => fake.engine);
    expect(result.classification).toBe('best');
  });

  it('requires explicit UCI promotion and never substitutes an implicit queen', async () => {
    const factory = vi.fn(() => stubEngine([]).engine);
    const fen = '7k/P7/8/8/8/8/8/7K w - - 0 1';
    await expect(scoreVariationMove({ fen_before: fen, move_uci: 'a7a8', depth: 16 }, factory))
      .rejects.toMatchObject({ code: 'invalid_move' });
    expect(factory).not.toHaveBeenCalled();
  });

  it('keeps independent results isolated during rapid exploratory position changes', async () => {
    const first = stubEngine([evaluation(50, 'e2e4'), evaluation(-50, 'e7e5')]);
    const second = stubEngine([evaluation(0, 'e2e4'), evaluation(500, 'e7e5')]);
    const [a, b] = await Promise.all([
      scoreVariationMove({ fen_before: START, move_uci: 'e2e4', depth: 16 }, () => first.engine),
      scoreVariationMove({ fen_before: START, move_uci: 'a2a3', depth: 16 }, () => second.engine),
    ]);
    expect(a.uci).toBe('e2e4');
    expect(b.uci).toBe('a2a3');
    expect(a.fen_after).not.toBe(b.fen_after);
    expect(a.classification).toBe('best');
    expect(b.classification).toBe('blunder');
    expect(first.quit).toHaveBeenCalledOnce();
    expect(second.quit).toHaveBeenCalledOnce();
  });

  it('never invokes a persistence method (exploration is read-only)', async () => {
    const fake = stubEngine([evaluation(50, 'e2e4'), evaluation(-50, 'e7e5')]);
    const result = await scoreVariationMove({ fen_before: START, move_uci: 'e2e4', depth: 16 }, () => fake.engine);
    expect(result.source).toBe('variation');
    expect(Object.keys(fake.engine).sort()).toEqual(['evaluateMulti', 'kind', 'newGame', 'quit', 'setOption', 'start'].sort());
  });
});
