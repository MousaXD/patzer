import { describe, expect, it } from 'vitest';
import { reconcileReviewNotesDraft } from './reviewNotes';

describe('Game Review notes while saving and refreshing', () => {
  it('adopts a fresh server value if the player has not edited the draft', () => {
    expect(reconcileReviewNotesDraft('old', 'old', 'new')).toBe('new');
  });

  it('does not discard newer typing when a previous save finally updates the server', () => {
    expect(reconcileReviewNotesDraft('my newer draft', 'old', 'previously saved draft'))
      .toBe('my newer draft');
  });

  it('keeps a draft already matching the just-saved server value', () => {
    expect(reconcileReviewNotesDraft('saved', 'old', 'saved')).toBe('saved');
  });
});
