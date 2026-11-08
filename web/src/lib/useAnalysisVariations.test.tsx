// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { useAnalysisVariations } from './useAnalysisVariations';

function positions(...san: string[]) {
  const chess = new Chess();
  const items = [{ fen: chess.fen() }];
  for (const move of san) {
    chess.move(move);
    items.push({ fen: chess.fen() });
  }
  return items;
}

describe('useAnalysisVariations integration contract', () => {
  it('exposes FEN, errors, submit, navigation, restore and persisted local alternatives', () => {
    const original = positions('e4', 'e5');
    const { result } = renderHook(() => useAnalysisVariations({ positions: original, gameKey: 'game-1' }));
    act(() => result.current.selectOriginalPly(1));
    act(() => { expect(result.current.submitMove('c7c5')).toBe(true); });
    expect(result.current.activeVariationId).toBe('v1');
    expect(result.current.currentVariationSan).toEqual(['c5']);
    act(() => result.current.undo());
    expect(result.current.variationCursor).toBe(0);
    act(() => result.current.redo());
    expect(result.current.currentVariationUci).toEqual(['c7c5']);
    act(() => result.current.restoreOriginalGame());
    expect(result.current.currentFen).toBe(original[1]!.fen);
    expect(result.current.variations).toHaveLength(1);
    act(() => { expect(result.current.submitMove('c7c9')).toBe(false); });
    expect(result.current.error).toMatch(/Illegal/);
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it('does not leak a previous game variation into a different game', () => {
    const a = positions('e4');
    const b = positions('d4', 'd5');
    const { result, rerender } = renderHook(
      ({ gameKey, boardPositions }) => useAnalysisVariations({ gameKey, positions: boardPositions }),
      { initialProps: { gameKey: 'A', boardPositions: a } },
    );
    act(() => result.current.submitMove('d2d4'));
    expect(result.current.variations).toHaveLength(1);
    rerender({ gameKey: 'B', boardPositions: b });
    expect(result.current.variations).toHaveLength(0);
    expect(result.current.activeVariationId).toBeNull();
    expect(result.current.currentFen).toBe(b[0]!.fen);
  });
});
