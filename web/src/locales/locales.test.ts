import { describe, expect, it } from 'vitest';
import { createInstance } from 'i18next';
import en from './en.json';
import de from './de.json';
import learnEn from './learn/en.json';
import learnDe from './learn/de.json';
import learnRu from './learn/ru.json';
import ru from './ru.json';
import bg from './bg.json';
import es from './es.json';
import { loadLearnTexts } from '../learn/content';
import { goalText } from '../lib/goalText';

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'string') out[prefix + k] = v;
    else Object.assign(out, flatten(v, `${prefix}${k}.`));
  }
  return out;
}

const placeholders = (s: string) => (s.match(/{{\s*\w+\s*}}/g) ?? []).sort();

// Practice is a safety-sensitive, accessible journey: missing translations
// otherwise silently display English controls in a non-English exercise.
// Validate all five supported locales and the interpolated move metadata.
describe.each([['de', de], ['ru', ru], ['bg', bg], ['es', es]] as const)(
  '%s blind-practice locale',
  (lang, resource) => {
    const enPractice = flatten({ practice: en.practice } as Tree);
    const localized = flatten({ practice: resource.practice } as Tree);
    it('has complete keys with matching interpolations and localized instructions', () => {
      expect(Object.keys(localized).sort()).toEqual(Object.keys(enPractice).sort());
      for (const [key, englishText] of Object.entries(enPractice)) {
        expect(localized[key]?.trim().length, key).toBeGreaterThan(0);
        expect(placeholders(localized[key] ?? ''), key).toEqual(placeholders(englishText));
      }
      for (const key of ['practice.entry', 'practice.pickerHeading', 'practice.learnHeading',
        'practice.boardLabel', 'practice.piece.p']) {
        expect(localized[key], `${lang}: ${key}`).not.toEqual(enPractice[key]);
      }
    });
  },
);

// i18next silently falls back to English for a missing key, so a gap in a
// locale never shows up as an error — only as an English word in the middle
// of a German screen. Pin German to full parity with English.
describe('de locale', () => {
  const enFlat = flatten(en as Tree);
  const deFlat = flatten(de as Tree);

  it('has every key that en has, and nothing else', () => {
    expect(Object.keys(deFlat).sort()).toEqual(Object.keys(enFlat).sort());
  });

  it('keeps every interpolation placeholder', () => {
    for (const key of Object.keys(enFlat)) {
      expect(placeholders(deFlat[key] ?? ''), key).toEqual(placeholders(enFlat[key]!));
    }
  });
});

