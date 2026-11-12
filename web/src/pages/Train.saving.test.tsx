// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../api', () => ({ api: { get: mocks.get, post: mocks.post } }));
vi.mock('../state/auth', () => ({ useAuth: () => ({ user: { id: 17, profile: { board_theme: 'green' } } }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }));
vi.mock('../lib/sounds', () => ({ soundForMove: vi.fn(), inferMoveFlagsFromSan: vi.fn() }));
vi.mock('../components/BetaBadge', () => ({ default: () => null }));
vi.mock('../components/TacticsPuzzles', () => ({ default: () => null }));
vi.mock('../components/CoachPanel', () => ({ default: () => null }));
vi.mock('../components/ChessBoard', () => ({ default: ({ onMove }: { onMove: (uci: string) => void }) => (
  <>
    <button type="button" onClick={() => onMove('e2e4')}>Play e4</button>
    <button type="button" onClick={() => onMove('g1f3')}>Play Nf3</button>
  </>
) }));

import Train from './Train';

const puzzle = {
  game_id: 101, ply: 1, source_revision: 0, analysis_generation: 1,
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  side_to_move: 'white', played_san: 'd4', played_uci: 'd2d4',
  best_san: 'e4', best_uci: 'e2e4', best_pv: ['e4'],
  line: ['e2e4'], line_san: ['e4'],
  classification: 'miss', centipawn_loss: 300,
  eval_before_cp: null, eval_after_cp: null,
  end_time: '2026-11-01', white: 'QA', black: 'Bot', review: true,
};

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([
    { path: '/train', element: <><Link to="/">Global Home</Link><Train /></> },
    { path: '/', element: <div>Home reached</div> },
  ], { initialEntries: ['/train'] });
  render(<StrictMode><QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider></StrictMode>);
  return router;
}

beforeEach(() => {
  mocks.get.mockImplementation((url: string) => {
    if (url.startsWith('/api/train/next')) return Promise.resolve({ puzzle, due: 0 });
    if (url.startsWith('/api/train/stats')) return Promise.resolve({ total: 1, solved: 0, failed: 0, accuracy: 0, due: 0 });
    if (url === '/api/coach/status') return Promise.resolve({ configured: false });
    throw new Error(`Unexpected request: ${url}`);
  });
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('personal puzzle attempt persistence', () => {
  it('does not save an old-tab solve to a newly analyzed game and reloads the updated position', async () => {
    let updated = false;
    mocks.get.mockImplementation((url: string) => {
      if (url.startsWith('/api/train/next')) return Promise.resolve({
        puzzle: updated ? { ...puzzle, played_san: 'Nf3', classification: 'blunder', source_revision: 2, analysis_generation: 3 } : puzzle,
        due: 0,
      });
      if (url.startsWith('/api/train/stats')) return Promise.resolve({ total: 0, solved: 0, failed: 0, accuracy: 0, due: 0 });
      if (url === '/api/coach/status') return Promise.resolve({ configured: false });
      throw new Error(`Unexpected request: ${url}`);
    });
    mocks.post.mockRejectedValue(Object.assign(new Error('stale_puzzle'), { status: 409 }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Play e4' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Your attempt was not recorded for the new position');
    expect(screen.queryByRole('button', { name: 'Retry saving' })).toBeNull();
    expect((screen.getByRole('button', { name: /Next puzzle/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.post.mock.calls[0]?.[1]).toMatchObject({ source_revision: 0, analysis_generation: 1, solved: true });
    updated = true;
    fireEvent.click(screen.getByRole('button', { name: 'Load updated puzzle' }));
    expect(await screen.findByText('blunder')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('does not mark an obsolete alternative move wrong or submit an attempt', async () => {
    mocks.post.mockRejectedValue(Object.assign(new Error('stale_puzzle'), { status: 409 }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Play Nf3' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Your attempt was not recorded for the new position');
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]?.[0]).toBe('/api/train/check');
    expect(mocks.post.mock.calls[0]?.[1]).toMatchObject({ source_revision: 0, analysis_generation: 1, step: 0, uci: 'g1f3' });
    expect(screen.queryByText('train.puzzles.wrong')).toBeNull();
    expect(screen.queryByRole('button', { name: 'train.puzzles.hint' })).toBeNull();
  });

  it('retries the same failed first attempt instead of changing its outcome', async () => {
    mocks.post.mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ counted: true, done: false, due_on: '2026-11-13' });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'train.puzzles.hint' }));
    const warning = await screen.findByRole('alert');
    expect(warning.textContent).toContain('Your first attempt was not saved');
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]?.[1]).toMatchObject({ game_id: 101, ply: 1, solved: false });
    expect(mocks.post.mock.calls[0]?.[1]).toMatchObject({ source_revision: 0, analysis_generation: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Retry saving' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    expect(mocks.post.mock.calls[1]?.[1]).toEqual(mocks.post.mock.calls[0]?.[1]);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('blocks navigation while saving and does not promise a learned lesson before acknowledgment', async () => {
    let acknowledge!: (result: { counted: boolean; done: boolean; due_on: string | null }) => void;
    mocks.post.mockImplementation(() => new Promise((resolve) => { acknowledge = resolve; }));
    const router = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Play e4' }));
    expect(await screen.findByText('Saving your practice result…')).toBeTruthy();
    expect(screen.queryByText('train.mine.learned')).toBeNull();
    expect((screen.getByRole('button', { name: /Next puzzle/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'Global Home' }));
    expect(router.state.location.pathname).toBe('/train');
    expect(screen.getByRole('alertdialog', { name: 'Your practice attempt is not saved yet' })).toBeTruthy();

    acknowledge({ counted: true, done: true, due_on: null });
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('requires a deliberate choice to leave when saving failed', async () => {
    mocks.post.mockRejectedValue(new Error('offline'));
    const router = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Play e4' }));
    await screen.findByRole('alert');
    expect((screen.getByRole('button', { name: /Next puzzle/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Continue without saving/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('link', { name: 'Global Home' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Your practice attempt is not saved yet' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(router.state.location.pathname).toBe('/train');
    fireEvent.click(screen.getByRole('link', { name: 'Global Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave without saving' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
});
