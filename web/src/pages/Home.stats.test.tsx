// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  get: vi.fn(), learnProgress: vi.fn(), today: '2026-11-10',
  displayName: 'Player', avatarEmoji: '♟', language: 'en',
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
    i18n: { language: mocks.language },
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
  mocks.language = 'en';
  mocks.displayName = 'Player';
  mocks.avatarEmoji = '♟';
  mocks.learnProgress.mockResolvedValue({ lessons: [] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Home statistics failure', () => {
  it.each([
    ['win', 'Win', 'W', 'text-ui-success'],
    ['loss', 'Loss', 'L', 'text-ui-danger'],
    ['draw', 'Draw', 'D', 'dark:text-ui-mutedText'],
    ['ongoing', 'In progress', '•', 'dark:text-ui-mutedText'],
  ])('announces recent-game %s as %s instead of a bare glyph', async (result, label, symbol, colorClass) => {
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/stats/me') return Promise.resolve({ total: 1, wins: 1, losses: 0, draws: 0, avg_accuracy: null, streak: null });
      if (url.startsWith('/api/games')) return Promise.resolve({ games: [{
        id: 103, white: 'sample-player', black: 'OpponentWithALongName',
        user_color: 'white', end_time: '2026-11-12T12:00:00Z',
        result, time_control: '600', analyzed: false,
      }] });
      if (url === '/api/plan') return Promise.resolve({ goals: [] });
      if (url === '/api/achievements') return Promise.resolve({ achievements: [] });
      if (url.startsWith('/api/tactics/daily')) return Promise.resolve({ puzzle: null, done: null, streak: 0 });
      return Promise.resolve({});
    });
    mount();
    const link = await screen.findByRole('link', { name: /OpponentWithALongName/ });
    expect(link.getAttribute('href')).toBe('/review/103');
    const badge = within(link).getByRole('img', { name: label });
    expect(badge.textContent?.trim()).toBe(symbol);
    expect(badge.getAttribute('title')).toBe(label);
    expect(badge.className).toContain(colorClass);
  });

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
    expect(name.closest('section')?.querySelector('[data-home-hero-avatar]')?.textContent).toBe('♟');
    expect(name.className).toContain('line-clamp-2');
    expect(name.className).toContain('col-span-2');
    const hero = name.closest('section');
    for (const path of ['/play', '/review']) {
      const action = hero?.querySelector<HTMLAnchorElement>(`a[href="${path}"]`);
      expect(action?.className).toContain('min-h-11');
    }
  });

  it('keeps a long first-use display name accessible while allowing two readable lines on phones', () => {
    const name = 'GrandmasterCandidateAccountWithAnExtraordinarilyLongDisplayName2026';
    mocks.displayName = name;
    mocks.get.mockResolvedValue({ games: [], goals: [], achievements: [], total: 0, wins: 0, losses: 0, draws: 0 });
    mount();
    const heading = screen.getByRole('heading', { level: 1, name });
    expect(heading.getAttribute('title')).toBe(name);
    expect(heading.className).toContain('line-clamp-2');
    expect(heading.className).toContain('break-words');
    expect(heading.className).toContain('col-span-2');
    expect(heading.parentElement?.className).toContain('grid-cols-[auto_minmax(0,1fr)]');
    expect(heading.closest('section')?.querySelector('[data-home-hero-avatar]')?.textContent).toBe('♟');
    const hero = heading.closest('section');
    const columns = hero?.querySelector('div.relative.grid');
    expect(columns?.className).toContain('grid-cols-[minmax(0,1fr)]');
    expect(columns?.className).toContain('p-[24px]');
    expect(columns?.className).toContain('gap-[20px]');
    expect(columns?.className).toContain('lg:grid-cols-[minmax(0,1fr)_auto]');
    expect(columns?.className).not.toContain('md:grid-cols-');
    const greeting = hero?.querySelector('[data-home-hero-avatar] + div');
    expect(greeting?.className).toContain('break-words');
    expect(greeting?.className).toContain('tracking-[0.08em]');
    expect(greeting?.parentElement?.className).toContain('gap-x-[12px]');
    const primary = hero?.querySelector<HTMLAnchorElement>('a[href="/play"]');
    const actions = primary?.parentElement;
    expect(actions?.className).toContain('lg:flex-col');
    expect(actions?.className).not.toContain('md:flex-col');
    for (const path of ['/play', '/review']) {
      const action = hero?.querySelector<HTMLAnchorElement>('a[href="' + path + '"]');
      expect(action?.className).toContain('max-w-full');
      expect(action?.className).toContain('min-w-0');
      expect(action?.querySelector('span')?.className).toContain('break-words');
    }
    const continuation = screen.getByRole('region', { name: 'Continue improving' });
    expect(continuation.querySelector('.grid')?.className).toContain('grid-cols-1');
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
    const recentGame = screen.getByRole('link', { name: /OpponentWithALongName/ });
    expect(recentGame.getAttribute('href')).toBe('/review/103');
    expect(recentGame.className).toContain('focus-visible:ring-inset');
    expect(recentGame.className).toContain('focus-visible:ring-ui-focus');
    expect(recentGame.querySelector('[data-home-recent-opponent]')?.textContent?.trim()).toBe('OpponentWithALongName');
    expect(recentGame.querySelector('[data-home-recent-opponent]')?.className).toContain('line-clamp-2');
    expect(recentGame.querySelector('[data-home-recent-name]')?.className).toContain('flex');
    expect(recentGame.querySelector('.tracking-wider')?.className).toContain('text-ui-mutedText');
    expect(recentGame.querySelector('[data-home-recent-desktop-matchup]')?.textContent).toContain('sample-player');
    const desktopOpponent = recentGame.querySelector('[data-home-recent-desktop-opponent]');
    expect(desktopOpponent?.textContent?.trim()).toBe('OpponentWithALongName');
    expect(desktopOpponent?.className).toContain('flex-1');
  });

  it('shows the white opponent, not the signed-in player, when the recent game was played as black', async () => {
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/stats/me') return Promise.resolve({ total: 1, wins: 0, losses: 1, draws: 0, avg_accuracy: null, streak: null });
      if (url.startsWith('/api/games')) return Promise.resolve({ games: [{
        id: 104, white: 'OpponentWithALongName', black: 'sample-player',
        user_color: 'black', end_time: '2026-11-12T12:00:00Z',
        result: 'loss', time_control: '600', analyzed: false,
      }] });
      if (url === '/api/plan') return Promise.resolve({ goals: [] });
      if (url === '/api/achievements') return Promise.resolve({ achievements: [] });
      if (url.startsWith('/api/tactics/daily')) return Promise.resolve({ puzzle: null, done: null, streak: 0 });
      return Promise.resolve({});
    });
    mount();
    const recentGame = await screen.findByRole('link', { name: /OpponentWithALongName/ });
    expect(recentGame.getAttribute('href')).toBe('/review/104');
    expect(recentGame.querySelector('[data-home-recent-opponent]')?.textContent?.trim()).toBe('OpponentWithALongName');
    const desktopOpponent = recentGame.querySelector('[data-home-recent-desktop-opponent]');
    expect(desktopOpponent?.textContent?.trim()).toBe('OpponentWithALongName');
    expect(desktopOpponent?.className).toContain('flex-1');
    expect(within(recentGame).getByRole('img', { name: 'Loss' })).toBeTruthy();
  });

  it.each([
    ['en', '11/12/2026'],
    ['de', '12.11.2026'],
    ['es', '12/11/2026'],
    ['ru', '12.11.2026'],
    ['bg', '12.11.2026 г.'],
  ])('formats recent-game dates using the selected %s interface language', async (language, expectedDate) => {
    mocks.language = language;
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/stats/me') return Promise.resolve({ total: 1, wins: 1, losses: 0, draws: 0, avg_accuracy: null, streak: null });
      if (url.startsWith('/api/games')) return Promise.resolve({ games: [{
        id: 105, white: 'sample-player', black: 'OpponentWithALongName',
        user_color: 'white', end_time: '2026-11-12T12:00:00Z',
        result: 'win', time_control: '600', analyzed: false,
      }] });
      if (url === '/api/plan') return Promise.resolve({ goals: [] });
      if (url === '/api/achievements') return Promise.resolve({ achievements: [] });
      if (url.startsWith('/api/tactics/daily')) return Promise.resolve({ puzzle: null, done: null, streak: 0 });
      return Promise.resolve({});
    });
    mount();
    const row = await screen.findByRole('link', { name: /OpponentWithALongName/ });
    const date = row.querySelector('[data-home-recent-date]');
    expect(date?.textContent?.trim()).toBe(expectedDate);
  });

  it.each([
    ['white', '83.7%', '91.2%'],
    ['black', '91.2%', '83.7%'],
  ])('keeps the opponent identifiable and labels both mobile accuracies when playing %s', async (userColor, ownScore, opponentScore) => {
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/stats/me') return Promise.resolve({ total: 1, wins: 1, losses: 0, draws: 0, avg_accuracy: 85, streak: null });
      if (url.startsWith('/api/games')) return Promise.resolve({ games: [{
        id: 106, white: userColor === 'white' ? 'sample-player' : 'OpponentWithALongName',
        black: userColor === 'black' ? 'sample-player' : 'OpponentWithALongName',
        user_color: userColor, end_time: '2026-11-12T12:00:00Z',
        result: 'win', time_control: '600', analyzed: true,
        accuracy_white: 83.7, accuracy_black: 91.2,
      }] });
      if (url === '/api/plan') return Promise.resolve({ goals: [] });
      if (url === '/api/achievements') return Promise.resolve({ achievements: [] });
      if (url.startsWith('/api/tactics/daily')) return Promise.resolve({ puzzle: null, done: null, streak: 0 });
      return Promise.resolve({});
    });
    mount();
    const link = await screen.findByRole('link', { name: /OpponentWithALongName/ });
    expect(link.getAttribute('href')).toBe('/review/106');
    expect(link.querySelector('[data-home-recent-opponent]')?.textContent?.trim()).toBe('OpponentWithALongName');
    const mobileAccuracy = link.querySelector('[data-home-mobile-accuracy]');
    expect(mobileAccuracy?.className).toContain('sm:hidden');
    expect(mobileAccuracy?.textContent).toContain('You');
    expect(mobileAccuracy?.textContent).toContain('Opponent');
    expect(link.querySelector('[data-home-accuracy-self]')?.textContent).toBe(ownScore);
    expect(link.querySelector('[data-home-accuracy-opponent]')?.textContent).toBe(opponentScore);
    const desktopScore = link.querySelector('.font-mono.text-xs.tabular-nums');
    expect(desktopScore?.textContent?.replace(/\s/g, '')).toBe('83.7%/91.2%');
    expect(desktopScore?.parentElement?.className).toContain('hidden');
    expect(desktopScore?.querySelector('.mx-1.text-ui-mutedText')?.textContent).toBe('/');
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
    expect(alert.querySelector('button')?.className).toContain('min-h-11');
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
    for (const label of ["Retry This week's plan", 'Retry Achievements', 'Retry home.todayPuzzle']) {
      expect(screen.getByRole('button', { name: label }).className).toContain('min-h-11');
    }
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

  it('provides a touch-sized recovery action for failed recent games', async () => {
    let unavailable = true;
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/stats/me') return Promise.resolve({ total: 1, wins: 1, losses: 0, draws: 0, avg_accuracy: null, streak: null });
      if (url.startsWith('/api/games')) return unavailable
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ games: [] });
      if (url === '/api/plan') return Promise.resolve({ goals: [] });
      if (url === '/api/achievements') return Promise.resolve({ achievements: [] });
      if (url.startsWith('/api/tactics/daily')) return Promise.resolve({ puzzle: null, done: null, streak: 0 });
      return Promise.resolve({});
    });
    mount();
    const errorText = await screen.findByText('Recent games could not be loaded.');
    const retry = errorText.closest('section')?.querySelector<HTMLButtonElement>('button');
    expect(retry?.className).toContain('min-h-11');
    unavailable = false;
    fireEvent.click(retry!);
    expect(await screen.findByText('Play your first game')).toBeTruthy();
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
