import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chess } from 'chess.js';
import type { AnalysisResult, AnalyzedMove, KeyMomentSummary, Language } from '../src/types.js';

// No actual API calls, engine processes, or user's saved games. Model output
// is deliberately hostile to test the *consumer*, not the prompt's wishes.
vi.mock('../src/coach/llm.js', () => ({ chatJsonRetry: vi.fn() }));
const dir = mkdtempSync(join(tmpdir(), 'patzer-review-claims-'));
process.env.DB_PATH = join(dir, 'claims.db');

let review: typeof import('../src/coach/review.js');
let llm: typeof import('../src/coach/llm.js');
let restoreEngine: () => void;

const game = new Chess();
const moves: AnalyzedMove[] = [];
for (const san of ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']) {
  const fen_before = game.fen();
  const m = game.move(san);
  moves.push({
    ply: moves.length + 1, san, uci: m.from + m.to, fen_before, fen_after: game.fen(),
    eval_before_cp: 0, eval_after_cp: 0, mate_before: null, mate_after: null,
    best_move_uci: null, best_move_san: san === 'Nf6' ? 'g6' : san,
    best_pv: san === 'Nf6' ? ['g6'] : [],
    centipawn_loss: san === 'Nf6' ? 900 : 0, classification: san === 'Nf6' ? 'blunder' : 'good',
  });
}
const m = moves[5]!;
const moment: KeyMomentSummary = {
  ply: m.ply, side: 'black', san: m.san, fen_before: m.fen_before,
  classification: 'blunder', cp_loss: 900, win_pct_delta: 50,
  best_san: 'g6', best_pv: ['g6'],
};
const analysis: AnalysisResult = {
  depth: 16, moves, accuracy_white: 92, accuracy_black: 50,
  estimated_elo_white: 1200, estimated_elo_black: 650,
  performance_white: null, performance_black: null,
  opening_eco: 'C20', opening_name: 'King\'s Pawn Game',
  phase_split: null, key_moments: [moment],
};

async function run(lang: Language = 'en') {
  return review.buildGameReview({
    analysis, pgn: '[Result "1-0"]', language: lang,
    audience: 'beginner', userColor: 'white', llmEnabled: true,
  });
}

beforeAll(async () => {
  llm = await import('../src/coach/llm.js');
  review = await import('../src/coach/review.js');
  const coaching = await import('../src/coach/coaching.js');
  const previous = coaching.setCoachEngine(async () => null);
  restoreEngine = () => coaching.setCoachEngine(previous);
});
beforeEach(() => vi.mocked(llm.chatJsonRetry).mockReset());
afterAll(() => {
  restoreEngine?.();
  rmSync(dir, { recursive: true, force: true });
});

describe('written review rejects unsupported model statements', () => {
  it.each([
    'The bishop on a3 pins the knight on f6.',
    'Black forks the queen on h5 and rook on a1.',
    'The knight is hanging without protection.',
    'This creates an unstoppable threat.',
    'Black must win a whole rook.',
    'The move forces mate in 2.',
    'Black played Nf6. White could checkmate with Qh4#.',
    'White played Nf6. Black could reply with Qxf7#, checkmate.',
    'Black played Nf6. White played Qxf7#, checkmate.',
    'Black\'s queen on h5 is exposed.',
  ])('rejects the invented claim: %s', async (fabricated) => {
    vi.mocked(llm.chatJsonRetry).mockResolvedValueOnce({ title: 'Key moment', prose: fabricated } as never)
      .mockResolvedValueOnce({ summary: 'A game was played.' } as never);
    const result = await run();
    expect(result.key_moments[0]!.prose).not.toContain(fabricated);
    expect(result.key_moments[0]!.prose).toContain('checkmate');
  });

  it('permits a truthful legal one-move checkmate reply without calling it forced', async () => {
    const grounded = 'Black played Nf6. White could reply with Qxf7#, checkmate.';
    vi.mocked(llm.chatJsonRetry).mockResolvedValueOnce({ title: 'Missed defence', prose: grounded } as never)
      .mockResolvedValueOnce({ summary: 'A game was played.' } as never);
    const result = await run();
    expect(result.key_moments[0]!.prose).toBe(grounded);
  });

  it('handles malformed JSON shape and failed/partial JSON generation in all supported languages', async () => {
    for (const language of ['en', 'bg', 'es', 'de', 'ru'] as const) {
      vi.mocked(llm.chatJsonRetry).mockReset().mockResolvedValueOnce({
        title: ['not a string'], what_happened: { tactical: 'a fake pin' }, prose: 123,
      } as never).mockRejectedValueOnce(new Error('llm_bad_json'));
      const result = await run(language);
      expect(result.language).toBe(language);
      expect(result.key_moments[0]!.prose.length).toBeGreaterThan(12);
      expect(result.key_moments[0]!.prose).not.toContain('fake pin');
      expect(result.summary.length).toBeGreaterThan(10);
    }
  });

  it('refuses false game-summary tactics, invented Elo, and unjustified opening praise', async () => {
    vi.mocked(llm.chatJsonRetry).mockResolvedValueOnce({ title: 'Moment', prose: 'A position changed.' } as never)
      .mockResolvedValueOnce({
        summary: 'Your rook pins the queen on a3 and must win it.',
        skill_assessment: 'You played at 2500 Elo.',
        opening_prose: 'This was a solid opening and guaranteed a win.',
      } as never);
    const result = await run();
    expect(result.summary).not.toContain('pins');
    expect(result.skill_assessment).not.toContain('2500');
    expect(result.opening?.prose).not.toContain('solid');
    expect(result.opening?.prose).toContain('King');
  });
});
