import { GLYPH_SVG, styleFor } from '../lib/classification';

interface Props {
  classification: string;
  square: string;
  orientation?: 'white' | 'black';
  size?: 'sm' | 'md';
  /** Optionally guard against an out-of-order variation score. */
  evaluatedFenAfter?: string;
  activeFen?: string;
  /** Disable this when another board layer provides a destination highlight. */
  highlightDestination?: boolean;
  /** Localized description, e.g. "Mistake". */
  label?: string;
}

export interface MarkerGeometry {
  left: number;
  top: number;
  squareLeft: number;
  squareTop: number;
  diameter: number;
}

/** Board percentages, not viewport pixels; deliberately clamps edge badges. */
export function markerGeometry(square: string, orientation: 'white' | 'black', size: 'sm' | 'md'): MarkerGeometry | null {
  if (!/^[a-h][1-8]$/.test(square)) return null;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const flip = orientation === 'black';
  const col = flip ? 7 - file : file;
  const row = flip ? rank : 7 - rank;
  const squareLeft = col * 12.5;
  const squareTop = row * 12.5;
  const diameter = size === 'sm' ? 4 : 5.2;
  return {
    left: Math.max(0, Math.min(100 - diameter, squareLeft + 12.5 - diameter / 2)),
    top: Math.max(0, Math.min(100 - diameter, squareTop - diameter / 2)),
    squareLeft,
    squareTop,
    diameter,
  };
}

/**
 * Overlay inside the exact-size, position:relative chessboard wrapper.
 * Keeps last-move highlighting and chessground arrows intact. No pointer events
 * may be captured by either the outline or the indicator.
 */
export default function ClassificationBadge({
  classification, square, orientation = 'white', size = 'md',
  evaluatedFenAfter, activeFen, highlightDestination = true, label,
}: Props) {
  const style = styleFor(classification);
  const geo = markerGeometry(square, orientation, size);
  if (!style || !geo) return null;
  if (evaluatedFenAfter !== undefined && activeFen !== undefined && evaluatedFenAfter !== activeFen) return null;

  const description = `${label ?? style.labelKey} move to ${square}`;
  return (
    <>
      {highlightDestination && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-[1]"
          style={{
            left: `${geo.squareLeft}%`, top: `${geo.squareTop}%`,
            width: '12.5%', height: '12.5%',
            boxShadow: `inset 0 0 0 2px ${style.hex}b3`,
          }}
        />
      )}
      <div
        className="pointer-events-none absolute z-10"
        role="img"
        aria-label={description}
        title={style.labelKey}
        style={{
          left: `${geo.left}%`, top: `${geo.top}%`,
          width: `${geo.diameter}%`, aspectRatio: '1 / 1',
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 28 28" width="100%" height="100%" style={{ overflow: 'visible' }}>
          <circle cx="14" cy="14" r="12.6" fill={style.hex} stroke="#262626" strokeWidth="2" />
          <g transform="translate(2 2)" color="#ffffff">
            {GLYPH_SVG[style.glyph]}
          </g>
        </svg>
      </div>
    </>
  );
}
