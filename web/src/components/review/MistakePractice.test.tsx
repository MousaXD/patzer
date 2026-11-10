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
  from: 'e2', to: 'e4', best_move_uci: 'd2d4',
  classification: 'good', centipawn_loss: 4, win_pct_drop: 0.4,
  eval_before_cp: 12, eval_after_cp: 8, depth_before: 12, scoring_version: 9,
  best_move_san: 'd4', is_best: false, best_pv: ['d4', 'd5'],
};

describe('blind retry UX', () => {
  it('offers legal piece/square choices without score symbols to keyboard and screen-reader users', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ quality }) }));
    render(<MistakePractice fenBefore={fen} orientation="white" onExit={vi.fn()} />);
    fireEvent.click(screen.getByText(/Or choose a piece and destination/));
    const origins = screen.getByLabelText('Piece to move') as HTMLSelectElement;
    expect(origins.options).toHaveLength(11); // 8 pawns + 2 knights + placeholder.
    expect(screen.queryByText(/Engine-preferred move/)).toBeNull();
    fireEvent.change(origins, { target: { value: 'e2' } });
    const destination = screen.getByLabelText('Destination square') as HTMLSelectElement;
    expect(Array.from(destination.options).map((option) => option.textContent)).toEqual(['Choose a square', 'e3', 'e4']);
    fireEvent.change(destination, { target: { value: 'e4' } });
    fireEvent.click(screen.getByText('Play chosen move'));
    await waitFor(() => expect(screen.getByText(/Engine assessment/)).toBeTruthy());
  });

  it('does not disclose a forced mate in the legal-move selector before attempting it', () => {
    const game = new Chess();
    for (const san of ['f3', 'e5', 'g4']) game.move(san);
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    const { container } = render(<MistakePractice fenBefore={game.fen()} orientation="black" onExit={vi.fn()} />);
    fireEvent.click(screen.getByText(/Or choose a piece and destination/));
    expect(container.textContent).not.toContain('Qh4#');
    expect(Array.from(screen.getAllByRole('option')).map((option) => option.textContent).join(' ')).not.toMatch(/[+#]/);
    fireEvent.change(screen.getByLabelText('Piece to move'), { target: { value: 'd8' } });
    expect(screen.getByRole('option', { name: 'h4' })).toBeTruthy();
    expect(container.textContent).not.toContain('Qh4#');
    fireEvent.change(screen.getByLabelText('Destination square'), { target: { value: 'h4' } });
    expect(container.textContent).not.toContain('Qh4#');
    fireEvent.click(screen.getByText('Play chosen move'));
    expect(screen.getByText(/Your move:/).textContent).toContain('Qh4#'); // Revealed only AFTER committing the move.
  });

  it('requires an explicit promotion choice and permits legal underpromotion', async () => {
    const promotionFen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)).move_uci as string);
      return new Promise(() => undefined);
    }));
    render(<MistakePractice fenBefore={promotionFen} orientation="white" onExit={vi.fn()} />);
    fireEvent.click(screen.getByText(/Or choose a piece and destination/));
    fireEvent.change(screen.getByLabelText('Piece to move'), { target: { value: 'a7' } });
    fireEvent.change(screen.getByLabelText('Destination square'), { target: { value: 'a8' } });
    expect((screen.getByRole('button', { name: 'Play chosen move' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Promote to'), { target: { value: 'n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play chosen move' }));
    await waitFor(() => expect(requests).toEqual(['a7a8n']));
    expect(screen.getByText(/Your move:/).textContent).toContain('a8=N');
  });

  it('aborts an obsolete attempt and ignores late engine success after cancel and retry', async () => {
    const replies: Array<(value: unknown) => void> = [];
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
      signals.push(options.signal as AbortSignal);
      return new Promise((resolve) => replies.push(resolve));
    }));
    render(<MistakePractice fenBefore={fen} orientation="white" onExit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Type a legal chess move/), { target: { value: 'e4' } });
    fireEvent.click(screen.getByText('Submit move'));
    await waitFor(() => expect(signals).toHaveLength(1));
    fireEvent.click(screen.getByText('Cancel check and try another move'));
    expect(signals[0]?.aborted).toBe(true);
    replies[0]?.({ ok: true, json: async () => ({ quality }) });
    expect(screen.queryByText(/Engine assessment/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Type a legal chess move/), { target: { value: 'e4' } });
    fireEvent.click(screen.getByText('Submit move'));
    await waitFor(() => expect(signals).toHaveLength(2));
    replies[1]?.({ ok: true, json: async () => ({ quality }) });
    await waitFor(() => expect(screen.getByText(/Engine assessment/)).toBeTruthy());
  });

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
    fireEvent.change(screen.getByLabelText(/Type a legal chess move/), { target: { value: 'e7e5' } });
    fireEvent.click(screen.getByText('Submit move'));
    expect(screen.getByRole('alert').textContent).toContain('not legal');
    fireEvent.change(screen.getByLabelText(/Type a legal chess move/), { target: { value: 'e4' } });
    fireEvent.click(screen.getByText('Submit move'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('did not match'));
    expect(screen.queryByText(/Engine-preferred move/)).toBeNull();
    fireEvent.click(screen.getByText('Try another move'));
    expect(screen.getByText('Submit move')).toBeTruthy();
  });
});
