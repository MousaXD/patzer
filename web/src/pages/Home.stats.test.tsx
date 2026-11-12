// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  get: vi.fn(), learnProgress: vi.fn(), today: '2026-11-10',
  displayName: 'Player', avatarEmoji: '♟',
}));
// Unit tests only exercise loading, errors and retry. Disable motion wrappers
// here so happy-dom does not reject pending Web Animations on unmount.
vi.mock('framer-motion', async () => {
  const { createElement } = await import('react');
  const staticElement = (tag: 'div' | 'section') =>
    ({ initial: _initial, animate: _animate, transition: _transition,
      variants: _variants, custom: _custom, ...props }: Record<string, unknown>) =>
      createElement(tag, props);
  return { useReducedMotion: () => true, motion: { div: staticElement('div'), section: staticElement('section') } };
});
vi.mock('../api', () => ({ api: { get: mocks.get } }));
vi.mock('../state/auth', () => ({
  useAuth: () => ({
    user: { id: 7, username: 'sample-player',
      profile: { display_name: mocks.displayName, avatar_emoji: mocks.avatarEmoji } },
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));
vi.mock('./Learn', () => ({
  useLearnContent: () => ({ cur: null }),
  fetchLearnProgress: mocks.learnProgress,
  suggestedLesson: () => null,
}));
vi.mock('../components/learn/LessonPlayer', () => ({ LEARN_QUERY_KEY: ['learn-progress'] }));
vi.mock('../lib/openingTrainer', () => ({ localDay: () => mocks.today }));

import Home from './Home';

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><Home /></MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mocks.today = '2026-11-10';
  mocks.displayName = 'Player';
  mocks.avatarEmoji = '♟';
  mocks.learnProgress.mockResolvedValue({ lessons: [] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Home statistics failure', () => {
  it('shows a recognizable first-run identity and touch-sized hero actions when profile fields are blank', () => {
    mocks.displayName = '   ';
    mocks.avatarEmoji = '';
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/stats/me') return Promise.resolve({ total: 0, wins: 0, losses: 0, draws: 0, avg_accuracy: null, streak: null });
      if (url.startsWith('/api/games')) return Promise.resolve({ games: [] });
      if (url === '/api/plan') return Promise.resolve({ goals: [] });
      if (url === '/api/achievements') return Promise.resolve({ achievements: [] });
      if (url.startsWith('/api/tactics/daily')) return Promise.resolve({ puzzle: null, done: null, streak: 0 });
      return Promise.resolve({});
    });

    mount();
    const name = screen.getByRole('heading', { level: 1, name: 'sample-player' });
    expect(name.parentElement?.previousElementSibling?.textContent).toBe('♟');
    const hero = name.closest('section');
    for (const path of ['/play', '/review']) {
      const action = hero?.querySelector<HTMLAnchorElement>(`a[href="${path}"]`);
      expect(action?.className).toContain('min-h-11');
    }
  });

  it('keeps recent-game navigation and View all accessible on small touch screens', async () => {
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/stats/me') return Promise.resolve({ total: 1, wins: 1, losses: 0, draws: 0, avg_accuracy: null, streak: null });
      if (url.startsWith('/api/games')) return Promise.resolve({ games: [{
        id: 103, white: 'sample-player', black: 'OpponentWithALongName',
        user_color: 'white', end_time: '2026-11-12T12:00:00Z',
        result: 'win', time_control: '600', analyzed: false,
      }] });
      if (url === '/api/plan') return Promise.resolve({ goals: [] });
      if (url === '/api/achievements') return Promise.resolve({ achievements: [] });
      if (url.startsWith('/api/tactics/daily')) return Promise.resolve({ puzzle: null, done: null, streak: 0 });
      return Promise.resolve({});
    });

    mount();
    const viewAll = await screen.findByRole('link', { name: /View all/ });
    expect(viewAll.getAttribute('href')).toBe('/review');
    expect(viewAll.className).toContain('min-h-11');
    expect(screen.getByRole('link', { name: /OpponentWithALongName/ }).getAttribute('href')).toBe('/review/103');
  });

  it('shows a retryable error instead of the no-games tagline after a failed stats request', async () => {
    let offline = true;
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/stats/me') return offline
        ? Promise.reject(new Error('unavailable'))
        : Promise.resolve({
            total: 42, wins: 25, losses: 12, draws: 5,
            avg_accuracy: 78, streak: null,
          });
      if (url.startsWith('/api/games')) return Promise.resolve({ games: [] });
      if (url === '/api/plan') return Promise.resolve({ goals: [] });
      if (url === '/api/achievements') return Promise.resolve({ achievements: [] });
      if (url.startsWith('/api/tactics/daily')) return Promise.resolve({ puzzle: null, done: null, streak: 0 });
      return Promise.resolve({});
    });

    mount();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Your statistics could not be loaded.');
    expect(screen.queryByText('app.tagline')).toBeNull();

    offline = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('42')).toBeTruthy();
    expect(screen.queryByText('Your statistics could not be loaded.')).toBeNull();
  });

  it('does not disguise failed plan, achievement or daily-puzzle requests as first-time onboarding', async () => {
    const offline = { plan: true, achievements: true, puzzle: true };
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/stats/me') return Promise.resolve({ total: 9, wins: 5, losses: 2, draws: 2, avg_accuracy: null, streak: null });
      if (url.startsWith('/api/games')) return Promise.resolve({ games: [] });
      if (url === '/api/plan') return offline.plan ? Promise.reject(new Error('offline')) : Promise.resolve({ goals: [] });
      if (url === '/api/achievements') return offline.achievements ? Promise.reject(new Error('offline')) : Promise.resolve({ achievements: [] });
      if (url.startsWith('/api/tactics/daily')) return offline.puzzle ? Promise.reject(new Error('offline')) : Promise.resolve({ puzzle: null, done: null, streak: 0 });
      return Promise.resolve({});
    });

    mount();
    await waitFor(() => expect(screen.getAllByText('Progress temporarily unavailable')).toHaveLength(3));
    expect(screen.queryByText('Build your first improvement plan')).toBeNull();
    expect(screen.queryByText('Earn your first badge')).toBeNull();

    offline.plan = false;
    fireEvent.click(screen.getByRole('button', { name: "Retry This week's plan" }));
    expect(await screen.findByText('Build your first improvement plan')).toBeTruthy();

    offline.achievements = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry Achievements' }));
    expect(await screen.findByText('Earn your first badge')).toBeTruthy();

    offline.puzzle = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry home.todayPuzzle' }));
    await waitFor(() => expect(screen.queryByText('Progress temporarily unavailable')).toBeNull());
  });

  it('shows the learning-progress outage and retries without resetting the level to zero', async () => {
    mocks.learnProgress.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ lessons: [] });
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/stats/me') return Promise.resolve({ total: 5, wins: 2, losses: 2, draws: 1, avg_accuracy: null, streak: null });
      if (url.startsWith('/api/games')) return Promise.resolve({ games: [] });
      if (url === '/api/plan') return Promise.resolve({ goals: [] });
      if (url === '/api/achievements') return Promise.resolve({ achievements: [] });
      if (url.startsWith('/api/tactics/daily')) return Promise.resolve({ puzzle: null, done: null, streak: 0 });
      return Promise.resolve({});
    });
    mount();
    expect(await screen.findByRole('button', { name: 'Retry learn.nav' })).toBeTruthy();
    expect(screen.queryByText('learn.levelShort')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry learn.nav' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry learn.nav' })).toBeNull());
  });

  it('fetches a new daily puzzle when the local day changes without reusing old cache', async () => {
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/stats/me') return Promise.resolve({ total: 5, wins: 3, losses: 2, draws: 0, avg_accuracy: null, streak: null });
      if (url.startsWith('/api/games')) return Promise.resolve({ games: [] });
      if (url === '/api/plan') return Promise.resolve({ goals: [] });
      if (url === '/api/achievements') return Promise.resolve({ achievements: [] });
      if (url.startsWith('/api/tactics/daily')) return Promise.resolve({ puzzle: { id: 'daily', rating: 900 }, done: null, streak: 0 });
      return Promise.resolve({});
    });
    mount();
    await waitFor(() => expect(mocks.get.mock.calls.some(([url]) => String(url).endsWith('today=2026-11-10'))).toBe(true));
    mocks.today = '2026-11-11';
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(mocks.get.mock.calls.some(([url]) => String(url).endsWith('today=2026-11-11'))).toBe(true));
  });
});
