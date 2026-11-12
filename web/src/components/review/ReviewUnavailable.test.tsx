// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ReviewUnavailable, { reviewUnavailableReason, type ReviewUnavailableReason } from './ReviewUnavailable';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(() => cleanup());

function show(reason: ReviewUnavailableReason, onRetry?: () => void, retrying = false) {
  return render(<MemoryRouter><ReviewUnavailable reason={reason} onRetry={onRetry} retrying={retrying} /></MemoryRouter>);
}

describe('Game Review unavailable recovery', () => {
  it.each([
    [{ gameId: NaN, hasGame: false, positionsLength: 0 }, 'invalid'],
    [{ gameId: 0, hasGame: false, positionsLength: 0 }, 'invalid'],
    [{ gameId: 12, hasGame: true, positionsLength: 0 }, 'unreadable'],
    [{ gameId: 12, hasGame: false, positionsLength: 0, status: 404 }, 'notFound'],
    [{ gameId: 12, hasGame: false, positionsLength: 0, status: 403 }, 'notFound'],
    [{ gameId: 12, hasGame: false, positionsLength: 0, status: 503 }, 'loadFailed'],
    [{ gameId: 12, hasGame: false, positionsLength: 0 }, 'loadFailed'],
  ] as const)('classifies a review failure without displaying backend error data', (input, expected) => {
    expect(reviewUnavailableReason(input)).toBe(expected);
  });

  it.each(['invalid', 'unreadable', 'notFound'] as const)(
    'focuses the translated %s recovery message and offers no futile retry', (reason) => {
      show(reason);
      const heading = screen.getByRole('heading', { name: 'review.unavailableHeading' });
      expect(document.activeElement).toBe(heading);
      expect(screen.getByRole('alert').getAttribute('aria-labelledby')).toBe(heading.id);
      expect(screen.getByText(`review.unavailableReason.${reason}`)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'review.retryLoading' })).toBeNull();
      expect(screen.getByRole('link', { name: 'review.backToGames' }).getAttribute('href')).toBe('/review');
    },
  );

  it('allows retry for a transient error and disables duplicate attempts during loading', () => {
    const retry = vi.fn();
    const view = show('loadFailed', retry);
    const button = screen.getByRole('button', { name: 'review.retryLoading' });
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledOnce();
    view.rerender(<MemoryRouter><ReviewUnavailable reason="loadFailed" onRetry={retry} retrying /></MemoryRouter>);
    const busy = screen.getByRole('button', { name: 'review.retryingLoading' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(busy);
    expect(retry).toHaveBeenCalledOnce();
  });
});
