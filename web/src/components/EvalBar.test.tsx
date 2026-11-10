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
});
