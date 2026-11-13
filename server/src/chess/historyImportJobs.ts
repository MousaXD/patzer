/** Full-library imports are deliberately background jobs: neither the browser
 * nor a reverse proxy needs to keep a multi-year download request open.
 * Per-batch SQLite transactions preserve completed work if a connection drops
 * or the server restarts. Repeating a job is safe and deduplicates games.
 */
import { db } from '../db.js';
import { getPlayer } from './chesscom.js';
import { importChessComHistory } from './chesscomHistory.js';
import { streamAllGames, type LichessGame } from './lichess.js';
import { storeLichessGames } from './lichessImport.js';

export type HistorySource = 'chesscom' | 'lichess';
export interface HistoryStatus {
  source: HistorySource;
  username: string;
  state: 'idle' | 'running' | 'complete' | 'error';
  fetched: number;
  imported: number;
  duplicates: number;
  skipped: number;
  enriched: number;
  completed: number;
  total: number | null;
  unit: 'months' | 'games';
  error?: string;
  updatedAt?: string;
}

const jobs = new Map<string, HistoryStatus>();
const key = (userId: number, source: HistorySource) => `${userId}:${source}`;
const clock = () => new Date().toISOString();

export function getHistoryStatus(userId: number, source: HistorySource, username: string): HistoryStatus {
  const job = jobs.get(key(userId, source));
  if (job?.username.toLowerCase() === username.toLowerCase()) return { ...job };
  return {
    source, username, state: 'idle', fetched: 0, imported: 0, duplicates: 0,
    skipped: 0, enriched: 0, completed: 0, total: null,
    unit: source === 'chesscom' ? 'months' : 'games',
  };
}

function verifyLinked(userId: number, source: HistorySource, username: string): void {
  const field = source === 'chesscom' ? 'chesscom_username' : 'lichess_username';
  const row = db.prepare(`SELECT ${field} AS username FROM profiles WHERE user_id = ?`)
    .get(userId) as { username: string | null } | undefined;
  if (row?.username?.trim().toLowerCase() !== username.toLowerCase()) throw new Error('linked_account_changed');
}

// Serialize Chess.com history jobs server-wide to avoid a burst of monthly
// archives across different users. A regular 20-game auto-sync stays separate.
let chesscomQueue: Promise<unknown> = Promise.resolve();
function queueChessCom(work: () => Promise<void>): Promise<void> {
  const run = chesscomQueue.then(work, work);
  chesscomQueue = run.catch(() => undefined);
  return run;
}

async function processHistory(userId: number, job: HistoryStatus): Promise<void> {
  const username = job.username;
  if (job.source === 'chesscom') {
    await queueChessCom(async () => {
      verifyLinked(userId, 'chesscom', username);
      if (!await getPlayer(username)) throw new Error('player_not_found');
      const result = await importChessComHistory(db, userId, username, {
        verifyAccount: () => verifyLinked(userId, 'chesscom', username),
        onMonth: ({ archives, completed, fetched, added, duplicates, skipped }) => {
          job.total = archives;
          job.completed = completed;
          job.fetched += fetched;
          job.imported += added;
          job.duplicates += duplicates;
          job.skipped += skipped;
          job.updatedAt = clock();
        },
      });
      job.total = result.archives;
    });
  } else {
    verifyLinked(userId, 'lichess', username);
    let batch: LichessGame[] = [];
    const flush = () => {
      if (!batch.length) return;
      const result = storeLichessGames(userId, username, batch);
      job.fetched += result.total;
      job.imported += result.imported;
      job.duplicates += result.duplicates;
      job.skipped += result.skipped;
      job.enriched += result.enriched;
      job.completed++;
      job.updatedAt = clock();
      batch = [];
    };
    // Stream with no max=200. Flush every 100 games to keep memory and lock
    // duration bounded, even for accounts with thousands of games.
    for await (const game of streamAllGames(username)) {
      batch.push(game);
      if (batch.length >= 100) flush();
    }
    flush();
    job.total = job.fetched;
  }
  verifyLinked(userId, job.source, username);
}

function publicError(error: unknown, source: HistorySource): string {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'linked_account_changed' || code === 'player_not_found' ||
      code === 'rate_limited' || code === 'chesscom_429') {
    return code === 'chesscom_429' ? 'rate_limited' : code;
  }
  return source === 'chesscom' ? 'chesscom_unavailable' : 'lichess_unavailable';
}

export function startHistoryImport(userId: number, source: HistorySource, username: string): HistoryStatus {
  const existing = getHistoryStatus(userId, source, username);
  if (existing.state === 'running') return existing;
  const job: HistoryStatus = {
    source, username, state: 'running', fetched: 0, imported: 0,
    duplicates: 0, skipped: 0, enriched: 0, completed: 0,
    total: null, unit: source === 'chesscom' ? 'months' : 'games', updatedAt: clock(),
  };
  jobs.set(key(userId, source), job);
  void processHistory(userId, job).then(() => {
    job.state = 'complete';
    job.updatedAt = clock();
  }, (error) => {
    job.state = 'error';
    job.error = publicError(error, source);
    job.updatedAt = clock();
    console.warn(`[history-import] ${source} user ${userId}:`, error);
  });
  return { ...job };
}
