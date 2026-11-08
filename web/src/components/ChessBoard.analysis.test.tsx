// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Chessground } from 'chessground';

const fakeApi = {
  set: vi.fn(),
  setShapes: vi.fn(),
  redrawAll: vi.fn(),
  destroy: vi.fn(),
};
const mounted: { config: any } = { config: null };
vi.mock('chessground', () => ({ Chessground: vi.fn((_el: unknown, config: unknown) => {
  mounted.config = config;
  return fakeApi;
}) }));

import ChessBoard from './ChessBoard';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';

beforeEach(() => {
  vi.clearAllMocks();
  mounted.config = null;
  Element.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, width: 320, height: 320, top: 0, left: 0, right: 320, bottom: 320,
    toJSON() { /* noop */ },
  }) as DOMRect;
  globalThis.ResizeObserver = class {
    observe() { /* noop */ }
    disconnect() { /* noop */ }
    unobserve() { /* noop */ }
  } as unknown as typeof ResizeObserver;
});

describe('ChessBoard opt-in analysis mode', () => {
  it('allows the legal side to move, including black on the next position, without remounting', () => {
    const onMove = vi.fn();
    const { rerender } = render(<ChessBoard fen={START} analysisMode onMove={onMove} />);
    const after = mounted.config.movable.events.after as (from: string, to: string) => void;
    expect(mounted.config.movable.color).toBe('white');
    expect(mounted.config.movable.dests.get('e2')).toContain('e4');
    expect(mounted.config.movable.dests.get('e7')).toBeUndefined();
    expect(mounted.config.premovable.enabled).toBe(false);
    act(() => after('e2', 'e4'));
    expect(onMove).toHaveBeenCalledWith('e2e4');

    rerender(<ChessBoard fen={AFTER_E4} analysisMode onMove={onMove} />);
    const latest = fakeApi.set.mock.calls.at(-1)![0];
    expect(latest.turnColor).toBe('black');
    expect(latest.movable.color).toBe('black');
    expect(latest.movable.dests.get('e7')).toContain('e5');
    act(() => after('e7', 'e5'));
    expect(onMove).toHaveBeenLastCalledWith('e7e5');
    expect(Chessground).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate drops and rolls back invalid/out-of-turn event coordinates', () => {
    const onMove = vi.fn();
    render(<ChessBoard fen={START} analysisMode onMove={onMove} />);
    const after = mounted.config.movable.events.after as (from: string, to: string) => void;
    act(() => after('e7', 'e5'));
    expect(onMove).not.toHaveBeenCalled();
    expect(fakeApi.set).toHaveBeenCalledWith({ fen: START });
    act(() => { after('e2', 'e4'); after('e2', 'e4'); });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith('e2e4');
  });

  it('allows another move after a same-FEN rejected-move reset', () => {
    const onMove = vi.fn();
    const { rerender } = render(<ChessBoard fen={START} analysisMode onMove={onMove} resetKey={0} />);
    const after = mounted.config.movable.events.after as (from: string, to: string) => void;
    act(() => after('e2', 'e4'));
    rerender(<ChessBoard fen={START} analysisMode onMove={onMove} resetKey={1} />);
    act(() => after('d2', 'd4'));
    expect(onMove.mock.calls.map(([uci]) => uci)).toEqual(['e2e4', 'd2d4']);
  });

  it('offers exact promotion selection and cancelling restores the FEN', () => {
    const fen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
    const onMove = vi.fn();
    render(<ChessBoard fen={fen} analysisMode onMove={onMove} />);
    const after = mounted.config.movable.events.after as (from: string, to: string) => void;
    act(() => after('a7', 'a8'));
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('N'));
    expect(onMove).toHaveBeenCalledWith('a7a8n');
  });

  it('keeps last-move highlights, arrows, flipping and size changes available', () => {
    const onMove = vi.fn();
    const { rerender } = render(<ChessBoard fen={START} analysisMode onMove={onMove} size={320} />);
    rerender(<ChessBoard fen={AFTER_E4_E5} analysisMode orientation="black"
      onMove={onMove} size={250} lastMove={['e7', 'e5']}
      arrows={[{ orig: 'g1', dest: 'f3', brush: 'paleBlue' }]} />);
    const latest = fakeApi.set.mock.calls.at(-1)![0];
    expect(latest.orientation).toBe('black');
    expect(latest.lastMove).toEqual(['e7', 'e5']);
    expect(fakeApi.setShapes).toHaveBeenCalledWith([
      { orig: 'g1', dest: 'f3', brush: 'paleBlue' },
    ]);
    expect(Chessground).toHaveBeenCalledTimes(1);
  });

  it('preserves live-game premoves when analysis mode is not requested', () => {
    render(<ChessBoard fen={START} turnColor="white" movable onMove={vi.fn()} />);
    expect(mounted.config.premovable.enabled).toBe(true);
    expect(mounted.config.movable.color).toBe('white');
  });
});
