// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import GlobalRouterError from './GlobalRouterError';

function CrashingRoute(): never {
  throw new Error('INTERNAL_STACK_DETAILS_MUST_NOT_RENDER');
}

function mountFailure() {
  const router = createMemoryRouter([
    { path: '/', element: <CrashingRoute />, errorElement: <GlobalRouterError /> },
  ]);
  return render(<RouterProvider router={router} />);
}

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await i18n.changeLanguage('en');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('last-resort global route error', () => {
  it('shows a branded recovery path instead of technical exception details', async () => {
    mountFailure();
    expect(await screen.findByRole('alert', { name: 'Page unavailable' })).toBeTruthy();
    const heading = screen.getByRole('heading', { name: 'This page could not load' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go home' }).getAttribute('href')).toBe('/');
    expect(document.body.textContent).not.toContain('INTERNAL_STACK_DETAILS_MUST_NOT_RENDER');
    expect(document.body.textContent).not.toContain('Unexpected Application Error');
  });

  it('keeps the recovery options localized', async () => {
    await i18n.changeLanguage('de');
    mountFailure();
    expect(await screen.findByRole('alert', { name: 'Seite nicht verfügbar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Seite neu laden' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Zur Startseite' })).toBeTruthy();
  });
});