// The mobile Game Review board must not fall back to English instructions in
// the midst of an otherwise translated analysis workspace.
describe.each([['en', en], ['de', de], ['es', es], ['ru', ru], ['bg', bg]] as const)(
  '%s Game Review board guidance', (lang, locale) => {
    it('translates board, navigation and keyboard guidance', () => {
      expect(locale.review.startingPosition?.trim().length, lang).toBeGreaterThan(0);
      expect(locale.review.bestArrowNote?.trim().length, lang).toBeGreaterThan(0);
      expect(locale.review.moveNavigation?.trim().length, lang).toBeGreaterThan(0);
      expect(locale.review.keyboardShortcuts?.trim().length, lang).toBeGreaterThan(0);
      expect(placeholders(locale.review.why.showBestOnBoard), lang).toEqual(['{{san}}']);
      if (lang !== 'en') {
        expect(locale.review.startingPosition).not.toEqual(en.review.startingPosition);
        expect(locale.review.bestArrowNote).not.toEqual(en.review.bestArrowNote);
        expect(locale.review.moveNavigation).not.toEqual(en.review.moveNavigation);
        expect(locale.review.keyboardShortcuts).not.toEqual(en.review.keyboardShortcuts);
        expect(locale.review.why.showBestOnBoard).not.toEqual(en.review.why.showBestOnBoard);
      }
    });
    it('provides distinct, translated review recovery and retry messages', () => {
      for (const reason of ['invalid', 'unreadable', 'notFound', 'loadFailed'] as const) {
        expect(locale.review.unavailableReason[reason]?.trim().length).toBeGreaterThan(0);
        if (lang !== 'en') {
          expect(locale.review.unavailableReason[reason]).not.toBe(en.review.unavailableReason[reason]);
        }
      }
      for (const key of ['unavailableHeading', 'retryLoading', 'retryingLoading', 'backToGames'] as const) {
        expect(locale.review[key]?.trim().length).toBeGreaterThan(0);
        if (lang !== 'en') expect(locale.review[key]).not.toBe(en.review[key]);
      }
      for (const key of ['filterPrev', 'filterNext', 'filterClear'] as const) {
        expect(locale.review[key]?.trim().length).toBeGreaterThan(0);
        if (lang !== 'en') expect(locale.review[key]).not.toBe(en.review[key]);
      }
      expect(placeholders(locale.review.pickCountLabel), lang).toEqual([
        '{{classification}}', '{{count}}', '{{side}}',
      ]);
      if (lang !== 'en') expect(locale.review.pickCountLabel).not.toEqual(en.review.pickCountLabel);
      for (const key of ['tooLarge', 'invalidPgn', 'busy', 'unavailable'] as const) {
        expect(locale.review.analysisError[key]?.trim().length).toBeGreaterThan(0);
        if (lang !== 'en') expect(locale.review.analysisError[key]).not.toBe(en.review.analysisError[key]);
      }
      expect(locale.review.storedAnalysisUnreadable?.trim().length).toBeGreaterThan(0);
      expect(locale.review.runEngine?.trim().length).toBeGreaterThan(0);
      if (lang !== 'en') {
        expect(locale.review.storedAnalysisUnreadable).not.toBe(en.review.storedAnalysisUnreadable);
        expect(locale.review.runEngine).not.toBe(en.review.runEngine);
      }
    });
    it('localizes notes-save recovery and exploratory branch sharing', () => {
      for (const key of ['notesSaveFailed', 'notesRetrySave', 'shareBranch', 'shareBranchTitle', 'clipboardUnavailable', 'bookmarkSaveFailed', 'bookmarkRetry'] as const) {
        expect(locale.review[key]?.trim().length, `${lang}: ${key}`).toBeGreaterThan(0);
        if (lang !== 'en') expect(locale.review[key]).not.toEqual(en.review[key]);
      }
    });
    it('describes variation-local progress instead of the saved PGN move count', () => {
      expect(placeholders(locale.review.variationProgress), lang).toEqual(['{{current}}', '{{total}}']);
      expect(placeholders(locale.review.variationForkOf), lang).toEqual(['{{number}}']);
      expect(placeholders(locale.review.variationJumpMove), lang).toEqual(['{{number}}', '{{san}}']);
      expect(locale.review.variationMoveTrail?.trim().length, lang).toBeGreaterThan(0);
      expect(locale.review.variationJumpFork?.trim().length, lang).toBeGreaterThan(0);
      expect(locale.review.variationMoveNavigation?.trim().length, lang).toBeGreaterThan(0);
      if (lang !== 'en') {
        expect(locale.review.variationProgress).not.toEqual(en.review.variationProgress);
        expect(locale.review.variationForkOf).not.toEqual(en.review.variationForkOf);
        expect(locale.review.variationJumpMove).not.toEqual(en.review.variationJumpMove);
        expect(locale.review.variationMoveTrail).not.toEqual(en.review.variationMoveTrail);
        expect(locale.review.variationJumpFork).not.toEqual(en.review.variationJumpFork);
        expect(locale.review.variationMoveNavigation).not.toEqual(en.review.variationMoveNavigation);
      }
    });
    it('localizes Engine Lines recovery and safe move-action names', () => {
      for (const key of ['linesBusy', 'linesUnavailable', 'linesRetry', 'linesFollowMove', 'linesTryMove'] as const) {
        expect(locale.review[key]?.trim().length, `${lang}: ${key}`).toBeGreaterThan(0);
        expect(placeholders(locale.review[key]), `${lang}: ${key}`).toEqual(placeholders(en.review[key]));
        if (lang !== 'en') expect(locale.review[key]).not.toEqual(en.review[key]);
      }
      expect(placeholders(locale.review.linesFollowMove), lang).toEqual(['{{san}}']);
      expect(placeholders(locale.review.linesTryMove), lang).toEqual(['{{san}}']);
    });
  },
);

// Lesson texts have their own namespace; missing keys must not silently put
// English sentences into a translated lesson.
describe.each([['de', learnDe], ['ru', learnRu]] as const)('%s lesson texts', (lang, texts) => {
  const enFlat = flatten(learnEn as Tree);
  const translated = flatten(texts as Tree);

  it('has every key that en has, and nothing else', () => {
    expect(Object.keys(translated).sort()).toEqual(Object.keys(enFlat).sort());
  });

  it('keeps every placeholder and every bold mark', () => {
    for (const key of Object.keys(enFlat)) {
      expect(placeholders(translated[key] ?? ''), key).toEqual(placeholders(enFlat[key]!));
      // **bold** pairs must stay pairs, or the markers would show as text.
      expect((translated[key]!.match(/\*\*/g) ?? []).length % 2, key).toBe(0);
    }
  });

  it('loads the translated namespace used by lessons', async () => {
    await loadLearnTexts(lang);
    const { default: i18n } = await import('../i18n');
    for (const [key, value] of Object.entries(translated)) {
      expect(i18n.getResource(lang, 'learn', key), key).toBe(value);
    }
  });
});

