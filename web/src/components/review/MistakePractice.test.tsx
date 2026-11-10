// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import MistakePractice from './MistakePractice';

vi.mock('../ChessBoard', () => ({ default: ({ onMove, analysisMode }: { onMove: (uci: string) => void; analysisMode: boolean }) => (
  <div data-testid="mock-board"><button disabled={!analysisMode} onClick={() => onMove('e2e4')}>Play e4</button></div>
) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const fen = new Chess().fen();
const afterE4 = (() => { const chess = new Chess(); chess.move('e4'); return chess.fen(); })();
const quality = {
  source: 'variation', fen_before: fen, fen_after: afterE4, uci: 'e2e4', san: 'e4',
  classification: 'good', centipawn_loss: 4, win_pct_drop: 0.4,
  eval_before_cp: 12, eval_after_cp: 8, depth_before: 12, scoring_version: 9,
  best_move_san: 'd4', is_best: false, best_pv: ['d4', 'd5'],
};

describe('blind retry UX', () => {
  it('does not render the answer until after a legal attempt, then shows verified feedback', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ quality }) });
    vi.stubGlobal('fetch', fetcher);
    render(<MistakePractice fenBefore={fen} orientation="white" onExit={vi.fn()} />);
    expect(screen.queryByText(/Engine-preferred move/)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Learn from this mistake' })).toBeTruthy();
    fireEvent.click(screen.getByText('Play e4'));
    await waitFor(() => expect(screen.getByText(/Engine-preferred move/)).toBeTruthy());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetcher.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      fen_before: fen, move_uci: 'e2e4', depth: 12,
    });
    expect(screen.queryByText(/your move matches/i)).toBeNull();
  });

  it('permits an accessible typed legal attempt and rejects stale engine verdict', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ quality: { ...quality, fen_before: afterE4 } }) }));
    render(<MistakePractice fenBefore={fen} orientation="white" onExit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Keyboard alternative/), { target: { value: 'e7e5' } });
    fireEvent.click(screen.getByText('Submit move'));
    expect(screen.getByRole('alert').textContent).toContain('not legal');
    fireEvent.change(screen.getByLabelText(/Keyboard alternative/), { target: { value: 'e2e4' } });
    fireEvent.click(screen.getByText('Submit move'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('did not match'));
    expect(screen.queryByText(/Engine-preferred move/)).toBeNull();
    fireEvent.click(screen.getByText('Try another move'));
    expect(screen.getByText('Submit move')).toBeTruthy();
  });
});
