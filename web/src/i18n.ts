import i18n, { type BackendModule } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import { LANGUAGE_CODES, normalizeLanguage } from './lib/languages';

const LOCALE_LOADERS: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
  bg: () => import('./locales/bg.json'),
  es: () => import('./locales/es.json'),
  de: () => import('./locales/de.json'),
  ru: () => import('./locales/ru.json'),
};

// Keep English bundled synchronously for instant fallback rendering and
// code-split the other locale bundles so they are fetched only when selected.
const lazyLocaleBackend: BackendModule = {
  type: 'backend',
  init() {},
  read(language, _namespace, callback) {
    const code = normalizeLanguage(language);
    if (code === 'en') {
      callback(null, en);
      return;
    }
    const loader = LOCALE_LOADERS[code];
    if (!loader) {
      callback(null, en);
      return;
    }
    loader()
      .then((mod) => callback(null, mod.default))
      .catch((err: unknown) => callback(err as Error, null));
  },
};

// A translated interface must also announce its language to assistive
// technology. index.html defaults to English; i18next owns the live language
// for signed-in profiles and for setup/sign-in before authentication.
i18n.on('languageChanged', (language) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = normalizeLanguage(language);
  }
});

void i18n
  .use(lazyLocaleBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en } },
    partialBundledLanguages: true,
    fallbackLng: 'en',
    supportedLngs: [...LANGUAGE_CODES],
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'lang',
    },
  });

export default i18n;
