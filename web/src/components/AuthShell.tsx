import { type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { BookOpenCheck, ChartNoAxesCombined, Swords } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LogoMark } from './Logo';
import { LANGUAGES, normalizeLanguage } from '../lib/languages';

type AuthShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Show the product introduction only on the public sign-in landing page. */
  variant?: 'standard' | 'welcome';
};

// One design and language-switching contract for sign-in, registration, and
// account recovery. Forms stay page-owned so server capabilities and security
// behavior remain independent of the visual presentation.
export default function AuthShell({ title, subtitle, children, variant = 'standard' }: AuthShellProps) {
  const { t, i18n } = useTranslation();
  const reduceMotion = useReducedMotion();
  const welcome = variant === 'welcome';
  const benefits = [
    { icon: Swords, label: t('authShell.play', { defaultValue: 'Play at your pace' }) },
    { icon: BookOpenCheck, label: t('authShell.review', { defaultValue: 'Understand your decisions' }) },
    { icon: ChartNoAxesCombined, label: t('authShell.progress', { defaultValue: 'See how you improve' }) },
  ];

  return (
    <div className="auth-shell relative isolate flex min-h-dvh w-full items-center justify-center overflow-x-clip bg-ui-bg px-4 py-8 text-ui-foreground sm:px-6 lg:px-8" data-auth-shell>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-56 -top-56 h-[36rem] w-[36rem] rounded-full bg-gold-500/10 blur-3xl" />
        <div className="absolute -bottom-60 -right-48 h-[40rem] w-[40rem] rounded-full bg-green-500/10 blur-3xl" />
      </div>

      <div className={welcome
        ? 'relative grid w-full max-w-[1120px] gap-8 lg:min-h-[min(700px,calc(100dvh-80px))] lg:grid-cols-[minmax(0,1.13fr)_minmax(360px,0.87fr)] lg:items-stretch lg:gap-10'
        : 'relative w-full max-w-md'}>
        {welcome && (
          <section className="relative hidden min-w-0 flex-col justify-between overflow-hidden rounded-[28px] bg-gradient-to-br from-[#1e3027] via-[#344b36] to-[#5b7950] p-9 text-white shadow-lift lg:flex xl:p-12" aria-label={t('authShell.intro', { defaultValue: 'About Patzer' })}>
            <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-10 h-96 w-96 rotate-12 opacity-[0.09]"
              style={{ backgroundImage: 'linear-gradient(45deg, white 25%, transparent 25%), linear-gradient(-45deg, white 25%, transparent 25%), linear-gradient(45deg, transparent 75%, white 75%), linear-gradient(-45deg, transparent 75%, white 75%)', backgroundSize: '72px 72px', backgroundPosition: '0 0, 0 36px, 36px -36px, -36px 0' }} />
            <div className="relative flex items-center gap-3">
              <LogoMark size={38} />
              <span className="text-sm font-bold uppercase tracking-[0.2em]">Patzer</span>
            </div>
            <div className="relative my-auto py-10">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#d5e7c6]">
                {t('authShell.eyebrow', { defaultValue: 'A place to sharpen your chess' })}
              </p>
              <h2 className="mt-5 max-w-lg text-4xl font-bold leading-[1.13] tracking-tight xl:text-5xl">
                {t('authShell.headline', { defaultValue: 'Make your next move count.' })}
              </h2>
              <p className="mt-5 max-w-md text-base leading-relaxed text-white/80">
                {t('authShell.description', { defaultValue: 'Play, revisit your games, and grow your skills in a space built for chess.' })}
              </p>
              <ul className="mt-8 space-y-4">
                {benefits.map(({ icon: Icon, label }) => (
                  <li key={label} className="flex items-center gap-3 text-sm font-medium text-white/90">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10">
                      <Icon aria-hidden="true" className="h-5 w-5 text-[#d7eabc]" />
                    </span>
                    {label}
                  </li>
                ))}
              </ul>
            </div>
            <p className="relative text-xs font-medium tracking-wide text-white/65">
              {t('authShell.footer', { defaultValue: 'Your chess. Your journey.' })}
            </p>
          </section>
        )}

        <motion.main
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="mx-auto flex w-full max-w-[420px] min-w-0 flex-col justify-center"
        >
          <div className="mb-7 flex flex-col items-center text-center">
            <LogoMark size={welcome ? 54 : 58} className="mb-3" />
            <h1 className="text-3xl font-bold tracking-tight">{t('app.name')}</h1>
            <p className="mt-1 max-w-xs text-sm leading-relaxed text-ui-mutedText">{t('app.tagline')}</p>
          </div>
          <div className="ui-card space-y-4 p-5 shadow-ui-soft sm:p-7">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
              {subtitle && <p className="mt-1 text-sm leading-relaxed text-ui-mutedText">{subtitle}</p>}
            </div>
            {children}
          </div>
          <nav aria-label={t('navigation.language', { defaultValue: 'Language' })} className="mt-5 flex flex-wrap items-center justify-center gap-1 text-xs">
            {LANGUAGES.map((language) => {
              const active = normalizeLanguage(i18n.language) === language.code;
              return (
                <button
                  key={language.code}
                  type="button"
                  aria-label={language.native}
                  aria-pressed={active}
                  onClick={() => { void i18n.changeLanguage(language.code); }}
                  className={`min-h-9 min-w-10 rounded-lg px-2 py-2 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus ${active
                    ? 'bg-ui-muted text-ui-foreground'
                    : 'text-ui-mutedText hover:bg-ui-hover hover:text-ui-foreground'}`}
                >
                  {language.short}
                </button>
              );
            })}
          </nav>
        </motion.main>
      </div>
    </div>
  );
}
