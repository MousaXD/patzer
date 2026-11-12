import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ClassificationIcon from '../ClassificationIcon';
import { CLASS_STYLE } from '../../lib/classification';
import type { Classification } from '../../types';

/** Local key for the icons in this saved game, not a duplicate game report.
 * Show only classifications supported by actual scored moves, and keep the
 * guide collapsed until a learner asks for it. */
export default function ReviewClassificationGuide({ moves }: {
  moves: readonly { classification?: string }[];
}) {
  const { t } = useTranslation();
  const present = new Set(moves.map((move) => move.classification));
  const classifications = (Object.keys(CLASS_STYLE) as Classification[])
    .filter((classification) => present.has(classification))
    .sort((a, b) => CLASS_STYLE[a].order - CLASS_STYLE[b].order);
  if (classifications.length === 0) return null;

  return <details data-review-classification-guide className="mb-3 rounded-md border border-chesscom-200 bg-chesscom-50/60 text-chesscom-700 dark:border-chesscom-700 dark:bg-chesscom-900/40 dark:text-chesscom-200">
    <summary className="flex min-h-11 cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500">
      <CircleHelp className="h-4 w-4 shrink-0" aria-hidden="true" />
      {t('review.moveSymbolGuide')}
    </summary>
    <ul className="grid grid-cols-2 gap-2 border-t border-chesscom-200 p-2 dark:border-chesscom-700">
      {classifications.map((classification) => (
        <li key={classification} className="flex min-w-0 items-center gap-2 rounded-md bg-white/80 px-2 py-2 text-xs dark:bg-chesscom-800/70">
          <ClassificationIcon classification={classification} size={24} />
          <span className="min-w-0 break-words">{t(`classification.${classification}`)}</span>
        </li>
      ))}
    </ul>
  </details>;
}
