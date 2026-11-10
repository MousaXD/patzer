// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth, type Profile } from '../state/auth';

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  changeLanguage: vi.fn(),
}));

vi.mock('../api', () => ({
  api: { patch: mocks.patch },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? ({
      'settings.displayName': 'Display name',
      'settings.saved': 'Saved',
      'settings.unsaved': 'Unsaved changes',
      'settings.noChanges': 'No changes',
      'common.save': 'Save',
    } as Record<string, string>)[key] ?? key,
    i18n: { changeLanguage: mocks.changeLanguage, getFixedT: () => () => '' },
  }),
}));
vi.mock('../lib/tts', () => ({
  getVoices: () => [],
  onVoicesReady: () => () => {},
  speak: () => null,
}));
vi.mock('../lib/audioPreferences', () => ({
  isAudioThemeExplicit: () => false,
}));
vi.mock('../lib/sounds', () => ({
  getAudioTheme: () => 'natural',
  getAudioVolume: () => 0.65,
  getAudioLoadState: () => 'ready',
  previewAudio: () => Promise.resolve(true),
  setAudioTheme: () => {},
  setAudioVolume: () => {},
  setSoundEnabled: () => {},
}));

import Settings from './Settings';

const initialProfile: Profile = {
  user_id: 7,
  display_name: 'Initial',
  avatar_emoji: '♟',
  language: 'en',
  audience: 'beginner',
  chesscom_username: null,
  lichess_username: null,
  coach_behavior: 'on_demand',
  tts_enabled: 0,
  tts_voice: null,
  tts_rate: 1,
  tts_pitch: 1,
  board_theme: 'wood',
  piece_set: 'cburnett',
  site_theme: 'light',
  blunder_warning: 1,
  sound_enabled: 1,
  sound_set: 'classic',
  move_sound_set: 'classic',
  kid_piece_emotions: 0,
};

function nameInput() {
  return screen.getByRole('textbox', { name: 'Display name' }) as HTMLInputElement;
}

beforeEach(() => {
  mocks.patch.mockReset();
  mocks.changeLanguage.mockReset();
  mocks.changeLanguage.mockResolvedValue(undefined);
  useAuth.setState({
    user: {
      id: 7,
      username: 'tester',
      role: 'user',
      created_at: '2026-01-01T00:00:00.000Z',
      profile: { ...initialProfile },
    },
    loading: false,
    setupRequired: false,
  });
});
afterEach(() => { cleanup(); });

describe('Settings persistence', () => {
  it('keeps new edits and Save available when an older PATCH finishes', async () => {
    let finish!: (value: { profile: Profile }) => void;
    mocks.patch.mockReturnValueOnce(new Promise<{ profile: Profile }>((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ profile: { ...initialProfile, display_name: 'Newer draft' } });
    render(<Settings />);

    fireEvent.change(nameInput(), { target: { value: 'First draft' } });
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    fireEvent.click(save);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.patch.mock.calls[0]?.[1]).toMatchObject({ display_name: 'First draft' });
    fireEvent.change(nameInput(), { target: { value: 'Newer draft' } });
    fireEvent.click(save);
    expect(mocks.patch).toHaveBeenCalledTimes(1);

    await act(async () => { finish({ profile: { ...initialProfile, display_name: 'First draft' } }); });
    expect(nameInput().value).toBe('Newer draft');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(useAuth.getState().user?.profile.display_name).toBe('First draft');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
    expect(mocks.patch).toHaveBeenCalledTimes(2);
    expect(mocks.patch.mock.calls[1]?.[1]).toMatchObject({ display_name: 'Newer draft' });
    expect(useAuth.getState().user?.profile.display_name).toBe('Newer draft');
  });

  it('leaves the draft intact after a failed PATCH and saves it on retry', async () => {
    mocks.patch.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
      profile: { ...initialProfile, display_name: 'Retried' },
    });
    render(<Settings />);
    fireEvent.change(nameInput(), { target: { value: 'Retried' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(nameInput().value).toBe('Retried');
    expect(useAuth.getState().user?.profile.display_name).toBe('Initial');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
    expect(useAuth.getState().user?.profile.display_name).toBe('Retried');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not misreport a persisted save when applying the language fails', async () => {
    mocks.patch.mockResolvedValue({ profile: { ...initialProfile, display_name: 'Updated' } });
    mocks.changeLanguage.mockRejectedValueOnce(new Error('browser i18n unavailable'));
    render(<Settings />);
    fireEvent.change(nameInput(), { target: { value: 'Updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(useAuth.getState().user?.profile.display_name).toBe('Updated');
  });

  it('does not overwrite an unsaved draft when auth refreshes for the same user', () => {
    render(<Settings />);
    fireEvent.change(nameInput(), { target: { value: 'Local draft' } });
    act(() => {
      const previous = useAuth.getState().user!;
      useAuth.setState({ user: { ...previous, profile: { ...previous.profile, display_name: 'External update' } } });
    });
    expect(nameInput().value).toBe('Local draft');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('ignores an old account save failure after switching accounts and allows the new account to save', async () => {
    let rejectOld!: (reason: Error) => void;
    mocks.patch.mockReturnValueOnce(new Promise((_, reject) => { rejectOld = reject; }))
      .mockResolvedValueOnce({ profile: { ...initialProfile, user_id: 8, display_name: 'Second saved' } });
    render(<Settings />);

    fireEvent.change(nameInput(), { target: { value: 'First pending' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mocks.patch).toHaveBeenCalledTimes(1);

    act(() => {
      useAuth.setState({
        user: {
          id: 8, username: 'second', role: 'user', created_at: '2026-01-02T00:00:00.000Z',
          profile: { ...initialProfile, user_id: 8, display_name: 'Second account' },
        },
      });
    });
    expect(nameInput().value).toBe('Second account');
    fireEvent.change(nameInput(), { target: { value: 'Second saved' } });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(useAuth.getState().user?.profile.display_name).toBe('Second saved'));

    await act(async () => { rejectOld(new Error('offline')); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(nameInput().value).toBe('Second saved');
    expect(useAuth.getState().user?.id).toBe(8);
    expect(mocks.patch).toHaveBeenCalledTimes(2);
  });
});
