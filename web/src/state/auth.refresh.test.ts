// Auth bootstrap tests exercise the shared store without a real backend.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../api', () => ({ api: { get } }));

import { useAuth } from './auth';

beforeEach(() => {
  get.mockReset();
  vi.useFakeTimers();
  useAuth.setState({ loading: true, setupRequired: null, user: null });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('global bootstrap recovery and concurrency', () => {
  it('exits the loading screen and aborts a permanently stalled setup request', () => {
    get.mockImplementationOnce(() => new Promise(() => {}));
    void useAuth.getState().refresh();
    const signal = (get.mock.calls[0]?.[1] as RequestInit | undefined)?.signal;
    expect(signal?.aborted).toBe(false);
    expect(useAuth.getState().loading).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(signal?.aborted).toBe(true);
    expect(useAuth.getState()).toMatchObject({ loading: false, setupRequired: null, user: null });
  });

  it('expires a stalled session request using the same deadline', async () => {
    get.mockResolvedValueOnce({ setup_required: false })
      .mockImplementationOnce(() => new Promise(() => {}));
    void useAuth.getState().refresh();
    await Promise.resolve();
    expect(get.mock.calls.map((call) => call[0])).toEqual(['/api/setup/status', '/api/auth/me']);
    vi.advanceTimersByTime(10_000);
    expect(useAuth.getState()).toMatchObject({ loading: false, setupRequired: null, user: null });
    expect((get.mock.calls[1]?.[1] as RequestInit).signal?.aborted).toBe(true);
  });

  it('discards late setup responses after a successful new refresh', async () => {
    let resolveOld!: (value: unknown) => void;
    get.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ setup_required: false })
      .mockResolvedValueOnce({ user: null });
    const older = useAuth.getState().refresh();
    const firstSignal = (get.mock.calls[0]?.[1] as RequestInit).signal;
    const newer = useAuth.getState().refresh();
    expect(firstSignal?.aborted).toBe(true);
    await newer;
    expect(useAuth.getState()).toMatchObject({ loading: false, setupRequired: false, user: null });
    resolveOld({ setup_required: true });
    await older;
    expect(useAuth.getState()).toMatchObject({ loading: false, setupRequired: false, user: null });
  });

  it('does not revive a timed-out refresh when its delayed response finally arrives', async () => {
    let resolveOld!: (value: unknown) => void;
    get.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ setup_required: false })
      .mockResolvedValueOnce({ user: null });
    const older = useAuth.getState().refresh();
    vi.advanceTimersByTime(10_000);
    expect(useAuth.getState().setupRequired).toBeNull();
    await useAuth.getState().refresh();
    resolveOld({ setup_required: true });
    await older;
    expect(useAuth.getState()).toMatchObject({ loading: false, setupRequired: false, user: null });
  });
});
