// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const socketHarness = vi.hoisted(() => ({
  current: null as null | {
    connected: boolean;
    connectCalls: number;
    disconnectCalls: number;
    sent: { type: string; uci?: string }[];
    accept(): void;
    drop(): void;
    receive(message: Record<string, unknown>): void;
  },
}));
const lobbyHarness = vi.hoisted(() => ({
  refreshUsers: vi.fn(), refreshChallenges: vi.fn(),
  online: new Set<number>(), users: [], incoming: [], outgoing: [],
}));

vi.mock('../state/auth', () => ({
  useAuth: () => ({ user: {
    id: 1, profile: { display_name: 'Tester', board_theme: 'green', audience: 'beginner', blunder_warning: 0, coach_behavior: 'silent' },
  } }),
}));
vi.mock('../state/lobby', () => ({ useLobby: (selector?: (state: typeof lobbyHarness) => unknown) =>
  selector ? selector(lobbyHarness) : { ...lobbyHarness },
}));
vi.mock('../api', () => ({ api: {
  get: (url: string) => Promise.resolve(url === '/api/games/live' ? { bot: null, pvp: [] } : { configured: false }),
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
    sent: { type: string; uci?: string }[] = [];
    constructor(private readonly opts: { onMessage(event: MessageEvent): void; onStatusChange(up: boolean): void }) {
      socketHarness.current = this;
    }
    connect() { this.connectCalls++; this.connected = false; }
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
  },
}));

import Play from './Play';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const snapshot = { type: 'game_started', fen: START, history: [], time_control: 'untimed' };

afterEach(() => { cleanup(); socketHarness.current = null; });

describe('Play authoritative game readiness', () => {
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

  it('blocks early moves until a snapshot, and drops optimistic state when the socket disconnects', () => {
    render(<MemoryRouter initialEntries={['/play']}><Play /></MemoryRouter>);
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

  it('never resigns on the first tap and allows cancellation with a button or Escape', () => {
    render(<MemoryRouter initialEntries={['/play']}><Play /></MemoryRouter>);
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
