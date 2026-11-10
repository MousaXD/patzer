import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { GameReviewProse } from './GameReportPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../lib/markdown', () => ({
  renderMarkdown: (value: string) => value,
  stripReasoning: (value: string) => value,
}));
import GameReportPanel from './GameReportPanel';

const review = {
  version: 1,
  language: 'en',
  audience: 'player',
  opening: null,
  summary: 'A close game',
  skill_assessment: 'Steady play',
  phases: { opening: null, middlegame: null, endgame: null },
  key_moments: [{
    ply: 1, side: 'black', san: 'Nf6', classification: 'mistake',
    cp_loss: 20, win_pct_delta: 1, best_san: 'Nc6',
    title: 'Black develops', prose: 'Black chose Nf6.',
  }],
} as GameReviewProse;

describe('Game Review AI report for a Black-first PGN', () => {
  it('shows absolute notation and the correct owner of the first move', () => {
    const html = renderToStaticMarkup(createElement(GameReportPanel, {
      gameId: 1,
      initial: review,
      userColor: 'black',
      startFen: '8/8/8/8/8/8/8/K6k b - - 0 12',
    }));
    expect(html).toContain('#12…');
    expect(html).toContain('review.why.yourMove');
    expect(html).not.toContain('#1…');
  });

  it('preserves usual White-first numbering', () => {
    const html = renderToStaticMarkup(createElement(GameReportPanel, {
      gameId: 1, initial: review, userColor: 'white',
    }));
    expect(html).toContain('#1.');
    expect(html).toContain('review.why.yourMove');
  });
});
