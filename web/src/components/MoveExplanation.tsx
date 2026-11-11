// "Why this move?" — the card at the top of Game Review's Moves tab. For the
// current move it says, in words, why the engine classified it the way it
// did (the win-chance numbers behind the label), what the engine wanted
// instead and how that line goes on, and then the coach explains it in plain
// language: what the move does, what it allows, and what the better move
// would have achieved.

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Info, Swords } from 'lucide-react';
import { CLASS_STYLE } from '../lib/classification';
import ClassificationIcon from './ClassificationIcon';
import CoachPanel from './CoachPanel';
import { moveNumberForPly, moveSideForPly } from './review/moveHistoryModel';
import type { AnalyzedMove } from '../types';

/** Lichess win-chance curve (same as the server's cpToWinPct), 0..100 for White.
 * Only real scores are accepted: a missing evaluation is not equality. */
export function whiteWinPct(cp: number): number {
  if (cp >= 9000) return 100;
  if (cp <= -9000) return 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** Win chance before and after the move, for the side that played it. */
export function moverWinPct(move: Pick<AnalyzedMove, 'ply' | 'eval_before_cp' | 'eval_after_cp'>, startFen?: string) {
  if (move.eval_before_cp == null || move.eval_after_cp == null
    || !Number.isFinite(move.eval_before_cp) || !Number.isFinite(move.eval_after_cp)) return null;
  const white = moveSideForPly(move.ply, startFen) === 'white';
  const pov = (cp: number) => (white ? whiteWinPct(cp) : 100 - whiteWinPct(cp));
  const before = Math.round(pov(move.eval_before_cp));
  const after = Math.round(pov(move.eval_after_cp));
  return { before, after, drop: Math.max(0, before - after) };
}

interface Props {
  move: AnalyzedMove;
  /** The player's colour, so the card can say "your move" / "opponent's move". */
  userColor: 'white' | 'black' | null;
  coachConfigured: boolean;
  coachRequest: (() => { url: string; body: Record<string, unknown> }) | null;
  /** Initial position for correct move numbering and mover POV in FEN games. */
  startFen?: string;
  /** "Play from here" link for the position after this move (the one on the
   *  board): play on against Patzer. Absent once the game is over. */
  playFrom?: string;
}

export default function MoveExplanation({ move, userColor, coachConfigured, coachRequest, playFrom, startFen }: Props) {
  const { t } = useTranslation();
  const s = CLASS_STYLE[move.classification];
  const side = moveSideForPly(move.ply, startFen);
  const who = userColor == null
    ? t(side === 'white' ? 'review.why.whiteMove' : 'review.why.blackMove')
    : t(side === userColor ? 'review.why.yourMove' : 'review.why.opponentMove');
  const wp = moverWinPct(move, startFen);
  const pawns = (move.centipawn_loss / 100).toFixed(1);
  // Book, forced and best descriptions are independent of win-chance numbers.
  // Other labels' detailed explanations explicitly require measured odds.
  const reason = wp || ['book', 'forced', 'best'].includes(move.classification)
    ? t(`review.why.${move.classification}`, { before: wp?.before, after: wp?.after, drop: wp?.drop, pawns })
    : t('review.why.evaluationUnavailable');
  const showBest = !!move.best_move_san && move.best_move_san !== move.san;
  const line = move.best_pv?.slice(0, 6).join(' ');
  const num = `${moveNumberForPly(move.ply, startFen)}${side === 'white' ? '.' : '…'}`;

  return (
    <div data-review-move-explanation className="mb-3 rounded-lg border border-chesscom-200 bg-chesscom-50/60 p-3 dark:border-chesscom-700 dark:bg-chesscom-900/40">
      <div className="flex items-center gap-2">
        <ClassificationIcon classification={move.classification} size={28} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wide text-chesscom-500 dark:text-chesscom-300">{who}</div>
          <div className="truncate text-sm font-semibold">
            <span className="font-mono">{num}{move.san}</span>
            <span className={`ml-2 ${s.textClass}`}>{t(`classification.${s.labelKey}`)}</span>
          </div>
        </div>
        {wp && (
          <div className="shrink-0 text-right font-mono text-xs tabular-nums text-chesscom-500 dark:text-chesscom-300" title={t('review.why.winChance')}>
            {wp.before}% → <span className={wp.drop >= 10 ? 'font-bold text-bad' : 'font-semibold text-chesscom-800 dark:text-chesscom-100'}>{wp.after}%</span>
          </div>
        )}
      </div>

      <p className="mt-2 text-sm text-chesscom-800 dark:text-chesscom-100">{reason}</p>

      {showBest && (
        <div className="mt-2 rounded-md bg-white px-2.5 py-1.5 text-xs dark:bg-chesscom-800">
          <span className="text-chesscom-500 dark:text-chesscom-300">{t('review.why.engineWanted')} </span>
          <span className="font-mono font-semibold text-move-best">{move.best_move_san}</span>
          {line && (
            <div className="mt-0.5 font-mono text-[11px] text-chesscom-500 dark:text-chesscom-300">{t('review.why.line')}: {line}</div>
          )}
        </div>
      )}

      {playFrom && (
        <Link to={playFrom} className="btn-secondary mt-2 w-full text-xs">
          <Swords className="h-3.5 w-3.5" /> {t('review.why.playFromHere')}
        </Link>
      )}

      <div className="mt-3 border-t border-chesscom-200 pt-2 dark:border-chesscom-700">
        {coachConfigured ? (
          <>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-chesscom-500 dark:text-chesscom-300">{t('review.why.coachSays')}</div>
            <CoachPanel
              systemConfigured={coachConfigured}
              request={coachRequest}
              autoPlay
              triggerKey={move.ply}
              debounceMs={700}
              compact
            />
          </>
        ) : (
          <p role="note" data-review-coach-unavailable className="flex items-start gap-2 text-xs leading-relaxed text-chesscom-500 dark:text-chesscom-300">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{t('review.why.coachUnavailable')}</span>
          </p>
        )}
      </div>
    </div>
  );
}
