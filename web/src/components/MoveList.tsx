import { Fragment, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import MoveRow from './MoveRow';
import { buildMovePairs, pairIndexForPly } from './review/moveHistoryModel';
import type { PhaseSplit } from '../types';

interface Move { ply: number; san: string; classification?: string }

interface Props {
  moves: Move[];
  current: number;
  onSelect: (ply: number, input: 'keyboard' | 'pointer') => void;
  /** Optional phase split — when present, inserts OPENING / MIDDLEGAME /
   *  ENDGAME divider rows between move-pairs to match chess.com Game Review. */
  phaseSplit?: PhaseSplit | null;
  /** Starting game FEN for correct Black-first and fullmove-number pairing. */
  startFen?: string;
  /** Optional pixel cap; defaults to 420. */
  maxHeight?: number;
  /** Plies to make stand out (the rest is dimmed) — see MoveRow. */
  highlight?: Set<number> | null;
}

// Two-column move-pair-per-row list. The badge sits to the right of each SAN,
// the current half-move is highlighted, and the row's left edge is tinted by
// the worst classification in the pair (matching chess.com Game Review).
export default function MoveList({ moves, current, onSelect, phaseSplit, startFen, maxHeight, highlight }: Props) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (current === 0) scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [current]);
  const rows = buildMovePairs(moves, startFen);

  // Build a map from "move-pair number" to "phase label to insert BEFORE it".
  // The first phase label sits at the top (no insertion above row 1 needed —
  // chess.com renders OPENING as a banner above the list).
  const phaseAtPair: Map<number, 'opening' | 'middlegame' | 'endgame'> = new Map();
  if (phaseSplit?.middlegame?.from_ply) {
    phaseAtPair.set(pairIndexForPly(phaseSplit.middlegame.from_ply, startFen), 'middlegame');
  }
  if (phaseSplit?.endgame?.from_ply) {
    phaseAtPair.set(pairIndexForPly(phaseSplit.endgame.from_ply, startFen), 'endgame');
  }

  return (
    <div
      ref={scrollRef}
      role="region"
      aria-label={t('review.moves', { defaultValue: 'Game move history' })}
      className="max-h-[20rem] overflow-auto overscroll-contain rounded-md border border-chesscom-200 bg-white dark:border-chesscom-700 dark:bg-chesscom-800/60 sm:max-h-[min(55dvh,32rem)]"
      style={maxHeight == null ? undefined : { maxHeight }}
    >
      <div className="sticky top-0 z-10 grid grid-cols-[2.25rem_1fr_1fr] border-b border-chesscom-200 bg-chesscom-50 px-0 py-1 text-[11px] font-semibold uppercase tracking-wide text-chesscom-500 dark:border-chesscom-700 dark:bg-chesscom-900 dark:text-chesscom-300">
        <div />
        <div className="px-2">{t('review.white')}</div>
        <div className="px-2">{t('review.black')}</div>
      </div>
      <button
        type="button"
        onClick={(event) => onSelect(0, event.detail === 0 ? 'keyboard' : 'pointer')}
        aria-current={current === 0 ? 'step' : undefined}
        className={`block min-h-11 w-full px-3 py-2 text-left text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gold-500 ${current === 0 ? 'bg-chesscom-900 text-white dark:bg-chesscom-600 dark:text-white dark:ring-1 dark:ring-inset dark:ring-gold-500/50' : 'text-chesscom-500 hover:bg-chesscom-100 dark:text-chesscom-300 dark:hover:bg-chesscom-700'}`}
      >
        {t('review.startingPosition', { defaultValue: 'Starting position' })}
      </button>
      {moves.length === 0 && <p className="px-3 py-3 text-xs text-chesscom-500 dark:text-chesscom-300">No recorded moves.</p>}
      {phaseSplit?.opening && (
        <PhaseDivider label={t('review.opening')} />
      )}
      {rows.map((r) => {
        const phaseHere = phaseAtPair.get(r.pairIndex);
        return (
          <Fragment key={r.num}>
            {phaseHere && (
              <PhaseDivider label={phaseHere === 'middlegame' ? t('review.middlegame') : t('review.endgame')} />
            )}
            <MoveRow
              num={r.num}
              white={r.white}
              black={r.black}
              current={current}
              onSelect={onSelect}
              highlight={highlight}
            />
          </Fragment>
        );
      })}
    </div>
  );
}

function PhaseDivider({ label }: { label: string }) {
  return (
    <div className="border-b border-t border-chesscom-200 bg-chesscom-50/70 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-chesscom-500 dark:border-chesscom-700 dark:bg-chesscom-900/40 dark:text-chesscom-300">
      {label}
    </div>
  );
}
