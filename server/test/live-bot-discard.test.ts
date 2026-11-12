import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'patzer-live-bot-discard-'));
process.env.DB_PATH = join(scratch, 'discard.db');
let db: typeof import('../src/db.js')['db'];
let games: typeof import('../src/routes/games.js')['default'];
let cookie: string;

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  games = (await import('../src/routes/games.js')).default;
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  db.prepare("INSERT INTO users(id,username,password_hash,role) VALUES (1,'mine','x','user'),(2,'other','x','user')").run();
  db.prepare("INSERT INTO profiles(user_id,display_name) VALUES (1,'Mine'),(2,'Other')").run();
  cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;
  const save = db.prepare(`INSERT INTO live_bot_games
    (user_id,difficulty,user_color,time_control,pgn,white_time_ms,black_time_ms,last_move_at,updated_at)
    VALUES (?,'kid','white','rapid','1. e4 e5',580000,580000,datetime('now'),datetime('now'))`);
  save.run(1); save.run(2);
});
afterAll(() => { try { db.close(); } catch { /* ignore */ } rmSync(scratch, { recursive: true, force: true }); });

async function discard() {
  const response = await games.request('/live/bot', {
    method: 'DELETE', headers: { Cookie: cookie, 'X-Requested-With': 'patzer' },
  });
  return { status: response.status, body: await response.json() };
}

describe('discard an unfinished bot game', () => {
  it('never acknowledges deletion when SQLite could not delete the saved game', async () => {
    db.exec(`CREATE TRIGGER reject_bot_delete BEFORE DELETE ON live_bot_games
      WHEN OLD.user_id = 1 BEGIN SELECT RAISE(ABORT, 'simulated disk write error'); END;`);
    try {
      expect(await discard()).toMatchObject({ status: 503, body: { error: 'discard_failed' } });
      expect(db.prepare('SELECT user_id FROM live_bot_games ORDER BY user_id').all())
        .toEqual([{ user_id: 1 }, { user_id: 2 }]);
    } finally {
      db.exec('DROP TRIGGER IF EXISTS reject_bot_delete');
    }
    expect(await discard()).toMatchObject({ status: 200, body: { ok: true } });
    expect(db.prepare('SELECT user_id FROM live_bot_games ORDER BY user_id').all())
      .toEqual([{ user_id: 2 }]);
  });
});
