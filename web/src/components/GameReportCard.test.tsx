import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AnalyzedMove } from '../types';
import GameReportCard, { countByCls } from './GameReportCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string | number>) => key === 'review.pickCountLabel'
      ? `${vars?.side}/${vars?.classification}/${vars?.count}` : key,
  }),
}));

const samples = [
  { ply: 1, classification: 'mistake' },
  { ply: 2, classification: 'blunder' },
  { ply: 3, classification: 'mistake' },
] as unknown as AnalyzedMove[];

describe('Game Review classification counts from FEN starts', () => {
  it('gives count buttons a classification- and side-specific accessible name', () => {
    const markup = renderToStaticMarkup(createElement(GameReportCard, {
      whiteName: 'White', blackName: 'Black', accuracyW: 80, accuracyB: 70,
      eloW: null, eloB: null, perfW: null, perfB: null,
      moves: samples, onPick: () => {},
    }));
    expect(markup).toContain('aria-label="review.black/classification.blunder/1"');
    expect(markup).toContain('aria-label="review.white/classification.mistake/2"');
    expect(markup).toContain('h-11 w-11');
    expect(markup).toContain('min-h-11');
    expect(markup).not.toContain('title="Show these moves"');
  });
  it('counts normal White-first game moves by their actual side', () => {
    expect(countByCls(samples, 'white').mistake).toBe(2);
    expect(countByCls(samples, 'white').blunder).toBe(0);
    expect(countByCls(samples, 'black').blunder).toBe(1);
  });

  it('counts Black-first moves without reassigning the player', () => {
    const fen = '8/8/8/8/8/8/8/K6k b - - 0 12';
    expect(countByCls(samples, 'black', fen).mistake).toBe(2);
    expect(countByCls(samples, 'black', fen).blunder).toBe(0);
    expect(countByCls(samples, 'white', fen).blunder).toBe(1);
  });
});
