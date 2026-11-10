// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../api', () => ({ api: { get, post } }));
import AppUpdates from './AppUpdates';

const base = {
  latestSha: 'a'.repeat(40), deployedSha: 'b'.repeat(40),
  updateAvailable: true, ready: true, status: 'available',
  checkedAt: new Date().toISOString(), automaticSchedule: 'Every 12 hours',
};
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe('Manual Patzer update controls', () => {
  it('never checks or installs until the admin explicitly clicks', async () => {
    get.mockResolvedValueOnce({ ...base, updateAvailable: false, ready: false, status: 'up_to_date' });
    render(<AppUpdates />);
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    await screen.findByText('Patzer is up to date.');
    expect(get).toHaveBeenCalledExactlyOnceWith('/api/admin/local-updates/check');
    expect(screen.queryByRole('button', { name: 'Install verified update' })).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
  it('offers separate installation only after a verified update is found', async () => {
    get.mockResolvedValueOnce(base);
    post.mockResolvedValueOnce({ started: true, targetSha: base.latestSha });
    render(<AppUpdates />);
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    await screen.findByText('A newer, CI-verified update is ready to install.');
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Install verified update' }));
    await screen.findByText(/Update requested. Patzer may restart briefly/);
    await waitFor(() => expect(post).toHaveBeenCalledExactlyOnceWith('/api/admin/local-updates/install'));
  });
  it('does not offer an install action when CI is not finished', async () => {
    get.mockResolvedValueOnce({ ...base, ready: false, status: 'waiting_for_ci' });
    render(<AppUpdates />);
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    await screen.findByText('A newer commit exists, but its checks have not passed yet.');
    expect(screen.queryByRole('button', { name: 'Install verified update' })).toBeNull();
  });
  it('shows a retryable check error without offering an installation', async () => {
    get.mockRejectedValueOnce(new Error('Update checker unavailable'));
    render(<AppUpdates />);
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Update checker unavailable');
    expect(screen.queryByRole('button', { name: 'Install verified update' })).toBeNull();
  });
});
