import { createHash } from 'node:crypto';
import type { GameListQuery } from './platformQueries.js';

/** Opaque, bounded continuation token. The fingerprint prevents accidental
 * reuse after an account, sort or filter change. It is not an auth token:
 * every game query independently checks the authenticated user_id.
 */
export interface GameListAnchor {
  id: number;
  endTime: string | null;
  maxId: number;
}

function fingerprint(userId: number, query: GameListQuery): string {
  const filters = [userId,query.q,query.bookmarked,query.source,query.timeClass,
    query.result,query.analyzed,query.sort,query.fromDate,query.toDate,
    query.opening,query.opponent];
  return createHash('sha256').update(JSON.stringify(filters)).digest('hex').slice(0, 24);
}

export function encodeGameListCursor(userId: number, query: GameListQuery,
  anchor: GameListAnchor): string {
  return Buffer.from(JSON.stringify([1,fingerprint(userId,query),query.sort,
    anchor.endTime,anchor.id,anchor.maxId])).toString('base64url');
}

export function decodeGameListCursor(userId: number, query: GameListQuery): GameListAnchor | null {
  if (!query.cursor || !/^[A-Za-z0-9_-]{5,400}$/.test(query.cursor)) return null;
  try {
    const bytes = Buffer.from(query.cursor,'base64url');
    if (bytes.toString('base64url') !== query.cursor) return null;
    const data: unknown = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(data) || data.length !== 6 || data[0] !== 1 ||
        data[1] !== fingerprint(userId,query) || data[2] !== query.sort ||
        (data[3] !== null && (typeof data[3] !== 'string' || data[3].length > 128)) ||
        !Number.isSafeInteger(data[4]) || data[4] <= 0 ||
        !Number.isSafeInteger(data[5]) || data[5] < data[4]) return null;
    return {endTime:data[3],id:data[4],maxId:data[5]};
  } catch { return null; }
}
