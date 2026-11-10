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
  useAuth: () => ({ user: { profile: { chesscom_username: null, lichess_username: null } } }),
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
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/review" element={<Review />} />
          <Route path="/review/:id" element={<div>Game detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
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

  it('searches the full library server-side with a debounced and accessible input', async () => {
    mount();
    await screen.findByText(/40 of 1,000 games/);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Alekhine' } });
    await waitFor(() => {
      expect(mocks.get.mock.calls.some(([url]) => String(url).includes('q=Alekhine'))).toBe(true);
    }, { timeout: 3000 });
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
});
