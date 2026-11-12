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

  it('marks a phase beginning on Blacks move after the preceding White SAN', () => {
    const phase = (from_ply: number, to_ply: number) => ({
      from_ply, to_ply, accuracy_white: 0, accuracy_black: 0, acpl_white: 0, acpl_black: 0,
    });
    const html = renderToStaticMarkup(createElement(MoveList, {
      moves, current: 2, onSelect: () => undefined,
      phaseSplit: { opening: phase(1, 1), middlegame: phase(2, 2), endgame: null },
    }));
    const white = html.indexOf('data-review-ply="1"');
    const phaseTitle = html.indexOf('review.middlegame');
    const black = html.indexOf('data-review-ply="2"');
    expect(white).toBeGreaterThan(0);
    expect(phaseTitle).toBeGreaterThan(white);
    expect(black).toBeGreaterThan(phaseTitle);
    expect(html).toContain('<h3');
    expect(html).toContain('review.opening');
  });

  it('respects exact phase boundaries when a setup FEN begins with Black', () => {
    const phase = (from_ply: number, to_ply: number) => ({
      from_ply, to_ply, accuracy_white: 0, accuracy_black: 0, acpl_white: 0, acpl_black: 0,
    });
    const html = renderToStaticMarkup(createElement(MoveList, {
      moves: [...moves, { ply: 3, san: 'Nc6' }, { ply: 4, san: 'Bc4' }],
      current: 3, onSelect: () => undefined,
      startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 12',
      phaseSplit: { opening: phase(1, 2), middlegame: phase(3, 4), endgame: null },
    }));
    const white = html.indexOf('data-review-ply="2"');
    const phaseTitle = html.indexOf('review.middlegame');
    const black = html.indexOf('data-review-ply="3"');
    expect(white).toBeGreaterThan(0);
    expect(phaseTitle).toBeGreaterThan(white);
    expect(black).toBeGreaterThan(phaseTitle);
    expect(html).toContain('12… review.black e4');
  });
});
