/** A server refresh must not erase typing that happened while an older notes
 * save was in flight. Clean drafts follow the server; edited drafts stay local. */
export function reconcileReviewNotesDraft(
  currentDraft: string,
  lastConfirmedNotes: string,
  incomingNotes: string,
): string {
  return currentDraft === lastConfirmedNotes ? incomingNotes : currentDraft;
}
