// Insights v2 — the "Beyond Chess.com" analytics surface.
// Returns six aggregates so the frontend renders one fast page:
//   - activity_heatmap   year-of-games calendar
//   - rating_trajectory  per-time-class rating points
//   - opening_repertoire top openings × side with W/D/L + accuracy
//   - mistake_taxonomy   bucketed personal mistake patterns
//   - time_class_stats   per-time-class W/D/L + accuracy
//   - accuracy_trend     last-N-games accuracy series
//   - move_quality       how often each move classification was yours,
//                        plus your most recent brilliant moves
//
// Games played from a position (games.start_fen) are left out: they never
// had an opening, and a won position would flatter the numbers.
//
// All templated (no LLM); fast page render.

import { Hono } from 'hono';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { readAnalysisMoves, readPhaseSplit } from './analysisData.js';
import { SCORING_VERSION } from '../chess/classifier.js';
import type { Classification, GamePhase, Color } from '../types.js';
import { phaseFor, hasBackRankSignature } from '../chess/phases.js';

const router = new Hono();
router.use('*', requireAuth);

interface AnalysisRow {
  game_id: number;
  user_color: Color | null;
  end_time: string | null;
  result: string | null;
  time_class: string | null;
  eco: string | null;
  opening_name: string | null;
  moves_json: string;
  phase_split_json: string | null;
  accuracy_user: number | null;
  white: string;
  black: string;
}

const CLASSIFICATIONS: Classification[] = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'miss', 'blunder',
];
/** How many of your brilliant moves the page lists. */
const BRILLIANT_LIST = 10;

// SQL-side provenance gate for aggregate read paths: a source edit or legacy
// unversioned analysis must never count toward the user's accuracy, mistakes
// or learning trends. Detailed per-game reads independently replay the PGN.
const usableAnalysisSql = `a.scoring_version >= ? AND a.source_hash IS NOT NULL
  AND a.source_revision = g.source_revision AND a.analysis_generation > 0`;

