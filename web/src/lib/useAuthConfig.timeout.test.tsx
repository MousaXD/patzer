// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../api', () => ({ api: { get } }));

import { useAuthConfig } from './useAuthConfig';

const ssoConfig = {
  signup_enabled: false,
  signup_mode: 'closed',
  email_enabled: false,
  oidc_enabled: true,
  oidc_only: true,
  oidc_button_text: null,
};

function Fixture() {
  const { config, loaded, error, retry } = useAuthConfig();
  return (
    <>
      <span>{!loaded ? 'Loading' : error ? 'Unavailable' : config.oidc_only ? 'SSO-only' : 'Password'}</span>
      <button onClick={retry}>Retry</button>
    </>
  );
}

beforeEach(() => {
  get.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('auth capability timeout and stale-request safety', () => {
  it('aborts a permanently stalled server request and offers recovery', async () => {
    let signal: AbortSignal | undefined;
    get.mockImplementation((_path: string, options: RequestInit) => {
      signal = options.signal as AbortSignal;
      return new Promise(() => {});
    });
    render(<Fixture />);
    expect(screen.getByText('Loading')).toBeTruthy();
    expect(signal?.aborted).toBe(false);
    await act(async () => { vi.advanceTimersByTime(8_000); });
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(signal?.aborted).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('does not revive a timed-out request after a successful later retry', async () => {
    let settleOld!: (value: unknown) => void;
    get.mockImplementationOnce(() => new Promise((resolve) => { settleOld = resolve; }))
      .mockResolvedValueOnce(ssoConfig);
    render(<Fixture />);
    await act(async () => { vi.advanceTimersByTime(8_000); });
    expect(screen.getByText('Unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('SSO-only')).toBeTruthy();
    await act(async () => { settleOld({ ...ssoConfig, oidc_only: false }); });
    expect(screen.getByText('SSO-only')).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(2);
  });
});
