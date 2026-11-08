// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_AUDIO_PREFERENCES, isAudioTheme, isAudioThemeExplicit,
  normalizeVolume, readAudioPreferences, writeAudioPreferences,
} from './audioPreferences';

beforeEach(() => window.localStorage.clear());

describe('device-local audio preferences', () => {
  it('defaults to Natural and a restrained volume', () => {
    expect(readAudioPreferences()).toEqual(DEFAULT_AUDIO_PREFERENCES);
    expect(isAudioThemeExplicit()).toBe(false);
  });
  it('persists explicit themes and volume', () => {
    writeAudioPreferences({ theme: 'soft', volume: 0.35 });
    expect(readAudioPreferences()).toEqual({ theme: 'soft', volume: 0.35 });
    expect(isAudioThemeExplicit()).toBe(true);
  });
  it('preserves the combined legacy Board plus Soft theme across reloads', () => {
    expect(isAudioTheme('board-soft')).toBe(true);
    writeAudioPreferences({ theme: 'board-soft' });
    expect(readAudioPreferences().theme).toBe('board-soft');
    expect(isAudioThemeExplicit()).toBe(true);
  });

  it('volume alone does not override inherited old profile settings', () => {
    writeAudioPreferences({ volume: 0.5 });
    expect(isAudioThemeExplicit()).toBe(false);
  });
  it('clamps invalid values and ignores malformed JSON', () => {
    expect(isAudioTheme('untrusted')).toBe(false);
    expect(normalizeVolume(4)).toBe(1);
    expect(normalizeVolume(-1)).toBe(0);
    window.localStorage.setItem('patzer.audio.v1', '{"theme":"untrusted","volume":4}');
    expect(readAudioPreferences()).toEqual({ theme: 'natural', volume: 1 });
    window.localStorage.setItem('patzer.audio.v1', '[not json');
    expect(readAudioPreferences()).toEqual(DEFAULT_AUDIO_PREFERENCES);
  });
});
