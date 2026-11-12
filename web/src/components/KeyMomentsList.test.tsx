// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import KeyMomentsList, { type KeyMomentItem } from './KeyMomentsList';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

const moments: KeyMomentItem[] = [
  { ply: 1, san: 'e5', side: 'white', classification: 'mistake',
    cp_loss: 75, win_pct_delta: 12, best_san: 'c5', mine: false, hasWinChanceEvidence: true },
  { ply: 2, san: 'e4', side: 'black', classification: 'best',
    cp_loss: 0, win_pct_delta: 0, best_san: null, mine: true },
];

describe('Key Moments uses the original game starting position', () => {
  it('labels a Black-first FEN from its real fullmove number without changing its relative plies', () => {
    const select = vi.fn();
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 12';
    render(<KeyMomentsList items={moments} current={1} onSelect={select} startFen={startFen} />);
    const first = screen.getByRole('button', { name: /#12… e5/ });
    expect(first.getAttribute('aria-current')).toBe('step');
    const second = screen.getByRole('button', { name: /#13\. e4/ });
    expect(second.hasAttribute('aria-current')).toBe(false);
    expect(first.textContent).toContain('classification.mistake');
    expect(first.className).toContain('focus-visible:outline');
    fireEvent.click(second);
    expect(select).toHaveBeenCalledExactlyOnceWith(2);
    expect(screen.queryByText('#1.')).toBeNull();
  });

  it('preserves the normal White-first numbering and selected-move semantics', () => {
    render(<KeyMomentsList items={moments} current={2} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /#1\. e5/ }).hasAttribute('aria-current')).toBe(false);
    expect(screen.getByRole('button', { name: /#1… e4/ }).getAttribute('aria-current')).toBe('step');
  });

  it('renders its existing translated empty state without fake moves', () => {
    render(<KeyMomentsList items={[]} current={0} onSelect={vi.fn()} />);
    expect(screen.getByText('review.noKeyMoments')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('never displays an unsupported win-chance change from a cached moment', () => {
    const incomplete = { ...moments[0]!, hasWinChanceEvidence: false };
    const { rerender } = render(<KeyMomentsList items={[incomplete]} current={1} onSelect={vi.fn()} />);
    expect(screen.getByRole('button').textContent).toContain('−75cp');
    expect(screen.getByRole('button').textContent).not.toContain('12wp');
    rerender(<KeyMomentsList items={[{ ...moments[0]!, win_pct_delta: Number.NaN }]} current={1} onSelect={vi.fn()} />);
    expect(screen.getByRole('button').textContent).not.toContain('NaN');
    rerender(<KeyMomentsList items={[moments[0]!]} current={1} onSelect={vi.fn()} />);
    expect(screen.getByRole('button').textContent).toContain('12wp');
  });
});
