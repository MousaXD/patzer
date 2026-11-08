/** Device-local chess audio configuration. No server schema changes. */
export type AudioTheme = 'natural' | 'board' | 'classic' | 'soft';
export interface AudioPreferences { theme: AudioTheme; volume: number }
export const DEFAULT_AUDIO_PREFERENCES: AudioPreferences = { theme: 'natural', volume: 0.65 };
const KEY = 'patzer.audio.v1';

function storage(): Storage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; }
  catch { return undefined; }
}

export function isAudioTheme(value: unknown): value is AudioTheme {
  return value === 'natural' || value === 'board' || value === 'classic' || value === 'soft';
}

export function normalizeVolume(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : DEFAULT_AUDIO_PREFERENCES.volume;
}

export function isAudioThemeExplicit(): boolean {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && (parsed as { themeExplicit?: unknown }).themeExplicit === true;
  } catch { return false; }
}

export function readAudioPreferences(): AudioPreferences {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return { ...DEFAULT_AUDIO_PREFERENCES };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return { ...DEFAULT_AUDIO_PREFERENCES };
    const data = value as { theme?: unknown; volume?: unknown };
    return {
      theme: isAudioTheme(data.theme) ? data.theme : DEFAULT_AUDIO_PREFERENCES.theme,
      volume: normalizeVolume(data.volume),
    };
  } catch { return { ...DEFAULT_AUDIO_PREFERENCES }; }
}

export function writeAudioPreferences(patch: Partial<AudioPreferences>): AudioPreferences {
  const previous = readAudioPreferences();
  const next: AudioPreferences = {
    theme: isAudioTheme(patch.theme) ? patch.theme : previous.theme,
    volume: patch.volume === undefined ? previous.volume : normalizeVolume(patch.volume),
  };
  try { storage()?.setItem(KEY, JSON.stringify({
    ...next, themeExplicit: patch.theme !== undefined || isAudioThemeExplicit(),
  })); } catch { /* browser private mode or storage quota */ }
  return next;
}
