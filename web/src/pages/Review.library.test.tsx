// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  user: { id: 7, profile: { chesscom_username: null as string | null, lichess_username: null as string | null } },
}));

vi.mock('../api', () => ({
  api: { get: mocks.get, post: mocks.post, patch: mocks.patch },
}));
vi.mock('../state/auth', () => ({
  useAuth: () => ({ user: mocks.user }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string; white?: string; black?: string }) =>
      key === 'practice.entryAria'
        ? `Practice mistakes in ${opts?.white} versus ${opts?.black} without spoilers`
        : key === 'practice.entry' ? 'Practice first' : opts?.defaultValue ?? key,
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
  const view = () => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/review" element={<Review />} />
          <Route path="/review/:id" element={<div>Game detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(view());
  return { ...result, queryClient, rerenderReview: () => result.rerender(view()) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 7, profile: { chesscom_username: null, lichess_username: null } };
  mocks.get.mockImplementation(async (url: string) => {
    if (url === '/api/games/openings') return {total: 0, classified: 0, unclassified: 0, openings: []};
    const query = new URLSearchParams(url.split('?')[1] ?? '');
    const limit = Number(query.get('limit') ?? 50);
    return { games: Array.from({ length: Math.min(limit, 1000) }, (_, i) => makeGame(i + 1)), total: 1000 };
  });
  mocks.patch.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); });

