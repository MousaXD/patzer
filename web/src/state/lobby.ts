import { create } from 'zustand';
import { api } from '../api';

export interface LobbyUser {
  id: number;
  username: string;
  display_name: string;
  avatar_emoji: string;
  online: boolean;
}

export interface Challenge {
  id: number;
  color: 'white' | 'black' | 'random';
  time_control: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  game_id: number | null;
  created_at: string;
  from: { id: number; username: string; display_name: string; avatar_emoji: string };
  to:   { id: number; username: string; display_name: string; avatar_emoji: string };
}

type AcceptedNav = {
  challenge_id: number;
  game_id: number;
  your_color: 'white' | 'black';
  time_control: string;
  /** Do not automatically replace a currently active board. */
  deferred: boolean;
};
type ListStatus = 'loading' | 'ready' | 'error';

function isPendingChallenge(value: unknown): value is Challenge {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<Challenge>;
  const sender = c.from;
  const recipient = c.to;
  return Number.isSafeInteger(c.id) && Number(c.id) > 0
    && c.status === 'pending'
    && (c.color === 'white' || c.color === 'black' || c.color === 'random')
    && typeof c.time_control === 'string' && c.time_control.length > 0
    && !!sender && Number.isSafeInteger(sender.id)
    && typeof sender.username === 'string'
    && typeof sender.display_name === 'string'
    && typeof sender.avatar_emoji === 'string'
    && !!recipient && Number.isSafeInteger(recipient.id)
    && typeof recipient.username === 'string'
    && typeof recipient.display_name === 'string'
    && typeof recipient.avatar_emoji === 'string'
    && typeof c.created_at === 'string'
    && (c.game_id === null || Number.isSafeInteger(c.game_id));
}

function isPendingChallengeList(value: unknown): value is { challenges: Challenge[] } {
  if (!value || typeof value !== 'object') return false;
  const { challenges } = value as { challenges?: unknown };
  return Array.isArray(challenges) && challenges.every(isPendingChallenge);
}

interface LobbyState {
  ws: WebSocket | null;
  online: Set<number>;
  /** True only after a current-socket presence snapshot has arrived. */
  presenceReady: boolean;
  users: LobbyUser[];
  usersStatus: ListStatus;
  incoming: Challenge[];
  outgoing: Challenge[];
  activePlaySession: boolean;
  setActivePlaySession: (active: boolean) => void;
  challengesStatus: ListStatus;
  pendingAcceptedNav: AcceptedNav | null;
  queuedAcceptedNavs: AcceptedNav[];
  consumeAcceptedNav: () => AcceptedNav | null;

  connect: (userId: number) => void;
  disconnect: () => void;
  refreshUsers: () => Promise<void>;
  refreshChallenges: () => Promise<void>;
  forgetChallenge: (direction: 'incoming' | 'outgoing', id: number) => void;
  recordSentChallenge: (challenge: Challenge) => void;
}

