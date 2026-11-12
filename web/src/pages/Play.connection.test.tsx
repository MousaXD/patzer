// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { Chess } from 'chess.js';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';

const socketHarness = vi.hoisted(() => ({
  current: null as null | {
    connected: boolean;
    connectCalls: number;
    disconnectCalls: number;
    urls: string[];
    sent: { type: string; uci?: string }[];
    accept(): void;
    drop(): void;
    receive(message: Record<string, unknown>): void;
    receiveRaw(data: string): void;
  },
}));
const lobbyHarness = vi.hoisted(() => ({
  refreshUsers: vi.fn(), refreshChallenges: vi.fn(),
  setActivePlaySession: vi.fn(),
  forgetChallenge: vi.fn(), recordSentChallenge: vi.fn(),
  online: new Set<number>(), users: [] as unknown[], incoming: [] as unknown[], outgoing: [] as unknown[],
}));
const authHarness = vi.hoisted(() => ({ id: 1 }));
const liveHarness = vi.hoisted(() => ({ getLive: vi.fn(), del: vi.fn(), post: vi.fn() }));

vi.mock('../state/auth', () => ({
  useAuth: () => ({ user: {
    id: authHarness.id, profile: { display_name: 'Tester', board_theme: 'green', audience: 'beginner', blunder_warning: 0, coach_behavior: 'silent' },
  } }),
}));
vi.mock('../state/lobby', () => ({ useLobby: (selector?: (state: typeof lobbyHarness) => unknown) =>
  selector ? selector(lobbyHarness) : { ...lobbyHarness },
}));
vi.mock('../api', () => ({ api: {
  get: (url: string) => url === '/api/games/live' ? liveHarness.getLive() : Promise.resolve({ configured: false }),
  del: liveHarness.del,
  post: liveHarness.post,
} }));
vi.mock('../lib/sounds', () => ({ soundForMove: vi.fn(), inferMoveFlagsFromSan: vi.fn(), playSound: vi.fn() }));
// These tests exercise socket and dialog state, not animation. happy-dom's
// Web Animations shim rejects canceled Framer Motion exit animations, so use
// immediate elements to make a canceled dialog unmount deterministically.
vi.mock('framer-motion', async () => {
  const React = await import('react');
  const motion = new Proxy({} as Record<string, unknown>, {
    get: (_target, tag: string) => ({
      children, initial, animate, exit, transition, drag, dragControls,
      dragListener, dragConstraints, dragElastic, onDragEnd, ...props
    }: Record<string, unknown>) => {
      void initial; void animate; void exit; void transition; void drag;
      void dragControls; void dragListener; void dragConstraints;
      void dragElastic; void onDragEnd;
      return React.createElement(tag, props, children as React.ReactNode);
    },
  });
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    useDragControls: () => ({ start: () => {} }),
    useReducedMotion: () => true,
  };
});
vi.mock('../components/ChessBoard', () => ({
  default: ({ movable, onMove, fen }: { movable: boolean; onMove?: (uci: string) => void; fen: string }) => (
    <button type="button" data-testid="chess-board" data-fen={fen} disabled={!movable} onClick={() => onMove?.('e2e4')}>Move e2e4</button>
  ),
}));
vi.mock('../components/CapturedPieces', () => ({ default: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
vi.mock('../lib/reconnectingSocket', () => ({
  ReconnectingSocket: class {
    connected = false;
    connectCalls = 0;
    disconnectCalls = 0;
    urls: string[] = [];
    sent: { type: string; uci?: string }[] = [];
    constructor(private readonly opts: { onMessage(event: MessageEvent): void; onStatusChange(up: boolean): void }) {
      socketHarness.current = this;
    }
    connect(url: string) { this.connectCalls++; this.urls.push(url); this.connected = false; }
    disconnect() { this.disconnectCalls++; this.connected = false; }
    send(payload: { type: string; uci?: string }) {
      if (!this.connected) return false;
      this.sent.push(payload);
      return true;
    }
    wake() {}
    accept() { this.connected = true; this.opts.onStatusChange(true); }
    drop() { this.connected = false; this.opts.onStatusChange(false); }
    receive(message: Record<string, unknown>) { this.opts.onMessage({ data: JSON.stringify(message) } as MessageEvent); }
    receiveRaw(data: string) { this.opts.onMessage({ data } as MessageEvent); }
  },
}));

import Play from './Play';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const snapshot = { type: 'game_started', fen: START, history: [], time_control: 'untimed' };
const savedBot = { difficulty: 'kid', user_color: 'white', time_control: 'rapid', ply: 12, updated_at: '2026-11-12T12:00:00Z' };

function JoinDifferentGame({ gameId }: { gameId: number }) {
  const navigate = useNavigate();
  return <>
    <button onClick={() => navigate(`/play?game=${gameId}`)}>Join different game</button>
    <button onClick={() => navigate(-1)}>Go back</button>
  </>;
}

function CurrentRoute() {
  const location = useLocation();
  return <output data-testid="current-route">{location.pathname}{location.search}</output>;
}

beforeEach(() => {
  lobbyHarness.setActivePlaySession.mockReset();
  lobbyHarness.refreshUsers.mockReset().mockResolvedValue(undefined);
  lobbyHarness.refreshChallenges.mockReset().mockResolvedValue(undefined);
  lobbyHarness.forgetChallenge.mockReset();
  lobbyHarness.recordSentChallenge.mockReset();
  lobbyHarness.incoming = [];
  lobbyHarness.outgoing = [];
  liveHarness.getLive.mockReset().mockResolvedValue({ bot: null, pvp: [] });
  liveHarness.del.mockReset().mockResolvedValue({ ok: true });
  liveHarness.post.mockReset();
});
afterEach(() => { cleanup(); socketHarness.current = null; authHarness.id = 1; });

describe('Play authoritative game readiness', () => {
  it('ignores malformed live move and takeback updates without corrupting a synced game', async () => {
    render(<MemoryRouter initialEntries={['/play']}><Play /></MemoryRouter>);
    await waitFor(() => expect((screen.getByRole('button', { name: 'play.start' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'play.start' }));
    const ws = socketHarness.current!;
    act(() => { ws.accept(); ws.receive(snapshot); });
    const board = screen.getByTestId('chess-board') as HTMLButtonElement;
    for (const bad of [
      { type: 'move_made', fen: 'not-a-fen', san: 'e4', uci: 'e2e4' },
      { type: 'move_made', fen: START, san: 'e4', uci: 'not-uci' },
      { type: 'move_made', fen: START, san: null, uci: 'e2e4' },
      { type: 'takeback_applied', fen: 'not-a-fen', history: [] },
      { type: 'takeback_applied', fen: START, history: [null] },
    ]) {
      expect(() => act(() => ws.receive(bad))).not.toThrow();
      expect(board.dataset.fen).toBe(START);
      expect(board.disabled).toBe(false);
    }
    const chess = new Chess(START);
    chess.move('e4');
    act(() => ws.receive({ type: 'move_made', fen: chess.fen(), san: 'e4', uci: 'e2e4' }));
    // On the opponent's turn the displayed premove shadow deliberately sets
    // our side to move, even though the authoritative FEN's turn is black.
    expect(screen.getByTestId('chess-board').getAttribute('data-fen')?.split(' ')[0]).toBe(chess.fen().split(' ')[0]);
    expect(() => act(() => ws.receive({ type: 'takeback_applied', fen: START, history: [] }))).not.toThrow();
    expect(screen.getByTestId('chess-board').getAttribute('data-fen')).toBe(START);
  });

  it('ignores malformed game-socket envelopes without breaking the next authoritative board snapshot', async () => {
    render(<MemoryRouter initialEntries={['/play']}><Play /></MemoryRouter>);
    await waitFor(() => expect((screen.getByRole('button', { name: 'play.start' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'play.start' }));
    const ws = socketHarness.current!;
    act(() => ws.accept());
    for (const raw of ['null', '[]', 'false', '"unexpected"', '{bad json']) {
      expect(() => act(() => ws.receiveRaw(raw))).not.toThrow();
    }
    act(() => ws.receive(snapshot));
    const board = screen.getByTestId('chess-board') as HTMLButtonElement;
    expect(board.disabled).toBe(false);
    expect(board.dataset.fen).toBe(START);
    expect(() => act(() => ws.receiveRaw('null'))).not.toThrow();
    expect(board.disabled).toBe(false);
    expect(board.dataset.fen).toBe(START);
    expect(ws.disconnectCalls).toBe(0);
  });

  it('ignores an incomplete authoritative game snapshot without unlocking or corrupting its board', async () => {
    render(<MemoryRouter initialEntries={['/play']}><Play /></MemoryRouter>);
    await waitFor(() => expect((screen.getByRole('button', { name: 'play.start' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'play.start' }));
    const ws = socketHarness.current!;
    act(() => ws.accept());
    const board = screen.getByTestId('chess-board') as HTMLButtonElement;
    for (const bad of [
      { ...snapshot, fen: 'not-a-fen' },
      { ...snapshot, history: [null] },
      { ...snapshot, start_fen: 'not-a-fen', history: ['e4'] },
      { ...snapshot, history: 'e4' },
      { ...snapshot, history: ['not-a-legal-move'] },
      { ...snapshot, fen: new Chess().move('e4').after, history: [] },
      { ...snapshot, history: ['e4'] },
    ]) {
      expect(() => act(() => ws.receive(bad))).not.toThrow();
      expect(board.disabled).toBe(true);
      expect(board.dataset.fen).toBe(START);
    }
    act(() => ws.receive(snapshot));
    expect(board.disabled).toBe(false);
    expect(board.dataset.fen).toBe(START);
  });

  it('resumes a genuinely consistent mid-game snapshot with the matching SAN history', async () => {
    render(<MemoryRouter initialEntries={['/play?game=746']}><Play /></MemoryRouter>);
    const ws = socketHarness.current!;
    const chess = new Chess(START);
    chess.move('e4');
    act(() => { ws.accept(); ws.receive({ type: 'pvp_hello', fen: chess.fen(), history: ['e4'], your_color: 'black', time_control: 'rapid' }); });
    expect(screen.getByTestId('chess-board').getAttribute('data-fen')?.split(' ')[0]).toBe(chess.fen().split(' ')[0]);
    expect(screen.getByText('e4')).toBeTruthy();
    expect((screen.getByTestId('chess-board') as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(['Infinity', 'abc', '-1', '1.5', '0', '9999999999999999999999'])(
    'rejects malformed direct PvP game ID %s without creating a reconnecting socket', async (value) => {
      render(<MemoryRouter initialEntries={[`/play?game=${value}`]}>
        <Play /><CurrentRoute />
      </MemoryRouter>);
      await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/play'));
      expect(socketHarness.current).toBeNull();
      expect(screen.getByRole('alert').textContent).toContain('This game is no longer available');
      expect(screen.getByRole('button', { name: 'play.start' })).toBeTruthy();
    },
  );

  it('recovers when an older server rejects a PvP route with its invalid-game-id response', () => {
    render(<MemoryRouter initialEntries={['/play?game=101']}><Play /><CurrentRoute /></MemoryRouter>);
    const ws = socketHarness.current!;
    act(() => { ws.accept(); ws.receive({ type: 'error', message: 'invalid game id' }); });
    expect(ws.disconnectCalls).toBe(1);
    expect(screen.getByTestId('current-route').textContent).toBe('/play');
    expect(screen.getByRole('alert').textContent).toContain('This game is no longer available');
  });

  it('routes a confirmed incoming friend challenge to its PvP URL and preserves the actual PvP controls', async () => {
    lobbyHarness.incoming = [{
      id: 53, color: 'white', time_control: 'rapid', status: 'pending', game_id: null,
      created_at: '2026-11-12 18:00:00',
      from: { id: 2, username: 'friend', display_name: 'Friendly rival', avatar_emoji: '♟' },
      to: { id: 1, username: 'tester', display_name: 'Tester', avatar_emoji: '♟' },
    }];
    liveHarness.post.mockResolvedValue({ game_id: 650 });
    render(<MemoryRouter initialEntries={['/play']}><Play /><CurrentRoute /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'play.tabFriend' }));
    fireEvent.click(screen.getByRole('button', { name: 'challenge.accept' }));
    await waitFor(() => expect(liveHarness.post).toHaveBeenCalledWith('/api/challenges/53/accept'));
    await waitFor(() => expect(socketHarness.current?.urls.at(-1)).toContain('/ws/play?game=650'));
    expect(screen.getByTestId('current-route').textContent).toBe('/play?game=650');
    const ws = socketHarness.current!;
    act(() => { ws.accept(); ws.receive({ ...snapshot, type: 'pvp_hello', your_color: 'white', opponent: { display_name: 'Friendly rival', online: true } }); });
    expect(screen.getByText('Friendly rival')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'play.offerDraw' })).toBeTruthy();
    expect((screen.getByTestId('chess-board') as HTMLButtonElement).disabled).toBe(false);
  });

  it('reopens a directly linked PvP game after Strict Mode replays effect setup and cleanup', () => {
    render(<StrictMode><MemoryRouter initialEntries={['/play?game=735']}>
      <Play /><CurrentRoute />
    </MemoryRouter></StrictMode>);
    const ws = socketHarness.current!;
    expect(ws.connectCalls).toBe(2);
    expect(ws.disconnectCalls).toBeGreaterThanOrEqual(1);
    expect(ws.urls).toEqual(expect.arrayContaining([expect.stringContaining('/ws/play?game=735')]));
    act(() => { ws.accept(); ws.receive({ ...snapshot, type: 'pvp_hello', your_color: 'white' }); });
    expect(screen.getByTestId('current-route').textContent).toBe('/play?game=735');
    expect((screen.getByTestId('chess-board') as HTMLButtonElement).disabled).toBe(false);
  });

  it('leaves a missing PvP game and provides a useful recovery path instead of reconnecting forever', async () => {
    render(<MemoryRouter initialEntries={['/play?game=9999']}>
      <Play /><CurrentRoute />
    </MemoryRouter>);
    const ws = socketHarness.current!;
    expect(ws.urls[0]).toContain('/ws/play?game=9999');
    act(() => { ws.accept(); ws.receive({ type: 'error', message: 'game_not_found' }); });

    expect(ws.disconnectCalls).toBe(1);
    expect(screen.getByTestId('current-route').textContent).toBe('/play');
    expect(screen.getByRole('alert').textContent).toContain('This game is no longer available');
    expect(screen.queryByTestId('chess-board')).toBeNull();
    expect(screen.getByRole('button', { name: 'play.start' })).toBeTruthy();
  });

  it('keeps the current PvP session available after a recoverable illegal-move error', () => {
    render(<MemoryRouter initialEntries={['/play?game=105']}>
      <Play /><CurrentRoute />
    </MemoryRouter>);
    const ws = socketHarness.current!;
    act(() => { ws.accept(); ws.receive({ ...snapshot, type: 'pvp_hello', your_color: 'white' }); });
    act(() => ws.receive({ type: 'error', message: 'illegal_move' }));
    expect(ws.disconnectCalls).toBe(0);
    expect(screen.getByTestId('current-route').textContent).toBe('/play?game=105');
    expect(screen.queryByText(/This game is no longer available/)).toBeNull();
    expect((screen.getByTestId('chess-board') as HTMLButtonElement).disabled).toBe(false);
  });

  it('switches from a running bot game to the explicitly selected PvP game, not just its URL', async () => {
    render(<MemoryRouter initialEntries={['/play']}>
      <Play /><JoinDifferentGame gameId={401} />
    </MemoryRouter>);
    await waitFor(() => expect((screen.getByRole('button', { name: 'play.start' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'play.start' }));
    const ws = socketHarness.current!;
    act(() => { ws.accept(); ws.receive(snapshot); });
    expect((screen.getByTestId('chess-board') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Join different game' }));
    expect(ws.connectCalls).toBe(2);
    expect(ws.urls[1]).toContain('/ws/play?game=401');
    expect(ws.disconnectCalls).toBe(1);
    expect((screen.getByTestId('chess-board') as HTMLButtonElement).disabled).toBe(true);
    act(() => { ws.accept(); ws.receive({ ...snapshot, type: 'pvp_hello', opponent: { display_name: 'New rival', online: true } }); });
    expect(screen.getByText('New rival')).toBeTruthy();
    expect((screen.getByTestId('chess-board') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(ws.disconnectCalls).toBe(2);
    expect(screen.queryByTestId('chess-board')).toBeNull();
    expect(screen.getByRole('button', { name: 'play.start' })).toBeTruthy();
  });

  it('replaces a connected PvP game when a new game ID is chosen without unmounting Play', () => {
    render(<MemoryRouter initialEntries={['/play?game=511']}>
      <Play /><JoinDifferentGame gameId={512} />
    </MemoryRouter>);
    const ws = socketHarness.current!;
    expect(ws.urls[0]).toContain('/ws/play?game=511');
    act(() => { ws.accept(); ws.receive({ ...snapshot, type: 'pvp_hello', opponent: { display_name: 'First rival', online: true } }); });

    fireEvent.click(screen.getByRole('button', { name: 'Join different game' }));
    expect(ws.connectCalls).toBe(2);
    expect(ws.urls[1]).toContain('/ws/play?game=512');
    expect(ws.disconnectCalls).toBe(1);
    act(() => { ws.accept(); ws.receive({ ...snapshot, type: 'pvp_hello', opponent: { display_name: 'Second rival', online: true } }); });
    expect(screen.getByText('Second rival')).toBeTruthy();
    expect(screen.queryByText('First rival')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(ws.connectCalls).toBe(3);
    expect(ws.urls[2]).toContain('/ws/play?game=511');
    expect(ws.disconnectCalls).toBe(2);
  });

  it('suppresses blocking global invitations during a connecting or active game and restores them on exit', async () => {
    const page = render(<MemoryRouter initialEntries={['/play']}><Play /></MemoryRouter>);
    expect(lobbyHarness.setActivePlaySession).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect((screen.getByRole('button', { name: 'play.start' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'play.start' }));
    expect(lobbyHarness.setActivePlaySession).toHaveBeenLastCalledWith(true);
    const ws = socketHarness.current!;
    act(() => { ws.accept(); ws.receive(snapshot); });
    expect(lobbyHarness.setActivePlaySession).toHaveBeenLastCalledWith(true);
    page.unmount();
    expect(lobbyHarness.setActivePlaySession).toHaveBeenLastCalledWith(false);
  });

  it('requires an explicit choice before replacing a saved bot game with a new game', async () => {
    liveHarness.getLive.mockResolvedValue({ bot: savedBot, pvp: [] });
    render(<MemoryRouter initialEntries={['/play']}><Play /></MemoryRouter>);
    await screen.findByText('Continue where you left off');
    fireEvent.click(screen.getByRole('button', { name: 'play.start' }));
    expect(socketHarness.current).toBeNull();
    const dialog = screen.getByRole('alertdialog', { name: 'Start a new game instead?' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(socketHarness.current).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'play.start' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start new game' }));
    const ws = socketHarness.current!;
    expect(ws).toBeTruthy();
    act(() => ws.accept());
    expect(ws.connectCalls).toBe(1);
  });

  it('does not hide a saved game on an unconfirmed discard or failed delete, and retries safely', async () => {
    liveHarness.getLive.mockResolvedValue({ bot: savedBot, pvp: [] });
    liveHarness.del.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true });
    render(<MemoryRouter initialEntries={['/play']}><Play /></MemoryRouter>);
    await screen.findByText('Continue where you left off');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(liveHarness.del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep saved game' }));
    expect(liveHarness.del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard saved game' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not discard the saved game');
    expect(screen.getByText('Continue where you left off')).toBeTruthy();
    expect(liveHarness.del).toHaveBeenCalledExactlyOnceWith('/api/games/live/bot');
    fireEvent.click(screen.getByRole('button', { name: 'Discard saved game' }));
    await waitFor(() => expect(screen.queryByText('Continue where you left off')).toBeNull());
    expect(liveHarness.del).toHaveBeenCalledTimes(2);
  });

  it('does not erase the next player’s resume card when an earlier player’s discard resolves late', async () => {
    let acknowledge!: (response: { ok: boolean }) => void;
    liveHarness.getLive.mockResolvedValue({ bot: savedBot, pvp: [] });
    liveHarness.del.mockImplementation(() => new Promise((resolve) => { acknowledge = resolve; }));
    const view = () => <MemoryRouter initialEntries={['/play']}><Play /></MemoryRouter>;
    const page = render(view());
    await screen.findByText('Continue where you left off');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard saved game' }));
    expect((screen.getByRole('button', { name: 'Discard saved game' }) as HTMLButtonElement).disabled).toBe(true);

    authHarness.id = 2;
    page.rerender(view());
    await waitFor(() => expect(liveHarness.getLive).toHaveBeenCalledTimes(2));
    await screen.findByText('Continue where you left off');
    await act(async () => { acknowledge({ ok: true }); await Promise.resolve(); });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy();
    expect(liveHarness.del).toHaveBeenCalledTimes(1);
  });

  it('prevents a new game while live-game recovery is unknown and offers retry after a read failure', async () => {
    liveHarness.getLive.mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ bot: savedBot, pvp: [] });
    render(<MemoryRouter initialEntries={['/play']}><Play /></MemoryRouter>);
    expect((screen.getByRole('button', { name: 'play.start' }) as HTMLButtonElement).disabled).toBe(true);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not check your saved games');
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading saved games' }));
    await screen.findByText('Continue where you left off');
    expect((screen.getByRole('button', { name: 'play.start' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('disconnects a live game and hides its board when the authenticated player changes', async () => {
    const view = () => <MemoryRouter initialEntries={['/play']}><Play /></MemoryRouter>;
    const page = render(view());
    await waitFor(() => expect((screen.getByRole('button', { name: 'play.start' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'play.start' }));
    const ws = socketHarness.current!;
    act(() => { ws.accept(); ws.receive(snapshot); });
    expect((screen.getByTestId('chess-board') as HTMLButtonElement).disabled).toBe(false);

    authHarness.id = 2;
    page.rerender(view());
    expect(ws.disconnectCalls).toBe(1);
    expect(screen.queryByTestId('chess-board')).toBeNull();
    expect(screen.getByRole('button', { name: 'play.start' })).toBeTruthy();
    expect(ws.sent).toEqual([]);
  });

  it('refreshes the friend lobby on entry, not again for unrelated parent renders', () => {
    lobbyHarness.refreshUsers.mockClear();
    lobbyHarness.refreshChallenges.mockClear();
    const view = () => <MemoryRouter initialEntries={['/play']}><Play /></MemoryRouter>;
    const page = render(view());
    fireEvent.click(screen.getByRole('button', { name: 'play.tabFriend' }));
    expect(lobbyHarness.refreshUsers).toHaveBeenCalledTimes(1);
    expect(lobbyHarness.refreshChallenges).toHaveBeenCalledTimes(1);

    page.rerender(view());
    expect(lobbyHarness.refreshUsers).toHaveBeenCalledTimes(1);
    expect(lobbyHarness.refreshChallenges).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'play.tabBot' }));
    fireEvent.click(screen.getByRole('button', { name: 'play.tabFriend' }));
    expect(lobbyHarness.refreshUsers).toHaveBeenCalledTimes(2);
    expect(lobbyHarness.refreshChallenges).toHaveBeenCalledTimes(2);
  });

  it('blocks early moves until a snapshot, and drops optimistic state when the socket disconnects', async () => {
    render(<MemoryRouter initialEntries={['/play']}><Play /></MemoryRouter>);
    await waitFor(() => expect((screen.getByRole('button', { name: 'play.start' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'play.start' }));
    const board = screen.getByTestId('chess-board') as HTMLButtonElement;
    const ws = socketHarness.current!;
    expect(ws).toBeTruthy();
    expect(board.disabled).toBe(true);
    expect(screen.getByText('Connecting to your game…')).toBeTruthy();
    expect(ws.sent).toEqual([]);
    expect(screen.getAllByRole('status').some((node) => node.textContent === '—')).toBe(true);

    act(() => ws.accept());
    expect(board.disabled).toBe(true); // WebSocket OPEN alone is not a playable game.
    act(() => ws.receive(snapshot));
    expect(board.disabled).toBe(false);
    expect(screen.getAllByText('Untimed')).toHaveLength(2);
    fireEvent.click(board);
    expect(ws.sent).toContainEqual({ type: 'move', uci: 'e2e4' });
    expect(board.dataset.fen).not.toBe(START); // optimistic, server not yet confirmed

    act(() => ws.drop());
    expect(board.disabled).toBe(true);
    expect(board.dataset.fen).toBe(START); // revert to last server FEN
    expect(screen.getByText('Reconnecting… your game is saved.')).toBeTruthy();
    act(() => ws.accept());
    expect(board.disabled).toBe(true); // wait for fresh authoritative replay
    act(() => ws.receive(snapshot));
    expect(board.disabled).toBe(false);
  });

  it('never resigns on the first tap and allows cancellation with a button or Escape', async () => {
    render(<MemoryRouter initialEntries={['/play']}><Play /></MemoryRouter>);
    await waitFor(() => expect((screen.getByRole('button', { name: 'play.start' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'play.start' }));
    const ws = socketHarness.current!;
    act(() => { ws.accept(); ws.receive(snapshot); });

    const resignButton = screen.getAllByRole('button', { name: 'play.resign' })[0]!;
    fireEvent.click(resignButton);
    expect(ws.sent).toEqual([]);
    expect(screen.getByRole('alertdialog', { name: 'Resign this game?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(ws.sent).toEqual([]);

    fireEvent.click(resignButton);
    const dialog = screen.getByRole('alertdialog', { name: 'Resign this game?' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(ws.sent).toEqual([]);

    fireEvent.click(resignButton);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm resignation' }));
    expect(ws.sent).toEqual([{ type: 'resign' }]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('pauses a displaced PvP tab until the player explicitly takes control again', () => {
    render(<MemoryRouter initialEntries={['/play?game=9']}><Play /></MemoryRouter>);
    const ws = socketHarness.current!;
    const board = screen.getByTestId('chess-board') as HTMLButtonElement;
    expect(ws.connectCalls).toBe(1);

    act(() => {
      ws.accept();
      ws.receive({
        type: 'pvp_hello', fen: START, history: [], your_color: 'white', time_control: 'untimed',
        you: { user_id: 1, display_name: 'Tester' },
        opponent: { user_id: 2, display_name: 'Opponent', online: true },
      });
    });
    expect(board.disabled).toBe(false);

    act(() => ws.receive({ type: 'session_replaced' }));
    expect(board.disabled).toBe(true);
    expect(ws.connected).toBe(false);
    expect(ws.disconnectCalls).toBe(1);
    expect(screen.getByRole('alert').textContent).toContain('This game was opened in another tab');
    fireEvent.click(board);
    expect(ws.sent).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Take control here' }));
    expect(ws.connectCalls).toBe(2);
    expect(screen.queryByText('This game was opened in another tab. Play is paused here until you take control again.')).toBeNull();
    expect(board.disabled).toBe(true); // a new connection alone is not sufficient
    act(() => ws.accept());
    expect(board.disabled).toBe(true);
    act(() => ws.receive({ type: 'pvp_hello', fen: START, history: [], your_color: 'white', time_control: 'untimed' }));
    expect(board.disabled).toBe(false);
  });
});
