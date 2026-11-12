// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { patch, refresh, navigate, saveLanguage, recentGamesQuery, account, queryCall } = vi.hoisted(() => ({
  patch: vi.fn(),
  refresh: vi.fn(),
  navigate: vi.fn(),
  saveLanguage: vi.fn(),
  account: { id: 1 },
  queryCall: vi.fn(),
  recentGamesQuery: {
    data: { games: [] } as { games: unknown[] } | undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
}));

vi.mock('../api', () => ({ api: { patch, get: vi.fn() } }));
vi.mock('../state/auth', () => ({
  useAuth: () => ({
    user: { id: account.id, username: 'sample-player', role: 'user', profile: { display_name: 'Sample Player' } },
    refresh,
  }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: unknown) => { queryCall(options); return recentGamesQuery; } }));
vi.mock('../lib/logout', () => ({ endSession: vi.fn() }));
vi.mock('../lib/saveInterfaceLanguage', () => ({ saveInterfaceLanguage: saveLanguage }));

import i18n from '../i18n';
import CommandPalette from './CommandPalette';

beforeEach(async () => {
  patch.mockReset();
  refresh.mockReset();
  refresh.mockResolvedValue(undefined);
  navigate.mockReset();
  saveLanguage.mockReset();
  saveLanguage.mockImplementation((language: string) => i18n.changeLanguage(language));
  recentGamesQuery.data = { games: [] };
  recentGamesQuery.isLoading = false;
  recentGamesQuery.isError = false;
  recentGamesQuery.isFetching = false;
  recentGamesQuery.refetch.mockReset();
  account.id = 1;
  queryCall.mockReset();
  await i18n.changeLanguage('en');
});
afterEach(cleanup);

describe('global command palette async actions', () => {
  it('never shares the recent-game query key between different signed-in accounts', () => {
    const view = render(<CommandPalette open onClose={vi.fn()} />);
    expect(queryCall).toHaveBeenLastCalledWith(expect.objectContaining({
      queryKey: ['palette-games', 1], enabled: true,
    }));

    account.id = 2;
    view.rerender(<CommandPalette open onClose={vi.fn()} />);
    expect(queryCall).toHaveBeenLastCalledWith(expect.objectContaining({
      queryKey: ['palette-games', 2], enabled: true,
    }));

    view.rerender(<CommandPalette open={false} onClose={vi.fn()} />);
    expect(queryCall).toHaveBeenLastCalledWith(expect.objectContaining({
      queryKey: ['palette-games', 2], enabled: false,
    }));
  });

  it('distinguishes loading, unavailable and empty recent games without hiding navigation', async () => {
    recentGamesQuery.data = undefined;
    recentGamesQuery.isLoading = true;
    const view = render(<CommandPalette open onClose={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('Loading recent games…');
    expect(screen.getByRole('option', { name: 'Home' })).toBeTruthy();

    recentGamesQuery.isLoading = false;
    recentGamesQuery.isError = true;
    view.rerender(<CommandPalette open onClose={vi.fn()} />);
    const failure = screen.getByRole('alert', { name: 'Recent games unavailable' });
    expect(failure).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry recent games' }));
    expect(recentGamesQuery.refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('option', { name: 'Home' })).toBeTruthy();

    recentGamesQuery.isFetching = true;
    view.rerender(<CommandPalette open onClose={vi.fn()} />);
    const busyRetry = screen.getByRole('button', { name: 'Loading recent games…' });
    expect(busyRetry.hasAttribute('disabled')).toBe(true);
    fireEvent.click(busyRetry);
    expect(recentGamesQuery.refetch).toHaveBeenCalledTimes(1);

    recentGamesQuery.isError = false;
    recentGamesQuery.isFetching = false;
    recentGamesQuery.data = { games: [] };
    view.rerender(<CommandPalette open onClose={vi.fn()} />);
    expect(screen.queryByRole('alert', { name: 'Recent games unavailable' })).toBeNull();
    expect(screen.getByText('No recent games yet.')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Home' })).toBeTruthy();
  });

  it('explains a failed theme change and allows the same action to be retried', async () => {
    patch.mockRejectedValueOnce(new Error('HTTP 503 private diagnostic'))
      .mockResolvedValueOnce({});
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Search' }), { target: { value: 'Dark theme' } });
    const option = await screen.findByRole('option', { name: 'Dark theme' });
    fireEvent.click(option);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('That action could not be completed. Please try again.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('private diagnostic');
    expect(onClose).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledTimes(1);

    fireEvent.click(option);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('announces pending writes and ignores repeated Enter while one is running', async () => {
    let resolvePatch!: (value: unknown) => void;
    patch.mockImplementationOnce(() => new Promise((resolve) => { resolvePatch = resolve; }));
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);
    const input = screen.getByRole('combobox', { name: 'Search' });
    fireEvent.change(input, { target: { value: 'Dark theme' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Search' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('option', { name: 'Dark theme' }).hasAttribute('disabled')).toBe(true);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(patch).toHaveBeenCalledTimes(1);

    await act(async () => { resolvePatch({}); });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('finds native-language actions by English name or accent-free spelling', async () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);
    const input = screen.getByRole('combobox', { name: 'Search' });
    for (const [typed, native] of [
      ['German', 'Deutsch'],
      ['Russian', 'Русский'],
      ['espanol', 'Español'],
      ['Bulgarian', 'Български'],
    ]) {
      fireEvent.change(input, { target: { value: typed } });
      expect(screen.getByRole('option', { name: new RegExp(native) })).toBeTruthy();
    }
    fireEvent.change(input, { target: { value: 'German' } });
    fireEvent.click(screen.getByRole('option', { name: /Deutsch/ }));
    await waitFor(() => expect(i18n.language).toBe('de'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
