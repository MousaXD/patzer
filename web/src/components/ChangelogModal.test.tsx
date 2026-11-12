// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../i18n';
import ChangelogModal from './ChangelogModal';

const mockedFetch = vi.fn();

beforeEach(() => {
  mockedFetch.mockReset();
  vi.stubGlobal('fetch', mockedFetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('release notes shell', () => {
  it('displays a human-readable error and retries successfully after a failed HTTP response', async () => {
    mockedFetch.mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, text: async () => '# Patzer 7.20\n- A better experience' });

    render(<ChangelogModal onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Patzer 7.20')).toBeTruthy();
    expect(screen.getByText('A better experience')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('describes a successful empty changelog instead of rendering a blank modal', async () => {
    mockedFetch.mockResolvedValueOnce({ ok: true, text: async () => '   ' });
    render(<ChangelogModal onClose={vi.fn()} />);
    expect(await screen.findByText('No release notes are available yet.')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Release notes' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('cancels an unfinished request when closing the changelog', async () => {
    mockedFetch.mockImplementationOnce(() => new Promise(() => {}));
    const { unmount } = render(<ChangelogModal onClose={vi.fn()} />);
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
    const controllerSignal = (mockedFetch.mock.calls[0]?.[1] as { signal: AbortSignal })?.signal;
    expect(controllerSignal?.aborted).toBe(false);
    unmount();
    expect(controllerSignal?.aborted).toBe(true);
  });
});
