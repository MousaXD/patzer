import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import EvalBar from './EvalBar';

describe('Game Review evaluation bar', () => {
  it('does not depict a false 50/50 score when Stockfish has no evaluation', () => {
    const html = renderToStaticMarkup(createElement(EvalBar, { cp: null }));
    expect(html).toContain('aria-label="Evaluation unavailable"');
    expect(html).toContain('bg-chesscom-300');
    expect(html).not.toContain('>—</div>');
  });

  it('distinguishes a real balanced evaluation from an unknown one', () => {
    const html = renderToStaticMarkup(createElement(EvalBar, { cp: 0 }));
    expect(html).toContain('aria-label="Evaluation 0.0 for White"');
    expect(html).toContain('0.0');
  });

  it('announces the mating side as well as the number of moves', () => {
    const html = renderToStaticMarkup(createElement(EvalBar, { cp: null, mate: -3 }));
    expect(html).toContain('aria-label="Mate in 3 for Black"');
  });

  it('does not claim checkmate from extreme cp without a source-backed mate count', () => {
    const winning = renderToStaticMarkup(createElement(EvalBar, { cp: 9970, mate: null }));
    const losing = renderToStaticMarkup(createElement(EvalBar, { cp: -9970, mate: null }));
    expect(winning).toContain('aria-label="Evaluation +99.7 for White"');
    expect(losing).toContain('aria-label="Evaluation −99.7 for White"');
    expect(winning).not.toContain('data-review-eval-chip');
    expect(losing).not.toContain('data-review-eval-chip');
    expect(winning).not.toContain('>\u0023</div>');
    expect(losing).not.toContain('>-\u0023</div>');
    const compact = renderToStaticMarkup(createElement(EvalBar, { cp: 70 }));
    expect(compact).toContain('data-review-eval-chip');
  });

  it('allows Game Review to supply localized accessible names without changing score geometry', () => {
    const unknown = renderToStaticMarkup(createElement(EvalBar, {
      cp: null, ariaLabel: 'Evaluación de la posición no disponible',
    }));
    expect(unknown).toContain('aria-label="Evaluación de la posición no disponible"');
    expect(unknown).not.toContain('aria-label="Evaluation unavailable"');
    const mate = renderToStaticMarkup(createElement(EvalBar, {
      cp: -9980, mate: -2, ariaLabel: 'Mate en 2 a favor de las negras',
    }));
    expect(mate).toContain('aria-label="Mate en 2 a favor de las negras"');
    expect(mate).toContain('M2');
  });
});
