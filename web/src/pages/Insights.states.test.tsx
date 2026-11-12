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
  it('opens general tactics rather than promising personal puzzles when analyzed games have no playable mistakes', async () => {
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/achievements') return Promise.resolve({ achievements: [] });
      return Promise.resolve({
        games_total: 2, games_analyzed: 2, personal_puzzle_positions: false,
        activity_heatmap: [], rating_trajectory: {}, time_class_stats: {},
        opening_repertoire: [], accuracy_trend: [],
        phase_accuracy: { opening: 0, middlegame: 0, endgame: 0 },
        mistake_taxonomy: {
          hung_pieces: 1, one_move_blunders: 0, back_rank: 0, missed_mate: 0,
          opening_pitfalls: 0, endgame_drift: 0, promising_to_losing: 0,
        },
      });
    });
    mount();
    expect(await screen.findByText('Your next chess step')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Practice my positions' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Try tactical puzzles' }).getAttribute('href')).toBe('/train?tab=puzzles');
  });

  it('offers personal training only when a current analyzed position has a playable solution', async () => {
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/achievements') return Promise.resolve({ achievements: [] });
      return Promise.resolve({
        games_total: 1, games_analyzed: 1, personal_puzzle_positions: true,
        activity_heatmap: [], rating_trajectory: {}, time_class_stats: {},
        opening_repertoire: [], accuracy_trend: [],
        phase_accuracy: { opening: 0, middlegame: 0, endgame: 0 },
        mistake_taxonomy: {},
      });
    });
    mount();
    expect(await screen.findByText('Your next chess step')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Explore my positions' }).getAttribute('href')).toBe('/train');
    expect(screen.queryByRole('link', { name: 'Try tactical puzzles' })).toBeNull();
  });

  it('labels opening-phase mistakes without inventing a move-15 cutoff or a specific trap', async () => {
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/achievements') return Promise.resolve({ achievements: [] });
      return Promise.resolve({
        games_total: 1, games_analyzed: 1, activity_heatmap: [], rating_trajectory: {},
        time_class_stats: {}, opening_repertoire: [], accuracy_trend: [],
        phase_accuracy: { opening: 70, middlegame: 0, endgame: 0 },
        phase_samples: { opening: 1, middlegame: 0, endgame: 0 },
        mistake_taxonomy: {
          hung_pieces: 0, one_move_blunders: 0, back_rank: 0, missed_mate: 0,
          opening_pitfalls: 1, endgame_drift: 0, promising_to_losing: 0,
        },
      });
    });
    mount();
    expect(await screen.findByText('Your next chess step')).toBeTruthy();
    expect(screen.getAllByText('Opening mistakes')).toHaveLength(2);
    expect(screen.getByText('Mistakes in positions classified as the opening phase.')).toBeTruthy();
    expect(screen.queryByText('Opening pitfalls')).toBeNull();
    expect(screen.queryByText('Mistakes before move 15')).toBeNull();
  });

  it('describes centipawn evaluation losses without claiming a player hung material', async () => {
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/achievements') return Promise.resolve({ achievements: [] });
      return Promise.resolve({
        games_total: 1, games_analyzed: 1, activity_heatmap: [], rating_trajectory: {},
        time_class_stats: {}, opening_repertoire: [], accuracy_trend: [],
        phase_accuracy: { opening: 0, middlegame: 0, endgame: 0 },
        mistake_taxonomy: {
          hung_pieces: 1, one_move_blunders: 0, back_rank: 0, missed_mate: 0,
          opening_pitfalls: 0, endgame_drift: 0, promising_to_losing: 0,
        },
      });
    });
    mount();
    expect(await screen.findByText('Your next chess step')).toBeTruthy();
    expect(screen.getAllByText('High-cost mistakes')).toHaveLength(2);
    const explanation = screen.getByText('Moves losing ≥2 pawns of engine evaluation, not necessarily material.');
    expect(explanation.classList.contains('truncate')).toBe(false);
    expect(explanation.className).toContain('break-words');
    expect(screen.queryByText('Hung pieces')).toBeNull();
    expect(screen.queryByText(/material lost/i)).toBeNull();
  });

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
        games_total: 8, games_analyzed: 3, personal_puzzle_positions: true, activity_heatmap: [], rating_trajectory: {},
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
    expect(screen.getAllByText('Opening mistakes').length).toBeGreaterThan(0);
    // The test translation mock returns default templates verbatim.
    expect(screen.getByText(/tagged moves across your analyzed games/)).toBeTruthy();
    expect(screen.getByText('Not measured')).toBeTruthy();
    expect(screen.queryByText('0.0%')).toBeNull();
    expect(screen.getByRole('link', { name: 'Explore my positions' }).getAttribute('href')).toBe('/train');
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

  it('labels an accuracy history by analyzed-game count and recorded period', async () => {
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/achievements') return Promise.resolve({ achievements: [] });
      return Promise.resolve({
        games_total: 14, games_analyzed: 3, activity_heatmap: [], rating_trajectory: {},
        time_class_stats: {}, opening_repertoire: [], mistake_taxonomy: {},
        phase_accuracy: { opening: 0, middlegame: 0, endgame: 0 },
        accuracy_trend: [
          { t: '2026-10-01T12:00:00Z', acc: 52.5, result: 'loss' },
          { t: '2026-10-16T12:00:00Z', acc: 70.5, result: 'win' },
          { t: '2026-11-12T12:00:00Z', acc: 75, result: 'draw' },
        ],
      });
    });
    mount();
    expect(await screen.findByText('3 analyzed games')).toBeTruthy();
    expect(screen.getByText('avg 66.0%')).toBeTruthy();
    expect(screen.getByText('Each point is one of your latest analyzed games. The average covers only the games shown; changes between individual games do not automatically mean you are improving or declining.')).toBeTruthy();
    expect(screen.getByText('Draw / unknown')).toBeTruthy();
    expect(screen.getByText('Oct 1, 2026')).toBeTruthy();
    expect(screen.getByText('Nov 12, 2026')).toBeTruthy();
  });

  it('does not draw a misleading accuracy trend from a single analyzed game', async () => {
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/achievements') return Promise.resolve({ achievements: [] });
      return Promise.resolve({
        games_total: 1, games_analyzed: 1, activity_heatmap: [], rating_trajectory: {},
        time_class_stats: {}, opening_repertoire: [], mistake_taxonomy: {},
        phase_accuracy: { opening: 0, middlegame: 0, endgame: 0 },
        accuracy_trend: [{ t: '2026-11-12T12:00:00Z', acc: 72.4, result: 'win' }],
      });
    });
    mount();
    expect(await screen.findByText('1 analyzed game')).toBeTruthy();
    expect(screen.getByText('One analyzed game is not enough to show an accuracy trend.')).toBeTruthy();
    const chart = screen.getByRole('img', { name: 'Accuracy trend across analyzed games' });
    expect(chart.querySelectorAll('circle')).toHaveLength(1);
    expect(chart.querySelectorAll('path')).toHaveLength(0);
  });

  it('does not paint unclassified outcomes as losses or hide unknown time controls', async () => {
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/achievements') return Promise.resolve({ achievements: [] });
      return Promise.resolve({
        games_total: 13, games_analyzed: 2, activity_heatmap: [], rating_trajectory: {},
        opening_repertoire: [], mistake_taxonomy: {}, accuracy_trend: [],
        phase_accuracy: { opening: 0, middlegame: 0, endgame: 0 },
        time_class_stats: {
          rapid: { games: 10, wins: 4, draws: 2, losses: 3, analyzed_games: 2, accuracy_games: 1, avg_accuracy: 76.4 },
          other: { games: 3, wins: 2, draws: 0, losses: 1, analyzed_games: 0, accuracy_games: 0, avg_accuracy: null },
        },
      });
    });
    mount();
    expect(await screen.findByText('Accuracy 76.4% · 1 measured game')).toBeTruthy();
    expect(screen.getByText('Other / unspecified')).toBeTruthy();
    expect(screen.getByText('1 other result')).toBeTruthy();
    expect(screen.getByText('Accuracy not measured')).toBeTruthy();
    const rapidBar = screen.getByRole('img', { name: '10 results: 4 wins, 2 draws, 3 losses, 1 other results' });
    const segments = rapidBar.querySelectorAll<HTMLElement>('div');
    expect(Array.from(segments).map((e) => e.style.width)).toEqual(['40%', '20%', '30%']);
    expect(screen.getByText('Results count saved games with a recorded outcome. Accuracy is averaged only over games with measured player-side analysis; other outcomes are not losses.')).toBeTruthy();
  });
});
