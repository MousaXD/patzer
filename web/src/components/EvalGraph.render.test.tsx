import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import EvalGraph from './EvalGraph';

describe('Game Review evaluation graph marker rendering', () => {
  it('uses the translated unavailable-evaluation label for an unscored current ply', () => {
    const html = renderToStaticMarkup(createElement(EvalGraph, {
      evals: [{ ply: 1, cp: null }, { ply: 2, cp: 120 }],
      current: 1,
      onClick: () => undefined,
    }));
    expect(html).toContain('aria-valuetext="review.variationEvalUnavailable"');
    expect(html).not.toContain('Evaluation unavailable');
    expect(html).not.toContain('aria-valuetext="0.00"');
  });
  it('uses non-interactive, fixed-pixel circular markers for scored points only', () => {
    const html = renderToStaticMarkup(createElement(EvalGraph, {
      evals: [{ ply: 1, cp: null }, { ply: 2, cp: 100 }, { ply: 3, cp: -120 }],
      current: 2,
      onClick: () => undefined,
      markers: [
        { ply: 1, classification: 'miss' },
        { ply: 2, classification: 'brilliant' },
        { ply: 3, classification: 'mistake' },
      ],
    }));
    expect((html.match(/data-eval-graph-marker/g) ?? []).length).toBe(2);
    expect((html.match(/data-eval-graph-sample/g) ?? []).length).toBe(2);
    expect((html.match(/data-eval-graph-current/g) ?? []).length).toBe(1);
    expect(html).toContain('h-3 w-3');
    expect(html).toContain('h-2.5 w-2.5');
    expect(html).toContain('pointer-events-none');
    expect(html).toContain('data-ply="2"');
    expect(html).toContain('role="slider"');
    expect(html).not.toContain('<circle');
    expect(html).toContain('aria-hidden="true"');
  });
});
