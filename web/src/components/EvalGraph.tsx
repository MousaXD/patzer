import { useMemo, useState } from 'react';
import { buildEvalGraphPoints, scoredEvalSegments, evalPlyAtRatio, type EvalSample } from './review/evalGraphModel';
import { useTranslation } from 'react-i18next';
import { styleFor } from '../lib/classification';

interface Mistake { ply: number; classification: string }

interface Props {
  evals: EvalSample[];
  current?: number;
  /** Keep keyboard slider scrubbing separate from pointer selection: a phone
   * tap can reveal the board without stealing focus after each arrow key. */
  onClick?: (ply: number, input: 'keyboard' | 'pointer') => void;
  /** Plies where blunders/mistakes/inaccuracies happened, drawn as colored dots. */
  markers?: Mistake[];
  /** Pixel height; defaults to 96 (chess.com Game Review). */
  height?: number;
}

function fmtCp(cp: number | null): string {
  if (cp == null) return '0.0';
  if (cp >= 9000) {
    const moves = Math.max(1, Math.round((10000 - cp) / 10));
    return `M${moves}`;
  }
  if (cp <= -9000) {
    const moves = Math.max(1, Math.round((10000 - Math.abs(cp)) / 10));
    return `-M${moves}`;
  }
  const sign = cp > 0 ? '+' : cp < 0 ? '−' : '';
  return `${sign}${(Math.abs(cp) / 100).toFixed(2)}`;
}

