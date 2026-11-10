import { describe, expect, it } from 'vitest';
import type { AnalyzedMove } from '../types';
import { countByCls } from './GameReportCard';

const samples = [
  { ply: 1, classification: 'mistake' },
  { ply: 2, classification: 'blunder' },
  { ply: 3, classification: 'mistake' },
] as unknown as AnalyzedMove[];

describe('Game Review classification counts from FEN starts', () => {
  it('counts normal White-first game moves by their actual side', () => {
    expect(countByCls(samples, 'white').mistake).toBe(2);
    expect(countByCls(samples, 'white').blunder).toBe(0);
    expect(countByCls(samples, 'black').blunder).toBe(1);
  });

  it('counts Black-first moves without reassigning the player', () => {
    const fen = '8/8/8/8/8/8/8/K6k b - - 0 12';
    expect(countByCls(samples, 'black', fen).mistake).toBe(2);
    expect(countByCls(samples, 'black', fen).blunder).toBe(0);
    expect(countByCls(samples, 'white', fen).blunder).toBe(1);
  });
});
