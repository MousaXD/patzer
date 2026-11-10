/** Parse complete server-sent events without assuming each network read
 * ends at an event boundary. Supports LF and CRLF, split UTF-8 reads and
 * multiple data lines as required by the SSE wire format. */
export interface ReviewStreamEvent {
  type: string;
  data: string;
}

export interface ReviewProgressEvent {
  step: 'opening' | 'phase:opening' | 'phase:middlegame' | 'phase:endgame' | 'summary' | 'moment';
  done: number;
  total: number;
  index?: number;
}

/** Progress is display data from a streaming response, not trusted layout
 * input. Reject malformed, negative or over-100% values before rendering. */
export function parseReviewProgress(value: unknown): ReviewProgressEvent | null {
  if (!isRecord(value)
    || !['opening', 'phase:opening', 'phase:middlegame', 'phase:endgame', 'summary', 'moment'].includes(value.step as string)
    || !Number.isSafeInteger(value.total) || (value.total as number) < 1
    || !Number.isSafeInteger(value.done) || (value.done as number) < 0 || (value.done as number) > (value.total as number)
    || (value.index !== undefined && (!Number.isSafeInteger(value.index) || (value.index as number) < 0))) return null;
  return value as unknown as ReviewProgressEvent;
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
  if (typeof v.summary !== 'string' || typeof v.skill_assessment !== 'string') return false;
  if (!isRecord(v.phases) || !Array.isArray(v.key_moments)) return false;

  // An object-shaped result is not necessarily safe to render: the report
  // calls phase.accuracy.toFixed() and reads fields from every moment. Never
  // save a broken streamed result as the completed report.
  if (v.opening != null && (!isRecord(v.opening)
    || typeof v.opening.name !== 'string'
    || typeof v.opening.prose !== 'string'
    || (v.opening.eco != null && typeof v.opening.eco !== 'string'))) return false;

  for (const phase of ['opening', 'middlegame', 'endgame']) {
    const item = v.phases[phase];
    if (item != null && (!isRecord(item)
      || typeof item.accuracy !== 'number'
      || !Number.isFinite(item.accuracy)
      || typeof item.prose !== 'string')) return false;
  }

  return v.key_moments.every((moment: unknown) => isRecord(moment)
    && Number.isSafeInteger(moment.ply)
    && (moment.ply as number) > 0
    && typeof moment.title === 'string'
    && typeof moment.prose === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