// Hand-rolled SVG eval graph — chess.com-style horizontal area chart. White's
// win-share is filled from the top, black's from the bottom, midline at 0.0.
// Mistake/blunder/brilliancy markers are circles colored by class. Hovering
// shows a vertical hairline + chip with the ply's cp value.
export default function EvalGraph({ evals, current, onClick, markers = [], height = 96 }: Props) {
  const { t } = useTranslation();
  const [hoverPly, setHoverPly] = useState<number | null>(null);
  const points = useMemo(() => buildEvalGraphPoints(evals), [evals]);

  if (!points.length) {
    return <div style={{ height }} className="grid w-full place-items-center text-xs text-chesscom-400">{t('review.noEval')}</div>;
  }

  // Only draw measured stretches; missing data is not a drawn position.
  const paths = scoredEvalSegments(points).map((segment) => ({
    line: segment.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(2) + ',' + p.y!.toFixed(2)).join(' '),
    first: segment[0]!.x.toFixed(2),
    last: segment[segment.length - 1]!.x.toFixed(2),
  }));
  const hoverPoint = points.find((point) => point.ply === hoverPly);
  const currentPoint = points.find((point) => point.ply === current);
  const currentX = current === 0 ? 0 : currentPoint?.x;
  const currentLabel = current === undefined
    ? t('review.variationTimelineHint')
    : current === 0
      ? t('review.startingPosition', { defaultValue: 'Starting position' })
      : currentPoint?.cp == null ? t('review.variationEvalUnavailable') : fmtCp(currentPoint.cp);

  function pickPly(clientX: number, rect: DOMRect): number {
    return evalPlyAtRatio(evals, (clientX - rect.left) / rect.width);
  }

  return (
    <div className="relative w-full" style={{ height }}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="block h-full w-full cursor-crosshair focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500"
        role={onClick ? 'slider' : 'img'}
        tabIndex={onClick ? 0 : undefined}
        aria-label={t('review.evalGraph', { defaultValue: 'Move evaluation timeline' })}
        aria-valuemin={onClick ? 0 : undefined}
        aria-valuemax={onClick ? evals[evals.length - 1]?.ply : undefined}
        aria-valuenow={onClick ? current ?? 0 : undefined}
        aria-valuetext={onClick ? currentLabel : undefined}
        onKeyDown={(e) => {
          if (!onClick) return;
          const index = evals.findIndex((v) => v.ply === current);
          const position = current === 0 || index < 0 ? 0 : index + 1;
          let next = position;
          if (e.key === 'ArrowLeft') next = Math.max(0, position - 1);
          else if (e.key === 'ArrowRight') next = Math.min(evals.length, position + 1);
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = evals.length;
          else return;
          e.preventDefault(); e.stopPropagation();
          onClick(next === 0 ? 0 : evals[next - 1]!.ply, 'keyboard');
        }}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHoverPly(pickPly(e.clientX, rect));
        }}
        onPointerLeave={() => setHoverPly(null)}
        onClick={(e) => {
          if (!onClick) return;
          const rect = e.currentTarget.getBoundingClientRect();
          onClick(pickPly(e.clientX, rect), 'pointer');
        }}
      >
        {/* Unknown evaluations are neutral rather than fabricated as equality. */}
        <rect x="0" y="0" width="100" height="100" className="fill-chesscom-100 dark:fill-chesscom-700" />
        {paths.map((path, index) => (
          <g key={index}>
            <path d={path.line + ' L' + path.last + ',0 L' + path.first + ',0 Z'} className="fill-white opacity-95 dark:fill-chesscom-200" />
            <path d={path.line + ' L' + path.last + ',100 L' + path.first + ',100 Z'} className="fill-chesscom-900 opacity-95" />
          </g>
        ))}
        <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(100,116,139,0.40)" strokeWidth="0.4" strokeDasharray="1.5 1.5" />
        {paths.map((path, index) => (
          <path key={index} d={path.line} fill="none" stroke="#7d7670" strokeWidth="0.7" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ))}
        {/* Markers are rendered below with fixed CSS pixel dimensions.
            SVG circles turn into distorted horizontal ovals when this
            full-width graph uses preserveAspectRatio="none". */}
        {/* Ply zero has a cursor, but no invented score. */}
        {currentX !== undefined && (
          <g>
            <line x1={currentX} y1={0} x2={currentX} y2={100} stroke="#ffc934" strokeWidth="0.5" strokeDasharray="1 1" vectorEffect="non-scaling-stroke" />
          </g>
        )}
        {/* Hover hairline */}
        {hoverPoint && hoverPoint.ply !== current && (
          <line x1={hoverPoint.x} y1={0} x2={hoverPoint.x} y2={100} stroke="rgba(125,118,112,0.55)" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {/* These overlays share the graph's percentage coordinates but keep
          true circular pixel geometry on desktop, tablet and mobile. They
          cannot intercept graph clicks, drags or keyboard navigation. */}
      {points.filter((point) => point.y !== null).map((point) => (
        <span key={`sample-${point.ply}`} aria-hidden="true" data-eval-graph-sample
          className="pointer-events-none absolute h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-chesscom-400 dark:bg-chesscom-300"
          style={{ left: `${point.x}%`, top: `${point.y}%` }} />
      ))}
      {markers.map((marker) => {
        const point = points.find((p) => p.ply === marker.ply);
        if (point?.y == null) return null;
        const style = styleFor(marker.classification);
        if (!style) return null;
        return (
          <span key={`marker-${marker.ply}`} aria-hidden="true" data-eval-graph-marker data-ply={marker.ply}
            className={`pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-white dark:ring-chesscom-100 ${marker.classification === 'brilliant' ? 'h-3 w-3' : 'h-2.5 w-2.5'}`}
            style={{ left: `${point.x}%`, top: `${point.y}%`, backgroundColor: style.hex }} />
        );
      })}
      {currentX !== undefined && currentPoint?.y != null && (
        <span aria-hidden="true" data-eval-graph-current
          className="pointer-events-none absolute z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold-500 ring-1 ring-white dark:ring-chesscom-100"
          style={{ left: `${currentX}%`, top: `${currentPoint.y}%` }} />
      )}
      {hoverPly !== null && (
        <div
          className="pointer-events-none absolute top-1 z-30 rounded-sm bg-chesscom-900/90 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-white shadow-soft"
          style={{
            left: 'calc(' + (hoverPoint?.x ?? 0) + '% + 4px)',
            transform: (hoverPoint?.x ?? 0) > 80 ? 'translateX(-100%)' : undefined,
          }}
        >
          {hoverPly === 0 ? t('review.startingPosition', { defaultValue: 'Starting position' }) : (hoverPoint?.cp == null ? '—' : fmtCp(hoverPoint.cp))}
        </div>
      )}
      {currentPoint?.cp != null && (
        <div className="pointer-events-none absolute right-2 top-2 rounded-sm bg-chesscom-900/85 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-white backdrop-blur-sm">
          {fmtCp(currentPoint.cp)}
        </div>
      )}
    </div>
  );
}