router.get('/', (c) => {
  const me = c.get('user');

  const gamesTotal = db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN start_fen IS NULL THEN 1 ELSE 0 END), 0) AS eligible
    FROM games WHERE user_id = ?
  `).get(me.id) as { total: number; eligible: number };

  // Activity heatmap — last 365 days. Aggregated server-side so the wire
  // payload is at most ~365 rows even on heavy users.
  interface DayRow { day: string; games: number; wins: number }
  const heatmap = db.prepare(`
    SELECT substr(end_time, 1, 10) AS day,
           COUNT(*) AS games,
           SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) AS wins
    FROM games
    WHERE user_id = ? AND end_time IS NOT NULL AND start_fen IS NULL
      AND substr(end_time, 1, 10) BETWEEN date('now','-364 days') AND date('now')
    GROUP BY day
    ORDER BY day ASC
  `).all(me.id) as DayRow[];

  // Rating trajectory — per time_class series of (date, rating_after).
  interface TrajRow { time_class: string; created_at: string; rating_after: number }
  const trajRows = db.prepare(`
    SELECT time_class, created_at, rating_after
    FROM rating_history
    WHERE user_id = ?
    ORDER BY created_at ASC
  `).all(me.id) as TrajRow[];
  const trajectory: Record<string, { t: string; r: number }[]> = { bullet: [], blitz: [], rapid: [], daily: [] };
  for (const r of trajRows) {
    const arr = trajectory[r.time_class];
    if (arr) arr.push({ t: r.created_at, r: Math.round(r.rating_after) });
  }

  // Per-time-class W/D/L + average accuracy from analyses (player's side).
  interface TcRow {
    time_class: string | null;
    wins: number; draws: number; losses: number; total: number; analyzed_games: number;
    avg_acc: number | null;
  }
  const tcRows = db.prepare(`
    SELECT g.time_class,
           SUM(CASE WHEN g.result='win' THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN g.result='draw' THEN 1 ELSE 0 END) AS draws,
           SUM(CASE WHEN g.result='loss' THEN 1 ELSE 0 END) AS losses,
           COUNT(*) AS total,
           SUM(CASE WHEN (${usableAnalysisSql}) THEN 1 ELSE 0 END) AS analyzed_games,
           AVG(CASE WHEN g.user_color='white' AND (${usableAnalysisSql}) THEN a.accuracy_white
                    WHEN g.user_color='black' AND (${usableAnalysisSql}) THEN a.accuracy_black
                    ELSE NULL END) AS avg_acc
    FROM games g LEFT JOIN analyses a ON a.game_id = g.id
    WHERE g.user_id = ? AND g.result IS NOT NULL AND g.start_fen IS NULL
    GROUP BY g.time_class
  `).all(SCORING_VERSION, SCORING_VERSION, SCORING_VERSION, me.id) as TcRow[];
  const time_class_stats: Record<string, { games: number; analyzed_games: number; wins: number; draws: number; losses: number; avg_accuracy: number | null }> = {};
  for (const r of tcRows) {
    const k = r.time_class ?? 'other';
    time_class_stats[k] = {
      games: r.total,
      analyzed_games: r.analyzed_games,
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
      avg_accuracy: r.avg_acc != null ? Math.round(r.avg_acc * 10) / 10 : null,
    };
  }

  // Every current-version analysis contributes to overall mistake taxonomy,
  // phase accuracy and move quality. Stream rows to bound Node memory: the
  // previous LIMIT 200/500 silently excluded older analyzed games.
  const rows = db.prepare(`
    SELECT a.game_id, g.user_color, g.end_time, g.result, g.time_class,
           g.eco, g.opening_name, a.moves_json, a.phase_split_json, g.white, g.black,
           CASE WHEN g.user_color='white' THEN a.accuracy_white
                WHEN g.user_color='black' THEN a.accuracy_black ELSE NULL END AS accuracy_user
    FROM analyses a JOIN games g ON g.id = a.game_id
    WHERE g.user_id = ? AND (${usableAnalysisSql}) AND g.start_fen IS NULL
    ORDER BY g.end_time DESC, g.id DESC
  `).iterate(me.id, SCORING_VERSION) as IterableIterator<AnalysisRow>;
  let analyzedCount = 0;

  // Taxonomy buckets — every bucket counts user-side moves only.
  const tax = {
    hung_pieces: 0,
    back_rank: 0,
    missed_mate: 0,
    opening_pitfalls: 0,
    endgame_drift: 0,
    one_move_blunders: 0,
    promising_to_losing: 0,
  };

  // Opening repertoire counts ALL games with an ECO, including imported
  // Chess.com games that have not been individually analyzed by Stockfish.
  // Only the accuracy average requires a current-version analysis.
  const openingRows = db.prepare(`
    SELECT g.eco, COALESCE(MIN(NULLIF(g.opening_name, '')), g.eco) AS name,
           g.user_color AS color, COUNT(*) AS played,
           SUM(CASE WHEN g.result='win' THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN g.result='draw' THEN 1 ELSE 0 END) AS draws,
           SUM(CASE WHEN g.result='loss' THEN 1 ELSE 0 END) AS losses,
           SUM(CASE WHEN (${usableAnalysisSql}) THEN 1 ELSE 0 END) AS analyzed_games,
           AVG(CASE WHEN (${usableAnalysisSql}) AND g.user_color='white' THEN a.accuracy_white
                    WHEN (${usableAnalysisSql}) AND g.user_color='black' THEN a.accuracy_black
                    ELSE NULL END) AS avg_accuracy
    FROM games g LEFT JOIN analyses a ON a.game_id = g.id
    WHERE g.user_id = ? AND g.start_fen IS NULL
      AND g.eco IS NOT NULL AND g.user_color IN ('white', 'black')
    GROUP BY g.eco, g.user_color
    ORDER BY played DESC, g.eco ASC
    LIMIT 10
  `).all(SCORING_VERSION, SCORING_VERSION, SCORING_VERSION, me.id) as {
    eco: string; name: string; color: Color; played: number;
    wins: number; draws: number; losses: number; analyzed_games: number; avg_accuracy: number | null;
  }[];

  // Phase accuracy avg over the user's side
  const phaseAcc: Record<GamePhase, { sum: number; n: number }> = {
    opening: { sum: 0, n: 0 }, middlegame: { sum: 0, n: 0 }, endgame: { sum: 0, n: 0 },
  };

  // Move quality — your moves only, per classification; the brilliant ones
  // (newest game first) also as a list to jump back to.
  const quality = Object.fromEntries(CLASSIFICATIONS.map((k) => [k, 0])) as Record<Classification, number>;
  const brilliant: { game_id: number; ply: number; san: string; end_time: string | null; opponent: string }[] = [];

  // Accuracy trend — most recent N games (ascending for the chart)
  const accTrend: { t: string; acc: number; result: string | null }[] = [];

  for (const r of rows) {
    analyzedCount++;
    // The row may predate reliable player-color attribution. Count the
    // analysis for coverage, but never invent white-side personal metrics.
    if (r.user_color !== 'white' && r.user_color !== 'black') continue;
    const userColor: Color = r.user_color;
    const moves = readAnalysisMoves(r.moves_json);
    const split = readPhaseSplit(r.phase_split_json);

    if (split?.opening) {
      const acc = userColor === 'white' ? split.opening.accuracy_white : split.opening.accuracy_black;
      phaseAcc.opening.sum += acc; phaseAcc.opening.n++;
    }
    if (split?.middlegame) {
      const acc = userColor === 'white' ? split.middlegame.accuracy_white : split.middlegame.accuracy_black;
      phaseAcc.middlegame.sum += acc; phaseAcc.middlegame.n++;
    }
    if (split?.endgame) {
      const acc = userColor === 'white' ? split.endgame.accuracy_white : split.endgame.accuracy_black;
      phaseAcc.endgame.sum += acc; phaseAcc.endgame.n++;
    }

    if (r.accuracy_user != null && r.end_time && accTrend.length < 50) {
      accTrend.push({ t: r.end_time, acc: r.accuracy_user, result: r.result });
    }

    // Per-move taxonomy
    let userBlundersThisGame = 0;
    for (const m of moves) {
      const side: Color = m.ply % 2 === 1 ? 'white' : 'black';
      if (side !== userColor) continue;
      if (m.classification in quality) quality[m.classification]++;
      if (m.classification === 'brilliant' && brilliant.length < BRILLIANT_LIST) {
        brilliant.push({ game_id: r.game_id, ply: m.ply, san: m.san, end_time: r.end_time, opponent: userColor === 'white' ? r.black : r.white });
      }
      const phase = phaseFor(m.ply, split);
      if (m.classification === 'blunder' || m.classification === 'mistake') {
        if (m.centipawn_loss >= 200) tax.hung_pieces++;
        if (m.classification === 'blunder' && hasBackRankSignature(m.fen_after, userColor)) tax.back_rank++;
        if (phase === 'opening') tax.opening_pitfalls++;
        if (phase === 'endgame') tax.endgame_drift++;
        if (m.classification === 'blunder') {
          userBlundersThisGame++;
          // "One-move blunder": cp_loss ≥ 300 and prior eval was at most slightly worse.
          if (m.centipawn_loss >= 300 && (m.eval_before_cp != null) && Math.abs(m.eval_before_cp) < 200) {
            tax.one_move_blunders++;
          }
        }
      }
      if (m.classification === 'miss') {
        // chess.com defines Miss as "you had a winning shot and didn't take it";
        // surface separately as missed-mate-or-win.
        tax.missed_mate++;
      }
      // Promising → losing flip: prior eval ≥ +150 (from user POV), now ≤ +50.
      if (m.eval_before_cp != null && m.eval_after_cp != null) {
        const sign = userColor === 'white' ? 1 : -1;
        const before = m.eval_before_cp * sign;
        const after = m.eval_after_cp * sign;
        if (before >= 150 && after <= 50) tax.promising_to_losing++;
      }
    }
    void userBlundersThisGame;
  }

  const opening_repertoire = openingRows.map((e) => ({
    eco: e.eco, name: e.name, color: e.color, played: e.played,
    wins: e.wins, draws: e.draws, losses: e.losses,
    analyzed_games: e.analyzed_games,
    avg_accuracy: e.avg_accuracy != null ? Math.round(e.avg_accuracy * 10) / 10 : null,
  }));

  return c.json({
    games_total: gamesTotal.total,
    games_eligible: gamesTotal.eligible,
    games_analyzed: analyzedCount,
    activity_heatmap: heatmap,
    rating_trajectory: trajectory,
    time_class_stats,
    opening_repertoire,
    mistake_taxonomy: tax,
    phase_accuracy: {
      opening: phaseAcc.opening.n ? Math.round((phaseAcc.opening.sum / phaseAcc.opening.n) * 10) / 10 : 0,
      middlegame: phaseAcc.middlegame.n ? Math.round((phaseAcc.middlegame.sum / phaseAcc.middlegame.n) * 10) / 10 : 0,
      endgame: phaseAcc.endgame.n ? Math.round((phaseAcc.endgame.sum / phaseAcc.endgame.n) * 10) / 10 : 0,
    },
    accuracy_trend: accTrend.slice(0, 50).reverse(),
    move_quality: { counts: quality, brilliant },
  });
});

export default router;
