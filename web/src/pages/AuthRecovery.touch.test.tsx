// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../api', () => ({ api: { post } }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => true,
  motion: {
    main: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
      <main className={className}>{children}</main>,
  },
}));

import i18n from '../i18n';
import ForgotPassword from './ForgotPassword';
import ResetPassword from './ResetPassword';
import VerifyEmail from './VerifyEmail';

function mount(page: 'forgot' | 'reset' | 'verify', url: string) {
  const Component = { forgot: ForgotPassword, reset: ResetPassword, verify: VerifyEmail }[page];
  return render(<MemoryRouter initialEntries={[url]}><Component /></MemoryRouter>);
}
function expectTouchAction(element: HTMLElement, href?: string) {
  expect(element.className).toContain('min-h-11');
  if (href) expect(element.getAttribute('href')).toBe(href);
}

beforeEach(async () => {
  post.mockReset().mockResolvedValue({});
  await i18n.changeLanguage('en');
});
afterEach(cleanup);

describe('public recovery touch targets', () => {
  it('preserves the forgot-password email semantics, submit guard and back link', () => {
    mount('forgot', '/forgot-password');
    const email = screen.getByRole('textbox', { name: 'Email' });
    expect(email.getAttribute('autocomplete')).toBe('email');
    expect(email.closest('.auth-shell')).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Send reset link' });
    expectTouchAction(submit);
    expect(submit.hasAttribute('disabled')).toBe(true);
    expectTouchAction(screen.getByRole('link', { name: 'Back to sign in' }), '/login');
  });

  it('preserves the forgot-password confirmation route and back target', async () => {
    mount('forgot', '/forgot-password');
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'tester@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await screen.findByRole('heading', { name: 'Check your inbox' });
    expect(post).toHaveBeenCalledWith('/api/auth/forgot', { email: 'tester@example.org' });
    expectTouchAction(screen.getByRole('link', { name: 'Back to sign in' }), '/login');
  });

  it('keeps the missing-token recovery action large and directed to a new reset request', () => {
    mount('reset', '/reset-password');
    expectTouchAction(screen.getByRole('link', { name: 'Request a new link' }), '/forgot-password');
  });

  it('preserves reset-password field semantics and submit conditions', () => {
    mount('reset', '/reset-password?token=unit-token');
    const fields = [screen.getByLabelText('New password'), screen.getByLabelText('Confirm password')];
    for (const field of fields) {
      expect(field.getAttribute('type')).toBe('password');
      expect(field.getAttribute('autocomplete')).toBe('new-password');
      expect(field.closest('.auth-shell')).toBeTruthy();
    }
    const submit = screen.getByRole('button', { name: 'Set new password' });
    expectTouchAction(submit);
    expect(submit.hasAttribute('disabled')).toBe(true);
  });

  it('retains the reset confirmation sign-in link', async () => {
    mount('reset', '/reset-password?token=unit-token');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'strong-password-123' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'strong-password-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    await screen.findByRole('heading', { name: 'Password updated' });
    expect(post).toHaveBeenCalledWith('/api/auth/reset', { token: 'unit-token', password: 'strong-password-123' });
    expectTouchAction(screen.getByRole('link', { name: 'Log in' }), '/login');
  });

  it('keeps resend-verification email entry and back navigation touch-sized', () => {
    mount('verify', '/verify-email');
    const email = screen.getByRole('textbox', { name: 'Email' });
    expect(email.getAttribute('autocomplete')).toBe('email');
    expect(email.closest('.auth-shell')).toBeTruthy();
    expectTouchAction(screen.getByRole('button', { name: 'Resend verification email' }));
    expectTouchAction(screen.getByRole('link', { name: 'Back to sign in' }), '/login');
  });

  it('preserves the verification email sent confirmation link', async () => {
    mount('verify', '/verify-email');
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'tester@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));
    await screen.findByRole('heading', { name: 'Check your inbox' });
    expect(post).toHaveBeenCalledWith('/api/auth/resend-verification', { email: 'tester@example.org' });
    expectTouchAction(screen.getByRole('link', { name: 'Back to sign in' }), '/login');
  });

  it('preserves the token-confirmed login target', async () => {
    mount('verify', '/verify-email?token=unit-token');
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/auth/verify', { token: 'unit-token' }));
    const link = await screen.findByRole('link', { name: 'Log in' });
    expectTouchAction(link, '/login');
  });

  it('preserves recovery when an email verification token is rejected', async () => {
    post.mockRejectedValueOnce(new Error('expired token'));
    mount('verify', '/verify-email?token=bad-token');
    const link = await screen.findByRole('link', { name: 'Resend verification email' });
    expectTouchAction(link, '/verify-email');
  });
});
