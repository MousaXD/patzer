// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ post: vi.fn(), refresh: vi.fn(), account: 1 }));
vi.mock('../api', () => ({ api: { post: mocks.post } }));
vi.mock('../state/auth', () => ({ useAuth: (selector?: (state: { user: { id: number } }) => unknown) => {
  const state = { user: { id: mocks.account } };
  return selector ? selector(state) : state;
} }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
}));
vi.mock('framer-motion', async () => {
  const React = await import('react');
  const motion = new Proxy({} as Record<string, unknown>, {
    get: (_target, tag: string) => React.forwardRef<HTMLElement, Record<string, unknown>>(
      ({ children, initial, animate, exit, transition, ...props }, ref) => {
        void initial; void animate; void exit; void transition;
        return React.createElement(tag, { ...props, ref }, children as React.ReactNode);
      },
    ),
  });
  return { motion, AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</> };
});

import IncomingChallengeModal from './IncomingChallengeModal';
import { useLobby, type Challenge } from '../state/lobby';

const incoming = {
  id: 20, color: 'white', time_control: 'rapid', status: 'pending', game_id: null, created_at: '2026-11-12',
  from: { id: 2, username: 'opponent', display_name: 'Opponent', avatar_emoji: '♟' },
  to: { id: 1, username: 'qa-player', display_name: 'QA player', avatar_emoji: '♟' },
} satisfies Challenge;

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <span data-testid="route">{pathname + search}</span>;
}
function view() {
  return <MemoryRouter initialEntries={['/play']}>
    <button type="button">Focus origin</button>
    <IncomingChallengeModal />
    <LocationProbe />
    <Routes><Route path="/play" element={<span>Play page</span>} /></Routes>
  </MemoryRouter>;
}
function mount() { return render(view()); }

beforeEach(() => {
  mocks.account = 1;
  mocks.post.mockReset();
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  // Model an authenticated lobby connection: confirmed mutations are fenced
  // through the same account-scoped store action used in the real App.
  vi.stubGlobal('WebSocket', class { close() {} });
  useLobby.getState().connect(1);
  useLobby.setState({ incoming: [{ ...incoming }], outgoing: [], refreshChallenges: mocks.refresh,
    activePlaySession: false } as never);
});
afterEach(() => {
  cleanup();
  useLobby.getState().disconnect();
  vi.unstubAllGlobals();
});

