import { useMemo, useState } from 'react';
import { buildEvalGraphPoints, scoredEvalSegments, evalPlyAtRatio, type EvalSample } from './review/evalGraphModel';
import { useTranslation } from 'react-i18next';
import { styleFor } from '../lib/classification';

interface Mistake { ply: number; classification: string }

interface Props {
  evals: EvalSample[];
  current?: number;
  onClick?: (ply: number) => void;
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
  const currentLabel = current === 0
    ? t('review.startingPosition', { defaultValue: 'Starting position' })
    : currentPoint?.cp == null ? 'Evaluation unavailable' : fmtCp(currentPoint.cp);

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
          onClick(next === 0 ? 0 : evals[next - 1]!.ply);
        }}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHoverPly(pickPly(e.clientX, rect));
        }}
        onPointerLeave={() => setHoverPly(null)}
        onClick={(e) => {
          if (!onClick) return;
          const rect = e.currentTarget.getBoundingClientRect();
          onClick(pickPly(e.clientX, rect));
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
        {/* Scored samples remain visible even when surrounded by missing data. */}
        {points.filter((point) => point.y !== null).map((point) => (
          <circle key={'sample-' + point.ply} cx={point.x} cy={point.y!} r="0.65" fill="#7d7670" />
        ))}
        {/* Mistake / blunder / brilliancy markers */}
        {markers.map((m) => {
          const p = points.find((point) => point.ply === m.ply);
          if (!p || p.y === null) return null;
          const s = styleFor(m.classification);
          if (!s) return null;
          const radius = m.classification === 'brilliant' ? 2.6 : 2.0;
          return (
            <circle
              key={m.ply}
              cx={p.x}
              cy={p.y}
              r={radius}
              fill={s.hex}
              stroke="#fff"
              strokeWidth="0.5"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {/* Ply zero has a cursor, but no invented score. */}
        {currentX !== undefined && (
          <g>
            <line x1={currentX} y1={0} x2={currentX} y2={100} stroke="#ffc934" strokeWidth="0.5" strokeDasharray="1 1" vectorEffect="non-scaling-stroke" />
            {currentPoint?.y != null && (
              <circle cx={currentX} cy={currentPoint.y} r="2.4" fill="#ffc934" stroke="#fff" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
            )}
          </g>
        )}
        {/* Hover hairline */}
        {hoverPoint && hoverPoint.ply !== current && (
          <line x1={hoverPoint.x} y1={0} x2={hoverPoint.x} y2={100} stroke="rgba(125,118,112,0.55)" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {hoverPly !== null && (
        <div
          className="pointer-events-none absolute top-1 rounded-sm bg-chesscom-900/90 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-white shadow-soft"
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
