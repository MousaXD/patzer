import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key.replace('classification.', '') }),
}));

import MoveRow from './MoveRow';

function render(current: number, highlight?: Set<number>) {
  return renderToStaticMarkup(createElement(MoveRow, {
    num: 7,
    white: { ply: 13, san: 'Nxf7+', classification: 'brilliant' },
    black: { ply: 14, san: 'Kxf7', classification: 'mistake' },
    current,
    highlight,
    onSelect: () => undefined,
  }));
}

describe('review move row', () => {
  it('marks exactly the selected ply for keyboard and screen-reader navigation', () => {
    const html = render(14);
    expect((html.match(/aria-current="step"/g) ?? []).length).toBe(1);
    expect(html).toContain('aria-label="Kxf7: mistake"');
    expect(html).toContain('aria-label="Nxf7+: brilliant"');
    expect(html).toContain('type="button"');
  });

  it('keeps SVG classification indicators and highlights without Unicode symbols', () => {
    const html = render(13, new Set([14]));
    expect(html).toContain('aria-current="step"');
    expect((html.match(/<svg/g) ?? []).length).toBe(2);
    expect(html).toContain('border-chesscom-900/90');
    expect(html).not.toContain('font-family');
  });

  it('does not attach a glyph to an unclassified exploratory move', () => {
    const html = renderToStaticMarkup(createElement(MoveRow, {
      num: 1, white: { ply: 1, san: 'e4' }, current: 1, onSelect: () => undefined,
    }));
    expect(html).not.toContain('<svg');
    expect(html).toContain('aria-label="e4"');
  });
});
