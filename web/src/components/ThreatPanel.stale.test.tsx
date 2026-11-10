// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Chess } from 'chess.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import ThreatPanel from './ThreatPanel';

vi.mock('../api', () => ({ api: { post: vi.fn() } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('Game Review threat response ownership', () => {
  it('does not display a prior FEN threat after the board changes', async () => {
    vi.useFakeTimers();
    const chess = new Chess();
    chess.move('e4');
    const previousFen = chess.fen();
    vi.mocked(api.post)
      .mockResolvedValueOnce({ lines: [{
        uci: 'd2d4', san: 'd4', pv_san: ['d4'],
        cp: 100, mate: null, multipv: 1,
      }] })
      .mockImplementation(() => new Promise(() => {}));

    const view = render(<ThreatPanel fen={previousFen} currentCpWhite={20} />);
    fireEvent.click(screen.getByText('Show threat'));
    await act(async () => { await vi.advanceTimersByTimeAsync(420); });
    expect(screen.getByText('d4')).toBeTruthy();

    chess.move('e5');
    view.rerender(<ThreatPanel fen={chess.fen()} currentCpWhite={20} />);
    expect(screen.queryByText('d4')).toBeNull();
    expect(screen.getByText('fetching…')).toBeTruthy();
    view.unmount();
  });

  it('offers another attempt after Stockfish fails rather than a blank glyph', async () => {
    vi.useFakeTimers();
    const chess = new Chess();
    chess.move('e4');
    vi.mocked(api.post).mockRejectedValue(new Error('engine temporarily unavailable'));
    const view = render(<ThreatPanel fen={chess.fen()} currentCpWhite={20} />);
    fireEvent.click(screen.getByText('Show threat'));
    await act(async () => { await vi.advanceTimersByTimeAsync(420); });
    expect(screen.getByRole('status').textContent).toContain('could not evaluate this threat');
    fireEvent.click(screen.getByText('Retry'));
    await act(async () => { await vi.advanceTimersByTimeAsync(420); });
    expect(api.post).toHaveBeenCalledTimes(2);
    view.unmount();
  });
});
