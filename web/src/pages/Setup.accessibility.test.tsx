// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('framer-motion', () => ({
  useReducedMotion: () => true,
  motion: {
    div: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
      <div className={className}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

import i18n from '../i18n';
import Setup from './Setup';

function mount() {
  return render(<MemoryRouter><Setup /></MemoryRouter>);
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('first-use setup accessibility', () => {
  it('keeps language choices and account fields correctly labeled', () => {
    mount();
    const languages = screen.getByRole('group', { name: 'Language' });
    expect(languages.querySelectorAll('button')).toHaveLength(5);
    expect(languages.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Username' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Display name' })).toBeTruthy();
    expect(screen.getByLabelText('Password').getAttribute('aria-describedby')).toBe('setup-password-hint');
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);
  });

  it('preserves account details across steps and explains an optional AI connection failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: false, error: 'unreachable' }) });
    vi.stubGlobal('fetch', fetchMock);
    mount();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Username' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Username' }), { target: { value: 'testadmin' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Display name' }), { target: { value: 'Test Admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fixture-password-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('textbox', { name: 'Ollama URL' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: /Connect Ollama/ }));
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByRole('textbox', { name: 'Username' }) as HTMLInputElement).value).toBe('testadmin');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Create your admin account' }));
  });

  it('announces the selected language when the administrator switches locale', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Deutsch' }));
    await waitFor(() => expect(screen.getByRole('group', { name: 'Sprache' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Deutsch', pressed: true })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Benutzername' })).toBeTruthy();
  });
});
