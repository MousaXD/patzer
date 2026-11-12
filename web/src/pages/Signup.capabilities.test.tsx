// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../api', () => ({ api: { get, post } }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => true,
  motion: {
    main: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
      <main className={className}>{children}</main>,
  },
}));

import i18n from '../i18n';
import Signup from './Signup';

const openSignup = {
  signup_enabled: true, signup_mode: 'open', email_enabled: true,
  oidc_enabled: false, oidc_only: false, oidc_button_text: null,
};

beforeEach(async () => {
  vi.clearAllMocks();
  get.mockReset();
  await i18n.changeLanguage('en');
});
afterEach(cleanup);

describe('Signup capability checks', () => {
  it('never confuses failed capability checks with disabled registration', async () => {
    get.mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValueOnce(openSignup);
    render(<MemoryRouter initialEntries={['/signup']}><Signup /></MemoryRouter>);
    expect(await screen.findByRole('alert', { name: 'Sign-in options unavailable' })).toBeTruthy();
    expect(screen.queryByLabelText('Username')).toBeNull();
    expect(screen.queryByText(/Sign-up is currently disabled/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('textbox', { name: 'Username' })).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('keeps registration closed after authoritative closed-signup capabilities', async () => {
    get.mockResolvedValueOnce({
      ...openSignup, signup_enabled: false, signup_mode: 'closed',
    });
    render(<MemoryRouter initialEntries={['/signup']}><Signup /></MemoryRouter>);
    expect(await screen.findByRole('link', { name: 'Back to sign in' })).toBeTruthy();
    expect(screen.queryByLabelText('Username')).toBeNull();
    expect(screen.queryByRole('alert', { name: 'Sign-in options unavailable' })).toBeNull();
  });

  it('does not probe invite links until signup capabilities are confirmed', async () => {
    get.mockRejectedValueOnce(new Error('HTTP 503'))
      .mockResolvedValueOnce(openSignup)
      .mockResolvedValueOnce({ valid: true, language: null });
    render(<MemoryRouter initialEntries={['/signup?invite=ABCD-EFGH-JKLM']}><Signup /></MemoryRouter>);
    expect(await screen.findByRole('alert', { name: 'Sign-in options unavailable' })).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]?.[0]).toBe('/api/auth/config');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('textbox', { name: 'Username' });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/auth/invite?code=ABCDEFGHJKLM'));
    expect(get).toHaveBeenCalledTimes(3);
  });
});
