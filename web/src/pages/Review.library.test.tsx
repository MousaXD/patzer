// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('../api', () => ({
  api: { get: mocks.get, post: mocks.post, patch: mocks.patch },
}));
vi.mock('../state/auth', () => ({
  useAuth: () => ({ user: { id: 7, profile: { chesscom_username: null, lichess_username: null } } }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

import Review from './Review';

function makeGame(id: number) {
  return {
    id,
    white: 'White ' + id,
    black: 'Black ' + id,
    user_color: 'white',
    result: 'win',
    time_control: '600+0',
    end_time: '2026-11-08T12:00:00Z',
    source: 'chesscom',
    bookmarked: 0,
    analyzed: 0,
    opening_name: 'Italian Game',
    notes: '',
    from_position: 0,
  };
}

function mount(initial = '/review') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/review" element={<Review />} />
          <Route path="/review/:id" element={<div>Game detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockImplementation(async (url: string) => {
    const query = new URLSearchParams(url.split('?')[1] ?? '');
    const limit = Number(query.get('limit') ?? 50);
    return { games: Array.from({ length: Math.min(limit, 1000) }, (_, i) => makeGame(i + 1)), total: 1000 };
  });
  mocks.patch.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); });

describe('Review library with large histories', () => {
  it('loads bounded batches and explains the 200-game backend cap', async () => {
    mount();
    await screen.findByText(/40 of 1,000 games/);
    for (const expected of [80, 120, 160, 200]) {
      fireEvent.click(screen.getByRole('button', { name: 'Load more games' }));
      await screen.findByText(new RegExp(String(expected) + ' of 1,000 games'));
    }
    expect(screen.queryByRole('button', { name: 'Load more games' })).toBeNull();
    expect(screen.getByText(/Search by player, opening, or notes to find older games/)).toBeTruthy();
    expect(mocks.get.mock.calls.every(([url]) => Number(new URLSearchParams(String(url).split('?')[1]).get('limit')) <= 200)).toBe(true);
  });

  it('walks past game 200 without repeats when the platform API supports offset pagination', async () => {
    mocks.get.mockImplementation(async (url: string) => {
      const query = new URLSearchParams(url.split('?')[1] ?? '');
      const offset = Number(query.get('offset') ?? 0);
      const limit = Number(query.get('limit') ?? 40);
      const games = Array.from({ length: Math.min(limit, 1000 - offset) }, (_, i) => makeGame(offset + i + 1));
      return { games, total: 1000, offset, limit, has_more: offset + games.length < 1000 };
    });
    mount();
    await screen.findByText(/40 of 1,000 games/);
    for (const count of [80, 120, 160, 200, 240]) {
      fireEvent.click(screen.getByRole('button', { name: 'Load more games' }));
      await screen.findByText(new RegExp(`${count} of 1,000 games`));
    }
    expect(document.querySelectorAll('a[href^="/review/"]')).toHaveLength(240);
    expect(document.querySelectorAll('a[href="/review/240"]')).toHaveLength(1);
    expect(screen.queryByText(/Search by player, opening, or notes to find older games/)).toBeNull();
    const requests = mocks.get.mock.calls.map(([url]) => new URLSearchParams(String(url).split('?')[1] ?? ''));
    expect(requests.map((params) => Number(params.get('offset') ?? 0))).toEqual([0, 40, 80, 120, 160, 200]);
    expect(requests.every((params) => Number(params.get('limit')) === 40)).toBe(true);
  });

  it('preserves loaded games when a later page fails and retries only that page', async () => {
    let failSecondPage = true;
    mocks.get.mockImplementation(async (url: string) => {
      const query = new URLSearchParams(url.split('?')[1] ?? '');
      const offset = Number(query.get('offset') ?? 0);
      if (offset === 40 && failSecondPage) throw new Error('offline');
      const games = Array.from({ length: 40 }, (_, i) => makeGame(offset + i + 1));
      return { games, total: 200, offset, has_more: offset + games.length < 200 };
    });
    mount();
    await screen.findByText(/40 of 200 games/);
    fireEvent.click(screen.getByRole('button', { name: 'Load more games' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/40 of 200 games/)).toBeTruthy();
    expect(document.querySelectorAll('a[href^="/review/"]')).toHaveLength(40);

    failSecondPage = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText(/80 of 200 games/);
    expect(document.querySelectorAll('a[href^="/review/"]')).toHaveLength(80);
  });

  it('searches the full library server-side with a debounced and accessible input', async () => {
    mount();
    await screen.findByText(/40 of 1,000 games/);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Alekhine' } });
    await waitFor(() => {
      expect(mocks.get.mock.calls.some(([url]) => String(url).includes('q=Alekhine'))).toBe(true);
    }, { timeout: 3000 });
  });

  it('bounds URL deep links and text entry to the API maximum search length', async () => {
    mount(`/review?q=${'x'.repeat(180)}`);
    await screen.findByText(/40 of 1,000 games/);
    const search = screen.getByRole('searchbox') as HTMLInputElement;
    expect(search.maxLength).toBe(120);
    expect(search.value).toHaveLength(120);
    expect(mocks.get.mock.calls.some(([url]) =>
      new URLSearchParams(String(url).split('?')[1] ?? '').get('q')?.length === 120)).toBe(true);
  });

  it('shows a recoverable error, never the no-games onboarding state', async () => {
    mocks.get.mockRejectedValue(new Error('offline'));
    mount();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(/No games match your search/)).toBeNull();
    expect(screen.queryByText(/Play your first game/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('keeps bookmark controls labeled and available without hover', async () => {
    mount();
    await screen.findByText(/40 of 1,000 games/);
    const bookmark = screen.getAllByRole('button', { name: 'Bookmark game' })[0]!;
    expect(bookmark.getAttribute('aria-pressed')).toBe('false');
    expect(bookmark.className).toContain('text-chesscom-400');
    expect(bookmark.className).toContain('md:opacity-0');
  });

  it('labels unfinished games instead of rendering a fake 1970 date or a draw', async () => {
    mocks.get.mockResolvedValue({
      games: [{ ...makeGame(1), result: '*', end_time: null }], total: 1,
    });
    mount();
    expect(await screen.findByText('In progress')).toBeTruthy();
    expect(screen.queryByText(/1970/)).toBeNull();
  });

  it('restores the bookmark and shows an actionable error after a failed save', async () => {
    let persisted = false;
    mocks.get.mockImplementation(async () => ({
      games: [{ ...makeGame(1), bookmarked: persisted ? 1 : 0 }], total: 1,
    }));
    mocks.patch.mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(async () => {
      persisted = true;
      return { ok: true };
    });
    mount();
    await screen.findByText('1 of 1 games');
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark game' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Bookmark game' });
    expect(retry.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove bookmark' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not mutate another account cached games when bookmarking an identical game ID', async () => {
    let persisted = false;
    mocks.get.mockImplementation(async () => ({
      games: [{ ...makeGame(1), bookmarked: persisted ? 1 : 0 }], total: 1,
    }));
    mocks.patch.mockImplementation(async () => {
      persisted = true;
      return { ok: true };
    });
    const { queryClient } = mount();
    await screen.findByText('1 of 1 games');
    const otherHomeKey = ['games', 'home', 101];
    const otherLibraryKey = ['games', 'library', 101, { q: '', bookmarkedOnly: false }];
    queryClient.setQueryData(otherHomeKey, { games: [makeGame(1)] });
    queryClient.setQueryData(otherLibraryKey, {
      pages: [{ games: [makeGame(1)], total: 1 }], pageParams: [{ offset: 0, limit: 40 }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Bookmark game' }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove bookmark' })).toBeTruthy());

    expect(queryClient.getQueryData<{ games: { bookmarked: number }[] }>(otherHomeKey)?.games[0]?.bookmarked).toBe(0);
    expect(queryClient.getQueryData<{ pages: { games: { bookmarked: number }[] }[] }>(otherLibraryKey)?.pages[0]?.games[0]?.bookmarked).toBe(0);
  });
});