describe('Review library with large histories', () => {
  it('offers direct spoiler-free practice only for games with saved analysis', async () => {
    mocks.get.mockResolvedValueOnce({ games: [
      { ...makeGame(1), analyzed: 1 }, makeGame(2),
      { ...makeGame(3), analyzed: 1, result: '*' },
    ], total: 3 });
    mount();
    const practice = await screen.findByRole('link', { name: /Practice mistakes in White 1 versus Black 1 without spoilers/ });
    expect(practice.getAttribute('href')).toBe('/review/1?practice=1');
    expect(screen.queryByRole('link', { name: /Practice mistakes in White 2/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Practice mistakes in White 3/ })).toBeNull();
  });

  it('loads bounded batches and explains the 200-game backend cap', async () => {
    mount();
    await screen.findByText(/40 of 1,000 games/);
    for (const expected of [80, 120, 160, 200]) {
      fireEvent.click(screen.getByRole('button', { name: 'Load more games' }));
      await screen.findByText(new RegExp(String(expected) + ' of 1,000 games'));
    }
    expect(screen.queryByRole('button', { name: 'Load more games' })).toBeNull();
    expect(screen.getByText(/Search by player, opening, or notes to find older games/)).toBeTruthy();
    expect(mocks.get.mock.calls.filter(([url]) => String(url).startsWith('/api/games?'))
      .every(([url]) => Number(new URLSearchParams(String(url).split('?')[1]).get('limit')) <= 200)).toBe(true);
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
    const requests = mocks.get.mock.calls.filter(([url]) => String(url).startsWith('/api/games?'))
      .map(([url]) => new URLSearchParams(String(url).split('?')[1] ?? ''));
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

  it('shows real opening coverage and opens an exact, shareable list without stale filters', async () => {
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/api/games/openings') return {
        total: 1000, classified: 180, unclassified: 820,
        openings: [{name:'Italian Game', games:130}, {name:'French Defense', games:50}],
      };
      const params = new URLSearchParams(url.split('?')[1] ?? '');
      const total = params.get('opening') === 'Italian Game' ? 130 : 1000;
      return {games:Array.from({length:40}, (_,i) => makeGame(i+1)), total, offset:0, has_more:true};
    });
    mount('/review?q=old-search&source=lichess&bookmarked=1&from_date=2026-01-01');
    expect(await screen.findByText('180 of 1,000 saved games have a recognized opening')).toBeTruthy();
    expect(screen.getByText('820 not classified yet')).toBeTruthy();
    const italian = screen.getByRole('button', {name:'Show 130 saved games in Italian Game'});
    expect(italian.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(italian);
    await screen.findByText('40 of 130 games');
    expect(italian.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Showing games in Italian Game');
    const matching = mocks.get.mock.calls.filter(([url]) => String(url).startsWith('/api/games?'))
      .map(([url]) => new URLSearchParams(String(url).split('?')[1]));
    expect(matching.some(p => p.get('opening') === 'Italian Game' && !p.has('q') && !p.has('source')
      && !p.has('bookmarked') && !p.has('from_date'))).toBe(true);
    fireEvent.click(screen.getByRole('button', {name:'Clear filters'}));
    await screen.findByText('40 of 1,000 games');
    expect(italian.getAttribute('aria-pressed')).toBe('false');
  });

  it('handles no recognized openings without pretending empty history', async () => {
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/api/games/openings') return {
        total: 250, classified: 0, unclassified: 250, openings: [],
      };
      return {games:[makeGame(1)], total:250, has_more:true};
    });
    mount();
    expect(await screen.findByText('250 not classified yet')).toBeTruthy();
    expect(screen.getByText(/Opening details will appear here/)).toBeTruthy();
    expect(screen.queryByRole('button', {name:/Show \d+ saved games in/})).toBeNull();
  });

  it('keeps the game list usable when opening discovery fails and allows an independent retry', async () => {
    let openingAttempts = 0;
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/api/games/openings') {
        openingAttempts++;
        if (openingAttempts === 1) throw new Error('temporary_opening_failure');
        return {total: 1000, classified: 100, unclassified: 900,
          openings: [{name: 'Italian Game', games: 100}]};
      }
      return {games: Array.from({length:40}, (_,i) => makeGame(i+1)),
        total: 1000, offset: 0, has_more: true};
    });
    mount();
    await screen.findByText('40 of 1,000 games');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/opening highlights could not be loaded/i);
    fireEvent.click(screen.getByRole('button', {name:'Retry opening highlights'}));
    expect(await screen.findByRole('button', {name:'Show 100 saved games in Italian Game'})).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(openingAttempts).toBe(2);
    expect(screen.getByText('40 of 1,000 games')).toBeTruthy();
  });

  it('accepts exact-opening deep links and bounds malicious or oversized parameters', async () => {
    mount('/review?opening=Italian%20Game');
    await screen.findByText(/40 of 1,000 games/);
    expect(mocks.get.mock.calls.some(([url]) => String(url).startsWith('/api/games?') &&
      new URLSearchParams(String(url).split('?')[1]).get('opening') === 'Italian Game')).toBe(true);
    expect(screen.getByText('Showing games in Italian Game')).toBeTruthy();
  });

  it('exposes server-side history filters and date sorting in a shareable URL', async () => {
    mount('/review?source=lichess&result=win&time_class=rapid&sort=oldest&analyzed=0');
    await screen.findByText(/40 of 1,000 games/);
    const params = new URLSearchParams(String(mocks.get.mock.calls[0]?.[0]).split('?')[1]);
    expect(params.get('source')).toBe('lichess');
    expect(params.get('result')).toBe('win');
    expect(params.get('time_class')).toBe('rapid');
    expect(params.get('sort')).toBe('oldest');
    expect(params.get('analyzed')).toBe('0');
    fireEvent.change(screen.getByRole('combobox', { name: 'Game result' }), { target: { value: 'loss' } });
    await waitFor(() => expect(mocks.get.mock.calls.some(([url]) =>
      new URLSearchParams(String(url).split('?')[1]).get('result') === 'loss')).toBe(true));
  });

  it('supports inclusive date-range deep links, prevents inverted ranges, and clears date filters', async () => {
    mount('/review?from_date=2026-01-01&to_date=2026-11-08');
    await screen.findByText(/40 of 1,000 games/);
    expect(mocks.get.mock.calls.some(([url]) => {
      const p = new URLSearchParams(String(url).split('?')[1]);
      return p.get('from_date') === '2026-01-01' && p.get('to_date') === '2026-11-08';
    })).toBe(true);
    const start = screen.getByLabelText('Games from date') as HTMLInputElement;
    const end = screen.getByLabelText('Games through date') as HTMLInputElement;
    expect(start.value).toBe('2026-01-01');
    expect(end.value).toBe('2026-11-08');
    fireEvent.change(start, {target:{value:'2026-11-09'}});
    await waitFor(() => {
      expect(start.value).toBe('2026-11-09');
      expect(end.value).toBe('');
    });
    expect(mocks.get.mock.calls.some(([url]) => {
      const p = new URLSearchParams(String(url).split('?')[1]);
      return p.get('from_date') === '2026-11-09' && !p.has('to_date');
    })).toBe(true);
    fireEvent.click(screen.getByRole('button', {name:'Clear filters'}));
    expect(start.value).toBe('');
    expect(end.value).toBe('');
  });

  it('ignores invalid date-range deep links instead of sending them to the API', async () => {
    mount('/review?from_date=2026-02-30&to_date=2026-13-01');
    await screen.findByText(/40 of 1,000 games/);
    expect((screen.getByLabelText('Games from date') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Games through date') as HTMLInputElement).value).toBe('');
    expect(mocks.get.mock.calls.every(([url]) => {
      const p = new URLSearchParams(String(url).split('?')[1]);
      return !p.has('from_date') && !p.has('to_date');
    })).toBe(true);
  });

  it('offers filter recovery instead of account onboarding for empty filtered results', async () => {
    mocks.get.mockImplementation(async (url: string) => {
      const params = new URLSearchParams(url.split('?')[1]);
      return params.has('result') ? { games: [], total: 0 } : { games: [makeGame(1)], total: 1 };
    });
    mount('/review?result=loss');
    expect(await screen.findByText('No games match your search')).toBeTruthy();
    // The header can still offer account setup; the empty-state action must
    // recover the filtered library rather than adding a second setup CTA.
    expect(screen.getAllByRole('link', { name: /Set Chess.com username/ })).toHaveLength(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    await screen.findByText('1 of 1 games');
    expect((screen.getByRole('combobox', { name: 'Game result' }) as HTMLSelectElement).value).toBe('');
  });

  it('requests a clearly bounded recent import batch rather than silently fetching only 20', async () => {
    mocks.user.profile.chesscom_username = 'tester';
    mocks.post.mockResolvedValue({ imported: 150, total: 200, duplicates: 42, skipped: 8, enriched: 12 });
    mount();
    await screen.findByText(/40 of 1,000 games/);
    expect((screen.getByRole('combobox', { name: 'Recent games to fetch' }) as HTMLSelectElement).value).toBe('200');
    fireEvent.click(screen.getByRole('button', { name: /review\.import \(@tester\)/ }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/api/games/import/chesscom', { limit: 200 }));
    expect(await screen.findByText(/150 new games saved from 200 retrieved/)).toBeTruthy();
    expect(screen.getByText(/42 already saved, 8 unsupported or invalid/)).toBeTruthy();
    expect(screen.getByText(/12 existing games gained opening details/)).toBeTruthy();
    expect(screen.getByText(/not your entire history/)).toBeTruthy();
  });

  it('explains a changed linked account and announces failed imports accessibly', async () => {
    mocks.user.profile.lichess_username = 'tester';
    mocks.post.mockRejectedValue(new Error('linked_account_changed'));
    mount();
    await screen.findByText(/40 of 1,000 games/);
    fireEvent.click(screen.getByRole('button', { name: /review\.importLichess \(@tester\)/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Your linked account changed during import/);
    expect(alert.textContent).toMatch(/Check Settings and retry/);
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
    expect(await screen.findByText(/Your game library could not be loaded/)).toBeTruthy();
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

  it('never attributes a Black-or-White accuracy score to a user with unknown side', async () => {
    mocks.get.mockResolvedValue({
      games: [{ ...makeGame(1), analyzed: 1, user_color: null,
        accuracy_white: 91.5, accuracy_black: 32.2 }], total: 1,
    });
    mount();
    expect(await screen.findByText('Analysis available')).toBeTruthy();
    expect(screen.queryByText('review.accuracy: 91.5%')).toBeNull();
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

  it('refreshes the importing account history, insights, plan and achievements without touching another account', async () => {
    mocks.user.profile.chesscom_username = 'tester';
    mocks.post.mockResolvedValue({ imported: 12, total: 20 });
    const { queryClient } = mount();
    await screen.findByText(/40 of 1,000 games/);
    const ownKeys = [
      ['stats', 'me', 7], ['insights-v2', 7], ['achievements', 7],
      ['achievements-home', 7], ['plan-home', 7],
    ];
    const otherKeys = ownKeys.map((key) => [...key.slice(0, -1), 101]);
    for (const key of [...ownKeys, ...otherKeys]) queryClient.setQueryData(key, { value: 'cached' });

    fireEvent.click(screen.getByRole('button', { name: /review\.import \(@tester\)/ }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/api/games/import/chesscom', { limit: 200 }));
    await waitFor(() => expect(ownKeys.every((key) => queryClient.getQueryState(key)?.isInvalidated)).toBe(true));
    expect(otherKeys.every((key) => queryClient.getQueryState(key)?.isInvalidated === false)).toBe(true);
  });

  it('does not show a previous player import result after switching accounts mid-request', async () => {
    mocks.user.profile.chesscom_username = 'first';
    let resolveImport!: (result: { imported: number; total: number }) => void;
    mocks.post.mockReturnValue(new Promise((resolve) => { resolveImport = resolve; }));
    const { rerenderReview } = mount();
    await screen.findByText(/40 of 1,000 games/);
    fireEvent.click(screen.getByRole('button', { name: /review\.import \(@first\)/ }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    mocks.user = { id: 101, profile: { chesscom_username: null, lichess_username: null } };
    rerenderReview();
    await act(async () => { resolveImport({ imported: 17, total: 20 }); });
    expect(screen.queryByText('review.imported')).toBeNull();
    expect(screen.getByRole('link', { name: /Set Chess.com username/ })).toBeTruthy();
  });
});
