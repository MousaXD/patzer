import { describe, expect, it } from 'vitest';
import en from '../locales/en.json';
import de from '../locales/de.json';
import es from '../locales/es.json';
import ru from '../locales/ru.json';
import bg from '../locales/bg.json';

// These appear on the shared homepage's loading, first-use, returning-player
// and retry paths. A missing key silently falls back to an English label.
const homeKeys = [
  'greet.morning', 'greet.afternoon', 'greet.evening',
  'loadingStats', 'statsUnavailable', 'continue', 'tileLoading',
  'tileUnavailable', 'loadingGames', 'gamesUnavailable',
  'learnNext', 'learnResume', 'learnDesc', 'unreviewed',
  'streak.win', 'streak.loss', 'streak.draw',
  'outcome.win', 'outcome.loss', 'outcome.draw',
] as const;

function lookup(source: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((value, part) => {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)[part] : undefined;
  }, source);
}

describe('shared homepage locale coverage', () => {
  for (const [language, messages] of Object.entries({ en, de, es, ru, bg })) {
    it('translates all visible home recovery and navigation states in ' + language, () => {
      for (const key of homeKeys) {
        const value = lookup(messages.home, key);
        expect(value, language + ' missing home.' + key).toBeTypeOf('string');
        expect((value as string).trim().length, language + ' empty home.' + key).toBeGreaterThan(0);
      }
      expect(messages.common.retry.trim().length, language + ' missing common.retry').toBeGreaterThan(0);
      if (language !== 'en') {
        for (const key of ['continue', 'statsUnavailable', 'gamesUnavailable']) {
          expect(lookup(messages.home, key), language + ' untranslated home.' + key)
            .not.toBe(lookup(en.home, key));
        }
        expect(messages.common.retry, language + ' untranslated retry').not.toBe(en.common.retry);
      }
    });
  }
});
