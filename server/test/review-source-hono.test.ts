import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chess } from 'chess.js';
import type { AnalyzedMove } from '../src/types.js';

// The actual authenticated Hono route and actual SQLite persistence run with
// entirely synthetic games, no engine binary, no hosted model or live data.
const model = vi.hoisted(() => ({
  enabled: false,
  entered: null as (() => void) | null,
  aborted: false,
}));
vi.mock('../src/coach/llm.js', () => ({
  llmConfigured: () => model.enabled,
  chatJsonRetry: vi.fn(async (_messages: unknown, opts: { signal?: AbortSignal }) => {
    model.entered?.();
    await new Promise<never>((_resolve, reject) => {
      if (opts.signal?.aborted) {
        model.aborted = true;
        reject(new Error('llm_aborted'));
        return;
      }
      opts.signal?.addEventListener('abort', () => {
        model.aborted = true;
        reject(new Error('llm_aborted'));
      }, { once: true });
    });
  }),
}));

const dir = mkdtempSync(join(tmpdir(), 'patzer-review-source-hono-'));
process.env.DB_PATH = join(dir, 'fixture.db');

const fool = '[Event "Synthetic"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
const scholar = '[Event "Synthetic"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0';

function evidence(pgn: string): AnalyzedMove[] {
  const chess = new Chess();
  chess.loadPgn(pgn);
  return chess.history({ verbose: true }).map((m, index) => ({
    ply: index + 1, san: m.san, uci: `${m.from}${m.to}${m.promotion ?? ''}`,
    fen_before: m.before, fen_after: m.after,
    eval_before_cp: 0, eval_after_cp: 0,
    mate_before: null, mate_after: null,
    best_move_uci: null, best_move_san: null, best_pv: [],
    centipawn_loss: 0, classification: 'good' as const,
  }));
}

let db: typeof import('../src/db.js')['db'];
let route: (path: string, init?: RequestInit) => Response | Promise<Response>;
let ownerCookie = '';
let otherCookie = '';

