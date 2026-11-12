// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../api', () => ({ api: { get: mocks.get } }));

import { useLobby, type Challenge } from './lobby';

class FakeSocket {
  static opened: FakeSocket[] = [];
  readonly url: string;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) { this.url = url; FakeSocket.opened.push(this); }
  close() { this.closed = true; this.onclose?.({} as CloseEvent); }
  drop() { this.onclose?.({} as CloseEvent); }
  emit(message: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent); }
}

const invitation = (id: number): Challenge => ({
  id, color: 'white', time_control: 'rapid', status: 'pending', game_id: null, created_at: '2026-11-12',
  from: { id: 3, username: 'other', display_name: 'Opponent', avatar_emoji: '♟' },
  to: { id: 1, username: 'player', display_name: 'Player', avatar_emoji: '♟' },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  FakeSocket.opened = [];
  mocks.get.mockReset().mockResolvedValue({ challenges: [], users: [] });
  useLobby.getState().disconnect();
});
afterEach(() => {
  useLobby.getState().disconnect();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('lobby account and socket lifecycle', () => {
  it('defers accepted challenge navigation when the user is playing an active game', () => {
    useLobby.getState().connect(1);
    const socket = FakeSocket.opened[0]!;
    useLobby.getState().setActivePlaySession(true);
    socket.emit({ type: 'challenge_accepted', challenge_id: 67, game_id: 222, your_color: 'white', time_control: 'rapid' });
    expect(useLobby.getState().pendingAcceptedNav).toMatchObject({
      game_id: 222, challenge_id: 67, deferred: true,
    });
    expect(useLobby.getState().activePlaySession).toBe(true);
    useLobby.getState().disconnect();
    expect(useLobby.getState().pendingAcceptedNav).toBeNull();
  });

  it('rechecks pending invitations while connected and stops polling once they disappear or on sign-out', async () => {
    let shouldExpire = false;
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/challenges/incoming') {
        return Promise.resolve({ challenges: shouldExpire ? [] : [invitation(91)] });
      }
      return Promise.resolve(url === '/api/lobby/users' ? { users: [] } : { challenges: [] });
    });
    useLobby.getState().connect(1);
    FakeSocket.opened[0]!.onopen?.({} as Event);
    await Promise.resolve();
    await Promise.resolve();
    expect(useLobby.getState().incoming.map((c) => c.id)).toEqual([91]);

    const countReads = () => mocks.get.mock.calls.filter(([url]) => url === '/api/challenges/incoming').length;
    expect(countReads()).toBe(1);
    shouldExpire = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(countReads()).toBe(2);
    expect(useLobby.getState().incoming).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(countReads()).toBe(2); // empty lobby does not poll

    useLobby.setState({ incoming: [invitation(92)] });
    useLobby.getState().disconnect();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(countReads()).toBe(2); // logout cancels scheduled work
  });

  it('keeps acknowledged changes ahead of a stale GET and mirrors server replacement of an older sent challenge', async () => {
    let finishIncoming!: (value: { challenges: Challenge[] }) => void;
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/challenges/incoming') return new Promise((resolve) => { finishIncoming = resolve; });
      return Promise.resolve({ challenges: [invitation(12)], users: [] });
    });
    useLobby.getState().connect(1);
    useLobby.setState({ incoming: [invitation(10)] });
    const pending = useLobby.getState().refreshChallenges();
    useLobby.getState().forgetChallenge('incoming', 10);
    expect(useLobby.getState().incoming).toEqual([]);
    finishIncoming({ challenges: [invitation(10)] });
    await pending;
    expect(useLobby.getState().incoming).toEqual([]);

    const old = { ...invitation(12), from: invitation(12).to, to: invitation(12).from };
    const recent = { ...old, id: 13 };
    useLobby.setState({ outgoing: [old] });
    useLobby.getState().recordSentChallenge(recent);
    expect(useLobby.getState().outgoing.map((c) => c.id)).toEqual([13]);
  });

  it('ignores an older player refresh finishing after a newer successful list', async () => {
    let finishOld!: (value: { users: { id: number; username: string; display_name: string; avatar_emoji: string; online: boolean }[] }) => void;
    let requests = 0;
    mocks.get.mockImplementation((url: string) => {
      if (url !== '/api/lobby/users') return Promise.resolve({ challenges: [] });
      if (++requests === 1) return new Promise((resolve) => { finishOld = resolve; });
      return Promise.resolve({ users: [{ id: 7, username: 'current', display_name: 'Current', avatar_emoji: 'pawn', online: true }] });
    });
    useLobby.getState().connect(1);
    const older = useLobby.getState().refreshUsers();
    await useLobby.getState().refreshUsers();
    expect(useLobby.getState().users.map((user) => user.id)).toEqual([7]);
    expect(useLobby.getState().usersStatus).toBe('ready');
    finishOld({ users: [{ id: 8, username: 'obsolete', display_name: 'Obsolete', avatar_emoji: 'pawn', online: false }] });
    await older;
    expect(useLobby.getState().users.map((user) => user.id)).toEqual([7]);
    expect(useLobby.getState().usersStatus).toBe('ready');
  });

  it('surfaces failed player-list loads and recovers after a successful retry', async () => {
    mocks.get.mockRejectedValueOnce(new Error('offline'));
    useLobby.getState().connect(1);
    await useLobby.getState().refreshUsers();
    expect(useLobby.getState().usersStatus).toBe('error');
    mocks.get.mockResolvedValueOnce({ users: [{ id: 3, username: 'peer', display_name: 'Opponent', avatar_emoji: '♟', online: true }] });
    await useLobby.getState().refreshUsers();
    expect(useLobby.getState().usersStatus).toBe('ready');
    expect(useLobby.getState().users).toHaveLength(1);
  });

  it('keeps a successful invitation direction when the other endpoint fails', async () => {
    mocks.get.mockImplementation((url: string) => url.endsWith('/incoming')
      ? Promise.reject(new Error('incoming offline'))
      : Promise.resolve({ challenges: [invitation(83)] }));
    useLobby.getState().connect(1);
    await useLobby.getState().refreshChallenges();
    expect(useLobby.getState().outgoing.map((c) => c.id)).toEqual([83]);
    expect(useLobby.getState().challengesStatus).toBe('error');
    mocks.get.mockResolvedValue({ challenges: [], users: [] });
    await useLobby.getState().refreshChallenges();
    expect(useLobby.getState().challengesStatus).toBe('ready');
    expect(useLobby.getState().outgoing).toEqual([]);
  });

  it('keeps the newest same-account challenge snapshot when requests finish out of order', async () => {
    let resolveOld!: (value: { challenges: Challenge[] }) => void;
    let requests = 0;
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/challenges/incoming') {
        if (++requests === 1) return new Promise((resolve) => { resolveOld = resolve; });
        return Promise.resolve({ challenges: [invitation(52)] });
      }
      return Promise.resolve({ challenges: [], users: [] });
    });
    useLobby.getState().connect(1);
    const old = useLobby.getState().refreshChallenges();
    const latest = useLobby.getState().refreshChallenges();
    await latest;
    expect(useLobby.getState().incoming.map((c) => c.id)).toEqual([52]);

    resolveOld({ challenges: [invitation(11)] });
    await old;
    expect(useLobby.getState().incoming.map((c) => c.id)).toEqual([52]);
  });

  it('never resurrects a cancelled invitation from an older HTTP response after a socket event', async () => {
    let resolveOld!: (value: { challenges: Challenge[] }) => void;
    let requests = 0;
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/challenges/incoming') {
        if (++requests === 1) return new Promise((resolve) => { resolveOld = resolve; });
        return Promise.resolve({ challenges: [] });
      }
      return Promise.resolve({ challenges: [], users: [] });
    });
    useLobby.getState().connect(1);
    const old = useLobby.getState().refreshChallenges();
    const socket = FakeSocket.opened[0]!;
    socket.emit({ type: 'challenge_received', challenge: invitation(60) });
    expect(useLobby.getState().incoming.map((c) => c.id)).toEqual([60]);
    socket.emit({ type: 'challenge_cancelled', challenge_id: 60 });
    expect(useLobby.getState().incoming).toEqual([]);

    resolveOld({ challenges: [invitation(60)] });
    await old;
    expect(useLobby.getState().incoming).toEqual([]);
  });

  it('clears another account’s invitations and never reconnects after deliberate sign-out', () => {
    useLobby.getState().connect(101);
    const oldSocket = FakeSocket.opened[0]!;
    oldSocket.emit({ type: 'challenge_received', challenge: invitation(11) });
    useLobby.setState({
      users: [{ id: 3, username: 'other', display_name: 'Opponent', avatar_emoji: '♟', online: true }],
      outgoing: [invitation(12)],
      pendingAcceptedNav: { challenge_id: 2, game_id: 9, your_color: 'white', time_control: 'rapid', deferred: false },
    });
    expect(useLobby.getState().incoming).toHaveLength(1);

    useLobby.getState().disconnect();
    expect(oldSocket.closed).toBe(true);
    expect(useLobby.getState()).toMatchObject({
      ws: null, users: [], incoming: [], outgoing: [], pendingAcceptedNav: null,
    });
    vi.advanceTimersByTime(6000);
    expect(FakeSocket.opened).toHaveLength(1);
    oldSocket.emit({ type: 'challenge_received', challenge: invitation(13) });
    expect(useLobby.getState().incoming).toEqual([]);
  });

  it('replaces the previous account’s socket and ignores late messages after switching players', () => {
    useLobby.getState().connect(101);
    const previous = FakeSocket.opened[0]!;
    previous.emit({ type: 'challenge_received', challenge: invitation(12) });
    useLobby.getState().connect(101); // same player does not reconnect needlessly
    expect(FakeSocket.opened).toHaveLength(1);

    useLobby.getState().connect(202);
    expect(previous.closed).toBe(true);
    expect(FakeSocket.opened).toHaveLength(2);
    expect(useLobby.getState().incoming).toEqual([]);
    previous.emit({ type: 'challenge_received', challenge: invitation(15) });
    expect(useLobby.getState().incoming).toEqual([]);
    FakeSocket.opened[1]!.emit({ type: 'challenge_received', challenge: invitation(21) });
    expect(useLobby.getState().incoming.map((c) => c.id)).toEqual([21]);
  });

  it('does not reintroduce a previous player’s pending response after switching users', async () => {
    let finish!: (value: { challenges: Challenge[] }) => void;
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/challenges/incoming') return new Promise((resolve) => { finish = resolve; });
      return Promise.resolve({ challenges: [], users: [] });
    });
    useLobby.getState().connect(101);
    const originalRequest = useLobby.getState().refreshChallenges();
    useLobby.getState().connect(202);
    finish({ challenges: [invitation(44)] });
    await originalRequest;
    expect(useLobby.getState().incoming).toEqual([]);
  });

  it('rejects stale user-list responses and socket-open callbacks from a previous account', async () => {
    let finish!: (value: { users: { id: number; username: string; display_name: string; avatar_emoji: string; online: boolean }[] }) => void;
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/lobby/users') return new Promise((resolve) => { finish = resolve; });
      return Promise.resolve({ challenges: [] });
    });
    useLobby.getState().connect(101);
    const previous = FakeSocket.opened[0]!;
    const outstanding = useLobby.getState().refreshUsers();
    useLobby.getState().connect(202);

    previous.onopen?.({} as Event);
    finish({ users: [{ id: 88, username: 'old', display_name: 'Old user', avatar_emoji: '♟', online: true }] });
    await outstanding;
    expect(useLobby.getState().users).toEqual([]);
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith('/api/lobby/users');
    expect(useLobby.getState().ws).toBe(FakeSocket.opened[1]);
  });

  it('reconnects after an accidental disconnect but not after explicitly leaving the lobby', () => {
    useLobby.getState().connect(101);
    FakeSocket.opened[0]!.drop();
    vi.advanceTimersByTime(2999);
    expect(FakeSocket.opened).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.opened).toHaveLength(2);
    expect(useLobby.getState().ws).toBe(FakeSocket.opened[1]);

    useLobby.getState().disconnect();
    vi.advanceTimersByTime(6000);
    expect(FakeSocket.opened).toHaveLength(2);
  });
});
