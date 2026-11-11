import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export type ReviewUnavailableReason = 'invalid' | 'unreadable' | 'notFound' | 'loadFailed';

/** Preserve the backend status for retry policy, never for user-facing copy.
 * Missing and inaccessible games are not temporary loading errors. */
export function reviewUnavailableReason(args: {
  gameId: number;
  hasGame: boolean;
  positionsLength: number;
  status?: number;
}): ReviewUnavailableReason {
  if (!Number.isSafeInteger(args.gameId) || args.gameId <= 0) return 'invalid';
  if (args.hasGame && args.positionsLength === 0) return 'unreadable';
  if (args.status === 403 || args.status === 404) return 'notFound';
  return 'loadFailed';
}

interface Props {
  reason: ReviewUnavailableReason;
  /** Only transient network/server failures can be resolved by retrying. */
  onRetry?: () => void;
  retrying?: boolean;
}

/** A single focusable recovery destination for broken or unavailable reviews.
 *  Never leaks raw backend error codes into a translated user interface. */
export default function ReviewUnavailable({ reason, onRetry, retrying = false }: Props) {
  const { t } = useTranslation();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, [reason]);

  return (
    <section role="alert" aria-labelledby="review-unavailable-heading"
      className="mx-auto max-w-xl rounded-xl border border-red-500/30 bg-white p-6 text-chesscom-900 shadow-soft dark:bg-chesscom-800 dark:text-chesscom-100">
      <h1 id="review-unavailable-heading" ref={headingRef} tabIndex={-1}
        className="text-lg font-semibold focus:outline-none">{t('review.unavailableHeading')}</h1>
      <p className="mt-2 text-sm leading-relaxed text-chesscom-600 dark:text-chesscom-300">
        {t(`review.unavailableReason.${reason}`)}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {onRetry && (
          <button type="button" className="btn-primary min-h-11" onClick={onRetry}
            disabled={retrying} aria-busy={retrying}>
            {t(retrying ? 'review.retryingLoading' : 'review.retryLoading')}
          </button>
        )}
        <Link to="/review" className="btn-secondary min-h-11">{t('review.backToGames')}</Link>
      </div>
    </section>
  );
}
