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

type AcceptedNav = { challenge_id: number; game_id: number; your_color: 'white' | 'black'; time_control: string };
type ListStatus = 'loading' | 'ready' | 'error';

interface LobbyState {
  ws: WebSocket | null;
  online: Set<number>;
  users: LobbyUser[];
  usersStatus: ListStatus;
  incoming: Challenge[];
  outgoing: Challenge[];
  challengesStatus: ListStatus;
  pendingAcceptedNav: AcceptedNav | null;
  consumeAcceptedNav: () => AcceptedNav | null;

  connect: (userId: number) => void;
  disconnect: () => void;
  refreshUsers: () => Promise<void>;
  refreshChallenges: () => Promise<void>;
}

export const useLobby = create<LobbyState>((set, get) => {
  // Socket callbacks and REST refreshes can finish after logout, account
  // switch or replacement of a broken connection. The generation stamp
  // fences off all results from that superseded session.
  let currentUserId: number | null = null;
  let generation = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let challengesRequestId = 0;
  let usersRequestId = 0;

  return {
  ws: null,
  online: new Set(),
  users: [],
  usersStatus: 'loading',
  incoming: [],
  outgoing: [],
  challengesStatus: 'loading',
  pendingAcceptedNav: null,
  consumeAcceptedNav: () => {
    const v = get().pendingAcceptedNav;
    if (v) set({ pendingAcceptedNav: null });
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
    };
    ws.onmessage = (ev) => {
      if (epoch !== generation || get().ws !== ws) return;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'presence_update' && Array.isArray(msg.online)) {
        set({ online: new Set(msg.online as number[]) });
        // Update users list with new online flags
        set((s) => ({ users: s.users.map((u) => ({ ...u, online: (msg.online as number[]).includes(u.id) })) }));
      } else if (msg.type === 'challenge_received') {
        set((s) => ({ incoming: [msg.challenge as Challenge, ...s.incoming.filter((c) => c.id !== (msg.challenge as Challenge).id)] }));
        // Reconciliation invalidates any older, still-pending REST snapshot.
        void get().refreshChallenges();
      } else if (msg.type === 'challenge_accepted') {
        set({ pendingAcceptedNav: msg as unknown as AcceptedNav });
        set((s) => ({ outgoing: s.outgoing.filter((c) => c.id !== (msg as { challenge_id: number }).challenge_id) }));
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
      set({ ws: null, online: new Set() });
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
    const ws = get().ws;
    set({
      ws: null, online: new Set(), users: [], incoming: [], outgoing: [],
      usersStatus: 'loading', challengesStatus: 'loading', pendingAcceptedNav: null,
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
      if (current()) set({ users: r.users, usersStatus: 'ready' });
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
    const incoming = inc.status === 'fulfilled' && Array.isArray(inc.value?.challenges);
    const outgoing = out.status === 'fulfilled' && Array.isArray(out.value?.challenges);
    set({
      ...(incoming ? { incoming: inc.value.challenges } : {}),
      ...(outgoing ? { outgoing: out.value.challenges } : {}),
      challengesStatus: incoming && outgoing ? 'ready' : 'error',
    });
  },
};
});
