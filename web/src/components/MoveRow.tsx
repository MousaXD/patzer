import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { styleFor } from '../lib/classification';
import ClassificationIcon from './ClassificationIcon';

interface Move { ply: number; san: string; classification?: string }

interface Props {
  num: number;
  white?: Move;
  black?: Move;
  current: number;
  onSelect: (ply: number, input: 'keyboard' | 'pointer') => void;
  /** Plies singled out by a game report filter; others are dimmed. */
  highlight?: Set<number> | null;
}

export default function MoveRow({ num, white, black, current, onSelect, highlight }: Props) {
  const { t } = useTranslation();
  const wCur = white?.ply === current;
  const bCur = black?.ply === current;
  const ref = useRef<HTMLDivElement | null>(null);

  // Scroll only the move list, not the outer rail, when stepping through moves.
  useEffect(() => {
    if (!(wCur || bCur)) return;
    const el = ref.current;
    if (!el) return;
    let scroller: HTMLElement | null = el.parentElement;
    while (scroller && scroller !== document.body) {
      const cs = getComputedStyle(scroller);
      if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break;
      scroller = scroller.parentElement;
    }
    if (!scroller || scroller === document.body) return;
    const elRect = el.getBoundingClientRect();
    const scRect = scroller.getBoundingClientRect();
    if (elRect.top >= scRect.top && elRect.bottom <= scRect.bottom) return;
    const target = scroller.scrollTop + (elRect.top - scRect.top) - scroller.clientHeight / 2 + el.offsetHeight / 2;
    // Keyboard replay can fire faster than animations finish. Keep focus
    // tracking immediate so the move list never appears to fight navigation.
    scroller.scrollTo({ top: target, behavior: 'auto' });
  }, [wCur, bCur]);

  return (
    <div ref={ref} className={cn(
      'grid grid-cols-[2.25rem_1fr_1fr] items-stretch border-b border-chesscom-100 dark:border-chesscom-800',
      pickTint(white?.classification, black?.classification),
    )}>
      <div className="flex items-center justify-end pr-2 text-xs tabular-nums text-chesscom-400 dark:text-chesscom-300">{num}.</div>
      <Half move={white} num={num} side="white" current={wCur} onSelect={onSelect} t={t} highlight={highlight} />
      <Half move={black} num={num} side="black" current={bCur} onSelect={onSelect} t={t} highlight={highlight} />
    </div>
  );
}

function Half({ move, num, side, current, onSelect, t, highlight }: {
  move?: Move;
  num: number;
  side: 'white' | 'black';
  current: boolean;
  onSelect: (p: number, input: 'keyboard' | 'pointer') => void;
  t: (key: string) => string;
  highlight?: Set<number> | null;
}) {
  if (!move) return <div />;
  const style = styleFor(move.classification);
  const label = style ? t(`classification.${style.labelKey}`) : null;
  const picked = !!highlight?.has(move.ply);
  const dimmed = !!highlight && !picked && !current;
  return (
    <button
      type="button"
      onClick={(event) => onSelect(move.ply, event.detail === 0 ? 'keyboard' : 'pointer')}
      aria-current={current ? 'step' : undefined}
      aria-label={`${num}${side === 'white' ? '.' : '…'} ${t(`review.${side}`)} ${move.san}${label ? `: ${label}` : ''}`}
      title={label ?? undefined}
      className={cn(
        'group flex min-h-11 min-w-0 items-center justify-between gap-1.5 px-2 py-2 text-left text-sm transition-colors focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500',
        current
          ? 'bg-chesscom-900 text-white dark:bg-chesscom-600 dark:text-white dark:ring-1 dark:ring-inset dark:ring-gold-500/50'
          : 'hover:bg-chesscom-100 dark:hover:bg-chesscom-800',
        picked && !current && 'bg-gold-50 ring-1 ring-inset ring-gold-500/60 dark:bg-gold-700/15',
        dimmed && 'opacity-35',
      )}
    >
      <span className="truncate font-medium tabular-nums">{move.san}</span>
      {style && <ClassificationIcon classification={style.labelKey} size={24} />}
    </button>
  );
}

// Severity order: blunder/miss > mistake > inaccuracy > brilliant > great.
function pickTint(a?: string, b?: string): string {
  const sev = (c?: string) =>
    c === 'blunder' || c === 'miss' ? 5 :
    c === 'mistake' ? 4 :
    c === 'inaccuracy' ? 3 :
    c === 'brilliant' ? 2 :
    c === 'great' ? 1 : 0;
  const worst = Math.max(sev(a), sev(b));
  if (worst === 5) return 'shadow-[inset_3px_0_0_0_theme(colors.move.blunder)]';
  if (worst === 4) return 'shadow-[inset_3px_0_0_0_theme(colors.move.mistake)]';
  if (worst === 3) return 'shadow-[inset_3px_0_0_0_theme(colors.move.inaccuracy)]';
  if (worst === 2) return 'shadow-[inset_3px_0_0_0_theme(colors.move.brilliant)]';
  if (worst === 1) return 'shadow-[inset_3px_0_0_0_theme(colors.move.great)]';
  return '';
}
