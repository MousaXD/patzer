// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('framer-motion', () => ({
  useReducedMotion: () => true,
  motion: {
    main: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
      <main className={className}>{children}</main>,
  },
}));

import i18n from '../i18n';
import ServerUnavailable from './ServerUnavailable';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(cleanup);

describe('shared server-unavailable experience', () => {
  it('explains an unavailable server and retries without suggesting the user logged out', async () => {
    const retry = vi.fn(async () => undefined);
    render(<ServerUnavailable onRetry={retry} />);
    expect(screen.getByRole('alert', { name: 'Server unavailable' })).toBeTruthy();
    expect(screen.getByText(/check that Patzer is running/i)).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Username' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  });

  it('ignores duplicate retry clicks while a request is pending', async () => {
    let finish!: () => void;
    const retry = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<ServerUnavailable onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('button', { name: 'Reconnecting…' }).hasAttribute('disabled')).toBe(true);
    expect(retry).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy());
  });
});
