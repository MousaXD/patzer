import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import ReviewClassificationGuide from './ReviewClassificationGuide';

describe('Review move symbol guide', () => {
  it('explains only the real classifications observed in a saved game', () => {
    const html = renderToStaticMarkup(createElement(ReviewClassificationGuide, {
      moves: [{ classification: 'blunder' }, { classification: 'best' },
        { classification: 'best' }, { classification: 'unknown' }],
    }));
    expect(html).toContain('data-review-classification-guide');
    expect(html).toContain('review.moveSymbolGuide');
    expect(html).toContain('min-h-11');
    expect(html).toContain('classification.best');
    expect(html).toContain('classification.blunder');
    expect(html).not.toContain('classification.brilliant');
    expect(html).not.toContain('classification.unknown');
    expect(html.indexOf('classification.best')).toBeLessThan(html.indexOf('classification.blunder'));
    expect((html.match(/<li /g) ?? [])).toHaveLength(2);
  });

  it('does not imply a classification when no saved move has engine evidence', () => {
    expect(renderToStaticMarkup(createElement(ReviewClassificationGuide, {
      moves: [{ classification: undefined }, {}],
    }))).toBe('');
  });
});
