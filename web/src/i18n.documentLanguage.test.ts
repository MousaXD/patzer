// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import i18n from './i18n';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('document language and screen-reader pronunciation', () => {
  it.each(['en', 'de', 'es', 'ru', 'bg'])(
    'keeps the HTML language synchronized when the interface changes to %s',
    async (language) => {
      await i18n.changeLanguage(language);
      expect(document.documentElement.lang).toBe(language);
    },
  );

  it('updates the language after switching back from a non-English setting', async () => {
    await i18n.changeLanguage('de');
    expect(document.documentElement.lang).toBe('de');
    await i18n.changeLanguage('en');
    expect(document.documentElement.lang).toBe('en');
  });
});
