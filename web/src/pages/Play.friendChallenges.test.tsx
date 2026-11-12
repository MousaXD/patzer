// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  post: vi.fn(), del: vi.fn(), account: 1,
  refreshChallenges: vi.fn(), refreshUsers: vi.fn(),
  forgetChallenge: vi.fn(), recordSentChallenge: vi.fn(),
  lobby: {
    online: new Set<number>([2]),
    usersStatus: 'ready' as 'ready' | 'loading' | 'error',
    challengesStatus: 'ready' as 'ready' | 'loading' | 'error',
    users: [
      { id: 2, username: 'peer', display_name: 'Opponent', avatar_emoji: '♟', online: true },
    ],
    incoming: [] as unknown[], outgoing: [] as unknown[],
  },
}));

vi.mock('../api', () => ({ api: { post: mocks.post, del: mocks.del } }));
vi.mock('../state/lobby', () => ({ useLobby: () => ({
  ...mocks.lobby, refreshChallenges: mocks.refreshChallenges, refreshUsers: mocks.refreshUsers,
  forgetChallenge: mocks.forgetChallenge, recordSentChallenge: mocks.recordSentChallenge,
}) }));
vi.mock('../state/auth', () => ({ useAuth: () => ({ user: { id: mocks.account } }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

import { FriendTab } from './Play';

beforeEach(() => {
  mocks.account = 1;
  mocks.lobby.usersStatus = 'ready';
  mocks.lobby.challengesStatus = 'ready';
  mocks.lobby.users = [{ id: 2, username: 'peer', display_name: 'Opponent', avatar_emoji: '♟', online: true }];
  mocks.post.mockReset();
  mocks.del.mockReset();
  mocks.refreshChallenges.mockReset().mockResolvedValue(undefined);
  mocks.refreshUsers.mockReset().mockResolvedValue(undefined);
  mocks.forgetChallenge.mockReset().mockImplementation((direction: 'incoming' | 'outgoing', id: number) => {
    mocks.lobby[direction] = mocks.lobby[direction].filter((row: any) => row.id !== id);
  });
  mocks.recordSentChallenge.mockReset().mockImplementation((challenge: { to?: { id?: number } } | null) => {
    if (!Number.isSafeInteger(challenge?.to?.id)) return;
    mocks.lobby.outgoing = [challenge, ...mocks.lobby.outgoing];
  });
  mocks.lobby.incoming = [];
  mocks.lobby.outgoing = [];
});
afterEach(() => { cleanup(); });

describe('Play friend challenges request recovery', () => {
  it('removes confirmed declined and cancelled invitations even when the list refresh is offline', async () => {
    mocks.lobby.incoming = [{
      id: 10, color: 'white', time_control: 'rapid',
      from: { id: 2, display_name: 'Opponent', avatar_emoji: 'pawn' },
    }];
    mocks.lobby.outgoing = [{
      id: 11, color: 'black', time_control: 'blitz',
      to: { id: 2, display_name: 'Opponent', avatar_emoji: 'pawn' },
    }];
    mocks.post.mockResolvedValue({ ok: true });
    mocks.del.mockResolvedValue({ ok: true });
    mocks.refreshChallenges.mockRejectedValue(new Error('still offline'));
    const page = render(<FriendTab onChallengeAccepted={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'challenge.decline' }));
    await waitFor(() => expect(mocks.forgetChallenge).toHaveBeenCalledWith('incoming', 10));
    expect(mocks.lobby.incoming).toEqual([]);
    page.rerender(<FriendTab onChallengeAccepted={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    await waitFor(() => expect(mocks.forgetChallenge).toHaveBeenCalledWith('outgoing', 11));
    expect(mocks.lobby.outgoing).toEqual([]);
    expect(mocks.refreshChallenges).toHaveBeenCalledTimes(2);
  });

  it('shows a server-confirmed sent invitation in Waiting even if refreshing challenges fails', async () => {
    const challenge = {
      id: 21, color: 'white', time_control: 'rapid', status: 'pending',
      to: { id: 2, display_name: 'Opponent', avatar_emoji: 'pawn' },
    };
    mocks.post.mockResolvedValue({ challenge });
    mocks.refreshChallenges.mockRejectedValue(new Error('offline'));
    const page = render(<FriendTab onChallengeAccepted={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Opponent/ }));
    fireEvent.click(screen.getByRole('button', { name: 'challenge.send' }));
    await waitFor(() => expect(mocks.recordSentChallenge).toHaveBeenCalledExactlyOnceWith(challenge));
    page.rerender(<FriendTab onChallengeAccepted={vi.fn()} />);
    expect(mocks.lobby.outgoing).toHaveLength(1);
    expect(screen.getByText('challenge.waiting')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeTruthy();
  });

  it('shows a player-fetch failure and retry instead of claiming nobody can be challenged', () => {
    mocks.lobby.usersStatus = 'error';
    mocks.lobby.users = [];
    render(<FriendTab onChallengeAccepted={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('Could not load players');
    expect(screen.queryByText('challenge.noPlayers')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading players' }));
    expect(mocks.refreshUsers).toHaveBeenCalledTimes(1);
  });

  it('shows a challenge-list failure and a direct retry without hiding existing invitations', () => {
    mocks.lobby.challengesStatus = 'error';
    mocks.lobby.incoming = [{
      id: 12, color: 'white', time_control: 'rapid',
      from: { id: 2, display_name: 'Opponent', avatar_emoji: '♟' },
    }];
    render(<FriendTab onChallengeAccepted={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('Could not refresh challenges');
    expect(screen.getByRole('button', { name: 'challenge.accept' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading challenges' }));
    expect(mocks.refreshChallenges).toHaveBeenCalledTimes(1);
  });

  it('does not open the old player\'s accepted game after a shared-browser account switch', async () => {
    let confirm!: (value: unknown) => void;
    mocks.lobby.incoming = [{
      id: 10, color: 'white', time_control: 'rapid',
      from: { id: 2, display_name: 'Opponent', avatar_emoji: '♟' },
    }];
    mocks.post.mockImplementation(() => new Promise((resolve) => { confirm = resolve; }));
    const navigate = vi.fn();
    const page = render(<FriendTab onChallengeAccepted={navigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'challenge.accept' }));
    mocks.account = 3;
    page.rerender(<FriendTab onChallengeAccepted={navigate} />);
    await act(async () => { confirm({ game_id: 802 }); await Promise.resolve(); });
    expect(navigate).not.toHaveBeenCalled();
    expect(mocks.refreshChallenges).not.toHaveBeenCalled();
  });

  it('explains a failed invitation, preserves the selected opponent, and allows one deliberate retry', async () => {
    mocks.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ challenge: { id: 20 } });
    render(<FriendTab onChallengeAccepted={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Opponent/ }));
    const send = screen.getByRole('button', { name: 'challenge.send' });
    fireEvent.click(send);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not send your challenge');
    expect(mocks.post).toHaveBeenCalledWith('/api/challenges', {
      to_user_id: 2, color: 'random', time_control: 'rapid',
    });
    expect((screen.getByRole('button', { name: /Opponent/ }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    expect((send as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect((await screen.findByRole('status')).textContent).toContain('Challenge sent');
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.refreshChallenges).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate invitations while pending and treats a confirmed send as success even if the list refresh fails', async () => {
    let confirm!: (value: unknown) => void;
    mocks.post.mockImplementation(() => new Promise((resolve) => { confirm = resolve; }));
    mocks.refreshChallenges.mockRejectedValue(new Error('list offline'));
    render(<FriendTab onChallengeAccepted={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Opponent/ }));
    const send = screen.getByRole('button', { name: 'challenge.send' }) as HTMLButtonElement;
    fireEvent.click(send);
    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    confirm({ challenge: { id: 22 } });
    expect((await screen.findByRole('status')).textContent).toContain('Challenge sent');
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(send.disabled).toBe(true)); // no target is selected after the successful send
    expect(mocks.refreshChallenges).toHaveBeenCalledTimes(1);
  });

  it('never opens a game on a failed accept, but retries the same incoming invitation', async () => {
    mocks.lobby.incoming = [{
      id: 10, color: 'white', time_control: 'rapid',
      from: { id: 2, display_name: 'Opponent', avatar_emoji: '♟' },
    }];
    mocks.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ game_id: 802 });
    const openGame = vi.fn();
    render(<FriendTab onChallengeAccepted={openGame} />);
    fireEvent.click(screen.getByRole('button', { name: 'challenge.accept' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not accept this challenge');
    expect(openGame).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'challenge.accept' }));
    await waitFor(() => expect(openGame).toHaveBeenCalledExactlyOnceWith(802));
    expect(mocks.post.mock.calls.map(([url]) => url)).toEqual(['/api/challenges/10/accept', '/api/challenges/10/accept']);
  });

  it('keeps failed decline and cancellation visible with an actionable error', async () => {
    mocks.lobby.incoming = [{
      id: 10, color: 'white', time_control: 'rapid',
      from: { id: 2, display_name: 'Opponent', avatar_emoji: '♟' },
    }];
    mocks.lobby.outgoing = [{
      id: 11, color: 'black', time_control: 'blitz',
      to: { id: 2, display_name: 'Opponent', avatar_emoji: '♟' },
    }];
    mocks.post.mockRejectedValueOnce(new Error('offline'));
    mocks.del.mockRejectedValueOnce(new Error('offline'));
    render(<FriendTab onChallengeAccepted={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'challenge.decline' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not decline this challenge');
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not cancel this challenge');
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/api/challenges/10/decline');
    expect(mocks.del).toHaveBeenCalledExactlyOnceWith('/api/challenges/11');
    expect(mocks.refreshChallenges).not.toHaveBeenCalled();
  });
});
