import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, normalizeLanguage, type Language } from '../lib/languages';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertCircle, ChevronRight, ChevronLeft, Sparkles, Loader2 } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { LogoMark } from '../components/Logo';

export default function Setup() {
  const { t, i18n } = useTranslation();
  const reduceMotion = useReducedMotion();
  const { refresh } = useAuth();
  const nav = useNavigate();

  const [step, setStep] = useState<1 | 2>(1);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [language, setLanguage] = useState<Language>(normalizeLanguage(i18n.language));
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testError, setTestError] = useState('');
  const [testHint, setTestHint] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // AnimatePresence waits for the previous step to leave before mounting the
  // next one. Focusing the heading from a normal effect would be too early.
  // A ref callback announces the new step as soon as it enters the DOM, but
  // preserves the username autofocus when the wizard first opens.
  const focusNextStep = useRef(false);
  const hasChangedStep = useRef(false);
  const announceStep = useCallback((heading: HTMLHeadingElement | null) => {
    if (heading && focusNextStep.current) {
      focusNextStep.current = false;
      heading.focus({ preventScroll: true });
    }
  }, []);
  const goToStep = (next: 1 | 2) => {
    focusNextStep.current = true;
    hasChangedStep.current = true;
    setStep(next);
  };

  async function testOllama() {
    setTestStatus('testing'); setTestError(''); setTestHint(undefined); setModels([]);
    try {
      const res = await fetch('/api/setup/test-ollama', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'patzer' },
        body: JSON.stringify({ url: ollamaUrl }),
      });
      const data = await res.json();
      if (data.ok) {
        const names = (data.models ?? []).map((m: { name: string }) => m.name);
        setModels(names);
        if (names.length && !ollamaModel) setOllamaModel(names[0]);
        setTestStatus('ok');
      } else {
        setTestStatus('fail'); setTestError(data.error ?? 'unknown'); setTestHint(data.hint);
      }
    } catch (err) {
      setTestStatus('fail'); setTestError((err as Error).message);
    }
  }

  async function submit() {
    setBusy(true); setError('');
    try {
      await api.post('/api/setup/init', {
        username, password, display_name: displayName || username, language,
        ollama_url: ollamaUrl || '', ollama_model: ollamaModel || '',
      });
      await i18n.changeLanguage(language);
      await refresh();
      nav('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative isolate flex min-h-dvh items-center justify-center overflow-x-clip bg-ui-bg px-4 py-8 text-ui-foreground sm:px-6 sm:py-10">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-amber-200/30 blur-3xl dark:bg-amber-700/10" />
        <div className="absolute -bottom-40 -right-40 h-[480px] w-[480px] rounded-full bg-emerald-200/30 blur-3xl dark:bg-emerald-700/10" />
      </div>

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="relative w-full min-w-0 max-w-xl"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <LogoMark size={64} className="mb-3" />
          <h1 className="text-3xl font-bold tracking-tight">{t('setup.title')}</h1>
          <p className="page-sub">{t('setup.subtitle')}</p>
        </div>

        <div className="card min-w-0 overflow-hidden p-4 shadow-lift sm:p-8">
          {/* Stepper */}
          <ol aria-label={t('setup.progress', { defaultValue: 'Setup steps' })} className="mb-6 flex items-center justify-center gap-2">
            <li aria-current={step === 1 ? 'step' : undefined} aria-label={t('setup.step1')}>
              <Dot active={step === 1} done={step > 1}>1</Dot>
            </li>
            <li aria-hidden="true" className="h-px w-12 bg-ui-border" />
            <li aria-current={step === 2 ? 'step' : undefined} aria-label={t('setup.step2')}>
              <Dot active={step === 2}>2</Dot>
            </li>
          </ol>

          <AnimatePresence mode="wait" initial={false}>
            {step === 1 && (
              <motion.div key="s1" initial={reduceMotion ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={reduceMotion ? undefined : { opacity: 0, x: 8 }} className="space-y-4">
                <h2 ref={announceStep} tabIndex={-1} className="text-lg font-semibold outline-none">{t('setup.step1')}</h2>
                <div>
                  <p className="label mb-1">{t('common.language')}</p>
                  <div role="group" aria-label={t('common.language')} data-setup-languages
                    className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {LANGUAGES.map((l) => (
                      <LangBtn key={l.code} current={language} value={l.code} onClick={() => { setLanguage(l.code); void i18n.changeLanguage(l.code); }} lang={l.code}>{l.native}</LangBtn>
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label mb-1 block" htmlFor="setup-username">{t('common.username')}</label>
                    <input id="setup-username" className="input" autoComplete="username" autoFocus={!hasChangedStep.current} value={username} onChange={(e) => setUsername(e.target.value)} />
                  </div>
                  <div>
                    <label className="label mb-1 block" htmlFor="setup-display-name">{t('common.displayName')}</label>
                    <input id="setup-display-name" className="input" autoComplete="nickname" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={username} />
                  </div>
                </div>
                <div>
                  <label className="label mb-1 block" htmlFor="setup-password">{t('common.password')}</label>
                  <input id="setup-password" className="input" type="password" autoComplete="new-password" aria-describedby="setup-password-hint" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <p id="setup-password-hint" className="mt-1 text-xs text-ui-mutedText">{t('setup.passwordHint')}</p>
                </div>
                <button type="button" onClick={() => goToStep(2)} disabled={!username.trim() || password.length < 10} className="btn-primary min-h-11 w-full">
                  {t('setup.next')} <ChevronRight className="h-4 w-4" />
                </button>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="s2" initial={reduceMotion ? false : { opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={reduceMotion ? undefined : { opacity: 0, x: -8 }} className="space-y-4">
                <h2 ref={announceStep} tabIndex={-1} className="text-lg font-semibold outline-none">{t('setup.step2')}</h2>
                <p className="text-sm text-ui-mutedText">{t('setup.ollamaSkip')}</p>
                <div>
                  <label className="label mb-1 block" htmlFor="setup-ollama-url">{t('setup.ollamaUrl')}</label>
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                    <input id="setup-ollama-url" className="input min-w-0 flex-1" value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} placeholder="http://localhost:11434" />
                    <button type="button" onClick={testOllama} className="btn-secondary min-h-11 shrink-0 text-sm" disabled={!ollamaUrl || testStatus === 'testing'}>
                      {testStatus === 'testing'
                        ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                        : t('setup.ollamaTest')}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-ui-mutedText">{t('setup.ollamaUrlHelp')}</p>
                </div>
                {testStatus === 'ok' && (
                  <div role="status" className="flex items-center gap-1 text-sm text-ui-primary">
                    <CheckCircle2 className="h-4 w-4" /> {t('setup.ollamaConnected', { count: models.length })}
                  </div>
                )}
                {testStatus === 'fail' && (
                  <div role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">
                    <AlertCircle className="mr-1 inline h-4 w-4" /> {t('setup.ollamaFailed', { error: testError })}
                    {testHint && <p className="mt-1 text-xs text-ui-mutedText">{t(`setup.llmHint.${testHint}`)}</p>}
                  </div>
                )}
                {models.length > 0 && (
                  <div>
                    <label className="label mb-1 block" htmlFor="setup-ollama-model">{t('setup.ollamaModel')}</label>
                    <select id="setup-ollama-model" className="input" value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)}>
                      {models.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                )}
                {error && <div role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>}
                <div className="flex min-w-0 flex-wrap gap-2">
                  <button type="button" onClick={() => goToStep(1)} className="btn-ghost min-h-11 flex-1"><ChevronLeft className="h-4 w-4" /> {t('common.back')}</button>
                  <button type="button" onClick={submit} disabled={busy} className="btn-primary min-h-11 flex-[2]">
                    <Sparkles className="h-4 w-4" />
                    {busy ? t('setup.creating') : t('setup.finish')}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

function Dot({ active, done, children }: { active?: boolean; done?: boolean; children: React.ReactNode }) {
  return (
    <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors
      ${active ? 'bg-ink-900 text-cream dark:bg-cream dark:text-ink-900' :
        done ? 'bg-accent-500 text-white' : 'bg-ink-200 text-ink-500 dark:bg-ink-700 dark:text-ink-300'}`}>
      {done ? <CheckCircle2 className="h-4 w-4" /> : children}
    </span>
  );
}

function LangBtn({ current, value, onClick, lang, children }: { current: string; value: string; onClick: () => void; lang?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} lang={lang} aria-pressed={current === value}
      className={`btn min-h-11 min-w-0 whitespace-normal break-words px-2 text-center text-xs leading-tight last:col-span-2 sm:last:col-span-1 ${current === value ? 'btn-primary' : 'btn-secondary'}`}>{children}</button>
  );
}
