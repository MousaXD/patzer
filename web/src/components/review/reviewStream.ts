/** Parse complete server-sent events without assuming each network read
 * ends at an event boundary. Supports LF and CRLF, split UTF-8 reads and
 * multiple data lines as required by the SSE wire format. */
export interface ReviewStreamEvent {
  type: string;
  data: string;
}

export function takeReviewEvents(input: string): { events: ReviewStreamEvent[]; rest: string } {
  const events: ReviewStreamEvent[] = [];
  let remaining = input;
  let match: RegExpExecArray | null;
  const separator = /\r?\n\r?\n/;
  while ((match = separator.exec(remaining)) !== null) {
    const block = remaining.slice(0, match.index);
    remaining = remaining.slice(match.index + match[0].length);
    let type = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length > 0) events.push({ type, data: data.join('\n') });
  }
  return { events, rest: remaining };
}

/** Generation is successful only after a real, structurally usable review
 * payload arrives. A 'done' marker without a review must not clear errors. */
export function isCompleteReviewPayload(value: unknown): value is { review: {
  summary: string;
  skill_assessment: string;
  phases: Record<string, unknown>;
  key_moments: unknown[];
} } {
  if (!value || typeof value !== 'object') return false;
  const review = (value as { review?: unknown }).review;
  if (!review || typeof review !== 'object') return false;
  const v = review as Record<string, unknown>;
  return typeof v.summary === 'string'
    && typeof v.skill_assessment === 'string'
    && !!v.phases && typeof v.phases === 'object' && !Array.isArray(v.phases)
    && Array.isArray(v.key_moments);
}
