// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../api', () => ({ api: { get, post } }));
// happy-dom cancels framer-motion's entrance animation on unmount with an
// unhandled AbortError. The animation isn't under test: render a plain div.
vi.mock('framer-motion', () => ({
  useReducedMotion: () => true,
  motion: {
    div: ({ children, className }: { children?: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
    main: ({ children, className }: { children?: React.ReactNode; className?: string }) => <main className={className}>{children}</main>,
  },
}));

import i18n from '../i18n';
import Login from './Login';

const baseConfig = {
  signup_enabled: true,
  signup_mode: 'open',
  email_enabled: true,
  oidc_enabled: false,
  oidc_only: false,
  oidc_button_text: null as string | null,
};

function renderLogin(config: Partial<typeof baseConfig>, url = '/login') {
  get.mockResolvedValue({ ...baseConfig, ...config });
  return render(<MemoryRouter initialEntries={[url]}><Login /></MemoryRouter>);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
});
// Without vitest globals, testing-library can't register its own cleanup.
afterEach(cleanup);

describe('Login page and single sign-on', () => {
  it('keeps five touch-sized, labeled language controls keyboard-accessible before sign-in', async () => {
    renderLogin({});
    await screen.findByLabelText('Username');
    const languageNav = screen.getByRole('navigation', { name: 'Language' });
    const languages = within(languageNav).getAllByRole('button');
    expect(languages).toHaveLength(5);
    for (const button of languages) {
      expect(button.className).toContain('min-h-11');
      expect(button.className).toContain('min-w-11');
      expect(button.getAttribute('aria-label')?.trim()).toBeTruthy();
    }
    const german = within(languageNav).getByRole('button', { name: 'Deutsch' });
    fireEvent.click(german);
    await waitFor(() => expect(document.documentElement.lang).toBe('de'));
    expect(german.getAttribute('aria-pressed')).toBe('true');
  });

  it('gives sign-in and recovery actions a 44px minimum tap area without changing destinations', async () => {
    renderLogin({});
    const submit = await screen.findByRole('button', { name: 'Log in' });
    expect(submit.className).toContain('min-h-11');
    expect(submit.getAttribute('type')).toBe('submit');
    expect(submit.hasAttribute('disabled')).toBe(true);
    for (const [label, target] of [
      ['Create account', '/signup'],
      ['Forgot password?', '/forgot-password'],
    ]) {
      const action = screen.getByRole('link', { name: label });
      expect(action.getAttribute('href')).toBe(target);
      expect(action.className).toContain('min-h-11');
      expect(action.className).toContain('items-center');
    }
  });

  it('keeps password fields touch-sized while retaining their input types and autocomplete', async () => {
    renderLogin({});
    const username = await screen.findByLabelText('Username');
    const password = screen.getByLabelText('Password');
    expect(username.className).toContain('min-h-11');
    expect(password.className).toContain('min-h-11');
    expect(username.getAttribute('autocomplete')).toBe('username');
    expect(password.getAttribute('type')).toBe('password');
    expect(password.getAttribute('autocomplete')).toBe('current-password');
  });

  it('without SSO: the password form only, as before', async () => {
    renderLogin({});
    expect(await screen.findByLabelText('Username')).toBeTruthy();
    expect(screen.queryByText('Sign in with SSO')).toBeNull();
  });

  it('with SSO: the button with the operator label, then the password form', async () => {
    renderLogin({ oidc_enabled: true, oidc_button_text: 'Sign in with Authentik' });
    const button = await screen.findByText('Sign in with Authentik');
    expect(button.closest('a')?.getAttribute('href')).toBe('/api/auth/oidc/start');
    expect(screen.getByText('or')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('SSO only: no password form, no sign-up or reset links, translated default label', async () => {
    await i18n.changeLanguage('de');
    renderLogin({ oidc_enabled: true, oidc_only: true, signup_enabled: false, email_enabled: false });
    const sso = await screen.findByText('Mit SSO anmelden');
    expect(sso.closest('a')?.getAttribute('href')).toBe('/api/auth/oidc/start');
    expect(sso.closest('a')?.className).toContain('min-h-11');
    expect(screen.queryByLabelText('Passwort')).toBeNull();
    expect(screen.queryByRole('button', { name: /anmelden/i })).toBeNull();
    expect(screen.queryByText('oder')).toBeNull();
  });

  it('explains a failed SSO login from the ?sso_error= the server redirected with', async () => {
    renderLogin({ oidc_enabled: true }, '/login?sso_error=not_provisioned');
    expect(await screen.findByText(/don't have a Patzer account yet/)).toBeTruthy();
  });

  it('explains that the admin has to sign in first', async () => {
    renderLogin({ oidc_enabled: true, oidc_only: true }, '/login?sso_error=admin_first');
    expect(await screen.findByText(/waiting for its administrator to sign in first/)).toBeTruthy();
  });

  it('tells a rate-limited user to wait', async () => {
    renderLogin({ oidc_enabled: true }, '/login?sso_error=rate_limited');
    expect(await screen.findByText(/Too many attempts/)).toBeTruthy();
  });

  it('an unknown error code still says something useful', async () => {
    renderLogin({ oidc_enabled: true }, '/login?sso_error=whatever');
    expect(await screen.findByText(/Single sign-on didn't work/)).toBeTruthy();
  });

  it('hides password and SSO controls after a failed capability request, then retries into SSO-only', async () => {
    get.mockReset();
    get.mockRejectedValueOnce(new Error('HTTP 503'))
      .mockResolvedValueOnce({
        ...baseConfig, oidc_enabled: true, oidc_only: true,
        signup_enabled: false, signup_mode: 'closed', email_enabled: false,
      });
    render(<MemoryRouter initialEntries={['/login']}><Login /></MemoryRouter>);
    expect(await screen.findByRole('alert', { name: 'Sign-in options unavailable' })).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.queryByText('Sign in with SSO')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Sign in with SSO')).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('treats incomplete capabilities as unavailable, not a password-enabled server', async () => {
    get.mockReset();
    get.mockResolvedValueOnce({ signup_enabled: false, oidc_only: false });
    render(<MemoryRouter initialEntries={['/login']}><Login /></MemoryRouter>);
    expect(await screen.findByRole('alert', { name: 'Sign-in options unavailable' })).toBeTruthy();
    expect(screen.queryByLabelText('Username')).toBeNull();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });
});
