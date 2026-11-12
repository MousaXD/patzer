import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import bg from './locales/bg.json';
import es from './locales/es.json';
import de from './locales/de.json';
import ru from './locales/ru.json';
import { LANGUAGE_CODES, normalizeLanguage } from './lib/languages';

// A translated interface must also announce its language to assistive
// technology. index.html defaults to English; i18next owns the live language
// for signed-in profiles and for setup/sign-in before authentication.
i18n.on('languageChanged', (language) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = normalizeLanguage(language);
  }
});

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, bg: { translation: bg }, es: { translation: es }, de: { translation: de }, ru: { translation: ru } },
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