// Russian has four CLDR plural categories (one / few / many / other) where
// English has two, and i18next does not fall back from a missing "_few" to
// "_other" — it falls back to English. So every pluralised English key must
// carry all four Russian forms, and everything else must match one to one.
describe('ru locale', () => {
  const enFlat = flatten(en as Tree);
  const ruFlat = flatten(ru as Tree);
  const PLURAL = /_(one|few|many|other)$/;
  const RU_FORMS = ['one', 'few', 'many', 'other'];

  it('has every key that en has, and nothing else', () => {
    const expected = new Set<string>();
    for (const key of Object.keys(enFlat)) {
      if (PLURAL.test(key)) for (const f of RU_FORMS) expected.add(key.replace(PLURAL, `_${f}`));
      else expected.add(key);
    }
    expect(Object.keys(ruFlat).sort()).toEqual([...expected].sort());
  });

  it('keeps every interpolation placeholder', () => {
    for (const [key, value] of Object.entries(ruFlat)) {
      const enKey = PLURAL.test(key) ? key.replace(PLURAL, '_other') : key;
      expect(placeholders(value), key).toEqual(placeholders(enFlat[enKey]!));
    }
  });

  it('uses Russian plurals for lesson and trainer counts', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'ru', fallbackLng: 'en', resources: {
      en: { translation: en }, ru: { translation: ru },
    } });
    for (const [count, form] of [[1, 'one'], [2, 'few'], [5, 'many'], [11, 'many'],
      [21, 'one'], [22, 'few'], [25, 'many'], [1.5, 'other']] as const) {
      for (const key of ['learn.tasks', 'learn.starsGained', 'learn.play.wonMate',
        'openings.trainer.branchCount', 'openings.trainer.practiseBranches']) {
        expect(i18n.t(key, { count }), `${key}: ${count}`).toBe(
          ruFlat[`${key}_${form}`]!.replace('{{count}}', String(count)),
        );
      }
    }
  });
});

// Bulgarian and Spanish are partial (missing keys fall back to English), but
// the Home card is on everyone's first screen every day: its texts are in all
// five locales.
describe.each([['de', de], ['ru', ru], ['bg', bg], ['es', es]] as const)('%s puzzle-of-the-day texts', (_lang, texts) => {
  it('has the Home card and its Puzzles-tab texts', () => {
    const flat = flatten(texts as Tree);
    for (const key of ['home.todayPuzzle', 'home.dailyOpen', 'home.dailySolved', 'home.dailyDone', 'home.dailyStart',
      'home.dailyStreak_one', 'home.dailyStreak_other', 'train.puzzles.allDone',
      'train.puzzles.daily.title', 'train.puzzles.daily.more', 'train.puzzles.daily.already']) {
      expect(flat[key], key).toBeTruthy();
    }
  });
});

describe.each([['en', en], ['de', de], ['ru', ru], ['bg', bg], ['es', es]] as const)('%s settings leave guard', (_lang, texts) => {
  it('has a localized warning and both decisions before discarding unsaved work', () => {
    const flat = flatten(texts as Tree);
    for (const key of ['settings.leaveTitle', 'settings.leaveDescription',
      'settings.keepEditing', 'settings.discardChanges']) {
      expect(flat[key], key).toBeTruthy();
    }
  });
});

describe('goalText', () => {
  const t = ((key: string, opts?: Record<string, unknown>) => {
    const v = flatten(de as Tree)[key];
    if (v === undefined) return opts?.defaultValue as string;
    return v.replace(/{{(\w+)}}/g, (_, n: string) => String(opts?.[n] ?? ''));
  }) as never;

  it('renders a stored goal in the user language from its kind and metadata', () => {
    const goal = {
      kind: 'opening_play',
      title: 'Play 3 games in Sicilian Defense',
      description: '…',
      target: 3,
      metadata: { eco: 'B20', opening_name: 'Sicilian Defense', color: 'black' },
    };
    expect(goalText(t, goal).title).toBe('Spiele 3 Partien mit Sicilian Defense');
    expect(goalText(t, goal).description).toContain('als Schwarz');
  });

  it('falls back to the stored text for an unknown kind', () => {
    const goal = { kind: 'something_new', title: 'Stored title', description: 'Stored description', target: 1, metadata: null };
    expect(goalText(t, goal)).toEqual({ title: 'Stored title', description: 'Stored description' });
  });
});
