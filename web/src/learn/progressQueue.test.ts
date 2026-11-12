import { describe, expect, it, vi } from 'vitest';
import { LessonProgressQueue, type ProgressSaveStatus } from './progressQueue';

describe('lesson progress save ordering', () => {
  it('does not submit a later step before an earlier write is acknowledged', async () => {
    let finishFirst!: () => void;
    const first = new Promise<void>((resolve) => { finishFirst = resolve; });
    const persist = vi.fn().mockImplementationOnce(() => first).mockResolvedValue(undefined);
    const statuses: ProgressSaveStatus[] = [];
    const onSaved = vi.fn();
    const queue = new LessonProgressQueue<{ step: number }>(persist, (s) => statuses.push(s), onSaved);
    queue.enqueue({ step: 1 });
    queue.enqueue({ step: 2 });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenLastCalledWith({ step: 1 });
    finishFirst();
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(2));
    expect(persist).toHaveBeenLastCalledWith({ step: 2 });
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('idle'));
    expect(onSaved).toHaveBeenCalledTimes(2);
    queue.dispose();
  });

  it('keeps failed steps, pauses subsequent writes and retries them in order', async () => {
    const calls: string[] = [];
    let offline = true;
    const persist = vi.fn(async (payload: { type: string }) => {
      calls.push(payload.type);
      if (offline) throw new Error('offline');
    });
    const statuses: ProgressSaveStatus[] = [];
    const onSaved = vi.fn();
    const queue = new LessonProgressQueue(persist, (s) => statuses.push(s), onSaved);
    queue.enqueue({ type: 'step1' });
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('error'));
    queue.enqueue({ type: 'finish-stars' });
    expect(calls).toEqual(['step1']); // never mark the stars as saved ahead of step 1
    expect(onSaved).not.toHaveBeenCalled();

    offline = false;
    queue.retry();
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('idle'));
    expect(calls).toEqual(['step1', 'step1', 'finish-stars']);
    expect(onSaved).toHaveBeenCalledTimes(2);
    queue.dispose();
  });

  it('stops queuing further requests and UI callbacks when the player leaves', async () => {
    let resolveFirst!: () => void;
    const first = new Promise<void>((resolve) => { resolveFirst = resolve; });
    const persist = vi.fn().mockImplementationOnce(() => first).mockResolvedValue(undefined);
    const onStatus = vi.fn();
    const onSaved = vi.fn();
    const queue = new LessonProgressQueue(persist, onStatus, onSaved);
    queue.enqueue({ step: 1 });
    queue.enqueue({ step: 2 });
    queue.dispose();
    resolveFirst();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(persist).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledTimes(1);
  });
});
