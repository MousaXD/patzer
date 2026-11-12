import { create } from 'zustand';
import { api } from '../api';

export type Role = 'admin' | 'user';
import type { Language } from '../lib/languages';
export type { Language };
export type Audience = 'kid' | 'beginner' | 'intermediate' | 'advanced';
export type CoachBehavior = 'silent' | 'on_demand' | 'always_on_pedagogical';

export type BoardTheme = 'wood' | 'green' | 'blue';
export type SiteTheme = 'light' | 'dark' | 'auto';
export type SoundSet = 'classic' | 'soft';
export type MoveSoundSet = 'classic' | 'board';

export interface Profile {
  user_id: number;
  display_name: string;
  avatar_emoji: string;
  language: Language;
  audience: Audience;
  chesscom_username: string | null;
  lichess_username: string | null;
  coach_behavior: CoachBehavior;
  tts_enabled: number;
  tts_voice: string | null;
  tts_rate: number;
  tts_pitch: number;
  board_theme: BoardTheme;
  piece_set: string;
  site_theme: SiteTheme;
  blunder_warning: number;
  sound_enabled: number;
  sound_set: SoundSet;
  move_sound_set: MoveSoundSet;
  kid_piece_emotions: number;
}

export interface User {
  id: number;
  username: string;
  role: Role;
  created_at: string;
  profile: Profile;
}

interface AuthState {
  loading: boolean;
  setupRequired: boolean | null;
  user: User | null;
  refresh: () => Promise<void>;
  setUser: (u: User | null) => void;
}

// One deadline for both startup requests; the UI must never show an endless
// spinner when the backend or reverse proxy accepts a connection but stalls.
const BOOTSTRAP_TIMEOUT_MS = 10_000;

export const useAuth = create<AuthState>((set) => {
  let currentRequest: AbortController | null = null;
  let refreshGeneration = 0;

  return {
    loading: true,
    setupRequired: null,
    user: null,
    refresh: async () => {
      // Newer auth checks supersede stale ones (including a StrictMode mount).
      const generation = ++refreshGeneration;
      currentRequest?.abort();
      const controller = new AbortController();
      currentRequest = controller;
      let expired = false;
      const isCurrent = () => generation === refreshGeneration && !expired && !controller.signal.aborted;
      const timeout = setTimeout(() => {
        expired = true;
        controller.abort();
        if (generation === refreshGeneration) {
          set({ loading: false, setupRequired: null, user: null });
        }
      }, BOOTSTRAP_TIMEOUT_MS);
      set({ loading: true });

      try {
        const status = await api.get<{ setup_required: boolean }>('/api/setup/status', { signal: controller.signal });
        if (!isCurrent()) return;
        if (typeof status?.setup_required !== 'boolean') throw new Error('Invalid setup status');
        if (status.setup_required) {
          set({ loading: false, setupRequired: true, user: null });
          return;
        }
        const me = await api.get<{ user: User | null }>('/api/auth/me', { signal: controller.signal });
        if (!isCurrent()) return;
        if (!me || !Object.prototype.hasOwnProperty.call(me, 'user')) {
          throw new Error('Invalid session status');
        }
        set({ loading: false, setupRequired: false, user: me.user });
      } catch {
        if (isCurrent()) set({ loading: false, setupRequired: null, user: null });
      } finally {
        clearTimeout(timeout);
        if (currentRequest === controller) currentRequest = null;
      }
    },
    setUser: (u) => set({ user: u }),
  };
});
