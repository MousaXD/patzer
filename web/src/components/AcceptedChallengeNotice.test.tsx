// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
}));

import { useLobby } from '../state/lobby';
import AcceptedChallengeNotice from './AcceptedChallengeNotice';

const ready = (gameId: number, deferred: boolean) => ({
  challenge_id: 27, game_id: gameId, your_color: 'white' as const,
  time_control: 'rapid', deferred,
});

function RouteProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="route">{pathname + search}</output>;
}

function mount() {
  return render(<MemoryRouter initialEntries={['/play']}>
    <AcceptedChallengeNotice />
    <RouteProbe />
  </MemoryRouter>);
}

beforeEach(() => {
  useLobby.getState().disconnect();
});
afterEach(() => {
  cleanup();
  useLobby.getState().disconnect();
});

describe('accepted friend challenge navigation during other games', () => {
  it('never interrupts a running game, including when the active game finishes, until Join is chosen', async () => {
    useLobby.setState({ activePlaySession: true, pendingAcceptedNav: ready(121, true) });
    mount();
    expect(screen.getByTestId('route').textContent).toBe('/play');
    expect(screen.getByText('Your friend accepted the challenge. Your new game is ready when you are.')).toBeTruthy();
    await act(async () => { useLobby.getState().setActivePlaySession(false); });
    expect(screen.getByTestId('route').textContent).toBe('/play');
    expect(useLobby.getState().pendingAcceptedNav?.game_id).toBe(121);
    fireEvent.click(screen.getByRole('button', { name: 'Join game' }));
    await waitFor(() => expect(screen.getByTestId('route').textContent).toBe('/play?game=121'));
    expect(useLobby.getState().pendingAcceptedNav).toBeNull();
  });

  it('preserves automatic navigation when no game is active', async () => {
    useLobby.setState({ activePlaySession: false, pendingAcceptedNav: ready(231, false) });
    mount();
    await waitFor(() => expect(screen.getByTestId('route').textContent).toBe('/play?game=231'));
    expect(useLobby.getState().pendingAcceptedNav).toBeNull();
  });

  it('allows a conscious Not now decision without discarding the server-saved game', () => {
    useLobby.setState({ activePlaySession: true, pendingAcceptedNav: ready(312, true) });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.getByTestId('route').textContent).toBe('/play');
    expect(screen.queryByText('Your friend accepted the challenge. Your new game is ready when you are.')).toBeNull();
    expect(useLobby.getState().pendingAcceptedNav).toBeNull();
  });
});
