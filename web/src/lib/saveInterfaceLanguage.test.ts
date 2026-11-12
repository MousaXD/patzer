import { beforeEach, describe, expect, it, vi } from 'vitest';

const { patch, authState } = vi.hoisted(() => ({
  patch: vi.fn(),
  authState: { user: null as unknown },
}));

vi.mock('../api', () => ({ api: { patch } }));
vi.mock('../state/auth', () => ({
  useAuth: {
    getState: () => ({
      user: authState.user,
      setUser: (user: unknown) => { authState.user = user; },
    }),
  },
}));

import i18n from '../i18n';
import type { User, Language } from '../state/auth';
import { saveInterfaceLanguage } from './saveInterfaceLanguage';

function user(id = 1, language: Language = 'en'): User {
  return {
    id, role: 'user', username: 'sample', created_at: '2026-01-01',
    profile: {
      user_id: id, display_name: 'Sample', avatar_emoji: '',
      language, audience: 'intermediate', chesscom_username: null, lichess_username: null,
      coach_behavior: 'on_demand', tts_enabled: 0, tts_voice: null, tts_rate: 1,
      tts_pitch: 1, board_theme: 'green', piece_set: 'cburnett',
      site_theme: 'light', blunder_warning: 1, sound_enabled: 0,
      sound_set: 'soft', move_sound_set: 'board', kid_piece_emotions: 0,
    },
  };
}

beforeEach(async () => {
  patch.mockReset();
  authState.user = user();
  await i18n.changeLanguage('en');
});

describe('persistent global interface language', () => {
  it('saves the preference and updates the current user without a loading/refresh cycle', async () => {
    const initial = authState.user as User;
    patch.mockResolvedValueOnce({ profile: { ...initial.profile, language: 'de' } });
    await saveInterfaceLanguage('de');
    expect(patch).toHaveBeenCalledWith('/api/settings/profile', { language: 'de' });
    expect((authState.user as User).profile.language).toBe('de');
    expect(i18n.language).toBe('de');
    expect((authState.user as User).id).toBe(initial.id);
  });

  it('preserves an unrelated profile update while a language save is pending', async () => {
    let finish!: (value: unknown) => void;
    patch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const promise = saveInterfaceLanguage('de');
    await vi.waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    authState.user = { ...user(), profile: { ...user().profile, site_theme: 'dark' } };
    finish({ profile: { ...user().profile, language: 'de' } });
    await promise;
    expect((authState.user as User).profile).toMatchObject({ site_theme: 'dark', language: 'de' });
  });

  it('keeps the original language on failed persistence and permits a retry', async () => {
    patch.mockRejectedValueOnce(new Error('HTTP 503'))
      .mockResolvedValueOnce({ profile: { ...user().profile, language: 'es' } });
    await expect(saveInterfaceLanguage('es')).rejects.toThrow('HTTP 503');
    expect((authState.user as User).profile.language).toBe('en');
    expect(i18n.language).toBe('en');
    await saveInterfaceLanguage('es');
    expect((authState.user as User).profile.language).toBe('es');
    expect(i18n.language).toBe('es');
  });

  it('rejects stale responses after a user switch without changing the new account', async () => {
    let finish!: (value: unknown) => void;
    patch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const promise = saveInterfaceLanguage('de');
    await vi.waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    authState.user = user(2);
    finish({ profile: { ...user(1).profile, language: 'de' } });
    await expect(promise).rejects.toThrow('Account changed');
    expect((authState.user as User).id).toBe(2);
    expect(i18n.language).toBe('en');
  });

  it('serializes fast consecutive choices so the last language wins', async () => {
    let finish!: (value: unknown) => void;
    patch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ profile: { ...user().profile, language: 'es' } });
    const first = saveInterfaceLanguage('de');
    const last = saveInterfaceLanguage('es');
    await vi.waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    finish({ profile: { ...user().profile, language: 'de' } });
    await Promise.all([first, last]);
    expect(patch).toHaveBeenCalledTimes(2);
    expect((authState.user as User).profile.language).toBe('es');
    expect(i18n.language).toBe('es');
  });
});
