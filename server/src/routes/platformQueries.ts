/** Query validation shared by the game-list endpoint and its regression tests.
 * Never interpolate user-supplied sort/filter values into SQL.
 */
export interface GameListQuery {
  limit: number;
  offset: number;
  q: string;
  bookmarked: boolean;
  source: string | null;
  timeClass: string | null;
  result: string | null;
  analyzed: boolean | null;
  sort: 'newest' | 'oldest';
  fromDate: string | null;
  toDate: string | null;
  opening: string | null;
  opponent: string | null;
  cursor: string | null;
}

const SOURCES = new Set(['chesscom', 'lichess', 'played', 'imported', 'pvp']);
const TIME_CLASSES = new Set(['bullet', 'blitz', 'rapid', 'daily']);
const RESULTS = new Set(['win', 'draw', 'loss']);

function integerParam(raw: string | null, fallback: number, max: number, clamp = false): number | null {
  if (raw === null) return fallback;
  if (!/^(0|[1-9][0-9]{0,14})$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) return null;
  return n > max ? (clamp ? max : null) : n;
}

/** Bound dates to canonical UTC calendar days. Invalid dates or values outside
 * the supported calendar range must never be passed to SQLite's date(). */
function dateParam(raw: string | null): string | null | false {
  if (raw === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const year = Number(raw.slice(0, 4));
  if (year < 1000 || year > 9998) return false;
  const day = new Date(`${raw}T00:00:00.000Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== raw) return false;
  return raw;
}

export function parseGameListQuery(params: URLSearchParams): GameListQuery | null {
  // Duplicated recognized parameters are ambiguous to caches and clients:
  // reject them instead of silently using the first value.
  for (const key of ['limit', 'offset', 'q', 'bookmarked', 'source',
    'time_class', 'result', 'analyzed', 'sort', 'from_date', 'to_date', 'opening', 'opponent', 'cursor']) {
    if (params.getAll(key).length > 1) return null;
  }
  const limit = integerParam(params.get('limit'), 50, 200, true);
  const offset = integerParam(params.get('offset'), 0, 1_000_000);
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const bookmarked = params.get('bookmarked') ?? '0';
  const source = params.get('source');
  const timeClass = params.get('time_class');
  const result = params.get('result');
  const analyzed = params.get('analyzed');
  const sort = params.get('sort') ?? 'newest';
  const fromDate = dateParam(params.get('from_date'));
  const toDate = dateParam(params.get('to_date'));
  const opening = params.get('opening');
  const opponent = params.get('opponent');
  const cursor = params.get('cursor');
  if (limit === null || offset === null || q.length > 120 ||
      (cursor !== null && (params.has('offset') ||
        !/^[A-Za-z0-9_-]{5,400}$/.test(cursor))) ||
      (bookmarked !== '0' && bookmarked !== '1') ||
      (source !== null && !SOURCES.has(source)) ||
      (timeClass !== null && !TIME_CLASSES.has(timeClass)) ||
      (result !== null && !RESULTS.has(result)) ||
      (analyzed !== null && analyzed !== '0' && analyzed !== '1') ||
      (sort !== 'newest' && sort !== 'oldest') ||
      (opening !== null && (!opening.trim() || opening.length > 200)) ||
      (opponent !== null && (opponent.trim().length < 2 || opponent.length > 40 ||
        /[\u0000-\u001f\u007f]/.test(opponent) || (source !== 'chesscom' && source !== 'lichess'))) ||
      fromDate === false || toDate === false ||
      (fromDate !== null && toDate !== null && fromDate > toDate)) return null;

  return {
    limit, offset, q, bookmarked: bookmarked === '1',
    source, timeClass, result, analyzed: analyzed === null ? null : analyzed === '1', sort,
    fromDate, toDate, opening, opponent, cursor,
  };
}

export function parseGameId(raw: string): number | null {
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}
