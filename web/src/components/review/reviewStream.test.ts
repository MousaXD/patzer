import { describe, expect, it } from 'vitest';
import { isCompleteReviewPayload, parseReviewProgress, takeReviewEvents } from './reviewStream';

describe('Game Review AI stream framing', () => {
  it('parses full SSE packets with LF and CRLF separators', () => {
    expect(takeReviewEvents('event: progress\ndata: {"done":1}\n\n')).toEqual({
      events: [{ type: 'progress', data: '{"done":1}' }], rest: '',
    });
    expect(takeReviewEvents('event: done\r\ndata: {"review":1}\r\n\r\n')).toEqual({
      events: [{ type: 'done', data: '{"review":1}' }], rest: '',
    });
  });

  it('retains incomplete packets across stream chunks', () => {
    const first = takeReviewEvents('event: done\ndata: {"re');
    expect(first.events).toEqual([]);
    const second = takeReviewEvents(first.rest + 'view":{}}\n\n');
    expect(second.events).toEqual([{ type: 'done', data: '{"review":{}}' }]);
    expect(second.rest).toBe('');
  });

  it('reassembles multi-line data and skips comment-only heartbeat packets', () => {
    const parsed = takeReviewEvents(': keepalive\n\nevent: error\ndata: worker\ndata: unavailable\n\n');
    expect(parsed.events).toEqual([{ type: 'error', data: 'worker\nunavailable' }]);
  });

  it('ignores malformed progress that could distort or overflow the progress bar', () => {
    const valid = { step: 'moment', done: 2, total: 5, index: 1 };
    expect(parseReviewProgress(valid)).toEqual(valid);
    expect(parseReviewProgress({ ...valid, done: 7 })).toBeNull();
    expect(parseReviewProgress({ ...valid, total: 0 })).toBeNull();
    expect(parseReviewProgress({ ...valid, done: -1 })).toBeNull();
    expect(parseReviewProgress({ ...valid, done: Infinity })).toBeNull();
    expect(parseReviewProgress({ ...valid, step: 'unknown' })).toBeNull();
    expect(parseReviewProgress({ ...valid, index: -2 })).toBeNull();
    expect(parseReviewProgress(null)).toBeNull();
  });

  it('requires an actual review rather than trusting any done message', () => {
    expect(isCompleteReviewPayload({ review: {} })).toBe(false);
    expect(isCompleteReviewPayload({ review: null })).toBe(false);
    const minimal = { summary: 'Summary', skill_assessment: '', phases: {}, key_moments: [] };
    expect(isCompleteReviewPayload({ review: minimal })).toBe(true);
    // Bad nested shapes previously passed the guard and could throw inside
    // GameReportPanel's accuracy.toFixed() and key-moment rendering.
    expect(isCompleteReviewPayload({ review: {
      ...minimal, phases: { opening: { accuracy: null, prose: 'opening' } },
    } })).toBe(false);
    expect(isCompleteReviewPayload({ review: {
      ...minimal, phases: { opening: { accuracy: 85.5, prose: 'Good opening' } },
    } })).toBe(true);
    expect(isCompleteReviewPayload({ review: {
      ...minimal, key_moments: [null],
    } })).toBe(false);
    expect(isCompleteReviewPayload({ review: {
      ...minimal, key_moments: [{ ply: 2, title: 'A key moment', prose: 'Explained' }],
    } })).toBe(true);
    expect(isCompleteReviewPayload({ review: {
      ...minimal, opening: { name: 'Invalid opening', prose: 123 },
    } })).toBe(false);
    expect(isCompleteReviewPayload({ review: {
      ...minimal, opening: { name: 'Valid opening', prose: 'The opening', eco: { broken: true } },
    } })).toBe(false);
  });
});
