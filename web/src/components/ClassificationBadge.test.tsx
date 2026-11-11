import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ClassificationBadge, { markerGeometry } from './ClassificationBadge';
import { CLASS_STYLE, GLYPH_SVG, qualityMatchesPosition, styleFor } from '../lib/classification';
import ClassificationIcon, { MOVE_ICON_SOURCES } from './ClassificationIcon';

const render = (props: Parameters<typeof ClassificationBadge>[0]) => renderToStaticMarkup(createElement(ClassificationBadge, props));

describe('move-quality SVG badge', () => {
  it('uses all ten approved SVGs and preserves the existing brilliant glyph', () => {
    expect(Object.keys(CLASS_STYLE)).toHaveLength(11);
    for (const [classification, style] of Object.entries(CLASS_STYLE)) {
      expect(GLYPH_SVG[style.glyph]).toBeDefined();
      const markup = render({ classification, square: 'e4' });
      expect(markup).toContain('role="img"');
      if (classification === 'brilliant') {
        expect(markup).toContain('<svg');
      } else {
        const source = MOVE_ICON_SOURCES[classification as keyof typeof MOVE_ICON_SOURCES];
        expect(source).toBeDefined();
        expect(markup).toContain('<img');
        expect(markup).toContain(source);
      }
      expect(markup).not.toContain('<text');
      expect(markup).not.toContain('font-family');
      expect(markup).not.toContain('fontFamily');
    }
    expect(Object.keys(MOVE_ICON_SOURCES)).toHaveLength(10);
  });

  it('renders the approved orange question-mark SVG without duplicating a badge circle', () => {
    const html = render({ classification: 'mistake', square: 'e4' });
    expect(CLASS_STYLE.mistake.hex).toBe('#ef904e');
    expect(html).toContain(MOVE_ICON_SOURCES.mistake);
    expect(html).not.toContain('#262626');
    expect(html).toContain('mistake move to e4');
    expect(html).toContain('pointer-events-none');
  });

  it('keeps SVG assets decorative while labels remain on their surrounding controls', () => {
    const html = renderToStaticMarkup(createElement(ClassificationIcon, { classification: 'best', size: 24 }));
    expect(html).toContain(MOVE_ICON_SOURCES.best);
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('draggable="false"');
  });

  it('mirrors coordinates correctly when the board is flipped', () => {
    expect(markerGeometry('a1', 'white', 'md')).toMatchObject({ squareLeft: 0, squareTop: 87.5 });
    expect(markerGeometry('a1', 'black', 'md')).toMatchObject({ squareLeft: 87.5, squareTop: 0 });
    expect(markerGeometry('h8', 'white', 'md')).toMatchObject({ squareLeft: 87.5, squareTop: 0 });
    expect(markerGeometry('h8', 'black', 'md')).toMatchObject({ squareLeft: 0, squareTop: 87.5 });
  });

  it('stays within board edges, scales in percentages and remains click-through', () => {
    for (const orientation of ['white', 'black'] as const) {
      for (const square of ['a1', 'h1', 'a8', 'h8', 'e4', 'd5']) {
        for (const size of ['sm', 'md'] as const) {
          const p = markerGeometry(square, orientation, size)!;
          expect(p.left).toBeGreaterThanOrEqual(0);
          expect(p.top).toBeGreaterThanOrEqual(0);
          expect(p.left + p.diameter).toBeLessThanOrEqual(100);
          expect(p.top + p.diameter).toBeLessThanOrEqual(100);
          const html = render({ classification: 'blunder', square, orientation, size });
          expect(html).toContain(`width:${p.diameter}%`);
          expect(html).toContain('pointer-events-none');
        }
      }
    }
  });

  it('rejects out-of-board coordinates, unknown classifications, and stale response FENs', () => {
    expect(render({ classification: 'mistake', square: 'z9' })).toBe('');
    expect(render({ classification: '__proto__', square: 'e4' })).toBe('');
    expect(styleFor('__proto__')).toBeNull();
    expect(render({ classification: 'mistake', square: 'e4', evaluatedFenAfter: 'first', activeFen: 'later' })).toBe('');
    expect(render({ classification: 'mistake', square: 'e4', evaluatedFenAfter: 'same', activeFen: 'same' })).not.toBe('');
    expect(qualityMatchesPosition(null, 'any')).toBe(false);
  });

  it('retains destination highlighting unless the integration disables it', () => {
    const html = render({ classification: 'mistake', square: 'e4' });
    expect(html).toContain('inset 0 0 0 2px');
    expect(render({ classification: 'mistake', square: 'e4', highlightDestination: false })).not.toContain('inset 0 0 0 2px');
  });
});
