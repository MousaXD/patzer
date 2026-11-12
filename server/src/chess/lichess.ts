// Lichess game export client (https://lichess.org/api#tag/Games/operation/apiGamesUser).
// Unauthenticated and public, like the Chess.com one. Lichess asks anonymous
// clients to send a real User-Agent, make one request at a time and back off
// for a minute after a 429 — so requests from this server are serialized and
// a 429 is surfaced to the user instead of retried.

import { classifyTimeControl, type TimeClass } from './timeClass.js';
import { Chess } from 'chess.js';
import { importOpeningMetadata } from './importOpening.js';

const UA = 'patzer (+https://github.com/SikamikanikoBG/patzer)';
const BASE = 'https://lichess.org';

// Lichess usernames: 2–30 chars of letters, digits, _ and -.
const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
export function isValidLichessUsername(u: string): boolean {
  return USERNAME_RE.test(u);
}

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

interface LichessPlayer {
  user?: { name: string; id: string };
  aiLevel?: number;
  rating?: number;
}

export interface LichessGame {
  id: string;
  rated: boolean;
  variant: string;
  speed: string;
  createdAt: number;
  lastMoveAt: number;
  status: string;
  players: { white: LichessPlayer; black: LichessPlayer };
  winner?: 'white' | 'black';
  clock?: { initial: number; increment: number };
  daysPerTurn?: number;
  pgn?: string;
}

/** A Lichess game reduced to the columns Patzer stores. */
export interface ImportRow {
  external_id: string;
  pgn: string;
  white: string;
  black: string;
  result: string;
  time_control: string;
  time_class: TimeClass | null;
  end_time: string;
  user_color: 'white' | 'black' | null;
  eco: string | null;
  opening_name: string | null;
}

// Statuses of games that never really happened or never finished — nothing
// to review, and several of them come without moves.
const UNPLAYED = new Set(['created', 'started', 'aborted', 'noStart', 'unknownFinish']);
const DRAW_STATUSES = new Set(['draw', 'stalemate', 'outoftime']);
const DECISIVE_STATUSES = new Set(['mate', 'resign', 'timeout', 'outoftime', 'cheat', 'variantEnd']);

function playerName(p: LichessPlayer): string {
  if (typeof p.user?.name === 'string' && p.user.name) return p.user.name;
  if (p.aiLevel) return `Stockfish level ${p.aiLevel}`;
  return 'Anonymous';
}

/** Map one exported game onto Patzer's columns, or null if it can't be
 *  reviewed here (a variant, an aborted game, or no moves). */
export function toImportRow(g: LichessGame, username: string): ImportRow | null {
  // Standard chess only — the classifier and coach assume it. "fromPosition"
  // is standard rules from a custom start; the PGN carries its FEN, but the
  // analyzer starts from the initial position, so it's skipped too.
  if (!g || g.variant !== 'standard') return null;
  if (UNPLAYED.has(g.status) || typeof g.pgn !== 'string' || !g.pgn.trim() || g.pgn.length > 1_000_000) return null;
  // A line that isn't a whole game (the export changed, or got cut off) is
  // skipped rather than failing the import.
  if (typeof g.id !== 'string' || !g.id || !g.players?.white || !g.players?.black) return null;
  // A malformed or truncated upstream PGN must not be stored as a reviewable
  // game. This matches Chess.com's importer and protects later engine replay.
  try { new Chess().loadPgn(g.pgn, { strict: false }); } catch { return null; }
  const endedAt = Number(g.lastMoveAt || g.createdAt);
  // Beyond 8.64e15 ms a Date can't be formatted, which would throw below.
  if (!Number.isFinite(endedAt) || endedAt <= 0 || endedAt > 8.64e15) return null;

  const lc = username.toLowerCase();
  const whiteId = g.players.white.user?.id;
  const blackId = g.players.black.user?.id;
  const userColor: 'white' | 'black' | null =
    typeof whiteId === 'string' && whiteId.toLowerCase() === lc ? 'white' :
    typeof blackId === 'string' && blackId.toLowerCase() === lc ? 'black' : null;
  // The export endpoint is normally account-scoped. If it ever returns a
  // foreign game, don't invent an owner or score it for White by default.
  if (!userColor) return null;

  // A missing winner is only a draw for known draw statuses. A missing winner
  // on a resignation or an unknown status is ambiguous, not proof of a draw.
  const result = g.winner === 'white' || g.winner === 'black'
    ? DECISIVE_STATUSES.has(g.status) ? (g.winner === userColor ? 'win' : 'loss') : null
    : DRAW_STATUSES.has(g.status) ? 'draw' : null;
  if (result === null) return null;

  let timeControl: string;
  let timeClass: TimeClass | null;
  if (g.clock) {
    timeControl = `${g.clock.initial}+${g.clock.increment}`;
    timeClass = classifyTimeControl(timeControl);
  } else if (g.daysPerTurn) {
    // Same shape as chess.com's daily games, so both land in one pool.
    timeControl = `1/${g.daysPerTurn * 86400}`;
    timeClass = 'daily';
  } else {
    timeControl = 'untimed';
    timeClass = null;
  }
  const opening = importOpeningMetadata(g.pgn);

  return {
    external_id: g.id,
    pgn: g.pgn.trim(),
    white: playerName(g.players.white),
    black: playerName(g.players.black),
    result,
    time_control: timeControl,
    time_class: timeClass,
    end_time: new Date(endedAt).toISOString(),
    user_color: userColor,
    eco: opening.eco,
    opening_name: opening.openingName,
  };
}

/** Parse Lichess's NDJSON export — one JSON game per line, blank lines allowed.
 * Reject corrupt/truncated responses rather than returning a misleading
 * successfully-imported subset of the requested games. */
export function parseNdjson(body: string): LichessGame[] {
  const out: LichessGame[] = [];
  for (const line of body.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let v: unknown;
    try { v = JSON.parse(s); } catch { throw new Error('invalid_export'); }
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('invalid_export');
    out.push(v as LichessGame);
  }
  return out;
}

// One request at a time from this server, as Lichess asks.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** Fetch a user's most recent finished games, newest first.
 *  Throws `not_found`, `rate_limited` or `lichess_<status>`. */
export function fetchRecentGames(
  username: string,
  opts: { max: number; since?: number },
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<LichessGame[]> {
  if (!isValidLichessUsername(username)) return Promise.reject(new Error('invalid_username'));
  const params = new URLSearchParams({
    max: String(opts.max),
    pgnInJson: 'true',
    clocks: 'false',
    evals: 'false',
    opening: 'false',
    finished: 'true',
  });
  if (opts.since) params.set('since', String(opts.since));
  const url = `${BASE}/api/games/user/${encodeURIComponent(username)}?${params.toString()}`;

  return serialized(async () => {
    // The export streams; 30s is plenty for the ≤200 games a request asks for.
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': UA, Accept: 'application/x-ndjson' },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) throw new Error('not_found');
    if (res.status === 429) throw new Error('rate_limited');
    if (!res.ok) throw new Error(`lichess_${res.status}`);
    return parseNdjson(await res.text());
  });
}
