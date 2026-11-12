import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

import MoveList from './MoveList';

const moves = [
  { ply: 1, san: 'e4', classification: 'best' },
  { ply: 2, san: 'e5', classification: 'good' },
];

function markup(current: number) {
  return renderToStaticMarkup(createElement(MoveList, {
    moves, current, onSelect: () => undefined,
  }));
}

describe('Game Review move history', () => {
  it('makes the true initial position selectable and announces the current step', () => {
    const html = markup(0);
    expect(html).toContain('role="region"');
    expect(html).toContain('Game move history');
    expect(html).toContain('Starting position');
    expect(html).toContain('min-h-11 w-full');
    expect(html).toContain('data-review-ply="0"');
    expect((html.match(/aria-current="step"/g) ?? []).length).toBe(1);
  });

  it('moves selection into the history without an extra selected starting position', () => {
    const html = markup(2);
    expect((html.match(/aria-current="step"/g) ?? []).length).toBe(1);
    expect(html).toContain('1… review.black e5');
    expect(html).toContain('max-h-[20rem]');
    expect(html).toContain('data-review-ply="2"');
  });

  it('shows the real fullmove number and Black column for a Black-to-move FEN', () => {
    const html = renderToStaticMarkup(createElement(MoveList, {
      moves, current: 1, startFen: '8/8/8/8/8/8/8/K6k b - - 0 12', onSelect: () => undefined,
    }));
    expect(html).toContain('12… review.black e4');
    expect((html.match(/aria-current="step"/g) ?? []).length).toBe(1);
  });

  it('offers a useful empty-state message', () => {
    const html = renderToStaticMarkup(createElement(MoveList, {
      moves: [], current: 0, onSelect: () => undefined,
    }));
    expect(html).toContain('review.noRecordedMoves');
    expect(html).not.toContain('No recorded moves.');
    expect(html).toContain('Starting position');
  });
});
