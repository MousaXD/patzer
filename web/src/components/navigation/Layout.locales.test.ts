import { describe, expect, it } from 'vitest';
import en from '../../locales/en.json';
import de from '../../locales/de.json';
import es from '../../locales/es.json';
import ru from '../../locales/ru.json';
import bg from '../../locales/bg.json';

// Missing global navigation keys fall back to English even when the shell
// is otherwise translated. Keep primary routes and version help localized.
const keys = [
  'app.home', 'home.playTitle', 'home.reviewTitle', 'insights.title',
  'train.nav', 'learn.nav', 'openings.nav', 'plan.nav',
  'players.nav', 'lab.nav', 'common.settings',
  'common.viewChangelog', 'navigation.versionChangelog',
] as const;

const locales = { en, de, es, ru, bg };

describe('global navigation translation coverage', () => {
  for (const [language, translations] of Object.entries(locales)) {
    it('provides every primary route label in ' + language, () => {
      for (const key of keys) {
        const label = key.split('.').reduce<unknown>((value, part) => {
          if (value === null || typeof value !== 'object') return undefined;
          return (value as Record<string, unknown>)[part];
        }, translations);
        expect(label, language + ' missing ' + key).toBeTypeOf('string');
        expect((label as string).trim().length, language + ' has empty ' + key).toBeGreaterThan(0);
      }
    });
  }
});
