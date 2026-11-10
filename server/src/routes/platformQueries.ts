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
}

const SOURCES = new Set(['chesscom', 'lichess', 'played', 'imported', 'pvp']);
const TIME_CLASSES = new Set(['bullet', 'blitz', 'rapid', 'daily']);
const RESULTS = new Set(['win', 'draw', 'loss']);

function integerParam(raw: string | null, fallback: number, max: number, clamp = false): number | null {
  if (raw === null) return fallback;
  if (!/^(0|[1-9][0-9]{0,8})$/.test(raw)) return null;
  const n = Number(raw);
  return n > max ? (clamp ? max : null) : n;
}

export function parseGameListQuery(params: URLSearchParams): GameListQuery | null {
  const limit = integerParam(params.get('limit'), 50, 200, true);
  const offset = integerParam(params.get('offset'), 0, 1_000_000);
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const bookmarked = params.get('bookmarked') ?? '0';
  const source = params.get('source');
  const timeClass = params.get('time_class');
  const result = params.get('result');
  const analyzed = params.get('analyzed');
  const sort = params.get('sort') ?? 'newest';
  if (limit === null || limit < 1 || offset === null || q.length > 120 ||
      (bookmarked !== '0' && bookmarked !== '1') ||
      (source !== null && !SOURCES.has(source)) ||
      (timeClass !== null && !TIME_CLASSES.has(timeClass)) ||
      (result !== null && !RESULTS.has(result)) ||
      (analyzed !== null && analyzed !== '0' && analyzed !== '1') ||
      (sort !== 'newest' && sort !== 'oldest')) return null;

  return {
    limit, offset, q, bookmarked: bookmarked === '1',
    source, timeClass, result, analyzed: analyzed === null ? null : analyzed === '1', sort,
  };
}

export function parseGameId(raw: string): number | null {
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}
