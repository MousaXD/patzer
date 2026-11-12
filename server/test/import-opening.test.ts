import {describe, expect, it} from 'vitest';
import {importOpeningMetadata} from '../src/chess/importOpening.js';

describe('imported opening display metadata', () => {
  it('classifies a known line from chess moves without claiming an analysis is complete', () => {
    expect(importOpeningMetadata('1. e4 e5 *')).toEqual({eco:'C20',openingName:"King's Pawn Game"});
  });

  it('does not invent an opening name for a conflicting source ECO header', () => {
    expect(importOpeningMetadata('[ECO "A00"]\n\n1. e4 e5 *'))
      .toEqual({eco:'A00',openingName:null});
  });

  it('never labels a custom starting position as an ordinary opening', () => {
    const custom = '[SetUp "1"]\n[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]\n\n1. e4 e5 *';
    expect(importOpeningMetadata(custom)).toEqual({eco:null,openingName:null});
  });
});
