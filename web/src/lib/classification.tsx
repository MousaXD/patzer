// Shared classification palette, accessible names, and scalable vector glyphs.
// Evaluation graphs, move rows, board markers and statistics use the same data.
import type { ReactNode } from 'react';
import type { Classification } from '../types';

export interface ClassificationStyle {
  bgClass: string;
  textClass: string;
  hex: string;
  glyph: GlyphKind;
  labelKey: Classification;
  order: number;
}

export type GlyphKind =
  | 'check' | 'doubleCheck' | 'star' | 'dot' | 'book'
  | 'questionMark' | 'doubleQuestion' | 'inaccuracy' | 'cross'
  | 'lightning' | 'lock';

export const CLASS_STYLE: Record<Classification, ClassificationStyle> = {
  brilliant:  { bgClass: 'bg-move-brilliant',  textClass: 'text-move-brilliant',  hex: '#1baca6', glyph: 'lightning',      labelKey: 'brilliant',  order: 0 },
  great:      { bgClass: 'bg-move-great',      textClass: 'text-move-great',      hex: '#4e9fd7', glyph: 'doubleCheck',    labelKey: 'great',      order: 1 },
  best:       { bgClass: 'bg-move-best',       textClass: 'text-move-best',       hex: '#76bd50', glyph: 'check',          labelKey: 'best',       order: 2 },
  excellent:  { bgClass: 'bg-move-excellent',  textClass: 'text-move-excellent',  hex: '#9fc185', glyph: 'check',          labelKey: 'excellent',  order: 3 },
  good:       { bgClass: 'bg-move-good',       textClass: 'text-move-good',       hex: '#8a9b72', glyph: 'dot',            labelKey: 'good',       order: 4 },
  book:       { bgClass: 'bg-move-book',       textClass: 'text-move-book',       hex: '#b99b73', glyph: 'book',           labelKey: 'book',       order: 5 },
  inaccuracy: { bgClass: 'bg-move-inaccuracy', textClass: 'text-move-inaccuracy', hex: '#f3be41', glyph: 'inaccuracy',     labelKey: 'inaccuracy', order: 6 },
  mistake:    { bgClass: 'bg-move-mistake',    textClass: 'text-move-mistake',    hex: '#ef904e', glyph: 'questionMark',   labelKey: 'mistake',    order: 7 },
  blunder:    { bgClass: 'bg-move-blunder',    textClass: 'text-move-blunder',    hex: '#ee4d44', glyph: 'doubleQuestion', labelKey: 'blunder',    order: 8 },
  miss:       { bgClass: 'bg-move-miss',       textClass: 'text-move-miss',       hex: '#e66558', glyph: 'cross',          labelKey: 'miss',       order: 9 },
  forced:     { bgClass: 'bg-move-forced',     textClass: 'text-move-forced',     hex: '#777b7e', glyph: 'lock',           labelKey: 'forced',     order: 10 },
};

// Every glyph is SVG geometry — no Unicode emoji or browser/system fonts.
// The symbolic ?/??/?! forms are drawn with paths, including their dots.
const QUESTION = <><path d="M7.8 8.6a4.2 4.2 0 1 1 6.2 3.7c-1.4.9-2 1.6-2 3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="19.3" r="1.6" fill="currentColor"/></>;

export const GLYPH_SVG: Record<GlyphKind, ReactNode> = {
  check:          <path d="M5 12.5 L10 17 L19 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />,
  doubleCheck:    <g fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 13 L7 17 L13 9"/><path d="M11 13 L15 17 L21 7"/></g>,
  star:           <path d="M12 3 L14.6 9.5 L21.5 10 L16.2 14.4 L17.8 21 L12 17.4 L6.2 21 L7.8 14.4 L2.5 10 L9.4 9.5 Z" fill="currentColor"/>,
  dot:            <circle cx="12" cy="12" r="3.5" fill="currentColor" />,
  book:           <path d="M5 5 H10 Q12 5 12 7 V19 Q12 17 10 17 H5 Z M19 5 H14 Q12 5 12 7 V19 Q12 17 14 17 H19 Z" fill="currentColor" />,
  questionMark:   QUESTION,
  doubleQuestion: <g><g transform="translate(0 5) scale(0.67)">{QUESTION}</g><g transform="translate(9 5) scale(0.67)">{QUESTION}</g></g>,
  inaccuracy:     <g><g transform="translate(0 5) scale(0.67)">{QUESTION}</g><path d="M18 5 V15 M18 19 V20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></g>,
  cross:          <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 6 L18 18"/><path d="M18 6 L6 18"/></g>,
  lightning:      <path d="M13 2 L4 14 H11 L9 22 L20 9 H12 Z" fill="currentColor" />,
  lock:           <path d="M8 11 V8 a4 4 0 1 1 8 0 V11 H17 a1 1 0 0 1 1 1 v8 a1 1 0 0 1-1 1 H7 a1 1 0 0 1-1-1 v-8 a1 1 0 0 1 1-1 Z M10 11 H14 V8 a2 2 0 1 0-4 0 Z" fill="currentColor"/>,
};

export function styleFor(c: string | undefined | null): ClassificationStyle | null {
  if (!c || !Object.prototype.hasOwnProperty.call(CLASS_STYLE, c)) return null;
  return CLASS_STYLE[c as Classification];
}

/** Exact response shape of POST /api/analyze/variation-move. */
export interface VariationMoveQuality {
  source: 'variation';
  scoring_version: number;
  fen_before: string;
  fen_after: string;
  ply: number;
  san: string;
  uci: string;
  from: string;
  to: string;
  classification: Classification;
  centipawn_loss: number;
  win_pct_drop: number;
  eval_before_cp: number;
  eval_after_cp: number;
  mate_before: number | null;
  mate_after: number | null;
  best_move_uci: string;
  best_move_san: string | null;
  best_pv: string[];
  is_best: boolean;
  legal_move_count: number;
  depth_before: number;
  depth_after: number | null;
  candidate_count: number;
  terminal: 'checkmate' | 'draw' | null;
}

/** Position-only check for decorative board markers. A move score also needs
 * the exact source move identity; use qualityMatchesVariationMove for that. */
export function qualityMatchesPosition(quality: VariationMoveQuality | null | undefined, fen: string): boolean {
  return !!quality && quality.fen_after === fen;
}

/** A final FEN alone cannot authenticate a move classification. Reject a
 * response for another preceding position/move even if it claims the same
 * resulting board; otherwise a stale Brilliant or evaluation could be shown
 * for the user's unrelated variation. Never infer or manufacture scores. */
export function qualityMatchesVariationMove(
  quality: VariationMoveQuality | null | undefined,
  move: { fenBefore: string; fenAfter: string; uci: string; san: string; from: string; to: string } | null | undefined,
): quality is VariationMoveQuality {
  return !!quality && !!move
    && quality.source === 'variation'
    && quality.fen_before === move.fenBefore
    && qualityMatchesPosition(quality, move.fenAfter)
    && quality.uci === move.uci
    && quality.san === move.san
    && quality.from === move.from
    && quality.to === move.to
    && styleFor(quality.classification) !== null
    && Number.isFinite(quality.eval_before_cp)
    && Number.isFinite(quality.eval_after_cp)
    && Number.isFinite(quality.centipawn_loss)
    && Number.isFinite(quality.win_pct_drop);
}