async function get(id = 1, cookie = ownerCookie) {
  const response = await route(`/${id}/review`, { headers: { cookie } });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function generate(id = 1, cookie = ownerCookie) {
  const response = await route(`/${id}/review`, { method: 'POST', headers: { cookie } });
  const body = await response.text();
  return { status: response.status, body };
}

function analysisRow(gameId = 1) {
  return db.prepare('SELECT * FROM analyses WHERE game_id = ?').get(gameId) as
    | (Record<string, unknown> & { prose_json: string | null }) | undefined;
}

function seed(pgn: string = fool, owner = 1, id = 1) {
  db.prepare(`INSERT INTO games (id,user_id,source,pgn,user_color,result)
    VALUES (?, ?, 'imported', ?, 'white', ?)`)
    .run(id, owner, pgn, pgn === fool ? 'loss' : 'win');
  db.prepare(`INSERT INTO analyses
    (game_id, depth, moves_json, key_moments_json, scoring_version, accuracy_white, accuracy_black)
    VALUES (?, 8, ?, '[]', 9, 88, 91)`)
    .run(id, JSON.stringify(evidence(pgn)));
}

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  route = (await import('../src/routes/review.js')).default.request.bind((await import('../src/routes/review.js')).default);
  for (const [id, name] of [[1, 'owner'], [2, 'other']] as const) {
    db.prepare('INSERT INTO users (id,username,password_hash,role) VALUES (?, ?, ?, ?)').run(id, name, 'x', 'user');
    db.prepare('INSERT INTO profiles (user_id,display_name,language,audience) VALUES (?, ?, ?, ?)')
      .run(id, name, 'en', 'beginner');
  }
  ownerCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;
  otherCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(2))}`;
});

beforeEach(() => {
  model.enabled = false;
  model.entered = null;
  model.aborted = false;
  db.exec('DELETE FROM analyses; DELETE FROM games;');
  db.prepare(`UPDATE profiles SET language = 'en', audience = 'beginner'`).run();
  seed();
});

afterAll(() => {
  try { db?.close(); } catch { /* no connection */ }
  rmSync(dir, { force: true, recursive: true });
});

describe('authenticated Review source consistency (actual Hono + SQLite)', () => {
  it('caches only authenticated current prose, and retains it after harmless metadata edits', async () => {
    const result = await generate();
    expect(result.status).toBe(200);
    expect(result.body).toContain('event: done');
    const initial = await get();
    expect(initial.status).toBe(200);
    expect(initial.body.review).toBeTruthy();
    expect(analysisRow()?.prose_json).toContain('source_integrity');
    db.prepare(`UPDATE games SET notes = 'harmless', bookmarked = 1 WHERE id = 1`).run();
    expect((await get()).body.review).toEqual(initial.body.review);
  });

  it('never admits Fool analysis for Scholar PGN, including changes made before generation', async () => {
    db.prepare('UPDATE games SET pgn = ?, result = ? WHERE id = 1').run(scholar, 'win');
    const result = await generate();
    expect(result.status).toBe(409);
    expect(result.body).toContain('analysis_source_stale');
    expect(analysisRow()?.prose_json).toBeNull();
  });

  it('invalidates completed prose when game PGN or player perspective changes, and restores exact source', async () => {
    expect((await generate()).body).toContain('event: done');
    const fresh = (await get()).body.review;
    db.prepare('UPDATE games SET pgn = ? WHERE id = 1').run(scholar);
    expect((await get()).body).toMatchObject({ review: null, stale: true });
    db.prepare('UPDATE games SET pgn = ? WHERE id = 1').run(fool);
    expect((await get()).body.review).toEqual(fresh);
    db.prepare(`UPDATE games SET user_color = 'black' WHERE id = 1`).run();
    expect((await get()).body).toMatchObject({ review: null, stale: true });
  });

  it('rejects changed engine evidence, equal-ply PGNs, scoring and settings', async () => {
    expect((await generate()).body).toContain('event: done');
    db.prepare('UPDATE analyses SET accuracy_white = 90 WHERE game_id = 1').run();
    expect((await get()).body).toMatchObject({ review: null, stale: true });
    db.prepare('UPDATE profiles SET language = ? WHERE user_id = 1').run('de');
    expect((await get()).body).toMatchObject({ review: null, stale: true });
    db.prepare('UPDATE profiles SET language = ?, audience = ? WHERE user_id = 1').run('en', 'advanced');
    expect((await get()).body).toMatchObject({ review: null, stale: true });
    db.prepare('UPDATE profiles SET audience = ? WHERE user_id = 1').run('beginner');
    db.prepare('UPDATE analyses SET scoring_version = 10 WHERE game_id = 1').run();
    expect((await get()).body).toMatchObject({ review: null, stale: true });

    db.prepare('UPDATE analyses SET scoring_version = 9, prose_json = NULL WHERE game_id = 1').run();
    db.prepare('UPDATE games SET pgn = ? WHERE id = 1').run('1. e4 e5 2. Nf3 Nc6 *');
    db.prepare('UPDATE analyses SET moves_json = ? WHERE game_id = 1').run(JSON.stringify(evidence('1. d4 d5 2. c4 e6 *')));
    expect((await generate()).status).toBe(409);
  });

  it('treats unmarked legacy prose and malformed JSON as unsafe', async () => {
    db.prepare('UPDATE analyses SET prose_json = ? WHERE game_id = 1').run('{"summary":"old unsupported prose"}');
    expect((await get()).body).toMatchObject({ review: null, stale: true });
    db.prepare('UPDATE analyses SET prose_json = ? WHERE game_id = 1').run('{not-json');
    expect((await get()).body.review).toBeNull();
  });

  it('requires ownership for both GET and POST, even with a cached report', async () => {
    expect((await generate()).body).toContain('event: done');
    expect((await get(1, otherCookie)).status).toBe(404);
    expect((await generate(1, otherCookie)).status).toBe(404);
    expect((await get(1, '')).status).toBe(401);
    expect((await generate(1, '')).status).toBe(401);
  });

  it('aborts obsolete model work after PGN changes during an SSE report, with no persisted prose', async () => {
    model.enabled = true;
    const entered = new Promise<void>((resolve) => { model.entered = resolve; });
    const request = generate();
    await entered;
    // The model hangs indefinitely until the server aborts it. This proves
    // the watchdog, not merely the final compare-and-swap, ends obsolete work.
    db.prepare('UPDATE games SET pgn = ?, result = ? WHERE id = 1').run(scholar, 'win');
    const outcome = await Promise.race([
      request,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('watchdog_timeout')), 3_000)),
    ]);
    expect(model.aborted).toBe(true);
    expect(outcome.body).toContain('review_source_changed');
    expect(outcome.body).not.toContain('event: done');
    expect(analysisRow()?.prose_json).toBeNull();
  });
});