describe('incoming challenge modal failure recovery', () => {
  it.each(['Escape', 'Not now', 'Close'] as const)(
    'defers an invitation with %s and restores keyboard focus to the previous control', async (method) => {
      useLobby.setState({ incoming: [] } as never);
      mount();
      const origin = screen.getByRole('button', { name: 'Focus origin' });
      origin.focus();
      act(() => useLobby.setState({ incoming: [{ ...incoming }] }));
      const dialog = screen.getByRole('dialog', { name: 'challenge.incoming' });
      expect(document.activeElement).toBe(dialog.querySelector('[tabindex="-1"]'));
      if (method === 'Escape') fireEvent.keyDown(dialog, { key: 'Escape' });
      else fireEvent.click(screen.getByRole('button', { name: method === 'Close' ? 'common.close' : 'Not now' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'challenge.incoming' })).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(origin));
      expect(useLobby.getState().incoming.map((c) => c.id)).toEqual([20]);
      expect(mocks.post).not.toHaveBeenCalled();
    },
  );

  it('does not hide an invitation with Escape while its acceptance is still pending', async () => {
    let acknowledge!: (value: { game_id: number }) => void;
    mocks.post.mockImplementation(() => new Promise((resolve) => { acknowledge = resolve; }));
    mount();
    const dialog = screen.getByRole('dialog', { name: 'challenge.incoming' });
    fireEvent.click(screen.getByRole('button', { name: 'challenge.accept' }));
    expect((screen.getByRole('button', { name: 'challenge.accept' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'challenge.incoming' })).toBeTruthy();
    expect(useLobby.getState().incoming.map((c) => c.id)).toEqual([20]);
    await act(async () => { acknowledge({ game_id: 345 }); await Promise.resolve(); });
    expect(screen.getByTestId('route').textContent).toBe('/play?game=345');
    expect(useLobby.getState().incoming).toHaveLength(0);
  });

  it('lets a player close the unsolicited popup without silently declining the invitation', () => {
    mount();
    const dialog = screen.getByRole('dialog', { name: 'challenge.incoming' });
    fireEvent.click(dialog.querySelector('button[aria-label="common.close"]')!);
    expect(screen.queryByRole('dialog', { name: 'challenge.incoming' })).toBeNull();
    expect(useLobby.getState().incoming.map((c) => c.id)).toEqual([20]);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('lets Not now keep an invitation available for a later decision', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog', { name: 'challenge.incoming' })).toBeNull();
    expect(useLobby.getState().incoming.map((c) => c.id)).toEqual([20]);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('does not cover an active timed game with a blocking invitation dialog', () => {
    useLobby.setState({ activePlaySession: true } as never);
    mount();
    expect(screen.queryByRole('dialog', { name: 'challenge.incoming' })).toBeNull();
    expect((screen.getByRole('status') as HTMLElement).textContent).toContain('after your game');
    expect(useLobby.getState().incoming).toHaveLength(1); // do not decline it
  });

  it.each([{ status: 409, error: 'not_pending' }, { status: 404, error: 'not_found' }])(
    'closes a no-longer-available $status invitation instead of offering futile Accept retries', async ({ status, error }) => {
    mocks.post.mockRejectedValueOnce(Object.assign(new Error(error), {
      status, data: { error },
    }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'challenge.accept' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'challenge.incoming' })).toBeNull());
    expect((await screen.findByRole('status')).textContent).toContain('no longer available');
    expect(useLobby.getState().incoming).toHaveLength(0);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 1.5, 'bad', null])('keeps an incoming invitation if the modal receives invalid accepted game ID %s', async (gameId) => {
    mocks.post.mockResolvedValue({ game_id: gameId });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'challenge.accept' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not accept this challenge');
    expect(screen.getByTestId('route').textContent).toBe('/play');
    expect(useLobby.getState().incoming.map((c) => c.id)).toEqual([20]);
    expect((screen.getByRole('button', { name: 'challenge.accept' }) as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('does not discard an invitation when Decline returns a malformed acknowledgment', async () => {
    mocks.post.mockResolvedValue({ ok: false });
    mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'challenge.decline' }).at(-1)!);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not decline this challenge');
    expect(useLobby.getState().incoming.map((c) => c.id)).toEqual([20]);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('ignores an old account acceptance after the modal switches to the new account', async () => {
    let confirm!: (value: unknown) => void;
    mocks.post.mockImplementation(() => new Promise((resolve) => { confirm = resolve; }));
    const page = mount();
    fireEvent.click(screen.getByRole('button', { name: 'challenge.accept' }));
    mocks.account = 2;
    act(() => useLobby.setState({ incoming: [{ ...incoming, id: 21, to: { ...incoming.to, id: 2 } }] }));
    page.rerender(view());
    await act(async () => { confirm({ game_id: 345 }); await Promise.resolve(); });
    expect(screen.getByTestId('route').textContent).toBe('/play');
    expect(useLobby.getState().incoming.map((c) => c.id)).toEqual([21]);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'challenge.accept' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('moves keyboard focus into the invitation and traps backward/forward Tab', () => {
    mount();
    const dialog = screen.getByRole('dialog', { name: 'challenge.incoming' });
    expect(document.activeElement).toBe(dialog.querySelector('[tabindex="-1"]'));
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'challenge.accept' }));
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'common.close' }));
  });

  it('retains an invitation after a failed acceptance and retries without starting a game', async () => {
    mocks.post.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ game_id: 345 });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'challenge.accept' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not accept this challenge');
    expect(screen.getByText('Play page')).toBeTruthy();
    expect(useLobby.getState().incoming).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'challenge.accept' }));
    await waitFor(() => expect(useLobby.getState().incoming).toHaveLength(0));
    expect(mocks.post.mock.calls.map(([url]) => url)).toEqual([
      '/api/challenges/20/accept', '/api/challenges/20/accept',
    ]);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('preserves an incoming invitation on failed decline and closes only after a confirmed retry', async () => {
    mocks.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true });
    mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'challenge.decline' }).at(-1)!);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not decline this challenge');
    expect(useLobby.getState().incoming).toHaveLength(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'challenge.decline' }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useLobby.getState().incoming).toHaveLength(0);
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it('blocks duplicate accept requests until the server responds', async () => {
    let respond!: (value: unknown) => void;
    mocks.post.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    mount();
    const accept = screen.getByRole('button', { name: 'challenge.accept' }) as HTMLButtonElement;
    fireEvent.click(accept);
    expect((screen.getByRole('button', { name: 'challenge.accept' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(accept);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    respond({ game_id: 345 });
    await waitFor(() => expect(useLobby.getState().incoming).toHaveLength(0));
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
});
