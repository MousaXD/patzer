// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, Link, RouterProvider, useSearchParams } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../api', () => ({ api: { get: mocks.get, post: mocks.post } }));
vi.mock('../state/auth', () => ({ useAuth: () => ({ user: { id: 17, profile: { board_theme: 'green' } } }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }));
vi.mock('../lib/sounds', () => ({ soundForMove: vi.fn(), inferMoveFlagsFromSan: vi.fn() }));
vi.mock('./ChessBoard', () => ({ default: ({ onMove }: { onMove: (uci: string) => void }) => (
  <button type="button" onClick={() => onMove('e2g2')}>Play solution</button>
) }));

import TacticsPuzzles from './TacticsPuzzles';

// A legal two-ply position shipped in Patzer's Lichess CC0 puzzle collection.
const puzzle = {
  id: 'l2IPm', fen: 'rkr5/pbpQ1R2/1p6/3PpB2/8/2P3Pp/P3q2P/3R3K w - - 4 28',
  moves: ['f5g4', 'e2g2'], rating: 1181, themes: ['mate', 'mateIn1'],
};
const stats = { rating: 1200, provisional: false, best: 1200, played: 0, solved: 0, recent: [], total: 3000 };

function Harness() {
  const [params, setParams] = useSearchParams();
  return <>
    <Link to="/">Global Home</Link>
    <TacticsPuzzles daily={params.get('daily') === '1'} onLeaveDaily={() => setParams({ tab: 'puzzles' })} />
  </>;
}

function mount(daily = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([
    { path: '/train', element: <Harness /> },
    { path: '/', element: <div>Home reached</div> },
  ], { initialEntries: [daily ? '/train?tab=puzzles&daily=1' : '/train?tab=puzzles'] });
  render(<StrictMode><QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider></StrictMode>);
  return router;
}

beforeEach(() => {
  mocks.get.mockImplementation((url: string) => {
    if (url === '/api/tactics/stats') return Promise.resolve(stats);
    if (url.startsWith('/api/tactics/next')) return Promise.resolve({ puzzle });
    if (url.startsWith('/api/tactics/daily')) return Promise.resolve({ day: '2026-11-12', puzzle, done: null, streak: 0 });
    throw new Error(`Unexpected API GET: ${url}`);
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Lichess tactic puzzle attempt persistence', () => {
  it('retains the first failed attempt for retry and unlocks the theme picker only after acknowledgment', async () => {
    mocks.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ rated: true, rating_before: 1200, rating_after: 1142 });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'train.puzzles.solution' }));
    const warning = await screen.findByRole('alert');
    expect(warning.textContent).toContain('Your first puzzle attempt was not confirmed');
    expect(mocks.post).toHaveBeenCalledWith('/api/tactics/attempt', { id: puzzle.id, solved: false });
    expect((screen.getByRole('button', { name: 'train.puzzles.themes.fork' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('train.puzzles.notRated')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry saving' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    expect(mocks.post.mock.calls[1]?.[1]).toEqual(mocks.post.mock.calls[0]?.[1]);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect((screen.getByRole('button', { name: 'train.puzzles.themes.fork' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('suspends global navigation during a pending save until the server acknowledges the first result', async () => {
    let accept!: (result: unknown) => void;
    mocks.post.mockImplementation(() => new Promise((resolve) => { accept = resolve; }));
    const router = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'train.puzzles.hint' }));
    expect(await screen.findByRole('status')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Global Home' }));
    expect(router.state.location.pathname).toBe('/train');
    expect(screen.getByRole('alertdialog', { name: 'Your puzzle attempt is not saved yet' })).toBeTruthy();

    accept({ rated: true, rating_before: 1200, rating_after: 1142 });
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('preserves a daily attempt during failed navigation and permits explicitly leaving unconfirmed', async () => {
    mocks.post.mockRejectedValue(new Error('offline'));
    const router = mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'train.puzzles.solution' }));
    await screen.findByRole('alert');
    await screen.findByText('train.puzzles.shownDone');
    const more = screen.getAllByRole('button', { name: 'train.puzzles.daily.more' });
    expect((more.at(-1) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.post.mock.calls[0]?.[1]).toEqual({ id: puzzle.id, solved: false, daily: '2026-11-12' });
    fireEvent.click(more[0]!);
    const dialog = screen.getByRole('alertdialog', { name: 'Your puzzle attempt is not saved yet' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(router.state.location.search).toContain('daily=1');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue without saving (result may not count)' }));
    await waitFor(() => expect(router.state.location.search).toBe('?tab=puzzles'));
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
});
