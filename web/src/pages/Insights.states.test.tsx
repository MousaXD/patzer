// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('../api', () => ({ api: { get: mocks.get } }));
vi.mock('../state/auth', () => ({ useAuth: () => ({ user: { id: 7 } }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number>) => {
      const template = String(options?.defaultValue ?? key);
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? `{{${name}}}`));
    },
    i18n: { language: 'en' },
  }),
}));

import Insights from './Insights';

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><Insights /></MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Insights data states', () => {
  it('does not disguise a failed statistics request as no games', async () => {
    let offline = true;
    mocks.get.mockImplementation((url: string) => {
      if (url.includes('/api/achievements')) return Promise.resolve({ achievements: [] });
      return offline
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ games_total: 0, games_analyzed: 0 });
    });
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Insights are temporarily unavailable');
    expect(screen.queryByText('No insights yet')).toBeNull();
    offline = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No insights yet')).toBeTruthy();
  });

  it('treats the achievements failure independently from a valid statistics report', async () => {
    let achievementsOffline = true;
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/achievements') return achievementsOffline
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ achievements: [] });
      return Promise.resolve({
        games_total: 2, games_analyzed: 0,
        activity_heatmap: [], rating_trajectory: {}, time_class_stats: {},
        opening_repertoire: [], mistake_taxonomy: {},
        phase_accuracy: { opening: 0, middlegame: 0, endgame: 0 }, accuracy_trend: [],
      });
    });
    mount();
    expect(await screen.findByText('Achievements could not be loaded.')).toBeTruthy();
    expect(screen.queryByText('Play and analyze games to start earning badges.')).toBeNull();

    achievementsOffline = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Play and analyze games to start earning badges.')).toBeTruthy();
  });

  it('grounds the suggested next step in observed move categories and distinguishes missing phase data', async () => {
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/achievements') return Promise.resolve({ achievements: [] });
      return Promise.resolve({
        games_total: 8, games_analyzed: 3, activity_heatmap: [], rating_trajectory: {},
        time_class_stats: {}, opening_repertoire: [], accuracy_trend: [],
        phase_accuracy: { opening: 72.4, middlegame: 0, endgame: 80.2 },
        phase_samples: { opening: 3, middlegame: 0, endgame: 1 },
        mistake_taxonomy: {
          hung_pieces: 2, one_move_blunders: 0, back_rank: 0, missed_mate: 0,
          opening_pitfalls: 4, endgame_drift: 1, promising_to_losing: 0,
        },
      });
    });
    mount();
    expect(await screen.findByText('Your next chess step')).toBeTruthy();
    expect(screen.getAllByText('Opening pitfalls').length).toBeGreaterThan(0);
    // The test translation mock returns default templates verbatim.
    expect(screen.getByText(/tagged moves across your analyzed games/)).toBeTruthy();
    expect(screen.getByText('Not measured')).toBeTruthy();
    expect(screen.queryByText('0.0%')).toBeNull();
    expect(screen.getByRole('link', { name: 'Practice my positions' }).getAttribute('href')).toBe('/train');
  });

  it('explains historical rating changes and does not invent a trend from one point', async () => {
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/achievements') return Promise.resolve({ achievements: [] });
      return Promise.resolve({
        games_total: 6, games_analyzed: 0, activity_heatmap: [], time_class_stats: {},
        opening_repertoire: [], mistake_taxonomy: {}, accuracy_trend: [],
        phase_accuracy: { opening: 0, middlegame: 0, endgame: 0 },
        rating_trajectory: {
          rapid: [
            { t: '2026-09-01T12:00:00Z', r: 1250 },
            { t: '2026-10-04T12:00:00Z', r: 1310 },
            { t: '2026-11-12T12:00:00Z', r: 1298 },
          ],
          blitz: [{ t: '2026-11-12T12:00:00Z', r: 1050 }],
        },
      });
    });
    mount();
    expect(await screen.findByText('Rating trajectory')).toBeTruthy();
    expect(screen.getByText('+48 since first recorded rating')).toBeTruthy();
    expect(screen.getByText('3 recorded ratings', { exact: false })).toBeTruthy();
    expect(screen.getByText('One rating recorded — no trend to compare')).toBeTruthy();
    expect(screen.getByText('1 recorded rating')).toBeTruthy();
    expect(screen.getByText('Only recorded rating updates appear here. Changes compare the first and last recorded value in each time class.')).toBeTruthy();
  });
});
