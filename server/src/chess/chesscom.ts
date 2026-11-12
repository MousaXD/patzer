// Chess.com public API client. The API is unauthenticated but requires a User-Agent.

const UA = 'patzer/3.1 (+https://github.com/SikamikanikoBG/patzer)';

// Chess.com usernames are 3–25 chars; we extend slightly for historical grandfathered handles.
const USERNAME_RE = /^[A-Za-z0-9_-]{2,40}$/;
function assertValidUsername(u: string): void {
  if (!USERNAME_RE.test(u)) throw new Error('invalid_username');
}

// Archive URLs come from an external API. Validate the *complete* monthly
// path and linked username; never silently discard a malformed archive since
// that could cause an incomplete history to be reported as complete.
function assertChessComUrl(u: unknown, username?: string): asserts u is string {
  let parsed: URL;
  if (typeof u !== 'string') throw new Error('chesscom_invalid_response');
  try { parsed = new URL(u); } catch { throw new Error('chesscom_invalid_response'); }
  const archive = /^\/pub\/player\/([A-Za-z0-9_-]{2,40})\/games\/\d{4}\/(0[1-9]|1[0-2])$/.exec(parsed.pathname);
  if (parsed.protocol !== 'https:' || parsed.host !== 'api.chess.com' ||
      parsed.username || parsed.password || parsed.search || parsed.hash || !archive ||
      (username && archive[1]!.toLowerCase() !== username.toLowerCase())) {
    throw new Error('chesscom_invalid_response');
  }
}

interface Archive { url: string }
interface ArchivesResponse { archives: string[] }

export interface ChessComGame {
  url: string;
  pgn: string;
  time_control: string;
  end_time: number;
  rated: boolean;
  time_class: string;
  rules: string;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
}

interface MonthlyArchive { games: ChessComGame[] }

async function get(url: string): Promise<unknown> {
  // 15s ceiling: stops a slow chess.com response from pinning a request handler.
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) throw new Error('not_found');
  if (!res.ok) throw new Error(`chesscom_${res.status}`);
  try { return await res.json(); }
  catch { throw new Error('chesscom_invalid_response'); }
}

export async function getPlayer(username: string): Promise<{ username: string; avatar?: string; country?: string } | null> {
  assertValidUsername(username);
  let data: Record<string, unknown>;
  try {
    data = (await get(`https://api.chess.com/pub/player/${encodeURIComponent(username)}`)) as Record<string, unknown>;
  } catch (error) {
    // Only an explicit HTTP 404 proves the user doesn't exist. Rate limits,
    // timeouts and network errors must not be reported as a missing profile.
    if (error instanceof Error && error.message === 'not_found') return null;
    throw error;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      typeof data.username !== 'string' || data.username.toLowerCase() !== username.toLowerCase()) {
    throw new Error('chesscom_invalid_response');
  }
  return {
    username: data.username,
    avatar: typeof data.avatar === 'string' ? data.avatar : undefined,
    country: typeof data.country === 'string' ? data.country : undefined,
  };
}

export async function listArchives(username: string): Promise<string[]> {
  assertValidUsername(username);
  const data = (await get(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`)) as ArchivesResponse | null;
  if (!data || !Array.isArray(data.archives)) throw new Error('chesscom_invalid_response');
  for (const archive of data.archives) assertChessComUrl(archive, username);
  // Guarantee chronological order for newest-first traversal even if upstream
  // changes its ordering, and avoid requesting the same month twice.
  return [...new Set(data.archives)].sort();
}

export async function getMonth(archiveUrl: string): Promise<ChessComGame[]> {
  assertChessComUrl(archiveUrl);
  const data = (await get(archiveUrl)) as MonthlyArchive | null;
  if (!data || !Array.isArray(data.games) ||
      !data.games.every((game) => !!game && typeof game === 'object' && !Array.isArray(game))) {
    throw new Error('chesscom_invalid_response');
  }
  return data.games;
}

// Fetch the most recent N games for a user, walking archives backwards in time.
export async function fetchRecentGames(username: string, limit: number): Promise<ChessComGame[]> {
  assertValidUsername(username);
  const archives = await listArchives(username);
  const out: ChessComGame[] = [];
  for (let i = archives.length - 1; i >= 0 && out.length < limit; i--) {
    const url = archives[i];
    if (!url) continue;
    const games = await getMonth(url);
    // Skip variants — we only analyze standard chess; importing king-of-the-hill
    // games and feeding them to a standard-chess classifier produces nonsense.
    const standard = games.filter((g) => g.rules === 'chess');
    standard.sort((a, b) => b.end_time - a.end_time);
    for (const g of standard) {
      out.push(g);
      if (out.length >= limit) break;
    }
  }
  return out;
}
