// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../api', () => ({ api: { get } }));
vi.mock('../state/auth', () => ({ useAuth: () => ({ user: { role: 'user' } }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string; latest?: string; current?: string }) =>
      (options?.defaultValue ?? _key)
        .replace('{{latest}}', options?.latest ?? '')
        .replace('{{current}}', options?.current ?? ''),
  }),
}));

import UpdateNotice from './UpdateNotice';

beforeEach(() => {
  localStorage.clear();
  get.mockReset();
  get.mockResolvedValue({
    enabled: true, updateAvailable: true, current: '7.19.0', latest: '7.20.0',
    checkedAt: null, url: null,
  });
});
afterEach(cleanup);

describe('shared release notice focus behavior', () => {
  it('hands focus to a persistent shell control when dismissed by keyboard', async () => {
    const onKeyboardDismiss = vi.fn();
    render(<UpdateNotice onKeyboardDismiss={onKeyboardDismiss} />);
    const dismiss = await screen.findByRole('button', { name: 'Dismiss until the next release' });
    fireEvent.click(dismiss, { detail: 0 });
    expect(onKeyboardDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Dismiss until the next release' })).toBeNull();
    expect(localStorage.getItem('update.dismissed')).toBe('7.20.0');
  });

  it('does not take over keyboard focus after pointer dismissal', async () => {
    const onKeyboardDismiss = vi.fn();
    render(<UpdateNotice onKeyboardDismiss={onKeyboardDismiss} />);
    const dismiss = await screen.findByRole('button', { name: 'Dismiss until the next release' });
    fireEvent.click(dismiss, { detail: 1 });
    expect(onKeyboardDismiss).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Dismiss until the next release' })).toBeNull();
  });
});
