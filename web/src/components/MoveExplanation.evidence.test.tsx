import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AnalyzedMove } from '../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, number>) =>
      `${key}${options?.before == null ? '' : ` (${options.before}% → ${options.after}%)`}`,
  }),
}));
vi.mock('./CoachPanel', () => ({ default: () => null }));

import MoveExplanation, { moverWinPct, whiteWinPct } from './MoveExplanation';

const move: AnalyzedMove = {
  ply: 15, san: 'Bb3', uci: 'c4b3', classification: 'mistake',
  fen_before: '', fen_after: '', centipawn_loss: 75,
  eval_before_cp: 125, eval_after_cp: -90, best_move_san: 'Bd5',
  best_move_uci: 'c4d5', best_pv: [],
};

const render = (sample: AnalyzedMove, startFen?: string, userColor: 'white' | 'black' | null = 'white') => renderToStaticMarkup(createElement(MoveExplanation, {
  move: sample, userColor, coachConfigured: false, coachRequest: null, startFen,
}));

describe('Game Review win-chance source integrity', () => {
  it('offers an actionable best-move preview only when the parent verified a safe alternative', () => {
    expect(render(move)).not.toContain('data-review-show-best-move');
    const withPreview = renderToStaticMarkup(createElement(MoveExplanation, {
      move, userColor:'white', coachConfigured:false, coachRequest:null,
      onShowBestMove:() => {},
    }));
    expect(withPreview).toContain('data-review-show-best-move');
    expect(withPreview).toContain('review.why.showBestOnBoard');
    const sameMove = renderToStaticMarkup(createElement(MoveExplanation, {
      move: { ...move, best_move_san:move.san }, userColor:'white',
      coachConfigured:false, coachRequest:null, onShowBestMove:()=>{},
    }));
    expect(sameMove).not.toContain('data-review-show-best-move');
  });
  it('shows a compact truthful coaching-unavailable note without a nested empty coach card', () => {
    const html=render(move);
    expect(html).toContain('data-review-coach-unavailable');
    expect(html).toContain('review.why.coachUnavailable');
    expect(html).not.toContain('review.why.coachSays');
    expect(html).not.toContain('coach.notConfigured');
  });

  it('keeps the configured AI coaching surface and suppresses the unavailable note', () => {
    const html=renderToStaticMarkup(createElement(MoveExplanation, {
      move, userColor:'white', coachConfigured:true, coachRequest:null,
    }));
    expect(html).toContain('review.why.coachSays');
    expect(html).not.toContain('data-review-coach-unavailable');
  });

  it('keeps real numerical evaluations and the existing point-of-view formula', () => {
    expect(whiteWinPct(0)).toBeCloseTo(50);
    expect(whiteWinPct(9000)).toBe(100);
    expect(whiteWinPct(-9000)).toBe(0);
    const white = moverWinPct(move);
    expect(white).not.toBeNull();
    expect(white!.drop).toBe(Math.max(0, white!.before - white!.after));
    const black = moverWinPct({ ply: 2, eval_before_cp: 100, eval_after_cp: -100 });
    expect(black!.before).toBeLessThan(black!.after);
    expect(render(move)).toContain('review.why.mistake');
  });

  it.each([
    { eval_before_cp: null, eval_after_cp: 75 },
    { eval_before_cp: 75, eval_after_cp: null },
    { eval_before_cp: null, eval_after_cp: null },
    { eval_before_cp: Number.NaN, eval_after_cp: 75 },
  ])('never substitutes 50% for an absent/nonfinite score: %j', (scores) => {
    const incomplete = { ...move, ...scores };
    expect(moverWinPct(incomplete)).toBeNull();
    const html = render(incomplete);
    expect(html).toContain('review.why.evaluationUnavailable');
    expect(html).not.toContain('review.why.mistake');
    expect(html).not.toContain('review.why.winChance');
    expect(html).not.toContain('50%');
    expect(html).not.toContain('NaN');
  });

  it.each(['book', 'best', 'forced'] as const)('retains evidence-independent %s explanations', (classification) => {
    const html = render({ ...move, classification, eval_before_cp: null, eval_after_cp: null });
    expect(html).toContain(`review.why.${classification}`);
    expect(html).not.toContain('review.why.evaluationUnavailable');
    expect(html).not.toContain('review.why.winChance');
  });

  it('uses the real mover and fullmove number for Black-first FEN games', () => {
    const blackFirst = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 12';
    const first = { ...move, ply: 1, san: 'e5', eval_before_cp: 100, eval_after_cp: -100 };
    const black = moverWinPct(first, blackFirst);
    expect(black!.before).toBeLessThan(black!.after);
    const html = render(first, blackFirst, null);
    expect(html).toContain('12…e5');
    expect(html).toContain('review.why.blackMove');
    expect(html).not.toContain('review.why.whiteMove');
    const second = render({ ...first, ply: 2, san: 'e4' }, blackFirst, null);
    expect(second).toContain('13.e4');
    expect(second).toContain('review.why.whiteMove');
  });
});
