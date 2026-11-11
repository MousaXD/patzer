import type { Classification } from '../types';
import { CLASS_STYLE, GLYPH_SVG } from '../lib/classification';
import great from '../assets/move-classifications/great.svg';
import best from '../assets/move-classifications/best.svg';
import excellent from '../assets/move-classifications/excellent.svg';
import good from '../assets/move-classifications/good.svg';
import book from '../assets/move-classifications/book.svg';
import inaccuracy from '../assets/move-classifications/inaccuracy.svg';
import mistake from '../assets/move-classifications/mistake.svg';
import blunder from '../assets/move-classifications/blunder.svg';
import miss from '../assets/move-classifications/miss.svg';
import forced from '../assets/move-classifications/forced.svg';

// These are the approved, standalone 32px SVGs. Brilliant was not part of the
// ten-icon review set: retain Patzer's existing lightning glyph for that tier.
export const MOVE_ICON_SOURCES: Record<Exclude<Classification, 'brilliant'>, string> = {
  great, best, excellent, good, book, inaccuracy, mistake, blunder, miss, forced,
};

interface Props {
  classification: Classification;
  size?: number | string;
  className?: string;
}

/** Purely decorative pictogram; surrounding controls provide localized labels. */
export default function ClassificationIcon({ classification, size = 24, className }: Props) {
  const style = { width: size, height: size, flexShrink: 0 as const, display: 'block' };
  if (classification !== 'brilliant') {
    return (
      <img
        src={MOVE_ICON_SOURCES[classification]}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={className}
        style={style}
      />
    );
  }
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className} style={style}>
      <circle cx="16" cy="16" r="15" fill={CLASS_STYLE.brilliant.hex} />
      <circle cx="16" cy="16" r="14.3" fill="none" stroke="#fff" strokeOpacity=".22" strokeWidth="1.4" />
      <g transform="translate(4 4)" color="#fff">{GLYPH_SVG.lightning}</g>
    </svg>
  );
}
