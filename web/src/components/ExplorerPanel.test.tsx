// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import ExplorerPanel from './ExplorerPanel';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('Game Review master explorer', () => {
  it('never renders the previous position’s master moves while a new FEN is fetching', async () => {
    vi.useFakeTimers();
    vi.mocked(api.get).mockResolvedValueOnce({
      available: true, total: 10, white: 6, draws: 2, black: 2,
      moves: [{ uci: 'e2e4', san: 'e4', white: 6, draws: 2, black: 2, averageRating: 2300 }],
    });
    const onPreview = vi.fn();
    const view = render(<ExplorerPanel fen="position-one" onPreview={onPreview} />);
    fireEvent.click(screen.getByText('Show master stats'));
    await act(async () => { await vi.advanceTimersByTimeAsync(310); });
    expect(screen.getByRole('button', { name: /Preview master move e4/i })).toBeTruthy();

    fireEvent.focus(screen.getByRole('button', { name: /Preview master move e4/i }));
    expect(onPreview).toHaveBeenCalledWith('e2e4');
    view.rerender(<ExplorerPanel fen="position-two" onPreview={onPreview} />);
    expect(screen.queryByRole('button', { name: /Preview master move e4/i })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(310); });
    view.unmount();
  });

  it('clears board-preview arrows when closing the panel', () => {
    const onPreview = vi.fn();
    render(<ExplorerPanel fen="starting-fen" onPreview={onPreview} />);
    fireEvent.click(screen.getByText('Show master stats'));
    fireEvent.click(screen.getByText('Hide'));
    expect(onPreview).toHaveBeenCalledWith(null);
  });
});
