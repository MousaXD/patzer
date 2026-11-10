import { describe, expect, it } from 'vitest';
import { isCompleteReviewPayload, takeReviewEvents } from './reviewStream';

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

  it('requires an actual review rather than trusting any done message', () => {
    expect(isCompleteReviewPayload({ review: {} })).toBe(false);
    expect(isCompleteReviewPayload({ review: null })).toBe(false);
    expect(isCompleteReviewPayload({ review: {
      summary: 'Summary', skill_assessment: '', phases: {}, key_moments: [],
    } })).toBe(true);
  });
});
