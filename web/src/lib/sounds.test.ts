// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const synthesized: number[] = [];
const recorded: string[] = [];
const stopped: number[] = [];
class Param {
  value = 0;
  setValueAtTime(v: number) { this.value = v; return this; }
  exponentialRampToValueAtTime() { return this; }
  setTargetAtTime(v: number) { this.value = v; return this; }
  cancelScheduledValues() { return this; }
}
class Node {
  gain = new Param(); frequency = new Param(); playbackRate = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param();
  attack = new Param(); release = new Param();
  type = ''; buffer: unknown = null;
  onended: (() => void) | null = null;
  connect<T>(node: T) { return node; }
  start() { synthesized.push(this.frequency.value); }
  stop() { stopped.push(1); this.onended?.(); }
}
class Context {
  sampleRate = 8000; currentTime = 0; state = 'running'; destination = new Node();
  createGain() { return new Node(); }
  createOscillator() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createBufferSource() {
    const n = new Node();
    n.start = () => { const tag = (n.buffer as { tag?: string } | null)?.tag; if (tag) recorded.push(tag); };
    return n;
  }
  createDynamicsCompressor() { return new Node(); }
  createConvolver() { return new Node(); }
  createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  decodeAudioData(bytes: unknown): Promise<AudioBuffer> { return Promise.resolve({ tag: String(bytes) } as unknown as AudioBuffer); }
  resume() { return Promise.resolve(); }
}
const fetchOk = vi.fn(async (url: string) => ({
  ok: true, status: 200, arrayBuffer: async () => url,
}));

beforeEach(() => {
  synthesized.length = 0; recorded.length = 0; stopped.length = 0;
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.stubGlobal('AudioContext', Context);
  vi.stubGlobal('fetch', fetchOk);
  fetchOk.mockClear();
});

describe('Natural sound theme', () => {
  it('does not play or queue audio before interaction authorization', async () => {
    const a = await import('./sounds');
    a.playSound('move');
    expect(recorded).toEqual([]);
    expect(synthesized).toEqual([]);
    a.unlockAudio();
    await a.moveSoundsReady();
    expect(recorded).toEqual([]);
    a.playSound('move');
    expect(recorded).toEqual([expect.stringMatching(/board-move\.wav$/)]);
    expect(synthesized).toEqual([]);
  });

  it('defaults to locally bundled natural clicks for moves and other events', async () => {
    const a = await import('./sounds');
    a.setSoundSet('classic'); a.setMoveSoundSet('classic');
    expect(a.getAudioTheme()).toBe('natural');
    a.unlockAudio(); await a.moveSoundsReady();
    a.playSound('move');
    expect(recorded).toEqual([expect.stringMatching(/board-move\.wav$/)]);
    expect(synthesized).toEqual([]);
    recorded.length = 0;
    expect(await a.previewAudio('natural', 'check')).toBe(true);
    expect(recorded).toHaveLength(2);
    recorded.length = 0;
    expect(await a.previewAudio('natural', 'castle')).toBe(true);
    expect(recorded).toHaveLength(2);
    expect(synthesized).toEqual([]);
  });

  it('keeps legacy Soft and Board profile selections when theme is not explicit', async () => {
    const a = await import('./sounds');
    a.setSoundSet('soft'); expect(a.getAudioTheme()).toBe('soft');
    a.setMoveSoundSet('board'); expect(a.getAudioTheme()).toBe('board-soft');
  });

  it('preserves recorded Board moves with Soft checks from the old two-setting profile', async () => {
    const a = await import('./sounds');
    a.setSoundSet('soft'); a.setMoveSoundSet('board');
    expect(a.getAudioTheme()).toBe('board-soft');
    a.unlockAudio(); await a.moveSoundsReady();
    a.playSound('move');
    expect(recorded).toEqual([expect.stringMatching(/board-move\\.wav$/)]);
    expect(synthesized).toEqual([]);
    a.playSound('check');
    expect(synthesized).toContain(659);
    expect(synthesized).not.toContain(1175);
    expect(await a.previewAudio('board-soft', 'move')).toBe(true);
  });

  it('allows explicit original Classic and Soft synthesizers', async () => {
    const a = await import('./sounds');
    a.unlockAudio();
    a.setAudioTheme('classic');
    a.playSound('move'); expect(synthesized).toContain(280);
    synthesized.length = 0;
    a.setAudioTheme('soft');
    a.playSound('check');
    expect(synthesized).toContain(659);
    expect(synthesized).not.toContain(1175);
  });

  it('honors the chosen theme for check and game end after legacy profile hydration', async () => {
    const a = await import('./sounds');
    a.unlockAudio();
    // A device-specific theme overrides older account-level fields.
    a.setAudioTheme('soft');
    a.setSoundSet('classic');
    a.setMoveSoundSet('classic');
    a.playSound('check');
    expect(synthesized).toContain(659);
    expect(synthesized).not.toContain(1175);
    synthesized.length = 0;
    a.playSound('game_end');
    expect(synthesized).toContain(784);
    // Legacy Classic bells do not bleed into the Soft theme.
    expect(synthesized).not.toContain(1175);

    a.setAudioTheme('classic');
    a.setSoundSet('soft');
    synthesized.length = 0;
    a.playSound('check');
    expect(synthesized).toContain(1175);
  });

  it('previews without changing selected device theme', async () => {
    const a = await import('./sounds');
    a.setAudioTheme('soft');
    expect(await a.previewAudio('natural', 'move')).toBe(true);
    expect(a.getAudioTheme()).toBe('soft');
    expect(recorded).toHaveLength(1);
    expect(synthesized).toEqual([]);
  });

  it('uses the remaining recording if only one fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: !url.includes('capture'), status: 404, arrayBuffer: async () => url,
    })));
    const a = await import('./sounds');
    a.unlockAudio(); await a.moveSoundsReady();
    a.playSound('capture');
    expect(recorded).toEqual([expect.stringMatching(/board-move\.wav$/)]);
    expect(synthesized).toEqual([]);
  });

  it('does not substitute the disliked synthesis if both samples are missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => '' })));
    const a = await import('./sounds');
    a.unlockAudio(); await a.moveSoundsReady();
    a.playSound('capture');
    expect(a.getAudioLoadState()).toBe('failed');
    expect(recorded).toEqual([]);
    expect(synthesized).toEqual([]);
    expect(await a.previewAudio('natural')).toBe(false);
  });

  it('respects mute and immediately stops an active recorded source', async () => {
    const a = await import('./sounds');
    a.unlockAudio(); await a.moveSoundsReady();
    a.playSound('move');
    a.setSoundEnabled(false);
    expect(stopped.length).toBeGreaterThan(0);
    a.playSound('check');
    expect(await a.previewAudio('natural')).toBe(false);
    expect(recorded).toHaveLength(1);
  });

  it('persists and clamps volume and limits double sound from rapid navigation', async () => {
    const a = await import('./sounds');
    a.unlockAudio(); await a.moveSoundsReady();
    a.setAudioVolume(0.25);
    expect(a.getAudioVolume()).toBe(0.25);
    a.playSound('move'); a.playSound('capture');
    expect(recorded).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem('patzer.audio.v1')!)).toMatchObject({ volume: 0.25 });
    a.setAudioVolume(2);
    expect(a.getAudioVolume()).toBe(1);
  });
});