export const useLobby = create<LobbyState>((set, get) => {
  // Socket callbacks and REST refreshes can finish after logout, account
  // switch or replacement of a broken connection. The generation stamp
  // fences off all results from that superseded session.
  let currentUserId: number | null = null;
  let generation = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let challengeRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let challengesRequestId = 0;
  let usersRequestId = 0;

  return {
  ws: null,
  online: new Set(),
  presenceReady: false,
  users: [],
  usersStatus: 'loading',
  incoming: [],
  outgoing: [],
  activePlaySession: false,
  setActivePlaySession: (active) => set({ activePlaySession: active }),
  challengesStatus: 'loading',
  pendingAcceptedNav: null,
  queuedAcceptedNavs: [],
  consumeAcceptedNav: () => {
    const v = get().pendingAcceptedNav;
    if (v) set((s) => ({
      pendingAcceptedNav: s.queuedAcceptedNavs[0] ?? null,
      queuedAcceptedNavs: s.queuedAcceptedNavs.slice(1),
    }));
    return v;
  },

  connect: (userId) => {
    if (!Number.isSafeInteger(userId) || userId <= 0) return;
    if (currentUserId !== userId) {
      get().disconnect();
      currentUserId = userId;
    }
    if (get().ws || reconnectTimer !== null) return;
    if (typeof window === 'undefined') return;
    const epoch = ++generation;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/lobby`);
    set({ ws });
    ws.onopen = () => {
      if (epoch !== generation || get().ws !== ws) return;
      void get().refreshUsers();
      void get().refreshChallenges();
      // GET /challenges expires old invitations. An always-open tab might
      // otherwise show an unanswerable modal long after its 15-minute TTL.
      // Poll only while there is a pending invitation; empty lobbies stay idle.
      if (challengeRefreshTimer !== null) clearInterval(challengeRefreshTimer);
      challengeRefreshTimer = setInterval(() => {
        if (epoch !== generation || get().ws !== ws || currentUserId !== userId) return;
        if (get().incoming.length || get().outgoing.length) void get().refreshChallenges();
      }, 60_000);
    };
    ws.onmessage = (ev) => {
      if (epoch !== generation || get().ws !== ws) return;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'presence_update' && Array.isArray(msg.online)
        && msg.online.every((id) => Number.isSafeInteger(id) && id > 0)) {
        set({ online: new Set(msg.online as number[]), presenceReady: true });
        // Update users list with new online flags
        set((s) => ({ users: s.users.map((u) => ({ ...u, online: (msg.online as number[]).includes(u.id) })) }));
      } else if (msg.type === 'challenge_received') {
        // Ignore incomplete/malformed socket payloads instead of inserting a
        // broken invitation that could crash the global modal for everyone.
        if (!isPendingChallenge(msg.challenge)) return;
        const challenge = msg.challenge;
        set((s) => ({ incoming: [challenge, ...s.incoming.filter((c) => c.id !== challenge.id)] }));
        // Reconciliation invalidates any older, still-pending REST snapshot.
        void get().refreshChallenges();
      } else if (msg.type === 'challenge_accepted') {
        if (!Number.isSafeInteger(msg.game_id) || Number(msg.game_id) <= 0) return;
        const acceptedId = msg.challenge_id as number;
        if (!Number.isSafeInteger(acceptedId) || acceptedId <= 0) return;
        set((s) => {
          const outgoing = s.outgoing.filter((c) => c.id !== acceptedId);
          // Repeated WS delivery must not queue the same still-pending game
          // twice. Different accepted games are handled in arrival order.
          if (s.pendingAcceptedNav?.challenge_id === acceptedId
            || s.queuedAcceptedNavs.some((c) => c.challenge_id === acceptedId)) return { outgoing };
          const accepted: AcceptedNav = {
            ...(msg as unknown as Omit<AcceptedNav, 'deferred'>),
            deferred: s.activePlaySession || s.pendingAcceptedNav !== null,
          };
          if (!s.pendingAcceptedNav) return { outgoing, pendingAcceptedNav: accepted };
          // Keep the notification queue bounded; every extra accepted game is
          // still persisted in /api/games/live for eventual discovery.
          if (s.queuedAcceptedNavs.length >= 19) return { outgoing };
          return { outgoing, queuedAcceptedNavs: [...s.queuedAcceptedNavs, accepted] };
        });
        void get().refreshChallenges();
      } else if (msg.type === 'challenge_declined') {
        set((s) => ({ outgoing: s.outgoing.filter((c) => c.id !== (msg as { challenge_id: number }).challenge_id) }));
        void get().refreshChallenges();
      } else if (msg.type === 'challenge_cancelled') {
        set((s) => ({ incoming: s.incoming.filter((c) => c.id !== (msg as { challenge_id: number }).challenge_id) }));
        void get().refreshChallenges();
      }
    };
    ws.onclose = () => {
      if (epoch !== generation || get().ws !== ws) return;
      if (challengeRefreshTimer !== null) clearInterval(challengeRefreshTimer);
      challengeRefreshTimer = null;
      // A dropped socket is not evidence that previously online opponents
      // went offline. Their cached HTTP data may be useful, but their live
      // presence is now unverified until the next socket snapshot arrives.
      set({ ws: null, online: new Set(), presenceReady: false });
      // Only an unexpectedly dropped *current* session may reconnect. An
      // explicit logout and a switch to another player invalidate this epoch.
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (currentUserId === userId && generation === epoch && !get().ws) get().connect(userId);
      }, 3000);
    };
    ws.onerror = () => { /* swallow; close handler will reconnect */ };
  },

  disconnect: () => {
    currentUserId = null;
    generation++;
    challengesRequestId++;
    usersRequestId++;
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (challengeRefreshTimer !== null) clearInterval(challengeRefreshTimer);
    challengeRefreshTimer = null;
    const ws = get().ws;
    set({
      ws: null, online: new Set(), presenceReady: false,
      users: [], incoming: [], outgoing: [],
      usersStatus: 'loading', challengesStatus: 'loading', pendingAcceptedNav: null,
      queuedAcceptedNavs: [],
      activePlaySession: false,
    });
    if (ws) try { ws.close(); } catch { /* ignore */ }
  },

  refreshUsers: async () => {
    const userId = currentUserId;
    const epoch = generation;
    const requestId = ++usersRequestId;
    if (userId === null) return;
    set({ usersStatus: 'loading' });
    const current = () => currentUserId === userId && generation === epoch && usersRequestId === requestId;
    try {
      const r = await api.get<{ users: LobbyUser[] }>('/api/lobby/users');
      if (!r || !Array.isArray(r.users)) throw new Error('invalid player list');
      if (current()) set((s) => ({
        // An HTTP list started before a live presence event can complete
        // afterward. Never let its older online flags override the current
        // socket's authoritative snapshot.
        users: s.presenceReady
          ? r.users.map((u) => ({ ...u, online: s.online.has(u.id) }))
          : r.users,
        usersStatus: 'ready',
      }));
    } catch {
      // A network failure is not evidence that nobody can be challenged.
      // Retain the last successful list and expose a retryable error.
      if (current()) set({ usersStatus: 'error' });
    }
  },

  refreshChallenges: async () => {
    const userId = currentUserId;
    const epoch = generation;
    // Within one account, concurrent requests also finish out of order.
    // Only the latest started read can replace the challenge snapshot.
    const requestId = ++challengesRequestId;
    if (userId === null) return;
    set({ challengesStatus: 'loading' });
    const [inc, out] = await Promise.allSettled([
      api.get<{ challenges: Challenge[] }>('/api/challenges/incoming'),
      api.get<{ challenges: Challenge[] }>('/api/challenges/outgoing'),
    ]);
    if (currentUserId !== userId || epoch !== generation || requestId !== challengesRequestId) return;
    // Each direction is independent: an incoming-list outage must never
    // discard a healthy outgoing response (or overwrite the last good list).
    const incoming = inc.status === 'fulfilled' && isPendingChallengeList(inc.value);
    const outgoing = out.status === 'fulfilled' && isPendingChallengeList(out.value);
    set({
      ...(incoming ? { incoming: inc.value.challenges } : {}),
      ...(outgoing ? { outgoing: out.value.challenges } : {}),
      challengesStatus: incoming && outgoing ? 'ready' : 'error',
    });
  },

  forgetChallenge: (direction, id) => {
    if (currentUserId === null || !Number.isSafeInteger(id) || id <= 0) return;
    // A completed mutation has newer authority than any old GET already in
    // flight. Fence that snapshot before hiding only the acknowledged row.
    challengesRequestId++;
    if (direction === 'incoming') {
      set((s) => ({ incoming: s.incoming.filter((challenge) => challenge.id !== id) }));
    } else {
      set((s) => ({ outgoing: s.outgoing.filter((challenge) => challenge.id !== id) }));
    }
  },

  recordSentChallenge: (challenge) => {
    if (currentUserId === null || !Number.isSafeInteger(challenge?.id) || challenge.id <= 0
      || !Number.isSafeInteger(challenge.to?.id)) return;
    challengesRequestId++;
    // The server replaces an older pending invitation to the same recipient.
    // Mirror that rule so a failed list refresh cannot leave two waiting rows.
    set((s) => ({
      outgoing: [challenge, ...s.outgoing.filter((old) =>
        old.id !== challenge.id && old.to.id !== challenge.to.id)],
    }));
  },
};
});
